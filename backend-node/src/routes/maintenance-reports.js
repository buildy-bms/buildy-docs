'use strict';

// Routes rapports annuels de maintenance (mig 203).
//
// Un rapport est un document `afs` avec `kind = 'maintenance_report'`,
// rattaché à un site, couvrant une période (mr_period_start / mr_period_end).
// Le corps vit dans UNE section unique (table `sections`, af_id = id du
// rapport, kind='standard', parent_id NULL) — même mécanique que les
// chapitres whitepaper, en plus simple. Édition Tiptap via body_html.
//
// Export PDF : cover full-bleed navy (charte whitepaper) + page de fin navy
// (styles _buildy-back-cover.css partagés, contenu contact support — pas le
// CTA démo du partial _buildy-back-cover.hbs, inadapté à un client déjà en
// contrat).

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const db = require('../database');
const config = require('../config');
const { renderPdf, renderHtml, buildHeaderFooter, loadAssetDataUrl } = require('../lib/pdf');
const { sanitize: sanitizeHtmlField } = require('../lib/html-sanitize');
const { assertRead, assertWrite } = require('../lib/af-permissions');
const { MAINTENANCE_REPORT_SKELETON_HTML, formatPeriodLabel } = require('../lib/maintenance-report');
const log = require('../lib/logger').system;

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  client_name: z.string().min(1).optional(),
  mr_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  mr_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
  body_html: z.string().nullable().optional(),
});

module.exports = async function maintenanceReportRoutes(fastify) {

  // Charge le rapport ou répond 404. Retourne null si la réponse est déjà
  // partie (pattern assert* du repo).
  function getReport(id, reply) {
    const row = db.afs.getById(id);
    if (!row || row.deleted_at || row.kind !== 'maintenance_report') {
      reply.code(404).send({ detail: 'Rapport de maintenance non trouvé' });
      return null;
    }
    return row;
  }

  // La section unique qui porte le corps. Lazy-create pour les rapports
  // antérieurs au squelette (robustesse : ne devrait jamais arriver).
  function getBodySection(reportId) {
    const list = db.sections.listByAf(reportId);
    if (list.length) return list[0];
    return db.sections.create({
      afId: reportId, parentId: null, position: 0, kind: 'standard',
      title: 'Rapport annuel de maintenance',
      bodyHtml: MAINTENANCE_REPORT_SKELETON_HTML,
    });
  }

  function toReport(row, { withBody = false } = {}) {
    const site = row.site_id ? db.sites.getById(row.site_id) : null;
    const out = {
      id: row.id,
      title: row.title,
      client_name: row.client_name,
      status: row.status,
      site_id: row.site_id,
      site_name: site?.name || null,
      mr_period_start: row.mr_period_start || null,
      mr_period_end: row.mr_period_end || null,
      period_label: formatPeriodLabel(row.mr_period_start, row.mr_period_end),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (withBody) out.body_html = getBodySection(row.id).body_html || '';
    return out;
  }

  // Données du template PDF/preview.
  function buildReportData(row) {
    const site = row.site_id ? db.sites.getById(row.site_id) : null;
    const now = new Date();
    return {
      title: row.title || `Rapport annuel de maintenance`,
      siteName: site?.name || row.project_name,
      clientName: row.client_name,
      periodLabel: formatPeriodLabel(row.mr_period_start, row.mr_period_end),
      dateLabel: now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      body_html: getBodySection(row.id).body_html || '',
      logoWhiteDataUrl: loadAssetDataUrl('logo-buildy-blanc.png'),
    };
  }

  const TEMPLATE = {
    template: 'maintenance-report',
    styles: ['styles-whitepaper', '_buildy-back-cover', 'styles-maintenance-report'],
  };

  // ── GET /maintenance-reports/:id — détail + corps ──
  fastify.get('/maintenance-reports/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = getReport(id, reply);
    if (!row) return;
    if (!assertRead(request, reply, id)) return;
    return toReport(row, { withBody: true });
  });

  // ── PATCH /maintenance-reports/:id — métadonnées + corps ──
  fastify.patch('/maintenance-reports/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = getReport(id, reply);
    if (!row) return;
    if (!assertWrite(request, reply, id)) return;

    let body;
    try { body = patchSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message || 'Validation' }); }

    const userId = request.authUser?.id;
    db.afs.update(id, {
      title: body.title,
      client_name: body.client_name,
      mr_period_start: body.mr_period_start,
      mr_period_end: body.mr_period_end,
      status: body.status,
      updatedBy: userId,
    });
    if (body.body_html !== undefined) {
      const section = getBodySection(id);
      db.sections.update(section.id, {
        bodyHtml: body.body_html == null ? null : sanitizeHtmlField(body.body_html),
        updatedBy: userId,
      });
    }
    db.auditLog.add({
      afId: id, userId, action: 'maintenance_report.update',
      payload: { fields: Object.keys(body) },
    });
    return toReport(db.afs.getById(id), { withBody: true });
  });

  // ── GET /maintenance-reports/:id/preview — HTML hot-reload (design) ──
  fastify.get('/maintenance-reports/:id/preview', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = getReport(id, reply);
    if (!row) return;
    if (!assertRead(request, reply, id)) return;
    const html = await renderHtml({
      ...TEMPLATE,
      data: buildReportData(row),
      fresh: true,
    });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // ── GET /maintenance-reports/:id/export/pdf ──
  fastify.get('/maintenance-reports/:id/export/pdf', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = getReport(id, reply);
    if (!row) return;
    if (!assertRead(request, reply, id)) return;

    const data = buildReportData(row);
    const exportsDir = path.resolve(config.exportsDir, String(id));
    fs.mkdirSync(exportsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `maintenance-report-${ts}.pdf`;
    const outputPath = path.join(exportsDir, filename);

    let result;
    try {
      result = await renderPdf({
        ...TEMPLATE,
        data,
        outputPath,
        pageFormat: 'A4',
        coverFullBleed: true,
        backCoverFullBleed: true,
        skipFirstPageHeaderFooter: true,
        pageMarginTopMm: 14,
        pageMarginBottomMm: 14,
        pdfOptions: buildHeaderFooter({
          clientName: data.clientName,
          projectName: data.siteName,
          docType: 'Rapport de maintenance',
          version: data.periodLabel || undefined,
          logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
          footerNote: `Rapport de maintenance ${data.siteName} · document confidentiel`,
        }),
      });
    } catch (err) {
      log.error(`Maintenance report PDF render failed (#${id}): ${err.message}`);
      return reply.code(500).send({ detail: `Échec génération PDF : ${err.message}` });
    }

    db.auditLog.add({
      afId: id, userId: request.authUser?.id, action: 'maintenance_report.export.pdf',
      payload: { file_size_bytes: result.sizeBytes },
    });
    log.info(`Maintenance report PDF exported: #${id} ${filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`);

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(fs.createReadStream(outputPath));
  });
};
