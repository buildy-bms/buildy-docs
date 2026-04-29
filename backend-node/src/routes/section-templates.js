'use strict';

/**
 * Bibliothèque "Sections types" + "Fonctionnalités".
 *
 * Sections types et fonctionnalités partagent la même table mais sont
 * séparées par le flag `is_functionality`. Listing filtrable via `?kind=`.
 * Édition + propagation auto aux AFs existantes où le contenu n'a pas
 * été personnalisé.
 */

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;

const availEnum = z.enum(['included', 'paid_option']).nullable().optional();

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  body_html: z.string().nullable().optional(),
  bacs_articles: z.string().nullable().optional(),
  service_level: z.string().nullable().optional(),
  avail_e: availEnum,
  avail_s: availEnum,
  avail_p: availEnum,
  kind: z.enum(['standard', 'equipment', 'synthesis', 'zones', 'hyperveez_page']).optional(),
  parent_template_id: z.number().int().positive().nullable().optional(),
  equipment_template_id: z.number().int().positive().nullable().optional(),
});

const createSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  slug: z.string().optional(),
  kind: z.enum(['standard', 'equipment', 'synthesis', 'zones', 'hyperveez_page']).optional(),
  body_html: z.string().nullable().optional(),
  bacs_articles: z.string().nullable().optional(),
  service_level: z.string().nullable().optional(),
  avail_e: availEnum,
  avail_s: availEnum,
  avail_p: availEnum,
  is_functionality: z.boolean().optional(),
  parent_template_id: z.number().int().positive().nullable().optional(),
  equipment_template_id: z.number().int().positive().nullable().optional(),
});

// Service level derive de la matrice avail_e/s/p :
// - inclus a E -> 'E' (couvre tout le monde)
// - inclus a S et/ou P, pas a E -> 'S/P' ou 'P'
// - aucun niveau ne l'inclut -> NULL
function deriveServiceLevel({ avail_e, avail_s, avail_p }) {
  const e = avail_e === 'included';
  const s = avail_s === 'included';
  const p = avail_p === 'included';
  if (e && s && p) return 'E/S/P';
  if (e && (s || p)) return 'E/S/P';
  if (e) return 'E';
  if (s && p) return 'S/P';
  if (s) return 'S';
  if (p) return 'P';
  return null;
}

const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  // Optionnel : si fourni, met aussi a jour parent_template_id (re-parenting drag-drop)
  parent_template_id: z.number().int().positive().nullable().optional(),
});

function slugify(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

// Construit l'arbre a partir de la liste plate (parent_template_id + position).
function buildTree(rows) {
  const byParent = new Map();
  for (const r of rows) {
    const k = r.parent_template_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(r);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  function build(parentId) {
    return (byParent.get(parentId || 0) || []).map(r => ({
      ...r,
      children: build(r.id),
    }));
  }
  return build(0);
}

async function routes(fastify) {
  fastify.get('/section-templates', async (request) => {
    const kind = String(request.query?.kind || '').toLowerCase();
    const asTree = String(request.query?.tree || '') === '1';
    const filter = (kind === 'functionality' || kind === 'standard') ? { kind } : {};
    if (asTree) {
      // En mode tree, on retourne TOUS les rows (sans filter is_functionality)
      // pour que la structure parent/enfant reste coherente.
      return buildTree(db.sectionTemplates.list({}));
    }
    return db.sectionTemplates.list(filter);
  });

  fastify.get('/section-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Section type non trouvée' });
    return tpl;
  });

  fastify.post('/section-templates', async (request, reply) => {
    let body;
    try { body = createSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    let slug = body.slug ? slugify(body.slug) : slugify(body.title);
    // Garantir l'unicite du slug (suffixe numerique si collision).
    let candidate = slug;
    let suffix = 2;
    while (db.sectionTemplates.getBySlug(candidate)) {
      candidate = `${slug}-${suffix++}`;
    }

    const availProvided = body.avail_e !== undefined || body.avail_s !== undefined || body.avail_p !== undefined;
    const derivedLevel = availProvided
      ? deriveServiceLevel({ avail_e: body.avail_e, avail_s: body.avail_s, avail_p: body.avail_p })
      : (body.service_level || null);

    const created = db.sectionTemplates.create({
      slug: candidate,
      title: body.title,
      kind: body.kind || 'standard',
      bodyHtml: body.body_html || null,
      bacsArticles: body.bacs_articles || null,
      serviceLevel: derivedLevel,
      availE: body.avail_e || null,
      availS: body.avail_s || null,
      availP: body.avail_p || null,
      isFunctionality: body.is_functionality === true,
      parentTemplateId: body.parent_template_id ?? null,
      equipmentTemplateId: body.equipment_template_id ?? null,
    });

    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'section_template.create',
      payload: { id: created.id, slug: created.slug, is_functionality: created.is_functionality },
    });

    return reply.code(201).send(created);
  });

  fastify.delete('/section-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Section type non trouvée' });

    const force = String(request.query?.force || '') === '1';
    const affected = db.sectionTemplates.countAffectedAfs(id);

    if (affected > 0 && !force) {
      // L'UI doit re-poser la question avec ?force=1 si l'utilisateur confirme.
      return reply.code(409).send({
        detail: `${affected} AF(s) utilisent cette section type. Confirmer pour la supprimer dans toutes les AFs.`,
        affected_count: affected,
      });
    }

    let cascadeCount = 0;
    if (force && affected > 0) {
      // Cascade : retire la section de toutes les AFs vivantes
      const r = db.db.prepare(`
        DELETE FROM sections
         WHERE section_template_id = ?
           AND af_id IN (SELECT id FROM afs WHERE deleted_at IS NULL)
      `).run(id);
      cascadeCount = r.changes;
    }

    db.sectionTemplates.delete(id);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'section_template.delete',
      payload: { id, slug: tpl.slug, cascade: cascadeCount },
    });
    return reply.code(200).send({ ok: true, cascade_count: cascadeCount });
  });

  fastify.patch('/section-templates/reorder', async (request, reply) => {
    let body;
    try { body = reorderSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    // Si re-parenting demande, garde-fou anti-cycle pour chaque id.
    if (body.parent_template_id != null) {
      for (const id of body.ids) {
        if (db.sectionTemplates.wouldCreateCycle(id, body.parent_template_id)) {
          return reply.code(409).send({ detail: 'Cycle détecté : impossible de placer une section sous l\'un de ses descendants.' });
        }
      }
    }

    db.sectionTemplates.reorder({
      parentTemplateId: body.parent_template_id !== undefined ? body.parent_template_id : undefined,
      ids: body.ids,
    });
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'section_template.reorder',
      payload: { count: body.ids.length, parent_template_id: body.parent_template_id ?? null },
    });
    return { ok: true, count: body.ids.length };
  });

  fastify.patch('/section-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Section type non trouvée' });

    let body;
    try { body = updateSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    // Garde-fou anti-cycle si on change parent_template_id.
    if (body.parent_template_id !== undefined && body.parent_template_id !== null) {
      if (db.sectionTemplates.wouldCreateCycle(id, body.parent_template_id)) {
        return reply.code(409).send({ detail: 'Cycle détecté : impossible de placer une section sous l\'un de ses descendants.' });
      }
    }

    const propagate = String(request.query.propagate_unchanged || '') === '1';
    const userId = request.authUser?.id;

    // Snapshots avant update pour propagation
    const oldBody = tpl.body_html;
    const oldBacs = tpl.bacs_articles;
    const oldLevel = tpl.service_level;
    const newBody = body.body_html === undefined ? oldBody : body.body_html;
    const newBacs = body.bacs_articles === undefined ? oldBacs : body.bacs_articles;

    // Si avail_* est fourni, on derive service_level. Sinon on garde la
    // valeur explicite envoyee (compat ascendante).
    const availProvided = body.avail_e !== undefined || body.avail_s !== undefined || body.avail_p !== undefined;
    const newAvailE = body.avail_e !== undefined ? body.avail_e : tpl.avail_e;
    const newAvailS = body.avail_s !== undefined ? body.avail_s : tpl.avail_s;
    const newAvailP = body.avail_p !== undefined ? body.avail_p : tpl.avail_p;
    const derivedLevel = availProvided
      ? deriveServiceLevel({ avail_e: newAvailE, avail_s: newAvailS, avail_p: newAvailP })
      : (body.service_level !== undefined ? body.service_level : oldLevel);
    const newLevel = derivedLevel;
    const bodyChanged = body.body_html !== undefined && newBody !== oldBody;
    const bacsChanged = body.bacs_articles !== undefined && newBacs !== oldBacs;
    const levelChanged = newLevel !== oldLevel;

    db.sectionTemplates.update(id, {
      title: body.title,
      bodyHtml: body.body_html,
      bacsArticles: body.bacs_articles,
      kind: body.kind,
      parentTemplateId: body.parent_template_id,
      equipmentTemplateId: body.equipment_template_id,
      availE: body.avail_e,
      availS: body.avail_s,
      availP: body.avail_p,
      // Service level : derive de avail_* si fourni, sinon valeur explicite
      serviceLevel: availProvided ? derivedLevel : body.service_level,
      updatedBy: userId || null,
    });

    let propagatedCount = 0;
    let levelSynced = 0;
    let bacsSynced = 0;
    if (bodyChanged || bacsChanged || levelChanged) {
      db.sectionTemplates.bumpVersion(id);
      const newVersion = db.sectionTemplates.getById(id).current_version;
      if (propagate) {
        if (bodyChanged) {
          propagatedCount = db.sectionTemplates.propagateUnchanged(id, oldBody, newBody, newVersion);
        }
        if (bacsChanged) {
          bacsSynced = db.sectionTemplates.propagateBacsUnchanged(id, oldBacs, newBacs, newVersion);
        }
        if (levelChanged) {
          // Le niveau est une meta, jamais editee par section : toujours synchroniser.
          levelSynced = db.sectionTemplates.syncServiceLevel(id, newLevel, newVersion);
        }
        log.info(`Section template #${id} : ${propagatedCount} body, ${bacsSynced} BACS, ${levelSynced} niveau(x) propages (user #${userId})`);
      }
    }

    db.auditLog.add({
      userId,
      action: 'section_template.update',
      payload: { id, fields: Object.keys(body), body_propagated: propagatedCount, bacs_propagated: bacsSynced, level_synced: levelSynced },
    });

    const updated = db.sectionTemplates.getById(id);
    return { ...updated, propagated_count: propagatedCount + bacsSynced + levelSynced };
  });
}

module.exports = routes;
