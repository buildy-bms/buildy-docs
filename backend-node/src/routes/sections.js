'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { resolveSectionPoints } = require('../lib/points-resolver');
const { diffSectionVsTemplate } = require('../lib/template-propagation');

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

const createSectionSchema = z.object({
  parent_id: z.number().nullable().optional(),
  position: z.number().optional(),
  number: z.string().nullable().optional(),
  title: z.string().min(1),
  kind: z.enum(['standard', 'equipment', 'synthesis', 'hyperveez_page']).default('standard'),
  equipment_template_id: z.number().nullable().optional(),
  body_html: z.string().nullable().optional(),
  service_level: z.string().nullable().optional(),
  bacs_articles: z.string().nullable().optional(),
});

async function routes(fastify) {
  // GET /api/afs/:afId/sections — liste plate des sections d'une AF
  fastify.get('/afs/:afId/sections', async (request) => {
    const afId = parseInt(request.params.afId, 10);
    return db.sections.listByAf(afId);
  });

  // POST /api/afs/:afId/sections — création d'une section
  fastify.post('/afs/:afId/sections', async (request, reply) => {
    const afId = parseInt(request.params.afId, 10);
    const af = db.afs.getById(afId);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    let body;
    try { body = createSectionSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    if (body.parent_id) {
      const parent = db.sections.getById(body.parent_id);
      if (!parent || parent.af_id !== afId) {
        return reply.code(400).send({ detail: 'Section parente invalide' });
      }
    }

    // Position auto = max + 10 parmi les frères, si non fourni
    let position = body.position;
    if (position == null) {
      const siblings = db.sections.listByAf(afId).filter(s => (s.parent_id || null) === (body.parent_id || null));
      position = (siblings.reduce((m, s) => Math.max(m, s.position || 0), 0)) + 10;
    }

    // Si template equipment fourni : récupère sa version courante
    let equipmentTemplateVersion = null;
    if (body.equipment_template_id) {
      const tpl = db.equipmentTemplates.getById(body.equipment_template_id);
      if (!tpl) return reply.code(400).send({ detail: 'Template équipement introuvable' });
      equipmentTemplateVersion = tpl.current_version;
    }

    const userId = request.authUser?.id;
    const created = db.sections.create({
      afId,
      parentId: body.parent_id || null,
      position,
      number: body.number || null,
      title: body.title,
      serviceLevel: body.service_level || null,
      bacsArticles: body.bacs_articles || null,
      bodyHtml: body.body_html || null,
      kind: body.kind,
      equipmentTemplateId: body.equipment_template_id || null,
      equipmentTemplateVersion,
    });
    if (created.title || created.body_html) {
      const bodyText = (created.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      db.sections.reindexFts(created.id, afId, created.title, bodyText);
    }
    db.auditLog.add({
      afId, sectionId: created.id, userId,
      action: 'section.create',
      payload: { title: body.title, kind: body.kind, parent_id: body.parent_id || null },
    });
    return created;
  });

  // DELETE /api/sections/:id — suppression cascade (children + overrides + instances + attachments)
  fastify.delete('/sections/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const section = db.sections.getById(id);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });

    // SQLite cascades sur sections (parent), section_point_overrides, equipment_instances,
    // attachments via ON DELETE CASCADE déjà déclarés dans la migration v2.
    db.sections.delete(id);
    db.auditLog.add({
      afId: section.af_id, userId: request.authUser?.id,
      action: 'section.delete',
      payload: { title: section.title, number: section.number, kind: section.kind },
    });
    log.info(`Section #${id} supprimée (cascade) — AF #${section.af_id}`);
    return { ok: true };
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

  // GET /api/sections/:id/template-update — diff entre version pinnee et version courante
  fastify.get('/sections/:id/template-update', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const section = db.sections.getById(id);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (section.kind !== 'equipment' || !section.equipment_template_id) {
      return reply.code(400).send({ detail: 'Section sans template équipement' });
    }
    return diffSectionVsTemplate(id);
  });

  // POST /api/sections/:id/template-update/apply — synchronise la section sur la version courante
  fastify.post('/sections/:id/template-update/apply', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const section = db.sections.getById(id);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (!section.equipment_template_id) return reply.code(400).send({ detail: 'Section sans template' });

    const tpl = db.equipmentTemplates.getById(section.equipment_template_id);
    const userId = request.authUser?.id;
    const updated = db.sections.update(id, {
      equipmentTemplateVersion: tpl.current_version,
      updatedBy: userId,
    });
    db.auditLog.add({
      afId: section.af_id, sectionId: id, templateId: tpl.id, userId,
      action: 'section.template.sync',
      payload: { from: section.equipment_template_version, to: tpl.current_version },
    });
    return updated;
  });

  // POST /api/sections/:id/template-update/dismiss — meme effet (acquitte sans changer le contenu)
  // (le contenu est deja synchronise dynamiquement via points-resolver, ce flag n'est qu'un pin)
  fastify.post('/sections/:id/template-update/dismiss', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const section = db.sections.getById(id);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (!section.equipment_template_id) return reply.code(400).send({ detail: 'Section sans template' });

    const tpl = db.equipmentTemplates.getById(section.equipment_template_id);
    const userId = request.authUser?.id;
    const updated = db.sections.update(id, {
      equipmentTemplateVersion: tpl.current_version,
      updatedBy: userId,
    });
    db.auditLog.add({
      afId: section.af_id, sectionId: id, templateId: tpl.id, userId,
      action: 'section.template.dismiss',
      payload: { from: section.equipment_template_version, to: tpl.current_version },
    });
    return updated;
  });
}

module.exports = routes;
