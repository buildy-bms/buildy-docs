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

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  body_html: z.string().nullable().optional(),
  bacs_articles: z.string().nullable().optional(),
  service_level: z.string().nullable().optional(),
});

const createSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  slug: z.string().optional(),
  kind: z.enum(['standard', 'equipment', 'synthesis', 'hyperveez_page']).optional(),
  body_html: z.string().nullable().optional(),
  bacs_articles: z.string().nullable().optional(),
  service_level: z.string().nullable().optional(),
  is_functionality: z.boolean().optional(),
});

const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
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

async function routes(fastify) {
  fastify.get('/section-templates', async (request) => {
    const kind = String(request.query?.kind || '').toLowerCase();
    return db.sectionTemplates.list(
      kind === 'functionality' || kind === 'standard' ? { kind } : {}
    );
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

    const created = db.sectionTemplates.create({
      slug: candidate,
      title: body.title,
      kind: body.kind || 'standard',
      bodyHtml: body.body_html || null,
      bacsArticles: body.bacs_articles || null,
      serviceLevel: body.service_level || null,
      isFunctionality: body.is_functionality === true,
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

    const affected = db.sectionTemplates.countAffectedAfs(id);
    if (affected > 0) {
      return reply.code(409).send({ detail: `${affected} AF(s) utilisent cette section type — suppression refusée.` });
    }

    db.sectionTemplates.delete(id);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'section_template.delete',
      payload: { id, slug: tpl.slug },
    });
    return reply.code(204).send();
  });

  fastify.patch('/section-templates/reorder', async (request, reply) => {
    let body;
    try { body = reorderSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    db.sectionTemplates.reorder(body.ids);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'section_template.reorder',
      payload: { count: body.ids.length },
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

    const propagate = String(request.query.propagate_unchanged || '') === '1';
    const userId = request.authUser?.id;

    // Snapshots avant update pour propagation
    const oldBody = tpl.body_html;
    const oldBacs = tpl.bacs_articles;
    const oldLevel = tpl.service_level;
    const newBody = body.body_html === undefined ? oldBody : body.body_html;
    const newBacs = body.bacs_articles === undefined ? oldBacs : body.bacs_articles;
    const newLevel = body.service_level === undefined ? oldLevel : body.service_level;
    const bodyChanged = body.body_html !== undefined && newBody !== oldBody;
    const bacsChanged = body.bacs_articles !== undefined && newBacs !== oldBacs;
    const levelChanged = body.service_level !== undefined && newLevel !== oldLevel;

    db.sectionTemplates.update(id, {
      title: body.title,
      bodyHtml: body.body_html,
      bacsArticles: body.bacs_articles,
      serviceLevel: body.service_level,
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
