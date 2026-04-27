'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { uniqueSlug } = require('../lib/slug');
const { seedAfStructure } = require('../lib/seeder');

// ── Zod schemas ──────────────────────────────────────────────────────
const createAfSchema = z.object({
  client_name: z.string().min(1, 'Nom du client requis'),
  project_name: z.string().min(1, 'Nom du projet requis'),
  site_address: z.string().optional(),
  service_level: z.enum(['E', 'S', 'P']).nullable().optional(),
});

const updateAfSchema = z.object({
  client_name: z.string().min(1).optional(),
  project_name: z.string().min(1).optional(),
  site_address: z.string().optional(),
  service_level: z.enum(['E', 'S', 'P']).nullable().optional(),
  status: z.enum(['redaction', 'validee', 'commissioning', 'commissioned', 'livree']).optional(),
});

async function routes(fastify) {
  // GET /api/afs — liste (filtres optionnels)
  fastify.get('/afs', async (request) => {
    const { status, includeDeleted } = request.query;
    const items = db.afs.list({
      status: status || undefined,
      includeDeleted: includeDeleted === 'true',
    });
    // Enrichit avec auteur display_name
    const userIds = [...new Set(items.flatMap(a => [a.created_by, a.updated_by]).filter(Boolean))];
    const usersById = Object.fromEntries(
      userIds.map(id => [id, db.users.getById(id)?.display_name || null])
    );
    return items.map(a => ({
      ...a,
      created_by_name: usersById[a.created_by] || null,
      updated_by_name: usersById[a.updated_by] || null,
    }));
  });

  // GET /api/afs/stats — counts par status
  fastify.get('/afs/stats', async () => {
    const counts = db.afs.countByStatus();
    const out = { redaction: 0, validee: 0, commissioning: 0, commissioned: 0, livree: 0, total: 0 };
    for (const c of counts) { out[c.status] = c.count; out.total += c.count; }
    return out;
  });

  // GET /api/afs/:id — detail
  fastify.get('/afs/:id', async (request, reply) => {
    const af = db.afs.getById(parseInt(request.params.id, 10));
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });
    return {
      ...af,
      created_by_name: db.users.getById(af.created_by)?.display_name || null,
      updated_by_name: db.users.getById(af.updated_by)?.display_name || null,
      sections_count: db.db.prepare('SELECT COUNT(*) AS c FROM sections WHERE af_id = ?').get(af.id).c,
    };
  });

  // POST /api/afs — creation (declenche le seed du plan AF complet)
  fastify.post('/afs', async (request, reply) => {
    let body;
    try {
      body = createAfSchema.parse(request.body);
    } catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation échouée', errors: err.errors });
    }

    const slug = uniqueSlug(`${body.client_name}-${body.project_name}`, (s) => !!db.afs.getBySlug(s));
    const userId = request.authUser?.id;

    const af = db.afs.create({
      slug,
      clientName: body.client_name,
      projectName: body.project_name,
      siteAddress: body.site_address,
      serviceLevel: body.service_level,
      createdBy: userId,
    });

    // Seed du plan AF complet (12 chapitres + sous-sections + Hyperveez pages)
    const sectionsCount = seedAfStructure(af.id);

    db.auditLog.add({
      afId: af.id, userId, action: 'af.create',
      payload: { slug: af.slug, sections_count: sectionsCount },
    });
    log.info(`AF created: #${af.id} ${af.slug} (${sectionsCount} sections) by user #${userId}`);

    return { ...af, sections_count: sectionsCount };
  });

  // PATCH /api/afs/:id — update + transitions de statut
  fastify.patch('/afs/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    let body;
    try {
      body = updateAfSchema.parse(request.body);
    } catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation échouée' });
    }

    const userId = request.authUser?.id;
    const fields = {
      clientName: body.client_name,
      projectName: body.project_name,
      siteAddress: body.site_address,
      serviceLevel: body.service_level,
      status: body.status,
      updatedBy: userId,
    };

    // Transitions de statut auto : si on bascule vers livree, on stamp delivered_at
    if (body.status === 'livree' && af.status !== 'livree') {
      fields.deliveredAt = new Date().toISOString();
    }

    const updated = db.afs.update(id, fields);
    db.auditLog.add({
      afId: id, userId, action: 'af.update',
      payload: Object.fromEntries(Object.entries(body).filter(([_, v]) => v != null)),
    });
    return updated;
  });

  // POST /api/afs/:id/transition — bascule de statut avec gestion snapshots/milestones
  // body : { to: 'redaction'|'validee'|'commissioning'|'commissioned'|'livree', motif?, notes? }
  // Pour 'validee' et 'livree' : génère un PDF AF horodaté + tag Git + entrée milestone.
  fastify.post('/afs/:id/transition', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    const validTargets = ['redaction', 'validee', 'commissioning', 'commissioned', 'livree'];
    const { to, motif, notes } = request.body || {};
    if (!validTargets.includes(to)) {
      return reply.code(400).send({ detail: 'Statut cible invalide' });
    }
    if (to === af.status) {
      return reply.code(400).send({ detail: 'L\'AF est déjà dans cet état' });
    }

    // Snapshot + tag pour validee / livree
    const snapshotPhases = { validee: 'validation', livree: 'delivery' };
    const milestoneKind = snapshotPhases[to];
    let exportData = null;

    if (milestoneKind) {
      const transitionMotif = motif || (to === 'validee' ? 'Validation de l\'AF' : 'Livraison du DOE');
      const headers = { ...request.headers };
      delete headers['content-length'];
      delete headers['content-type'];
      const exportRes = await fastify.inject({
        method: 'POST',
        url: `/api/afs/${id}/exports/af`,
        payload: { motif: transitionMotif, includeBacsAnnex: to === 'livree' },
        headers,
      });
      if (exportRes.statusCode !== 200) {
        log.error(`Transition ${to} : échec génération PDF (${exportRes.statusCode}): ${exportRes.body}`);
        return reply.code(500).send({ detail: 'Échec de la génération du PDF de jalon' });
      }
      exportData = JSON.parse(exportRes.body);
    }

    const userId = request.authUser?.id;
    const fields = { status: to, updatedBy: userId };
    if (to === 'livree' && af.status !== 'livree') {
      fields.deliveredAt = new Date().toISOString();
    }
    db.afs.update(id, fields);

    let milestone = null;
    if (milestoneKind) {
      const datePart = new Date().toISOString().slice(0, 10);
      const gitTag = milestoneKind === 'validation'
        ? `validee-${datePart}`
        : `v1.0-livraison-DOE-${datePart}`;
      milestone = db.afInspections.create(id, {
        gitTag,
        pdfExportId: exportData.id,
        notes: notes || motif || null,
        createdBy: userId,
        kind: milestoneKind,
      });
    }

    db.auditLog.add({
      afId: id, userId,
      action: to === 'livree' ? 'af.delivered' : `af.status.${to}`,
      payload: { from: af.status, to, motif, milestone_id: milestone?.id },
    });
    log.info(`AF #${id} : transition ${af.status} → ${to} par user #${userId}`);

    return {
      af: db.afs.getById(id),
      milestone,
      pdf_export_id: exportData?.id || null,
    };
  });

  // DELETE /api/afs/:id — soft delete
  fastify.delete('/afs/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    db.afs.softDelete(id);
    db.auditLog.add({ afId: id, userId: request.authUser?.id, action: 'af.delete' });
    log.info(`AF deleted (soft): #${id} ${af.slug} by user #${request.authUser?.id}`);
    return { ok: true };
  });

  // POST /api/afs/:id/clone — duplication d'AF
  fastify.post('/afs/:id/clone', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const source = db.afs.getById(id);
    if (!source || source.deleted_at) return reply.code(404).send({ detail: 'AF source non trouvée' });

    const { client_name, project_name, site_address } = request.body || {};
    if (!client_name || !project_name) {
      return reply.code(400).send({ detail: 'client_name et project_name requis' });
    }

    const userId = request.authUser?.id;
    const slug = uniqueSlug(`${client_name}-${project_name}`, (s) => !!db.afs.getBySlug(s));

    // Transaction : cree l'AF + clone les sections + clone les overrides + clone les instances + clone les attachments (refs only)
    const cloned = db.db.transaction(() => {
      const newAf = db.afs.create({
        slug,
        clientName: client_name,
        projectName: project_name,
        siteAddress: site_address || source.site_address,
        serviceLevel: source.service_level,
        createdBy: userId,
      });

      // Clone sections en preservant la hierarchie via mapping ancien_id -> nouvel_id
      const sourceSections = db.sections.listByAf(source.id);
      const idMap = new Map();

      // Premier passage : sections root (parent_id = NULL) puis recursivement enfants
      function cloneTree(parentSourceId, parentNewId) {
        const children = sourceSections.filter(s => s.parent_id === parentSourceId);
        for (const child of children) {
          const newSec = db.sections.create({
            afId: newAf.id,
            parentId: parentNewId,
            position: child.position,
            number: child.number,
            title: child.title,
            serviceLevel: child.service_level,
            serviceLevelSource: child.service_level_source,
            bacsArticles: child.bacs_articles,
            bodyHtml: child.body_html,
            kind: child.kind,
            equipmentTemplateId: child.equipment_template_id,
            equipmentTemplateVersion: child.equipment_template_version,
            hyperveezPageSlug: child.hyperveez_page_slug,
            includedInExport: child.included_in_export,
            genericNote: child.generic_note,
          });
          idMap.set(child.id, newSec.id);
          cloneTree(child.id, newSec.id);
        }
      }
      cloneTree(null, null);

      // Clone overrides + instances par section (attachments NON clonees : on
      // veut une AF vierge cote captures pour le nouveau projet)
      const cloneOverrides = db.db.prepare(`
        INSERT INTO section_point_overrides
          (section_id, action, base_point_id, position, label, data_type, direction, unit, is_optional, created_by)
        SELECT ?, action, base_point_id, position, label, data_type, direction, unit, is_optional, ?
        FROM section_point_overrides WHERE section_id = ?
      `);
      const cloneInstances = db.db.prepare(`
        INSERT INTO equipment_instances (section_id, position, reference, location, qty, notes)
        SELECT ?, position, reference, location, qty, notes
        FROM equipment_instances WHERE section_id = ?
      `);
      for (const [oldId, newId] of idMap) {
        cloneOverrides.run(newId, userId || null, oldId);
        cloneInstances.run(newId, oldId);
      }

      return newAf;
    })();

    db.auditLog.add({
      afId: cloned.id, userId, action: 'af.clone',
      payload: { source_af_id: source.id, source_slug: source.slug },
    });
    log.info(`AF cloned: #${source.id} → #${cloned.id} (${cloned.slug}) by user #${userId}`);
    return cloned;
  });

  // GET /api/afs/:id/required-level — niveau de service minimum nécessaire (Lot 25b)
  // Query optionnelle ?excluded=12,34 pour simuler la décoche de sections
  fastify.get('/afs/:id/required-level', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    const excluded = new Set(
      (request.query.excluded || '')
        .split(',').map(s => parseInt(s, 10)).filter(Boolean)
    );

    const allSections = db.sections.listByAf(id);
    const includedSections = allSections.filter(s => s.included_in_export && !excluded.has(s.id));

    const { resolveAfLevel } = require('../lib/service-level-resolver');
    const resolved = resolveAfLevel(includedSections);

    return {
      contract_level: af.service_level || null,
      required: resolved.level,
      required_label: resolved.label,
      justifications: resolved.justifications,
      sections_evaluated: includedSections.length,
      sections_excluded: excluded.size,
      // Comparaison contrat vs requis
      shortfall: af.service_level && resolved.level
        ? (require('../lib/service-level-resolver').RANK[resolved.level] > require('../lib/service-level-resolver').RANK[af.service_level])
        : false,
    };
  });

  // GET /api/afs/:id/audit — historique (50 dernieres entrees)
  fastify.get('/afs/:id/audit', async (request) => {
    const id = parseInt(request.params.id, 10);
    return db.auditLog.recent(id, 50);
  });

  // GET /api/afs/:id/template-updates — sections avec une mise a jour de template disponible
  fastify.get('/afs/:id/template-updates', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af) return reply.code(404).send({ detail: 'AF non trouvée' });
    const { diffSectionVsTemplate } = require('../lib/template-propagation');
    const outdated = db.sections.outdatedByAf(id);
    const items = outdated.map(s => {
      const diff = diffSectionVsTemplate(s.id);
      return {
        section_id: s.id,
        section_number: s.number,
        section_title: s.title,
        template_id: s.equipment_template_id,
        template_name: s.template_name,
        template_slug: s.template_slug,
        from_version: s.equipment_template_version,
        to_version: s.current_version,
        total_changes: diff?.total_changes || 0,
        added: diff?.added || [],
        removed: diff?.removed || [],
        modified: diff?.modified || [],
        description_changed: diff?.description_changed || false,
      };
    });
    return { count: items.length, items };
  });
}

module.exports = routes;
