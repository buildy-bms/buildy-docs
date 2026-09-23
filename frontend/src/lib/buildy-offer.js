// Niveaux d'offre de la supervision Buildy Cloud et exigences du décret BACS
// non couvertes par niveau. MIROIR de backend-node/src/lib/buildy-cloud-preset.js
// (source : catalogue seeds/service-levels.js) — toute modification se fait
// des deux côtés.

export const BUILDY_OFFER_LEVELS = [
  { value: 'essentials', label: 'Essentials' },
  { value: 'smart', label: 'Smart' },
  { value: 'premium', label: 'Premium' },
]

export const BUILDY_REQUIRED_LEVEL = 'premium'

const API_REQ = {
  article: 'R175-3 dernier alinéa',
  label: 'transmission structurée des données aux exploitants des systèmes techniques (API Buildy Connect)',
}

export const BUILDY_UNCOVERED_BY_LEVEL = {
  essentials: [
    { article: 'R175-3 1°', label: 'conservation des consommations mensuelles pendant 5 ans (12 mois en Essentials)' },
    { article: 'R175-3 2°', label: 'détection et notification des pertes d\'efficacité énergétique' },
    { article: 'R175-4', label: 'maintenance et vérifications périodiques de la GTB' },
    { article: 'R175-5', label: 'gestion des comptes et accompagnement des utilisateurs (option payante en Essentials)' },
    API_REQ,
  ],
  smart: [API_REQ],
  premium: [],
}

export function buildyOfferLabel(level) {
  return BUILDY_OFFER_LEVELS.find(l => l.value === level)?.label || null
}
