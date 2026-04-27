'use strict';

/**
 * Niveaux de service Buildy 2026 — source : docs/offres-buildy-2026-ia.pdf
 * (parse a la main une fois pour eviter une dep PDF.js).
 *
 * Convention de chaque entree :
 *   feature_key: {
 *     label: 'Nom lisible',
 *     E: bool|'option'|'paid'|'optional',  // disponibilite Essentials
 *     S: bool|'option'|'paid'|'optional',  // disponibilite Smart
 *     P: bool|'option'|'paid'|'optional',  // disponibilite Premium
 *     note?: 'precision optionnelle',
 *     bacs_link?: 'R175-3 §1' (si applicable)
 *   }
 *
 * Helpers :
 *   - resolveLevel({E, S, P}) -> 'E' | 'S' | 'P' (niveau minimum requis)
 *   - resolveServiceLevelTag(features[]) -> 'E/S/P', 'S/P', 'P', 'option' selon
 *     l'union des features incluses dans une section.
 */

const SERVICE_LEVELS = {
  // ── Infrastructure & maintenance ──
  maintenance_infra_gtb: {
    label: 'Maintenance preventive de l\'infrastructure GTB',
    E: false, S: true, P: true,
  },
  multi_protocoles: {
    label: 'Compatibilite multi-protocoles (BACnet, Modbus, KNX, DALI, SNMP, REST API, M-Bus, LoRaWAN, MQTT)',
    E: true, S: true, P: true,
  },
  multi_fabricants: {
    label: 'Compatibilite multi-fabricants, multi-usages',
    E: true, S: true, P: true,
  },
  lns_cloud_tti: {
    label: 'Compatibilite avec LNS Cloud TheThingsIndustries',
    E: false, S: true, P: true,
    note: 'Consultez-nous pour le developpement de connecteurs depuis d\'autres LNS Cloud',
  },
  connecteur_enedis: {
    label: 'Connecteur Enedis (donnees consommations + production PV)',
    E: 'option', S: 'option', P: 'optional',
    note: 'Disponibilite prochaine — non integre dans les AFs actuelles',
  },
  connecteur_grdf: {
    label: 'Connecteur GRDF (donnees consommations gaz)',
    E: 'option', S: 'option', P: 'optional',
    note: 'Disponibilite prochaine — non integre dans les AFs actuelles',
  },

  // ── Hyperveez (web) ──
  hyperveez_acces: {
    label: 'Acces a l\'application web Hyperveez',
    E: true, S: true, P: true,
  },
  console_alarmes_multisite: {
    label: 'Console d\'alarmes multi-sites',
    E: true, S: true, P: true,
  },
  pilotage_equipements_cloud: {
    label: 'Pilotage des equipements du batiment depuis le cloud',
    E: true, S: true, P: true,
    bacs_link: 'R175-3 §4',
  },
  programmations_horaires: {
    label: 'Gestion centralisee des programmations horaires',
    E: true, S: true, P: true,
    bacs_link: 'R175-3 §4',
  },
  sauvegarde_donnees: {
    label: 'Sauvegarde et securisation des donnees historisees',
    E: false, S: true, P: true,
  },
  acces_securise_equipements: {
    label: 'Acces ultra simplifie et securise aux equipements (GTC, automates)',
    E: false, S: true, P: true,
  },

  // ── Retention donnees ──
  retention_brutes: {
    label: 'Retention historique des donnees brutes',
    E: '1 mois', S: '1 mois', P: '1 mois',
  },
  retention_horaires: {
    label: 'Retention historique des donnees horaires',
    E: '1 mois', S: '6 mois', P: '12 mois',
    bacs_link: 'R175-3 §1',
  },
  retention_journalieres: {
    label: 'Retention historique des donnees journalieres',
    E: '12 mois', S: '2 ans', P: '3 ans',
    bacs_link: 'R175-3 §1',
  },
  retention_mensuelles: {
    label: 'Retention historique des donnees mensuelles',
    E: '12 mois', S: '5 ans', P: '10 ans',
    bacs_link: 'R175-3 §1 (5 ans requis)',
    note: 'Seul le niveau Premium [P] satisfait l\'exigence reglementaire R175-3 §1 (5 ans). Smart la couvre exactement, Essentials non.',
  },

  // ── Notifications & dashboards ──
  notifications_push: {
    label: 'Notifications push smartphone (anomalies)',
    E: false, S: true, P: true,
    bacs_link: 'R175-3 §2',
  },
  carte_multisites: {
    label: 'Carte d\'hypervision multi-sites',
    E: false, S: true, P: true,
  },
  dashboard_qai: {
    label: 'Tableau de bord qualite de l\'air interieur',
    E: false, S: true, P: true,
  },
  dashboards_consommations: {
    label: 'Tableaux de bord consommations energetiques mensuels et annuels',
    E: false, S: true, P: true,
    bacs_link: 'R175-3 §1',
  },
  dashboard_cvc: {
    label: 'Tableau de bord chauffage / climatisation / ventilation avec codes erreurs',
    E: false, S: true, P: true,
    note: 'Sous reserve que les codes erreurs soient communiques par les unites interieures',
  },

  // ── Gojee (mobile) ──
  gojee_mobile: {
    label: 'Acces a l\'application mobile Gojee (Android & iOS)',
    E: false, S: true, P: true,
  },
  gojee_qr_code: {
    label: 'Acces simplifie Gojee via QR Codes proteges',
    E: false, S: false, P: true,
  },
  gojee_anomalies_manuelles: {
    label: 'Declarations manuelles d\'anomalies dans Gojee',
    E: false, S: false, P: true,
  },

  // ── Surveillance & maintenance auto ──
  surveillance_communication: {
    label: 'Surveillance automatique 24h/24 365j/an de la communication',
    E: true, S: true, P: true,
    bacs_link: 'R175-3 §2',
  },
  mises_a_jour_apps: {
    label: 'Mises a jour regulieres et automatiques des applications',
    E: true, S: true, P: true,
  },

  // ── Operations utilisateurs ──
  renommage_zones: {
    label: 'Renommage des zones et equipements',
    E: 'paid', S: true, P: true,
  },
  gestion_comptes: {
    label: 'Ajout / suppression de comptes utilisateurs (sur demande)',
    E: 'paid', S: true, P: true,
  },
  support_standard: {
    label: 'Support standard (best effort) via outil de ticket',
    E: 'paid', S: true, P: true,
    note: 'Pas de SLA defini',
  },

  // ── Options ──
  option_connectivite_4g: {
    label: 'Option Connectivite (4G M2M multi-operateurs)',
    E: 'option', S: 'option', P: true,
  },
  option_plans_2d_3d: {
    label: 'Option Plans 2D/3D dynamiques et interactifs (integration smplrspace)',
    E: 'option', S: 'option', P: true,
  },
  option_serenite: {
    label: 'Option Serenite (contrat de maintenance GTB + support prioritaire)',
    E: 'option', S: 'option', P: 'option',
    note: 'Prestation a distance uniquement. Tout deplacement facture en sus.',
  },
  option_multi_preneurs: {
    label: 'Option Batiment multi-preneurs (chaque locataire sa propre supervision)',
    E: 'option', S: false, P: false,
  },

  // ── Premium-only ──
  gtb_flex_ready: {
    label: 'GTB Flex-Ready (connexion futur operateur de flexibilite electrique)',
    E: false, S: false, P: true,
    note: 'Disponibilite prochaine',
  },
  api_cloud: {
    label: 'API Cloud REST (Buildy Connect)',
    E: false, S: false, P: 'paid',
    note: 'Sur devis',
  },

  // ── Integration tierce documentee ──
  crisp_chat_support: {
    label: 'Support integre via chat (integration Crisp)',
    E: false, S: true, P: true,
    note: 'Integration tierce Crisp dans Hyperveez et Gojee',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

const RANK = { E: 0, S: 1, P: 2 };

/**
 * Pour une feature donnee, retourne le NIVEAU MIN qui la rend disponible
 * sans option payante. Renvoie null si la feature est uniquement en option
 * a tous les niveaux.
 */
function minLevelForFeature(featureKey) {
  const f = SERVICE_LEVELS[featureKey];
  if (!f) return null;
  for (const lvl of ['E', 'S', 'P']) {
    if (f[lvl] === true || (typeof f[lvl] === 'string' && !['option', 'optional', 'paid'].includes(f[lvl]))) {
      return lvl;
    }
  }
  return null;
}

/**
 * Pour une liste de features (cles), retourne le niveau minimum qui les
 * couvre toutes. Ex: [console_alarmes_multisite (E), notifications_push (S)] -> 'S'.
 */
function resolveAfMinLevel(featureKeys) {
  let max = -1;
  for (const k of featureKeys) {
    const lvl = minLevelForFeature(k);
    if (lvl == null) continue; // option-only feature, ignore
    if (RANK[lvl] > max) max = RANK[lvl];
  }
  if (max < 0) return null;
  return Object.keys(RANK).find(k => RANK[k] === max);
}

/**
 * Pour une section, calcule la chaine d'affichage du niveau (ex 'E/S/P', 'S/P', 'P').
 */
function formatServiceLevel(featureKeys) {
  const min = resolveAfMinLevel(featureKeys);
  if (!min) return null;
  if (min === 'E') return 'E/S/P';
  if (min === 'S') return 'S/P';
  return 'P';
}

/**
 * Liste des features marquees 'option' (toutes plages) — utile pour generer
 * la mention "Options requises" en page de garde du PDF AF.
 */
function listOptionalFeatures(featureKeys) {
  return featureKeys.filter(k => {
    const f = SERVICE_LEVELS[k];
    if (!f) return false;
    return ['E', 'S', 'P'].every(l => f[l] === 'option' || f[l] === false || f[l] === 'paid');
  });
}

module.exports = {
  SERVICE_LEVELS,
  minLevelForFeature,
  resolveAfMinLevel,
  formatServiceLevel,
  listOptionalFeatures,
};
