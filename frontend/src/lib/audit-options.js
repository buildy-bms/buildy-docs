/**
 * Catalogues d'options des dropdowns BACS audit (énergies, nature, protocoles).
 * Chaque option : { value, label, icon?, color? } — consommée par
 * SearchableSelect.vue. Une seule source de vérité partagée entre
 * BacsAuditDetailView.vue, SystemDevicesTable.vue et AddDeviceModal.vue.
 *
 * Pas d'entrée { value: null } : le SearchableSelect gère le placeholder
 * (prop `placeholder`) et le reset (bouton X "clearable"). Inclure null
 * en option afficherait le placeholder comme item sélectionnable.
 */

export const ENERGY_OPTIONS = [
  { value: 'gas',              label: 'Gaz',                icon: 'fa-fire-flame-curved', color: '#f97316' },
  { value: 'electric',         label: 'Électrique',         icon: 'fa-bolt',              color: '#eab308' },
  { value: 'district_heating', label: 'Calories / Frigories', icon: 'fa-temperature-snow', color: '#dc2626' },
  { value: 'wood',             label: 'Bois',               icon: 'fa-tree',              color: '#65a30d' },
  { value: 'biomass',          label: 'Biomasse',           icon: 'fa-leaf',              color: '#16a34a' },
  { value: 'fuel_oil',         label: 'Fioul',              icon: 'fa-droplet',           color: '#92400e' },
  { value: 'solar',            label: 'Solaire',            icon: 'fa-solar-panel',       color: '#facc15' },
  { value: 'autre',            label: 'Autre',              icon: 'fa-circle-question',   color: '#6b7280' },
]

// Libellés FR des catégories d'usage BACS (system_category). Pour un usage
// manuel non BACS (is_bacs=0), le libellé affiché est `custom_label`.
export const SYSTEM_CATEGORY_LABELS = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'Eau chaude sanitaire',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}

// Libellé d'un usage (ligne bacs_audit_systems), BACS ou manuel.
export function systemUsageLabel(system) {
  if (!system) return 'Usage'
  if (system.is_bacs === 0 || system.is_bacs === false) {
    return system.custom_label || 'Usage personnalisé'
  }
  return SYSTEM_CATEGORY_LABELS[system.system_category] || system.system_category || 'Usage'
}

export const ROLE_OPTIONS = [
  { value: 'production',   label: 'Production',   icon: 'fa-industry',          color: '#dc2626' },
  { value: 'distribution', label: 'Distribution', icon: 'fa-route',             color: '#0ea5e9' },
  { value: 'emission',     label: 'Émission',     icon: 'fa-fan',               color: '#3b82f6' },
  { value: 'regulation',   label: 'Régulation',   icon: 'fa-sliders',           color: '#a855f7' },
  { value: 'autre',        label: 'Autre',        icon: 'fa-circle-question',   color: '#6b7280' },
]

// ── Types de régulation par niveau R175-6 ─────────────────────────────
// Listes de suggestions (creatable côté UI : l'auditeur peut ajouter une
// valeur libre si la sienne n'est pas listée). Stockées en TEXT libre côté
// DB (`regulation_type_production / _distribution / _emission`), pas
// d'enum strict pour rester flexible.
export const REGULATION_TYPES_PRODUCTION = [
  { value: 'loi_d_eau',          label: 'Loi d\'eau' },
  { value: 'pression_constante', label: 'Pression constante' },
  { value: 'cascade',            label: 'Cascade' },
  { value: 'modulation',         label: 'Modulation puissance' },
  { value: 'tout_ou_rien',       label: 'Tout ou rien' },
  { value: 'autre',              label: 'Autre' },
]
export const REGULATION_TYPES_DISTRIBUTION = [
  { value: 'vanne_3_voies',  label: 'Vanne 3 voies' },
  { value: 'vanne_2_voies',  label: 'Vanne 2 voies' },
  { value: 'debit_variable', label: 'Débit variable' },
  { value: 'equilibrage',    label: 'Équilibrage hydraulique' },
  { value: 'autre',          label: 'Autre' },
]
export const REGULATION_TYPES_EMISSION = [
  { value: 'thermostat_ambiant',    label: 'Thermostat ambiant' },
  { value: 'vanne_thermostatique',  label: 'Vanne thermostatique' },
  { value: 'sonde_zone',            label: 'Sonde de zone' },
  { value: 'sonde_retour',          label: 'Sonde de retour' },
  { value: 'autre',                 label: 'Autre' },
]

// Granularité de la régulation R175-6 (per_room / per_zone / central_only),
// DÉRIVÉE du type de régulation d'émission du device émetteur :
//  - thermostat_ambiant       → per_room
//  - vanne_thermostatique     → per_room
//  - sonde_zone               → per_zone
//  - sonde_retour             → central_only
//  - autre / null             → central_only (signal non précisé)
// Migration 180 : la valeur saisie historique (per_room/per_zone/central_only/none
// dans bacs_audit_thermal_regulation.regulation_type) est archivée mais plus
// remontée — on la recalcule à chaque rendu pour rester cohérent avec la
// modale équipement.
export function derivedGranularity(emissionType) {
  if (!emissionType) return 'central_only'
  if (emissionType === 'thermostat_ambiant' || emissionType === 'vanne_thermostatique') return 'per_room'
  if (emissionType === 'sonde_zone') return 'per_zone'
  return 'central_only'
}
export const GRANULARITY_LABELS_FR = {
  per_room: 'Par pièce',
  per_zone: 'Par zone',
  central_only: 'Centralisée',
}
export const GRANULARITY_TONES = {
  per_room: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  per_zone: 'bg-sky-50 text-sky-700 border-sky-200',
  central_only: 'bg-amber-50 text-amber-700 border-amber-200',
}

// Le rôle/niveau (Production / Distribution / Émission / Régulation) découle
// du découpage thermique R175-6 : il n'a de sens que pour les systèmes de
// chauffage et de climatisation. Pour tous les autres usages (ventilation,
// ECS, éclairage, photovoltaïque, usages manuels), la colonne Rôle est
// verrouillée car non pertinente.
const THERMAL_CATEGORIES = new Set(['heating', 'cooling'])
export function isThermalCategory(category) {
  return THERMAL_CATEGORIES.has(category)
}

/**
 * Liste des champs encore manquants pour qu'un équipement soit « validé » :
 * identité, énergie, protocole(s), niveau de régulation (usages thermiques)
 * et TOUS les boutons Oui/Non de la modale (conformité R175-3, état). Pour
 * un équipement partagé, le comptage séparable est aussi requis.
 * Retourne un tableau de libellés courts (vide = complet).
 */
export function deviceMissingFields(device, systemCategory) {
  if (!device) return ['équipement introuvable']
  const out = []
  const hasIdentity = !!((device.name || '').trim()
    || (device.brand || '').trim()
    || (device.model_reference || '').trim())
  if (!hasIdentity) out.push('un nom, une marque ou une référence')
  if (!device.energy_source) out.push("l'énergie")
  let protocols = []
  try { protocols = JSON.parse(device.communication_protocols || '[]') } catch { protocols = [] }
  const hasProtocol = (Array.isArray(protocols) && protocols.length > 0)
    || (!!device.communication_protocol && device.communication_protocol !== 'non_communicant')
  // « Non communicant » est une réponse explicite à la question : si l'auditeur
  // a coché Non sur le toggle communicant, on n'attend plus de protocole.
  const explicitNonCommunicant = device.communication_protocol === 'non_communicant'
  if (!hasProtocol && !explicitNonCommunicant) out.push('le(s) protocole(s) de communication')
  if (isThermalCategory(systemCategory)) {
    const roles = Array.isArray(device.device_role)
      ? device.device_role
      : (device.device_role ? [device.device_role] : [])
    if (!roles.length) out.push('le niveau de régulation R175-6')
  }
  // Tous les boutons Oui/Non doivent être renseignés (null = non répondu).
  if (device.wired == null) out.push('la communication câblée vers la GTB')
  if (device.meets_r175_3_p4 == null) out.push("l'arrêt manuel possible")
  if (device.meets_r175_3_p4_autonomous == null) out.push('le fonctionnement autonome après coupure')
  if (device.is_backup == null) out.push('équipement de secours (oui/non)')
  if (device.out_of_service == null) out.push('hors service (oui/non)')
  const isShared = Array.isArray(device.extra_system_ids) && device.extra_system_ids.length > 0
  if (isShared && device.metering_separable == null) out.push('le comptage séparable')
  return out
}

/**
 * Un équipement (« système ») est considéré complètement renseigné quand
 * `deviceMissingFields` ne retourne rien — OU quand l'auditeur a forcé sa
 * validation (`validation_forced`, pour les infos définitivement inconnues).
 * Sert au bouton « Modifier » (rouge tant qu'incomplet) et au blocage de
 * la validation de l'étape Systèmes.
 */
export function isDeviceComplete(device, systemCategory) {
  if (!device) return false
  if (device.validation_forced) return true
  return deviceMissingFields(device, systemCategory).length === 0
}

// Natures de zones — couvre l'enum bacs_requirements_by_zone_nature côté
// backend (cf. backend-node/src/seeds/bacs-requirements.js). Ajouter une
// entrée ici sans l'ajouter dans bacs-requirements.js : la nature ne
// génère aucune ligne bacs_audit_systems (cascade vide).
export const ZONE_NATURES = [
  { value: 'office',           label: 'Bureaux',              icon: 'fa-briefcase',         color: '#1e40af' },
  { value: 'shared-office',    label: 'Bureau partagé',       icon: 'fa-people-group',      color: '#3b82f6' },
  { value: 'private-office',   label: 'Bureau privé',         icon: 'fa-user-tie',          color: '#1d4ed8' },
  { value: 'open-space',       label: 'Open-space',           icon: 'fa-table-cells-large', color: '#0ea5e9' },
  { value: 'meeting-room',     label: 'Salle de réunion',     icon: 'fa-handshake',         color: '#0d9488' },
  { value: 'commercial-space', label: 'Espace commercial',    icon: 'fa-shop',              color: '#9333ea' },
  { value: 'classroom',        label: 'Salle de classe',      icon: 'fa-chalkboard-user',   color: '#a855f7' },
  { value: 'workshop',         label: 'Atelier',              icon: 'fa-screwdriver-wrench', color: '#92400e' },
  { value: 'leasure-space',    label: 'Espace loisirs',       icon: 'fa-couch',             color: '#f59e0b' },
  { value: 'foyer',            label: 'Foyer',                icon: 'fa-mug-hot',           color: '#d97706' },
  { value: 'shared-space',     label: 'Espace partagé',       icon: 'fa-users',             color: '#0891b2' },
  { value: 'corridor',         label: 'Couloir',              icon: 'fa-arrows-left-right', color: '#64748b' },
  { value: 'logistic-cell',    label: 'Cellule logistique',   icon: 'fa-boxes-stacked',     color: '#475569' },
  { value: 'stock',            label: 'Stock',                icon: 'fa-warehouse',         color: '#374151' },
  { value: 'kitchen',          label: 'Cuisine',              icon: 'fa-kitchen-set',       color: '#ea580c' },
  { value: 'refectory',        label: 'Réfectoire',           icon: 'fa-utensils',          color: '#d97706' },
  { value: 'changing-room',    label: 'Vestiaires / douches', icon: 'fa-shirt',             color: '#0891b2' },
  { value: 'restroom',         label: 'Sanitaires',           icon: 'fa-toilet',            color: '#0e7490' },
  { value: 'bedroom',          label: 'Chambre',              icon: 'fa-bed',               color: '#7c3aed' },
  { value: 'care-room',        label: 'Salle de soin',        icon: 'fa-suitcase-medical',  color: '#db2777' },
  { value: 'sports-hall',      label: 'Salle de sport',       icon: 'fa-dumbbell',          color: '#16a34a' },
  { value: 'laundry',          label: 'Blanchisserie',        icon: 'fa-soap',              color: '#2563eb' },
  { value: 'switchboard',      label: 'Tableau électrique',   icon: 'fa-bolt-lightning',    color: '#eab308', technical: true },
  { value: 'technical-area',   label: 'Local technique',      icon: 'fa-gears',             color: '#6b7280', technical: true },
  { value: 'boiler-room',      label: 'Chaufferie',           icon: 'fa-fire',              color: '#b91c1c', technical: true },
  { value: 'server-room',      label: 'Local informatique',   icon: 'fa-server',            color: '#0f766e', technical: true },
  { value: 'meters',           label: 'Local compteurs',      icon: 'fa-gauge',             color: '#059669', technical: true },
  { value: 'outdoor',          label: 'Extérieur',            icon: 'fa-tree-city',         color: '#16a34a', technical: true },
]

// Régime d'occupation d'une zone (item 14). Caractérise l'usage temporel —
// 2e composante de l'« usage » du décret avec la nature. Enum FERMÉ, doit
// rester synchro avec ZONE_OCCUPANCY_PROFILES dans backend zones.js.
export const ZONE_OCCUPANCY_PROFILES = [
  { value: 'continu',       label: 'Activité continue (24/7)',           icon: 'fa-infinity',       color: '#dc2626' },
  { value: '3x8',           label: 'Activité en 3×8 (24h/24, 3 équipes)', icon: 'fa-clock',          color: '#b91c1c' },
  { value: '2x8',           label: 'Activité en 2×8 (16h/24, 2 équipes)', icon: 'fa-clock',          color: '#ea580c' },
  { value: 'heures_bureau', label: 'Heures de bureau',                   icon: 'fa-briefcase',      color: '#1e40af' },
  { value: 'scolaire',      label: 'Rythme scolaire',                    icon: 'fa-graduation-cap', color: '#a855f7' },
  { value: 'intermittent',  label: 'Activité intermittente',             icon: 'fa-arrows-to-dot',  color: '#f59e0b' },
  { value: 'saisonnier',    label: 'Activité saisonnière',               icon: 'fa-sun',            color: '#0891b2' },
  { value: 'autre',         label: 'Autre régime',                       icon: 'fa-circle-question', color: '#6b7280' },
]

// Structure juridique du site (item 4a). Détermine qui est assujetti au
// décret BACS système par système. Enum FERMÉ, doit rester synchro avec
// OWNERSHIP_STRUCTURES dans backend routes/sites.js + OWNERSHIP_STRUCTURE_LABEL
// dans backend lib/bacs-liability.js + CHECK migration 160.
export const OWNERSHIP_STRUCTURES = [
  { value: 'single_owner_occupant',        label: 'Propriétaire unique occupant',          icon: 'fa-user',       color: '#1e40af' },
  { value: 'condominium',                  label: 'Copropriété (avec syndicat)',           icon: 'fa-users',      color: '#7c3aed' },
  { value: 'owner_with_tenants',           label: 'Propriétaire bailleur et preneurs',     icon: 'fa-handshake',  color: '#0891b2' },
  { value: 'multiple_independent_tenants', label: 'Preneurs indépendants multiples',       icon: 'fa-people-group', color: '#f59e0b' },
  { value: 'mixed',                        label: 'Structure mixte',                       icon: 'fa-shuffle',    color: '#6b7280' },
]

// Genre d'une partie prenante (item 4b). Enum FERMÉ, synchro avec
// PARTY_KINDS dans backend routes/sites.js + PARTY_KIND_LABEL dans
// backend lib/bacs-liability.js + CHECK migration 161.
export const PARTY_KINDS = [
  { value: 'owner_occupant',   label: 'Propriétaire occupant',     icon: 'fa-user-tie',      color: '#1e40af' },
  { value: 'co_owner',         label: 'Copropriétaire',            icon: 'fa-user-group',    color: '#7c3aed' },
  { value: 'tenant',           label: 'Preneur à bail',            icon: 'fa-key',           color: '#0891b2' },
  { value: 'syndicate',        label: 'Syndicat de copropriété',   icon: 'fa-building-user', color: '#a855f7' },
  { value: 'network_operator', label: 'Gestionnaire de réseau',    icon: 'fa-fire',          color: '#dc2626' },
]

// Types d'énergie de l'historique de consommation de référence (item 13).
// Enum FERMÉ, synchro avec ENERGY_HISTORY_TYPES dans backend routes/sites.js
// + ENERGY_HISTORY_TYPE_LABEL dans backend routes/bacs-audit/_labels.js
// + CHECK migration 165.
export const ENERGY_HISTORY_TYPES = [
  { value: 'electricity',      label: 'Électricité',        icon: 'fa-bolt',              color: '#6366f1', defaultUnit: 'kWh' },
  { value: 'gas',              label: 'Gaz',                icon: 'fa-fire-flame-simple', color: '#f97316', defaultUnit: 'kWh' },
  { value: 'fuel_oil',         label: 'Fioul',              icon: 'fa-droplet',           color: '#64748b', defaultUnit: 'L' },
  { value: 'district_heating', label: 'Réseau de chaleur',  icon: 'fa-fire',              color: '#0ea5e9', defaultUnit: 'kWh' },
  { value: 'other',            label: 'Autre énergie',      icon: 'fa-plug',              color: '#8b5cf6', defaultUnit: 'kWh' },
]

// Mois de l'année (libellés FR) pour les tableaux de saisie mensuelle.
export const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

// Natures considérées « techniques » par défaut : à la saisie d'une zone,
// si l'auditeur choisit l'une de ces natures, le type de zone est
// pré-rempli sur « technique » (corrigeable). Hors périmètre du décret
// BACS — ces zones n'alimentent pas les cards Systèmes / Compteurs.
export function isTechnicalNature(value) {
  return !!ZONE_NATURES.find(n => n.value === value)?.technical
}

export const COMM_OPTIONS = [
  { value: 'modbus_tcp',      label: 'Modbus TCP',      icon: 'fa-network-wired',     color: '#1e40af' },
  { value: 'modbus_rtu',      label: 'Modbus RTU',      icon: 'fa-network-wired',     color: '#1d4ed8' },
  { value: 'bacnet_ip',       label: 'BACnet IP',       icon: 'fa-network-wired',     color: '#7c3aed' },
  { value: 'bacnet_mstp',     label: 'BACnet MS/TP',    icon: 'fa-network-wired',     color: '#8b5cf6' },
  { value: 'knx',             label: 'KNX',             icon: 'fa-microchip',         color: '#16a34a' },
  { value: 'mbus',            label: 'M-Bus',           icon: 'fa-microchip',         color: '#0891b2' },
  { value: 'lonworks',        label: 'LonWorks',        icon: 'fa-microchip',         color: '#475569' },
  { value: 'mqtt',            label: 'MQTT',            icon: 'fa-cloud',             color: '#0ea5e9' },
  { value: 'opcua',           label: 'OPC-UA',          icon: 'fa-cloud',             color: '#7c3aed' },
  { value: 'rest',            label: 'API REST',        icon: 'fa-cloud',             color: '#16a34a' },
  { value: 'lorawan',         label: 'LoRaWAN',         icon: 'fa-tower-cell',        color: '#a855f7' },
  { value: 'autre',           label: 'Autre',           icon: 'fa-circle-question',   color: '#6b7280' },
  { value: 'non_communicant', label: 'Non communicant', icon: 'fa-plug-circle-xmark', color: '#dc2626' },
  { value: 'absent',          label: 'Absent',          icon: 'fa-ban',               color: '#9ca3af' },
]
