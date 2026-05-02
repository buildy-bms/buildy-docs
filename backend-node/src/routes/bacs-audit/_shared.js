'use strict';

const db = require('../../database');
const { buildAuditRefs } = require('../../lib/bacs-audit-refs');

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
  if (af.kind !== 'bacs_audit' && af.kind !== 'site_audit') {
    reply.code(400).send({ detail: 'Document n\'est pas un audit (BACS ou site)' });
    return null;
  }
  return af;
}

function loadRefsInputs(documentId) {
  const af = db.afs.getById(documentId);
  if (!af) return null;
  const site = af.site_id ? db.sites.getById(af.site_id) : null;
  const zones = site ? db.db.prepare(
    'SELECT * FROM zones WHERE site_id = ? AND deleted_at IS NULL'
  ).all(site.site_id) : [];
  const systems = db.db.prepare('SELECT * FROM bacs_audit_systems WHERE document_id = ?').all(documentId);
  const devices = db.db.prepare(`
    SELECT d.* FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    WHERE s.document_id = ?
  `).all(documentId);
  const meters = db.db.prepare('SELECT * FROM bacs_audit_meters WHERE document_id = ?').all(documentId);
  const thermal = db.db.prepare('SELECT * FROM bacs_audit_thermal_regulation WHERE document_id = ?').all(documentId);
  return { zones, systems, devices, meters, thermal };
}

function refsToFlatMaps(refs) {
  const out = { zones: {}, systems: {}, devices: {}, meters: {}, thermal: {} };
  for (const k of Object.keys(out)) {
    for (const [id, info] of refs[k]) out[k][id] = info.ref;
  }
  return out;
}

module.exports = {
  SYSTEM_CATEGORIES, COMMUNICATION_VALUES, METER_USAGES, METER_TYPES,
  RECOMMENDATIONS, REGULATION_TYPES, GENERATOR_TYPES,
  assertBacsAuditExists, loadRefsInputs, refsToFlatMaps, buildAuditRefs,
};
