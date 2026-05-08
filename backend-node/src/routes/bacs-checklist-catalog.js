'use strict';

// CRUD du catalogue d'items de check-list audit (mig 100). Les items
// sont partagés à tous les audits ; chaque audit a ses propres états
// (`bacs_audit_checklist`) référencés par `catalog_key`.
//
// Ce catalogue est éditable côté admin (clés stables, label/icône
// modifiables, position pour l'ordre d'affichage).

const { z } = require('zod');
const db = require('../database');
const { slugify } = require('../lib/slug');

const itemSchema = z.object({
  key: z.string().min(1).optional(),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  icon_value: z.string().nullable().optional(),
  icon_color: z.string().nullable().optional(),
  position: z.number().int().optional(),
  active: z.boolean().optional(),
});

async function routes(fastify) {
  fastify.get('/bacs-checklist-catalog', async (request) => {
    const { include_inactive } = request.query || {};
    return db.bacsChecklistCatalog.list({
      active: include_inactive ? null : true,
    });
  });

  fastify.post('/bacs-checklist-catalog', async (request, reply) => {
    let body;
    try { body = itemSchema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const key = body.key || slugify(body.label);
    if (db.bacsChecklistCatalog.getByKey(key)) {
      return reply.code(409).send({ detail: `Clé « ${key} » déjà utilisée.` });
    }
    return db.bacsChecklistCatalog.create({
      key,
      label: body.label,
      description: body.description,
      iconValue: body.icon_value,
      iconColor: body.icon_color,
      position: body.position ?? 0,
      active: body.active ?? true,
    });
  });

  fastify.patch('/bacs-checklist-catalog/:key', async (request, reply) => {
    const key = request.params.key;
    if (!db.bacsChecklistCatalog.getByKey(key)) {
      return reply.code(404).send({ detail: 'Item introuvable' });
    }
    let body;
    try { body = itemSchema.partial().parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    return db.bacsChecklistCatalog.update(key, {
      label: body.label,
      description: body.description,
      iconValue: body.icon_value,
      iconColor: body.icon_color,
      position: body.position,
      active: body.active,
    });
  });

  fastify.delete('/bacs-checklist-catalog/:key', async (request, reply) => {
    const key = request.params.key;
    if (!db.bacsChecklistCatalog.getByKey(key)) {
      return reply.code(404).send({ detail: 'Item introuvable' });
    }
    db.bacsChecklistCatalog.remove(key);
    return reply.code(204).send();
  });

  // Réordonnancement en lot — body { keys: ["a","b","c"] }, position = index*10.
  fastify.patch('/bacs-checklist-catalog/reorder', async (request, reply) => {
    const keys = Array.isArray(request.body?.keys) ? request.body.keys : [];
    if (!keys.length) return reply.code(400).send({ detail: 'keys vide' });
    db.db.transaction(() => {
      keys.forEach((key, i) => {
        if (db.bacsChecklistCatalog.getByKey(key)) {
          db.bacsChecklistCatalog.update(key, { position: (i + 1) * 10 });
        }
      });
    })();
    return { ok: true, count: keys.length };
  });
}

module.exports = routes;
