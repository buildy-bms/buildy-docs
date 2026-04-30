'use strict';

const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { renderPdf, loadAssetDataUrl } = require('../lib/pdf');
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
      meets_r175_3_p3: z.boolean().nullable().optional(),
      meets_r175_3_p4: z.boolean().nullable().optional(),
      meets_r175_3_p4_autonomous: z.boolean().nullable().optional(),
      notes_p3: z.string().nullable().optional(),
      notes_p4: z.string().nullable().optional(),
      notes_p4_autonomous: z.string().nullable().optional(),
      managed_by_bms: z.boolean().nullable().optional(),
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
    const schema = z.object({
      existing_solution: z.string().nullable().optional(),
      existing_solution_brand: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      model_reference: z.string().nullable().optional(),
      manages_heating: z.boolean().nullable().optional(),
      manages_cooling: z.boolean().nullable().optional(),
      manages_ventilation: z.boolean().nullable().optional(),
      manages_dhw: z.boolean().nullable().optional(),
      manages_lighting: z.boolean().nullable().optional(),
      meets_r175_3_p1: z.boolean().nullable().optional(),
      meets_r175_3_p2: z.boolean().nullable().optional(),
      notes_p1: z.string().nullable().optional(),
      notes_p2: z.string().nullable().optional(),
      has_maintenance_procedures: z.boolean().nullable().optional(),
      notes_maintenance: z.string().nullable().optional(),
      operator_trained: z.boolean().nullable().optional(),
      operator_training_date: z.string().nullable().optional(),
      notes_training: z.string().nullable().optional(),
      overall_compliance: z.enum(['compliant','partial','non_compliant']).nullable().optional(),
      out_of_service: z.boolean().nullable().optional(),
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
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    // Pour items auto-generes, on n'autorise QUE l'edit des champs commerciaux
    if (row.auto_generated) {
      const allowed = ['commercial_notes', 'estimated_effort', 'status', 'position'];
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
    const actionItemsRaw = db.db.prepare(`
      SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      WHERE a.document_id = ? AND a.status NOT IN ('done', 'declined')
      ORDER BY a.position, a.id
    `).all(documentId);

    // Labels d'enums (pour eviter les codes anglais bruts dans le PDF)
    const SYSTEM_LABEL = { heating:'Chauffage', cooling:'Refroidissement', ventilation:'Ventilation',
      dhw:'Eau chaude sanitaire', lighting_indoor:'Éclairage intérieur',
      lighting_outdoor:'Éclairage extérieur', electricity_production:'Production électrique' };
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

    // Listes GTB integration : devices + meters integres
    const bmsManagedDevices = devices.filter(d => d.managed_by_bms);
    const bmsManagedMeters = enrichedMeters.filter(m => m.managed_by_bms);

    const thermal = thermalRaw.map(t => ({
      ...t,
      regulationLabel: t.regulation_type ? (REGULATION_LABEL[t.regulation_type] || t.regulation_type) : '—',
      generatorLabel: t.generator_type ? (GENERATOR_LABEL[t.generator_type] || t.generator_type) : '—',
    }));

    // Plan de mise en conformite groupe par severite
    const actionItems = { blocking: [], major: [], minor: [] };
    for (const a of actionItemsRaw) actionItems[a.severity]?.push(a);
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

    let result;
    try {
      result = await renderPdf({
        template: 'bacs-audit',
        styles: 'styles-bacs-audit',
        data,
        outputPath,
        pageFormat: 'A4',
        coverFullBleed: true,
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
    return { by_category: byCategory, heating_cooling_total_kw: heatingCooling };
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
}

module.exports = routes;
