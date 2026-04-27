'use strict';

/**
 * Catalogue des pages reelles d'Hyperveez (web BMS Buildy/Gojee).
 * Source : exploration du code ../hyperveez/src/router/ et navigation-items.js
 * + integrations tierces (smplrspace, Crisp).
 *
 * Format de chaque entree :
 *   slug: {
 *     name: 'Nom dans la sidebar',
 *     description: 'Description metier (texte AF)',
 *     features: ['feature_key', ...],  // cf. service-levels.js → calcul niveau auto
 *     fact_check_status: 'verified' | 'unverified',
 *     note?: 'Detail technique optionnel'
 *   }
 *
 * Sert au seed du chapitre 10.2 du plan AF (sections kind='hyperveez_page').
 */

const HYPERVEEZ_PAGES = {
  // ── Supervision temps reel ──
  map_view: {
    name: 'Carte',
    description: 'Cartographie interactive (Leaflet) de l\'ensemble des sites supervises avec marqueurs colores selon l\'etat des anomalies. Permet une vue d\'ensemble multi-sites et un zoom/fullscreen.',
    features: ['carte_multisites', 'console_alarmes_multisite'],
    fact_check_status: 'verified',
  },
  alerts_view: {
    name: 'Anomalies',
    description: 'Console d\'alarmes multi-sites : creation manuelle, qualification (severite 2/3), acquittement avec utilisateur et timestamp, ajout de notes, filtres avances (etat, severite, utilisateur, client/site), export CSV. Auto-refresh configurable.',
    features: ['console_alarmes_multisite', 'notifications_push'],
    fact_check_status: 'verified',
  },

  // ── Programmations ──
  schedulers_cal_view: {
    name: 'Programmations > Calendriers',
    description: 'Gestion des calendriers d\'evenements horaires via interface Syncfusion. Definition des plages d\'occupation, jours feries, exceptions saisonnieres.',
    features: ['programmations_horaires'],
    fact_check_status: 'verified',
  },
  schedulers_list_view: {
    name: 'Programmations > Evenements',
    description: 'Liste des evenements horaires associes aux equipements writable. Support des donnees astronomiques (lever/coucher du soleil), filtres par zones et equipements, historisation des evenements termines.',
    features: ['programmations_horaires'],
    fact_check_status: 'verified',
  },

  // ── Site (supervision) ──
  site_zones_view: {
    name: 'Zones',
    description: 'Liste et exploration des zones d\'un site avec compteurs d\'equipements et de points de donnee par zone.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
  site_equipments_view: {
    name: 'Equipements',
    description: 'Tableau des equipements supervises avec icones, types, tags, filtrage par zone, affichage temps reel des etats.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
  site_datapoints_view: {
    name: 'Donnees',
    description: 'Liste detaillee des points de donnee par equipement avec valeurs instantanees, timestamps, indicateurs colores selon les seuils configures.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },

  // ── Tableaux de bord ──
  electricity_dashboard_view: {
    name: 'Tableaux de bord > Electricite',
    description: 'Visualisation des consommations electriques par site, periode et equipement. Granularites journalieres, hebdomadaires, mensuelles, annuelles.',
    features: ['dashboards_consommations'],
    fact_check_status: 'verified',
  },
  thermal_dashboard_view: {
    name: 'Tableaux de bord > Thermique',
    description: 'Suivi des consommations en calories pour les systemes de chauffage et de production thermique.',
    features: ['dashboards_consommations'],
    fact_check_status: 'verified',
  },
  water_dashboard_view: {
    name: 'Tableaux de bord > Eau',
    description: 'Suivi des consommations d\'eau froide et chaude sanitaire.',
    features: ['dashboards_consommations'],
    fact_check_status: 'verified',
  },
  gas_dashboard_view: {
    name: 'Tableaux de bord > Gaz',
    description: 'Suivi des consommations de gaz par site et equipement.',
    features: ['dashboards_consommations'],
    fact_check_status: 'verified',
  },
  hvac_dashboard_view: {
    name: 'Tableaux de bord > CVC',
    description: 'Synthese des systemes de chauffage, climatisation et ventilation : etats marche/arret, defauts, modes (chauffage/climatisation), temperatures (moyenne, min, max), groupage par zone et tags. Anomalies par equipement, export CSV.',
    features: ['dashboard_cvc'],
    fact_check_status: 'verified',
    note: 'Codes erreurs sous reserve qu\'ils soient communiques par les unites interieures.',
  },
  iaq_dashboard_view: {
    name: 'Tableaux de bord > QAI',
    description: 'Indicateurs de qualite de l\'air interieur : CO2, temperature, humidite, COV. Historisation et alertes associees.',
    features: ['dashboard_qai'],
    fact_check_status: 'verified',
  },
  lighting_dashboard_view: {
    name: 'Tableaux de bord > Eclairage',
    description: 'Etat des eclairages, consommations, commandes manuelles disponibles.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },

  // ── Historiques ──
  graphs_view: {
    name: 'Graphiques',
    description: 'Visualisation des donnees historisees sous forme de courbes : selection multi-points, periodes (jour/semaine/mois/annee/personnalisee), granularite configurable, comparaison avec periode de reference, plusieurs types de graphiques (ligne, bar, pie, donut, sankey, heatmap), sauvegarde de presets, export CSV, mode plein ecran.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },

  // ── Plans 2D/3D (integration smplrspace) ──
  smplrspace_plans: {
    name: 'Plans 2D/3D interactifs',
    description: 'Plans dynamiques du batiment, vues metiers (CVC, Eclairage, QAI), cartes de chaleur. Integration smplrspace.',
    features: ['option_plans_2d_3d'],
    fact_check_status: 'unverified',
    note: 'Integration tierce smplrspace. Inclus en Premium, option payante en Smart, indisponible en Essentials.',
  },

  // ── Support (integration Crisp) ──
  crisp_chat: {
    name: 'Support integre (chat)',
    description: 'Module de chat avec l\'equipe support Buildy directement dans Hyperveez et Gojee. Integration Crisp.',
    features: ['crisp_chat_support'],
    fact_check_status: 'unverified',
    note: 'Integration tierce Crisp.',
  },

  // ── Administration ──
  users_mgmt_view: {
    name: 'Utilisateurs',
    description: 'Gestion des comptes utilisateurs : creation, invitation, statut (actif/invite/suspendu), assignation de roles et profils d\'acces.',
    features: ['gestion_comptes'],
    fact_check_status: 'verified',
  },
  users_groups_mgmt_view: {
    name: 'Groupes utilisateurs',
    description: 'Gestion des groupes et roles avec permissions granulaires par fonction (lecture/ecriture).',
    features: ['gestion_comptes'],
    fact_check_status: 'verified',
  },

  // ── Configuration ──
  sites_mgmt_view: {
    name: 'Configuration > Sites',
    description: 'Creation et edition des sites : informations generales, parametres de comptage, etages.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
  site_zones_mgmt_view: {
    name: 'Configuration > Zones',
    description: 'Configuration de la hierarchie des zones et sous-zones par site.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
  site_equipments_mgmt_view: {
    name: 'Configuration > Equipements',
    description: 'Configuration des equipements supervises : type, icone, association a une zone, tags.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
  site_datapoints_mgmt_view: {
    name: 'Configuration > Donnees',
    description: 'Configuration des points de donnee : types, unites, seuils, facets (writable, precision, options...).',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
  meters_mgmt_view: {
    name: 'Configuration > Compteurs',
    description: 'Configuration des compteurs (sous-categorie d\'equipements pour le comptage energetique et fluidique).',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
  data_profiles_mgmt_view: {
    name: 'Configuration > Profils de donnees',
    description: 'Profils d\'affichage personnalises pour Hyperveez et Gojee (display_name, long_display_name, icone, visibilite).',
    features: ['hyperveez_acces', 'gojee_mobile'],
    fact_check_status: 'verified',
  },
  tags_mgmt_view: {
    name: 'Configuration > Tags',
    description: 'Gestion des tags et etiquettes pour la classification et le filtrage transverse.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },

  // ── Connecteurs ──
  edge_gw_mgmt_view: {
    name: 'Connecteurs > Passerelles Edge',
    description: 'Gestion des passerelles Edge (BACnet IP) : statut, alertes de coupures MQTT.',
    features: ['multi_protocoles'],
    fact_check_status: 'verified',
  },
  edge_data_providers_mgmt_view: {
    name: 'Connecteurs > Appareils BACnet',
    description: 'Configuration des appareils BACnet : decouverte automatique, adresses IP.',
    features: ['multi_protocoles'],
    fact_check_status: 'verified',
  },
  edge_data_mgmt_view: {
    name: 'Connecteurs > Points BACnet',
    description: 'Configuration des points BACnet : types d\'objets, instances, attribut settable.',
    features: ['multi_protocoles'],
    fact_check_status: 'verified',
  },
  lora_gw_mgmt_view: {
    name: 'Connecteurs > Passerelles LoRa',
    description: 'Gestion des passerelles LoRaWAN.',
    features: ['multi_protocoles'],
    fact_check_status: 'verified',
  },
  lora_data_providers_mgmt_view: {
    name: 'Connecteurs > Capteurs LoRa',
    description: 'Configuration des capteurs LoRaWAN.',
    features: ['multi_protocoles'],
    fact_check_status: 'verified',
  },
  lora_data_mgmt_view: {
    name: 'Connecteurs > Points LoRa',
    description: 'Configuration des points de donnee remontes par les capteurs LoRaWAN.',
    features: ['multi_protocoles'],
    fact_check_status: 'verified',
  },
  variables_mgmt_view: {
    name: 'Connecteurs > Variables virtuelles',
    description: 'Donnees virtuelles ou calculees non liees a un equipement physique. Permet de creer des commandes generales virtuelles regroupant plusieurs equipements.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },

  // ── Historique ──
  time_series_data_mgmt: {
    name: 'Historique brut',
    description: 'Acces a l\'historique brut des valeurs temporelles pour analyse approfondie.',
    features: ['hyperveez_acces'],
    fact_check_status: 'verified',
  },
};

module.exports = { HYPERVEEZ_PAGES };
