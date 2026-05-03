'use strict';

// Catalogue des offres Buildy — PDF "Offres 2026" qui se regenere depuis
// la table section_templates (is_functionality = 1) avec la matrice de
// disponibilite avail_e / avail_s / avail_p par niveau de service.
//
// Hierarchie : chaque fonctionnalite a un parent_template_id qui pointe
// vers une section type parente. La chaine d'ancetres est resolue
// jusqu'a la racine (profondeur infinie) et affichee avec indentation
// cumulative dans le tableau.
//
// Niveaux d'offre (E/S/P) : nom + tagline + decoy editables via la table
// offering_levels (page admin /admin/offerings-config).
// Textes cover et CTA : pdf_boilerplate kinds 'offerings_*'.

const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { renderPdf, renderHtml, loadAssetDataUrl } = require('../lib/pdf');

// Lit un boilerplate par kind (texte editable depuis pdf_boilerplate).
// Retourne le body_html du 1er actif, ou la valeur par defaut si absent.
function getBoilerplate(kind, defaultHtml = '') {
  const row = db.pdfBoilerplate.list({ kind })[0];
  return row?.body_html || defaultHtml;
}

function buildOfferingsData() {
  // 1. Recupere TOUS les section_templates pour construire l'arbre.
  // On garde tous les noeuds qui sont :
  //   - des features (is_functionality = 1)
  //   - OU des ancetres de features (categories de regroupement)
  const allTemplates = db.db.prepare(`
    SELECT id, title, parent_template_id, position, is_functionality,
           avail_e, avail_s, avail_p
    FROM section_templates
    ORDER BY position, id
  `).all();
  const byId = new Map(allTemplates.map(t => [t.id, { ...t, children: [] }]));

  // 2. Construit l'arbre : pour chaque node, ajoute-le aux enfants de
  // son parent. Les noeuds racine ont parent_template_id null.
  const roots = [];
  for (const node of byId.values()) {
    const parentNode = node.parent_template_id ? byId.get(node.parent_template_id) : null;
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }
  // Tri par position dans chaque niveau
  function sortChildren(node) {
    node.children.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.id - b.id);
    for (const c of node.children) sortChildren(c);
  }
  roots.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.id - b.id);
  for (const r of roots) sortChildren(r);

  // 3. Determine si un node a au moins une feature dans sa descendance
  //    (utile pour eluder les branches sans features).
  function hasFeatureDescendant(node) {
    if (node.is_functionality) return true;
    return node.children.some(hasFeatureDescendant);
  }

  // 4. DFS de l'arbre pour generer les rows :
  //   - Un node non-feature qui a des descendants features est emis
  //     comme une CATEGORY row (bandeau indigo). Sa depth_visual est
  //     la profondeur depuis la racine non-feature.
  //   - Un node feature est emis comme une FEATURE row avec ses
  //     dispos E/S/P. Sa depth_visual = depth de sa categorie ancetre
  //     la plus proche + 1 + nb d'ancetres features.
  //   - On ne re-emit pas une categorie si elle n'a pas d'enfant.
  //
  // Convention indentation visuelle :
  //   - depth 0 : categorie racine (bandeau plein indigo)
  //   - depth 1+ : sous-categorie ou feature indentee
  const rows = [];
  function emit(node, visualDepth) {
    if (!hasFeatureDescendant(node)) return; // skip branches sans features

    if (node.is_functionality) {
      rows.push({
        kind: 'feature',
        depth: visualDepth,
        title: node.title,
        avail_e: node.avail_e || 'unavailable',
        avail_s: node.avail_s || 'unavailable',
        avail_p: node.avail_p || 'unavailable',
      });
      // Une feature peut avoir des features enfants -> on les emit indentes
      for (const child of node.children) emit(child, visualDepth + 1);
    } else {
      // Categorie de regroupement : emit la category row + recurse
      rows.push({
        kind: 'category',
        depth: visualDepth,
        title: node.title,
      });
      for (const child of node.children) emit(child, visualDepth + 1);
    }
  }
  for (const r of roots) emit(r, 0);

  const features = allTemplates.filter(t => t.is_functionality);

  // 4. Niveaux d'offre depuis la DB
  const levels = db.offeringLevels.list();

  // 5. Boilerplate cover et CTA
  const coverPromise = stripWrapperParagraph(getBoilerplate('offerings_cover_promise'));
  const coverSubtitle = stripWrapperParagraph(getBoilerplate('offerings_cover_subtitle'));
  const ctaTitle = stripWrapperParagraph(getBoilerplate('offerings_cta_title'));
  const ctaSub = stripWrapperParagraph(getBoilerplate('offerings_cta_sub'));
  const ctaContact = stripWrapperParagraph(getBoilerplate('offerings_cta_contact'));

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const year = new Date().getFullYear();

  return {
    rows,
    levels,
    colspan: levels.length + 1, // pour les rows de categorie (td colspan)
    totalFeatures: features.length,
    coverPromise,
    coverSubtitle,
    ctaTitle,
    ctaSub,
    ctaContact,
    exportDate,
    year,
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
  };
}

// Retire le <p> wrapper que Tiptap ajoute autour des contenus simples
// pour pouvoir injecter directement dans un h1/p personnalise du
// template sans avoir un <p> dans un <h1>.
function stripWrapperParagraph(html) {
  if (!html) return '';
  const trimmed = html.trim();
  const m = /^<p>([\s\S]*)<\/p>$/.exec(trimmed);
  return m ? m[1] : html;
}

async function routes(fastify) {
  // ─── Niveaux d'offre (E/S/P) admin ────────────────────────────────
  fastify.get('/offering-levels', async () => {
    return db.offeringLevels.list();
  });
  fastify.patch('/offering-levels/:slug', async (request, reply) => {
    const slug = request.params.slug;
    const existing = db.offeringLevels.getBySlug(slug);
    if (!existing) return reply.code(404).send({ detail: 'Niveau non trouvé' });
    const body = request.body || {};
    const updated = db.offeringLevels.update(slug, {
      name: body.name,
      tagline: body.tagline,
      isHighlighted: body.is_highlighted,
      highlightLabel: body.highlight_label,
      colorHex: body.color_hex,
      updatedBy: request.authUser?.id || null,
    });
    db.auditLog.add({
      userId: request.authUser?.id, action: 'offering_level.update',
      payload: { slug, fields: Object.keys(body) },
    });
    return updated;
  });

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

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(fs.createReadStream(outputPath));
  });
}

module.exports = routes;
