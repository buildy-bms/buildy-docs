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
  bacs_justification: z.string().nullable().optional(),
  description_html: z.string().optional(),
  icon_kind: z.enum(['fa', 'svg-hyperveez', 'svg-custom']).optional(),
  icon_value: z.string().optional(),
  icon_color: z.string().optional(),
  preferred_protocols: z.string().nullable().optional(),
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
  tech_name: z.string().nullable().optional(),
  nature: z.enum(['Booléen', 'Numérique', 'Enum', 'Chaîne']).nullable().optional(),
});

// Heritage BACS depuis la categorie : un equipment_template n'a plus son
// propre bacs_articles depuis le Lot 35 — il l'herite de sa categorie.
function inheritBacsFromCategory(template, categoriesByKey) {
  const cat = template.category ? categoriesByKey.get(template.category) : null;
  return {
    ...template,
    bacs_articles: cat?.bacs || null,
    bacs_inherited_from: cat ? { key: cat.key, label: cat.label } : null,
  };
}

async function routes(fastify) {
  // GET /api/equipment-templates — liste de la bibliothèque
  fastify.get('/equipment-templates', async (request) => {
    const { category } = request.query;
    const templates = db.equipmentTemplates.list({ category });
    const categoriesByKey = new Map(db.systemCategoriesDb.list().map(c => [c.key, c]));
    return templates.map(t => ({
      ...inheritBacsFromCategory(t, categoriesByKey),
      points_count: db.db.prepare('SELECT COUNT(*) AS c FROM equipment_template_points WHERE template_id = ?').get(t.id).c,
      sections_using_count: db.db.prepare('SELECT COUNT(*) AS c FROM sections WHERE equipment_template_id = ? AND af_id IN (SELECT id FROM afs WHERE deleted_at IS NULL)').get(t.id).c,
    }));
  });

  // GET /api/equipment-templates/:id — detail + points + sections types liees
  fastify.get('/equipment-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const template = db.equipmentTemplates.getById(id);
    if (!template) return reply.code(404).send({ detail: 'Template non trouvé' });

    // Sections types qui referencent ce modele (kind=equipment).
    // On reconstitue le chemin parent ("2.2 Ventilation › CTA") cote serveur
    // pour que le client n'ait qu'a afficher.
    const allTemplates = db.sectionTemplates.list({});
    const byId = new Map(allTemplates.map(t => [t.id, t]));
    function pathOf(t) {
      const parts = [];
      let cur = t;
      while (cur) {
        parts.unshift(cur.title);
        cur = cur.parent_template_id ? byId.get(cur.parent_template_id) : null;
      }
      return parts.join(' › ');
    }
    const linkedSections = allTemplates
      .filter(t => t.kind === 'equipment' && t.equipment_template_id === id)
      .map(t => ({
        id: t.id,
        title: t.title,
        slug: t.slug,
        parent_template_id: t.parent_template_id,
        path: pathOf(t),
      }));

    const categoriesByKey = new Map(db.systemCategoriesDb.list().map(c => [c.key, c]));
    return {
      ...inheritBacsFromCategory(template, categoriesByKey),
      points: db.equipmentTemplatePoints.listByTemplate(id),
      linked_sections: linkedSections,
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
      // bacs_articles : herite de la categorie depuis le Lot 35 (jamais ecrit ici)
      bacsJustification: body.bacs_justification,
      descriptionHtml: body.description_html,
      iconKind: body.icon_kind,
      iconValue: body.icon_value,
      iconColor: body.icon_color,
      preferredProtocols: body.preferred_protocols,
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
      // bacs_articles : herite de la categorie depuis le Lot 35 (jamais ecrit ici)
      bacsJustification: body.bacs_justification,
      descriptionHtml: body.description_html,
      iconKind: body.icon_kind,
      iconValue: body.icon_value,
      iconColor: body.icon_color,
      preferredProtocols: body.preferred_protocols,
      updatedBy: userId,
    });
    // Si la description ou les protocoles changent, on cree une nouvelle version
    if ('preferred_protocols' in body && body.preferred_protocols !== tpl.preferred_protocols) {
      snapshotAndBump(id, { changelog: 'Mise a jour protocoles preferes', authorId: userId });
    }
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
        techName: body.tech_name, nature: body.nature,
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

  // PATCH /api/equipment-templates/:id/points/:pointId — modifier un point
  // Tous les champs sont optionnels : on ne met a jour que ce qui est passe.
  // Bump de version unique (vs delete+create qui en ferait 2).
  fastify.patch('/equipment-templates/:id/points/:pointId', async (request, reply) => {
    const pointId = parseInt(request.params.pointId, 10);
    const templateId = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(templateId);
    if (!tpl) return reply.code(404).send({ detail: 'Template non trouvé' });

    let body;
    try { body = pointSchema.partial().parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const old = db.db.prepare(
      'SELECT * FROM equipment_template_points WHERE id = ? AND template_id = ?'
    ).get(pointId, templateId);
    if (!old) return reply.code(404).send({ detail: 'Point non trouvé' });

    // Mapping camelCase -> colonnes DB
    const fields = [];
    const params = [];
    if (body.slug !== undefined)        { fields.push('slug = ?');         params.push(body.slug); }
    if (body.label !== undefined)       { fields.push('label = ?');        params.push(body.label); }
    if (body.data_type !== undefined)   { fields.push('data_type = ?');    params.push(body.data_type); }
    if (body.direction !== undefined)   { fields.push('direction = ?');    params.push(body.direction); }
    if (body.unit !== undefined)        { fields.push('unit = ?');         params.push(body.unit || null); }
    if (body.notes !== undefined)       { fields.push('notes = ?');        params.push(body.notes || null); }
    if (body.is_optional !== undefined) { fields.push('is_optional = ?');  params.push(body.is_optional ? 1 : 0); }
    if (body.position !== undefined)    { fields.push('position = ?');     params.push(body.position); }
    if (body.tech_name !== undefined)   { fields.push('tech_name = ?');    params.push(body.tech_name || null); }
    if (body.nature !== undefined)      { fields.push('nature = ?');       params.push(body.nature || null); }
    if (!fields.length) return old;

    params.push(pointId);
    try {
      db.db.prepare(`UPDATE equipment_template_points SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return reply.code(409).send({ detail: `Slug "${body.slug}" déjà présent dans ce template` });
      }
      throw err;
    }

    const labelForChangelog = body.label || old.label;
    snapshotAndBump(templateId, { changelog: `Modification point "${labelForChangelog}"`, authorId: request.authUser?.id });
    db.auditLog.add({
      templateId, userId: request.authUser?.id, action: 'template.point.update',
      payload: { pointId, fields: Object.keys(body) },
    });
    return db.db.prepare('SELECT * FROM equipment_template_points WHERE id = ?').get(pointId);
  });

  // PATCH /api/equipment-templates/:id/points/reorder — body { ids: [pointId, ...] }
  // Reorganisation des positions dans une direction (lectures ou ecritures).
  // Cosmetique : pas de bump de version, pas d'audit lourd.
  fastify.patch('/equipment-templates/:id/points/reorder', async (request, reply) => {
    const templateId = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(templateId);
    if (!tpl) return reply.code(404).send({ detail: 'Template non trouvé' });

    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return reply.code(400).send({ detail: 'ids vide' });

    const stmt = db.db.prepare('UPDATE equipment_template_points SET position = ? WHERE id = ? AND template_id = ?');
    db.db.transaction(() => {
      ids.forEach((id, i) => stmt.run((i + 1) * 10, id, templateId));
    })();

    db.auditLog.add({
      templateId, userId: request.authUser?.id, action: 'template.point.reorder',
      payload: { count: ids.length },
    });
    return { ok: true, count: ids.length };
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
