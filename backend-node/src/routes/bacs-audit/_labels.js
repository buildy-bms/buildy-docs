'use strict';

// Labels FR des enums BACS audit, partages entre :
//  - _export-data.js (rendu du PDF / preview reels depuis la DB)
//  - _preview-fixture.js (dataset fictif pour iterer sur le design du PDF)
//
// Source de verite des libelles : tout ajout/modif d'enum DB (CHECK constraints
// + _shared.js) doit etre repercute ici sinon on retrouve des codes anglais
// bruts dans le PDF. Cf. CLAUDE.md "3 sources d'enums a synchroniser".

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'Eau chaude sanitaire',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
};

const SYSTEM_NEGATIVE_LABEL = {
  heating: 'Pas de chauffage',
  cooling: 'Pas de refroidissement',
  ventilation: 'Pas de ventilation',
  dhw: 'Pas d\'ECS',
  lighting_indoor: 'Pas d\'éclairage intérieur',
  lighting_outdoor: 'Pas d\'éclairage extérieur',
  electricity_production: 'Pas de production photovoltaïque',
};

const COMM_LABEL = {
  modbus_tcp: 'Modbus TCP',
  modbus_rtu: 'Modbus RTU',
  bacnet_ip: 'BACnet IP',
  bacnet_mstp: 'BACnet MS/TP',
  knx: 'KNX',
  mbus: 'M-Bus',
  mqtt: 'MQTT',
  lorawan: 'LoRaWAN',
  autre: 'Autre',
  non_communicant: 'Non communicant',
  absent: 'Absent',
};

const ENERGY_LABEL = {
  gas: 'Gaz',
  electric: 'Électrique',
  wood: 'Bois',
  heat_pump: 'PAC',
  district_heating: 'Réseau de chaleur',
  fuel_oil: 'Fioul',
  solar: 'Solaire',
  biomass: 'Biomasse',
  autre: 'Autre',
};

const ROLE_LABEL = {
  production: 'Production',
  distribution: 'Distribution',
  emission: 'Émission',
  regulation: 'Régulation',
  autre: 'Autre',
};

const METER_TYPE_LABEL = {
  electric: 'Électrique',
  electric_production: 'Électrique de production',
  gas: 'Gaz',
  water: 'Eau',
  thermal: 'Thermique',
  other: 'Autre',
};

const METER_USAGE_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  dhw: 'ECS',
  pv: 'Production PV',
  lighting: 'Éclairage',
  other: 'Général',
};

const REGULATION_LABEL = {
  per_room: 'Par pièce',
  per_zone: 'Par zone',
  central_only: 'Centrale uniquement',
  none: 'Aucune',
};

const GENERATOR_LABEL = {
  gas: 'Gaz',
  electric: 'Effet Joule',
  heat_pump: 'Pompe à chaleur',
  wood_appliance: 'Appareil bois (exempté R175-6)',
  district_heating: 'Réseau de chaleur',
  other: 'Autre',
};

const APPLICABILITY_LABEL = {
  subject_immediate: 'Immédiate (bâtiment > 290 kW déjà existant)',
  subject_2025: '1er janvier 2025 (puissance > 290 kW)',
  subject_2027: '1er janvier 2027 (puissance > 70 kW)',
  not_subject: 'Non assujetti (puissance < 70 kW)',
};

const COMPLIANCE_LABEL = {
  compliant: 'Conforme',
  partial: 'Partiellement conforme',
  non_compliant: 'Non conforme',
};

// Aligne sur ZONE_NATURES dans frontend/src/views/BacsAuditDetailView.vue.
const ZONE_NATURE_LABEL = {
  'shared-office': 'Bureau partagé',
  'private-office': 'Bureau privé',
  'open-space': 'Open-space',
  'commercial-space': 'Espace commercial',
  'meeting-room': 'Salle de réunion',
  'workshop': 'Atelier',
  'switchboard': 'Tableau électrique',
  'technical-area': 'Local technique',
  'classroom': 'Salle de classe',
  'leasure-space': 'Espace loisirs',
  'foyer': 'Foyer',
  'corridor': 'Couloir',
  'outdoor': 'Extérieur',
  'meters': 'Local compteurs',
  'shared-space': 'Espace partagé',
  'logistic-cell': 'Cellule logistique',
  'stock': 'Stock',
};

module.exports = {
  SYSTEM_LABEL,
  SYSTEM_NEGATIVE_LABEL,
  COMM_LABEL,
  ENERGY_LABEL,
  ROLE_LABEL,
  METER_TYPE_LABEL,
  METER_USAGE_LABEL,
  REGULATION_LABEL,
  GENERATOR_LABEL,
  APPLICABILITY_LABEL,
  COMPLIANCE_LABEL,
  ZONE_NATURE_LABEL,
};
