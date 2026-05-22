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
    for (const zoneIds of groupsByRoot.values()) {
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
        justification = `${zoneNames.join(' et ')} regroupées en une zone fonctionnelle ${catLabel} : ${reason}.`;
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

module.exports = { computeFunctionalZones };
