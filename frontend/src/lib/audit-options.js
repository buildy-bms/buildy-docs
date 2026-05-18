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
  { value: 'heat_pump',        label: 'PAC',                icon: 'fa-temperature-half',  color: '#0ea5e9' },
  { value: 'district_heating', label: 'Réseau de chaleur',  icon: 'fa-pipe',              color: '#dc2626' },
  { value: 'wood',             label: 'Bois',               icon: 'fa-tree',              color: '#65a30d' },
  { value: 'biomass',          label: 'Biomasse',           icon: 'fa-leaf',              color: '#16a34a' },
  { value: 'fuel_oil',         label: 'Fioul',              icon: 'fa-droplet',           color: '#92400e' },
  { value: 'solar',            label: 'Solaire',            icon: 'fa-solar-panel',       color: '#facc15' },
  { value: 'autre',            label: 'Autre',              icon: 'fa-circle-question',   color: '#6b7280' },
]

export const ROLE_OPTIONS = [
  { value: 'production',   label: 'Production',   icon: 'fa-industry',          color: '#dc2626' },
  { value: 'distribution', label: 'Distribution', icon: 'fa-route',             color: '#0ea5e9' },
  { value: 'emission',     label: 'Émission',     icon: 'fa-fan',               color: '#3b82f6' },
  { value: 'regulation',   label: 'Régulation',   icon: 'fa-sliders',           color: '#a855f7' },
  { value: 'autre',        label: 'Autre',        icon: 'fa-circle-question',   color: '#6b7280' },
]

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
  { value: 'switchboard',      label: 'Tableau électrique',   icon: 'fa-bolt-lightning',    color: '#eab308', technical: true },
  { value: 'technical-area',   label: 'Local technique',      icon: 'fa-gears',             color: '#6b7280', technical: true },
  { value: 'server-room',      label: 'Local informatique',   icon: 'fa-server',            color: '#0f766e', technical: true },
  { value: 'meters',           label: 'Local compteurs',      icon: 'fa-gauge',             color: '#059669', technical: true },
  { value: 'outdoor',          label: 'Extérieur',            icon: 'fa-tree-city',         color: '#16a34a', technical: true },
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
