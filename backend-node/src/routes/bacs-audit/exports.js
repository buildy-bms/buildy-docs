'use strict';

// Exports PDF audit BACS : (1) checklist A4 imprimable, (2) export CSV
// du plan d'actions, (3) export PDF du rapport complet (synthese,
// systemes, GTB, plan, annexes R175).

const path = require('path');
const fs = require('fs');
const config = require('../../config');
const db = require('../../database');
const log = require('../../lib/logger').system;
const { renderPdf, renderHtml, buildHeaderFooter, loadAssetDataUrl } = require('../../lib/pdf');
const { buildChecklistData } = require('../../lib/bacs-checklist-builder');
const { assertBacsAuditExists, auditShortName } = require('./_shared');
const { numberActionItems } = require('./_action-numbering');
const { loadPlainTagResolver } = require('./_action-tags');
const { buildActionItemsCsv } = require('./_actions-csv');
const { buildBacsAuditExportData: buildExportDataRaw } = require('./_export-data');
const { regenerateActionItems } = require('../../lib/bacs-audit-action-generator');

// Avant tout aperçu ou export : régénère le plan d'actions, la puissance et
// le statut d'assujettissement avec les règles EN VIGUEUR. Sinon le PDF
// imprime des chiffres figés au dernier enregistrement de l'audit (règles
// d'une version antérieure : actions périmées, puissance stockée ≠ cumul
// recalculé — ex. 122,8 kW au chapitre 1 contre 155,8 kW dans L'essentiel).
// Idempotent (statuts « écartée » et annotations commerciales conservés).
async function buildBacsAuditExportData(af, opts) {
  try {
    regenerateActionItems(af.id);
  } catch (err) {
    log.warn(`Régénération du plan d'actions avant export #${af.id} impossible : ${err.message}`);
  }
  return buildExportDataRaw(db.afs.getById(af.id) || af, opts);
}
const { pruneOldExports } = require('../../lib/export-retention');
const { buildFixturePreviewData } = require('./_preview-fixture');
const archiver = require('archiver');

// ─── Rendu des PDF de l'audit (partagé) ─────────────────────────────
// Utilisés par l'export du rapport, l'export des tableaux et l'export du
// dossier complet (ZIP) : un seul rendu, une seule trace dans `exports`.
const WATERMARK_PATH = path.resolve(__dirname, '../../../templates/pdf/assets/watermark-buildy.png');
const BUILDY_WATERMARK = { imagePath: WATERMARK_PATH, widthRatio: 0.85, heightRatio: 0.85, opacity: 0.03 };

// Rapport d'audit A4. Lève une erreur si le rendu échoue.
async function renderBacsAuditReport(af, data, userId) {
  const documentId = af.id;
  const { actionItemsRaw, actionStats, version, isBacs } = data;
  const exportsDir = path.resolve(config.exportsDir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${af.slug}-bacs-audit-${version}-${ts}.pdf`;
  const outputPath = path.join(exportsDir, String(documentId), filename);
  const logoSmall = loadAssetDataUrl('logo-buildy.svg');
  // En dev (DEV_BYPASS_AUTH actif), recharger templates + partials a
  // chaque export — sinon les modifs .hbs/.css ne sont prises en compte
  // qu'au prochain pm2 restart (cf. incident 2026-05-26 ou refonte ch.3
  // n'apparaissait pas sur exports reels alors que la fixture preview
  // affichait bien la version a jour grace au flag fresh:true).
  const devFresh = process.env.DEV_BYPASS_AUTH === '1';
  const result = await renderPdf({
    template: 'bacs-audit',
    styles: 'styles-bacs-audit',
    data,
    outputPath,
    populateToc: true,
    pageFormat: 'A4',
    skipFirstPageHeaderFooter: true,
    coverFullBleed: true,
    closingFullBleed: true,
    fresh: devFresh,
    watermark: { ...BUILDY_WATERMARK, skipFirstPage: true, skipLastPage: true },
    pdfOptions: buildHeaderFooter({
      clientName: af.client_name,
      projectName: af.project_name,
      docType: isBacs ? 'Audit BACS' : 'Audit GTB',
      version: data.versionLabel || version,
      logoDataUrl: logoSmall,
      // Lot 2 — versioning juridique : la version R175 livrée est gravée
      // au moment du `audit_deliver`. Pour les exports intermédiaires
      // (preview, brouillon), on lit la version courante de bacs_knowledge.
      decreeVersionLabel: isBacs ? (af.decree_version_label || data.currentDecreeVersionLabel || null) : null,
      footerNote: isBacs
        ? 'Audit de conformité au décret BACS · document confidentiel'
        : 'Audit GTB · préparation devis · document confidentiel',
    }),
  });
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
  pruneOldExports(documentId, insertedRow.lastInsertRowid);
  return { id: insertedRow.lastInsertRowid, path: result.path, sizeBytes: result.sizeBytes, version };
}

// Tableaux de synthèse A3 paysage. Lève une erreur si le rendu échoue.
async function renderBacsAuditTables(af, data, userId) {
  const documentId = af.id;
  const { version, isBacs } = data;
  const exportsDir = path.resolve(config.exportsDir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${af.slug}-bacs-tables-${version}-${ts}.pdf`;
  const outputPath = path.join(exportsDir, String(documentId), filename);
  const logoSmall = loadAssetDataUrl('logo-buildy.svg');
  // Idem rapport principal : fresh:true en dev pour hot reload.
  const devFresh = process.env.DEV_BYPASS_AUTH === '1';
  const result = await renderPdf({
    template: 'bacs-audit-tables',
    styles: 'styles-bacs-audit-tables',
    data,
    outputPath,
    pageFormat: 'A3',
    pageOrientation: 'landscape',
    fresh: devFresh,
    pdfOptions: buildHeaderFooter({
      clientName: af.client_name,
      projectName: af.project_name,
      docType: isBacs ? 'Audit BACS — Tableaux de synthèse' : 'Audit GTB — Tableaux de synthèse',
      version: data.versionLabel || version,
      logoDataUrl: logoSmall,
      footerNote: isBacs
        ? 'Audit BACS · tableaux de synthèse · document confidentiel'
        : 'Audit GTB · tableaux de synthèse · document confidentiel',
    }),
  });
  const insertedRow = db.db.prepare(`
    INSERT INTO exports (af_id, kind, file_path, sections_snapshot, options, motif, exported_by, file_size_bytes)
    VALUES (?, 'pdf-bacs-tables', ?, ?, ?, ?, ?, ?)
  `).run(
    documentId, result.path,
    JSON.stringify({
      systems_count: data.systemsByZone.reduce((n, z) => n + z.items.length, 0),
      meters_count: data.meters.length,
    }),
    JSON.stringify({ version }),
    'Export tableaux de synthèse',
    userId || null, result.sizeBytes,
  );
  db.auditLog.add({
    afId: documentId, userId, action: 'export.bacs-tables',
    payload: { version, file_size_bytes: result.sizeBytes },
  });
  log.info(`PDF tables exported: doc #${documentId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);
  pruneOldExports(documentId, insertedRow.lastInsertRowid);
  return { id: insertedRow.lastInsertRowid, path: result.path, sizeBytes: result.sizeBytes, version };
}

// Nom de fichier lisible et sûr dans une archive (Windows, macOS).
function safeArchiveName(s, max = 90) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[\u2012-\u2015]/g, '-')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[ .-]+$/, '') || 'document';
}

// Atelier de design PDF audit BACS — n'est servi qu'en dev (NODE_ENV != 'production'
// OU DEV_BYPASS_AUTH=1). En prod, les routes __preview-fixture renvoient 404.
const DEV_PREVIEW_ENABLED = process.env.NODE_ENV !== 'production' || process.env.DEV_BYPASS_AUTH === '1';

// Bandeau dev injecté dans le HTML preview fixture. Caché en @media print
// pour ne pas pourrir l'export PDF / la preview impression navigateur.
function buildDevBanner({ fixtureName, ts }) {
  return `<style>
@media screen {
  #buildy-fixture-banner {
    position: fixed; top: 8px; right: 8px; z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px; line-height: 1.4;
    background: rgba(15, 23, 42, 0.92); color: #fff;
    padding: 8px 12px; border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    display: flex; align-items: center; gap: 12px;
    backdrop-filter: blur(8px);
  }
  #buildy-fixture-banner .tag { background:#10b981;color:#052e16;padding:2px 6px;border-radius:4px;font-weight:600;font-size:10px;letter-spacing:0.04em;text-transform:uppercase; }
  #buildy-fixture-banner button {
    background: rgba(255,255,255,0.12); color:#fff; border:none;
    padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;
    font-family: inherit;
  }
  #buildy-fixture-banner button:hover { background: rgba(255,255,255,0.22); }
  #buildy-fixture-banner .sep { color:#475569; }
  #buildy-fixture-banner .ts { color:#94a3b8; font-size:10px; }
  #buildy-fixture-banner .group { display:flex; align-items:center; gap:4px; padding:2px 6px; border-radius:4px; }
  #buildy-fixture-banner .group-bacs { background: rgba(16,185,129,0.15); }
  #buildy-fixture-banner .group-classique { background: rgba(245,158,11,0.15); }
  #buildy-fixture-banner .group-label { font-size:9px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; opacity:0.8; margin-right:2px; }
}
@media print { #buildy-fixture-banner { display: none !important; } }
</style>
<div id="buildy-fixture-banner">
  <span class="tag">Fixture</span>
  <span>${fixtureName}</span>
  <button onclick="location.reload()">Reload</button>
  <button onclick="window.print()">Print</button>
  <span class="sep">|</span>
  <span class="group group-bacs">
    <span class="group-label">BACS</span>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture'">HTML</button>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture/pdf'">PDF</button>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture/tables'">Tab. HTML</button>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture/tables/pdf'">Tab. PDF</button>
  </span>
  <span class="group group-classique">
    <span class="group-label">Classique</span>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture-classique'">HTML</button>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture-classique/pdf'">PDF</button>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture-classique/tables'">Tab. HTML</button>
    <button onclick="location.href='/api/bacs-audit/__preview-fixture-classique/tables/pdf'">Tab. PDF</button>
  </span>
  <span class="ts">${ts}</span>
</div>`;
}

async function routes(fastify) {
  // ─── Export checklist A4 (impression terrain) ──────────────────────
  // Genere une feuille A4 imprimable avec numerotation stable,
  // cases a cocher, emplacements pour photos, et liste des pieces a
  // demander a l'exploitant. Le collaborateur l'utilise sur site avec
  // photos telephone + dictee Plaud Pro pour la restitution au bureau.
  fastify.post('/bacs-audit/:documentId/exports/checklist', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, request, reply);
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

  // Plan d'actions en CSV (vue commerciale) : même ordre et mêmes numéros
  // BACS-xxx que l'écran et le PDF, libellés en français, lisible dans Excel.
  fastify.get('/bacs-audit/:documentId/action-items/export.csv', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(id, request, reply);
    if (!af) return;
    const rows = db.db.prepare(`
      SELECT a.*, z.name AS zone_name, e.name AS equipment_name
      FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.id = a.zone_id
      LEFT JOIN equipments e ON e.id = a.equipment_id
      WHERE a.document_id = ?
    `).all(id);
    const { strip } = loadPlainTagResolver(id);
    const csv = buildActionItemsCsv(numberActionItems(rows), strip);
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
    const name = `Actions - ${safeArchiveName(auditShortName(af) || af.slug, 70)} - ${day}.csv`;
    const asciiName = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return csv;
  });

  // ─── Preview HTML audit BACS (pour aperçu in-browser sans Puppeteer) ─
  // Renvoie le HTML autonome (CSS embed + fonts data URL) qu'un iframe
  // sandboxé peut afficher cote frontend. Pas de generation PDF, pas
  // d'enregistrement dans `exports`. Permet de valider le contenu avant
  // de declencher un export PDF complet.
  fastify.get('/bacs-audit/:documentId/preview', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, request, reply);
    if (!af) return;
    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;
    const data = await buildBacsAuditExportData(af, { user, previewMode: true });
    // En dev, recharge templates + partials a chaque appel — cohérent
    // avec la route POST /export-pdf et avec la fixture preview.
    const devFresh = process.env.DEV_BYPASS_AUTH === '1';
    const html = renderHtml({
      template: 'bacs-audit', styles: 'styles-bacs-audit', data, fresh: devFresh,
    });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // ─── Atelier de design PDF (preview fixture HTML, dev only) ───────
  // Sert un audit fictif crédible (Plateforme Atlas Sud) sans toucher la
  // DB. Templates et CSS rechargés à chaque requête (flag `fresh: true`)
  // pour itérer sur le design sans `pm2 restart`. Cf. plan
  // /Users/kevinbrocard/.claude/plans/stateful-moseying-porcupine.md
  fastify.get('/bacs-audit/__preview-fixture', async (request, reply) => {
    if (!DEV_PREVIEW_ENABLED) return reply.code(404).send({ detail: 'Not found' });
    const data = await buildFixturePreviewData({ user: null });
    const html = renderHtml({
      template: 'bacs-audit', styles: 'styles-bacs-audit', data, fresh: true,
    });
    const banner = buildDevBanner({
      fixtureName: 'Plateforme Atlas Sud',
      ts: new Date().toLocaleString('fr-FR'),
    });
    // Injection du bandeau juste avant </body>
    const withBanner = html.includes('</body>')
      ? html.replace('</body>', banner + '</body>')
      : html + banner;
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(withBanner);
  });

  // ─── Atelier de design — Tableaux de synthèse (HTML, paysage, dev) ─
  // Document complementaire au PDF audit BACS principal : 2 grands
  // tableaux denses (systemes par zone × usage, compteurs) destines a
  // l'integrateur Buildy pour batir son devis.
  fastify.get('/bacs-audit/__preview-fixture/tables', async (request, reply) => {
    if (!DEV_PREVIEW_ENABLED) return reply.code(404).send({ detail: 'Not found' });
    const data = await buildFixturePreviewData({ user: null });
    const html = renderHtml({
      template: 'bacs-audit-tables', styles: 'styles-bacs-audit-tables', data,
      pageFormat: 'A3', pageOrientation: 'landscape', fresh: true,
    });
    const banner = buildDevBanner({
      fixtureName: 'Atlas Sud — Tableaux de synthèse (paysage)',
      ts: new Date().toLocaleString('fr-FR'),
    });
    const withBanner = html.includes('</body>')
      ? html.replace('</body>', banner + '</body>')
      : html + banner;
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(withBanner);
  });

  // ─── Atelier de design — Tableaux de synthèse (PDF, paysage, dev) ─
  fastify.get('/bacs-audit/__preview-fixture/tables/pdf', async (request, reply) => {
    if (!DEV_PREVIEW_ENABLED) return reply.code(404).send({ detail: 'Not found' });
    const data = await buildFixturePreviewData({ user: null });
    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fixture-bacs-tables-${data.version}-${ts}.pdf`;
    const fixturesOut = path.join(exportsDir, '__fixture');
    fs.mkdirSync(fixturesOut, { recursive: true });
    const outputPath = path.join(fixturesOut, filename);
    const logoSmall = loadAssetDataUrl('logo-buildy.svg');

    let result;
    try {
      result = await renderPdf({
        template: 'bacs-audit-tables', styles: 'styles-bacs-audit-tables', data, outputPath,
        pageFormat: 'A3', pageOrientation: 'landscape',
        fresh: true,
        pdfOptions: buildHeaderFooter({
          clientName: data.document.client_name,
          projectName: data.document.project_name,
          docType: 'Audit BACS — Tableaux de synthèse',
          version: data.version,
          logoDataUrl: logoSmall,
          footerNote: 'Audit BACS · tableaux de synthèse · document fictif',
        }),
      });
    } catch (err) {
      log.error(`PDF tables fixture render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec génération PDF tables : ${err.message}` });
    }
    const pdfBuf = fs.readFileSync(result.path);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${filename}"`)
      .send(pdfBuf);
  });

  // ─── Atelier de design PDF (export PDF du fixture, dev only) ──────
  // Génère le PDF complet du fixture via Puppeteer (header/footer + cover
  // full bleed + populateToc). C'est ce PDF que Buildy peut utiliser comme
  // livrable technico-commercial.
  fastify.get('/bacs-audit/__preview-fixture/pdf', async (request, reply) => {
    if (!DEV_PREVIEW_ENABLED) return reply.code(404).send({ detail: 'Not found' });
    const data = await buildFixturePreviewData({ user: null });
    const { version, isBacs } = data;
    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fixture-bacs-audit-${version}-${ts}.pdf`;
    const fixturesOut = path.join(exportsDir, '__fixture');
    fs.mkdirSync(fixturesOut, { recursive: true });
    const outputPath = path.join(fixturesOut, filename);

    const logoSmall = loadAssetDataUrl('logo-buildy.svg');
    const WATERMARK_PATH = path.resolve(__dirname, '../../../templates/pdf/assets/watermark-buildy.png');
    const BUILDY_WATERMARK = { imagePath: WATERMARK_PATH, widthRatio: 0.85, heightRatio: 0.85, opacity: 0.03 };

    let result;
    try {
      result = await renderPdf({
        template: 'bacs-audit', styles: 'styles-bacs-audit', data, outputPath,
        populateToc: true, pageFormat: 'A4',
        skipFirstPageHeaderFooter: true, coverFullBleed: true,
        closingFullBleed: true,
        watermark: { ...BUILDY_WATERMARK, skipFirstPage: true, skipLastPage: true },
        fresh: true, // hot reload du template aussi pour le PDF
        pdfOptions: buildHeaderFooter({
          clientName: data.document.client_name,
          projectName: data.document.project_name,
          docType: isBacs ? 'Audit BACS' : 'Audit GTB',
          version: data.versionLabel || version,
          logoDataUrl: logoSmall,
          footerNote: 'Audit de conformité au décret BACS · document fictif (atelier de design)',
        }),
      });
    } catch (err) {
      log.error(`PDF fixture render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec génération PDF fixture : ${err.message}` });
    }
    const pdfBuf = fs.readFileSync(result.path);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${filename}"`)
      .send(pdfBuf);
  });

  // ─── Export PDF audit BACS ─────────────────────────────────────────
  fastify.post('/bacs-audit/:documentId/export-pdf', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, request, reply);
    if (!af) return;

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    const data = await buildBacsAuditExportData(af, { user, previewMode: false });
    let out;
    try {
      out = await renderBacsAuditReport(af, data, userId);
    } catch (err) {
      log.error(`PDF audit BACS render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }
    return {
      id: out.id,
      version: out.version,
      file_size_bytes: out.sizeBytes,
      download_url: `/api/exports/${out.id}/download`,
    };
  });

  // ─── Export PDF tableaux de synthèse audit BACS / GTB classique ────
  // Document complementaire A3 paysage : 4 grands tableaux denses
  // (zones, systemes, compteurs, regulation thermique, plan d'action)
  // destines a l'integrateur Buildy pour batir son devis. Cf.
  // templates/pdf/bacs-audit-tables.hbs.
  fastify.post('/bacs-audit/:documentId/exports/tables', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, request, reply);
    if (!af) return;

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    const data = await buildBacsAuditExportData(af, { user, previewMode: false });
    let out;
    try {
      out = await renderBacsAuditTables(af, data, userId);
    } catch (err) {
      log.error(`PDF tables render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF tableaux : ${err.message}` });
    }
    return {
      id: out.id,
      version: out.version,
      file_size_bytes: out.sizeBytes,
      download_url: `/api/exports/${out.id}/download`,
    };
  });

  // ─── Dossier complet (ZIP) ─────────────────────────────────────────
  // Rapport A4 + tableaux de synthèse A3 + documents du site cochés
  // « Inclure dans le rapport », nommés comme dans l'annexe E (« PJ 02 –
  // titre.pdf »). Les deux PDF sont rendus et tracés comme les exports
  // habituels ; l'archive est envoyée à la volée, sans être stockée.
  fastify.post('/bacs-audit/:documentId/exports/dossier', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, request, reply);
    if (!af) return;

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    const data = await buildBacsAuditExportData(af, { user, previewMode: false });
    let report, tables;
    try {
      report = await renderBacsAuditReport(af, data, userId);
      tables = await renderBacsAuditTables(af, data, userId);
    } catch (err) {
      log.error(`Dossier ZIP : rendu PDF impossible : ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation du dossier : ${err.message}` });
    }

    // « Audit BACS — Sénas » → « Sénas » (le type est déjà dans le nom).
    const project = safeArchiveName(auditShortName(af) || af.slug, 70);
    const site = af.site_id ? db.sites.getById(af.site_id) : null;
    const docsRoot = site
      ? path.resolve(config.attachmentsDir, '..', 'site-documents', site.site_uuid)
      : null;

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => log.warn(`Dossier ZIP #${documentId} : ${err.message}`));
    archive.on('error', (err) => log.error(`Dossier ZIP #${documentId} : ${err.message}`));
    archive.file(report.path, { name: `01 - Rapport d'audit - ${project}.pdf` });
    archive.file(tables.path, { name: `02 - Tableaux de synthèse - ${project}.pdf` });

    const attachments = data.reportAttachments || [];
    const missing = [];
    for (const a of attachments) {
      const src = docsRoot && a.filename ? path.join(docsRoot, a.filename) : null;
      if (!src || !fs.existsSync(src)) { missing.push(a); continue; }
      const ext = path.extname(a.filename || '').toLowerCase();
      const num = String(a.ref || '').replace(/\D+/g, '').padStart(2, '0');
      // Titre sans son extension éventuelle (« Bureaux_R1.jpeg » + « .jpg »).
      const title = String(a.title || 'document')
        .replace(/\.(jpe?g|png|webp|heic|gif|pdf|docx?|xlsx?|csv|dwg|mp3|m4a|wav|txt)$/i, '');
      archive.file(src, { name: `Pièces jointes/PJ ${num} - ${safeArchiveName(title)}${ext}` });
    }
    if (missing.length) {
      const pj = (a) => `PJ ${String(a.ref || '').replace(/\D+/g, '').padStart(2, '0')}`;
      archive.append(
        `Fichiers introuvables sur le serveur au moment de l'export :\r\n${missing.map(a => `- ${pj(a)} : ${a.title}`).join('\r\n')}\r\n`,
        { name: 'Pièces jointes/Fichiers introuvables.txt' },
      );
    }
    archive.finalize();

    db.auditLog.add({
      afId: documentId, userId, action: 'export.bacs-dossier',
      payload: {
        version: report.version, report_export_id: report.id, tables_export_id: tables.id,
        attachments: attachments.length, attachments_missing: missing.length,
      },
    });
    log.info(`Dossier ZIP audit #${documentId} : rapport + tableaux + ${attachments.length - missing.length} pièce(s) jointe(s)${missing.length ? `, ${missing.length} introuvable(s)` : ''}`);

    // Date ET heure (Paris) : deux exports du même jour ont des noms
    // distincts — sinon le navigateur enregistre « … (1).zip » et l'on
    // rouvre facilement l'ancien.
    const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const zipName = `Audit BACS - ${project} - dossier complet - ${p.year}-${p.month}-${p.day} ${p.hour}h${p.minute}.zip`;
    const asciiName = zipName.normalize('NFD').replace(/[^\x20-\x7e]/g, '');
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`)
      .send(archive);
  });
}

module.exports = routes;
// Chemin d'export de production, réutilisé tel quel par les contrôles PDF
// (scripts/pdf-checks) : mêmes données, mêmes options de rendu.
module.exports.buildBacsAuditExportData = buildBacsAuditExportData;
module.exports.renderBacsAuditReport = renderBacsAuditReport;
module.exports.renderBacsAuditTables = renderBacsAuditTables;
