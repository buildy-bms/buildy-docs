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

// Recommandation sur un compteur — synchro RECOMMENDATIONS (_shared.js +
// CHECK DB bacs_audit_meters.recommendation).
const METER_RECOMMENDATION_LABEL = {
  to_add: 'À ajouter',
  to_replace: 'À remplacer',
  to_connect: 'À raccorder à la GTB',
  compliant: 'Conforme',
};

// Methode de calcul de puissance R175-2 — synchro POWER_CALC_TYPES côté
// lib/bacs-audit-power.js et REFERENCE_DATA.power_calculation_types côté MCP.
const POWER_CALC_TYPE_LABEL = {
  thermodynamic_max: 'Thermodynamique (max chaud/froid)',
  boiler_sum: 'Chaudière (somme des puissances)',
  joule_sum: 'Effet Joule (somme des puissances)',
  district_heating_substation: 'Sous-station réseau de chaleur',
  out_of_scope: 'Hors champ R175',
};

// Comptage individualisable d'un équipement — synchro METERING_SEPARABLE
// côté MCP REFERENCE_DATA.
const METERING_SEPARABLE_LABEL = {
  yes: 'Sous-comptage propre',
  partial: 'Partagé (clé de répartition)',
  no: 'Pas de comptage individuel',
};

// Catégorie d'une action du plan de mise en conformité. Synchro avec :
//   - bacs_audit_action_items.category (TEXT, pas de CHECK actuellement — à
//     ajouter dans une session migration dédiée, cf. plan Bloc D différé).
//   - Source de vérité métier dans lib/bacs-audit-action-generator.js.
const ACTION_CATEGORY_LABEL = {
  meter_addition: 'Ajout de compteur',
  meter_replacement: 'Remplacement de compteur',
  meter_connection: 'Raccordement de compteur à la GTB',
  system_addition: 'Ajout d\'équipement',
  system_replacement: 'Remplacement d\'équipement',
  communication_upgrade: 'Mise à niveau communication',
  bms_upgrade: 'Mise à niveau GTB',
  bms_replacement: 'Remplacement GTB',
  bms_addition: 'Installation GTB',
  data_retention_upgrade: 'Conservation 5 ans des données',
  training: 'Formation exploitant',
  documentation: 'Documentation / consignes écrites',
  thermal_regulation: 'Régulation thermique R175-6',
  thermal_regulation_upgrade: 'Mise à niveau régulation thermique',
  other: 'Autre',
};

// Sévérités du plan d'action — synchro avec
// bacs_audit_action_items.severity CHECK ('blocking','major','minor').
const ACTION_SEVERITY_LABEL = {
  blocking: 'Bloquant',
  major: 'Majeur',
  minor: 'Mineur',
};

// Statuts du plan d'action — synchro avec bacs_audit_action_items.status
// CHECK ('open','quoted','in_progress','done','declined').
const ACTION_STATUS_LABEL = {
  open: 'Ouvert',
  quoted: 'Chiffré (devis envoyé)',
  in_progress: 'En cours',
  done: 'Terminé',
  declined: 'Décliné',
};

// Effort estimé — synchro avec bacs_audit_action_items.estimated_effort
// CHECK ('low','medium','high').
const ACTION_EFFORT_LABEL = {
  low: 'Faible',
  medium: 'Modéré',
  high: 'Important',
};

// Bouclage ECS (system_category = 'dhw'). Synchro avec
// bacs_audit_systems.is_looped et le SegmentedToggle desktop.
const IS_LOOPED_LABEL = {
  looped: 'ECS bouclée',
  not_looped: 'ECS non bouclée',
  unknown: 'ECS — à qualifier',
};

// Labels FR pour les ternaires métier des systèmes (questions R175-3).
// Utile au PDF (badges) et aux descriptions MCP — évite que Claude présente
// du `meets_r175_3_p4: 0` sans contexte. Clé null = libellé pour "non répondu".
const SYSTEM_TERNARY_LABEL = {
  meets_r175_3_p3: { true: 'Interopérabilité conforme', false: 'Non conforme R175-3 §3', null: 'À qualifier' },
  meets_r175_3_p4: { true: 'Arrêt manuel conforme', false: 'Non conforme R175-3 §4', null: 'À qualifier' },
  meets_r175_3_p4_autonomous: { true: 'Reprise autonome conforme', false: 'Non conforme', null: 'À qualifier' },
  managed_by_bms: { true: 'Intégré à la GTB', false: 'Non intégré', null: 'À qualifier' },
  marked_negligible_under_5pct: { true: 'Négligeable < 5 %', false: 'Non négligeable', null: 'À qualifier' },
  is_district_heating_substation: { true: 'Sous-station réseau de chaleur', false: 'Pas une sous-station', null: 'À qualifier' },
  serves_multiple_buildings: { true: 'Dessert plusieurs bâtiments', false: 'Bâtiment unique', null: 'À qualifier' },
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
  METER_RECOMMENDATION_LABEL,
  POWER_CALC_TYPE_LABEL,
  METERING_SEPARABLE_LABEL,
  ACTION_CATEGORY_LABEL,
  ACTION_SEVERITY_LABEL,
  ACTION_STATUS_LABEL,
  ACTION_EFFORT_LABEL,
  IS_LOOPED_LABEL,
  SYSTEM_TERNARY_LABEL,
};
