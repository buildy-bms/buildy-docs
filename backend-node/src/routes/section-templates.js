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
const { DOCUMENT_KINDS, DOCUMENT_KINDS_VALUES } = require('../seeds/document-kinds');

const availEnum = z.enum(['included', 'paid_option']).nullable().optional();
const documentKindsSchema = z.array(z.enum(DOCUMENT_KINDS_VALUES)).min(1, 'Au moins un type de document requis');

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
  icon_name: z.string().nullable().optional(),
  document_kinds: documentKindsSchema.optional(),
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
  icon_name: z.string().nullable().optional(),
  document_kinds: documentKindsSchema.optional(),
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

const bulkDocumentKindsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'Au moins une section requise'),
  action: z.enum(['add', 'remove', 'replace']),
  kinds: z.array(z.enum(DOCUMENT_KINDS_VALUES)).min(1, 'Au moins un type de document requis'),
  cascade: z.boolean().optional().default(true),
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
  // GET /api/section-templates/document-kinds — catalogue des types de documents
  // (kind + label + description) pour alimenter le multi-select de l'UI biblio.
  fastify.get('/section-templates/document-kinds', async () => {
    return DOCUMENT_KINDS;
  });

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
    // Si on recree un slug qui etait tombstone (anti-reseed), on leve le
    // tombstone pour que le seed normal le respecte de nouveau ulterieurement.
    db.deletedSectionTemplateSlugs.remove(candidate);

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
      iconName: body.icon_name || null,
    });

    // Tagging document_kinds : pris du body si fourni, sinon defaut ['af'].
    // Pas de cascade sur create (pas d'enfants encore).
    const kinds = Array.isArray(body.document_kinds) && body.document_kinds.length
      ? body.document_kinds
      : ['af'];
    db.sectionTemplates.setDocumentKinds(created.id, kinds, { cascade: false });

    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'section_template.create',
      payload: { id: created.id, slug: created.slug, is_functionality: created.is_functionality, document_kinds: kinds },
    });

    return reply.code(201).send(db.sectionTemplates.getById(created.id));
  });

  // POST /api/section-templates/:id/clone — duplique la section type + tout
  // son sous-arbre (récursif). Le titre du root est suffixé (par défaut
  // « (copie) ») ; les descendants conservent leur titre. Slug unique
  // généré pour chaque node. Attachments répliquées (mêmes fichiers).
  fastify.post('/section-templates/:id/clone', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const src = db.sectionTemplates.getById(id);
    if (!src) return reply.code(404).send({ detail: 'Section type non trouvée' });
    const newTitle = (request.body?.title || `${src.title} (copie)`).trim();
    if (!newTitle) return reply.code(400).send({ detail: 'Titre requis' });
    try {
      const { newRootId, clonedCount } = db.sectionTemplates.cloneSubtree(id, {
        newTitle,
        slugifyTitle: slugify,
        userId: request.authUser?.id,
      });
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'section_template.clone',
        payload: { source_id: id, source_slug: src.slug, new_id: newRootId, cloned_count: clonedCount },
      });
      log.info(`Section template cloned: #${id} → #${newRootId} (${clonedCount} node(s)) by user #${request.authUser?.id}`);
      const created = db.sectionTemplates.getById(newRootId);
      return reply.code(201).send({ ...created, cloned_count: clonedCount });
    } catch (err) {
      log.error({ err }, 'Clone section_template failed');
      return reply.code(500).send({ detail: err.message || 'Échec du clonage' });
    }
  });

  // POST /api/section-templates/:id/validate-content — marque le contenu
  // comme valide (date + auteur). Toute modif ulterieure du body_html
  // re-clear ce statut automatiquement (sectionTemplates.update).
  fastify.post('/section-templates/:id/validate-content', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Section type non trouvée' });
    const userId = request.authUser?.id;
    const updated = db.sectionTemplates.validateContent(id, userId);
    db.auditLog.add({ userId, action: 'section_template.validate_content', payload: { id } });
    return updated;
  });

  // DELETE /api/section-templates/:id/validate-content — repasse en brouillon.
  fastify.delete('/section-templates/:id/validate-content', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Section type non trouvée' });
    const updated = db.sectionTemplates.unvalidateContent(id);
    db.auditLog.add({ userId: request.authUser?.id, action: 'section_template.unvalidate_content', payload: { id } });
    return updated;
  });

  fastify.delete('/section-templates/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    if (!tpl) return reply.code(404).send({ detail: 'Section type non trouvée' });

    const force = String(request.query?.force || '') === '1';
    const affected = db.sectionTemplates.countAffectedAfs(id); // AFs vivantes uniquement

    if (affected > 0 && !force) {
      // L'UI doit re-poser la question avec ?force=1 si l'utilisateur confirme.
      return reply.code(409).send({
        detail: `${affected} AF(s) utilisent cette section type. Confirmer pour la supprimer dans toutes les AFs.`,
        affected_count: affected,
      });
    }

    // Cascade systematique : on retire les sections AVANT de supprimer le template
    // (sinon FK constraint viole : sections.section_template_id -> section_templates.id).
    // On retire toutes les sections, y compris celles d'AFs archivees, qui sont
    // ce qui causait des 500 quand affected_count etait 0 mais qu'il restait des
    // references "fantomes".
    const r = db.db.prepare('DELETE FROM sections WHERE section_template_id = ?').run(id);
    const cascadeCount = r.changes;

    db.sectionTemplates.delete(id);
    // Tombstone : empeche la recreation au prochain boot par seedSectionTemplates.
    db.deletedSectionTemplateSlugs.add(tpl.slug);

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
      iconName: body.icon_name,
      // Service level : derive de avail_* si fourni, sinon valeur explicite
      serviceLevel: availProvided ? derivedLevel : body.service_level,
      updatedBy: userId || null,
    });

    // Multi-tagging des types de documents : si fourni, MAJ + cascade aux
    // descendants (pattern feedback_section_flags_cascade.md). Le query param
    // `?cascade_document_kinds=0` desactive la cascade pour les cas avances
    // (override d'un enfant). Defaut : cascade activee.
    let documentKindsCascaded = 0;
    if (body.document_kinds !== undefined) {
      const cascade = String(request.query.cascade_document_kinds || '1') !== '0';
      const result = db.sectionTemplates.setDocumentKinds(id, body.document_kinds, { cascade });
      documentKindsCascaded = result.cascaded;
    }

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
      payload: {
        id, fields: Object.keys(body),
        body_propagated: propagatedCount, bacs_propagated: bacsSynced, level_synced: levelSynced,
        document_kinds_cascaded: documentKindsCascaded,
      },
    });

    const updated = db.sectionTemplates.getById(id);
    return { ...updated, propagated_count: propagatedCount + bacsSynced + levelSynced, document_kinds_cascaded: documentKindsCascaded };
  });

  // POST /api/section-templates/bulk-document-kinds — modification en bulk
  // des tags document_kinds sur plusieurs sections types. Modes : 'add' /
  // 'remove' / 'replace'. Cascade ON par defaut (les descendants suivent).
  fastify.post('/section-templates/bulk-document-kinds', async (request, reply) => {
    let body;
    try { body = bulkDocumentKindsSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    const result = db.sectionTemplates.bulkUpdateDocumentKinds({
      ids: body.ids,
      action: body.action,
      kinds: body.kinds,
      cascade: body.cascade !== false,
    });

    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'section_template.bulk_document_kinds',
      payload: {
        ids_count: body.ids.length,
        bulk_action: body.action,
        kinds: body.kinds,
        cascade: body.cascade !== false,
        affected: result.affected,
        cascaded: result.cascaded,
      },
    });

    log.info(`Bulk document_kinds : action=${body.action}, kinds=[${body.kinds.join(',')}], ids=${body.ids.length}, affected=${result.affected}, cascaded=${result.cascaded} (user #${request.authUser?.id})`);

    return { ok: true, ...result };
  });

  // ── Versionnage / restauration du body_html ───────────────────────────
  // GET /api/section-templates/:id/versions
  // Liste les snapshots du body_html, du plus recent au plus ancien.
  // Le payload `snapshot` n'est pas renvoye ici : la liste reste legere
  // (utilisee dans le panneau historique). Pour lire un snapshot complet,
  // POST /restore qui le charge dans la modale d'edition.
  fastify.get('/section-templates/:id/versions', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const t = db.sectionTemplates.getById(id);
    if (!t) return reply.code(404).send({ detail: 'Modèle non trouvé' });
    const versions = db.sectionTemplateVersions.listByTemplate(id);
    // Decode le snapshot pour exposer body_html (texte brut tronque pour preview)
    return versions.map(v => {
      let body_html = null;
      try {
        const row = db.db.prepare('SELECT snapshot FROM section_template_versions WHERE id = ?').get(v.id);
        const parsed = row && row.snapshot ? JSON.parse(row.snapshot) : null;
        body_html = parsed?.body_html || null;
      } catch { /* ignore */ }
      const text = (body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        id: v.id,
        version: v.version,
        author_name: v.author_name,
        created_at: v.created_at,
        preview: text.length > 240 ? text.slice(0, 240) + '…' : text,
        body_length: (body_html || '').length,
      };
    });
  });

  // GET /api/section-templates/:id/versions/:versionId — snapshot complet
  // (pour l'apercu plein texte avant de restaurer).
  fastify.get('/section-templates/:id/versions/:versionId', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const versionId = parseInt(request.params.versionId, 10);
    const row = db.sectionTemplateVersions.getById(versionId);
    if (!row || row.template_id !== id) return reply.code(404).send({ detail: 'Version non trouvée' });
    let snapshot;
    try { snapshot = JSON.parse(row.snapshot); }
    catch { return reply.code(500).send({ detail: 'Snapshot illisible' }); }
    return {
      id: row.id, version: row.version, created_at: row.created_at,
      body_html: snapshot.body_html || null,
      title: snapshot.title || null,
    };
  });
}

module.exports = routes;
