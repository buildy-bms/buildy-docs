'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { slugify } = require('../lib/slug');

const createTemplateSchema = z.object({
  slug: z.string().optional(),
  name: z.string().min(1),
  category: z.string().optional(),
  bacs_articles: z.string().optional(),
  description_html: z.string().optional(),
  icon_kind: z.enum(['fa', 'svg-hyperveez', 'svg-custom']).optional(),
  icon_value: z.string().optional(),
  icon_color: z.string().optional(),
});

const updateTemplateSchema = createTemplateSchema.partial().omit({ slug: true });

const pointSchema = z.object({
  slug: z.string().min(1),
  position: z.number().optional(),
  label: z.string().min(1),
  data_type: z.enum(['Mesure', 'État', 'Alarme', 'Commande', 'Consigne']),
  direction: z.enum(['read', 'write']),
  unit: z.string().optional(),
  notes: z.string().optional(),
  is_optional: z.boolean().optional(),
});

async function routes(fastify) {
  // GET /api/equipment-templates — liste de la bibliothèque
  fastify.get('/equipment-templates', async (request) => {
    const { category } = request.query;
    const templates = db.equipmentTemplates.list({ category });
    // Enrichi avec compteurs de points
    return templates.map(t => ({
      ...t,
      points_count: db.db.prepare('SELECT COUNT(*) AS c FROM equipment_template_points WHERE template_id = ?').get(t.id).c,
      sections_using_count: db.db.prepare('SELECT COUNT(*) AS c FROM sections WHERE equipment_template_id = ? AND af_id IN (SELECT id FROM afs WHERE deleted_at IS NULL)').get(t.id).c,
    }));
  });

  // GET /api/equipment-templates/:id — detail + points
  fastify.get('/equipment-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const template = db.equipmentTemplates.getById(id);
    if (!template) return reply.code(404).send({ detail: 'Template non trouvé' });
    return {
      ...template,
      points: db.equipmentTemplatePoints.listByTemplate(id),
    };
  });

  // POST /api/equipment-templates — creation
  fastify.post('/equipment-templates', async (request, reply) => {
    let body;
    try { body = createTemplateSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const slug = body.slug || slugify(body.name);
    if (db.equipmentTemplates.getBySlug(slug)) {
      return reply.code(409).send({ detail: 'Un template avec ce slug existe déjà' });
    }

    const userId = request.authUser?.id;
    const tpl = db.equipmentTemplates.create({
      slug,
      name: body.name,
      category: body.category,
      bacsArticles: body.bacs_articles,
      descriptionHtml: body.description_html,
      iconKind: body.icon_kind,
      iconValue: body.icon_value,
      iconColor: body.icon_color,
      createdBy: userId,
    });
    db.auditLog.add({ templateId: tpl.id, userId, action: 'template.create', payload: { slug } });
    log.info(`Template created: ${slug} by user #${userId}`);
    return tpl;
  });

  // PATCH /api/equipment-templates/:id — update
  fastify.patch('/equipment-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Template non trouvé' });

    let body;
    try { body = updateTemplateSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const userId = request.authUser?.id;
    const updated = db.equipmentTemplates.update(id, {
      name: body.name,
      category: body.category,
      bacsArticles: body.bacs_articles,
      descriptionHtml: body.description_html,
      iconKind: body.icon_kind,
      iconValue: body.icon_value,
      iconColor: body.icon_color,
      updatedBy: userId,
    });
    db.auditLog.add({ templateId: id, userId, action: 'template.update', payload: body });
    return updated;
  });

  // DELETE /api/equipment-templates/:id — suppression
  fastify.delete('/equipment-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Template non trouvé' });

    // Verifier qu'aucune section active ne reference le template
    const inUse = db.db.prepare(`
      SELECT COUNT(*) AS c FROM sections
      WHERE equipment_template_id = ?
        AND af_id IN (SELECT id FROM afs WHERE deleted_at IS NULL)
    `).get(id).c;
    if (inUse > 0) {
      return reply.code(409).send({ detail: `${inUse} section(s) utilisent encore ce template — détacher d'abord.` });
    }

    db.equipmentTemplates.delete(id);
    db.auditLog.add({ templateId: id, userId: request.authUser?.id, action: 'template.delete' });
    return { ok: true };
  });

  // POST /api/equipment-templates/:id/points — ajouter un point
  fastify.post('/equipment-templates/:id/points', async (request, reply) => {
    const templateId = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(templateId);
    if (!tpl) return reply.code(404).send({ detail: 'Template non trouvé' });

    let body;
    try { body = pointSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    try {
      const point = db.equipmentTemplatePoints.create(templateId, {
        slug: body.slug, position: body.position, label: body.label,
        dataType: body.data_type, direction: body.direction, unit: body.unit,
        notes: body.notes, isOptional: body.is_optional,
      });
      db.equipmentTemplates.bumpVersion(templateId);
      db.auditLog.add({ templateId, userId: request.authUser?.id, action: 'template.point.add', payload: body });
      return point;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return reply.code(409).send({ detail: `Slug "${body.slug}" déjà présent dans ce template` });
      }
      throw err;
    }
  });

  // DELETE /api/equipment-templates/:id/points/:pointId — retirer un point
  fastify.delete('/equipment-templates/:id/points/:pointId', async (request) => {
    const pointId = parseInt(request.params.pointId, 10);
    const templateId = parseInt(request.params.id, 10);
    db.db.prepare('DELETE FROM equipment_template_points WHERE id = ? AND template_id = ?').run(pointId, templateId);
    db.equipmentTemplates.bumpVersion(templateId);
    db.auditLog.add({ templateId, userId: request.authUser?.id, action: 'template.point.remove', payload: { pointId } });
    return { ok: true };
  });
}

module.exports = routes;
