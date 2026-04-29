'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { resolveSectionPoints } = require('../lib/points-resolver');
const { diffSectionVsTemplate } = require('../lib/template-propagation');
const { assertWrite } = require('../lib/af-permissions');

const updateSectionSchema = z.object({
  title: z.string().min(1).optional(),
  service_level: z.string().nullable().optional(),
  bacs_articles: z.string().nullable().optional(),
  bacs_justification: z.string().nullable().optional(),
  body_html: z.string().nullable().optional(),
  included_in_export: z.boolean().optional(),
  fact_check_status: z.enum(['unverified', 'verified', 'backend_only', 'in_progress', 'documented']).optional(),
  section_template_version: z.number().int().optional(),
  opted_out_by_moa: z.boolean().optional(),
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
  tech_name: z.string().nullable().optional(),
  nature: z.enum(['Booléen', 'Numérique', 'Enum', 'Chaîne de caractères']).nullable().optional(),
});

const instanceSchema = z.object({
  reference: z.string().min(1),
  location: z.string().nullable().optional(),
  qty: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
  position: z.number().optional(),
});

const zoneSchema = z.object({
  name: z.string().min(1),
  surface_m2: z.number().nullable().optional(),
  occupation_type: z.string().nullable().optional(),
  occupation_max_personnes: z.number().int().nullable().optional(),
  horaires: z.string().nullable().optional(),
  qai_contraintes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
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
    if (!assertWrite(request, reply, afId)) return;

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
    if (!assertWrite(request, reply, section.af_id)) return;

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
    if (!assertWrite(request, reply, section.af_id)) return;

    let body;
    try { body = updateSectionSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const userId = request.authUser?.id;
    const updated = db.sections.update(id, {
      title: body.title,
      serviceLevel: body.service_level,
      bacsArticles: body.bacs_articles,
      bacsJustification: body.bacs_justification,
      bodyHtml: body.body_html,
      includedInExport: body.included_in_export == null ? undefined : (body.included_in_export ? 1 : 0),
      optedOutByMoa: body.opted_out_by_moa == null ? undefined : (body.opted_out_by_moa ? 1 : 0),
      sectionTemplateVersion: body.section_template_version,
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
    if (!assertWrite(request, reply, section.af_id)) return;

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
      techName: body.tech_name,
      nature: body.nature,
      createdBy: request.authUser?.id,
    });
    db.auditLog.add({
      afId: section.af_id, sectionId, userId: request.authUser?.id,
      action: 'section.override.add', payload: body,
    });
    return override;
  });

  // DELETE /api/sections/:id/overrides/:overrideId
  fastify.delete('/sections/:id/overrides/:overrideId', async (request, reply) => {
    const sectionId = parseInt(request.params.id, 10);
    const overrideId = parseInt(request.params.overrideId, 10);
    const section = db.sections.getById(sectionId);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (!assertWrite(request, reply, section.af_id)) return;
    db.sectionPointOverrides.delete(overrideId);
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
    if (!assertWrite(request, reply, section.af_id)) return;

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
    const inst = db.db.prepare('SELECT section_id FROM equipment_instances WHERE id = ?').get(id);
    if (!inst) return reply.code(404).send({ detail: 'Instance non trouvée' });
    const section = db.sections.getById(inst.section_id);
    if (!assertWrite(request, reply, section.af_id)) return;
    let body;
    try { body = instanceSchema.partial().parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }
    const updated = db.equipmentInstances.update(id, body);
    if (!updated) return reply.code(404).send({ detail: 'Instance non trouvée' });
    return updated;
  });

  // DELETE /api/instances/:id
  fastify.delete('/instances/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const inst = db.db.prepare('SELECT section_id FROM equipment_instances WHERE id = ?').get(id);
    if (!inst) return { ok: true };
    const section = db.sections.getById(inst.section_id);
    if (!assertWrite(request, reply, section.af_id)) return;
    db.equipmentInstances.delete(id);
    return { ok: true };
  });

  // GET /api/instances/:id/zones (Lot 32) — zones liees a une instance
  fastify.get('/instances/:id/zones', async (request) => {
    return db.instanceZones.listForInstance(parseInt(request.params.id, 10));
  });

  // PUT /api/instances/:id/zones — set la liste des zones liees (ecrase)
  fastify.put('/instances/:id/zones', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const body = request.body || {};
    const zoneIds = Array.isArray(body.zone_ids) ? body.zone_ids.map(Number).filter(Boolean) : [];
    db.instanceZones.setForInstance(id, zoneIds);
    return { ok: true, zone_ids: zoneIds };
  });

  // GET /api/instances/:id/categories — categories d'usage choisies pour cette instance
  fastify.get('/instances/:id/categories', async (request) => {
    return db.instanceCategories.listForInstance(parseInt(request.params.id, 10));
  });

  // PUT /api/instances/:id/categories — set la liste des categories (ecrase)
  fastify.put('/instances/:id/categories', async (request) => {
    const id = parseInt(request.params.id, 10);
    const body = request.body || {};
    const keys = Array.isArray(body.category_keys) ? body.category_keys.filter(Boolean) : [];
    db.instanceCategories.setForInstance(id, keys);
    return { ok: true, category_keys: keys };
  });

  // GET /api/system-categories — catalogue complet (DB-backed, Lot 32)
  fastify.get('/system-categories', async () => {
    return db.systemCategoriesDb.list();
  });

  // POST /api/system-categories — creer
  fastify.post('/system-categories', async (request, reply) => {
    const b = request.body || {};
    if (!b.key || !b.label) return reply.code(400).send({ detail: 'key + label requis' });
    if (db.systemCategoriesDb.getByKey(b.key)) return reply.code(409).send({ detail: 'Cette key existe deja' });
    const created = db.systemCategoriesDb.create({
      key: b.key, label: b.label, bacs: b.bacs, slugs: b.slugs,
      iconValue: b.icon_value, iconColor: b.icon_color, position: b.position,
    });
    return created;
  });

  // PATCH /api/system-categories/:id — modifier
  fastify.patch('/system-categories/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!db.systemCategoriesDb.getById(id)) return reply.code(404).send({ detail: 'Categorie non trouvee' });
    const b = request.body || {};
    return db.systemCategoriesDb.update(id, {
      label: b.label, bacs: b.bacs, slugs: b.slugs,
      iconValue: b.icon_value, iconColor: b.icon_color, position: b.position,
    });
  });

  // DELETE /api/system-categories/:id
  fastify.delete('/system-categories/:id', async (request) => {
    db.systemCategoriesDb.delete(parseInt(request.params.id, 10));
    return { ok: true };
  });

  // GET /api/afs/:afId/zones — toutes les zones de l'AF (utilise par le picker)
  fastify.get('/afs/:afId/all-zones', async (request) => {
    const afId = parseInt(request.params.afId, 10);
    const zonesSection = db.sections.listByAf(afId).find(s => s.kind === 'zones');
    if (!zonesSection) return [];
    return db.afZones.listBySection(zonesSection.id);
  });

  // GET /api/afs/:afId/zones-matrix — matrice synthese zones × categories de systemes
  // Retourne uniquement les categories ayant au moins 1 instance dans le projet.
  // Categories : choix explicite par instance (table equipment_instance_categories).
  // Fallback : si une instance n'a aucun choix → toutes les categories candidates
  // de son template (legacy / nouvelles instances pas encore configurees).
  fastify.get('/afs/:afId/zones-matrix', async (request) => {
    const afId = parseInt(request.params.afId, 10);
    const { loadCategoriesFromDb, normalizeText } = require('../lib/system-categories');
    const SYSTEM_CATEGORIES = loadCategoriesFromDb();
    const allSections = db.sections.listByAf(afId);
    const zonesSection = allSections.find(s => s.kind === 'zones');
    const zones = zonesSection ? db.afZones.listBySection(zonesSection.id) : [];

    // Charge toutes les instances + slug template + categories candidates du template
    const allInstances = [];
    for (const s of allSections) {
      if (s.kind !== 'equipment' || !s.equipment_template_id) continue;
      const tpl = db.equipmentTemplates.getById(s.equipment_template_id);
      if (!tpl) continue;
      const candidateKeys = SYSTEM_CATEGORIES.filter(c => c.slugs.includes(tpl.slug)).map(c => c.key);
      const insts = db.equipmentInstances.listBySection(s.id);
      for (const i of insts) allInstances.push({ ...i, slug: tpl.slug, candidateKeys });
    }

    // Categories choisies par instance
    const catRows = db.instanceCategories.listForAf(afId);
    const catsByInstance = new Map();
    for (const r of catRows) {
      if (!catsByInstance.has(r.instance_id)) catsByInstance.set(r.instance_id, new Set());
      catsByInstance.get(r.instance_id).add(r.category_key);
    }
    function instanceMatchesCategory(inst, catKey) {
      const chosen = catsByInstance.get(inst.id);
      if (chosen && chosen.size > 0) return chosen.has(catKey);
      // Fallback : utilise les categories candidates du template
      return inst.candidateKeys.includes(catKey);
    }

    // Liens explicites instance↔zone
    const linkRows = db.instanceZones.listForAf(afId);
    const zonesByInstance = new Map();
    for (const r of linkRows) {
      if (!zonesByInstance.has(r.instance_id)) zonesByInstance.set(r.instance_id, new Set());
      zonesByInstance.get(r.instance_id).add(r.zone_id);
    }
    function instanceMatchesZone(inst, zone) {
      const linked = zonesByInstance.get(inst.id);
      if (linked && linked.size > 0) return linked.has(zone.id);
      const loc = normalizeText(inst.location);
      return loc && loc.includes(normalizeText(zone.name));
    }

    // Pre-calcule le total d'instances par categorie (pour filtrer les colonnes vides)
    const totalsByCat = SYSTEM_CATEGORIES.map(cat => {
      let n = 0;
      for (const inst of allInstances) if (instanceMatchesCategory(inst, cat.key)) n += (inst.qty || 1);
      return n;
    });
    const visibleCategories = SYSTEM_CATEGORIES
      .map((cat, idx) => ({ ...cat, total: totalsByCat[idx] }))
      .filter(c => c.total > 0);

    // Pour chaque zone, compte les instances par categorie visible
    const matrix = zones.map(z => {
      const cells = visibleCategories.map(cat => {
        let count = 0;
        for (const inst of allInstances) {
          if (!instanceMatchesCategory(inst, cat.key)) continue;
          if (instanceMatchesZone(inst, z)) count += (inst.qty || 1);
        }
        return count;
      });
      const total = cells.reduce((a, b) => a + b, 0);
      return { id: z.id, name: z.name, surface_m2: z.surface_m2, cells, total };
    });

    // Ligne "non zone" : instances qui ne matchent aucune zone
    const unzonedByCat = visibleCategories.map(cat => {
      let n = 0;
      for (const inst of allInstances) {
        if (!instanceMatchesCategory(inst, cat.key)) continue;
        const linked = zonesByInstance.get(inst.id);
        const isLinked = linked && linked.size > 0;
        const loc = normalizeText(inst.location);
        const hasMatch = isLinked || (loc && zones.some(z => loc.includes(normalizeText(z.name))));
        if (!hasMatch) n += (inst.qty || 1);
      }
      return n;
    });
    const totalUnzoned = unzonedByCat.reduce((a, b) => a + b, 0);

    return {
      categories: visibleCategories,
      zones: matrix,
      unzoned: { cells: unzonedByCat, total: totalUnzoned },
      totalsByCategory: visibleCategories.map((_, i) =>
        matrix.reduce((acc, row) => acc + row.cells[i], 0) + unzonedByCat[i]
      ),
    };
  });

  // ── Zones fonctionnelles (Lot 26) ─────────────────────────────────
  fastify.get('/sections/:id/zones', async (request) => {
    const sectionId = parseInt(request.params.id, 10);
    return db.afZones.listBySection(sectionId);
  });

  fastify.post('/sections/:id/zones', async (request, reply) => {
    const sectionId = parseInt(request.params.id, 10);
    const section = db.sections.getById(sectionId);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (!assertWrite(request, reply, section.af_id)) return;
    let body;
    try { body = zoneSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }
    const zone = db.afZones.create(sectionId, {
      position: body.position,
      name: body.name,
      surfaceM2: body.surface_m2,
      occupationType: body.occupation_type,
      occupationMaxPersonnes: body.occupation_max_personnes,
      horaires: body.horaires,
      qaiContraintes: body.qai_contraintes,
      notes: body.notes,
    });
    db.auditLog.add({ afId: section.af_id, sectionId, userId: request.authUser?.id, action: 'zone.add', payload: { name: body.name } });
    return zone;
  });

  fastify.patch('/zones/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const zoneRow = db.db.prepare('SELECT section_id FROM af_zones WHERE id = ?').get(id);
    if (zoneRow) {
      const sec = db.sections.getById(zoneRow.section_id);
      if (sec && !assertWrite(request, reply, sec.af_id)) return;
    }
    let body;
    try { body = zoneSchema.partial().parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }
    const updated = db.afZones.update(id, {
      position: body.position,
      name: body.name,
      surfaceM2: body.surface_m2,
      occupationType: body.occupation_type,
      occupationMaxPersonnes: body.occupation_max_personnes,
      horaires: body.horaires,
      qaiContraintes: body.qai_contraintes,
      notes: body.notes,
    });
    if (!updated) return reply.code(404).send({ detail: 'Zone non trouvée' });
    return updated;
  });

  fastify.delete('/zones/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const zoneRow = db.db.prepare('SELECT section_id FROM af_zones WHERE id = ?').get(id);
    if (zoneRow) {
      const sec = db.sections.getById(zoneRow.section_id);
      if (sec && !assertWrite(request, reply, sec.af_id)) return;
    }
    db.afZones.delete(id);
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
