'use strict';

const db = require('../database');
const { buildAuditRefs } = require('./bacs-audit-refs');

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'Eau chaude sanitaire',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
};

const METER_USAGE_LABEL = {
  heating: 'Chauffage', cooling: 'Refroidissement', dhw: 'ECS',
  pv: 'Production PV', lighting: 'Éclairage', other: 'Général',
};

const METER_TYPE_LABEL = {
  electric: 'Électrique', electric_production: 'Électrique de production',
  gas: 'Gaz', water: 'Eau', thermal: 'Thermique',
};

// Construit la donnee a injecter dans le template bacs-audit-checklist.hbs.
// L'objectif est de produire une feuille A4 imprimable que le collaborateur
// emporte sur site, coche/annote au stylo, et reutilise pour la restitution
// (mapping photos + transcript Plaud via la ref stable).
function buildChecklistData(documentId) {
  const af = db.afs.getById(documentId);
  if (!af) return null;
  const site = af.site_id ? db.sites.getById(af.site_id) : null;
  const zones = site ? db.db.prepare(
    'SELECT * FROM zones WHERE site_id = ? AND deleted_at IS NULL ORDER BY position, zone_id'
  ).all(site.site_id) : [];
  const systems = db.db.prepare(
    'SELECT * FROM bacs_audit_systems WHERE document_id = ?'
  ).all(documentId);
  const devices = db.db.prepare(`
    SELECT d.* FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    WHERE s.document_id = ?
  `).all(documentId);
  const meters = db.db.prepare(
    'SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m LEFT JOIN zones z ON z.zone_id = m.zone_id WHERE m.document_id = ? ORDER BY z.position NULLS LAST, m.usage'
  ).all(documentId);
  const thermal = db.db.prepare(
    'SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t LEFT JOIN zones z ON z.zone_id = t.zone_id WHERE t.document_id = ? ORDER BY z.position, z.name'
  ).all(documentId);
  const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null;
  const inspections = db.db.prepare(
    'SELECT * FROM bacs_audit_inspections WHERE document_id = ? ORDER BY COALESCE(last_inspection_date, \'1970\') DESC'
  ).all(documentId);

  const refs = buildAuditRefs({ zones: zones.map(z => ({ ...z, zone_id: z.zone_id })), systems, devices, meters, thermal });

  // Joint les zones aux systemes, devices, meters, thermal (avec refs)
  const zonesById = new Map(zones.map(z => [z.zone_id, z]));
  const systemsByZone = new Map();
  for (const s of systems) {
    if (!systemsByZone.has(s.zone_id)) systemsByZone.set(s.zone_id, []);
    systemsByZone.get(s.zone_id).push({
      ...s,
      ref: refs.systems.get(s.id)?.ref || '',
      label: SYSTEM_LABEL[s.system_category] || s.system_category,
      devices: devices
        .filter(d => d.system_id === s.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
        .map(d => ({ ...d, ref: refs.devices.get(d.id)?.ref || '' })),
    });
  }
  const metersByZone = new Map();
  for (const m of meters) {
    const k = m.zone_id || 'site';
    if (!metersByZone.has(k)) metersByZone.set(k, []);
    metersByZone.get(k).push({
      ...m,
      ref: refs.meters.get(m.id)?.ref || '',
      usage_label: METER_USAGE_LABEL[m.usage] || m.usage,
      type_label: METER_TYPE_LABEL[m.meter_type] || m.meter_type,
    });
  }
  const thermalByZone = new Map();
  for (const t of thermal) {
    thermalByZone.set(t.zone_id, { ...t, ref: refs.thermal.get(t.id)?.ref || '' });
  }

  // Compose la liste a imprimer : 1 bloc par zone + 1 bloc "general" (compteurs site)
  const zoneBlocks = zones.map(z => ({
    ref: refs.zones.get(z.zone_id)?.ref || '',
    name: z.name,
    nature: z.nature || '',
    notes: z.notes || '',
    systems: systemsByZone.get(z.zone_id) || [],
    meters: metersByZone.get(z.zone_id) || [],
    thermal: thermalByZone.get(z.zone_id) || null,
  }));
  const generalMeters = metersByZone.get('site') || [];

  return {
    document: af,
    site,
    today: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
    zones: zoneBlocks,
    generalMeters,
    bms,
    inspections,
    // Liste deterministe des "documents/preuves a demander a l'exploitant"
    documentsToRequest: [
      { code: 'R175-4', label: 'Consignes écrites de maintenance du BACS (périodicité, points contrôlés, responsable)' },
      { code: 'R175-5', label: 'Attestation de formation de l\'exploitant au paramétrage du BACS' },
      { code: 'R175-5-1', label: 'Rapport de la dernière inspection périodique par un tiers (à conserver 10 ans)' },
      { code: 'R175-3', label: 'Procédure de mise à disposition des données archivées au gestionnaire et aux exploitants' },
      { code: 'R175-3', label: 'Export type des données horaires sur 12 mois (CSV ou capture interface GTB)' },
      { code: 'R175-2', label: 'Date du permis de construire et date des travaux générateur (déclencheurs R175-2 et R175-6)' },
      { code: 'R175-2', label: 'Études de TRI éventuelles (si dispense > 10 ans revendiquée)' },
      { code: 'DOE',     label: 'DOE / plans / schémas / synoptiques GTB et systèmes' },
      { code: 'Maint.',  label: 'Contrat de maintenance et historique d\'interventions' },
    ],
  };
}

module.exports = { buildChecklistData };
