'use strict';

/**
 * Lot 30 — Bibliothèque "Sections types".
 *
 * CRUD restreint (pas de POST ni DELETE en V1) sur les contenus canoniques
 * des sections standard / zones du plan AF. Édition + propagation auto aux
 * AFs existantes où le contenu n'a pas été personnalisé.
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

async function routes(fastify) {
  fastify.get('/section-templates', async () => db.sectionTemplates.list());

  fastify.get('/section-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Section type non trouvée' });
    return tpl;
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
