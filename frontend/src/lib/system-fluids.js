// Couleur de « circuit » de chaque catégorie d'usage, comme sur un schéma technique (rouge = chaud,
// cyan = froid, bleu ciel = eau chaude sanitaire…). Mêmes teintes que les icônes d'usage
// (components/SystemCategoryIcon.vue). Sert à distinguer les usages entre eux dans la mise en page
// guidée de l'étape Systèmes : bandeau de tête teinté, trait qui relie les équipements d'un usage.
export const SYSTEM_FLUIDS = {
  heating: { line: '#dc2626', tint: '#fef2f2' },
  cooling: { line: '#0891b2', tint: '#ecfeff' },
  ventilation: { line: '#64748b', tint: '#f1f5f9' },
  dhw: { line: '#0284c7', tint: '#f0f9ff' },
  lighting_indoor: { line: '#f59e0b', tint: '#fffbeb' },
  lighting_outdoor: { line: '#f59e0b', tint: '#fffbeb' },
  electricity_production: { line: '#16a34a', tint: '#f0fdf4' },
}
const OTHER = { line: '#6b7280', tint: '#f8fafc' }

export function systemFluid(category) {
  return SYSTEM_FLUIDS[category] || OTHER
}

/** Variables CSS d'une carte d'usage : --fluid (trait, icône), --fluid-tint (bandeau). */
export function fluidStyle(category) {
  const f = systemFluid(category)
  return { '--fluid': f.line, '--fluid-tint': f.tint }
}
