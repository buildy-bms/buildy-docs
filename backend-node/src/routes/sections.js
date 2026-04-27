'use strict';

const { z } = require('zod');
const db = require('../database');
const { resolveSectionPoints } = require('../lib/points-resolver');

const updateSectionSchema = z.object({
  title: z.string().min(1).optional(),
  service_level: z.string().nullable().optional(),
  bacs_articles: z.string().nullable().optional(),
  body_html: z.string().nullable().optional(),
  included_in_export: z.boolean().optional(),
  fact_check_status: z.enum(['unverified', 'verified', 'backend_only', 'in_progress', 'documented']).optional(),
}).strict();

const overrideSchema = z.object({
  action: z.enum(['add', 'edit', 'remove']),
  base_point_id: z.number().optional(),
  position: z.number().optional(),
  label: z.string().optional(),
  data_type: z.enum(['Mesure', 'État', 'Alarme', 'Commande', 'Consigne']).optional(),
  direction: z.enum(['read', 'write']).optional(),
  unit: z.string().nullable().optional(),
  is_optional: z.boolean().optional(),
});

const instanceSchema = z.object({
  reference: z.string().min(1),
  location: z.string().optional(),
  qty: z.number().int().positive().optional(),
  notes: z.string().optional(),
  position: z.number().optional(),
});

async function routes(fastify) {
  // GET /api/afs/:afId/sections — liste plate des sections d'une AF
  fastify.get('/afs/:afId/sections', async (request) => {
    const afId = parseInt(request.params.afId, 10);
    return db.sections.listByAf(afId);
  });

  // GET /api/sections/:id — detail
  fastify.get('/sections/:id', async (request, reply) => {
    const section = db.sections.getById(parseInt(request.params.id, 10));
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    return section;
  });

  // PATCH /api/sections/:id — update champs
  fastify.patch('/sections/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const section = db.sections.getById(id);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });

    let body;
    try { body = updateSectionSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const userId = request.authUser?.id;
    const updated = db.sections.update(id, {
      title: body.title,
      serviceLevel: body.service_level,
      bacsArticles: body.bacs_articles,
      bodyHtml: body.body_html,
      includedInExport: body.included_in_export == null ? undefined : (body.included_in_export ? 1 : 0),
      factCheckStatus: body.fact_check_status,
      updatedBy: userId,
    });

    // Re-index FTS si le body ou title a change
    if ('body_html' in body || 'title' in body) {
      const bodyText = (body.body_html || section.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      db.sections.reindexFts(id, section.af_id, body.title || section.title, bodyText);
    }

    db.auditLog.add({
      afId: section.af_id, sectionId: id, userId, action: 'section.update',
      payload: Object.keys(body),
    });
    return updated;
  });

  // GET /api/sections/:id/points — points résolus (template + overrides)
  fastify.get('/sections/:id/points', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const section = db.sections.getById(id);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (section.kind !== 'equipment') return reply.code(400).send({ detail: 'Section non equipment' });
    return { points: resolveSectionPoints(id) };
  });

  // POST /api/sections/:id/overrides — ajouter un override
  fastify.post('/sections/:id/overrides', async (request, reply) => {
    const sectionId = parseInt(request.params.id, 10);
    const section = db.sections.getById(sectionId);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });

    let body;
    try { body = overrideSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const override = db.sectionPointOverrides.create(sectionId, {
      action: body.action,
      basePointId: body.base_point_id,
      position: body.position,
      label: body.label,
      dataType: body.data_type,
      direction: body.direction,
      unit: body.unit,
      isOptional: body.is_optional,
      createdBy: request.authUser?.id,
    });
    db.auditLog.add({
      afId: section.af_id, sectionId, userId: request.authUser?.id,
      action: 'section.override.add', payload: body,
    });
    return override;
  });

  // DELETE /api/sections/:id/overrides/:overrideId
  fastify.delete('/sections/:id/overrides/:overrideId', async (request) => {
    const sectionId = parseInt(request.params.id, 10);
    const overrideId = parseInt(request.params.overrideId, 10);
    db.sectionPointOverrides.delete(overrideId);
    const section = db.sections.getById(sectionId);
    db.auditLog.add({
      afId: section?.af_id, sectionId, userId: request.authUser?.id,
      action: 'section.override.remove', payload: { overrideId },
    });
    return { ok: true };
  });

  // GET /api/sections/:id/instances — instances réelles de l'équipement
  fastify.get('/sections/:id/instances', async (request) => {
    const sectionId = parseInt(request.params.id, 10);
    return db.equipmentInstances.listBySection(sectionId);
  });

  // POST /api/sections/:id/instances — ajouter une instance
  fastify.post('/sections/:id/instances', async (request, reply) => {
    const sectionId = parseInt(request.params.id, 10);
    const section = db.sections.getById(sectionId);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });

    let body;
    try { body = instanceSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const instance = db.equipmentInstances.create(sectionId, body);
    db.auditLog.add({
      afId: section.af_id, sectionId, userId: request.authUser?.id,
      action: 'section.instance.add', payload: body,
    });
    return instance;
  });

  // PATCH /api/instances/:id — update instance
  fastify.patch('/instances/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    let body;
    try { body = instanceSchema.partial().parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }
    const updated = db.equipmentInstances.update(id, body);
    if (!updated) return reply.code(404).send({ detail: 'Instance non trouvée' });
    return updated;
  });

  // DELETE /api/instances/:id
  fastify.delete('/instances/:id', async (request) => {
    db.equipmentInstances.delete(parseInt(request.params.id, 10));
    return { ok: true };
  });
}

module.exports = routes;
