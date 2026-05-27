'use strict';

// Routes audit BACS — point d'entree du plugin. Les domaines specifiques
// (transcripts, inspections, exports, lifecycle) sont enregistres comme
// sous-plugins; ce fichier contient les CRUD partages : refs, systems,
// meters, BMS + components, thermal, action-items (sans CSV), devices,
// zones-reorder, power-summary, resync.

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { regenerateActionItems } = require('../lib/bacs-audit-action-generator');
const { recomputeAndPersistAuditPower } = require('../lib/bacs-audit-power');
const { resyncBacsAuditWithSiteZones } = require('../lib/seeder');
const { computeSystemLiability } = require('../lib/bacs-liability');
const {
  SYSTEM_CATEGORIES, COMMUNICATION_VALUES, DEVICE_COMM,
  METER_USAGES, METER_TYPES, RECOMMENDATIONS,
  REGULATION_TYPES, GENERATOR_TYPES, ENERGY_SOURCES,
  assertBacsAuditExists, logBacsAudit,
} = require('./bacs-audit/_shared');
const { sanitizeBodyHtmlFields } = require('../lib/html-sanitize');
const { parseRoles, serializeRoles } = require('../lib/device-roles');

// Mapping d'un row device vers l'API : parse `device_role` en array (mig 117).
function mapDevice(d) {
  if (!d) return d;
  return { ...d, device_role: parseRoles(d.device_role) };
}
// Schema Zod commun : `device_role` accepte string (legacy) | array | null.
const deviceRoleSchema = z.union([z.string(), z.array(z.string()), z.null()]).optional();

async function routes(fastify) {
  // Sous-plugins par domaine
  await fastify.register(require('./bacs-audit/transcripts'));
  await fastify.register(require('./bacs-audit/inspections'));
  await fastify.register(require('./bacs-audit/exports'));
  await fastify.register(require('./bacs-audit/lifecycle'));

  // ─── Systems (R175-1 §4 + R175-3 §3) ───────────────────────────────
  fastify.get('/bacs-audit/:documentId/systems', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.db.prepare(`
      SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_systems s
      LEFT JOIN zones z ON z.id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.position, s.system_category
    `).all(id);
  });

  // GET /bacs-audit/:documentId/full — instantane complet d'un audit en un
  // seul appel : document, site, zones, systemes, equipements, compteurs,
  // GTB, regulation thermique, plan d'action, parties, puissances, synthese
  // de conformite (verdict + tableau R175), methodologie, articles R175.
  // Reutilise l'assemblage de _export-data.js. Destine au serveur MCP de FM
  // (outil audit_get) — protege par les memes gardes que les autres routes.
  fastify.get('/bacs-audit/:documentId/full', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(id, request, reply);
    if (!af) return;
    const { buildBacsAuditExportData } = require('./bacs-audit/_export-data');
    const data = await buildBacsAuditExportData(af, { user: request.authUser });
    // On retire les blobs lourds (data URLs de charts / carte / logo) :
    // inutiles pour un client API et alourdissent la reponse JSON.
    const HEAVY = new Set([
      'siteMapDataUrl', 'energyMonthlyChartDataUrl', 'sevDonutDataUrl',
      'barUsagePowerDataUrl', 'logoDataUrl', 'barItems',
    ]);
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (!HEAVY.has(k)) out[k] = v;
    }
    return out;
  });

  fastify.patch('/bacs-audit/systems/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne system non trouvee' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;

    const schema = z.object({
      // Ternaire explicite : true = présent, false = absent, null = partiel /
      // non répondu. La PWA et l'UI desktop offrent un toggle 3 états ; ce
      // ternaire doit être préservé bout en bout (cf. plan cohérence audit).
      present: z.boolean().nullable().optional(),
      communication: z.enum(COMMUNICATION_VALUES).nullable().optional(),
      equipment_id: z.number().int().nullable().optional(),
      notes: z.string().nullable().optional(),
      notes_html: z.string().nullable().optional(),
      meets_r175_3_p3: z.boolean().nullable().optional(),
      meets_r175_3_p4: z.boolean().nullable().optional(),
      meets_r175_3_p4_autonomous: z.boolean().nullable().optional(),
      managed_by_bms: z.boolean().nullable().optional(),
      not_concerned: z.boolean().nullable().optional(),
      // Item 3 — bouclage ECS (pertinent pour system_category = 'dhw').
      is_looped: z.enum(['looped', 'not_looped', 'unknown']).nullable().optional(),
      // Item 1 — règle des 5 % : poste considéré comme négligeable.
      marked_negligible_under_5pct: z.boolean().nullable().optional(),
      negligible_justification: z.string().nullable().optional(),
      // Refactor 2026-05-26 — is_district_heating_substation /
      // serves_multiple_buildings ne sont plus saisis sur le système :
      // dérivés du modèle d'équipement (slug 'sous-station-reseau-urbain')
      // et du flag `serves_multiple_buildings` sur le device (mig 175).
      // Champs schéma laissés tolérants pour compat descendante client.
      is_district_heating_substation: z.boolean().nullable().optional(),
      serves_multiple_buildings: z.boolean().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);

    const sets = [], args = [];
    const boolField = (k) => {
      if (k in body) {
        sets.push(`${k} = ?`);
        args.push(body[k] == null ? null : (body[k] ? 1 : 0));
      }
    };
    // present ternaire : null = partiel/non répondu ; 0 = absent ; 1 = présent.
    if (body.present !== undefined) {
      sets.push('present = ?');
      args.push(body.present == null ? null : (body.present ? 1 : 0));
    }
    boolField('not_concerned');
    if ('communication' in body) { sets.push('communication = ?'); args.push(body.communication); }
    if ('equipment_id' in body) { sets.push('equipment_id = ?'); args.push(body.equipment_id); }
    if ('notes' in body) { sets.push('notes = ?'); args.push(body.notes); }
    boolField('meets_r175_3_p3');
    boolField('meets_r175_3_p4');
    boolField('meets_r175_3_p4_autonomous');
    boolField('managed_by_bms');
    boolField('marked_negligible_under_5pct');
    // Refactor 2026-05-26 — les 2 anciens flags d'assujettissement
    // (E sous-station / F multi-bâtiments) ne sont plus persistés
    // au niveau système : dérivés des devices côté lecture.
    // Si un client legacy envoie quand même, on ignore silencieusement.
    if ('is_looped' in body) { sets.push('is_looped = ?'); args.push(body.is_looped); }
    if ('negligible_justification' in body) { sets.push('negligible_justification = ?'); args.push(body.negligible_justification); }
    if ('notes_html' in body) { sets.push('notes_html = ?'); args.push(body.notes_html); }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_systems SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      logBacsAudit(request, 'bacs.system.update', row.document_id, { systemId: id, fields: Object.keys(body) });
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(id);
  });

  // POST /bacs-audit/:documentId/systems — ajout d'un système dans une zone.
  // Mig 182 : la contrainte UNIQUE(doc, zone, system_category) a été retirée,
  // donc on peut créer plusieurs « Chauffage » (etc.) dans une même zone.
  // - Si `system_category` est une catégorie BACS standard (heating, cooling,
  //   ventilation, dhw, lighting_indoor, lighting_outdoor, electricity_production)
  //   → is_bacs=1, on conserve le label de référence pour la matrice R175.
  // - Sinon → `custom:<uuid>` généré, is_bacs=0 (usage hors décret, ex: bornes
  //   de recharge, occultation, etc.).
  // `library_category_key` (optionnel) rattache l'usage à une catégorie de la
  // bibliothèque pour filtrer la liste d'équipements proposés.
  fastify.post('/bacs-audit/:documentId/systems', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, request, reply, { requiredRole: 'write' })) return;
    const BACS_STANDARD_CATEGORIES = ['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'lighting_outdoor', 'electricity_production'];
    const schema = z.object({
      zone_id: z.number().int().positive(),
      label: z.string().trim().min(1, 'Nom du système requis').max(120),
      // Catégorie BACS standard (heating, cooling…) OU laisser vide pour
      // un usage non BACS (génère automatiquement `custom:<uuid>`).
      system_category: z.string().trim().min(1).max(80).nullable().optional(),
      library_category_key: z.string().trim().min(1).max(80).nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    const zone = db.db.prepare('SELECT id FROM zones WHERE id = ?').get(body.zone_id);
    if (!zone) return reply.code(400).send({ detail: 'Zone introuvable.' });

    const isBacsStd = body.system_category && BACS_STANDARD_CATEGORIES.includes(body.system_category);
    const category = isBacsStd ? body.system_category : ('custom:' + require('crypto').randomUUID());
    const isBacs = isBacsStd ? 1 : 0;

    const maxPos = db.db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM bacs_audit_systems WHERE document_id = ? AND zone_id = ?'
    ).get(documentId, body.zone_id).m;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_systems
        (document_id, zone_id, system_category, custom_label, is_bacs, present, position, library_category_key)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(documentId, body.zone_id, category, body.label, isBacs, maxPos + 10, body.library_category_key || null);
    logBacsAudit(request, 'bacs.system.create', documentId, { systemId: r.lastInsertRowid, label: body.label, system_category: category });
    return reply.code(201).send(
      db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(r.lastInsertRowid)
    );
  });

  // DELETE /bacs-audit/systems/:id — suppression d'un système.
  // - Usages manuels (is_bacs=0) : toujours supprimables.
  // - Usages BACS (is_bacs=1) : supprimables seulement si la même (zone ×
  //   catégorie) en compte au moins un autre (= doublon ajouté manuellement
  //   via la modale « Ajouter un système », mig 182). On préserve toujours
  //   le système BACS racine de chaque (zone × catégorie) pour ne pas casser
  //   la matrice R175 — l'auditeur peut le marquer « Non concerné » à la place.
  fastify.delete('/bacs-audit/systems/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Système non trouvé' });
    if (row.is_bacs) {
      const siblings = db.db.prepare(
        'SELECT COUNT(*) AS n FROM bacs_audit_systems WHERE document_id = ? AND zone_id = ? AND system_category = ? AND id != ?'
      ).get(row.document_id, row.zone_id, row.system_category, id).n;
      if (siblings === 0) {
        return reply.code(400).send({
          detail: 'Un système BACS de référence ne se supprime pas — utilisez « Non concerné », ou supprimez d\'abord les doublons.',
        });
      }
    }
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    db.db.prepare('DELETE FROM bacs_audit_systems WHERE id = ?').run(id);
    logBacsAudit(request, 'bacs.system.delete', row.document_id, { systemId: id });
    regenerateActionItems(row.document_id);
    return { deleted: true };
  });

  // ─── Parties prenantes affectées à un système (item 4c) ────────────
  // GET /bacs-audit/systems/:id/parties — qui a fait les travaux sur ce
  // système (clé du cas C : responsible_for_works → preneur assujetti).
  fastify.get('/bacs-audit/systems/:id/parties', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT document_id FROM bacs_audit_systems WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Système non trouvé' });
    if (!assertBacsAuditExists(row.document_id, request, reply)) return;
    return db.systemParties.listBySystem(id);
  });

  // PUT /bacs-audit/systems/:id/parties — remplace les affectations.
  // body : { parties: [{ party_id, responsible_for_works }] }.
  fastify.put('/bacs-audit/systems/:id/parties', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT document_id FROM bacs_audit_systems WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Système non trouvé' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    const schema = z.object({
      parties: z.array(z.object({
        party_id: z.number().int().positive(),
        responsible_for_works: z.boolean().optional(),
      })).default([]),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const links = db.systemParties.setForSystem(id, body.parties);
    logBacsAudit(request, 'bacs.system.parties.set', row.document_id,
      { systemId: id, count: body.parties.length });
    return links;
  });

  // GET /bacs-audit/:documentId/liability — calcul automatique de
  // l'assujetti par système (item 4d). Retourne aussi la structure
  // juridique du site et les parties prenantes pour l'UI.
  fastify.get('/bacs-audit/:documentId/liability', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(id, request, reply);
    if (!af) return;
    const site = af.site_id ? db.sites.getById(af.site_id) : null;
    const parties = site ? db.siteParties.listBySite(site.site_id) : [];
    const systems = db.db.prepare(
      'SELECT id, zone_id, system_category, is_district_heating_substation, serves_multiple_buildings FROM bacs_audit_systems WHERE document_id = ?'
    ).all(id);
    // Refactor 2026-05-26 — dérive is_district_heating_substation et
    // serves_multiple_buildings depuis les devices (mig 175). Le slug
    // 'sous-station-reseau-urbain' identifie le modèle d'équipement marqueur.
    const substationTplRow = db.db.prepare(
      "SELECT id FROM equipment_templates WHERE slug = 'sous-station-reseau-urbain'"
    ).get();
    const substationTplId = substationTplRow ? substationTplRow.id : null;
    const allDevices = db.db.prepare(
      'SELECT system_id, equipment_template_id, serves_multiple_buildings FROM bacs_audit_system_devices WHERE system_id IN (SELECT id FROM bacs_audit_systems WHERE document_id = ?)'
    ).all(id);
    const devicesBySystem = new Map();
    for (const d of allDevices) {
      if (!devicesBySystem.has(d.system_id)) devicesBySystem.set(d.system_id, []);
      devicesBySystem.get(d.system_id).push(d);
    }
    const enrichedSystems = systems.map(s => {
      const devs = devicesBySystem.get(s.id) || [];
      const derivedSubstation = substationTplId
        ? devs.some(d => d.equipment_template_id === substationTplId)
        : false;
      const derivedMultiBuildings = devs.some(d => d.serves_multiple_buildings === 1);
      return {
        ...s,
        is_district_heating_substation: derivedSubstation
          ? 1 : s.is_district_heating_substation,
        serves_multiple_buildings: derivedMultiBuildings
          ? 1 : s.serves_multiple_buildings,
      };
    });
    const zonePartyLinks = site ? db.zoneParties.listBySite(site.site_id) : [];
    const systemPartyLinks = db.systemParties.listByDocument(id);
    const liabilityMap = computeSystemLiability({
      site, parties, systems: enrichedSystems, zonePartyLinks, systemPartyLinks,
    });
    const bySystem = {};
    for (const [sysId, info] of liabilityMap) bySystem[sysId] = info;
    return {
      ownership_structure: site?.ownership_structure || null,
      parties,
      by_system: bySystem,
    };
  });

  // ─── Meters (R175-3 §1) ────────────────────────────────────────────
  fastify.get('/bacs-audit/:documentId/meters', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.db.prepare(`
      SELECT m.*,
             z.name AS zone_name,
             zl.name AS location_zone_name
      FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.id = m.zone_id
      LEFT JOIN zones zl ON zl.id = m.location_zone_id
      WHERE m.document_id = ?
      ORDER BY z.position NULLS LAST, m.position, m.usage, m.meter_type
    `).all(id);
  });

  fastify.post('/bacs-audit/:documentId/meters', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, request, reply)) return;
    const schema = z.object({
      zone_id: z.number().int().positive().nullable().optional(),
      usage: z.enum(METER_USAGES),
      meter_type: z.enum(METER_TYPES),
      equipment_id: z.number().int().nullable().optional(),
      required: z.boolean().optional().default(true),
      present_actual: z.boolean().optional().default(false),
      communicating: z.boolean().optional().default(false),
      communication_protocol: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_meters
        (document_id, zone_id, usage, meter_type, equipment_id,
         required, present_actual, communicating, communication_protocol, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      documentId, body.zone_id || null, body.usage, body.meter_type,
      body.equipment_id || null,
      body.required ? 1 : 0, body.present_actual ? 1 : 0, body.communicating ? 1 : 0,
      body.communication_protocol || null, body.notes || null,
    );
    logBacsAudit(request, 'bacs.meter.create', documentId, { meterId: r.lastInsertRowid, usage: body.usage, type: body.meter_type });
    regenerateActionItems(documentId);
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.patch('/bacs-audit/meters/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne meter non trouvee' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    const schema = z.object({
      zone_id: z.number().int().positive().nullable().optional(),
      location_zone_id: z.number().int().positive().nullable().optional(),
      usage: z.enum(METER_USAGES).optional(),
      meter_type: z.enum(METER_TYPES).optional(),
      required: z.boolean().optional(),
      present_actual: z.boolean().optional(),
      communicating: z.boolean().optional(),
      communication_protocol: z.string().nullable().optional(),
      communication_protocols: z.string().nullable().optional(),
      wired: z.boolean().nullable().optional(),
      equipment_id: z.number().int().nullable().optional(),
      recommendation: z.enum(RECOMMENDATIONS).nullable().optional(),
      notes: z.string().nullable().optional(),
      notes_html: z.string().nullable().optional(),
      managed_by_bms: z.boolean().nullable().optional(),
      out_of_service: z.boolean().nullable().optional(),
      bms_integration_out_of_service: z.boolean().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);

    // Regle : un compteur non present ne peut pas etre integre a la GTB
    // (cf retour Kevin v2.5). Auto-decoche managed_by_bms si on passe a non present.
    if (body.present_actual === false && body.managed_by_bms == null) {
      body.managed_by_bms = false;
    }

    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) {
      const val = (typeof v === 'boolean') ? (v ? 1 : 0) : v;
      sets.push(`${k} = ?`); args.push(val);
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_meters SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      logBacsAudit(request, 'bacs.meter.update', row.document_id, { meterId: id, fields: Object.keys(body) });
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(id);
  });

  // Duplique un compteur (avec ses notes / rattachement device)
  fastify.post('/bacs-audit/meters/:id/duplicate', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const m = db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(id);
    if (!m) return reply.code(404).send({ detail: 'Compteur non trouve' });
    if (!assertBacsAuditExists(m.document_id, request, reply, { requiredRole: 'write' })) return;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_meters
        (document_id, zone_id, usage, meter_type, equipment_id, required,
         present_actual, communicating, communication_protocol, notes, notes_html,
         managed_by_bms, out_of_service, bms_integration_out_of_service, recommendation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.document_id, m.zone_id, m.usage, m.meter_type, m.equipment_id, m.required,
      m.present_actual, m.communicating, m.communication_protocol, m.notes, m.notes_html,
      m.managed_by_bms, m.out_of_service, m.bms_integration_out_of_service, m.recommendation,
    );
    regenerateActionItems(m.document_id);
    db.auditLog.add({ afId: m.document_id, userId: request.authUser?.id,
      action: 'bacs_meter.duplicate', payload: { source_meter_id: id, new_meter_id: r.lastInsertRowid } });
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.delete('/bacs-audit/meters/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT document_id FROM bacs_audit_meters WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne meter non trouvee' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    db.db.prepare('DELETE FROM bacs_audit_meters WHERE id = ?').run(id);
    logBacsAudit(request, 'bacs.meter.delete', row.document_id, { meterId: id });
    regenerateActionItems(row.document_id);
    return reply.code(204).send();
  });


  // ─── BMS (R175-3 / R175-4 / R175-5) ────────────────────────────────
  fastify.get('/bacs-audit/:documentId/bms', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(id) || { document_id: id };
  });

  fastify.put('/bacs-audit/:documentId/bms', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, request, reply)) return;
    // Helper : accepte boolean, 0/1, true/false (string ou number) et null
    const boolish = z.preprocess((v) => {
      if (v === null || v === undefined) return v;
      if (typeof v === 'boolean') return v;
      if (v === 1 || v === '1' || v === 'true') return true;
      if (v === 0 || v === '0' || v === 'false') return false;
      return v;
    }, z.boolean().nullable().optional());
    const schema = z.object({
      // Presence de la GTB : null = non repondu, true = presente, false = absente.
      present: boolish,
      existing_solution: z.string().nullable().optional(),
      existing_solution_brand: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      model_reference: z.string().nullable().optional(),
      manages_heating: boolish,
      manages_cooling: boolish,
      manages_ventilation: boolish,
      manages_dhw: boolish,
      manages_lighting: boolish,
      meets_r175_3_p1: boolish,
      meets_r175_3_p2: boolish,
      has_maintenance_procedures: boolish,
      operator_trained: boolish,
      operator_training_date: z.string().nullable().optional(),
      overall_compliance: z.enum(['compliant','partial','non_compliant']).nullable().optional(),
      out_of_service: boolish,
      notes_html: z.string().nullable().optional(),
      // R175-3 dernier alinea
      data_provision_to_manager: boolish,
      data_provision_to_operators: boolish,
      notes_data_provision: z.string().nullable().optional(),
      // Protocoles de mise a disposition des points (BACnet/Modbus/OPC-UA/MQTT/REST...)
      provided_protocols: z.string().nullable().optional(),
      // ── Migration 61 : detail R175-3 §1/§2, mise a dispo donnees, R175-4/5 ──
      r175_3_p1_archival_format: z.string().nullable().optional(),
      r175_3_p1_retention_verified: boolish,
      r175_3_p2_anomaly_rules_html: z.string().nullable().optional(),
      data_provision_frequency: z.string().nullable().optional(),
      data_provision_format: z.string().nullable().optional(),
      maintenance_periodicity: z.string().nullable().optional(),
      maintenance_responsible: z.string().nullable().optional(),
      operator_training_topics: z.string().nullable().optional(),
      operator_training_provider: z.string().nullable().optional(),
      // Item 15 — GTB existante : stockage 5 ans + accès aux données (R175-3).
      data_storage_5y_compliant: z.enum(['yes', 'no', 'unknown']).nullable().optional(),
      data_storage_location: z.enum(['local', 'cloud_editeur', 'cloud_proprietaire', 'unknown']).nullable().optional(),
      data_owner_access: z.enum(['yes', 'no', 'partial']).nullable().optional(),
      gestionnaire_exploitant_access: z.enum(['yes', 'no', 'partial']).nullable().optional(),
      export_capability: z.enum(['yes', 'no']).nullable().optional(),
      data_access_notes: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    // Toggle bool -> 0/1
    const fields = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'boolean') fields[k] = v ? 1 : 0;
      else fields[k] = v;
    }
    const cols = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    if (cols) {
      const values = Object.values(fields);
      // INSERT ... ON CONFLICT pour gerer le 1-1
      db.db.prepare(`
        INSERT INTO bacs_audit_bms (document_id, ${Object.keys(fields).join(', ')}, updated_at)
        VALUES (?, ${Object.keys(fields).map(() => '?').join(', ')}, CURRENT_TIMESTAMP)
        ON CONFLICT(document_id) DO UPDATE SET ${cols}, updated_at = CURRENT_TIMESTAMP
      `).run(documentId, ...values, ...values);
      logBacsAudit(request, 'bacs.bms.update', documentId, { fields: Object.keys(fields) });
    }
    regenerateActionItems(documentId);
    return db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId);
  });

  // ─── BMS components (passerelles, automates, contrôleurs, IO…) ─────
  const BMS_COMPONENT_TYPES = ['gateway','plc','controller','io_module','router','switch','server','other'];

  fastify.get('/bacs-audit/:documentId/bms-components', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.db.prepare(`
      SELECT * FROM bacs_audit_bms_components
      WHERE document_id = ? ORDER BY position, id
    `).all(id);
  });

  fastify.post('/bacs-audit/:documentId/bms-components', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, request, reply)) return;
    const schema = z.object({
      component_type: z.enum(BMS_COMPONENT_TYPES).nullable().optional(),
      brand: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      ip_address: z.string().nullable().optional(),
      protocols: z.string().nullable().optional(),
      firmware_version: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      notes_html: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body || {}); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const maxPos = db.db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM bacs_audit_bms_components WHERE document_id = ?').get(documentId).m;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_bms_components
        (document_id, position, component_type, brand, model, location,
         ip_address, protocols, firmware_version, notes, notes_html)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      documentId, maxPos + 1,
      body.component_type || null, body.brand || null, body.model || null,
      body.location || null, body.ip_address || null, body.protocols || null,
      body.firmware_version || null, body.notes || null, body.notes_html || null,
    );
    logBacsAudit(request, 'bacs.bms_component.create', documentId, { componentId: r.lastInsertRowid, type: body.component_type });
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.patch('/bacs-audit/bms-components/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Composant non trouve' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    const schema = z.object({
      component_type: z.enum(BMS_COMPONENT_TYPES).nullable().optional(),
      brand: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      ip_address: z.string().nullable().optional(),
      protocols: z.string().nullable().optional(),
      firmware_version: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      notes_html: z.string().nullable().optional(),
      position: z.number().int().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) { sets.push(`${k} = ?`); args.push(v); }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_bms_components SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      logBacsAudit(request, 'bacs.bms_component.update', row.document_id, { componentId: id, fields: Object.keys(body) });
    }
    return db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(id);
  });

  fastify.post('/bacs-audit/bms-components/:id/duplicate', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const c = db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(id);
    if (!c) return reply.code(404).send({ detail: 'Composant non trouve' });
    if (!assertBacsAuditExists(c.document_id, request, reply, { requiredRole: 'write' })) return;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_bms_components
        (document_id, position, component_type, brand, model, location,
         ip_address, protocols, firmware_version, notes, notes_html)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.document_id, (c.position || 0) + 1,
      c.component_type, c.brand, c.model, c.location,
      c.ip_address, c.protocols, c.firmware_version, c.notes, c.notes_html,
    );
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.delete('/bacs-audit/bms-components/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Composant non trouve' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    db.db.prepare('DELETE FROM bacs_audit_bms_components WHERE id = ?').run(id);
    logBacsAudit(request, 'bacs.bms_component.delete', row.document_id, { componentId: id });
    return reply.code(204).send();
  });


  // ─── Thermal regulation (R175-6) ───────────────────────────────────
  // Mig 180 : 1 ligne par système (`system_id` obligatoire). On expose le
  // nom du système (custom_label) et son état (present) via JOIN, afin que
  // la card 06 affiche directement le libellé saisi côté card 03 sans
  // double saisie.
  //
  // Auto-bootstrap : à chaque GET, on crée une ligne thermal_regulation pour
  // chaque système heating/cooling présent qui n'en a pas encore. Idempotent
  // (UNIQUE document_id+system_id côté DB n'est pas strict, on vérifie via
  // SELECT). Cela évite d'avoir à coupler la création d'un système à un
  // hook explicite : la card 06 est toujours à jour avec les systèmes.
  function ensureThermalRowsForSystems(documentId) {
    const systems = db.db.prepare(`
      SELECT s.id, s.zone_id, s.system_category
      FROM bacs_audit_systems s
      WHERE s.document_id = ?
        AND s.present = 1
        AND s.system_category IN ('heating', 'cooling')
    `).all(documentId);
    if (!systems.length) return;
    const existing = new Set(db.db.prepare(
      'SELECT system_id FROM bacs_audit_thermal_regulation WHERE document_id = ? AND system_id IS NOT NULL'
    ).all(documentId).map(r => r.system_id));
    const missing = systems.filter(s => !existing.has(s.id));
    if (!missing.length) return;
    const maxPos = db.db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM bacs_audit_thermal_regulation WHERE document_id = ?'
    ).get(documentId).m;
    const insert = db.db.prepare(`
      INSERT INTO bacs_audit_thermal_regulation
        (document_id, zone_id, system_id, category, has_automatic_regulation, position)
      VALUES (?, ?, ?, ?, 0, ?)
    `);
    let pos = maxPos;
    for (const s of missing) {
      pos += 10;
      insert.run(documentId, s.zone_id, s.id, s.system_category, pos);
    }
  }

  fastify.get('/bacs-audit/:documentId/thermal-regulation', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    ensureThermalRowsForSystems(id);
    return db.db.prepare(`
      SELECT t.*, z.name AS zone_name, z.nature AS zone_nature,
             s.custom_label AS system_label, s.present AS system_present
      FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.id = t.zone_id
      LEFT JOIN bacs_audit_systems s ON s.id = t.system_id
      WHERE t.document_id = ? AND t.system_id IS NOT NULL
      ORDER BY t.position, z.position, z.name,
               CASE t.category WHEN 'heating' THEN 0 ELSE 1 END,
               s.position, s.custom_label
    `).all(id);
  });

  fastify.patch('/bacs-audit/thermal-regulation/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_thermal_regulation WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne thermal_regulation non trouvee' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    const schema = z.object({
      // Mig 180 : `label` archivé (le nom du système vient désormais de
      // bacs_audit_systems.custom_label, joint via system_id). On accepte
      // encore en entrée pour compat ascendante mais l'UI n'écrit plus
      // dessus.
      label: z.string().nullable().optional(),
      // `regulation_type` (per_room / per_zone / central_only / none) est
      // dormant depuis mig 180 — la granularité est désormais *dérivée* du
      // `regulation_type_emission` du device d'émission. Accepté en entrée
      // pour ne pas casser les clients legacy, mais ignoré côté UI.
      regulation_type: z.enum(REGULATION_TYPES).nullable().optional(),
      // Mig 135 : generator_type (= energy_source du device) et
      // generator_age_years (= age_years du device) ont migré sur le
      // device. Ne plus accepter ces champs ici.
      // generator_device_id = niveau "Production" (chaudière, PAC, unité
      // extérieure DRV…). Le nom DB historique reste, le label UI évolue.
      generator_device_id: z.number().int().nullable().optional(),
      // Migration 87 : niveaux Distribution (pompes, AHU…) et Émission
      // (radiateurs, ventilo-conv, unités intérieures DRV…). Tous deux
      // facultatifs — certaines configs (DRV) sautent la distribution.
      distribution_device_id: z.number().int().nullable().optional(),
      emission_device_id: z.number().int().nullable().optional(),
      // Migration 129 : équipement de régulation par niveau (sonde,
      // thermostat, GTB) qui pilote l'équipement-process du niveau.
      // Distinct du <level>_device_id qui pointe la chaudière/pompe/radiateur.
      production_regulation_device_id: z.number().int().nullable().optional(),
      distribution_regulation_device_id: z.number().int().nullable().optional(),
      emission_regulation_device_id: z.number().int().nullable().optional(),
      // Migration 129 : note libre par niveau, en plus de la note globale
      // `notes_html` au niveau du couple zone × catégorie.
      production_notes_html: z.string().nullable().optional(),
      distribution_notes_html: z.string().nullable().optional(),
      emission_notes_html: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      // Migration 84 : notes riches via la modale partagée (system / device /
      // meter / thermal — même UX). `notes` legacy conservé pour les saisies
      // historiques.
      notes_html: z.string().nullable().optional(),
      // (Mig 61 : sensor_position / thermostat_type / has_thermostatic_valves
      //  — ligne détail R175-6 retirée de l'UI (Feature J), champs dormants.)
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) {
      const val = (typeof v === 'boolean') ? (v ? 1 : 0) : v;
      sets.push(`${k} = ?`); args.push(val);
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_thermal_regulation SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      logBacsAudit(request, 'bacs.thermal.update', row.document_id, { thermalId: id, fields: Object.keys(body) });
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_thermal_regulation WHERE id = ?').get(id);
  });

  // POST /bacs-audit/:documentId/thermal-regulation — crée une entrée de
  // régulation pour un système thermique donné. Mig 180 : on prend
  // `system_id` en entrée, zone_id + category sont dérivés depuis
  // `bacs_audit_systems`. Idempotent : si une ligne existe déjà pour ce
  // (document_id, system_id), on la renvoie sans en créer une nouvelle.
  fastify.post('/bacs-audit/:documentId/thermal-regulation', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, request, reply)) return;
    const schema = z.object({
      system_id: z.number().int(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const sys = db.db.prepare(
      'SELECT id, zone_id, system_category FROM bacs_audit_systems WHERE id = ? AND document_id = ?'
    ).get(body.system_id, documentId);
    if (!sys) return reply.code(400).send({ detail: 'Système introuvable' });
    if (!['heating', 'cooling'].includes(sys.system_category)) {
      return reply.code(400).send({ detail: 'Seuls les systèmes chauffage/refroidissement ont une régulation thermique' });
    }
    const existing = db.db.prepare(
      'SELECT id FROM bacs_audit_thermal_regulation WHERE document_id = ? AND system_id = ?'
    ).get(documentId, body.system_id);
    if (existing) {
      return db.db.prepare(`
        SELECT t.*, z.name AS zone_name, z.nature AS zone_nature,
               s.custom_label AS system_label, s.present AS system_present
        FROM bacs_audit_thermal_regulation t
        LEFT JOIN zones z ON z.id = t.zone_id
        LEFT JOIN bacs_audit_systems s ON s.id = t.system_id
        WHERE t.id = ?
      `).get(existing.id);
    }
    const maxPos = db.db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM bacs_audit_thermal_regulation WHERE document_id = ?'
    ).get(documentId).m;
    const info = db.db.prepare(`
      INSERT INTO bacs_audit_thermal_regulation
        (document_id, zone_id, system_id, category, has_automatic_regulation, position)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(documentId, sys.zone_id, body.system_id, sys.system_category, maxPos + 10);
    logBacsAudit(request, 'bacs.thermal.create', documentId,
      { thermalId: info.lastInsertRowid, system_id: body.system_id });
    regenerateActionItems(documentId);
    return db.db.prepare(`
      SELECT t.*, z.name AS zone_name, z.nature AS zone_nature,
             s.custom_label AS system_label, s.present AS system_present
      FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.id = t.zone_id
      LEFT JOIN bacs_audit_systems s ON s.id = t.system_id
      WHERE t.id = ?
    `).get(info.lastInsertRowid);
  });

  // DELETE /bacs-audit/thermal-regulation/:id — supprime une entrée de
  // régulation. Si toutes les entrées d'une zone × catégorie « requise »
  // sont supprimées, le resync en recrée une de base au prochain passage.
  fastify.delete('/bacs-audit/thermal-regulation/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_thermal_regulation WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne thermal_regulation non trouvee' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    db.db.prepare('DELETE FROM bacs_audit_thermal_regulation WHERE id = ?').run(id);
    logBacsAudit(request, 'bacs.thermal.delete', row.document_id, { thermalId: id });
    regenerateActionItems(row.document_id);
    return { ok: true };
  });

  // ─── Action items (plan de mise en conformite) ─────────────────────
  fastify.get('/bacs-audit/:documentId/action-items', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    const { severity, category, status, zone_id } = request.query;
    let sql = `
      SELECT a.*, z.name AS zone_name, e.name AS equipment_name
      FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.id = a.zone_id
      LEFT JOIN equipments e ON e.id = a.equipment_id
      WHERE a.document_id = ?
    `;
    const args = [id];
    if (severity) { sql += ' AND a.severity = ?'; args.push(severity); }
    if (category) { sql += ' AND a.category = ?'; args.push(category); }
    if (status) { sql += ' AND a.status = ?'; args.push(status); }
    if (zone_id) { sql += ' AND a.zone_id = ?'; args.push(parseInt(zone_id, 10)); }
    // Tri : severity (blocking > major > minor) puis position
    sql += ` ORDER BY CASE a.severity WHEN 'blocking' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, a.position, a.id`;
    return db.db.prepare(sql).all(...args);
  });

  fastify.post('/bacs-audit/:documentId/action-items', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, request, reply)) return;
    const schema = z.object({
      category: z.string().min(1),
      severity: z.enum(['blocking','major','minor']),
      r175_article: z.string().nullable().optional(),
      title: z.string().min(1),
      description: z.string().nullable().optional(),
      zone_id: z.number().int().nullable().optional(),
      equipment_id: z.number().int().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_action_items
        (document_id, category, severity, r175_article, title, description, zone_id, equipment_id, auto_generated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(documentId, body.category, body.severity, body.r175_article || null,
      body.title, body.description || null, body.zone_id || null, body.equipment_id || null);
    logBacsAudit(request, 'bacs.action_item.create', documentId, { itemId: r.lastInsertRowid, severity: body.severity, title: body.title });
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.patch('/bacs-audit/action-items/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Item non trouve' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    const schema = z.object({
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      severity: z.enum(['blocking','major','minor']).optional(),
      // `commercial_notes` retiré de l'UI (Feature H) — colonne dormante.
      estimated_effort: z.enum(['low','medium','high']).nullable().optional(),
      status: z.enum(['open','quoted','in_progress','done','declined']).optional(),
      position: z.number().int().optional(),
      alternative_solutions_html: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    // Pour items auto-generes, on n'autorise QUE l'edit des champs commerciaux
    if (row.auto_generated) {
      const allowed = ['estimated_effort', 'status', 'position', 'alternative_solutions_html'];
      for (const k of Object.keys(body)) {
        if (!allowed.includes(k)) {
          delete body[k]; // ignore silently les champs metier
        }
      }
    }
    const sets = Object.keys(body).map(k => `${k} = ?`);
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      const values = Object.values(body);
      db.db.prepare(`UPDATE bacs_audit_action_items SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      logBacsAudit(request, 'bacs.action_item.update', row.document_id, { itemId: id, fields: Object.keys(body), auto: !!row.auto_generated });
    }
    return db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(id);
  });

  fastify.delete('/bacs-audit/action-items/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT auto_generated, document_id FROM bacs_audit_action_items WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Item non trouve' });
    if (!assertBacsAuditExists(row.document_id, request, reply, { requiredRole: 'write' })) return;
    if (row.auto_generated) {
      return reply.code(400).send({ detail: 'Items auto-generes ne peuvent pas etre supprimes (ils disparaitront seuls a la prochaine regen). Utilise status=declined a la place.' });
    }
    db.db.prepare('DELETE FROM bacs_audit_action_items WHERE id = ?').run(id);
    logBacsAudit(request, 'bacs.action_item.delete', row.document_id, { itemId: id });
    return reply.code(204).send();
  });

  // POST /bacs-audit/:documentId/action-items/regenerate — relance manuelle
  fastify.post('/bacs-audit/:documentId/action-items/regenerate', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    const result = regenerateActionItems(id);
    logBacsAudit(request, 'bacs.action_item.regenerate', id, { result });
    return result;
  });


  // ─── Check-list de collecte (mig 100) ─────────────────────────────
  // Pièces jointes du dossier (plans, schémas, GTB, IP, AF GTB, locataires…)
  // + couverture photo des entités existantes (zones / systèmes / compteurs / GTB).

  fastify.get('/bacs-audit/:documentId/checklist', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.bacsAuditChecklist.listForDocument(id);
  });

  fastify.patch('/bacs-audit/:documentId/checklist/:catalogKey', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    const key = request.params.catalogKey;
    if (!assertBacsAuditExists(id, request, reply)) return;
    if (!db.bacsChecklistCatalog.getByKey(key)) {
      return reply.code(404).send({ detail: 'Item de catalogue introuvable' });
    }
    const schema = z.object({
      status: z.enum(['pending', 'available', 'not_available']).optional(),
      notes_html: z.string().nullable().optional(),
      not_available_reason: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const out = db.bacsAuditChecklist.upsert(id, key, body);
    logBacsAudit(request, 'bacs.checklist.update', id, { catalogKey: key, status: body.status });
    return out;
  });

  fastify.get('/bacs-audit/:documentId/photo-coverage', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.bacsAuditChecklist.photoCoverage(id);
  });

  // Counts par entité — alimente les badges « 📷 N » dans les sections
  // (Vague 4 audit BACS). Bien plus utile que la couverture agrégée
  // pour l'affordance UI.
  fastify.get('/bacs-audit/:documentId/photo-counts', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.bacsAuditChecklist.photoCountsByEntity(id);
  });

  // ─── Notes par sujet de la carte GTB (mig 108 + 109) ──────────────
  // Une note libre HTML par sous-section du chapitre 6 GTB. Visible
  // dans le PDF même si la GTB est marquée Hors-Service (l'auditeur
  // doit pouvoir tout renseigner pour la traçabilité).
  fastify.get('/bacs-audit/:documentId/gtb-observations', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.bacsAuditGtbObservations.listForDocument(id);
  });

  fastify.put('/bacs-audit/:documentId/gtb-observations/:topicKey', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    const key = request.params.topicKey;
    if (!assertBacsAuditExists(id, request, reply, { requiredRole: 'write' })) return;
    if (!db.gtbTopicsCatalog.getByKey(key)) {
      return reply.code(404).send({ detail: 'Sujet GTB introuvable' });
    }
    const schema = z.object({
      observation_html: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const out = db.bacsAuditGtbObservations.upsert(id, key, body);
    logBacsAudit(request, 'bacs.gtb_topic_note.update', id, { topic: key });
    return out;
  });

  // ─── Devices (multi-systèmes par catégorie x zone) ────────────────
  // ENERGY_SOURCES, DEVICE_COMM, GENERATOR_TYPES, etc. sont importés
  // depuis ./bacs-audit/_shared (Vague 4 item 15 — source unique pour
  // que la DB CHECK + Zod + labels PDF restent alignés).

  // GET /bacs-audit/:documentId/devices — tous les devices du document, joints au système
  fastify.get('/bacs-audit/:documentId/devices', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    const rows = db.db.prepare(`
      SELECT d.*, s.system_category, s.zone_id, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category, d.position, d.id
    `).all(id);
    // Mig 143 : enrichit chaque device avec les systèmes supplémentaires où il
    // est partagé (équipement desservant plusieurs usages / zones). 1 requête
    // groupée pour éviter le N+1.
    const extras = db.bacsAuditDeviceSharedSystems.listExtrasForDocument(id);
    const extrasByDevice = new Map();
    for (const e of extras) {
      if (!extrasByDevice.has(e.device_id)) extrasByDevice.set(e.device_id, []);
      extrasByDevice.get(e.device_id).push(e.system_id);
    }
    return rows.map(d => ({ ...mapDevice(d), extra_system_ids: extrasByDevice.get(d.id) || [] }));
  });

  // PATCH /bacs-audit/devices/:id/share — partage du device avec d'autres
  // systèmes (zone × usage). Body : { extra_system_ids: [int] }. Le système
  // primaire (system_id du device) est implicite et exclu des extras. Mig 143
  // (généralise l'ancien partage zone-only mig 98).
  fastify.patch('/bacs-audit/devices/:id/share', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT d.*, s.document_id
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Équipement non trouvé' });
    if (!assertBacsAuditExists(dev.document_id, request, reply, { requiredRole: 'write' })) return;

    const schema = z.object({
      extra_system_ids: z.array(z.number().int().positive()).default([]),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    // Dédup et exclut le système primaire si fourni par erreur.
    const requested = [...new Set(body.extra_system_ids)].filter(sid => sid !== dev.system_id);
    // Vérifier que chaque système cible appartient au même document.
    for (const sid of requested) {
      const tgt = db.db.prepare('SELECT document_id FROM bacs_audit_systems WHERE id = ?').get(sid);
      if (!tgt || tgt.document_id !== dev.document_id) {
        return reply.code(400).send({ detail: `Usage #${sid} introuvable dans cet audit.` });
      }
    }

    db.bacsAuditDeviceSharedSystems.setExtraForDevice(id, requested);
    logBacsAudit(request, 'bacs.device.share', dev.document_id, { deviceId: id, extraSystemIds: requested });

    // Auto « Présent » : chaque usage où le device est désormais partagé
    // est marqué présent.
    const markPresent = db.db.prepare(
      'UPDATE bacs_audit_systems SET present = 1, not_concerned = 0 WHERE id = ?'
    );
    for (const sid of requested) markPresent.run(sid);

    regenerateActionItems(dev.document_id);

    return {
      ...mapDevice(db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(id)),
      extra_system_ids: db.bacsAuditDeviceSharedSystems.listExtraForDevice(id),
    };
  });

  // PATCH /bacs-audit/devices/:id/move — déplace le device vers un autre
  // système (zone × usage). Body : { system_id: int }.
  fastify.patch('/bacs-audit/devices/:id/move', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT d.*, s.document_id
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Équipement non trouvé' });
    if (!assertBacsAuditExists(dev.document_id, request, reply, { requiredRole: 'write' })) return;

    const schema = z.object({ system_id: z.number().int().positive() });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    const target = db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(body.system_id);
    if (!target || target.document_id !== dev.document_id) {
      return reply.code(400).send({ detail: 'Usage cible introuvable dans cet audit.' });
    }

    db.db.prepare(
      'UPDATE bacs_audit_system_devices SET system_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(body.system_id, id);
    // Un système ne peut pas être à la fois primaire et partagé.
    db.db.prepare('DELETE FROM bacs_audit_device_shared_systems WHERE device_id = ? AND system_id = ?')
      .run(id, body.system_id);
    // L'usage cible devient présent.
    db.db.prepare('UPDATE bacs_audit_systems SET present = 1, not_concerned = 0 WHERE id = ?')
      .run(body.system_id);
    logBacsAudit(request, 'bacs.device.move', dev.document_id, { deviceId: id, toSystemId: body.system_id });
    regenerateActionItems(dev.document_id);

    return {
      ...mapDevice(db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(id)),
      extra_system_ids: db.bacsAuditDeviceSharedSystems.listExtraForDevice(id),
    };
  });

  // POST /bacs-audit/systems/:id/devices — ajout d'un device au système
  // Si `equipment_template_id` est fourni, le device est pré-rempli depuis
  // ce modèle de la bibliothèque (nom + énergie + niveau par défaut). On
  // refuse alors la création si la catégorie du modèle n'est pas compatible
  // avec la system_category du système cible (cohérence forte : pas de VMC
  // dans un système Chauffage).
  fastify.post('/bacs-audit/systems/:id/devices', async (request, reply) => {
    const sysId = parseInt(request.params.id, 10);
    const sys = db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(sysId);
    if (!sys) return reply.code(404).send({ detail: 'Système non trouvé' });
    const schema = z.object({
      name: z.string().nullable().optional(),
      brand: z.string().nullable().optional(),
      model_reference: z.string().nullable().optional(),
      power_kw: z.number().nullable().optional(),
      energy_source: z.enum(ENERGY_SOURCES).nullable().optional(),
      device_role: deviceRoleSchema,
      // communication_protocol (mono, enum) conservé pour compat ascendante ;
      // communication_protocols (multi, JSON array TEXT) est le champ courant
      // — pas d'enum strict, aligné sur le tableau des équipements.
      communication_protocol: z.enum(DEVICE_COMM).nullable().optional(),
      communication_protocols: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      equipment_template_id: z.number().int().positive().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);

    // Pré-remplissage depuis un modèle bibliothèque (optionnel).
    let prefName = body.name || null;
    let prefEnergy = body.energy_source || null;
    // Multi-rôle : si l'utilisateur a fourni un device_role, on l'utilise ;
    // sinon fallback sur les rôles par défaut du template biblio.
    let prefRoles = parseRoles(body.device_role);
    if (body.equipment_template_id) {
      const tpl = db.equipmentTemplates.getById(body.equipment_template_id);
      if (!tpl) return reply.code(404).send({ detail: 'Modèle bibliothèque introuvable' });
      const { libraryCategoriesForBacsCategory } = require('../lib/system-categories');
      const allowedCats = libraryCategoriesForBacsCategory(sys.system_category);
      if (allowedCats.length && tpl.category && !allowedCats.includes(tpl.category)) {
        return reply.code(400).send({
          detail: `Modèle « ${tpl.name} » (catégorie ${tpl.category}) incompatible avec la catégorie du système (${sys.system_category}).`,
        });
      }
      // Un même modèle bibliothèque ne peut être ajouté qu'une fois par usage.
      const dup = db.db.prepare(
        'SELECT 1 FROM bacs_audit_system_devices WHERE system_id = ? AND equipment_template_id = ?'
      ).get(sysId, body.equipment_template_id);
      if (dup) {
        return reply.code(409).send({ detail: 'Ce modèle est déjà présent dans cet usage.' });
      }
      // Le payload explicite a priorité sur les défauts du template (l'utilisateur
      // peut customiser dans la modale avant de valider).
      if (!prefName) prefName = tpl.name;
      if (!prefEnergy) prefEnergy = tpl.default_energy_source || null;
      if (!prefRoles.length) prefRoles = parseRoles(tpl.default_device_role);
    }
    const prefRole = serializeRoles(prefRoles);

    // Position : derniere + 10
    const maxPos = db.db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM bacs_audit_system_devices WHERE system_id = ?').get(sysId).p;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_system_devices
        (system_id, position, name, brand, model_reference, power_kw, energy_source,
         device_role, communication_protocol, communication_protocols, location, notes, equipment_template_id,
         wired, meets_r175_3_p4, meets_r175_3_p4_autonomous, is_backup, out_of_service)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
    `).run(
      sysId, maxPos + 10,
      prefName, body.brand || null, body.model_reference || null, body.power_kw ?? null,
      prefEnergy, prefRole,
      body.communication_protocol || null,
      body.communication_protocols || null,
      body.location || null, body.notes || null,
      body.equipment_template_id || null,
    );
    logBacsAudit(request, 'bacs.device.create', sys.document_id, { systemId: sysId, deviceId: r.lastInsertRowid, fromTemplate: body.equipment_template_id || null });
    // Si le device a une energy_source, on resync les compteurs (compteur général gaz/fuel/thermique selon)
    resyncBacsAuditWithSiteZones(sys.document_id);
    regenerateActionItems(sys.document_id);
    // Recalcule + persiste bacs_total_power_kw (sinon cache obsolete cf. Communay).
    recomputeAndPersistAuditPower(db.db, sys.document_id);
    return reply.code(201).send(mapDevice(db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(r.lastInsertRowid)));
  });

  // PATCH /bacs-audit/devices/:id
  fastify.patch('/bacs-audit/devices/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT d.*, s.document_id FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Device non trouvé' });
    if (!assertBacsAuditExists(dev.document_id, request, reply, { requiredRole: 'write' })) return;
    const schemaPatch = z.object({
      name: z.string().nullable().optional(),
      brand: z.string().nullable().optional(),
      model_reference: z.string().nullable().optional(),
      power_kw: z.number().nullable().optional(),
      // Item 8 — puissance frigorifique (équipement thermodynamique) +
      // type de calcul de puissance + équipement de secours.
      power_kw_cooling: z.number().nullable().optional(),
      power_calculation_type: z.enum([
        'thermodynamic_max', 'boiler_sum', 'joule_sum',
        'district_heating_substation', 'out_of_scope',
      ]).nullable().optional(),
      is_backup: z.boolean().nullable().optional(),
      // Item 7c — séparabilité du comptage d'un équipement partagé entre
      // plusieurs zones. Pilote le regroupement en zones fonctionnelles
      // de suivi (item 7d).
      metering_separable: z.enum(['yes', 'no', 'partial']).nullable().optional(),
      metering_separable_note: z.string().nullable().optional(),
      energy_source: z.enum(ENERGY_SOURCES).nullable().optional(),
      device_role: deviceRoleSchema,
      communication_protocol: z.enum(DEVICE_COMM).nullable().optional(),
      communication_protocols: z.string().nullable().optional(),
      wired: z.boolean().nullable().optional(),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      notes_html: z.string().nullable().optional(),
      meets_r175_3_p4: z.boolean().nullable().optional(),
      meets_r175_3_p4_autonomous: z.boolean().nullable().optional(),
      managed_by_bms: z.boolean().nullable().optional(),
      out_of_service: z.boolean().nullable().optional(),
      bms_integration_out_of_service: z.boolean().nullable().optional(),
      // Mig 134 : nombre d'exemplaires identiques de ce device sur la zone.
      quantity: z.number().int().min(1).optional(),
      // Mig 135 : age en annees du systeme (etait sur thermal_regulation,
      // remonte sur le device).
      age_years: z.number().int().min(0).nullable().optional(),
      // Mig 172 : validation forcee — l'auditeur considere l'equipement
      // valide meme si tous les champs ne sont pas renseignes.
      validation_forced: z.boolean().nullable().optional(),
      // Mig 175 : l'equipement dessert plusieurs batiments (chaudiere
      // centrale, GPC, sous-station…). Deplace depuis le niveau systeme
      // — c'est l'equipement physique qui a cette caracteristique, pas
      // l'usage en abstrait.
      serves_multiple_buildings: z.boolean().nullable().optional(),
      // Mig 179 : régulation de l'équipement (refonte modale).
      has_regulation: z.boolean().nullable().optional(),
      regulator_brand: z.string().nullable().optional(),
      regulator_model_reference: z.string().nullable().optional(),
      regulator_location_zone_id: z.number().int().positive().nullable().optional(),
      regulation_type_production: z.string().nullable().optional(),
      regulation_type_distribution: z.string().nullable().optional(),
      regulation_type_emission: z.string().nullable().optional(),
      // Mig 181 : localisation libre par niveau de régulation. Acceptée en
      // texte libre (zone existante choisie dans la liste OU saisie libre).
      regulator_location_production: z.string().nullable().optional(),
      regulator_location_distribution: z.string().nullable().optional(),
      regulator_location_emission: z.string().nullable().optional(),
    });
    const schema = schemaPatch;
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) {
      let val = (typeof v === 'boolean') ? (v ? 1 : 0) : v;
      // Multi-rôle : array → JSON array string en DB.
      if (k === 'device_role') val = serializeRoles(parseRoles(v));
      sets.push(`${k} = ?`); args.push(val);
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_system_devices SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      logBacsAudit(request, 'bacs.device.update', dev.document_id, { deviceId: id, fields: Object.keys(body) });
    }
    // Energy source ou power changeants → recompute meters + actions
    resyncBacsAuditWithSiteZones(dev.document_id);
    regenerateActionItems(dev.document_id);
    return mapDevice(db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(id));
  });

  // DELETE /bacs-audit/devices/:id
  // Duplique un device avec toutes ses caracteristiques
  fastify.post('/bacs-audit/devices/:id/duplicate', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT d.*, s.document_id FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Device non trouve' });
    if (!assertBacsAuditExists(dev.document_id, request, reply, { requiredRole: 'write' })) return;
    // Copie générique de TOUTES les colonnes du device (hors id / position /
    // timestamps) : évite de perdre power_kw_cooling, power_calculation_type,
    // quantity, wired, communication_protocols, is_backup, age_years… à chaque
    // ajout de colonne. Le partage (extra_system_ids) n'est pas copié — c'est
    // une table de jonction, une copie démarre donc non partagée.
    const SKIP_COLS = new Set(['id', 'position', 'document_id', 'created_at', 'updated_at']);
    const copyCols = Object.keys(dev).filter(c => !SKIP_COLS.has(c));
    // Suffixe numérique incrémenté (cf. lib/duplicate-name.js). On regarde
    // les noms des devices déjà présents dans le MÊME système pour éviter
    // les collisions à la duplication multiple.
    const siblingNames = db.db.prepare(
      'SELECT name FROM bacs_audit_system_devices WHERE system_id = ?'
    ).all(dev.system_id).map(r => r.name).filter(Boolean);
    const nextName = require('../lib/duplicate-name').nextDuplicateName(dev.name, siblingNames);
    const copyValues = copyCols.map(c => (c === 'name' ? nextName : dev[c]));
    const r = db.db.prepare(
      `INSERT INTO bacs_audit_system_devices (position, ${copyCols.join(', ')})
       VALUES (?, ${copyCols.map(() => '?').join(', ')})`
    ).run((dev.position || 0) + 1, ...copyValues);
    regenerateActionItems(dev.document_id);
    db.auditLog.add({ afId: dev.document_id, userId: request.authUser?.id,
      action: 'bacs_device.duplicate', payload: { source_device_id: id, new_device_id: r.lastInsertRowid } });
    return reply.code(201).send(mapDevice(db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(r.lastInsertRowid)));
  });

  fastify.delete('/bacs-audit/devices/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT s.document_id FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Device non trouvé' });
    if (!assertBacsAuditExists(dev.document_id, request, reply, { requiredRole: 'write' })) return;
    db.db.prepare('DELETE FROM bacs_audit_system_devices WHERE id = ?').run(id);
    logBacsAudit(request, 'bacs.device.delete', dev.document_id, { deviceId: id });
    regenerateActionItems(dev.document_id);
    return reply.code(204).send();
  });

  // POST /bacs-audit/systems/:id/devices/reorder { ids: [...] }
  fastify.post('/bacs-audit/systems/:id/devices/reorder', async (request, reply) => {
    const sysId = parseInt(request.params.id, 10);
    const sys = db.db.prepare('SELECT id FROM bacs_audit_systems WHERE id = ?').get(sysId);
    if (!sys) return reply.code(404).send({ detail: 'Système non trouvé' });
    const ids = (request.body?.ids || []).map(n => parseInt(n, 10)).filter(Boolean);
    const upd = db.db.prepare('UPDATE bacs_audit_system_devices SET position = ? WHERE id = ? AND system_id = ?');
    for (let i = 0; i < ids.length; i++) upd.run((i + 1) * 10, ids[i], sysId);
    return { ok: true };
  });

  // POST /bacs-audit/:documentId/zones/reorder { ids: [...] }
  fastify.post('/bacs-audit/:documentId/zones/reorder', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(id, request, reply);
    if (!af) return;
    const ids = (request.body?.ids || []).map(n => parseInt(n, 10)).filter(Boolean);
    const upd = db.db.prepare('UPDATE zones SET position = ? WHERE id = ? AND site_id = ?');
    for (let i = 0; i < ids.length; i++) upd.run((i + 1) * 10, ids[i], af.site_id);
    return { ok: true };
  });

  // POST /bacs-audit/:documentId/systems/reorder { ids: [...] }
  fastify.post('/bacs-audit/:documentId/systems/reorder', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    const ids = (request.body?.ids || []).map(n => parseInt(n, 10)).filter(Boolean);
    const upd = db.db.prepare('UPDATE bacs_audit_systems SET position = ? WHERE id = ? AND document_id = ?');
    const tx = db.db.transaction((arr) => {
      for (let i = 0; i < arr.length; i++) upd.run((i + 1) * 10, arr[i], id);
    });
    tx(ids);
    return { ok: true };
  });

  // POST /bacs-audit/:documentId/meters/reorder { ids: [...] }
  fastify.post('/bacs-audit/:documentId/meters/reorder', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    const ids = (request.body?.ids || []).map(n => parseInt(n, 10)).filter(Boolean);
    const upd = db.db.prepare('UPDATE bacs_audit_meters SET position = ? WHERE id = ? AND document_id = ?');
    const tx = db.db.transaction((arr) => {
      for (let i = 0; i < arr.length; i++) upd.run((i + 1) * 10, arr[i], id);
    });
    tx(ids);
    return { ok: true };
  });

  // POST /bacs-audit/:documentId/thermal-regulation/reorder { ids: [...] }
  fastify.post('/bacs-audit/:documentId/thermal-regulation/reorder', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    const ids = (request.body?.ids || []).map(n => parseInt(n, 10)).filter(Boolean);
    const upd = db.db.prepare('UPDATE bacs_audit_thermal_regulation SET position = ? WHERE id = ? AND document_id = ?');
    const tx = db.db.transaction((arr) => {
      for (let i = 0; i < arr.length; i++) upd.run((i + 1) * 10, arr[i], id);
    });
    tx(ids);
    return { ok: true };
  });

  // GET /bacs-audit/:documentId/power-summary — synthèse puissances
  fastify.get('/bacs-audit/:documentId/power-summary', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    const rows = db.db.prepare(`
      SELECT s.system_category AS category,
             COALESCE(SUM(d.power_kw * COALESCE(d.quantity, 1)), 0) AS total_kw,
             COUNT(d.id) AS device_count
      FROM bacs_audit_systems s
      LEFT JOIN bacs_audit_system_devices d ON d.system_id = s.id
      WHERE s.document_id = ?
      GROUP BY s.system_category
    `).all(id);
    const byCategory = {};
    for (const r of rows) byCategory[r.category] = { total_kw: r.total_kw || 0, device_count: r.device_count };
    const heatingCooling = (byCategory.heating?.total_kw || 0) + (byCategory.cooling?.total_kw || 0);
    // Detail des devices comptes pour le total chauffage + clim (transparence)
    const breakdown = db.db.prepare(`
      SELECT d.id, d.name, d.brand, d.model_reference, d.power_kw, d.quantity,
             s.system_category, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.id = s.zone_id
      WHERE s.document_id = ?
        AND s.system_category IN ('heating','cooling')
        AND d.power_kw IS NOT NULL
      ORDER BY s.system_category, z.name, d.position, d.id
    `).all(id);
    // Items 5 + 8 — cumul automatique différencié chaud / froid.
    const { computeAutoPower, resolveTotalPower } = require('../lib/bacs-audit-power');
    const allDevices = db.db.prepare(`
      SELECT d.*, s.system_category
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      WHERE s.document_id = ?
    `).all(id);
    const af = db.afs.getById(id);
    const autoPower = computeAutoPower(allDevices);
    const powerSummary = resolveTotalPower(af, autoPower);
    return {
      by_category: byCategory,
      heating_cooling_total_kw: heatingCooling,
      heating_cooling_breakdown: breakdown,
      // Cumul différencié : chaud / froid / retenu (max) + mode + écart.
      power_summary: powerSummary,
    };
  });

  // POST /bacs-audit/:documentId/resync — re-synchronise les rows
  // bacs_audit_systems / thermal_regulation avec les zones actuelles du
  // site (idempotent). Appele par la UI apres ajout d'une zone.
  fastify.post('/bacs-audit/:documentId/resync', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    let result;
    try { result = resyncBacsAuditWithSiteZones(id); }
    catch (e) { return reply.code(400).send({ detail: e.message }); }
    regenerateActionItems(id);
    return result;
  });
}

module.exports = routes;
