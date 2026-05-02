'use strict';

const db = require('../../database');

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

module.exports = {
  SYSTEM_CATEGORIES, COMMUNICATION_VALUES, METER_USAGES, METER_TYPES,
  RECOMMENDATIONS, REGULATION_TYPES, GENERATOR_TYPES,
  assertBacsAuditExists,
};
