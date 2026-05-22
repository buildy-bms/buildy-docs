'use strict';

// Item 13 — agrégation de la base de consommations mensuelles de référence
// pour le bandeau « Consommations de référence » de la page « L'essentiel »
// du PDF audit BACS.
//
// Partagé entre :
//   - routes/bacs-audit/_export-data.js (rendu réel depuis la DB)
//   - routes/bacs-audit/_preview-fixture.js (atelier de design PDF)
//
// Le calcul prend les lignes brutes `site_energy_history` et produit :
//   - un total annuel par énergie (sur l'année la mieux renseignée)
//   - le ratio par m² (réutilise la surface du site, Lot 1)
//   - les 12 valeurs mensuelles par énergie (pour le graphe Chart.js)

const {
  ENERGY_HISTORY_TYPE_LABEL,
  ENERGY_HISTORY_DEFAULT_UNIT,
} = require('../routes/bacs-audit/_labels');

// Couleur du dataset selon l'énergie (aligné palette pdf-charts).
const ENERGY_COLOR = {
  electricity: '#6366f1',     // indigo-500
  gas: '#f97316',             // orange-500
  fuel_oil: '#64748b',        // slate-500
  district_heating: '#0ea5e9',// sky-500
  other: '#8b5cf6',           // violet-500
};

/**
 * Construit le résumé des consommations de référence.
 *
 * @param {Array} rows — lignes `site_energy_history` (déjà filtrées deleted_at).
 * @param {number|null} siteSurfaceM2 — surface du site (pour le ratio par m²).
 * @returns {object|null} — null si aucune donnée exploitable.
 */
function buildEnergyReference(rows, siteSurfaceM2) {
  const clean = (rows || []).filter(r => Number(r.quantity) > 0);
  if (!clean.length) return null;

  // On retient l'année civile la plus complète (max de mois renseignés ;
  // départage par année la plus récente). C'est la base de référence
  // affichée — les autres années restent en DB mais ne polluent pas le PDF.
  const monthsByYear = new Map();
  for (const r of clean) {
    if (!monthsByYear.has(r.year)) monthsByYear.set(r.year, new Set());
    monthsByYear.get(r.year).add(r.month);
  }
  let refYear = null, bestCount = -1;
  for (const [year, months] of monthsByYear) {
    const count = months.size;
    if (count > bestCount || (count === bestCount && year > refYear)) {
      bestCount = count;
      refYear = year;
    }
  }

  const yearRows = clean.filter(r => r.year === refYear);

  // Agrégation par énergie : total quantité, total coût, série mensuelle.
  const byEnergy = new Map();
  for (const r of yearRows) {
    if (!byEnergy.has(r.energy_type)) {
      byEnergy.set(r.energy_type, {
        energy_type: r.energy_type,
        label: ENERGY_HISTORY_TYPE_LABEL[r.energy_type] || r.energy_type,
        unit: r.unit || ENERGY_HISTORY_DEFAULT_UNIT[r.energy_type] || 'kWh',
        color: ENERGY_COLOR[r.energy_type] || ENERGY_COLOR.other,
        totalQuantity: 0,
        totalCost: 0,
        hasCost: false,
        monthly: new Array(12).fill(0),
      });
    }
    const agg = byEnergy.get(r.energy_type);
    const qty = Number(r.quantity) || 0;
    agg.totalQuantity += qty;
    if (r.cost_eur != null) { agg.totalCost += Number(r.cost_eur) || 0; agg.hasCost = true; }
    agg.monthly[r.month - 1] += qty;
  }

  // Mise en forme FR (séparateur de milliers par espace insécable) — fait
  // ici car le template Handlebars n'a pas de helper de formatage de nombre.
  const fmtFr = (n) => Number(n).toLocaleString('fr-FR');

  const ENERGY_ORDER = ['electricity', 'gas', 'fuel_oil', 'district_heating', 'other'];
  const energies = ENERGY_ORDER
    .filter(t => byEnergy.has(t))
    .map(t => {
      const agg = byEnergy.get(t);
      const totalQuantity = Math.round(agg.totalQuantity);
      const totalCost = agg.hasCost ? Math.round(agg.totalCost) : null;
      // Ratio par m² : seulement si la surface est connue (> 0).
      const ratioPerM2 = (siteSurfaceM2 && siteSurfaceM2 > 0)
        ? Math.round((agg.totalQuantity / siteSurfaceM2) * 10) / 10
        : null;
      return {
        energy_type: agg.energy_type,
        label: agg.label,
        unit: agg.unit,
        totalQuantity,
        totalQuantityFmt: fmtFr(totalQuantity),
        totalCost,
        totalCostFmt: totalCost != null ? fmtFr(totalCost) : null,
        ratioPerM2,
        ratioPerM2Fmt: ratioPerM2 != null ? fmtFr(ratioPerM2) : null,
        monthly: agg.monthly.map(v => Math.round(v)),
      };
    });

  if (!energies.length) return null;

  return {
    referenceYear: refYear,
    monthsCovered: bestCount,
    siteSurfaceM2: (siteSurfaceM2 && siteSurfaceM2 > 0) ? siteSurfaceM2 : null,
    energies,
    // Séries prêtes pour pdf-charts.energyMonthlyBar (1 dataset par énergie).
    chartSeries: energies.map(e => ({
      label: e.label,
      color: ENERGY_COLOR[e.energy_type] || ENERGY_COLOR.other,
      values: e.monthly,
    })),
    // Unité d'axe : si toutes les énergies partagent la même, on l'affiche ;
    // sinon libellé générique (le graphe reste lisible série par série).
    chartUnit: energies.every(e => e.unit === energies[0].unit)
      ? energies[0].unit
      : 'Consommation',
  };
}

module.exports = { buildEnergyReference, ENERGY_COLOR };
