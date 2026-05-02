'use strict';

// Exports PDF audit BACS : (1) checklist A4 imprimable, (2) export CSV
// du plan d'actions, (3) export PDF du rapport complet (synthese,
// systemes, GTB, plan, annexes R175).

const path = require('path');
const fs = require('fs');
const config = require('../../config');
const db = require('../../database');
const log = require('../../lib/logger').system;
const { renderPdf, renderHtml, loadAssetDataUrl } = require('../../lib/pdf');
const { buildChecklistData } = require('../../lib/bacs-checklist-builder');
const { assertBacsAuditExists } = require('./_shared');
const { buildBacsAuditExportData } = require('./_export-data');

async function routes(fastify) {
  // ─── Export checklist A4 (impression terrain) ──────────────────────
  // Genere une feuille A4 imprimable avec numerotation stable,
  // cases a cocher, emplacements pour photos, et liste des pieces a
  // demander a l'exploitant. Le collaborateur l'utilise sur site avec
  // photos telephone + dictee Plaud Pro pour la restitution au bureau.
  fastify.post('/bacs-audit/:documentId/exports/checklist', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const data = buildChecklistData(documentId);
    if (!data) return reply.code(404).send({ detail: 'Audit introuvable' });
    const outDir = path.resolve(config.attachmentsDir, '..', 'exports', String(documentId));
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outDir, `bacs-audit-checklist-${ts}.pdf`);
    const result = await renderPdf({
      template: 'bacs-audit-checklist',
      styles: 'styles-bacs-audit-checklist',
      data: {
        ...data,
        logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
      },
      outputPath,
      pageFormat: 'A4',
      pageOrientation: 'portrait',
      pdfOptions: { format: 'A4' },
      addFormFields: true,
      pageContainerSelector: '.page',
    });
    db.auditLog.add({
      afId: documentId,
      userId: request.authUser?.id,
      action: 'bacs_audit.checklist.export',
      payload: { size: result.sizeBytes },
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="checklist-${af.slug || documentId}.pdf"`)
      .send(fs.createReadStream(outputPath));
  });

  fastify.get('/bacs-audit/:documentId/action-items/export.csv', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    const items = db.db.prepare(`
      SELECT a.*, z.name AS zone_name, e.name AS equipment_name
      FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      LEFT JOIN equipments e ON e.equipment_id = a.equipment_id
      WHERE a.document_id = ?
      ORDER BY CASE a.severity WHEN 'blocking' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, a.position
    `).all(id);
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Severity', 'Article R175', 'Categorie', 'Titre', 'Zone', 'Equipement',
      'Description', 'Status', 'Estimated effort', 'Notes commerciales'];
    const rows = [headers.join(',')];
    for (const it of items) {
      rows.push([
        esc(it.severity), esc(it.r175_article), esc(it.category), esc(it.title),
        esc(it.zone_name), esc(it.equipment_name), esc(it.description),
        esc(it.status), esc(it.estimated_effort), esc(it.commercial_notes),
      ].join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="audit-bacs-${id}-actions.csv"`);
    return rows.join('\n');
  });

  // ─── Preview HTML audit BACS (pour aperçu in-browser sans Puppeteer) ─
  // Renvoie le HTML autonome (CSS embed + fonts data URL) qu'un iframe
  // sandboxé peut afficher cote frontend. Pas de generation PDF, pas
  // d'enregistrement dans `exports`. Permet de valider le contenu avant
  // de declencher un export PDF complet.
  fastify.get('/bacs-audit/:documentId/preview', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;
    const data = await buildBacsAuditExportData(af, { user, previewMode: true });
    const html = renderHtml({ template: 'bacs-audit', styles: 'styles-bacs-audit', data });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // ─── Export PDF audit BACS ─────────────────────────────────────────
  fastify.post('/bacs-audit/:documentId/export-pdf', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    const data = await buildBacsAuditExportData(af, { user, previewMode: false });
    const { actionItemsRaw, actionStats, version, isBacs } = data;

    // Genere le PDF
    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${af.slug}-bacs-audit-${version}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, String(documentId), filename);

    const logoSmall = loadAssetDataUrl('logo-buildy.svg');
    // __dirname = backend-node/src/routes/bacs-audit/, donc 3 niveaux up
    // pour atteindre backend-node/templates/pdf/assets/
    const WATERMARK_PATH = path.resolve(__dirname, '../../../templates/pdf/assets/watermark-buildy.png');
    const BUILDY_WATERMARK = { imagePath: WATERMARK_PATH, widthRatio: 0.85, heightRatio: 0.85, opacity: 0.03 };

    let result;
    try {
      result = await renderPdf({
        template: 'bacs-audit',
        styles: 'styles-bacs-audit',
        data,
        outputPath,
        populateToc: true,
        pageFormat: 'A4',
        skipFirstPageHeaderFooter: true,
        coverFullBleed: true,
        watermark: { ...BUILDY_WATERMARK, skipFirstPage: true },
        pdfOptions: {
          displayHeaderFooter: true,
          margin: { top: '18mm', bottom: '16mm', left: '12mm', right: '12mm' },
          headerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:7.5pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; justify-content:space-between; align-items:center; letter-spacing:0.02em;">
            <span style="text-transform:uppercase; letter-spacing:0.1em; font-size:6.5pt; color:#9ca3af;">${(af.client_name || '').replace(/'/g, '&#39;')} · ${(af.project_name || '').replace(/'/g, '&#39;')}</span>
            <span style="font-family:'SFMono-Regular',Menlo,monospace; font-size:7pt; color:#6b7280;">${isBacs ? 'Audit BACS' : 'Audit GTB'} · ${version}</span>
          </div>`,
          footerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:7.5pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; align-items:center; gap:4mm; border-top:0.4pt solid #e5e7eb; padding-top:2mm;">
            <img src="${logoSmall}" style="height:4mm; opacity:0.55;" />
            <span style="flex:1; color:#9ca3af; font-size:7pt;">${isBacs ? 'Audit BACS · décret R175 · document confidentiel' : 'Audit GTB · préparation devis · document confidentiel'}</span>
            <span style="font-family:'SFMono-Regular',Menlo,monospace; font-size:7pt; color:#4b5563; font-weight:600;">
              <span class="pageNumber"></span> <span style="color:#9ca3af; font-weight:400;">/</span> <span class="totalPages"></span>
            </span>
          </div>`,
        },
      });
    } catch (err) {
      log.error(`PDF audit BACS render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }

    // Insert dans exports + audit
    const insertedRow = db.db.prepare(`
      INSERT INTO exports (af_id, kind, file_path, sections_snapshot, options, motif, exported_by, file_size_bytes)
      VALUES (?, 'pdf-bacs-audit', ?, ?, ?, ?, ?, ?)
    `).run(
      documentId, result.path,
      JSON.stringify({
        systems_count: data.systemsByZone.reduce((n, z) => n + z.items.length, 0),
        meters_count: data.meters.length,
        actions_blocking: actionStats.blocking, actions_major: actionStats.major,
      }),
      JSON.stringify({ version }),
      'Export audit BACS',
      userId || null, result.sizeBytes,
    );

    db.auditLog.add({
      afId: documentId, userId, action: 'export.bacs-audit',
      payload: { version, file_size_bytes: result.sizeBytes, actions_total: actionItemsRaw.length },
    });
    log.info(`PDF audit BACS exported: doc #${documentId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);

    return {
      id: insertedRow.lastInsertRowid,
      version,
      file_size_bytes: result.sizeBytes,
      download_url: `/api/exports/${insertedRow.lastInsertRowid}/download`,
    };
  });
}

module.exports = routes;
