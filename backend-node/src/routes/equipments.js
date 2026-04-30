'use strict';

const { z } = require('zod');
const db = require('../database');

// Enum types : compteurs + systemes techniques (aligne convention Directus + R175-1 §4)
const EQUIPMENT_TYPES = [
  // Compteurs
  'electric-meter', 'electric-meter-production', 'water-meter', 'water-meter-drilling',
  'gas-meter', 'thermal-meter', 'thermal-energy-meter',
  // Systemes techniques (CTA, CTAs, PAC, chaudieres, eclairages, etc.)
  'cta', 'rooftop', 'heat-pump', 'boiler', 'chiller', 'fan-coil', 'split',
  'hot-water-tank', 'thermostat', 'lighting-indoor', 'lighting-outdoor',
  'shade', 'iaq-sensor', 'door', 'gate', 'pv-inverter', 'bms',
  // Catch-all
  'other',
];

const COMMUNICATION_PROTOCOLS = [
  'modbus_tcp', 'modbus_rtu', 'bacnet_ip', 'bacnet_mstp',
  'knx', 'mbus', 'mqtt', 'analog', 'none', 'other',
];

const EQUIPMENT_STATUSES = ['designed', 'commissioned', 'tested', 'operational', 'decommissioned'];

const createEquipmentSchema = z.object({
  zone_id: z.number().int().positive(),
  name: z.string().min(1, 'Nom requis'),
  type: z.enum(EQUIPMENT_TYPES),
  power_kw: z.number().nullable().optional(),
  communication_protocol: z.enum(COMMUNICATION_PROTOCOLS).nullable().optional(),
  installation_date: z.string().nullable().optional(),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  bacs_classification: z.record(z.string(), z.boolean()).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateEquipmentSchema = createEquipmentSchema.partial();

async function routes(fastify) {
  // GET /api/equipments?zone_id=... | site_id=...
  fastify.get('/equipments', async (request, reply) => {
    const zoneId = parseInt(request.query.zone_id, 10);
    const siteId = parseInt(request.query.site_id, 10);
    if (zoneId) {
      const zone = db.zones.getById(zoneId);
      if (!zone || zone.deleted_at) return reply.code(404).send({ detail: 'Zone non trouvee' });
      return db.equipments.listByZone(zoneId);
    }
    if (siteId) {
      const site = db.sites.getById(siteId);
      if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
      return db.equipments.listBySite(siteId);
    }
    return reply.code(400).send({ detail: 'zone_id ou site_id requis' });
  });

  // GET /api/equipments/:id
  fastify.get('/equipments/:id', async (request, reply) => {
    const eq = db.equipments.getById(parseInt(request.params.id, 10));
    if (!eq || eq.deleted_at) return reply.code(404).send({ detail: 'Equipement non trouve' });
    return eq;
  });

  // POST /api/equipments
  fastify.post('/equipments', async (request, reply) => {
    let body;
    try { body = createEquipmentSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    const zone = db.zones.getById(body.zone_id);
    if (!zone || zone.deleted_at) return reply.code(404).send({ detail: 'Zone non trouvee' });
    const eq = db.equipments.create({
      zoneId: body.zone_id,
      name: body.name,
      type: body.type,
      powerKw: body.power_kw ?? null,
      communicationProtocol: body.communication_protocol || null,
      installationDate: body.installation_date || null,
      status: body.status || 'operational',
      bacsClassification: body.bacs_classification || null,
      notes: body.notes || null,
    });
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'equipment.create',
      payload: { equipment_id: eq.equipment_id, zone_id: body.zone_id, type: body.type },
    });
    return reply.code(201).send(eq);
  });

  // PATCH /api/equipments/:id
  fastify.patch('/equipments/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const eq = db.equipments.getById(id);
    if (!eq || eq.deleted_at) return reply.code(404).send({ detail: 'Equipement non trouve' });
    let body;
    try { body = updateEquipmentSchema.parse(request.body); }
    catch (err) {
      return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation echouee' });
    }
    // Renommage clefs camelCase pour db.equipments.update
    const fields = {};
    if (body.zone_id !== undefined) fields.zoneId = body.zone_id;
    if (body.name !== undefined) fields.name = body.name;
    if (body.type !== undefined) fields.type = body.type;
    if (body.power_kw !== undefined) fields.powerKw = body.power_kw;
    if (body.communication_protocol !== undefined) fields.communicationProtocol = body.communication_protocol;
    if (body.installation_date !== undefined) fields.installationDate = body.installation_date;
    if (body.status !== undefined) fields.status = body.status;
    if (body.bacs_classification !== undefined) fields.bacsClassification = body.bacs_classification;
    if (body.notes !== undefined) fields.notes = body.notes;
    const updated = db.equipments.update(id, fields);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'equipment.update',
      payload: { equipment_id: id, fields: Object.keys(body) },
    });
    return updated;
  });

  // DELETE /api/equipments/:id
  fastify.delete('/equipments/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const eq = db.equipments.getById(id);
    if (!eq) return reply.code(404).send({ detail: 'Equipement non trouve' });
    if (!eq.deleted_at) {
      db.equipments.softDelete(id);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'equipment.delete',
        payload: { equipment_id: id },
      });
    }
    return reply.code(204).send();
  });

  // GET /api/equipments/bacs-power-cumul?site_id=... — cumul auto chauffage+clim (R175-2)
  fastify.get('/equipments/bacs-power-cumul', async (request, reply) => {
    const siteId = parseInt(request.query.site_id, 10);
    if (!siteId) return reply.code(400).send({ detail: 'site_id requis' });
    const site = db.sites.getById(siteId);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    return { site_id: siteId, total_power_kw: db.equipments.sumBacsPowerForSite(siteId) };
  });
}

module.exports = routes;
module.exports.EQUIPMENT_TYPES = EQUIPMENT_TYPES;
module.exports.COMMUNICATION_PROTOCOLS = COMMUNICATION_PROTOCOLS;
module.exports.EQUIPMENT_STATUSES = EQUIPMENT_STATUSES;
