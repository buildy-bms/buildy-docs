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
  // Fallback de compat pour d'éventuelles lignes legacy non migrées.
  heat_pump: 'Électrique',
  district_heating: 'Calories / Frigories',
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
  subject_2030: '1er janvier 2030 (puissance entre 70 et 290 kW)',
  not_subject: 'Non assujetti (puissance < 70 kW)',
};

const COMPLIANCE_LABEL = {
  compliant: 'Conforme',
  partial: 'Partiellement conforme',
  non_compliant: 'Non conforme',
};

// Aligne sur ZONE_NATURES dans frontend/src/lib/audit-options.js.
const ZONE_NATURE_LABEL = {
  'office': 'Bureaux',
  'shared-office': 'Bureau partagé',
  'private-office': 'Bureau privé',
  'open-space': 'Open-space',
  'commercial-space': 'Espace commercial',
  'meeting-room': 'Salle de réunion',
  'workshop': 'Atelier',
  'switchboard': 'Tableau électrique',
  'technical-area': 'Local technique',
  'server-room': 'Local informatique',
  'classroom': 'Salle de classe',
  'leasure-space': 'Espace loisirs',
  'foyer': 'Foyer',
  'corridor': 'Couloir',
  'outdoor': 'Extérieur',
  'meters': 'Local compteurs',
  'shared-space': 'Espace partagé',
  'logistic-cell': 'Cellule logistique',
  'stock': 'Stock',
  // Item 7b — natures enrichies.
  'changing-room': 'Vestiaires / douches',
  'kitchen': 'Cuisine',
  'refectory': 'Réfectoire',
  'bedroom': 'Chambre',
  'care-room': 'Salle de soin',
  'sports-hall': 'Salle de sport',
  'boiler-room': 'Chaufferie',
  'laundry': 'Blanchisserie',
  'restroom': 'Sanitaires',
};

// Item 14 — Régime d'activité d'une zone. Aligne sur ZONE_OCCUPANCY_PROFILES
// (frontend/src/lib/audit-options.js) et le CHECK constraint migration 158.
const OCCUPANCY_PROFILE_LABEL = {
  'continu': 'Activité continue (24/7)',
  'heures_bureau': 'Heures de bureau',
  'scolaire': 'Rythme scolaire',
  'intermittent': 'Activité intermittente',
  'saisonnier': 'Activité saisonnière',
  'autre': 'Autre régime',
};

// Item 4 — structure juridique + parties prenantes. Réexportés depuis
// lib/bacs-liability.js (source de vérité unique). Synchro avec le CHECK
// des migrations 160/161 et OWNERSHIP_STRUCTURES/PARTY_KINDS du frontend.
const { OWNERSHIP_STRUCTURE_LABEL, PARTY_KIND_LABEL } = require('../../lib/bacs-liability');

// Item 13 — types d'énergie de l'historique de consommation. Synchro avec
// le CHECK de la migration 165, ENERGY_HISTORY_TYPES (routes/sites.js) et
// ENERGY_HISTORY_TYPES (frontend/src/lib/audit-options.js).
const ENERGY_HISTORY_TYPE_LABEL = {
  electricity: 'Électricité',
  gas: 'Gaz',
  fuel_oil: 'Fioul',
  district_heating: 'Réseau de chaleur',
  other: 'Autre énergie',
};

// Unité par défaut conseillée selon l'énergie (l'auditeur peut la corriger).
const ENERGY_HISTORY_DEFAULT_UNIT = {
  electricity: 'kWh',
  gas: 'kWh',
  fuel_oil: 'L',
  district_heating: 'kWh',
  other: 'kWh',
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
  OCCUPANCY_PROFILE_LABEL,
  OWNERSHIP_STRUCTURE_LABEL,
  PARTY_KIND_LABEL,
  ENERGY_HISTORY_TYPE_LABEL,
  ENERGY_HISTORY_DEFAULT_UNIT,
};
