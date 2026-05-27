// Constantes partagées entre la PWA mobile (MobileMetersTab) et la
// section desktop (MetersSection + MeterCoverageMatrix + MeterEnergyGroup).
// Source unique pour éviter la dérive labels/couleurs/icônes entre les vues.
//
// L'ordre des entrées est important : c'est l'ordre d'affichage (colonnes
// de la matrice, sections empilées par énergie, options des selects).

// 5 types d'énergie reconnus par le décret BACS et l'audit. Icônes
// FontAwesome (registered dans `lib/equipment-icons.js`) + couleurs hex
// cohérentes avec MeterTypePill.vue.
//
// Ordre canonique d'affichage : énergies « principales » en premier
// (élec, gaz, thermique = les comptages les plus fréquents R175-3 1°),
// puis production PV et eau en fin (cas spécifiques).
export const METER_TYPES = [
  { value: 'electric',            label: 'Électrique',            icon: 'fa-bolt',                color: '#eab308' },
  { value: 'gas',                 label: 'Gaz',                   icon: 'fa-fire-flame-curved',   color: '#f97316' },
  { value: 'thermal',             label: 'Thermique',             icon: 'fa-temperature-half',    color: '#dc2626' },
  { value: 'electric_production', label: 'Électrique production', icon: 'fa-solar-panel',         color: '#facc15' },
  { value: 'water',               label: 'Eau',                   icon: 'fa-droplet',             color: '#0ea5e9' },
]

// 6 usages BACS pour le sous-comptage R175-3 1°.
export const METER_USAGES = [
  { value: 'heating',  label: 'Chauffage',     icon: 'fa-fire',            color: '#dc2626' },
  { value: 'cooling',  label: 'Climatisation', icon: 'fa-snowflake',       color: '#0ea5e9' },
  { value: 'dhw',      label: 'ECS',           icon: 'fa-faucet-drip',     color: '#0891b2' },
  { value: 'pv',       label: 'Production PV', icon: 'fa-solar-panel',     color: '#facc15' },
  { value: 'lighting', label: 'Éclairage',     icon: 'fa-lightbulb',       color: '#eab308' },
  { value: 'other',    label: 'Autre',         icon: 'fa-circle-question', color: '#6b7280' },
]

// Variantes "label only" historiques utilisées par BacsAuditDetailView
// pour les props legacy (sans icônes/couleurs). À conserver pour éviter
// les régressions sur les composants existants qui n'utilisent que le label.
export const METER_TYPES_LABELS = METER_TYPES.map(t => ({ value: t.value, label: t.label }))
export const METER_USAGES_LABELS = METER_USAGES.map(u => ({ value: u.value, label: u.label }))

// Helpers de résolution.
export function getMeterTypeMeta(value) {
  return METER_TYPES.find(t => t.value === value) || null
}
export function getMeterUsageMeta(value) {
  return METER_USAGES.find(u => u.value === value) || null
}
export function meterTypeLabel(value) {
  return getMeterTypeMeta(value)?.label || value || '—'
}
export function meterUsageLabel(value) {
  return getMeterUsageMeta(value)?.label || value || '—'
}
