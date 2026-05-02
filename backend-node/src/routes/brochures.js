'use strict';

// Routes brochures (lot A2 — commerciale + catalogue d'offres).
//
// Une brochure est un document `afs` avec `kind = 'brochure'`. Elle
// contient une liste plate d'items (`brochure_items`) qui peuvent
// referencer un item de bibliotheque, un equipment_template, une page
// HYPERVEEZ, ou etre un texte custom redige pour ce client.
//
// `afs.layout_template` distingue les 2 variantes :
//   - 'commercial-brochure' (defaut) : proposition pour un client X
//   - 'offering-catalog' : catalogue annuel type "Offres Buildy 2026"

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;

const ITEM_KINDS = ['feature', 'equipment_template', 'hyperveez_page', 'cgv', 'custom'];

const itemCreateSchema = z.object({
  position: z.number().int().optional(),
  item_kind: z.enum(ITEM_KINDS),
  source_id: z.number().int().nullable().optional(),
  source_slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  body_html: z.string().nullable().optional(),
  override_title: z.string().nullable().optional(),
  override_html: z.string().nullable().optional(),
});
const itemUpdateSchema = z.object({
  position: z.number().int().optional(),
  override_title: z.string().nullable().optional(),
  override_html: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  body_html: z.string().nullable().optional(),
});

async function routes(fastify) {
  // ─── Catalogue de bibliothèque (items reutilisables) ───────────────
  // GET /api/brochures/library?kind=feature|offering_level|cgv|company
  fastify.get('/brochures/library', async (request) => {
    const kind = request.query.kind || null;
    return db.brochureLibrary.list({ kind });
  });

  // ─── Items d'une brochure ──────────────────────────────────────────
  fastify.get('/brochures/:brochureId/items', async (request, reply) => {
    const id = parseInt(request.params.brochureId, 10);
    const brochure = db.afs.getById(id);
    if (!brochure || brochure.kind !== 'brochure') {
      return reply.code(404).send({ detail: 'Brochure non trouvée' });
    }
    return db.brochureItems.listByBrochure(id);
  });

  // POST /api/brochures/:id/items
  // Body au choix :
  //   { item_kind: 'custom', title, body_html, position }
  //   { item_kind: 'feature', source_id }    -> resout depuis library
  //   { item_kind: 'equipment_template', source_id }
  //   { item_kind: 'hyperveez_page', source_slug }
  //   { item_kind: 'cgv', source_id }
  fastify.post('/brochures/:brochureId/items', async (request, reply) => {
    const brochureId = parseInt(request.params.brochureId, 10);
    const brochure = db.afs.getById(brochureId);
    if (!brochure || brochure.kind !== 'brochure') {
      return reply.code(404).send({ detail: 'Brochure non trouvée' });
    }
    let body;
    try { body = itemCreateSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    // Si on pioche un item dans la bibliotheque, copie title + body_html
    // depuis l'item source pour figer le contenu au moment du pick.
    let title = body.title || null;
    let bodyHtml = body.body_html || null;
    if (body.item_kind === 'feature' || body.item_kind === 'cgv') {
      if (body.source_id) {
        const lib = db.brochureLibrary.getById(body.source_id);
        if (lib) { title = title || lib.title; bodyHtml = bodyHtml || lib.body_html; }
      }
    }

    // Position auto en fin si non specifiee
    let position = body.position;
    if (position == null) {
      const existing = db.brochureItems.listByBrochure(brochureId);
      position = existing.length ? Math.max(...existing.map(i => i.position)) + 1 : 0;
    }

    const item = db.brochureItems.create({
      brochureId,
      position,
      itemKind: body.item_kind,
      sourceId: body.source_id ?? null,
      sourceSlug: body.source_slug ?? null,
      title,
      bodyHtml,
      overrideTitle: body.override_title ?? null,
      overrideHtml: body.override_html ?? null,
    });
    db.auditLog.add({
      afId: brochureId, userId: request.authUser?.id,
      action: 'brochure_item.create',
      payload: { id: item.id, item_kind: item.item_kind },
    });
    return item;
  });

  fastify.patch('/brochures/items/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const item = db.brochureItems.getById(id);
    if (!item) return reply.code(404).send({ detail: 'Item non trouvé' });
    let body;
    try { body = itemUpdateSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const patch = {};
    if (body.position !== undefined) patch.position = body.position;
    if (body.title !== undefined) patch.title = body.title;
    if (body.body_html !== undefined) patch.bodyHtml = body.body_html;
    if (body.override_title !== undefined) patch.overrideTitle = body.override_title;
    if (body.override_html !== undefined) patch.overrideHtml = body.override_html;
    const updated = db.brochureItems.update(id, patch);
    db.auditLog.add({
      afId: item.brochure_id, userId: request.authUser?.id,
      action: 'brochure_item.update',
      payload: { id, fields: Object.keys(body) },
    });
    return updated;
  });

  fastify.delete('/brochures/items/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const item = db.brochureItems.getById(id);
    if (!item) return reply.code(404).send({ detail: 'Item non trouvé' });
    db.brochureItems.remove(id);
    db.auditLog.add({
      afId: item.brochure_id, userId: request.authUser?.id,
      action: 'brochure_item.delete',
      payload: { id, item_kind: item.item_kind },
    });
    return reply.code(204).send();
  });

  // PATCH layout_template d'une brochure
  fastify.patch('/brochures/:brochureId/layout', async (request, reply) => {
    const id = parseInt(request.params.brochureId, 10);
    const brochure = db.afs.getById(id);
    if (!brochure || brochure.kind !== 'brochure') {
      return reply.code(404).send({ detail: 'Brochure non trouvée' });
    }
    const layout = request.body?.layout_template;
    if (!['commercial-brochure', 'offering-catalog'].includes(layout)) {
      return reply.code(400).send({ detail: 'layout_template invalide' });
    }
    db.db.prepare('UPDATE afs SET layout_template = ? WHERE id = ?').run(layout, id);
    db.auditLog.add({
      afId: id, userId: request.authUser?.id,
      action: 'brochure.layout',
      payload: { layout },
    });
    return db.afs.getById(id);
  });
}

module.exports = routes;
