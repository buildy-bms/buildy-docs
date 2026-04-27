'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { slugify } = require('../lib/slug');
const { snapshotAndBump } = require('../lib/template-propagation');

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
    // Si la description a change, on cree une nouvelle version (bump + snapshot)
    // pour que les AFs concernees voient une mise a jour de propagation.
    if ('description_html' in body && body.description_html !== tpl.description_html) {
      snapshotAndBump(id, { changelog: 'Mise a jour description', authorId: userId });
    }
    db.auditLog.add({ templateId: id, userId, action: 'template.update', payload: body });
    return db.equipmentTemplates.getById(id);
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
      snapshotAndBump(templateId, { changelog: `Ajout point "${body.label}"`, authorId: request.authUser?.id });
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
    const old = db.db.prepare('SELECT label FROM equipment_template_points WHERE id = ?').get(pointId);
    db.db.prepare('DELETE FROM equipment_template_points WHERE id = ? AND template_id = ?').run(pointId, templateId);
    snapshotAndBump(templateId, { changelog: `Retrait point "${old?.label || pointId}"`, authorId: request.authUser?.id });
    db.auditLog.add({ templateId, userId: request.authUser?.id, action: 'template.point.remove', payload: { pointId } });
    return { ok: true };
  });

  // GET /api/equipment-templates/:id/versions — historique des versions
  fastify.get('/equipment-templates/:id/versions', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Template non trouvé' });
    return {
      current_version: tpl.current_version,
      versions: db.equipmentTemplateVersions.listByTemplate(id),
    };
  });

  // GET /api/equipment-templates/:id/affected-afs — AFs qui referencent ce template
  fastify.get('/equipment-templates/:id/affected-afs', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Template non trouvé' });

    const rows = db.sections.affectedAfsByTemplate(id);
    // Regroupe par AF
    const byAf = new Map();
    for (const r of rows) {
      if (!byAf.has(r.af_id)) {
        byAf.set(r.af_id, {
          af_id: r.af_id, client_name: r.client_name, project_name: r.project_name,
          status: r.status, sections: [], outdated_count: 0,
        });
      }
      const af = byAf.get(r.af_id);
      const isOutdated = (r.equipment_template_version || 0) < tpl.current_version;
      af.sections.push({
        section_id: r.section_id, number: r.number, title: r.title,
        equipment_template_version: r.equipment_template_version,
        is_outdated: isOutdated,
      });
      if (isOutdated) af.outdated_count++;
    }
    return {
      current_version: tpl.current_version,
      afs: Array.from(byAf.values()),
    };
  });
}

module.exports = routes;
