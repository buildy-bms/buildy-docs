'use strict';

// Routes livres blancs (Lot Marketing — mig 140).
//
// Un livre blanc est un document `afs` avec `kind = 'whitepaper'`.
//   - parent_af_id IS NULL  -> livre blanc principal (wp_layout = 'book')
//   - parent_af_id = <id>   -> document compagnon (wp_layout = 'single-page')
//
// Les chapitres reutilisent la table `sections` (af_id = id du livre blanc,
// kind = 'standard', arborescence plate : parent_id NULL). Edition Tiptap
// via body_html. Metadonnees des pages structurelles (cover, pivot, 4e de
// couv) dans wp_meta_json (JSON).

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const db = require('../database');
const config = require('../config');
const { uniqueSlug } = require('../lib/slug');
const { renderPdf, renderRawHtmlPdf, renderHtml, buildHeaderFooter, loadAssetDataUrl } = require('../lib/pdf');
const { uploadWhitepaperPdf } = require('../lib/whitepaper-ftp');
const { ensureTracker, ingestClicks } = require('../lib/whitepaper-tracker');
const { assertRead, assertWrite } = require('../lib/af-permissions');
const log = require('../lib/logger').system;

// Racine de stockage des livres blancs « HTML brut » (mode coffre) :
// data/whitepaper-sources/<id>/source.html + assets/. Le HTML est edite
// hors-app (IDE) et rendu tel quel — PDF fidele au pixel.
const WP_SOURCES_ROOT = path.join(path.dirname(path.resolve(config.exportsDir)), 'whitepaper-sources');
function wpSourceDir(id) { return path.join(WP_SOURCES_ROOT, String(id)); }
function wpSourceHtml(id) { return path.join(wpSourceDir(id), 'source.html'); }

const LAYOUTS = ['book', 'single-page'];
const STATUSES = ['draft', 'published'];

const AUDIENCE_LABELS = {
  property_manager: 'Property manager',
  asset_manager: 'Asset manager',
  moa_moe: 'MOA / MOE / BE',
  exploitant: 'Exploitant',
};

// Résout un URL meta.cover_image_url qui peut être :
//   - null / vide → null
//   - 'wp-asset:<filename>' → data URL embed depuis templates/pdf/assets/
//     (Puppeteer-friendly, pas de fetch réseau pendant le rendu)
//   - 'http(s)://...' ou 'data:...' → renvoie tel quel
function resolveWpAssetUrl(url) {
  if (!url) return null;
  if (url.startsWith('wp-asset:')) {
    const filename = url.slice('wp-asset:'.length);
    try { return loadAssetDataUrl(filename); }
    catch (e) {
      log.warn(`wp-asset introuvable : ${filename}`);
      return null;
    }
  }
  return url;
}

const createSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  layout: z.enum(LAYOUTS).optional(),
  audience: z.string().nullable().optional(),
  parent_af_id: z.number().int().nullable().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(STATUSES).optional(),
  audience: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  slug: z.string().min(1).optional(),
  layout: z.enum(LAYOUTS).optional(),
  meta: z.record(z.any()).nullable().optional(),
});

const chapterCreateSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  position: z.number().int().optional(),
  body_html: z.string().nullable().optional(),
});

const chapterPatchSchema = z.object({
  title: z.string().min(1).optional(),
  body_html: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

// Serialise un row `afs` whitepaper vers la forme exposee a l'UI.
function toWhitepaper(row) {
  if (!row) return null;
  let meta = {};
  try { meta = row.wp_meta_json ? JSON.parse(row.wp_meta_json) : {}; } catch { meta = {}; }
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    layout: row.wp_layout || 'book',
    audience: row.wp_audience || null,
    version: row.wp_version || null,
    parent_af_id: row.parent_af_id || null,
    meta,
    tracker_url: row.slug ? `${config.wpTrackerPublicBase}/${row.slug}` : null,
    companion_count: row.companion_count ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Genere le PDF d'un livre blanc (mode coffre HTML ou mode chapitres) et
// renvoie { path, sizeBytes, mode }. Les erreurs « metier » (pas de source,
// pas de chapitre) portent err.clientStatus = 400.
async function generateWhitepaperPdf(row) {
  const id = row.id;
  let meta = {};
  try { meta = row.wp_meta_json ? JSON.parse(row.wp_meta_json) : {}; } catch { meta = {}; }

  const outDir = path.join(path.resolve(config.exportsDir), String(id));
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `whitepaper-${Date.now()}.pdf`);

  // ── Mode « HTML brut » (coffre) : rendu fidele au pixel ───────────
  if (meta.mode === 'html') {
    const htmlPath = wpSourceHtml(id);
    if (!fs.existsSync(htmlPath)) {
      const e = new Error('Aucun fichier HTML source pour ce livre blanc');
      e.clientStatus = 400;
      throw e;
    }
    const result = await renderRawHtmlPdf({ htmlPath, outputPath });
    return { path: result.path, sizeBytes: result.sizeBytes, mode: 'html', meta };
  }

  // ── Mode « chapitres » (Tiptap + template flux naturel) ───────────
  const rawChapters = db.sections.listByAf(id)
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  if (!rawChapters.length) {
    const e = new Error("Ajoutez au moins un chapitre avant d'exporter");
    e.clientStatus = 400;
    throw e;
  }
  // Convention : si meta.has_back_cover === true, le DERNIER chapitre est
  // rendu comme back-cover navy plein-bord (CTA marketing). Sinon tous les
  // chapitres sont des pages claires standard.
  const hasBackCover = meta.has_back_cover === true;
  const chapters = rawChapters.map((c, idx) => ({
    title: c.title,
    body_html: c.body_html || '<p></p>',
    is_back_cover: hasBackCover && idx === rawChapters.length - 1,
  }));

  const data = {
    title: row.title,
    subtitle: meta.subtitle || null,
    version: row.wp_version || null,
    audienceLabel: AUDIENCE_LABELS[row.wp_audience] || null,
    dateLabel: new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    chapters,
    coverImageUrl: resolveWpAssetUrl(meta.cover_image_url),
    coverImageCaption: meta.cover_image_caption || null,
    hasBackCover,
    logoWhiteDataUrl: loadAssetDataUrl('logo-buildy-blanc.png'),
  };
  const isSinglePage = row.wp_layout === 'single-page';
  const result = await renderPdf({
    template: isSinglePage ? 'whitepaper-singlepage' : 'whitepaper-book',
    styles: isSinglePage ? 'styles-whitepaper' : ['styles-whitepaper', 'styles-whitepaper-book'],
    data,
    outputPath,
    pageFormat: 'A4',
    coverFullBleed: !isSinglePage,
    // Back-cover navy plein-bord : re-rendu de la dernière page sans
    // margin Puppeteer (vraie page edge-to-edge, pas juste un mask top/bot).
    backCoverFullBleed: !isSinglePage && hasBackCover,
    // Header/footer Buildy unifié (logo en footer + pagination).
    pdfOptions: isSinglePage ? undefined : buildHeaderFooter({
      clientName: 'Buildy',
      projectName: row.title,
      docType: 'Livre blanc',
      version: row.wp_version || '1.0',
      logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
      footerNote: `Livre blanc Buildy · ${row.title}`,
    }),
  });
  return { path: result.path, sizeBytes: result.sizeBytes, mode: 'chapters', meta };
}

async function routes(fastify) {
  // ─── Liste des livres blancs (parents uniquement) ──────────────────
  fastify.get('/whitepapers', async () => {
    return db.afs.listWhitepapers().map(toWhitepaper);
  });

  // ─── Creation d'un livre blanc ou d'un compagnon ───────────────────
  fastify.post('/whitepapers', async (request, reply) => {
    let body;
    try { body = createSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    // Compagnon : valider le parent
    let parentId = body.parent_af_id ?? null;
    let layout = body.layout || 'book';
    if (parentId != null) {
      const parent = db.afs.getById(parentId);
      if (!parent || parent.kind !== 'whitepaper' || parent.deleted_at) {
        return reply.code(404).send({ detail: 'Livre blanc parent introuvable' });
      }
      layout = body.layout || 'single-page';
    }

    const slug = uniqueSlug(body.title, (s) => !!db.afs.getBySlug(s));
    const userId = request.authUser?.id;

    const wp = db.afs.create({
      slug,
      clientName: 'Buildy',          // colonnes legacy NOT NULL : valeurs neutres
      projectName: body.title,
      kind: 'whitepaper',
      title: body.title,
      createdBy: userId,
    });
    db.afs.update(wp.id, {
      status: 'draft',
      wp_layout: layout,
      wp_audience: body.audience ?? null,
      wp_version: '1.0',
      parent_af_id: parentId,
      updatedBy: userId,
    });
    db.auditLog.add({
      afId: wp.id, userId,
      action: 'whitepaper.create',
      payload: { title: body.title, layout, parent_af_id: parentId },
    });
    return toWhitepaper(db.afs.getById(wp.id));
  });

  // ─── Detail d'un livre blanc + chapitres (light) + compagnons ──────
  fastify.get('/whitepapers/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;
    const wp = toWhitepaper(row);
    wp.chapters = db.sections.listByAfLight(id);
    wp.companions = row.parent_af_id ? [] : db.afs.listCompanions(id).map(toWhitepaper);
    return wp;
  });

  // ─── Mise a jour des metadonnees ───────────────────────────────────
  fastify.patch('/whitepapers/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertWrite(request, reply, id)) return;
    let body;
    try { body = patchSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    const patch = { updatedBy: request.authUser?.id };
    if (body.title !== undefined) patch.title = body.title;
    if (body.status !== undefined) patch.status = body.status;
    if (body.audience !== undefined) patch.wp_audience = body.audience;
    if (body.version !== undefined) patch.wp_version = body.version;
    if (body.layout !== undefined) patch.wp_layout = body.layout;
    if (body.meta !== undefined) patch.wp_meta_json = body.meta ? JSON.stringify(body.meta) : null;
    if (body.slug !== undefined) {
      const existing = db.afs.getBySlug(body.slug);
      if (existing && existing.id !== id) {
        return reply.code(409).send({ detail: 'Ce slug est deja utilise' });
      }
      patch.slug = body.slug;
    }
    db.afs.update(id, patch);
    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.update', payload: { fields: Object.keys(body) },
    });
    return toWhitepaper(db.afs.getById(id));
  });

  // ─── Suppression (soft-delete) ─────────────────────────────────────
  fastify.delete('/whitepapers/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertWrite(request, reply, id)) return;
    // Cascade soft-delete des compagnons
    for (const c of db.afs.listCompanions(id)) db.afs.softDelete(c.id);
    db.afs.softDelete(id);
    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.delete', payload: { title: row.title },
    });
    return reply.code(204).send();
  });

  // ─── Chapitres : recuperer le corps d'un chapitre ──────────────────
  fastify.get('/whitepapers/:id/chapters/:chapterId', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const chapterId = parseInt(request.params.chapterId, 10);
    if (!assertRead(request, reply, id)) return;
    const chapter = db.sections.getById(chapterId);
    if (!chapter || chapter.af_id !== id) {
      return reply.code(404).send({ detail: 'Chapitre introuvable' });
    }
    return chapter;
  });

  // ─── Chapitres : ajout ─────────────────────────────────────────────
  fastify.post('/whitepapers/:id/chapters', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertWrite(request, reply, id)) return;
    let body;
    try { body = chapterCreateSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    let position = body.position;
    if (position == null) {
      const existing = db.sections.listByAfLight(id);
      position = existing.length ? Math.max(...existing.map(s => s.position || 0)) + 1 : 0;
    }
    const chapter = db.sections.create({
      afId: id, parentId: null, position,
      title: body.title, bodyHtml: body.body_html || null, kind: 'standard',
    });
    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.chapter.create', payload: { id: chapter.id, title: body.title },
    });
    return chapter;
  });

  // ─── Chapitres : edition ───────────────────────────────────────────
  fastify.patch('/whitepapers/:id/chapters/:chapterId', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const chapterId = parseInt(request.params.chapterId, 10);
    if (!assertWrite(request, reply, id)) return;
    const chapter = db.sections.getById(chapterId);
    if (!chapter || chapter.af_id !== id) {
      return reply.code(404).send({ detail: 'Chapitre introuvable' });
    }
    let body;
    try { body = chapterPatchSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const updated = db.sections.update(chapterId, {
      title: body.title, bodyHtml: body.body_html, position: body.position,
      updatedBy: request.authUser?.id,
    });
    return updated;
  });

  // ─── Chapitres : suppression ───────────────────────────────────────
  fastify.delete('/whitepapers/:id/chapters/:chapterId', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const chapterId = parseInt(request.params.chapterId, 10);
    if (!assertWrite(request, reply, id)) return;
    const chapter = db.sections.getById(chapterId);
    if (!chapter || chapter.af_id !== id) {
      return reply.code(404).send({ detail: 'Chapitre introuvable' });
    }
    db.sections.delete(chapterId);
    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.chapter.delete', payload: { id: chapterId },
    });
    return reply.code(204).send();
  });

  // ─── Chapitres : reordonnancement (haut / bas) ─────────────────────
  fastify.post('/whitepapers/:id/chapters/:chapterId/move', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const chapterId = parseInt(request.params.chapterId, 10);
    if (!assertWrite(request, reply, id)) return;
    const chapter = db.sections.getById(chapterId);
    if (!chapter || chapter.af_id !== id) {
      return reply.code(404).send({ detail: 'Chapitre introuvable' });
    }
    const direction = request.body?.direction;
    if (!['up', 'down'].includes(direction)) {
      return reply.code(400).send({ detail: 'direction invalide (up|down)' });
    }
    db.sections.moveWithinSiblings(chapterId, direction);
    return db.sections.listByAfLight(id);
  });

  // ─── Preview HTML (hot-reloadable, itération design) ─────────────
  // Rend le même HTML que celui passé à Puppeteer, mais directement dans
  // le navigateur (pas de PDF). Cmd+R pour voir les changements de
  // template/CSS sans regénérer Puppeteer (cycle ~30s). Pour la preview
  // PDF avec header/footer Buildy, garder l'export PDF classique.
  fastify.get('/whitepapers/:id/preview', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;

    let meta = {};
    try { meta = row.wp_meta_json ? JSON.parse(row.wp_meta_json) : {}; } catch { meta = {}; }

    // Mode HTML brut : redirige vers le source.html servi tel quel.
    if (meta.mode === 'html') {
      return reply.code(400).send({
        detail: 'Preview indisponible pour le mode HTML brut — utilisez /api/whitepapers/' + id + '/export/pdf',
      });
    }

    const rawChapters = db.sections.listByAf(id)
      .slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    if (!rawChapters.length) {
      return reply.code(400).send({ detail: 'Aucun chapitre à prévisualiser' });
    }
    const hasBackCover = meta.has_back_cover === true;
    const chapters = rawChapters.map((c, idx) => ({
      title: c.title,
      body_html: c.body_html || '<p></p>',
      is_back_cover: hasBackCover && idx === rawChapters.length - 1,
    }));

    const data = {
      title: row.title,
      subtitle: meta.subtitle || null,
      version: row.wp_version || null,
      audienceLabel: AUDIENCE_LABELS[row.wp_audience] || null,
      dateLabel: new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      chapters,
      coverImageUrl: resolveWpAssetUrl(meta.cover_image_url),
      coverImageCaption: meta.cover_image_caption || null,
      hasBackCover,
      logoWhiteDataUrl: loadAssetDataUrl('logo-buildy-blanc.png'),
    };
    const isSinglePage = row.wp_layout === 'single-page';
    const html = renderHtml({
      template: isSinglePage ? 'whitepaper-singlepage' : 'whitepaper-book',
      styles: isSinglePage ? 'styles-whitepaper' : ['styles-whitepaper', 'styles-whitepaper-book'],
      data,
      pageFormat: 'A4',
      fresh: true,
    });
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(html);
  });

  // ─── Aperçu PDF inline (ouvre dans le navigateur, pas de download) ─
  // Même rendu que /export/pdf mais Content-Disposition: inline pour que
  // le viewer PDF du navigateur s'ouvre directement. Pratique pour
  // itérer sur le design final via Cmd+R (recharge le PDF). Pour
  // l'itération CSS/template ultra-rapide sans Puppeteer, préférer
  // /preview qui rend du HTML pur.
  fastify.get('/whitepapers/:id/preview/pdf', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;
    let gen;
    try {
      gen = await generateWhitepaperPdf(row);
    } catch (err) {
      if (!err.clientStatus) log.error(`PDF whitepaper ${id} preview failed: ${err.message}`);
      return reply.code(err.clientStatus || 502).send({
        detail: err.clientStatus ? err.message : `Échec de la génération PDF : ${err.message}`,
      });
    }
    const buf = fs.readFileSync(gen.path);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${row.slug || 'livre-blanc'}.pdf"`);
    return reply.send(buf);
  });

  // ─── Export PDF ────────────────────────────────────────────────────
  fastify.get('/whitepapers/:id/export/pdf', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;

    let gen;
    try {
      gen = await generateWhitepaperPdf(row);
    } catch (err) {
      if (!err.clientStatus) log.error(`PDF whitepaper ${id} render failed: ${err.message}`);
      return reply.code(err.clientStatus || 502).send({
        detail: err.clientStatus ? err.message : `Échec de la génération PDF : ${err.message}`,
      });
    }

    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.export.pdf', payload: { mode: gen.mode, size: gen.sizeBytes },
    });
    const buf = fs.readFileSync(gen.path);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${row.slug || 'livre-blanc'}.pdf"`);
    return reply.send(buf);
  });

  // ─── Publication / mise a jour du PDF sur le FTP OVH buildy.fr ──────
  // Genere le PDF et l'envoie sur le FTP public. Le fichier prend le nom
  // du slug : l'URL publique est stable, une republication l'ecrase.
  fastify.post('/whitepapers/:id/publish', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertWrite(request, reply, id)) return;
    if (!row.slug) {
      return reply.code(400).send({ detail: 'Le livre blanc doit avoir un slug avant publication' });
    }

    let gen;
    try {
      gen = await generateWhitepaperPdf(row);
    } catch (err) {
      if (!err.clientStatus) log.error(`Publish whitepaper ${id} render failed: ${err.message}`);
      return reply.code(err.clientStatus || 502).send({
        detail: err.clientStatus ? err.message : `Échec de la génération PDF : ${err.message}`,
      });
    }

    let upload;
    try {
      upload = await uploadWhitepaperPdf(gen.path, `${row.slug}.pdf`);
    } catch (err) {
      log.error(`Publish whitepaper ${id} FTP failed: ${err.message}`);
      return reply.code(502).send({ detail: `Échec de l'envoi vers le FTP : ${err.message}` });
    }

    // Publie / rafraichit le redirecteur tracable /dl/<slug> (best-effort :
    // le PDF est deja en ligne, on ne fait pas echouer la publication).
    try { await ensureTracker(); }
    catch (err) { log.warn(`Publish whitepaper ${id} — tracker KO : ${err.message}`); }

    // Memorise l'etat de publication dans wp_meta_json + passe en 'published'.
    // L'URL exposee est le lien tracable /dl/<slug> (le PDF direct est
    // interdit d'acces) — c'est ce lien qu'on partage.
    const meta = gen.meta || {};
    meta.published = {
      url: `${config.wpTrackerPublicBase}/${row.slug}`,
      at: new Date().toISOString(),
      size: upload.size,
    };
    db.afs.update(id, {
      wp_meta_json: JSON.stringify(meta),
      status: 'published',
      updatedBy: request.authUser?.id,
    });
    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.publish', payload: { url: upload.url, size: upload.size },
    });
    return toWhitepaper(db.afs.getById(id));
  });

  // ─── Statistiques de clics du lien traçable ────────────────────────
  fastify.get('/whitepapers/:id/clicks', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;
    return db.whitepaperClicks.statsForAf(id);
  });

  // ─── Rafraichit les clics depuis le FTP (ingestion a la demande) ───
  fastify.post('/whitepapers/:id/clicks/refresh', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;
    try {
      await ingestClicks();
    } catch (err) {
      log.warn(`Refresh clics whitepaper ${id} KO : ${err.message}`);
      return reply.code(502).send({ detail: `Échec du rafraîchissement : ${err.message}` });
    }
    return db.whitepaperClicks.statsForAf(id);
  });

  // ─── HTML source (mode coffre) : consulter ─────────────────────────
  fastify.get('/whitepapers/:id/source-html', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;
    const htmlPath = wpSourceHtml(id);
    if (!fs.existsSync(htmlPath)) {
      return reply.code(404).send({ detail: 'Aucun HTML source' });
    }
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const stat = fs.statSync(htmlPath);
    return { size_bytes: stat.size, updated_at: stat.mtime.toISOString(), html };
  });

  // ─── HTML source (mode coffre) : remplacer ─────────────────────────
  // Upload multipart d'un fichier .html (edition hors-app, IDE).
  fastify.put('/whitepapers/:id/source-html', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertWrite(request, reply, id)) return;

    const file = await request.file();
    if (!file) return reply.code(400).send({ detail: 'Fichier HTML manquant' });
    const html = (await file.toBuffer()).toString('utf-8');
    if (!/<html[\s>]/i.test(html)) {
      return reply.code(400).send({ detail: 'Le fichier ne ressemble pas à un document HTML' });
    }
    fs.mkdirSync(wpSourceDir(id), { recursive: true });
    fs.writeFileSync(wpSourceHtml(id), html, 'utf-8');

    // Bascule le document en mode 'html' s'il ne l'etait pas encore.
    let meta = {};
    try { meta = row.wp_meta_json ? JSON.parse(row.wp_meta_json) : {}; } catch { meta = {}; }
    if (meta.mode !== 'html') {
      meta.mode = 'html';
      db.afs.update(id, { wp_meta_json: JSON.stringify(meta), updatedBy: request.authUser?.id });
    } else {
      db.afs.update(id, { updatedBy: request.authUser?.id }); // touch updated_at
    }
    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.source-html.replace', payload: { size: html.length },
    });
    return { ok: true, size_bytes: html.length };
  });
}

module.exports = routes;
