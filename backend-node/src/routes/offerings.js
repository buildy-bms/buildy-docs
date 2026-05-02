'use strict';

// Catalogue des offres Buildy — PDF "Offres 2026" qui se regenere depuis
// la table section_templates (is_functionality = 1) avec la matrice de
// disponibilite avail_e / avail_s / avail_p par niveau de service.
//
// Hierarchie : chaque fonctionnalite a un parent_template_id qui pointe
// vers une section type parente (sert de categorie dans le tableau).

const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { renderPdf, renderHtml, loadAssetDataUrl } = require('../lib/pdf');

// Construit le bundle de donnees a passer au template offering-catalog.hbs.
function buildOfferingsData() {
  // Toutes les fonctionnalites + leur parent (categorie)
  const rows = db.db.prepare(`
    SELECT
      f.id, f.slug, f.title, f.body_html, f.service_level,
      f.avail_e, f.avail_s, f.avail_p, f.position,
      f.parent_template_id,
      p.id AS parent_id, p.title AS parent_title, p.position AS parent_position
    FROM section_templates f
    LEFT JOIN section_templates p ON p.id = f.parent_template_id
    WHERE f.is_functionality = 1
    ORDER BY
      COALESCE(p.position, 9999), COALESCE(p.id, 9999),
      f.position, f.id
  `).all();

  // Groupe par categorie (parent). Si pas de parent, on les met dans
  // une categorie "Divers".
  const groups = new Map();
  for (const r of rows) {
    const key = r.parent_id || 'orphan';
    if (!groups.has(key)) {
      groups.set(key, {
        id: r.parent_id || null,
        title: r.parent_title || 'Autres fonctionnalités',
        position: r.parent_position ?? 9999,
        features: [],
      });
    }
    groups.get(key).features.push({
      id: r.id,
      title: r.title,
      summary: stripHtml(r.body_html || '').slice(0, 200) || null,
      avail_e: r.avail_e || 'unavailable',
      avail_s: r.avail_s || 'unavailable',
      avail_p: r.avail_p || 'unavailable',
    });
  }
  const categories = [...groups.values()]
    .sort((a, b) => a.position - b.position);

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const year = new Date().getFullYear();

  // KPIs : nb fonctionnalites par niveau (incluses)
  let countE = 0, countS = 0, countP = 0;
  for (const c of categories) for (const f of c.features) {
    if (f.avail_e === 'included') countE++;
    if (f.avail_s === 'included') countS++;
    if (f.avail_p === 'included') countP++;
  }

  return {
    categories,
    totalFeatures: rows.length,
    countE, countS, countP,
    exportDate,
    year,
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
  };
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function routes(fastify) {
  // ─── Preview HTML (in-browser, sans Puppeteer) ─────────────────────
  fastify.get('/offerings/preview', async (request, reply) => {
    const data = buildOfferingsData();
    const html = renderHtml({
      template: 'offering-catalog',
      styles: 'styles-offering-catalog',
      data,
    });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // ─── Export PDF du catalogue d'offres ──────────────────────────────
  // Pas rattache a un AF → dossier de sortie dedie data/exports/_offerings/
  fastify.post('/offerings/export-pdf', async (request, reply) => {
    const data = buildOfferingsData();
    const userId = request.authUser?.id;

    const exportsDir = path.resolve(config.exportsDir, '_offerings');
    fs.mkdirSync(exportsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `offres-buildy-${data.year}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, filename);

    let result;
    try {
      result = await renderPdf({
        template: 'offering-catalog',
        styles: 'styles-offering-catalog',
        data,
        outputPath,
        pageFormat: 'A4',
        coverFullBleed: true,
        pdfOptions: { format: 'A4', printBackground: true },
      });
    } catch (err) {
      log.error(`Offerings PDF render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }

    db.auditLog.add({
      userId, action: 'export.offerings',
      payload: { file_size_bytes: result.sizeBytes, total_features: data.totalFeatures },
    });
    log.info(`Offerings PDF exported: ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);

    // On stream directement le fichier (pas d'enregistrement dans `exports`
    // qui est lie a un af_id, et offerings n'a pas d'AF parent).
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(fs.createReadStream(outputPath));
  });
}

module.exports = routes;
