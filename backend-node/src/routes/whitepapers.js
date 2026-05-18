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
const { renderPdf } = require('../lib/pdf');
const { assertRead, assertWrite } = require('../lib/af-permissions');
const log = require('../lib/logger').system;

const LAYOUTS = ['book', 'single-page'];
const STATUSES = ['draft', 'published'];

const AUDIENCE_LABELS = {
  property_manager: 'Property manager',
  asset_manager: 'Asset manager',
  moa_moe: 'MOA / MOE / BE',
  exploitant: 'Exploitant',
};

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
    companion_count: row.companion_count ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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

  // ─── Export PDF ────────────────────────────────────────────────────
  fastify.get('/whitepapers/:id/export/pdf', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.afs.getById(id);
    if (!row || row.kind !== 'whitepaper' || row.deleted_at) {
      return reply.code(404).send({ detail: 'Livre blanc introuvable' });
    }
    if (!assertRead(request, reply, id)) return;

    const chapters = db.sections.listByAf(id)
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(c => ({ title: c.title, body_html: c.body_html || '<p></p>' }));

    if (!chapters.length) {
      return reply.code(400).send({ detail: 'Ajoutez au moins un chapitre avant d\'exporter' });
    }

    let meta = {};
    try { meta = row.wp_meta_json ? JSON.parse(row.wp_meta_json) : {}; } catch { meta = {}; }

    const data = {
      title: row.title,
      subtitle: meta.subtitle || null,
      version: row.wp_version || null,
      audienceLabel: AUDIENCE_LABELS[row.wp_audience] || null,
      dateLabel: new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      chapters,
    };

    const outDir = path.join(path.resolve(config.exportsDir), String(id));
    fs.mkdirSync(outDir, { recursive: true });
    const outputPath = path.join(outDir, `whitepaper-${Date.now()}.pdf`);

    const isSinglePage = row.wp_layout === 'single-page';
    let result;
    try {
      result = await renderPdf({
        template: isSinglePage ? 'whitepaper-singlepage' : 'whitepaper-book',
        styles: isSinglePage ? 'styles-whitepaper' : ['styles-whitepaper', 'styles-whitepaper-book'],
        data,
        outputPath,
        pageFormat: 'A4',
        coverFullBleed: !isSinglePage,
      });
    } catch (err) {
      log.error(`PDF whitepaper render failed: ${err.message}`);
      return reply.code(502).send({ detail: `Échec de la génération PDF : ${err.message}` });
    }

    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'whitepaper.export.pdf',
      payload: { chapters: chapters.length, size: result.sizeBytes },
    });

    const buffer = fs.readFileSync(result.path);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${row.slug || 'livre-blanc'}.pdf"`);
    return reply.send(buffer);
  });
}

module.exports = routes;
