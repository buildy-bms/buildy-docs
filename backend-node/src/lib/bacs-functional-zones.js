'use strict';

/**
 * Calcul des zones fonctionnelles de suivi (item 7d / 7e du plan PROFEEL).
 *
 * Le décret BACS (R175-1 §6) raisonne en « zones fonctionnelles » : des
 * ensembles de locaux suivis ensemble du point de vue énergétique. Le
 * découpage réel n'est pas le découpage physique des zones — il dépend de la
 * technique : deux zones desservies par un même équipement dont le comptage
 * ne peut PAS être séparé constituent UNE seule zone fonctionnelle de suivi.
 *
 * Ce module regroupe, catégorie technique par catégorie technique, les zones
 * desservies par un équipement partagé non séparable
 * (`metering_separable = 'no'`). Pour chaque regroupement, il produit une
 * justification écrite reprise dans le PDF (audit + tableaux de synthèse).
 *
 * Aucune dépendance DB — opère sur des structures déjà chargées, réutilisable
 * par _export-data.js (audit réel) et _preview-fixture.js (dataset fictif).
 *
 * Entrées :
 *  - devices : [{ id, system_id, system_category, zone_id, zone_name,
 *               extra_system_ids, metering_separable, metering_separable_note,
 *               name, brand }]
 *  - systems : [{ id, system_category, zone_id, zone_name }]
 *
 * Sortie : [{ category, categoryLabel, groups: [
 *   { zone_ids, zone_names, label, justification, merged } ] }]
 */

/**
 * @param {Array} devices  équipements physiques enrichis
 * @param {Array} systems  systèmes (zone × usage) de l'audit
 * @param {object} labels  { SYSTEM_LABEL } pour les libellés FR de catégorie
 * @returns {{ byCategory: Array, mergedCount: number }}
 */
function computeFunctionalZones(devices, systems, labels = {}) {
  const SYSTEM_LABEL = labels.SYSTEM_LABEL || {};

  // Index system_id -> { zone_id, zone_name, system_category }.
  const systemById = new Map();
  for (const s of systems || []) {
    systemById.set(s.id, {
      zone_id: s.zone_id,
      zone_name: s.zone_name || null,
      system_category: s.system_category,
    });
  }

  // Collecte par catégorie technique : pour chaque catégorie, l'ensemble des
  // zones desservies + les contraintes de regroupement (Union-Find).
  // categoryMap : category -> {
  //   zones: Map(zone_id -> zone_name),
  //   parent: Map(zone_id -> zone_id),     (union-find)
  //   reasons: Map("a|b" -> { device, note })  liens de fusion
  // }
  const categoryMap = new Map();
  function catEntry(cat) {
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { zones: new Map(), parent: new Map(), reasons: [] });
    }
    return categoryMap.get(cat);
  }
  function find(parent, x) {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  }
  function union(parent, a, b) {
    const ra = find(parent, a), rb = find(parent, b);
    if (ra !== rb) parent.set(ra, rb);
  }
  function ensureZone(entry, zoneId, zoneName) {
    if (zoneId == null) return;
    if (!entry.zones.has(zoneId)) {
      entry.zones.set(zoneId, zoneName || `Zone #${zoneId}`);
      entry.parent.set(zoneId, zoneId);
    } else if (zoneName && /^Zone #/.test(entry.zones.get(zoneId))) {
      entry.zones.set(zoneId, zoneName);
    }
  }

  for (const d of devices || []) {
    const cat = d.system_category;
    if (!cat) continue;
    const entry = catEntry(cat);

    // Zone du système primaire du device.
    const primary = systemById.get(d.system_id);
    const primaryZoneId = primary ? primary.zone_id : (d.zone_id ?? null);
    const primaryZoneName = (primary && primary.zone_name) || d.zone_name || null;
    ensureZone(entry, primaryZoneId, primaryZoneName);

    // Zones des systèmes supplémentaires (équipement partagé, mig 143).
    const extraIds = d.extra_system_ids || [];
    const sharedZones = [];
    for (const sid of extraIds) {
      const sys = systemById.get(sid);
      if (!sys) continue;
      // On ne regroupe qu'au sein de la même catégorie technique.
      if (sys.system_category && sys.system_category !== cat) continue;
      ensureZone(entry, sys.zone_id, sys.zone_name);
      if (sys.zone_id != null && sys.zone_id !== primaryZoneId) {
        sharedZones.push(sys.zone_id);
      }
    }

    // Un équipement partagé NON séparable (`metering_separable = 'no'`)
    // regroupe ses zones en une seule zone fonctionnelle de suivi.
    if (d.metering_separable === 'no' && primaryZoneId != null) {
      for (const zid of sharedZones) {
        union(entry.parent, primaryZoneId, zid);
        entry.reasons.push({
          zone_a: primaryZoneId, zone_b: zid,
          device_name: d.name || d.brand || `Équipement #${d.id}`,
          note: d.metering_separable_note || null,
        });
      }
    }
  }

  // Zones des systèmes présents sans équipement propre (équipements partagés
  // depuis un système d'une autre catégorie, ex. unités réversibles) : elles
  // font aussi partie du découpage de leur catégorie (R3 n4).
  for (const s of systems || []) {
    if (!s.system_category || s.zone_id == null) continue;
    if ('present' in s && s.present !== 1 && s.present !== true) continue;
    if (s.is_bacs === 0) continue;
    ensureZone(catEntry(s.system_category), s.zone_id, s.zone_name);
  }

  // Matérialise les groupes par catégorie.
  const byCategory = [];
  let mergedCount = 0;
  for (const [cat, entry] of categoryMap) {
    if (!entry.zones.size) continue;
    // root -> [zone_id, ...]
    const groupsByRoot = new Map();
    for (const zid of entry.zones.keys()) {
      const root = find(entry.parent, zid);
      if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
      groupsByRoot.get(root).push(zid);
    }
    const groups = [];
    for (const rawIds of groupsByRoot.values()) {
      // Ordre alphabétique stable : même libellé de groupe partout (plan,
      // annexe C, tableaux) quel que soit l'ordre de saisie (R3 n16).
      const zoneIds = rawIds.slice().sort((a, b) => String(entry.zones.get(a)).localeCompare(String(entry.zones.get(b)), 'fr'));
      const zoneNames = zoneIds.map(z => entry.zones.get(z));
      const merged = zoneIds.length > 1;
      if (merged) mergedCount++;
      // Justification écrite : reprend les liens de fusion concernés.
      let justification = null;
      if (merged) {
        const zoneSet = new Set(zoneIds);
        const notes = entry.reasons
          .filter(r => zoneSet.has(r.zone_a) && zoneSet.has(r.zone_b))
          .map(r => r.note)
          .filter(Boolean);
        const reason = notes.length
          ? notes[0]
          : 'comptage séparé non réalisable';
        const catLabel = (SYSTEM_LABEL[cat] || cat).toLowerCase();
        // Les noms des zones sont déjà affichés à côté (label) : la
        // justification ne les répète pas (relecture clarté R2 m16).
        justification = `Regroupées en une seule zone fonctionnelle de suivi pour l'usage ${catLabel} : ${reason}. Un compteur unique suffit pour l'ensemble.`;
      }
      groups.push({
        zone_ids: zoneIds,
        zone_names: zoneNames,
        label: zoneNames.join(' + '),
        merged,
        justification,
      });
    }
    byCategory.push({
      category: cat,
      categoryLabel: SYSTEM_LABEL[cat] || cat,
      physical_zone_count: entry.zones.size,
      functional_zone_count: groups.length,
      groups,
    });
  }

  return { byCategory, mergedCount };
}

// Usage de compteur → catégories de système dont il suit la consommation.
const METER_USAGE_TO_CATEGORIES = {
  heating: ['heating'],
  cooling: ['cooling'],
  ventilation: ['ventilation'],
  dhw: ['dhw'],
  lighting: ['lighting_indoor', 'lighting_outdoor'],
  pv: ['electricity_production'],
};

function isYes(v) { return v === 1 || v === true; }
function isNo(v) { return v === 0 || v === false; }

/**
 * Rôle des compteurs situés dans une zone fonctionnelle REGROUPÉE (comptage
 * séparé non réalisable) : un comptage unique suffit pour le groupe
 * (relectures R1 M3 et R2 C2 : le rapport regroupait les zones puis exigeait
 * un compteur par zone, en actions bloquantes).
 *
 *  - 'present' : compteur physiquement présent — il mesure une part du
 *                groupe, ses propres actions restent ;
 *  - 'lead'    : aucun compteur présent dans le groupe — ce compteur porte
 *                l'action du groupe (le premier requis constaté absent, à
 *                défaut le premier) ;
 *  - 'covered' : absent ou non vérifié, couvert par le comptage du groupe
 *                (aucune action propre).
 *
 * @param {{byCategory: Array}} functionalZones  sortie de computeFunctionalZones
 * @param {Array} meters  compteurs (id, zone_id, usage, meter_type,
 *                        present_actual, required)
 * @returns {Map<number, {role: string, group: object, leadId: number|null}>}
 *   (les compteurs hors zone regroupée n'y figurent pas)
 */
function mergedMeterRoles(functionalZones, meters) {
  const groups = [];
  for (const c of (functionalZones && functionalZones.byCategory) || []) {
    for (const g of c.groups || []) {
      if (g.merged) groups.push({ ...g, category: c.category });
    }
  }
  const byKey = new Map();
  for (const m of meters || []) {
    if (m.meter_type === 'water' || m.zone_id == null) continue;
    const cats = METER_USAGE_TO_CATEGORIES[m.usage];
    if (!cats) continue;
    const g = groups.find(gr => cats.includes(gr.category) && gr.zone_ids.includes(m.zone_id));
    if (!g) continue;
    // Un seul comptage par zone regroupée ET par usage, quel que soit le type
    // de compteur (gaz en entrée de chaudière OU énergie thermique) — R3 N-M4.
    const key = `${g.category}|${g.zone_ids.slice().sort((a, b) => a - b).join(',')}|${m.usage}`;
    if (!byKey.has(key)) byKey.set(key, { group: g, list: [] });
    byKey.get(key).list.push(m);
  }
  // Préférence : compteur d'énergie en entrée du générateur (gaz, électricité)
  // plutôt qu'un compteur d'énergie thermique.
  const rank = (m) => ((m.meter_type === 'gas' || m.meter_type === 'electric') ? 0 : 1);
  const byPreference = (a, b) => rank(a) - rank(b) || a.id - b.id;
  const roles = new Map();
  for (const { group, list } of byKey.values()) {
    const present = list.filter(m => isYes(m.present_actual));
    if (present.length) {
      for (const m of list) roles.set(m.id, { role: present.includes(m) ? 'present' : 'covered', group, leadId: null });
      continue;
    }
    // Présence d'un compteur non vérifiée : il porte le comptage du groupe
    // (à vérifier sur place) ; on ne conclut pas à un compteur manquant.
    const unknown = list.filter(m => m.present_actual == null).sort(byPreference);
    const lead = unknown[0]
      || list.filter(m => isYes(m.required) && isNo(m.present_actual)).sort(byPreference)[0]
      || list.slice().sort(byPreference)[0];
    for (const m of list) roles.set(m.id, { role: m === lead ? 'lead' : 'covered', group, leadId: lead.id });
  }
  return roles;
}

module.exports = { computeFunctionalZones, mergedMeterRoles, METER_USAGE_TO_CATEGORIES };
