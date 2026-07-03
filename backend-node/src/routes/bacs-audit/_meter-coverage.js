// Helpers partagés entre _export-data.js (vrais audits) et
// _preview-fixture.js (preview design HTML) pour construire les structures
// « matrice de couverture » et « sections par énergie » du plan de
// comptage côté PDF. La même logique sert la vue desktop côté frontend
// (MeterCoverageMatrix + MeterEnergyGroup), mais avec un format de
// données légèrement différent (icônes FA en `fa-bolt` côté front vs
// `bolt` côté PDF — le helper Handlebars `faIcon` ne supporte pas le
// préfixe `fa-`).

const COVERAGE_ENERGY_ORDER = [
  { value: 'electric',            label: 'Élec.',           icon: 'bolt',                color: '#eab308' },
  { value: 'gas',                 label: 'Gaz',             icon: 'fire-flame-curved',   color: '#f97316' },
  { value: 'thermal',             label: 'Thermique',       icon: 'temperature-half',    color: '#dc2626' },
  { value: 'electric_production', label: 'Élec. prod.',     icon: 'solar-panel',         color: '#facc15' },
  { value: 'water',               label: 'Eau',             icon: 'droplet',             color: '#0ea5e9' },
];

const COVERAGE_USAGE_ICONS = {
  heating:     { icon: 'fire',         color: '#dc2626' },
  cooling:     { icon: 'snowflake',    color: '#0ea5e9' },
  ventilation: { icon: 'fan',          color: '#0f766e' },
  dhw:      { icon: 'faucet-drip',     color: '#0891b2' },
  pv:       { icon: 'solar-panel',     color: '#facc15' },
  lighting: { icon: 'lightbulb',       color: '#eab308' },
  other:    { icon: 'circle-question', color: '#6b7280' },
};

// États ternaires stricts (incident Communay) : un compteur requis dont la
// présence n'a pas été vérifiée (present_actual = null) est « à qualifier »
// (unanswered), PAS « manquant » — le badge rouge « Requis manquant » ne
// s'affiche que sur constat explicite d'absence (present_actual = 0).
function coverageMeterState(m) {
  if (m.out_of_service === 1 || m.out_of_service === true) return 'hs';
  if (m.present_actual === 1 || m.present_actual === true) return 'present';
  if (m.present_actual == null) {
    return (m.required === 1 || m.required === true) ? 'unanswered' : 'neutral';
  }
  // present_actual = 0 explicite
  if (m.required === 1 || m.required === true) return 'missing';
  return 'neutral';
}

/**
 * Construit `meterCoverageMatrix` + `meterEnergyGroups` à partir des
 * compteurs enrichis et de la liste des zones du site.
 * @param {Array} enrichedMeters - meters issus de buildExportData (champs
 *   `zone_id`, `zone_name`, `meter_type`, `usage`, `present_actual`,
 *   `required`, `out_of_service`).
 * @param {Array} zones - zones du site (`zone_id`, `name`, `kind`).
 * @returns {{ meterCoverageMatrix, meterEnergyGroups }}
 */
function buildMeterCoverage(enrichedMeters, zones) {
  const coverageZones = [
    { zone_id: null, name: 'Compteur général', kind: 'general' },
    ...zones.map(z => ({ zone_id: z.zone_id, name: z.name, kind: z.kind || 'functional' })),
  ];
  const occupiedZoneIds = new Set(enrichedMeters.map(m => m.zone_id || null));

  // Sections par énergie (rendu cohérent avec MeterEnergyGroup desktop).
  const meterEnergyGroups = COVERAGE_ENERGY_ORDER
    .map(et => {
      const list = enrichedMeters.filter(m => m.meter_type === et.value);
      if (!list.length) return null;
      const byZone = new Map();
      for (const m of list) {
        const key = m.zone_id || '__general__';
        if (!byZone.has(key)) {
          byZone.set(key, {
            zone_id: m.zone_id || null,
            zone_name: m.zone_id ? m.zone_name : 'Compteur général',
            is_general: !m.zone_id,
            items: [],
          });
        }
        byZone.get(key).items.push(m);
      }
      const allKeys = [...byZone.keys()];
      const orderedKeys = allKeys.includes('__general__')
        ? ['__general__', ...allKeys.filter(k => k !== '__general__')]
        : allKeys;
      const stats = {
        total: list.length,
        present: list.filter(m => coverageMeterState(m) === 'present').length,
        missing: list.filter(m => coverageMeterState(m) === 'missing').length,
        unanswered: list.filter(m => coverageMeterState(m) === 'unanswered').length,
      };
      return {
        energy: et,
        stats,
        zones: orderedKeys.map(k => byZone.get(k)),
      };
    })
    .filter(Boolean);

  // Matrice de couverture (lignes zones × colonnes énergies, cellules =
  // badges-icônes usage avec dot d'état).
  const meterCoverageMatrix = {
    energies: COVERAGE_ENERGY_ORDER.map(et => ({
      ...et,
      used: enrichedMeters.some(m => m.meter_type === et.value),
    })),
    rows: coverageZones
      .filter(z => occupiedZoneIds.has(z.zone_id) || z.kind === 'general')
      .map(z => ({
        zone: z,
        cells: COVERAGE_ENERGY_ORDER.map(et => {
          const items = enrichedMeters
            .filter(m => (m.zone_id || null) === z.zone_id && m.meter_type === et.value)
            .map(m => {
              const state = coverageMeterState(m);
              const usageMeta = z.kind === 'general'
                ? { icon: et.icon, color: et.color }
                : (COVERAGE_USAGE_ICONS[m.usage] || COVERAGE_USAGE_ICONS.other);
              return { id: m.id, state, icon: usageMeta.icon, color: usageMeta.color };
            });
          return { energy: et, meters: items };
        }),
      })),
  };

  return { meterCoverageMatrix, meterEnergyGroups };
}

module.exports = {
  COVERAGE_ENERGY_ORDER,
  COVERAGE_USAGE_ICONS,
  buildMeterCoverage,
};
