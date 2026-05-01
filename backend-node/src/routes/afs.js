'use strict';

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { uniqueSlug } = require('../lib/slug');
const { seedAfStructure, seedBacsAuditStructure } = require('../lib/seeder');
const { assertWrite } = require('../lib/af-permissions');

// ── Zod schemas ──────────────────────────────────────────────────────
const createAfSchema = z.object({
  client_name: z.string().min(1, 'Nom du client requis'),
  project_name: z.string().min(1, 'Nom du projet requis'),
  site_address: z.string().optional(),
  service_level: z.enum(['E', 'S', 'P']).nullable().optional(),
  // Multi-domaines (Buildy Docs) : kind + site_id. Pour 'bacs_audit', le site
  // est obligatoire (le plan canonique pre-rempli a besoin des zones du site).
  kind: z.enum(['af', 'bacs_audit', 'brochure']).optional().default('af'),
  site_id: z.number().int().positive().nullable().optional(),
  title: z.string().optional(),
});

const updateAfSchema = z.object({
  client_name: z.string().min(1).optional(),
  project_name: z.string().min(1).optional(),
  site_address: z.string().optional(),
  service_level: z.enum(['E', 'S', 'P']).nullable().optional(),
  status: z.enum(['redaction', 'validee', 'commissioning', 'commissioned', 'livree']).optional(),
  title: z.string().nullable().optional(),
  // Audit BACS : applicabilite R175-2
  bacs_total_power_kw: z.number().nullable().optional(),
  bacs_total_power_source: z.enum(['auto', 'manual_override']).optional(),
  bacs_building_permit_date: z.string().nullable().optional(),
  bacs_district_heating_substation_kw: z.number().nullable().optional(),
  bacs_generator_works_date: z.string().nullable().optional(),
  bacs_roi_study_status: z.string().nullable().optional(),
  bacs_roi_study_html: z.string().nullable().optional(),
  audit_existing_af_status: z.string().nullable().optional(),
  audit_synthesis_html: z.string().nullable().optional(),
  audit_synthesis_generated_at: z.string().nullable().optional(),
});

/**
 * Calcule l'applicabilite BACS R175-2 selon la puissance cumulee chauffage+clim
 * et la date du permis de construire.
 *
 * Regles synthetisees :
 * - puissance < 70 kW => not_subject (hors champ)
 * - puissance >= 290 kW => subject_2025 (echeance 1er janvier 2025)
 *   - sauf si PC > 8 avril 2024 => subject_immediate (s'applique a la livraison)
 * - 70 kW <= puissance < 290 kW => subject_2027 (echeance 1er janvier 2027)
 *
 * Retourne { status, deadline } ou null si la puissance n'est pas renseignee.
 */
function computeBacsApplicability(powerKw, buildingPermitDate) {
  if (powerKw == null || isNaN(powerKw)) return null;
  if (powerKw < 70) {
    return { status: 'not_subject', deadline: null };
  }
  if (powerKw >= 290) {
    if (buildingPermitDate && Date.parse(buildingPermitDate) >= Date.parse('2024-04-08')) {
      return { status: 'subject_immediate', deadline: buildingPermitDate };
    }
    return { status: 'subject_2025', deadline: '2025-01-01' };
  }
  return { status: 'subject_2027', deadline: '2027-01-01' };
}

async function routes(fastify) {
  // GET /api/afs — liste (filtres optionnels)
  fastify.get('/afs', async (request) => {
    const { status, includeDeleted, kind, site_id } = request.query;
    let items = db.afs.list({
      status: status || undefined,
      includeDeleted: includeDeleted === 'true',
    });
    // Filtres post-list (le helper db.afs.list ne supporte pas encore kind/site_id)
    if (kind) items = items.filter(a => (a.kind || 'af') === kind);
    if (site_id) {
      const sid = parseInt(site_id, 10);
      items = items.filter(a => a.site_id === sid);
    }
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

  // GET /api/afs/search?q=... — recherche etendue cross-tables.
  // Retourne af_ids (afs qui matchent quelque part : titre, contenu BACS,
  // notes, action items, ...) + site_hits (sites sans af attache qui
  // matchent) + library_hits (fonctionnalites/sections types biblio).
  fastify.get('/afs/search', async (request) => {
    const q = (request.query?.q || '').trim();
    if (q.length < 2) return { af_ids: [], library_hits: [], site_hits: [] };
    const like = `%${q}%`;
    const afIds = new Set();
    const collect = (rows) => rows.forEach(r => r.af_id && afIds.add(r.af_id));
    collect(db.db.prepare(`SELECT id AS af_id FROM afs
      WHERE deleted_at IS NULL AND (client_name LIKE ? OR project_name LIKE ?
        OR site_address LIKE ? OR title LIKE ? OR audit_synthesis_html LIKE ?)`)
      .all(like, like, like, like, like));
    collect(db.db.prepare(`SELECT a.id AS af_id FROM afs a
      JOIN sites s ON s.site_id = a.site_id
      WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL
        AND (s.name LIKE ? OR s.customer_name LIKE ? OR s.address LIKE ?)`)
      .all(like, like, like));
    collect(db.db.prepare(`SELECT DISTINCT document_id AS af_id
      FROM bacs_audit_action_items WHERE title LIKE ? OR description LIKE ?
        OR commercial_notes LIKE ? OR alternative_solutions_html LIKE ?`)
      .all(like, like, like, like));
    collect(db.db.prepare(`SELECT DISTINCT document_id AS af_id
      FROM bacs_audit_systems WHERE notes LIKE ? OR notes_html LIKE ?`)
      .all(like, like));
    collect(db.db.prepare(`SELECT DISTINCT s.document_id AS af_id
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      WHERE d.name LIKE ? OR d.brand LIKE ? OR d.model_reference LIKE ?
        OR d.notes LIKE ? OR d.notes_html LIKE ?`)
      .all(like, like, like, like, like));
    collect(db.db.prepare(`SELECT DISTINCT document_id AS af_id
      FROM bacs_audit_meters WHERE notes LIKE ? OR notes_html LIKE ?`)
      .all(like, like));
    collect(db.db.prepare(`SELECT DISTINCT document_id AS af_id
      FROM bacs_audit_bms WHERE existing_solution LIKE ? OR existing_solution_brand LIKE ?
        OR location LIKE ? OR model_reference LIKE ? OR notes_html LIKE ?
        OR notes_data_provision LIKE ?`)
      .all(like, like, like, like, like, like));
    const siteHits = db.db.prepare(`SELECT site_id, site_uuid, name, customer_name, address
      FROM sites WHERE deleted_at IS NULL AND (name LIKE ? OR customer_name LIKE ? OR address LIKE ?)
      LIMIT 10`).all(like, like, like);
    const libraryHits = db.db.prepare(`SELECT id, slug, number, title, kind, is_functionality
      FROM section_templates WHERE title LIKE ? OR body_html LIKE ? OR bacs_articles LIKE ?
      ORDER BY is_functionality DESC, number LIMIT 20`).all(like, like, like);
    return { af_ids: [...afIds], site_hits: siteHits, library_hits: libraryHits };
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
    const site = af.site_id ? db.sites.getById(af.site_id) : null;
    return {
      ...af,
      site_uuid: site?.site_uuid || null,
      site_name: site?.name || null,
      created_by_name: db.users.getById(af.created_by)?.display_name || null,
      updated_by_name: db.users.getById(af.updated_by)?.display_name || null,
      sections_count: db.db.prepare('SELECT COUNT(*) AS c FROM sections WHERE af_id = ?').get(af.id).c,
    };
  });

  // GET /api/afs/:id/instances — liste a plat de toutes les instances d'equipements de l'AF
  fastify.get('/afs/:id/instances', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });
    return db.equipmentInstances.listByAf(id);
  });

  // POST /api/afs — creation
  // - kind='af' (defaut) : declenche le seed du plan AF complet (12 chapitres)
  // - kind='bacs_audit' : site_id obligatoire, pas de seed pour l'instant
  //   (le plan canonique BACS arrivera en Phase 2 via seedBacsAuditStructure)
  // - kind='brochure' : pas de seed (Phase 3)
  fastify.post('/afs', async (request, reply) => {
    let body;
    try {
      body = createAfSchema.parse(request.body);
    } catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation échouée', errors: err.errors });
    }

    // Validation specifique aux kinds non-AF
    if (body.kind === 'bacs_audit' && !body.site_id) {
      return reply.code(400).send({ detail: 'Un audit BACS doit etre rattache a un site (site_id requis)' });
    }
    if (body.site_id) {
      const site = db.sites.getById(body.site_id);
      if (!site || site.deleted_at) {
        return reply.code(404).send({ detail: 'Site introuvable' });
      }
    }

    const slug = uniqueSlug(`${body.client_name}-${body.project_name}`, (s) => !!db.afs.getBySlug(s));
    const userId = request.authUser?.id;

    const af = db.afs.create({
      slug,
      clientName: body.client_name,
      projectName: body.project_name,
      siteAddress: body.site_address,
      serviceLevel: body.service_level,
      kind: body.kind,
      siteId: body.site_id || null,
      title: body.title || null,
      createdBy: userId,
    });

    // Seed conditionnel selon le kind
    let sectionsCount = 0;
    if (body.kind === 'af') {
      sectionsCount = seedAfStructure(af.id);
    } else if (body.kind === 'bacs_audit') {
      const seedResult = seedBacsAuditStructure(af.id, body.site_id);
      sectionsCount = seedResult.sections_count;
    }

    db.auditLog.add({
      afId: af.id, userId, action: `${body.kind}.create`,
      payload: { slug: af.slug, kind: body.kind, site_id: body.site_id, sections_count: sectionsCount },
    });
    log.info(`Document created: #${af.id} ${af.slug} (kind=${body.kind}, ${sectionsCount} sections) by user #${userId}`);

    return { ...af, sections_count: sectionsCount };
  });

  // PATCH /api/afs/:id — update + transitions de statut
  fastify.patch('/afs/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });
    if (!assertWrite(request, reply, id)) return;

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

    // Champs BACS : applicabilite R175-2 recalculee si la puissance ou la
    // date PC est touchee
    if ('bacs_total_power_kw' in body) fields.bacs_total_power_kw = body.bacs_total_power_kw;
    if ('bacs_total_power_source' in body) fields.bacs_total_power_source = body.bacs_total_power_source;
    if ('bacs_building_permit_date' in body) fields.bacs_building_permit_date = body.bacs_building_permit_date;
    // Autres champs BACS / audit (forward direct vers db.afs.update qui
    // a sa propre allowlist).
    const passthrough = [
      'title', 'bacs_district_heating_substation_kw', 'bacs_generator_works_date',
      'bacs_roi_study_status', 'bacs_roi_study_html',
      'audit_existing_af_status', 'audit_synthesis_html', 'audit_synthesis_generated_at',
    ];
    for (const k of passthrough) {
      if (k in body) fields[k] = body[k];
    }
    const touchesApplicability = ['bacs_total_power_kw', 'bacs_building_permit_date'].some(k => k in body);
    if (touchesApplicability) {
      const powerKw = body.bacs_total_power_kw !== undefined ? body.bacs_total_power_kw : af.bacs_total_power_kw;
      const pcDate = body.bacs_building_permit_date !== undefined ? body.bacs_building_permit_date : af.bacs_building_permit_date;
      const applic = computeBacsApplicability(powerKw, pcDate);
      if (applic) {
        fields.bacs_applicability_status = applic.status;
        fields.bacs_applicable_deadline = applic.deadline;
      } else {
        fields.bacs_applicability_status = null;
        fields.bacs_applicable_deadline = null;
      }
    }

    const updated = db.afs.update(id, fields);
    db.auditLog.add({
      afId: id, userId, action: 'af.update',
      payload: Object.fromEntries(Object.entries(body).filter(([_, v]) => v != null)),
    });
    return updated;
  });

  // GET /api/afs/:id/transition-checks?to=<status> — verifications pre-transition.
  // Retourne une liste d'avertissements pour donner le contexte au redacteur
  // avant qu'il ne confirme une bascule de phase. Ne BLOQUE pas la transition
  // (V1 : informatif seulement, le redacteur peut passer outre).
  fastify.get('/afs/:id/transition-checks', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });

    const to = request.query.to;
    if (!['validee', 'livree'].includes(to)) {
      return { warnings: [] }; // pas de check pour les phases retour ou techniques
    }

    const allSections = db.sections.listByAf(id);
    const liveSections = allSections.filter(s => s.included_in_export && !s.opted_out_by_moa);

    const warnings = [];

    // 1. Sections texte/équipement/zones live SANS contenu (body_html vide ou
    //    placeholder). On exclut synthesis (auto-genere) et hyperveez_page
    //    (description par defaut suffit).
    const HTML_EMPTY_RE = /<[^>]*>/g;
    const emptyNarratives = liveSections.filter(s => {
      if (s.kind === 'synthesis' || s.kind === 'hyperveez_page') return false;
      const text = (s.body_html || '').replace(HTML_EMPTY_RE, '').trim();
      return text.length === 0;
    });
    if (emptyNarratives.length) {
      warnings.push({
        code: 'empty_sections',
        severity: 'warn',
        label: `${emptyNarratives.length} section(s) sans contenu rédigé`,
        details: emptyNarratives.slice(0, 8).map(s => ({ id: s.id, number: s.number, title: s.title })),
        moreCount: Math.max(0, emptyNarratives.length - 8),
      });
    }

    // 2. Sections equipement live SANS instances declarees.
    const equipmentNoInstances = [];
    for (const s of liveSections) {
      if (s.kind !== 'equipment') continue;
      const count = db.db.prepare('SELECT COUNT(*) AS c FROM equipment_instances WHERE section_id = ?').get(s.id).c;
      if (count === 0) equipmentNoInstances.push(s);
    }
    if (equipmentNoInstances.length) {
      warnings.push({
        code: 'equipment_no_instances',
        severity: 'warn',
        label: `${equipmentNoInstances.length} section(s) équipement sans instance déclarée`,
        details: equipmentNoInstances.slice(0, 8).map(s => ({ id: s.id, number: s.number, title: s.title })),
        moreCount: Math.max(0, equipmentNoInstances.length - 8),
      });
    }

    // 3. Sections kind='zones' live SANS zone declaree.
    const zonesNoZone = [];
    for (const s of liveSections) {
      if (s.kind !== 'zones') continue;
      const zones = db.afZones.listBySection(s.id);
      if (!zones.length) zonesNoZone.push(s);
    }
    if (zonesNoZone.length) {
      warnings.push({
        code: 'zones_no_declared',
        severity: 'warn',
        label: `${zonesNoZone.length} section(s) Zones fonctionnelles sans zone déclarée`,
        details: zonesNoZone.slice(0, 8).map(s => ({ id: s.id, number: s.number, title: s.title })),
        moreCount: 0,
      });
    }

    // 4. Pour livraison : niveau de contrat doit etre fixe (sinon impossible
    //    de figer le perimetre commercial dans le DOE).
    if (to === 'livree' && !af.service_level) {
      warnings.push({
        code: 'no_contract_level',
        severity: 'error',
        label: 'Aucun niveau de contrat Buildy défini sur l\'AF',
        details: [],
        moreCount: 0,
      });
    }

    return { warnings, target: to };
  });

  // POST /api/afs/:id/transition — bascule de statut avec gestion snapshots/milestones
  // body : { to: 'redaction'|'validee'|'commissioning'|'commissioned'|'livree', motif?, notes? }
  // Pour 'validee' et 'livree' : génère un PDF AF horodaté + tag Git + entrée milestone.
  fastify.post('/afs/:id/transition', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });
    if (!assertWrite(request, reply, id)) return;

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
    if (!assertWrite(request, reply, id)) return;

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
    // Exclure du calcul : sections desactivees a l'export, ecartees par la MOA, ou marquees excluded en query
    const includedSections = allSections.filter(s =>
      s.included_in_export && !s.opted_out_by_moa && !excluded.has(s.id)
    );

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

  // ── Permissions / Partage AF (Lot 28) ──────────────────────────────
  fastify.get('/afs/:id/permissions', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af) return reply.code(404).send({ detail: 'AF non trouvée' });
    return {
      owner_id: af.created_by,
      grants: db.afPermissions.listByAf(id),
    };
  });

  fastify.post('/afs/:id/permissions', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const af = db.afs.getById(id);
    if (!af) return reply.code(404).send({ detail: 'AF non trouvée' });
    const { user_id, role } = request.body || {};
    if (!user_id || !['read', 'write'].includes(role)) {
      return reply.code(400).send({ detail: 'user_id + role (read|write) requis' });
    }
    if (user_id === af.created_by) {
      return reply.code(400).send({ detail: 'Le créateur de l\'AF est déjà owner' });
    }
    const perm = db.afPermissions.grant(id, user_id, role, request.authUser?.id);
    db.auditLog.add({ afId: id, userId: request.authUser?.id, action: 'af.share.grant', payload: { user_id, role } });
    return perm;
  });

  fastify.delete('/afs/:id/permissions/:userId', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const userId = parseInt(request.params.userId, 10);
    db.afPermissions.revoke(id, userId);
    db.auditLog.add({ afId: id, userId: request.authUser?.id, action: 'af.share.revoke', payload: { user_id: userId } });
    return { ok: true };
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
