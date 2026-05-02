'use strict';

// Numerotation stable des entites d'un audit BACS pour : (a) afficher un
// badge "ref" dans le stepper et la fiche d'audit, (b) imprimer dans le
// PDF checklist terrain afin que le collaborateur puisse ecrire au stylo
// "photo P07 -> 3.Z01.04" et retrouver l'item exact a la restitution.
//
// Format : <step>.Z<zoneN>.<itemN>
//   step  = position dans le wizard (1..N, voir STEPS ci-dessous)
//   zoneN = ordre de la zone dans le site (2 chiffres)
//   itemN = ordre de l'item dans la zone et la categorie (2 chiffres)
//
// Pour les entites non zonees (BMS, inspections) : <step>.<itemN>.

const STEPS = {
  identification: 1,
  zones:          2,
  systems:        3,
  meters:         4,
  thermal:        5,
  bms:            6,
  inspections:    7,
  documents:      8,
  credentials:    9,
  review:         10,
  synthesis:      11,
};

const pad = (n) => String(n).padStart(2, '0');

function zoneIndexMap(zones) {
  const sorted = [...(zones || [])].sort((a, b) =>
    (a.position ?? 0) - (b.position ?? 0) || a.zone_id - b.zone_id
  );
  const map = new Map();
  sorted.forEach((z, i) => map.set(z.zone_id, i + 1));
  return map;
}

// systems : tableau des bacs_audit_systems d'un audit
// devices : tableau des bacs_audit_system_devices
// meters  : tableau des bacs_audit_meters
// thermal : tableau des bacs_audit_thermal_regulation
function buildAuditRefs({ zones = [], systems = [], devices = [], meters = [], thermal = [] }) {
  const zIdx = zoneIndexMap(zones);

  const result = {
    zones: new Map(),
    systems: new Map(),
    devices: new Map(),
    meters: new Map(),
    thermal: new Map(),
  };

  // Zones
  for (const z of zones) {
    const n = zIdx.get(z.zone_id);
    if (n == null) continue;
    result.zones.set(z.zone_id, { step: STEPS.zones, zone: n, ref: `${STEPS.zones}.Z${pad(n)}` });
  }

  // Systemes : groupes par zone, ordonnes par categorie puis id
  const CATEGORY_ORDER = ['heating','cooling','ventilation','dhw',
    'lighting_indoor','lighting_outdoor','electricity_production'];
  const sysByZone = new Map();
  for (const s of systems) {
    if (!sysByZone.has(s.zone_id)) sysByZone.set(s.zone_id, []);
    sysByZone.get(s.zone_id).push(s);
  }
  for (const [zoneId, list] of sysByZone) {
    list.sort((a, b) => {
      const oa = CATEGORY_ORDER.indexOf(a.system_category);
      const ob = CATEGORY_ORDER.indexOf(b.system_category);
      return (oa - ob) || (a.id - b.id);
    });
    const zoneN = zIdx.get(zoneId);
    if (zoneN == null) continue;
    list.forEach((s, i) => {
      result.systems.set(s.id, {
        step: STEPS.systems,
        zone: zoneN,
        item: i + 1,
        ref: `${STEPS.systems}.Z${pad(zoneN)}.${pad(i + 1)}`,
      });
    });
  }

  // Devices : sous le systeme parent, ordonnes par position puis id
  const devBySys = new Map();
  for (const d of devices) {
    if (!devBySys.has(d.system_id)) devBySys.set(d.system_id, []);
    devBySys.get(d.system_id).push(d);
  }
  for (const [sysId, list] of devBySys) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    const sysRef = result.systems.get(sysId);
    if (!sysRef) continue;
    list.forEach((d, i) => {
      result.devices.set(d.id, {
        step: STEPS.systems,
        zone: sysRef.zone,
        item: sysRef.item,
        sub: i + 1,
        ref: `${sysRef.ref}.${pad(i + 1)}`,
      });
    });
  }

  // Compteurs
  const meterByZone = new Map();
  for (const m of meters) {
    const k = m.zone_id ?? 'site';
    if (!meterByZone.has(k)) meterByZone.set(k, []);
    meterByZone.get(k).push(m);
  }
  const USAGE_ORDER = ['heating','cooling','dhw','pv','lighting','other'];
  for (const [zoneId, list] of meterByZone) {
    list.sort((a, b) => {
      const oa = USAGE_ORDER.indexOf(a.usage);
      const ob = USAGE_ORDER.indexOf(b.usage);
      return (oa - ob) || (a.id - b.id);
    });
    if (zoneId === 'site') {
      list.forEach((m, i) => {
        result.meters.set(m.id, {
          step: STEPS.meters,
          item: i + 1,
          ref: `${STEPS.meters}.G.${pad(i + 1)}`,
        });
      });
    } else {
      const zoneN = zIdx.get(zoneId);
      if (zoneN == null) continue;
      list.forEach((m, i) => {
        result.meters.set(m.id, {
          step: STEPS.meters,
          zone: zoneN,
          item: i + 1,
          ref: `${STEPS.meters}.Z${pad(zoneN)}.${pad(i + 1)}`,
        });
      });
    }
  }

  // Regulation thermique : 1 ligne par zone
  for (const t of thermal) {
    const zoneN = zIdx.get(t.zone_id);
    if (zoneN == null) continue;
    result.thermal.set(t.id, {
      step: STEPS.thermal,
      zone: zoneN,
      ref: `${STEPS.thermal}.Z${pad(zoneN)}`,
    });
  }

  return result;
}

function annotateAuditPayload(payload) {
  const refs = buildAuditRefs(payload);
  const apply = (arr, key, idField = 'id') => {
    if (!Array.isArray(arr)) return;
    for (const row of arr) {
      const r = refs[key].get(row[idField]);
      if (r) row.ref = r.ref;
    }
  };
  apply(payload.zones, 'zones', 'zone_id');
  apply(payload.systems, 'systems');
  apply(payload.devices, 'devices');
  apply(payload.meters, 'meters');
  apply(payload.thermal, 'thermal');
  return payload;
}

module.exports = {
  STEPS,
  buildAuditRefs,
  annotateAuditPayload,
};
