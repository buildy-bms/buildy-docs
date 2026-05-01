'use strict';

const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { renderPdf, loadAssetDataUrl } = require('../lib/pdf');
const { assistAuditSynthesis, assistActionAlternatives } = require('../lib/claude');
const { regenerateActionItems } = require('../lib/bacs-audit-action-generator');
const { seedBacsAuditStructure, resyncBacsAuditWithSiteZones } = require('../lib/seeder');
const gitLib = require('../lib/git');
const bacsArticlesData = require('../seeds/bacs-articles');
const bacsAuditMethodology = require('../lib/bacs-audit-methodology');
const bacsAuditDisclaimers = require('../lib/bacs-audit-disclaimers');

const SYSTEM_CATEGORIES = ['heating','cooling','ventilation','dhw',
  'lighting_indoor','lighting_outdoor','electricity_production'];
const COMMUNICATION_VALUES = ['modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp',
  'knx','mbus','mqtt','autre','non_communicant','absent'];
const METER_USAGES = ['heating','cooling','dhw','pv','lighting','other'];
const METER_TYPES = ['electric','electric_production','gas','water','thermal'];
const RECOMMENDATIONS = ['to_add','to_replace','to_connect','compliant'];
const REGULATION_TYPES = ['per_room','per_zone','central_only','none'];
const GENERATOR_TYPES = ['gas','electric','heat_pump','wood_appliance','district_heating','other'];

function assertBacsAuditExists(documentId, reply) {
  const af = db.afs.getById(documentId);
  if (!af) {
    reply.code(404).send({ detail: 'Document non trouve' });
    return null;
  }
  if (af.kind !== 'bacs_audit') {
    reply.code(400).send({ detail: 'Document n\'est pas un audit BACS' });
    return null;
  }
  return af;
}

async function routes(fastify) {
  // ─── Systems (R175-1 §4 + R175-3 §3) ───────────────────────────────
  fastify.get('/bacs-audit/:documentId/systems', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    return db.db.prepare(`
      SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_systems s
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category
    `).all(id);
  });

  fastify.patch('/bacs-audit/systems/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne system non trouvee' });

    const schema = z.object({
      present: z.boolean().optional(),
      communication: z.enum(COMMUNICATION_VALUES).nullable().optional(),
      equipment_id: z.number().int().nullable().optional(),
      notes: z.string().nullable().optional(),
      notes_html: z.string().nullable().optional(),
      meets_r175_3_p3: z.boolean().nullable().optional(),
      meets_r175_3_p4: z.boolean().nullable().optional(),
      meets_r175_3_p4_autonomous: z.boolean().nullable().optional(),
      notes_p3: z.string().nullable().optional(),
      notes_p4: z.string().nullable().optional(),
      notes_p4_autonomous: z.string().nullable().optional(),
      managed_by_bms: z.boolean().nullable().optional(),
      not_concerned: z.boolean().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    const sets = [], args = [];
    const boolField = (k) => {
      if (k in body) {
        sets.push(`${k} = ?`);
        args.push(body[k] == null ? null : (body[k] ? 1 : 0));
      }
    };
    if (body.present !== undefined) { sets.push('present = ?'); args.push(body.present ? 1 : 0); }
    boolField('not_concerned');
    if ('communication' in body) { sets.push('communication = ?'); args.push(body.communication); }
    if ('equipment_id' in body) { sets.push('equipment_id = ?'); args.push(body.equipment_id); }
    if ('notes' in body) { sets.push('notes = ?'); args.push(body.notes); }
    boolField('meets_r175_3_p3');
    boolField('meets_r175_3_p4');
    boolField('meets_r175_3_p4_autonomous');
    boolField('managed_by_bms');
    if ('notes_p3' in body) { sets.push('notes_p3 = ?'); args.push(body.notes_p3); }
    if ('notes_p4' in body) { sets.push('notes_p4 = ?'); args.push(body.notes_p4); }
    if ('notes_p4_autonomous' in body) { sets.push('notes_p4_autonomous = ?'); args.push(body.notes_p4_autonomous); }
    if ('notes_html' in body) { sets.push('notes_html = ?'); args.push(body.notes_html); }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_systems SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(id);
  });

  // ─── Meters (R175-3 §1) ────────────────────────────────────────────
  fastify.get('/bacs-audit/:documentId/meters', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    return db.db.prepare(`
      SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.zone_id = m.zone_id
      WHERE m.document_id = ?
      ORDER BY z.position NULLS LAST, m.usage, m.meter_type
    `).all(id);
  });

  fastify.post('/bacs-audit/:documentId/meters', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, reply)) return;
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
    regenerateActionItems(documentId);
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.patch('/bacs-audit/meters/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne meter non trouvee' });
    const schema = z.object({
      required: z.boolean().optional(),
      present_actual: z.boolean().optional(),
      communicating: z.boolean().optional(),
      communication_protocol: z.string().nullable().optional(),
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
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(id);
  });

  // Duplique un compteur (avec ses notes / rattachement device)
  fastify.post('/bacs-audit/meters/:id/duplicate', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const m = db.db.prepare('SELECT * FROM bacs_audit_meters WHERE id = ?').get(id);
    if (!m) return reply.code(404).send({ detail: 'Compteur non trouve' });
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
    db.db.prepare('DELETE FROM bacs_audit_meters WHERE id = ?').run(id);
    regenerateActionItems(row.document_id);
    return reply.code(204).send();
  });

  // ─── BMS (R175-3 / R175-4 / R175-5) ────────────────────────────────
  fastify.get('/bacs-audit/:documentId/bms', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    return db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(id) || { document_id: id };
  });

  fastify.put('/bacs-audit/:documentId/bms', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(documentId, reply)) return;
    // Helper : accepte boolean, 0/1, true/false (string ou number) et null
    const boolish = z.preprocess((v) => {
      if (v === null || v === undefined) return v;
      if (typeof v === 'boolean') return v;
      if (v === 1 || v === '1' || v === 'true') return true;
      if (v === 0 || v === '0' || v === 'false') return false;
      return v;
    }, z.boolean().nullable().optional());
    const schema = z.object({
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
      notes_p1: z.string().nullable().optional(),
      notes_p2: z.string().nullable().optional(),
      has_maintenance_procedures: boolish,
      notes_maintenance: z.string().nullable().optional(),
      operator_trained: boolish,
      operator_training_date: z.string().nullable().optional(),
      notes_training: z.string().nullable().optional(),
      overall_compliance: z.enum(['compliant','partial','non_compliant']).nullable().optional(),
      out_of_service: boolish,
      notes_html: z.string().nullable().optional(),
      // R175-3 dernier alinea
      data_provision_to_manager: boolish,
      data_provision_to_operators: boolish,
      notes_data_provision: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
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
    }
    regenerateActionItems(documentId);
    return db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId);
  });

  // ─── Thermal regulation (R175-6) ───────────────────────────────────
  fastify.get('/bacs-audit/:documentId/thermal-regulation', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    return db.db.prepare(`
      SELECT t.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.zone_id = t.zone_id
      WHERE t.document_id = ?
      ORDER BY z.position, z.name
    `).all(id);
  });

  fastify.patch('/bacs-audit/thermal-regulation/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_thermal_regulation WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Ligne thermal_regulation non trouvee' });
    const schema = z.object({
      has_automatic_regulation: z.boolean().optional(),
      regulation_type: z.enum(REGULATION_TYPES).nullable().optional(),
      generator_type: z.enum(GENERATOR_TYPES).nullable().optional(),
      generator_age_years: z.number().int().nullable().optional(),
      generator_exempt_wood: z.boolean().nullable().optional(),
      notes: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) {
      const val = (typeof v === 'boolean') ? (v ? 1 : 0) : v;
      sets.push(`${k} = ?`); args.push(val);
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_thermal_regulation SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_thermal_regulation WHERE id = ?').get(id);
  });

  // ─── Action items (plan de mise en conformite) ─────────────────────
  fastify.get('/bacs-audit/:documentId/action-items', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    const { severity, category, status, zone_id } = request.query;
    let sql = `
      SELECT a.*, z.name AS zone_name, e.name AS equipment_name
      FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      LEFT JOIN equipments e ON e.equipment_id = a.equipment_id
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
    if (!assertBacsAuditExists(documentId, reply)) return;
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
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_action_items
        (document_id, category, severity, r175_article, title, description, zone_id, equipment_id, auto_generated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(documentId, body.category, body.severity, body.r175_article || null,
      body.title, body.description || null, body.zone_id || null, body.equipment_id || null);
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.patch('/bacs-audit/action-items/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Item non trouve' });
    const schema = z.object({
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      severity: z.enum(['blocking','major','minor']).optional(),
      commercial_notes: z.string().nullable().optional(),
      estimated_effort: z.enum(['low','medium','high']).nullable().optional(),
      status: z.enum(['open','quoted','in_progress','done','declined']).optional(),
      position: z.number().int().optional(),
      alternative_solutions_html: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    // Pour items auto-generes, on n'autorise QUE l'edit des champs commerciaux
    if (row.auto_generated) {
      const allowed = ['commercial_notes', 'estimated_effort', 'status', 'position', 'alternative_solutions_html'];
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
    }
    return db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(id);
  });

  fastify.delete('/bacs-audit/action-items/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT auto_generated FROM bacs_audit_action_items WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Item non trouve' });
    if (row.auto_generated) {
      return reply.code(400).send({ detail: 'Items auto-generes ne peuvent pas etre supprimes (ils disparaitront seuls a la prochaine regen). Utilise status=declined a la place.' });
    }
    db.db.prepare('DELETE FROM bacs_audit_action_items WHERE id = ?').run(id);
    return reply.code(204).send();
  });

  // POST /bacs-audit/:documentId/action-items/regenerate — relance manuelle
  fastify.post('/bacs-audit/:documentId/action-items/regenerate', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    const result = regenerateActionItems(id);
    return result;
  });

  // GET /bacs-audit/:documentId/action-items/export.csv — pour devis commercial
  fastify.get('/bacs-audit/:documentId/action-items/export.csv', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    const items = db.db.prepare(`
      SELECT a.*, z.name AS zone_name, e.name AS equipment_name
      FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      LEFT JOIN equipments e ON e.equipment_id = a.equipment_id
      WHERE a.document_id = ?
      ORDER BY CASE a.severity WHEN 'blocking' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, a.position
    `).all(id);
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Severity', 'Article R175', 'Categorie', 'Titre', 'Zone', 'Equipement',
      'Description', 'Status', 'Estimated effort', 'Notes commerciales'];
    const rows = [headers.join(',')];
    for (const it of items) {
      rows.push([
        esc(it.severity), esc(it.r175_article), esc(it.category), esc(it.title),
        esc(it.zone_name), esc(it.equipment_name), esc(it.description),
        esc(it.status), esc(it.estimated_effort), esc(it.commercial_notes),
      ].join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="audit-bacs-${id}-actions.csv"`);
    return rows.join('\n');
  });

  // ─── Export PDF audit BACS ─────────────────────────────────────────
  fastify.post('/bacs-audit/:documentId/export-pdf', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    // Donnees principales
    const site = af.site_id ? db.sites.getById(af.site_id) : null;
    const zones = site ? db.zones.listBySite(site.site_id) : [];
    const systems = db.db.prepare(`
      SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_systems s LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category
    `).all(documentId);
    const meters = db.db.prepare(`
      SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.zone_id = m.zone_id
      WHERE m.document_id = ?
      ORDER BY z.position NULLS LAST, m.usage
    `).all(documentId);
    const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null;
    const thermalRaw = db.db.prepare(`
      SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.zone_id = t.zone_id
      WHERE t.document_id = ?
      ORDER BY z.position, z.name
    `).all(documentId);
    // On filtre done + declined : ces actions ne doivent pas apparaitre
    // dans le PDF livre aux integrateurs GTB.
    const actionItemsRaw = db.db.prepare(`
      SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      WHERE a.document_id = ? AND a.status NOT IN ('done', 'declined')
      ORDER BY a.position, a.id
    `).all(documentId);

    // Labels d'enums (pour eviter les codes anglais bruts dans le PDF)
    const SYSTEM_LABEL = { heating:'Chauffage', cooling:'Refroidissement', ventilation:'Ventilation',
      dhw:'Eau chaude sanitaire', lighting_indoor:'Éclairage intérieur',
      lighting_outdoor:'Éclairage extérieur', electricity_production:'Production photovoltaïque' };
    const SYSTEM_NEGATIVE_LABEL = { heating:'Pas de chauffage', cooling:'Pas de refroidissement',
      ventilation:'Pas de ventilation', dhw:'Pas d\'ECS',
      lighting_indoor:'Pas d\'éclairage intérieur', lighting_outdoor:'Pas d\'éclairage extérieur',
      electricity_production:'Pas de production photovoltaïque' };
    const COMM_LABEL = { modbus_tcp:'Modbus TCP', modbus_rtu:'Modbus RTU', bacnet_ip:'BACnet IP',
      bacnet_mstp:'BACnet MS/TP', knx:'KNX', mbus:'M-Bus', mqtt:'MQTT', lorawan:'LoRaWAN',
      autre:'Autre', non_communicant:'Non communicant', absent:'Absent' };
    const ENERGY_LABEL = { gas:'Gaz', electric:'Électrique', wood:'Bois', heat_pump:'PAC',
      district_heating:'Réseau de chaleur', fuel_oil:'Fioul', solar:'Solaire',
      biomass:'Biomasse', autre:'Autre' };
    const ROLE_LABEL = { production:'Production', distribution:'Distribution',
      emission:'Émission', regulation:'Régulation', autre:'Autre' };
    const METER_TYPE_LABEL = { electric:'Électrique', electric_production:'Électrique de production',
      gas:'Gaz', water:'Eau', thermal:'Thermique', other:'Autre' };
    const METER_USAGE_LABEL = { heating:'Chauffage', cooling:'Refroidissement',
      dhw:'ECS', pv:'Production PV', lighting:'Éclairage', other:'Général' };
    const REGULATION_LABEL = { per_room:'Par pièce', per_zone:'Par zone',
      central_only:'Centrale uniquement', none:'Aucune' };
    const GENERATOR_LABEL = { gas:'Gaz', electric:'Effet Joule', heat_pump:'Pompe à chaleur',
      wood_appliance:'Appareil bois (exempté R175-6)', district_heating:'Réseau de chaleur', other:'Autre' };
    const APPLICABILITY_LABEL = {
      subject_immediate: 'Immédiate (bâtiment > 290 kW déjà existant)',
      subject_2025: '1er janvier 2025 (puissance > 290 kW)',
      subject_2027: '1er janvier 2027 (puissance > 70 kW)',
      not_subject: 'Non assujetti (puissance < 70 kW)',
    };
    const COMPLIANCE_LABEL = { compliant:'Conforme', partial:'Partiellement conforme', non_compliant:'Non conforme' };

    // Charge tous les devices du document (joints au systeme parent)
    const devices = db.db.prepare(`
      SELECT d.*, s.system_category, s.zone_id, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category, d.position, d.id
    `).all(documentId);
    const devicesBySystem = new Map();
    for (const d of devices) {
      d.energyLabel = d.energy_source ? (ENERGY_LABEL[d.energy_source] || d.energy_source) : '—';
      d.roleLabel = d.device_role ? (ROLE_LABEL[d.device_role] || d.device_role) : '—';
      d.commLabel = d.communication_protocol
        ? (COMM_LABEL[d.communication_protocol] || d.communication_protocol)
        : 'Non communicant';
      if (!devicesBySystem.has(d.system_id)) devicesBySystem.set(d.system_id, []);
      devicesBySystem.get(d.system_id).push(d);
    }

    // Enrichit systems avec devices + sums et group par zone
    const enrichedSystems = systems.map(s => {
      const devs = devicesBySystem.get(s.id) || [];
      const totalKw = devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0), 0);
      return {
        ...s,
        categoryLabel: SYSTEM_LABEL[s.system_category] || s.system_category,
        negativeLabel: SYSTEM_NEGATIVE_LABEL[s.system_category] || `Pas de ${(SYSTEM_LABEL[s.system_category] || s.system_category).toLowerCase()}`,
        commLabel: s.communication ? (COMM_LABEL[s.communication] || s.communication) : '—',
        devices: devs,
        device_count: devs.length,
        total_power_kw: totalKw,
      };
    });
    // Group systems par zone
    const systemsByZoneMap = new Map();
    for (const s of enrichedSystems) {
      const k = s.zone_id;
      if (!systemsByZoneMap.has(k)) {
        systemsByZoneMap.set(k, { zone_name: s.zone_name, zone_nature: s.zone_nature, items: [] });
      }
      systemsByZoneMap.get(k).items.push(s);
    }
    const systemsByZone = [...systemsByZoneMap.values()];

    // Enrichit meters
    const enrichedMeters = meters.map(m => ({
      ...m,
      typeLabel: METER_TYPE_LABEL[m.meter_type] || m.meter_type,
      usageLabel: METER_USAGE_LABEL[m.usage] || m.usage,
      zoneLabel: m.zone_name || 'Général bâtiment',
    }));

    // ── Photos ────────────────────────────────────────────────────────
    // On charge tous les site_documents categorie 'photo' du site et on
    // les rattache a chaque entite scope (zone, systeme, compteur, device,
    // GTB) sous forme de data URL JPEG. Les photos ont deja ete optimisees
    // a l'upload (sharp 1600px max, JPEG q=82), inutile de retraiter ici.
    if (site) {
      const photoRows = db.db.prepare(`
        SELECT id, filename, mime_type,
               bacs_audit_zone_id, bacs_audit_system_id, bacs_audit_meter_id,
               bacs_audit_device_id, bacs_audit_bms_document_id
        FROM site_documents
        WHERE site_id = ? AND category = 'photo'
        ORDER BY uploaded_at ASC
      `).all(site.site_id);
      const docsRoot = path.resolve(config.attachmentsDir, '..', 'site-documents', site.site_uuid);
      const toDataUrl = (filename, mime) => {
        try {
          const p = path.join(docsRoot, filename);
          const b64 = fs.readFileSync(p).toString('base64');
          return `data:${mime || 'image/jpeg'};base64,${b64}`;
        } catch { return null; }
      };
      const zonePhotos = new Map();
      const systemPhotos = new Map();
      const meterPhotos = new Map();
      const devicePhotos = new Map();
      const bmsPhotos = [];
      for (const ph of photoRows) {
        const url = toDataUrl(ph.filename, ph.mime_type);
        if (!url) continue;
        const item = { id: ph.id, dataUrl: url };
        if (ph.bacs_audit_zone_id) {
          if (!zonePhotos.has(ph.bacs_audit_zone_id)) zonePhotos.set(ph.bacs_audit_zone_id, []);
          zonePhotos.get(ph.bacs_audit_zone_id).push(item);
        }
        if (ph.bacs_audit_system_id) {
          if (!systemPhotos.has(ph.bacs_audit_system_id)) systemPhotos.set(ph.bacs_audit_system_id, []);
          systemPhotos.get(ph.bacs_audit_system_id).push(item);
        }
        if (ph.bacs_audit_meter_id) {
          if (!meterPhotos.has(ph.bacs_audit_meter_id)) meterPhotos.set(ph.bacs_audit_meter_id, []);
          meterPhotos.get(ph.bacs_audit_meter_id).push(item);
        }
        if (ph.bacs_audit_device_id) {
          if (!devicePhotos.has(ph.bacs_audit_device_id)) devicePhotos.set(ph.bacs_audit_device_id, []);
          devicePhotos.get(ph.bacs_audit_device_id).push(item);
        }
        if (ph.bacs_audit_bms_document_id === documentId) {
          bmsPhotos.push(item);
        }
      }
      // On rattache les photos directement aux entites pour simplifier le template
      for (const z of zones) z.photos = zonePhotos.get(z.zone_id) || [];
      for (const m of enrichedMeters) m.photos = meterPhotos.get(m.id) || [];
      for (const d of devices) d.photos = devicePhotos.get(d.id) || [];
      for (const sys of enrichedSystems) sys.photos = systemPhotos.get(sys.id) || [];
      if (bms) bms.photos = bmsPhotos;
    }

    // Listes GTB integration : devices + meters integres
    const bmsManagedDevices = devices.filter(d => d.managed_by_bms);
    const bmsManagedMeters = enrichedMeters.filter(m => m.managed_by_bms);

    const thermal = thermalRaw.map(t => ({
      ...t,
      regulationLabel: t.regulation_type ? (REGULATION_LABEL[t.regulation_type] || t.regulation_type) : '—',
      generatorLabel: t.generator_type ? (GENERATOR_LABEL[t.generator_type] || t.generator_type) : '—',
    }));

    // Plan de mise en conformite groupe par severite
    // Numerotation BACS-001/002/... pour faciliter le devis des integrateurs.
    // L'ordre suit l'affichage du PDF : bloquantes -> majeures -> mineures.
    const numberedItems = [
      ...actionItemsRaw.filter(a => a.severity === 'blocking'),
      ...actionItemsRaw.filter(a => a.severity === 'major'),
      ...actionItemsRaw.filter(a => a.severity === 'minor'),
    ].map((a, idx) => ({
      ...a,
      display_number: 'BACS-' + String(idx + 1).padStart(3, '0'),
    }));
    const actionItems = { blocking: [], major: [], minor: [] };
    for (const a of numberedItems) actionItems[a.severity]?.push(a);
    const actionStats = {
      blocking: actionItems.blocking.length,
      major: actionItems.major.length,
      minor: actionItems.minor.length,
    };

    // Justifications (Annexe C)
    const justifications = actionItemsRaw.map(a => ({
      title: a.title,
      article: a.r175_article || '—',
      source: a.source_table ? `${a.source_table} (#${a.source_id})` : 'Item manuel',
      description: a.description || a.title,
    }));

    // Articles BACS (Annexe A) — adapte au format attendu par le template
    const bacsArticles = bacsArticlesData.BACS_ARTICLES.map(a => ({
      code: a.code,
      title: a.title,
      html: a.full_html,
    }));

    // Detection solution Buildy (pour mention R175-5 native)
    const buildySolution = bms && /buildy/i.test(`${bms.existing_solution || ''} ${bms.existing_solution_brand || ''}`);

    // Version (compteur d'exports BACS pour ce document)
    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-bacs-audit'
    `).get(documentId).c;
    const version = `bacs-v${previousCount + 1}`;

    const exportDate = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    // R175-6 applicabilite : declencheur (PC > 21/07/2021 OU travaux generateur)
    const R175_6_TRIGGER = '2021-07-21';
    const pcAfter = af.bacs_building_permit_date && af.bacs_building_permit_date > R175_6_TRIGGER;
    const worksAfter = af.bacs_generator_works_date && af.bacs_generator_works_date > R175_6_TRIGGER;
    const r175_6_applicable = pcAfter || worksAfter
      ? { applies: true, reason: pcAfter && worksAfter
            ? 'permis de construire postérieur au 21/07/2021 et travaux générateur récents'
            : (pcAfter ? 'permis de construire postérieur au 21/07/2021' : 'travaux d\'installation/remplacement de générateur postérieurs au 21/07/2021') }
      : { applies: false, reason: 'aucun déclencheur (permis de construire et travaux générateur antérieurs ou égaux au 21/07/2021)' };

    // Detail du calcul auto chauffage + clim (pour transparence dans le PDF)
    const heatingCoolingBreakdown = devices
      .filter(d => ['heating','cooling'].includes(d.system_category) && d.power_kw != null)
      .map(d => ({
        name: d.name, brand: d.brand, model_reference: d.model_reference,
        power_kw: d.power_kw, zone_name: d.zone_name,
        category: d.system_category,
        categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
      }));
    const heatingCoolingTotal = heatingCoolingBreakdown.reduce((s, d) => s + (Number(d.power_kw) || 0), 0);

    const data = {
      document: af,
      site,
      zones,
      systemsByZone,
      meters: enrichedMeters,
      thermal,
      bms,
      bmsManagedDevices,
      bmsManagedMeters,
      buildySolution,
      actionItems,
      actionStats,
      synthesisHtml: af.audit_synthesis_html || null,
      heatingCoolingBreakdown,
      heatingCoolingTotal: Math.round(heatingCoolingTotal * 10) / 10,
      r175_6_applicable,
      complianceLabel: bms?.overall_compliance ? COMPLIANCE_LABEL[bms.overall_compliance] : null,
      applicabilityLabel: af.bacs_applicability_status ? APPLICABILITY_LABEL[af.bacs_applicability_status] : null,
      bacsArticles,
      methodology: bacsAuditMethodology,
      disclaimers: bacsAuditDisclaimers,
      justifications,
      authorName: user?.display_name || 'Buildy Docs',
      exportDate,
      version,
      logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    };

    // Genere le PDF
    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${af.slug}-bacs-audit-${version}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, String(documentId), filename);

    const logoSmall = loadAssetDataUrl('logo-buildy.svg');
    const WATERMARK_PATH = path.resolve(__dirname, '../../templates/pdf/assets/watermark-buildy.png');
    const BUILDY_WATERMARK = { imagePath: WATERMARK_PATH, widthRatio: 0.85, heightRatio: 0.85, opacity: 0.03 };

    let result;
    try {
      result = await renderPdf({
        template: 'bacs-audit',
        styles: 'styles-bacs-audit',
        data,
        outputPath,
        populateToc: true,
        pageFormat: 'A4',
        skipFirstPageHeaderFooter: true,
        coverFullBleed: true,
        watermark: { ...BUILDY_WATERMARK, skipFirstPage: true },
        pdfOptions: {
          displayHeaderFooter: true,
          margin: { top: '18mm', bottom: '16mm', left: '12mm', right: '12mm' },
          headerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:8pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; justify-content:space-between;">
            <span>${af.client_name} — ${af.project_name}</span>
            <span>Audit BACS ${version}</span>
          </div>`,
          footerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:8pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; align-items:center; gap:6mm;">
            <img src="${logoSmall}" style="height:5mm; opacity:0.6;" />
            <span style="flex:1;">Audit BACS Buildy · décret R175 · confidentiel</span>
            <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
        },
      });
    } catch (err) {
      log.error(`PDF audit BACS render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }

    // Insert dans exports + audit
    const insertedRow = db.db.prepare(`
      INSERT INTO exports (af_id, kind, file_path, sections_snapshot, options, motif, exported_by, file_size_bytes)
      VALUES (?, 'pdf-bacs-audit', ?, ?, ?, ?, ?, ?)
    `).run(
      documentId, result.path,
      JSON.stringify({ systems_count: systems.length, meters_count: meters.length,
        actions_blocking: actionStats.blocking, actions_major: actionStats.major }),
      JSON.stringify({ version }),
      'Export audit BACS',
      userId || null, result.sizeBytes,
    );

    db.auditLog.add({
      afId: documentId, userId, action: 'export.bacs-audit',
      payload: { version, file_size_bytes: result.sizeBytes, actions_total: actionItemsRaw.length },
    });
    log.info(`PDF audit BACS exported: doc #${documentId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);

    return {
      id: insertedRow.lastInsertRowid,
      version,
      file_size_bytes: result.sizeBytes,
      download_url: `/api/exports/${insertedRow.lastInsertRowid}/download`,
    };
  });

  // ─── Devices (multi-systèmes par catégorie x zone) ────────────────
  const ENERGY_SOURCES = ['gas','electric','wood','heat_pump','district_heating','fuel_oil','solar','biomass','autre'];
  const DEVICE_ROLES = ['production','distribution','emission','regulation','autre'];
  const DEVICE_COMM = ['modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp','knx','mbus','mqtt','lorawan','autre','non_communicant','absent'];

  // GET /bacs-audit/:documentId/devices — tous les devices du document, joints au système
  fastify.get('/bacs-audit/:documentId/devices', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    return db.db.prepare(`
      SELECT d.*, s.system_category, s.zone_id, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category, d.position, d.id
    `).all(id);
  });

  // POST /bacs-audit/systems/:id/devices — ajout d'un device au système
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
      device_role: z.enum(DEVICE_ROLES).nullable().optional(),
      communication_protocol: z.enum(DEVICE_COMM).nullable().optional(),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    // Position : derniere + 10
    const maxPos = db.db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM bacs_audit_system_devices WHERE system_id = ?').get(sysId).p;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_system_devices
        (system_id, position, name, brand, model_reference, power_kw, energy_source,
         device_role, communication_protocol, location, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sysId, maxPos + 10,
      body.name || null, body.brand || null, body.model_reference || null, body.power_kw ?? null,
      body.energy_source || null, body.device_role || null,
      body.communication_protocol || null,
      body.location || null, body.notes || null,
    );
    // Si le device a une energy_source, on resync les compteurs (compteur général gaz/fuel/thermique selon)
    resyncBacsAuditWithSiteZones(sys.document_id);
    regenerateActionItems(sys.document_id);
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(r.lastInsertRowid));
  });

  // PATCH /bacs-audit/devices/:id
  fastify.patch('/bacs-audit/devices/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT d.*, s.document_id FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Device non trouvé' });
    const schemaPatch = z.object({
      name: z.string().nullable().optional(),
      brand: z.string().nullable().optional(),
      model_reference: z.string().nullable().optional(),
      power_kw: z.number().nullable().optional(),
      energy_source: z.enum(ENERGY_SOURCES).nullable().optional(),
      device_role: z.enum(DEVICE_ROLES).nullable().optional(),
      communication_protocol: z.enum(DEVICE_COMM).nullable().optional(),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      notes_html: z.string().nullable().optional(),
      meets_r175_3_p4: z.boolean().nullable().optional(),
      meets_r175_3_p4_autonomous: z.boolean().nullable().optional(),
      managed_by_bms: z.boolean().nullable().optional(),
      out_of_service: z.boolean().nullable().optional(),
      bms_integration_out_of_service: z.boolean().nullable().optional(),
    });
    const schema = schemaPatch;
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) {
      const val = (typeof v === 'boolean') ? (v ? 1 : 0) : v;
      sets.push(`${k} = ?`); args.push(val);
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      args.push(id);
      db.db.prepare(`UPDATE bacs_audit_system_devices SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    // Energy source ou power changeants → recompute meters + actions
    resyncBacsAuditWithSiteZones(dev.document_id);
    regenerateActionItems(dev.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(id);
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
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_system_devices
        (system_id, position, name, brand, model_reference, power_kw, energy_source,
         device_role, communication_protocol, location, notes, notes_html,
         meets_r175_3_p4, meets_r175_3_p4_autonomous, managed_by_bms,
         out_of_service, bms_integration_out_of_service)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dev.system_id, (dev.position || 0) + 1,
      dev.name ? `${dev.name} (copie)` : null,
      dev.brand, dev.model_reference, dev.power_kw, dev.energy_source,
      dev.device_role, dev.communication_protocol, dev.location,
      dev.notes, dev.notes_html, dev.meets_r175_3_p4, dev.meets_r175_3_p4_autonomous,
      dev.managed_by_bms, dev.out_of_service, dev.bms_integration_out_of_service,
    );
    regenerateActionItems(dev.document_id);
    db.auditLog.add({ afId: dev.document_id, userId: request.authUser?.id,
      action: 'bacs_device.duplicate', payload: { source_device_id: id, new_device_id: r.lastInsertRowid } });
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.delete('/bacs-audit/devices/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT s.document_id FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Device non trouvé' });
    db.db.prepare('DELETE FROM bacs_audit_system_devices WHERE id = ?').run(id);
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
    const af = assertBacsAuditExists(id, reply);
    if (!af) return;
    const ids = (request.body?.ids || []).map(n => parseInt(n, 10)).filter(Boolean);
    const upd = db.db.prepare('UPDATE zones SET position = ? WHERE zone_id = ? AND site_id = ?');
    for (let i = 0; i < ids.length; i++) upd.run((i + 1) * 10, ids[i], af.site_id);
    return { ok: true };
  });

  // GET /bacs-audit/:documentId/power-summary — synthèse puissances
  fastify.get('/bacs-audit/:documentId/power-summary', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    const rows = db.db.prepare(`
      SELECT s.system_category AS category,
             COALESCE(SUM(d.power_kw), 0) AS total_kw,
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
      SELECT d.id, d.name, d.brand, d.model_reference, d.power_kw,
             s.system_category, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
        AND s.system_category IN ('heating','cooling')
        AND d.power_kw IS NOT NULL
      ORDER BY s.system_category, z.name, d.position, d.id
    `).all(id);
    return { by_category: byCategory, heating_cooling_total_kw: heatingCooling, heating_cooling_breakdown: breakdown };
  });

  // POST /bacs-audit/:documentId/resync — re-synchronise les rows
  // bacs_audit_systems / thermal_regulation avec les zones actuelles du
  // site (idempotent). Appele par la UI apres ajout d'une zone.
  fastify.post('/bacs-audit/:documentId/resync', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    let result;
    try { result = resyncBacsAuditWithSiteZones(id); }
    catch (e) { return reply.code(400).send({ detail: e.message }); }
    regenerateActionItems(id);
    return result;
  });

  // ─── Livraison de l'audit ──────────────────────────────────────────
  // Workflow simplifie : draft -> review -> delivered. Au passage delivered :
  //   1. Genere le PDF final
  //   2. Calcule SHA256 du PDF -> documents.delivered_pdf_sha256
  //   3. Snapshot JSON + PDF dans le repo Git du document, tag annote
  //   4. documents.delivered_at + delivered_git_tag remplis
  //   5. Audit log
  // Re-livraison : nouveau tag avec suffixe -v2/-v3 (cf lib/git.js).
  fastify.post('/bacs-audit/:documentId/deliver', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    // 1. Genere le PDF final via l'endpoint export-pdf interne (re-utilise la
    // meme logique : on duplique pas la generation, on appelle inject)
    const pdfRes = await fastify.inject({
      method: 'POST',
      url: `/api/bacs-audit/${documentId}/export-pdf`,
      headers: request.headers, // forward auth
    });
    if (pdfRes.statusCode !== 200) {
      return reply.code(500).send({ detail: `Echec generation PDF : ${pdfRes.body}` });
    }
    const exportData = JSON.parse(pdfRes.body);
    const exportRow = db.db.prepare('SELECT file_path FROM exports WHERE id = ?').get(exportData.id);
    const pdfPath = exportRow.file_path;

    // 2 + 3 + 4 : SHA256 + snapshot Git + tag
    let snap;
    try {
      snap = await gitLib.commitBacsAuditDelivery(documentId, pdfPath, {
        author: user ? { name: user.display_name || 'Buildy Docs', email: user.email || 'noreply@buildy.fr' } : undefined,
      });
    } catch (e) {
      log.error(`commitBacsAuditDelivery a echoue pour doc #${documentId} : ${e.message}`);
      return reply.code(500).send({ detail: `Snapshot Git echoue : ${e.message}` });
    }

    db.afs.update(documentId, {
      status: 'livree', // FR temporaire, sera 'delivered' apres rename m37
      deliveredAt: new Date().toISOString(),
      deliveredPdfSha256: snap.sha256,
      deliveredGitTag: snap.gitTag,
      updatedBy: userId,
    });

    db.auditLog.add({
      afId: documentId, userId, action: 'document.delivered',
      payload: { kind: 'bacs_audit', git_tag: snap.gitTag, sha256: snap.sha256, export_id: exportData.id },
    });
    log.info(`Audit BACS #${documentId} livre par user #${userId} — tag=${snap.gitTag}`);

    return {
      delivered_at: new Date().toISOString(),
      delivered_pdf_sha256: snap.sha256,
      delivered_git_tag: snap.gitTag,
      pdf_export_id: exportData.id,
      pdf_download_url: exportData.download_url,
    };
  });

  // ─── Stepper progression (v2.9 / v2.10) ────────────────────────────
  // 10 etapes manuelles a valider par l'auditeur :
  //   identification, zones, systems, meters, thermal, bms, documents,
  //   credentials, review, synthesis.
  const AUDIT_STEPS = ['identification','zones','systems','meters','thermal','bms','documents','credentials','review','synthesis'];

  fastify.post('/bacs-audit/:documentId/validate-step', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const schema = z.object({
      step: z.enum(AUDIT_STEPS),
      validated: z.boolean(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    let progress = {};
    try { progress = JSON.parse(af.audit_progress || '{}'); }
    catch { progress = {}; }

    if (body.validated) {
      const user = request.authUser?.id ? db.users.getById(request.authUser.id) : null;
      progress[body.step] = {
        validated: true,
        validated_at: new Date().toISOString(),
        validated_by: request.authUser?.id || null,
        validated_by_name: user?.display_name || user?.email || null,
      };
    } else {
      delete progress[body.step];
    }

    db.db.prepare('UPDATE afs SET audit_progress = ? WHERE id = ?')
      .run(JSON.stringify(progress), documentId);

    db.auditLog.add({
      afId: documentId,
      userId: request.authUser?.id,
      action: body.validated ? 'bacs_audit.step.validate' : 'bacs_audit.step.invalidate',
      payload: { step: body.step },
    });

    const validatedCount = AUDIT_STEPS.filter(s => progress[s]?.validated).length;
    return {
      audit_progress: progress,
      validated_count: validatedCount,
      total_steps: AUDIT_STEPS.length,
      completion_percent: Math.round((validatedCount / AUDIT_STEPS.length) * 100),
    };
  });

  // ─── Note de synthese (v2.10) ──────────────────────────────────────
  // PUT manuel + POST generate (Claude). La note HTML est ensuite injectee
  // en tete du PDF d'audit (chapitre 0 - Synthese executive).
  fastify.put('/bacs-audit/:documentId/synthesis', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const schema = z.object({ html: z.string().nullable().optional() });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    db.afs.update(documentId, { audit_synthesis_html: body.html ?? null });
    return db.afs.getById(documentId);
  });

  // POST /bacs-audit/action-items/:id/generate-alternatives — R175-5-1 4°
  fastify.post('/bacs-audit/action-items/:id/generate-alternatives', async (request, reply) => {
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ detail: 'Assistant Claude non configure' });
    }
    const id = parseInt(request.params.id, 10);
    const item = db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(id);
    if (!item) return reply.code(404).send({ detail: 'Action non trouvee' });
    const ctx = {
      title: item.title,
      description: item.description,
      severity: item.severity,
      r175_article: item.r175_article,
      source_table: item.source_table,
      source_subtype: item.source_subtype,
      action_kind: item.action_kind,
    };
    try {
      const { html, usage } = await assistActionAlternatives(ctx);
      db.db.prepare('UPDATE bacs_audit_action_items SET alternative_solutions_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(html, id);
      db.auditLog.add({
        afId: item.document_id,
        userId: request.authUser?.id,
        action: 'bacs_audit.action_alternatives.generate',
        payload: { action_item_id: id, length: html.length, usage },
      });
      return { html, usage };
    } catch (err) {
      log.error(`Generation alternatives echouee : ${err.message}`);
      return reply.code(500).send({ detail: err.message });
    }
  });

  fastify.post('/bacs-audit/:documentId/generate-synthesis', async (request, reply) => {
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ detail: 'Assistant Claude non configure (ANTHROPIC_API_KEY manquant)' });
    }
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const site = af.site_id ? db.sites.getByIdInternal?.(af.site_id) || db.sites.getById(af.site_id) : null;
    const zones = site ? db.zones.listBySite(site.site_id) : [];
    const systems = db.db.prepare(`
      SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_systems s LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category
    `).all(documentId);
    const devices = db.db.prepare(`
      SELECT d.*, s.system_category, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
    `).all(documentId);
    const meters = db.db.prepare(`
      SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.zone_id = m.zone_id
      WHERE m.document_id = ?
    `).all(documentId);
    const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null;
    const thermal = db.db.prepare(`
      SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.zone_id = t.zone_id
      WHERE t.document_id = ?
    `).all(documentId);
    const actionItems = db.db.prepare(`
      SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      WHERE a.document_id = ? AND a.status NOT IN ('done','declined')
      ORDER BY (CASE a.severity WHEN 'blocking' THEN 0 WHEN 'major' THEN 1 ELSE 2 END), a.position, a.id
    `).all(documentId);

    // Dump structure (notes incluses) pour permettre a Claude de produire
    // une synthese fidele aux donnees saisies sans avoir a inventer.
    const stripHtml = (s) => s ? String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;
    const auditDump = {
      // Cadre legal de l'audit : se positionne comme rapport d'inspection
      // periodique R175-5-1 du decret BACS (a conserver 10 ans).
      regulatory_frame: {
        decree: 'R175 (Decret BACS, modifie par decret 2023-259)',
        report_type: 'Inspection periodique R175-5-1',
        retention_years: 10,
      },
      audit: {
        client_name: af.client_name,
        project_name: af.project_name,
        applicability_status: af.bacs_applicability_status,
        applicable_deadline: af.bacs_applicable_deadline,
        total_power_kw: af.bacs_total_power_kw,
        total_power_source: af.bacs_total_power_source,
        building_permit_date: af.bacs_building_permit_date,
        // R175-2 : pour batiments raccordes a un reseau urbain, la
        // puissance a considerer est celle de la station d'echange.
        district_heating_substation_kw: af.bacs_district_heating_substation_kw,
        // R175-5-1 1° : examen de l'analyse fonctionnelle existante
        // (uniquement a la 1ere inspection).
        existing_af_status: af.audit_existing_af_status,
      },
      site: site ? { name: site.name, address: site.address, city: site.city } : null,
      zones: zones.map(z => ({
        name: z.name, nature: z.nature, surface_m2: z.surface_m2,
        notes: stripHtml(z.notes_html) || z.notes,
      })),
      systems: systems.filter(s => s.present).map(s => ({
        category: s.system_category, zone: s.zone_name,
        meets_r175_3_p3: !!s.meets_r175_3_p3,
        meets_r175_3_p4: !!s.meets_r175_3_p4,
        meets_r175_3_p4_autonomous: !!s.meets_r175_3_p4_autonomous,
        managed_by_bms: !!s.managed_by_bms,
        notes: stripHtml(s.notes_html) || s.notes,
      })),
      devices: devices.map(d => ({
        name: d.name, brand: d.brand, model: d.model_reference,
        category: d.system_category, zone: d.zone_name,
        energy_source: d.energy_source, power_kw: d.power_kw,
        communication_protocol: d.communication_protocol,
        meets_r175_3_p4: !!d.meets_r175_3_p4,
        managed_by_bms: !!d.managed_by_bms,
        out_of_service: !!d.out_of_service,
        notes: stripHtml(d.notes_html) || d.notes,
      })),
      meters: meters.map(m => ({
        zone: m.zone_name || 'Compteur general', usage: m.usage,
        type: m.meter_type, required: !!m.required,
        present: !!m.present_actual, communicating: !!m.communicating,
        managed_by_bms: !!m.managed_by_bms,
        notes: stripHtml(m.notes_html) || m.notes,
      })),
      bms: bms ? {
        existing_solution: bms.existing_solution,
        brand: bms.existing_solution_brand,
        location: bms.location, model_reference: bms.model_reference,
        manages: {
          heating: !!bms.manages_heating, cooling: !!bms.manages_cooling,
          ventilation: !!bms.manages_ventilation, dhw: !!bms.manages_dhw,
          lighting: !!bms.manages_lighting,
        },
        meets_r175_3_p1: !!bms.meets_r175_3_p1,
        meets_r175_3_p2: !!bms.meets_r175_3_p2,
        has_maintenance_procedures: !!bms.has_maintenance_procedures,
        operator_trained: !!bms.operator_trained,
        operator_training_date: bms.operator_training_date,
        overall_compliance: bms.overall_compliance,
        out_of_service: !!bms.out_of_service,
        notes: stripHtml(bms.notes_html),
      } : null,
      thermal_regulation: thermal.map(t => ({
        zone: t.zone_name, regulation_type: t.regulation_type,
        generator_type: t.generator_type, age_years: t.age_years,
        notes: t.notes,
      })),
      action_items_open: actionItems.map(a => ({
        severity: a.severity, article: a.r175_article,
        title: a.title, description: a.description,
        zone: a.zone_name, estimated_effort: a.estimated_effort,
        status: a.status,
        commercial_notes: a.commercial_notes,
        // R175-5-1 4° : autres solutions envisageables
        alternative_solutions: stripHtml(a.alternative_solutions_html),
      })),
      stats: {
        zones_count: zones.length,
        systems_present: systems.filter(s => s.present).length,
        devices_count: devices.length,
        meters_required: meters.filter(m => m.required).length,
        meters_present: meters.filter(m => m.present_actual).length,
        actions_blocking: actionItems.filter(a => a.severity === 'blocking').length,
        actions_major: actionItems.filter(a => a.severity === 'major').length,
        actions_minor: actionItems.filter(a => a.severity === 'minor').length,
      },
    };

    try {
      const { html, usage } = await assistAuditSynthesis(auditDump);
      db.afs.update(documentId, {
        audit_synthesis_html: html,
        audit_synthesis_generated_at: new Date().toISOString(),
      });
      db.auditLog.add({
        afId: documentId,
        userId: request.authUser?.id,
        action: 'bacs_audit.synthesis.generate',
        payload: { length: html.length, usage },
      });
      return { html, usage, generated_at: new Date().toISOString() };
    } catch (err) {
      log.error(`Generation synthese audit BACS echouee : ${err.message}`);
      return reply.code(500).send({ detail: err.message || 'Echec generation synthese' });
    }
  });

  // ─── Fixture de test (v2.14) ───────────────────────────────────────
  // Cree de bout en bout un audit BACS fictif complet pour tests :
  // site + zones + systemes presents + devices + meters + GTB partiellement
  // conforme + thermal regulation + plan d'action genere. Aucune donnee
  // saisie sur des sites reels n'est touchee.
  fastify.post('/bacs-audit/seed-fixture', async (request, reply) => {
    const userId = request.authUser?.id;
    const ts = Date.now();
    const siteUuid = require('crypto').randomUUID();

    // 1. Site
    const site = db.sites.create({
      siteUuid,
      name: `Bâtiment Démo BACS — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      customerName: 'Société Démo Tertiaire SAS',
      address: '12 rue des Tests, 75001 Paris',
      notes: 'Site fictif généré pour tester l\'audit BACS de bout en bout. Supprimable sans impact.',
      createdBy: userId,
    });

    // 2. Zones
    const zonesData = [
      { name: 'Open-space niveau 1', nature: 'open-space', surface_m2: 280 },
      { name: 'Salles de réunion', nature: 'meeting-room', surface_m2: 60 },
      { name: 'Couloirs & circulations', nature: 'corridor', surface_m2: 90 },
      { name: 'Local technique sous-sol', nature: 'technical-area', surface_m2: 25 },
      { name: 'Parking extérieur', nature: 'outdoor', surface_m2: 400 },
    ];
    const zones = zonesData.map((z, idx) => db.zones.create({
      siteId: site.site_id, name: z.name, nature: z.nature,
      position: idx, surfaceM2: z.surface_m2,
    }));

    // 3. Audit BACS
    const slug = `audit-demo-bacs-${ts}`;
    const af = db.afs.create({
      slug, clientName: 'Société Démo Tertiaire SAS',
      projectName: 'Mise en conformité BACS — Bâtiment Démo',
      siteAddress: '12 rue des Tests, 75001 Paris',
      kind: 'bacs_audit', siteId: site.site_id,
      title: 'Audit BACS de démonstration', createdBy: userId,
    });
    seedBacsAuditStructure(af.id, site.site_id);

    // 4. Identification + applicabilite R175-2 + R175-6
    db.afs.update(af.id, {
      bacs_total_power_kw: 145,
      bacs_total_power_source: 'auto',
      bacs_district_heating_substation_kw: null,
      bacs_building_permit_date: '2010-06-15',
      // Travaux generateur recents → declenche R175-6 sur les zones non
      // exemptees, permet de tester le flux applicabilite + actions.
      bacs_generator_works_date: '2023-09-15',
      bacs_applicability_status: 'subject_2027',
      bacs_applicable_deadline: '2027-01-01',
      audit_existing_af_status: 'absent',
    });

    // 5. Marquer 4 categories comme presentes (sur la zone open-space + couloirs)
    const openSpace = zones.find(z => z.nature === 'open-space');
    const corridors = zones.find(z => z.nature === 'corridor');
    const localTech = zones.find(z => z.nature === 'technical-area');
    const parking = zones.find(z => z.nature === 'outdoor');

    const presentSystems = [
      { zone_id: openSpace.zone_id, category: 'heating' },
      { zone_id: openSpace.zone_id, category: 'cooling' },
      { zone_id: openSpace.zone_id, category: 'ventilation' },
      { zone_id: openSpace.zone_id, category: 'lighting_indoor' },
      { zone_id: corridors.zone_id, category: 'lighting_indoor' },
      { zone_id: parking.zone_id, category: 'lighting_outdoor' },
      { zone_id: localTech.zone_id, category: 'dhw' },
    ];
    for (const ps of presentSystems) {
      db.db.prepare(`
        UPDATE bacs_audit_systems SET present = 1, updated_at = CURRENT_TIMESTAMP
        WHERE document_id = ? AND zone_id = ? AND system_category = ?
      `).run(af.id, ps.zone_id, ps.category);
    }

    // 6. Devices realistes
    const findSystem = (zoneId, cat) => db.db.prepare(
      'SELECT id FROM bacs_audit_systems WHERE document_id = ? AND zone_id = ? AND system_category = ?'
    ).get(af.id, zoneId, cat)?.id;

    const devices = [
      { sys: findSystem(openSpace.zone_id, 'heating'),
        name: 'Chaudière gaz', brand: 'Atlantic', model: 'Varmax 70',
        power: 70, energy: 'gas', role: 'production', comm: 'modbus_rtu',
        location: 'Local technique sous-sol' },
      { sys: findSystem(openSpace.zone_id, 'cooling'),
        name: 'Groupe extérieur DRV', brand: 'Daikin', model: 'VRV-IV 75',
        power: 75, energy: 'electric', role: 'production', comm: 'absent',
        location: 'Toiture' },
      { sys: findSystem(openSpace.zone_id, 'ventilation'),
        name: 'CTA double flux', brand: 'Aldes', model: 'DFE 800',
        power: 6, energy: 'electric', role: 'production', comm: 'modbus_tcp',
        location: 'Toiture' },
      { sys: findSystem(openSpace.zone_id, 'lighting_indoor'),
        name: 'Pavés LED bureaux', brand: 'Trilux', model: 'Sonnos M73',
        power: 4, energy: 'electric', role: 'emission', comm: 'non_communicant',
        location: 'Plafond open-space' },
      { sys: findSystem(corridors.zone_id, 'lighting_indoor'),
        name: 'Rubans LED couloirs', brand: 'Sylvania', model: 'StripLED 24V',
        power: 1.2, energy: 'electric', role: 'emission', comm: 'non_communicant',
        location: 'Couloirs étage' },
      { sys: findSystem(parking.zone_id, 'lighting_outdoor'),
        name: 'Mâts LED parking', brand: 'Schréder', model: 'Avento 2',
        power: 2.5, energy: 'electric', role: 'emission', comm: 'absent',
        location: 'Parking extérieur' },
      { sys: findSystem(localTech.zone_id, 'dhw'),
        name: 'Ballon ECS électrique', brand: 'Atlantic', model: 'Chauffeo 200L',
        power: 2.4, energy: 'electric', role: 'production', comm: 'absent',
        location: 'Local technique' },
    ];
    const insDev = db.db.prepare(`
      INSERT INTO bacs_audit_system_devices
        (system_id, position, name, brand, model_reference, power_kw,
         energy_source, device_role, communication_protocol, location,
         meets_r175_3_p4, meets_r175_3_p4_autonomous, managed_by_bms)
      VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of devices) {
      if (!d.sys) continue;
      // Heuristique : devices communicants supposes interoperables et integres GTB
      const interop = !['absent', 'non_communicant'].includes(d.comm);
      insDev.run(
        d.sys, d.name, d.brand, d.model, d.power, d.energy, d.role, d.comm, d.location,
        interop ? 1 : 0,                                // arret manuel si communicant
        interop ? 1 : 0,                                // autonome
        interop ? 1 : 0,                                // managed_by_bms
      );
    }

    // 7. Resync pour generer les compteurs requis et thermal
    resyncBacsAuditWithSiteZones(af.id);

    // 8. Marquer une partie des compteurs comme presents communicants
    const meters = db.db.prepare('SELECT id FROM bacs_audit_meters WHERE document_id = ?').all(af.id);
    // 1/2 des compteurs presents, 1/3 communicants
    meters.forEach((m, idx) => {
      const present = idx % 2 === 0;
      const comm = present && idx % 3 === 0;
      db.db.prepare(`
        UPDATE bacs_audit_meters SET present_actual = ?, communicating = ?,
        managed_by_bms = ? WHERE id = ?
      `).run(present ? 1 : 0, comm ? 1 : 0, comm ? 1 : 0, m.id);
    });

    // 9. GTB partiellement conforme
    db.db.prepare(`
      INSERT INTO bacs_audit_bms (document_id, existing_solution, existing_solution_brand,
        location, model_reference, manages_heating, manages_cooling, manages_ventilation,
        manages_dhw, manages_lighting, meets_r175_3_p1, meets_r175_3_p2,
        has_maintenance_procedures, operator_trained, overall_compliance,
        data_provision_to_manager, data_provision_to_operators, notes_data_provision)
      VALUES (?, 'Niagara N4', 'Tridium', 'Local technique sous-sol', 'JACE 8000',
        1, 1, 1, 0, 0, 0, 0, 1, 0, 'partial',
        0, 0, 'Aucun mécanisme formel de mise à disposition des données identifié au moment de la visite.')
      ON CONFLICT(document_id) DO UPDATE SET
        existing_solution = excluded.existing_solution,
        existing_solution_brand = excluded.existing_solution_brand,
        location = excluded.location, model_reference = excluded.model_reference,
        manages_heating = excluded.manages_heating, manages_cooling = excluded.manages_cooling,
        manages_ventilation = excluded.manages_ventilation, manages_dhw = excluded.manages_dhw,
        manages_lighting = excluded.manages_lighting,
        meets_r175_3_p1 = excluded.meets_r175_3_p1, meets_r175_3_p2 = excluded.meets_r175_3_p2,
        has_maintenance_procedures = excluded.has_maintenance_procedures,
        operator_trained = excluded.operator_trained, overall_compliance = excluded.overall_compliance,
        data_provision_to_manager = excluded.data_provision_to_manager,
        data_provision_to_operators = excluded.data_provision_to_operators,
        notes_data_provision = excluded.notes_data_provision,
        updated_at = CURRENT_TIMESTAMP
    `).run(af.id);

    // 10. Thermal regulation : per_room sur open-space, none sur les autres
    db.db.prepare(`
      UPDATE bacs_audit_thermal_regulation SET regulation_type = 'per_room',
        generator_type = 'gas', generator_age_years = 12 WHERE document_id = ? AND zone_id = ?
    `).run(af.id, openSpace.zone_id);

    // 11. Final regen plan
    regenerateActionItems(af.id);

    db.auditLog.add({
      afId: af.id, userId, action: 'bacs_audit.fixture.create',
      payload: { site_uuid: site.site_uuid, zones: zones.length, devices: devices.length },
    });

    return reply.code(201).send({
      af_id: af.id, slug: af.slug,
      site_id: site.site_id, site_uuid: site.site_uuid,
      detail_url: `/bacs-audit/${af.id}`,
    });
  });
}

module.exports = routes;
