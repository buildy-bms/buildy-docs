// Description « ce que mesure ce compteur » des compteurs obligatoires d'un
// audit BACS : source unique de l'onglet Compteurs (GET meters, champ
// `purpose`), du chapitre 4 du PDF et des tableaux A3. Rédigée à partir des
// systèmes et équipements saisis : énergie mesurée, équipements par leur nom
// saisi (pas d'article à deviner), zones desservies. Les compteurs couverts
// par le comptage unique d'une zone regroupée renvoient vers le compteur qui
// les mesure (même statut que le plan d'actions, computeMeterPlanStatus).
// Un compteur non exigé (non requis, usage exempté) n'a pas de description.

const db = require('../database');
const { parseRoles } = require('./device-roles');
const { METER_USAGE_TO_CATEGORIES } = require('./bacs-functional-zones');
const { ENERGY_TO_METER_TYPE } = require('./seeder');
const { computeMeterPlanStatus } = require('./bacs-audit-action-generator');

const THERMAL_CATEGORIES = new Set(['heating', 'cooling', 'dhw']);
const USAGE_LABEL = {
  heating: 'Chauffage', cooling: 'Refroidissement', ventilation: 'Ventilation',
  dhw: 'ECS', lighting: 'Éclairage', pv: 'Production PV', other: 'Général',
};
const TYPE_ADJ = { electric: 'électrique', gas: 'gaz', thermal: 'thermique' };
const CONSUMED_BY = {
  electric: 'Électricité consommée par',
  gas: 'Gaz consommé par',
  thermal: 'Énergie consommée par',
  electric_production: 'Électricité produite par',
};
// Production partagée vers d'autres zones (ce que le générateur fournit).
const SERVES = {
  heating: (n) => `produit la chaleur de ${n} zones`,
  cooling: (n) => `produit le froid de ${n} zones`,
  dhw: (n) => `produit l'eau chaude sanitaire de ${n} zones`,
};
const RECEIVED_BY = {
  heating: 'Chaleur reçue par',
  cooling: 'Froid reçu par',
  dhw: 'Eau chaude sanitaire distribuée par',
};
const DELIVERED = {
  heating: 'Chaleur livrée à la zone',
  cooling: 'Froid livré à la zone',
  dhw: 'Eau chaude sanitaire livrée à la zone',
};
const FED_BY = {
  heating: 'eau chaude de',
  cooling: 'eau glacée de',
  dhw: 'produite par',
};

const isProd = (d) => d.roles.some(r => /production|generator/i.test(r));
const isDownstream = (d) => d.roles.some(r => /emission|distribution/i.test(r));
const devName = (d) => (d.name && d.name.trim()) || (d.brand && d.brand.trim()) || `Équipement n° ${d.id}`;

// Noms dédoublonnés, 4 au plus (« + N autres »).
function names(devices) {
  const list = [...new Set(devices.map(devName))];
  if (list.length <= 4) return list.join(', ');
  return `${list.slice(0, 4).join(', ')} + ${list.length - 4} autres`;
}

function joinZones(zoneNames) {
  if (zoneNames.length <= 1) return zoneNames.join('');
  return `${zoneNames.slice(0, -1).join(', ')} et ${zoneNames[zoneNames.length - 1]}`;
}

/**
 * @param {number} documentId
 * @returns {Map<number, string>} meter id → description (compteurs obligatoires)
 */
function computeMeterPurposes(documentId) {
  const out = new Map();
  const meters = db.db.prepare(`
    SELECT id, zone_id, usage, meter_type, required, present_actual
    FROM bacs_audit_meters WHERE document_id = ?
  `).all(documentId);
  if (!meters.length) return out;

  const zoneName = new Map(db.db.prepare(`
    SELECT z.id, z.name FROM zones z JOIN afs a ON a.site_id = z.site_id WHERE a.id = ?
  `).all(documentId).map(z => [z.id, z.name]));
  const systems = db.db.prepare(`
    SELECT id, zone_id, system_category, present, is_bacs
    FROM bacs_audit_systems WHERE document_id = ?
  `).all(documentId);
  const systemById = new Map(systems.map(s => [s.id, s]));
  const devices = db.db.prepare(`
    SELECT d.id, d.system_id, d.name, d.brand, d.energy_source, d.device_role, d.metering_separable
    FROM bacs_audit_system_devices d JOIN bacs_audit_systems s ON s.id = d.system_id
    WHERE s.document_id = ? ORDER BY d.position, d.id
  `).all(documentId).map(d => ({ ...d, roles: parseRoles(d.device_role) }));
  const deviceById = new Map(devices.map(d => [d.id, d]));
  const sharedTo = new Map(); // device id → [system]
  const sharedIn = new Map(); // system id → [device]
  for (const e of db.bacsAuditDeviceSharedSystems.listExtrasForDocument(documentId)) {
    const d = deviceById.get(e.device_id);
    const s = systemById.get(e.system_id);
    if (!d || !s) continue;
    if (!sharedTo.has(d.id)) sharedTo.set(d.id, []);
    sharedTo.get(d.id).push(s);
    if (!sharedIn.has(s.id)) sharedIn.set(s.id, []);
    sharedIn.get(s.id).push(d);
  }
  const planStatus = computeMeterPlanStatus(documentId);

  // Zones desservies par un équipement : la sienne puis celles des systèmes
  // vers lesquels il est partagé (catégories `cats` si fournies).
  function servedZones(d, cats) {
    const own = systemById.get(d.system_id)?.zone_id;
    const zones = [own];
    for (const s of sharedTo.get(d.id) || []) {
      if (cats && !cats.includes(s.system_category)) continue;
      if (s.zone_id != null && !zones.includes(s.zone_id)) zones.push(s.zone_id);
    }
    return zones.filter(z => z != null);
  }

  function generalPurpose(m) {
    const fed = (type) => devices.filter(d => ENERGY_TO_METER_TYPE[d.energy_source] === type && isProd(d));
    if (m.meter_type === 'electric') return 'Toute l\'électricité du bâtiment (compteur de tête)';
    if (m.meter_type === 'water') return 'Toute l\'eau du bâtiment (compteur de tête)';
    if (m.meter_type === 'gas' || m.meter_type === 'thermal') {
      const what = m.meter_type === 'gas' ? 'Tout le gaz du bâtiment' : 'Toute l\'énergie thermique livrée au bâtiment';
      const gens = fed(m.meter_type);
      return gens.length ? `${what} — alimente : ${names(gens)}` : what;
    }
    return null;
  }

  function coveredPurpose(m, group) {
    const groupZones = new Set(String(group || '').split(' + '));
    const carriers = meters.filter(o => o.id !== m.id && o.usage === m.usage && o.zone_id != null
      && groupZones.has(zoneName.get(o.zone_id))
      && (planStatus[o.id]?.status === 'lead' || o.present_actual === 1 || o.present_actual === true));
    const cats = METER_USAGE_TO_CATEGORIES[m.usage] || [];
    const linking = devices.filter(d => d.metering_separable === 'no'
      && cats.includes(systemById.get(d.system_id)?.system_category)
      && servedZones(d, cats).includes(m.zone_id));
    const via = linking.length ? ` (même équipement : ${names(linking)})` : '';
    if (!carriers.length) return `Pas de compteur propre : un compteur unique suffit pour les zones regroupées ${group}${via}`;
    // Compteur qui porte le comptage : nommé par son type quand il diffère
    // (« le calorimètre de… », « le compteur Chauffage gaz de… »).
    const carrier = carriers[0];
    const label = carrierLabel(carrier, m);
    const sameZone = carriers.filter(o => o.zone_id === m.zone_id);
    if (sameZone.length) {
      return `Pas de compteur séparé : ${carrierLabel(sameZone[0], m)} de cette zone porte le comptage commun des zones regroupées ${group}${via}`;
    }
    const where = joinZones([...new Set(carriers.map(o => zoneName.get(o.zone_id)))]);
    return `Pas de compteur propre : ${label} de ${where} mesure aussi cette zone${via}`;
  }

  function carrierLabel(o, m) {
    if (o.meter_type === 'thermal') {
      if (o.usage === 'cooling') return 'le frigorimètre';
      if (o.usage === 'heating') return 'le calorimètre';
      if (o.usage === 'dhw') return 'le calorimètre ECS';
    }
    const usage = USAGE_LABEL[o.usage] || o.usage;
    return `le compteur ${usage}${o.meter_type !== m.meter_type && TYPE_ADJ[o.meter_type] ? ` ${TYPE_ADJ[o.meter_type]}` : ''}`;
  }

  function zonalPurpose(m, st) {
    const cats = METER_USAGE_TO_CATEGORIES[m.usage] || [];
    const sys = systems.filter(s => s.zone_id === m.zone_id && cats.includes(s.system_category)
      && (s.present === 1 || s.present === true) && s.is_bacs !== 0);
    const own = devices.filter(d => sys.some(s => s.id === d.system_id));
    const shared = sys.flatMap(s => sharedIn.get(s.id) || []);
    const thermalUsage = cats.some(c => THERMAL_CATEGORIES.has(c));
    const consumed = CONSUMED_BY[m.meter_type] || 'Énergie consommée par';
    const lead = st?.status === 'lead' ? st.group : null;

    // 1. Compteur d'entrée des générateurs de la zone (même règle que
    //    l'étape 1 du resync : énergie du compteur, production pour les
    //    usages thermiques).
    const gens = own.filter(d => ENERGY_TO_METER_TYPE[d.energy_source] === m.meter_type
      && (!thermalUsage || !d.roles.length || isProd(d)));
    if (gens.length) {
      const zones = [...new Set(gens.flatMap(d => servedZones(d, null)))];
      let text = `${consumed} : ${names(gens)}`;
      const usageKey = cats[0];
      if (zones.length > 1) {
        const verb = m.usage === 'ventilation' ? 'ventile' : m.usage === 'lighting' ? 'éclaire' : 'dessert';
        if (SERVES[usageKey]) text += ` — ${SERVES[usageKey](zones.length)}`;
        else text += ` — ${verb} ${zones.length > 3 ? `${zones.length} zones` : joinZones(zones.map(z => zoneName.get(z)))}`;
      }
      if (lead) text += zones.length > 1 ? ' (compteur unique)' : ` — compteur unique pour ${lead}`;
      return text;
    }

    // 2. Compteur d'énergie thermique de la zone (émetteurs hydrauliques).
    if (m.meter_type === 'thermal' && RECEIVED_BY[cats[0]]) {
      const emitters = [
        ...own.filter(d => isDownstream(d) && !isProd(d)),
        ...shared.filter(d => isDownstream(d) && !isProd(d) && d.metering_separable !== 'no'),
      ];
      const producers = [...own.filter(isProd), ...shared.filter(isProd)];
      let text = emitters.length ? `${RECEIVED_BY[cats[0]]} : ${names(emitters)}` : DELIVERED[cats[0]];
      if (producers.length) text += ` — ${FED_BY[cats[0]]} ${names(producers)}`;
      if (lead) text += ` — compteur unique pour ${lead}`;
      return text;
    }

    // 3. Autres compteurs de la zone : équipements partagés depuis une autre
    //    zone, sinon équipements de la zone, sinon usage sans équipement saisi.
    const sharedGens = shared.filter(d => ENERGY_TO_METER_TYPE[d.energy_source] === m.meter_type);
    let text;
    if (sharedGens.length) {
      const from = joinZones([...new Set(sharedGens.map(d => systemById.get(d.system_id)?.zone_id)
        .filter(z => z != null && z !== m.zone_id).map(z => zoneName.get(z)))]);
      text = `${consumed} : ${names(sharedGens)}${from ? ` (équipement de ${from})` : ''}`;
    } else {
      const named = own.filter(d => !(d.roles.length === 1 && /regulation/i.test(d.roles[0])));
      text = named.length
        ? `${consumed} : ${names(named)}`
        : `${consumed} : ${(USAGE_LABEL[m.usage] || m.usage).toLowerCase()} de la zone (équipements non saisis)`;
    }
    if (lead) text += ` — compteur unique pour ${lead}`;
    return text;
  }

  for (const m of meters) {
    const st = planStatus[m.id];
    if (st?.status === 'not_required') continue;
    if (st?.status === 'covered') { out.set(m.id, coveredPurpose(m, st.group)); continue; }
    if (!(m.required === 1 || m.required === true) && st?.status !== 'lead') continue;
    const text = m.zone_id == null ? generalPurpose(m) : zonalPurpose(m, st);
    if (text) out.set(m.id, text);
  }
  return out;
}

module.exports = { computeMeterPurposes };
