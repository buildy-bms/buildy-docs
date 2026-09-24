// Niveaux d'offre de la supervision Buildy Cloud et réserves de conformité
// par niveau. MIROIR de backend-node/src/lib/buildy-cloud-preset.js
// (BUILDY_RESERVES_BY_LEVEL, buildyReserves) — toute modification se fait
// des deux côtés.
//
// Doctrine (validée par Kévin le 2026-09-23) : une supervision Buildy est
// conforme au décret BACS quel que soit le niveau, SOUS RÉSERVE des
// obligations du niveau — jamais « non conforme » à cause du niveau souscrit.

export const BUILDY_OFFER_LEVELS = [
  { value: 'essentials', label: 'Essentials' },
  { value: 'smart', label: 'Smart' },
  { value: 'premium', label: 'Premium' },
]

export const BUILDY_RESERVES_BY_LEVEL = {
  essentials: [
    { key: 'data_export_backup', article: 'R175-3 1°',
      label: 'exporter et sauvegarder régulièrement les données de consommation depuis Hyperveez, pour les conserver 5 ans (la solution les conserve 12 mois en Essentials)' },
    { key: 'maintenance', article: 'R175-4',
      label: 'mettre en place la maintenance de la GTB, par un contrat de maintenance ou un personnel interne compétent (vérifications périodiques encadrées par des consignes écrites) : elle n\'est pas incluse en Essentials' },
  ],
  smart: [],
  premium: [],
}

// Champs de la fiche GTB qui DÉCOULENT du niveau d'offre (valeurs `fixed`
// du modèle serveur) : non modifiables tant qu'un niveau est choisi.
export const BUILDY_LEVEL_FIXED_FIELDS = ['meets_r175_3_p1', 'meets_r175_3_p2', 'data_provision_to_operators', 'data_storage_5y_compliant']

/** Réserves applicables à une fiche GTB Buildy (liste vide sinon). */
export function buildyReserves(bms) {
  const list = (bms && BUILDY_RESERVES_BY_LEVEL[bms.buildy_offer_level]) || []
  return list.filter(r => r.key !== 'maintenance'
    || !(bms.has_maintenance_procedures === 1 || bms.has_maintenance_procedures === true))
}

export function buildyOfferLabel(level) {
  return BUILDY_OFFER_LEVELS.find(l => l.value === level)?.label || null
}
