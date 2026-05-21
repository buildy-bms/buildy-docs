'use strict';

const { z } = require('zod');
const db = require('../database');

// Valeurs alignees Directus + cas Buildy. Doit rester synchro avec :
//   - frontend/src/lib/audit-options.js ZONE_NATURES (libellés FR)
//   - backend-node/src/seeds/bacs-requirements.js INDOOR_NATURES (assujettissement R175)
const ZONE_NATURES = [
  'office', 'shared-office', 'private-office', 'open-space', 'commercial-space',
  'meeting-room', 'workshop', 'switchboard', 'technical-area', 'server-room',
  'classroom', 'leasure-space', 'foyer', 'corridor',
  'outdoor', 'meters', 'shared-space', 'logistic-cell', 'stock',
];

// Une zone est soit « fonctionnelle » (assujettie au decret BACS, alimente
// les cards Systemes / Compteurs), soit « technique » (local technique,
// TGBT, local compteurs… hors perimetre BACS — inventoriee mais sans
// auto-creation de systemes / compteurs).
const ZONE_KINDS = ['functional', 'technical'];

const createZoneSchema = z.object({
  site_id: z.number().int().positive(),
  name: z.string().min(1, 'Nom requis'),
  nature: z.enum(ZONE_NATURES).nullable().optional(),
  kind: z.enum(ZONE_KINDS).optional(),
  position: z.number().int().optional(),
  surface_m2: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

const updateZoneSchema = z.object({
  name: z.string().min(1).optional(),
  nature: z.enum(ZONE_NATURES).nullable().optional(),
  kind: z.enum(ZONE_KINDS).optional(),
  position: z.number().int().optional(),
  surface_m2: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  notes_html: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
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
      kind: body.kind || 'functional',
      position: body.position || 0,
      notes: body.notes || null,
      surfaceM2: body.surface_m2 ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
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

  // POST /api/site-zones/:id/duplicate — duplique une zone (sans rattachements derives)
  fastify.post('/site-zones/:id/duplicate', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const zone = db.zones.getById(id);
    if (!zone || zone.deleted_at) return reply.code(404).send({ detail: 'Zone non trouvee' });
    const cloned = db.zones.create({
      siteId: zone.site_id,
      name: `${zone.name} (copie)`,
      nature: zone.nature,
      kind: zone.kind,
      position: zone.position + 1,
      surfaceM2: zone.surface_m2,
      notes: zone.notes,
    });
    if (zone.notes_html) {
      db.zones.update(cloned.zone_id, { notes_html: zone.notes_html });
    }
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'zone.duplicate',
      payload: { source_zone_id: id, new_zone_id: cloned.zone_id },
    });
    return reply.code(201).send(db.zones.getById(cloned.zone_id));
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
