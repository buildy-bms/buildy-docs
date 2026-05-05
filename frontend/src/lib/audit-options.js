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
