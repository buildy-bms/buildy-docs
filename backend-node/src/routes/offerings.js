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
//
// Hierarchie : section_templates utilise parent_template_id pour former
// un arbre. Une fonctionnalite peut avoir plusieurs niveaux de parents
// (ex: "Detection des derives" -> parent "Tableaux de bord energetiques"
// -> parent "Application Hyperveez"). On affiche jusqu'a 2 niveaux de
// regroupement dans le tableau (parent + sous-parent).
function buildOfferingsData() {
  // 1. Recupere TOUS les section_templates (pas juste les features)
  // pour pouvoir resoudre la chaine d'ancetres.
  const allTemplates = db.db.prepare(`
    SELECT id, title, parent_template_id, position, is_functionality
    FROM section_templates
    ORDER BY position, id
  `).all();
  const byId = new Map(allTemplates.map(t => [t.id, t]));

  // Resout la chaine d'ancetres pour un node donne (du plus haut au
  // plus proche, hors le node lui-meme).
  function ancestorsOf(node) {
    const chain = [];
    let cur = node.parent_template_id ? byId.get(node.parent_template_id) : null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_template_id ? byId.get(cur.parent_template_id) : null;
    }
    return chain;
  }

  // 2. Recupere les fonctionnalites avec disponibilites
  const features = db.db.prepare(`
    SELECT id, slug, title, body_html, service_level,
           avail_e, avail_s, avail_p, position, parent_template_id
    FROM section_templates
    WHERE is_functionality = 1
    ORDER BY position, id
  `).all();

  // 3. Groupe par chaîne d'ancêtres (concatenation des ids = clef unique)
  // On affiche : 1er ancetre = "categorie principale" (en gros), 2eme
  // ancetre = "sous-categorie" (en sub-header). Si une feature n'a qu'un
  // seul ancetre, on n'affiche que la categorie principale.
  const groups = new Map();
  for (const f of features) {
    const ancestors = ancestorsOf(f);
    const top = ancestors[0] || null;
    const sub = ancestors.length >= 2 ? ancestors[ancestors.length - 1] : null;
    const topKey = top ? `t${top.id}` : 'orphan';
    const subKey = sub ? `s${sub.id}` : 'none';

    if (!groups.has(topKey)) {
      groups.set(topKey, {
        id: top?.id || null,
        title: top?.title || 'Autres fonctionnalités',
        position: top?.position ?? 9999,
        subgroups: new Map(),
      });
    }
    const topGroup = groups.get(topKey);
    if (!topGroup.subgroups.has(subKey)) {
      topGroup.subgroups.set(subKey, {
        id: sub?.id || null,
        title: sub?.title || null, // null = pas de sous-categorie
        position: sub?.position ?? 0,
        features: [],
      });
    }
    topGroup.subgroups.get(subKey).features.push({
      id: f.id,
      title: f.title,
      avail_e: f.avail_e || 'unavailable',
      avail_s: f.avail_s || 'unavailable',
      avail_p: f.avail_p || 'unavailable',
    });
  }

  // 4. Conversion en arrays tries
  const categories = [...groups.values()]
    .map(g => ({
      ...g,
      subgroups: [...g.subgroups.values()].sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => a.position - b.position);

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const year = new Date().getFullYear();

  return {
    categories,
    totalFeatures: features.length,
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
