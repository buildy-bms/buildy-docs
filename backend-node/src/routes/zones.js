'use strict';

const { z } = require('zod');
const db = require('../database');

// 17 valeurs alignees Directus + cas Buildy
const ZONE_NATURES = [
  'shared-office', 'private-office', 'open-space', 'commercial-space',
  'meeting-room', 'workshop', 'switchboard', 'technical-area',
  'classroom', 'leasure-space', 'foyer', 'corridor',
  'outdoor', 'meters', 'shared-space', 'logistic-cell', 'stock',
];

const createZoneSchema = z.object({
  site_id: z.number().int().positive(),
  name: z.string().min(1, 'Nom requis'),
  nature: z.enum(ZONE_NATURES).nullable().optional(),
  position: z.number().int().optional(),
  notes: z.string().nullable().optional(),
});

const updateZoneSchema = z.object({
  name: z.string().min(1).optional(),
  nature: z.enum(ZONE_NATURES).nullable().optional(),
  position: z.number().int().optional(),
  notes: z.string().nullable().optional(),
});

async function routes(fastify) {
  // GET /api/site-zones?site_id=...
  fastify.get('/site-zones', async (request, reply) => {
    const siteId = parseInt(request.query.site_id, 10);
    if (!siteId) return reply.code(400).send({ detail: 'site_id requis' });
    const site = db.sites.getById(siteId);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    return db.zones.listBySite(siteId);
  });

  // GET /api/site-zones/:id
  fastify.get('/site-zones/:id', async (request, reply) => {
    const zone = db.zones.getById(parseInt(request.params.id, 10));
    if (!zone || zone.deleted_at) return reply.code(404).send({ detail: 'Zone non trouvee' });
    return zone;
  });

  // POST /api/site-zones
  fastify.post('/site-zones', async (request, reply) => {
    let body;
    try { body = createZoneSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const site = db.sites.getById(body.site_id);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    const zone = db.zones.create({
      siteId: body.site_id,
      name: body.name,
      nature: body.nature || null,
      position: body.position || 0,
      notes: body.notes || null,
    });
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'zone.create',
      payload: { zone_id: zone.zone_id, site_id: body.site_id, name: body.name },
    });
    return reply.code(201).send(zone);
  });

  // PATCH /api/site-zones/:id
  fastify.patch('/site-zones/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const zone = db.zones.getById(id);
    if (!zone || zone.deleted_at) return reply.code(404).send({ detail: 'Zone non trouvee' });
    let body;
    try { body = updateZoneSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const updated = db.zones.update(id, body);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'zone.update',
      payload: { zone_id: id, fields: Object.keys(body) },
    });
    return updated;
  });

  // DELETE /api/site-zones/:id
  fastify.delete('/site-zones/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const zone = db.zones.getById(id);
    if (!zone) return reply.code(404).send({ detail: 'Zone non trouvee' });
    if (!zone.deleted_at) {
      db.zones.softDelete(id);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'zone.delete',
        payload: { zone_id: id },
      });
    }
    return reply.code(204).send();
  });
}

module.exports = routes;
module.exports.ZONE_NATURES = ZONE_NATURES;
