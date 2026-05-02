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

  // 3. Construit une liste plate "rows" qui interleave les rangees de
  // categorie (a chaque changement d'ancetre dans la chaine) et les
  // rangees de feature. La profondeur d'ancetres est arbitraire : on
  // affiche autant de niveaux que la base contient.
  const rows = [];
  const lastChain = []; // chaine d'ancetres de la rangee precedente

  for (const f of features) {
    const chain = ancestorsOf(f);
    // Trouve l'index ou la chaine actuelle commence a differer de la
    // chaine precedente. Tout ce qui est "pareil" jusqu'a cet index
    // n'a pas besoin de re-emettre une rangee de categorie.
    let firstChange = 0;
    while (
      firstChange < chain.length &&
      firstChange < lastChain.length &&
      chain[firstChange].id === lastChain[firstChange].id
    ) firstChange++;
    // Emets une rangee categorie pour chaque ancetre a partir du 1er
    // changement.
    for (let depth = firstChange; depth < chain.length; depth++) {
      rows.push({
        kind: 'category',
        depth,
        title: chain[depth].title,
      });
    }
    rows.push({
      kind: 'feature',
      depth: chain.length,
      title: f.title,
      avail_e: f.avail_e || 'unavailable',
      avail_s: f.avail_s || 'unavailable',
      avail_p: f.avail_p || 'unavailable',
    });
    // Met a jour la chaine pour la prochaine iteration
    lastChain.length = 0;
    lastChain.push(...chain);
  }

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
