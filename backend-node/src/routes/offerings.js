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
const { renderPdf, renderHtml, buildHeaderFooter, loadAssetDataUrl, loadFileAsDataUrl } = require('../lib/pdf');
const { uploadWhitepaperPdf } = require('../lib/whitepaper-ftp');
const { ensureTracker, ingestClicks } = require('../lib/whitepaper-tracker');

// Slugs des PDFs offerings (sans extension). Utilisé pour le tracker
// /dl/<slug> et les statistiques de téléchargement.
const OFFERINGS_SLUGS = {
  catalog: 'tableau-des-offres-buildy',
  brochure: 'brochure-fonctionnalites-buildy',
};

// Filigrane Buildy (favicon en gris pale) — meme constante que les
// autres PDF (cf routes/export.js).
const WATERMARK_PATH = path.resolve(__dirname, '../../templates/pdf/assets/watermark-buildy.png');
const BUILDY_WATERMARK = { imagePath: WATERMARK_PATH, widthRatio: 0.85, heightRatio: 0.85, opacity: 0.03 };

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
    SELECT id, title, icon_name, parent_template_id, position, is_functionality,
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
      const ae = node.avail_e || 'unavailable';
      const as = node.avail_s || 'unavailable';
      const ap = node.avail_p || 'unavailable';
      // Si toutes les dispos sont 'paid_option' -> feature 100% optionnelle,
      // on l'identifie pour afficher un badge "+ OPTION PAYANTE" a cote
      // du titre. Note : la valeur en DB est 'paid_option' (pas 'option').
      const allOption = ae === 'paid_option' && as === 'paid_option' && ap === 'paid_option';
      rows.push({
        kind: 'feature',
        depth: visualDepth,
        id: node.id,            // permet le wrap <a href="#toc-feature-{id}"> en brochure
        title: node.title,
        icon_name: node.icon_name || null,
        avail_e: ae,
        avail_s: as,
        avail_p: ap,
        all_option: allOption,
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

  const colspan = levels.length + 1;
  return {
    // Top-level (legacy : utilise par offering-catalog.hbs en direct)
    rows,
    levels,
    colspan,
    totalFeatures: features.length,
    // Sous-objet `offeringsTable` partage avec brochure : permet au partial
    // _offerings-page.hbs d'utiliser la meme structure dans les 2 templates.
    offeringsTable: { rows, levels, colspan },
    coverPromise,
    coverSubtitle,
    ctaTitle,
    ctaSub,
    ctaContact,
    exportDate,
    year,
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    // Pour le partial _buildy-back-cover (logo blanc wordmark, version,
    // dateLabel). version = year (catalogue versionné à l'année).
    logoWhiteDataUrl: loadAssetDataUrl('logo-buildy-white.png'),
    version: String(year),
    dateLabel: exportDate,
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

// Sanitize body_html pour rendu dans la brochure :
//  - retire <aside>...</aside> (souvent un encart "Cette fonctionnalité
//    est incluse dans Smart et Premium..." rentre directement dans le
//    body_html, qui peut CONTREDIRE la matrice E/S/P actuelle si avail_*
//    a evolue. La brochure regenere le recap automatiquement).
//  - retire <blockquote class="callout">...</blockquote> idem.
//  - retire les <p> vides Tiptap.
function cleanBodyHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<blockquote\b[^>]*?(?:class="[^"]*callout[^"]*"|data-callout)[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '')
    .trim();
}

// Libelle clair de disponibilite par niveau, texte court pour tenir
// dans la cellule a cote de l'icone (cf brochure).
function availabilityLabel(avail) {
  if (avail === 'included') return 'Inclus';
  if (avail === 'paid_option') return 'Option';
  return 'Indispo.';
}
function availabilityIcon(avail) {
  if (avail === 'included') return '✓';
  if (avail === 'paid_option') return '€';
  return '✗';
}

/**
 * Brochure commerciale Buildy : groupement par categorie racine + detail
 * de chaque fonctionnalite (description courte extraite du body_html).
 * Diffère du catalog (matrice E/S/P plate) par son format narratif/marketing.
 */
async function buildBrochureData() {
  const allTemplates = db.db.prepare(`
    SELECT id, slug, title, body_html, bacs_articles, icon_name, parent_template_id, position,
           is_functionality, service_level, avail_e, avail_s, avail_p
    FROM section_templates
    ORDER BY position, id
  `).all();
  const byId = new Map(allTemplates.map(t => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_template_id ? byId.get(node.parent_template_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortKids = (n) => {
    n.children.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.id - b.id);
    n.children.forEach(sortKids);
  };
  roots.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.id - b.id);
  roots.forEach(sortKids);

  const hasFeatureDescendant = (n) => n.is_functionality || n.children.some(hasFeatureDescendant);

  // Charge les captures d'ecran d'un section_template (ASYNC car
  // loadFileAsDataUrl appelle sharp pour optimiser les images) :
  //  1. Attachments directement attaches au template (data/attachments/_tpl/section/)
  //  2. Heritage : attachments des sections AF qui utilisent ce template
  //     (data/attachments/<af_id>/) — utile car peu de captures sont
  //     remontees au niveau template, la majorite est sur les sections.
  // Deduplique par filename. Embed en data URL pour autonomie du PDF.
  async function loadScreenshots(templateId) {
    const direct = db.attachments.listBySectionTemplate(templateId).map(a => ({
      ...a, _origin: 'template',
    }));
    const fromAfSections = db.db.prepare(`
      SELECT a.*, s.af_id FROM attachments a
      JOIN sections s ON s.id = a.section_id
      WHERE s.section_template_id = ?
      ORDER BY a.position, a.id
    `).all(templateId).map(a => ({ ...a, _origin: 'af-section' }));
    const seen = new Set();
    const merged = [...direct, ...fromAfSections].filter(a => {
      if (seen.has(a.filename)) return false;
      seen.add(a.filename);
      return true;
    });
    const out = [];
    for (const att of merged) {
      const absPath = att._origin === 'template'
        ? path.resolve(config.attachmentsDir, '_tpl', 'section', att.filename)
        : path.resolve(config.attachmentsDir, String(att.af_id || ''), att.filename);
      try {
        const dataUrl = await loadFileAsDataUrl(absPath);
        out.push({
          dataUrl,
          caption: att.caption || '',
          width: att.width,
          height: att.height,
          full_width: att.full_width === 1,
        });
      } catch (err) {
        log.warn(`Brochure : impossible de charger ${att.filename} (${att._origin}) : ${err.message}`);
      }
    }
    return out;
  }

  async function collectFeatures(node, out = [], depth = 0) {
    if (node.is_functionality) {
      const ae = node.avail_e || 'unavailable';
      const as = node.avail_s || 'unavailable';
      const ap = node.avail_p || 'unavailable';
      const cleanedBody = cleanBodyHtml(node.body_html);
      const screenshots = await loadScreenshots(node.id);
      out.push({
        id: node.id,
        slug: node.slug,
        title: node.title,
        body_html: cleanedBody,
        has_body: !!cleanedBody,
        bacs_articles: node.bacs_articles || null,
        icon_name: node.icon_name || null,
        service_level: node.service_level,
        avail_e: ae, avail_s: as, avail_p: ap,
        avail_e_label: availabilityLabel(ae),
        avail_s_label: availabilityLabel(as),
        avail_p_label: availabilityLabel(ap),
        avail_e_icon: availabilityIcon(ae),
        avail_s_icon: availabilityIcon(as),
        avail_p_icon: availabilityIcon(ap),
        all_option: ae === 'paid_option' && as === 'paid_option' && ap === 'paid_option',
        screenshots,
        has_screenshots: screenshots.length > 0,
        depth,
      });
      depth++;
    }
    for (const c of node.children) await collectFeatures(c, out, depth);
    return out;
  }

  // Categories = racines avec au moins une feature dans la descendance.
  // Pour chaque, on liste toutes ses features (aplaties).
  const categories = [];
  for (const r of roots.filter(hasFeatureDescendant)) {
    const features = await collectFeatures(r);
    if (features.length > 0) {
      categories.push({ id: r.id, title: r.title, features });
    }
  }

  const features = allTemplates.filter(t => t.is_functionality);
  const levels = db.offeringLevels.list();

  // Boilerplate (reutilise les memes textes que le catalog pour cohérence).
  const coverPromise = stripWrapperParagraph(getBoilerplate('offerings_cover_promise'));
  const coverSubtitle = stripWrapperParagraph(getBoilerplate('offerings_cover_subtitle'));
  const ctaTitle = stripWrapperParagraph(getBoilerplate('offerings_cta_title', 'Vous avez un projet ?'));
  const ctaSub = stripWrapperParagraph(getBoilerplate('offerings_cta_sub', 'On vous accompagne pour cadrer votre supervision et choisir le bon niveau d\'offre.'));
  const ctaContact = stripWrapperParagraph(getBoilerplate('offerings_cta_contact', 'commercial@buildy.fr'));

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const year = new Date().getFullYear();

  // Reutilise les rows + colspan + levels de la matrice E/S/P du
  // catalog d'offres pour le partial _offerings-table.hbs (mutualise).
  const offeringsData = buildOfferingsData();

  return {
    categories,
    levels,
    totalFeatures: features.length,
    totalCategories: categories.length,
    // Sous-contexte pour le partial _offerings-table : meme forme que
    // les data offering-catalog (levels, rows, colspan). Utilise via
    // {{#with offeringsTable}}{{> _offerings-table}}{{/with}}.
    offeringsTable: {
      levels: offeringsData.levels,
      rows: offeringsData.rows,
      colspan: offeringsData.colspan,
    },
    coverPromise,
    coverSubtitle,
    ctaTitle,
    ctaSub,
    ctaContact,
    exportDate,
    year,
    logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    // Pour le partial _buildy-back-cover (logo blanc wordmark, version,
    // dateLabel). version = year (catalogue versionné à l'année).
    logoWhiteDataUrl: loadAssetDataUrl('logo-buildy-white.png'),
    version: String(year),
    dateLabel: exportDate,
  };
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
      styles: ['styles-offering-catalog', '_offerings-table'],
      data,
    });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // ─── Helpers mutualisés de rendu PDF ───────────────────────────────
  // SOURCE UNIQUE de la config renderPdf catalog/brochure : les 4 endpoints
  // (export + publish) × (catalog + brochure) passent OBLIGATOIREMENT par
  // ces 2 fonctions. Toute divergence (ex : oubli de backCoverFullBleed
  // côté publish) est désormais impossible.
  function _renderCatalogPdf({ data, outputPath }) {
    return renderPdf({
      template: 'offering-catalog',
      styles: ['styles-offering-catalog', '_offerings-table', '_buildy-back-cover'],
      data,
      outputPath,
      pageFormat: 'A4',
      coverFullBleed: true,
      backCoverFullBleed: true,
      pageMarginTopMm: 14,
      pageMarginBottomMm: 14,
      skipFirstPageHeaderFooter: true,
      pdfOptions: buildHeaderFooter({
        clientName: 'Buildy',
        projectName: 'Référentiel des fonctionnalités',
        docType: 'Catalogue',
        version: String(data.year),
        logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
        footerNote: 'Référentiel des fonctionnalités Buildy · document confidentiel',
        // Catalogue tient sur 2 pages (cover + table) — la numérotation
        // X/Y est superflue et alourdit visuellement le pied de page.
        hidePagination: true,
      }),
    });
  }

  function _renderBrochurePdf({ data, outputPath }) {
    return renderPdf({
      template: 'brochure',
      styles: ['styles-brochure', '_offerings-table', '_buildy-back-cover'],
      data,
      outputPath,
      pageFormat: 'A4',
      coverFullBleed: true,
      backCoverFullBleed: true,
      populateToc: true,
      pageMarginTopMm: 14,
      pageMarginBottomMm: 14,
      skipFirstPageHeaderFooter: true,
      watermark: { ...BUILDY_WATERMARK, skipFirstPage: true, opacity: 0.025 },
      pdfOptions: buildHeaderFooter({
        clientName: 'Buildy',
        projectName: 'Référentiel des fonctionnalités',
        docType: 'Brochure',
        version: String(data.year),
        logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
        footerNote: 'Référentiel des fonctionnalités Buildy · document confidentiel',
      }),
    });
  }

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
      result = await _renderCatalogPdf({ data, outputPath });
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

  // ─── Preview HTML brochure ─────────────────────────────────────────
  fastify.get('/offerings/brochure/preview', async (request, reply) => {
    const data = await buildBrochureData();
    const html = renderHtml({
      template: 'brochure',
      styles: ['styles-brochure', '_offerings-table'],
      data,
    });
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // ─── Export PDF brochure (format narratif/marketing) ───────────────
  fastify.post('/offerings/brochure-pdf', async (request, reply) => {
    const data = await buildBrochureData();
    const userId = request.authUser?.id;

    const exportsDir = path.resolve(config.exportsDir, '_offerings');
    fs.mkdirSync(exportsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `brochure-buildy-${data.year}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, filename);

    let result;
    try {
      result = await _renderBrochurePdf({ data, outputPath });
    } catch (err) {
      log.error(`Brochure PDF render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }

    db.auditLog.add({
      userId, action: 'export.brochure',
      payload: { file_size_bytes: result.sizeBytes, total_features: data.totalFeatures, total_categories: data.totalCategories },
    });
    log.info(`Brochure PDF exported: ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(fs.createReadStream(outputPath));
  });

  // ─── Publications FTP (catalog + brochure) ─────────────────────────
  // Régénère le PDF + l'envoie sur le FTP OVH avec un nom STABLE (sans
  // timestamp) pour que l'URL publique soit pérenne. Une republication
  // overwrite le fichier distant. État (URL + date + size) stocké dans
  // la table published_offerings (1 ligne par kind).
  async function _publishToFtp({ kind, filename, generate, request, reply }) {
    const userId = request.authUser?.id;
    let gen;
    try { gen = await generate(); }
    catch (err) {
      log.error(`Publish ${kind} render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Échec de la génération PDF : ${err.message}` });
    }
    let upload;
    try { upload = await uploadWhitepaperPdf(gen.path, filename); }
    catch (err) {
      log.error(`Publish ${kind} FTP failed: ${err.message}`);
      return reply.code(502).send({ detail: `Échec de l'envoi vers le FTP : ${err.message}` });
    }
    // Publie/refresh le redirecteur traçable /dl/<slug> (best-effort).
    try { await ensureTracker(); }
    catch (err) { log.warn(`Publish ${kind} — tracker KO : ${err.message}`); }

    // URL exposée = lien traçable /dl/<slug> (URL stable même si on
    // change le nom du PDF distant). Les clics sont comptés à chaque
    // GET du tracker PHP (cf. ingestClicks() pour stats).
    const slug = OFFERINGS_SLUGS[kind];
    const trackerUrl = `${config.wpTrackerPublicBase}/${slug}`;
    const row = db.publishedOfferings.upsert({
      kind, filename: upload.filename, url: trackerUrl, sizeBytes: upload.size, publishedBy: userId,
    });
    db.auditLog.add({
      userId, action: `offerings.publish.${kind}`,
      payload: { url: trackerUrl, ftp_url: upload.url, size: upload.size },
    });
    return row;
  }

  fastify.post('/offerings/publish', async (request, reply) => {
    return _publishToFtp({
      kind: 'catalog',
      filename: 'tableau-des-offres-buildy.pdf',
      generate: async () => {
        const data = buildOfferingsData();
        const exportsDir = path.resolve(config.exportsDir, '_offerings');
        fs.mkdirSync(exportsDir, { recursive: true });
        const outputPath = path.join(exportsDir, `publish-catalog-${Date.now()}.pdf`);
        return await _renderCatalogPdf({ data, outputPath });
      },
      request, reply,
    });
  });

  fastify.post('/offerings/brochure/publish', async (request, reply) => {
    return _publishToFtp({
      kind: 'brochure',
      filename: 'brochure-fonctionnalites-buildy.pdf',
      generate: async () => {
        const data = await buildBrochureData();
        const exportsDir = path.resolve(config.exportsDir, '_offerings');
        fs.mkdirSync(exportsDir, { recursive: true });
        const outputPath = path.join(exportsDir, `publish-brochure-${Date.now()}.pdf`);
        return await _renderBrochurePdf({ data, outputPath });
      },
      request, reply,
    });
  });

  // État des publications (URL + date + taille) — affiché dans la UI.
  fastify.get('/offerings/publish-info', async () => db.publishedOfferings.list());

  // Statistiques de clics du lien /dl/<slug> (catalog ou brochure).
  // Mêmes données que les whitepapers, vue par slug.
  fastify.get('/offerings/clicks', async (request, reply) => {
    const kind = request.query.kind;
    const slug = OFFERINGS_SLUGS[kind];
    if (!slug) return reply.code(400).send({ detail: 'kind invalide (catalog | brochure)' });
    return db.whitepaperClicks.statsForSlug(slug);
  });

  // Ingestion FTP des hits.log → DB (idempotent). Bouton « Rafraîchir »
  // dans la UI. Réutilise le même tracker que les whitepapers.
  fastify.post('/offerings/clicks/refresh', async (request, reply) => {
    try {
      const result = await ingestClicks();
      log.info(`Offerings clicks refresh: ${result.newRows} nouveaux clics (sur ${result.lines} lignes)`);
      return result;
    } catch (err) {
      log.error(`Offerings clicks refresh failed: ${err.message}`);
      return reply.code(502).send({ detail: `Rafraîchissement KO : ${err.message}` });
    }
  });
}

module.exports = routes;
