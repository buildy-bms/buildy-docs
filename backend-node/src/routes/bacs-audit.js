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
const { resyncBacsAuditWithSiteZones } = require('../lib/seeder');
const {
  SYSTEM_CATEGORIES, COMMUNICATION_VALUES, DEVICE_COMM,
  METER_USAGES, METER_TYPES, RECOMMENDATIONS,
  REGULATION_TYPES, GENERATOR_TYPES, ENERGY_SOURCES,
  assertBacsAuditExists, logBacsAudit,
} = require('./bacs-audit/_shared');
const { sanitizeBodyHtmlFields } = require('../lib/html-sanitize');

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
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.position, s.system_category
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
    sanitizeBodyHtmlFields(body);

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
      logBacsAudit(request, 'bacs.system.update', row.document_id, { systemId: id, fields: Object.keys(body) });
    }
    regenerateActionItems(row.document_id);
    return db.db.prepare('SELECT * FROM bacs_audit_systems WHERE id = ?').get(id);
  });

  // ─── Meters (R175-3 §1) ────────────────────────────────────────────
  fastify.get('/bacs-audit/:documentId/meters', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.db.prepare(`
      SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.zone_id = m.zone_id
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
    const schema = z.object({
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
    });
    let body;
    try { body = schema.parse(request.body || {}); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);
    const maxPos = db.db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM bacs_audit_bms_components WHERE document_id = ?').get(documentId).m;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_bms_components
        (document_id, position, component_type, brand, model, location,
         ip_address, protocols, firmware_version, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      documentId, maxPos + 1,
      body.component_type || null, body.brand || null, body.model || null,
      body.location || null, body.ip_address || null, body.protocols || null,
      body.firmware_version || null, body.notes || null,
    );
    logBacsAudit(request, 'bacs.bms_component.create', documentId, { componentId: r.lastInsertRowid, type: body.component_type });
    return reply.code(201).send(db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(r.lastInsertRowid));
  });

  fastify.patch('/bacs-audit/bms-components/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT * FROM bacs_audit_bms_components WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Composant non trouve' });
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
    db.db.prepare('DELETE FROM bacs_audit_bms_components WHERE id = ?').run(id);
    logBacsAudit(request, 'bacs.bms_component.delete', row.document_id, { componentId: id });
    return reply.code(204).send();
  });


  // ─── Thermal regulation (R175-6) ───────────────────────────────────
  fastify.get('/bacs-audit/:documentId/thermal-regulation', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
    return db.db.prepare(`
      SELECT t.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.zone_id = t.zone_id
      WHERE t.document_id = ?
      ORDER BY t.position, z.position, z.name,
               CASE t.category WHEN 'heating' THEN 0 ELSE 1 END
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
      // generator_device_id = niveau "Production" (chaudière, PAC, unité
      // extérieure DRV…). Le nom DB historique reste, le label UI évolue.
      generator_device_id: z.number().int().nullable().optional(),
      generator_age_years: z.number().int().nullable().optional(),
      generator_exempt_wood: z.boolean().nullable().optional(),
      // Migration 87 : niveaux Distribution (pompes, AHU…) et Émission
      // (radiateurs, ventilo-conv, unités intérieures DRV…). Tous deux
      // facultatifs — certaines configs (DRV) sautent la distribution.
      distribution_device_id: z.number().int().nullable().optional(),
      emission_device_id: z.number().int().nullable().optional(),
      // Migration 88 : régulation par niveau (sonde extérieure, V3V,
      // robinets thermo…). Texte libre avec suggestions côté UI.
      production_regulation: z.string().nullable().optional(),
      distribution_regulation: z.string().nullable().optional(),
      emission_regulation: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      // Migration 84 : notes riches via la modale partagée (system / device /
      // meter / thermal — même UX). `notes` legacy conservé pour les saisies
      // historiques.
      notes_html: z.string().nullable().optional(),
      // Migration 61 : detail R175-6
      sensor_position: z.string().nullable().optional(),
      thermostat_type: z.string().nullable().optional(),
      has_thermostatic_valves: z.boolean().nullable().optional(),
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

  // ─── Action items (plan de mise en conformite) ─────────────────────
  fastify.get('/bacs-audit/:documentId/action-items', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, request, reply)) return;
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
    sanitizeBodyHtmlFields(body);
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
      logBacsAudit(request, 'bacs.action_item.update', row.document_id, { itemId: id, fields: Object.keys(body), auto: !!row.auto_generated });
    }
    return db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(id);
  });

  fastify.delete('/bacs-audit/action-items/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const row = db.db.prepare('SELECT auto_generated, document_id FROM bacs_audit_action_items WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ detail: 'Item non trouve' });
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
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category, d.position, d.id
    `).all(id);
    // Mig 98 : enrichit chaque device avec ses zones supplémentaires desservies
    // (chaufferie commune partagée entre Logistique + Ateliers, etc.). 1 requête
    // groupée pour éviter le N+1.
    const extras = db.bacsAuditDeviceZones.listExtrasForDocument(id);
    const extrasByDevice = new Map();
    for (const e of extras) {
      if (!extrasByDevice.has(e.device_id)) extrasByDevice.set(e.device_id, []);
      extrasByDevice.get(e.device_id).push(e.zone_id);
    }
    return rows.map(d => ({ ...d, extra_zone_ids: extrasByDevice.get(d.id) || [] }));
  });

  // PATCH /bacs-audit/devices/:id/zones — partage du device avec d'autres
  // zones fonctionnelles (mig 98). Body : { extra_zone_ids: [int] }. La zone
  // d'origine (celle du système parent) est implicite et ne fait jamais
  // partie des extras. Pas de contrainte de conflit : un même équipement
  // physique peut très bien être présent dans des zones qui ont déjà chacune
  // leur propre équipement (cas d'une chaudière de secours, par exemple).
  fastify.patch('/bacs-audit/devices/:id/zones', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const dev = db.db.prepare(`
      SELECT d.*, s.zone_id AS origin_zone_id, s.document_id, s.system_category
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      WHERE d.id = ?
    `).get(id);
    if (!dev) return reply.code(404).send({ detail: 'Équipement non trouvé' });

    const schema = z.object({
      extra_zone_ids: z.array(z.number().int().positive()).default([]),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    sanitizeBodyHtmlFields(body);

    // Dédup et exclut la zone d'origine si fournie par erreur.
    const requested = [...new Set(body.extra_zone_ids)].filter(z => z !== dev.origin_zone_id);
    // Vérifier que chaque zone existe (sécurité)
    for (const zid of requested) {
      if (!db.db.prepare('SELECT 1 FROM zones WHERE zone_id = ?').get(zid)) {
        return reply.code(400).send({ detail: `Zone #${zid} introuvable.` });
      }
    }

    db.bacsAuditDeviceZones.setExtraForDevice(id, requested);
    logBacsAudit(request, 'bacs.device.share', dev.document_id, { deviceId: id, extraZoneIds: requested });

    // Auto « Présent » : pour chaque zone supplémentaire désormais desservie,
    // s'assurer qu'il y a un système de la même catégorie marqué present=1.
    // Si la matrice BACS l'avait pré-généré on bascule juste le flag, sinon
    // on crée la ligne hors-matrice (cas cogénération, GTC dédiée, etc.).
    const upsertPresent = db.db.prepare(`
      INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(document_id, zone_id, system_category) DO UPDATE SET present = 1, not_concerned = 0
    `);
    for (const zid of requested) {
      upsertPresent.run(dev.document_id, zid, dev.system_category);
    }

    regenerateActionItems(dev.document_id);

    return {
      ...db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(id),
      extra_zone_ids: db.bacsAuditDeviceZones.listExtraForDevice(id),
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
      device_role: z.string().nullable().optional(),
      communication_protocol: z.enum(DEVICE_COMM).nullable().optional(),
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
    let prefRole = body.device_role || null;
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
      // Le payload explicite a priorité sur les défauts du template (l'utilisateur
      // peut customiser dans la modale avant de valider).
      if (!prefName) prefName = tpl.name;
      if (!prefEnergy) prefEnergy = tpl.default_energy_source || null;
      if (!prefRole) prefRole = tpl.default_device_role || null;
    }

    // Position : derniere + 10
    const maxPos = db.db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM bacs_audit_system_devices WHERE system_id = ?').get(sysId).p;
    const r = db.db.prepare(`
      INSERT INTO bacs_audit_system_devices
        (system_id, position, name, brand, model_reference, power_kw, energy_source,
         device_role, communication_protocol, location, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sysId, maxPos + 10,
      prefName, body.brand || null, body.model_reference || null, body.power_kw ?? null,
      prefEnergy, prefRole,
      body.communication_protocol || null,
      body.location || null, body.notes || null,
    );
    logBacsAudit(request, 'bacs.device.create', sys.document_id, { systemId: sysId, deviceId: r.lastInsertRowid, fromTemplate: body.equipment_template_id || null });
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
      device_role: z.string().nullable().optional(),
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
    });
    const schema = schemaPatch;
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
      db.db.prepare(`UPDATE bacs_audit_system_devices SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      logBacsAudit(request, 'bacs.device.update', dev.document_id, { deviceId: id, fields: Object.keys(body) });
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
    const upd = db.db.prepare('UPDATE zones SET position = ? WHERE zone_id = ? AND site_id = ?');
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
    if (!assertBacsAuditExists(id, request, reply)) return;
    let result;
    try { result = resyncBacsAuditWithSiteZones(id); }
    catch (e) { return reply.code(400).send({ detail: e.message }); }
    regenerateActionItems(id);
    return result;
  });
}

module.exports = routes;
