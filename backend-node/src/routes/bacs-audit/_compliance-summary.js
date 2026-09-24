'use strict';

// Helper de synthèse pour la cover, la page « L'essentiel » et le tableau
// de bord de conformité par exigence R175. Calcule à partir des données
// déjà préparées par _export-data.js (ou _preview-fixture.js) :
//
//  - verdict global (compliant / partial / non_compliant)
//  - calcul d'assujettissement déroulé R175-2 (puissance / PC / seuil)
//  - 3 actions phares (les 3 premières par sévérité descendante)
//  - tableau de bord 8 lignes (R175-2, R175-3 1°/3°/4°/dernier alinéa,
//    R175-4, R175-5, R175-6) avec verdict + résumé + nb actions par axe
//
// Utilisé identiquement par _export-data.js (audit réel) et
// _preview-fixture.js (dataset fictif). Ne dépend pas de la DB.

const { isTrue, isFalse, isUnanswered } = require('./_ternary');

// Axes GTB à champ pivot ternaire unique : si le champ n'a pas été répondu
// (null) et qu'aucune action n'a été générée, l'axe ne doit PAS conclure
// « conforme » par simple absence d'action (le générateur ne crée d'action
// que sur un « non » explicite). On force alors 'unknown'. Évite le faux
// « conforme » de type Communay au niveau du verdict d'axe.
const AXIS_PIVOT_FIELD = {
  r175_3_1: 'meets_r175_3_p1',
  r175_3_2: 'meets_r175_3_p2',
  r175_3_data: 'data_provision_to_manager',
  r175_4: 'has_maintenance_procedures',
  r175_5: 'operator_trained',
};
// Exigences d'un seul tenant (une question, un fait) : un écart majeur n'y
// laisse rien de « partiellement » satisfait → « Non conforme ». Les axes
// évalués système par système (3°, 4°, R175-6) ou en plusieurs points
// (1°, dernier alinéa) gardent « Partiellement conforme ».
const SINGLE_REQUIREMENT_AXES = new Set(['r175_3_2', 'r175_5', 'r175_5_1']);
// Ce qui reste à établir quand la question pivot d'un axe est sans réponse
// (relecture clarté R2 m20 : plus de « question non répondue »).
const AXIS_UNKNOWN_HINT = {
  r175_3_1: 'le suivi horaire des consommations par la GTB et leur conservation sur cinq ans restent à vérifier',
  r175_3_2: 'la détection des pertes d\'efficacité par la GTB reste à vérifier',
  r175_3_data: 'la mise à disposition des données au gestionnaire et aux exploitants reste à vérifier',
  r175_4: 'l\'organisation des vérifications périodiques de la GTB reste à attester',
  r175_5: 'la formation de l\'exploitant reste à attester',
};
const { readingsForAxis } = require('../../lib/bacs-buildy-readings');

// Mapping exigence R175 → libellé court grand public + référence article
// pour le tableau de bord. La liste est volontairement courte et tenue.
// `summary` = « ce que le décret exige », au plus près du texte officiel
// (texte en vigueur au 15/09/2026, cf. annexe A). `displayCode` = référence
// imprimée dans le PDF quand le code interne n'est pas lisible (« D.A. »).
const R175_EXIGENCES = [
  { code: 'R175-2',                axis: 'r175_2',     label: 'Assujettissement du bâtiment',
    summary: 'Déterminer si le bâtiment est soumis au décret BACS, et à quelle échéance de mise en conformité.' },
  { code: 'R175-3 1°',             axis: 'r175_3_1',   label: 'Suivi des consommations au pas horaire',
    summary: 'La GTB suit, enregistre et analyse en continu, par zone fonctionnelle et au pas horaire, les consommations et productions d\'énergie, ajuste les systèmes en conséquence et conserve les données mensuelles pendant 5 ans.' },
  { code: 'R175-3 2°',             axis: 'r175_3_2',   label: 'Détection des pertes d\'efficacité',
    summary: 'La GTB compare l\'efficacité énergétique à des valeurs de référence, détecte les pertes d\'efficacité et en informe l\'exploitant.' },
  { code: 'R175-3 3°',             axis: 'r175_3_3',   label: 'Interopérabilité',
    summary: 'La GTB communique avec les systèmes techniques qui doivent lui être reliés (protocole normalisé, interface de programmation ou passerelle).' },
  { code: 'R175-3 4°',             axis: 'r175_3_4',   label: 'Arrêt manuel et gestion autonome',
    summary: 'Les systèmes reliés peuvent être arrêtés manuellement et continuent de fonctionner de façon autonome, même si la GTB est arrêtée.' },
  { code: 'R175-3 D.A.',           axis: 'r175_3_data', label: 'Mise à disposition des données', displayCode: 'R175-3 dernier alinéa',
    summary: 'Le propriétaire de la GTB, propriétaire des données, les met à disposition du gestionnaire du bâtiment à sa demande et transmet à chaque exploitant les données qui le concernent.' },
  { code: 'R175-4',                axis: 'r175_4',     label: 'Vérifications périodiques',
    summary: 'La GTB est vérifiée périodiquement, par un prestataire externe ou un personnel interne compétent, selon des consignes écrites (périodicité, points à contrôler, réparation rapide des éléments défaillants).' },
  { code: 'R175-5',                axis: 'r175_5',     label: 'Formation de l\'exploitant',
    summary: 'L\'exploitant est formé au fonctionnement de la GTB, notamment à son paramétrage.' },
  { code: 'R175-5-1',              axis: 'r175_5_1',   label: 'Inspection périodique',
    summary: 'La GTB est inspectée périodiquement, à l\'initiative du propriétaire, à une fréquence fixée par arrêté (au plus tard tous les 5 ans, arrêté du 7 avril 2023) ; le rapport est remis dans le mois et conservé 10 ans.' },
  { code: 'R175-6',                axis: 'r175_6',     label: 'Régulation automatique du chauffage',
    summary: 'Les émetteurs de chauffage disposent d\'une régulation automatique de la température par pièce ou, si cela est justifié, par zone chauffée (bâtiments dont le permis de construire est déposé à partir du 22 juillet 2021, et autres bâtiments lors de l\'installation ou du remplacement du générateur de chaleur).' },
];

// RÉSERVES (doctrine validée par Kévin le 2026-09-23, toutes GTB) : des
// obligations à respecter, mises en évidence dans le rapport, qui ne font
// pas conclure « non conforme » — contrat de maintenance de la GTB
// (R175-4) et, en supervision Buildy Essentials, export régulier des
// données de consommation (R175-3 1°). S'il ne reste que des réserves, le
// verdict est « Conforme sous réserves ».
// 'no_inspection' : inspection périodique R175-5-1 à faire réaliser par le
// propriétaire (même traitement que la maintenance ; R1 m10, R3 N-M6).
const RESERVE_SUBTYPES = new Set(['maintenance', 'data_export_backup', 'no_inspection']);
const isReserveAction = (a) => RESERVE_SUBTYPES.has(a?.source_subtype);
// INFORMATIONS : traces non correctives (exemption par la règle des 5 %,
// vigilance sanitaire d'une boucle d'ECS, contre-indication de coupure).
// Ni actions ni écarts : hors décomptes, hors axes, imprimées dans le bloc
// « Exemptions et points de vigilance » du plan.
// 'data_export_capability' : recommandation HORS décret (export en format
// ouvert, non exigé) — ni action du plan ni écart (R3 N-M2).
const INFO_SUBTYPES = new Set(['negligible_5pct', 'ecs_looped_legionella', 'contraindication_no_cut', 'data_export_capability']);
const isInfoAction = (a) => INFO_SUBTYPES.has(a?.source_subtype);

// Mappe l'article R175 brut d'une action vers l'axe du tableau de bord.
// Exemples : 'R175-3 1°' → 'r175_3_1', 'R175-3 dernier alinéa' → 'r175_3_data'.
function axisOfArticle(article) {
  if (!article) return null;
  const a = String(article).trim();
  if (/^R175-?2/i.test(a)) return 'r175_2';
  if (/R175-?3.*1°/i.test(a) || /R175-?3.*§\s*1\b/i.test(a)) return 'r175_3_1';
  if (/R175-?3.*2°/i.test(a) || /R175-?3.*(§\s*2\b|§\s*P2)/i.test(a)) return 'r175_3_2';
  if (/R175-?3.*3°/i.test(a) || /R175-?3.*§\s*3\b/i.test(a)) return 'r175_3_3';
  if (/R175-?3.*4°/i.test(a) || /R175-?3.*§\s*4\b/i.test(a)) return 'r175_3_4';
  if (/R175-?3.*(dernier|alin|donn)/i.test(a)) return 'r175_3_data';
  if (/R175-?3/i.test(a)) return 'r175_3_1';                  // R175-3 nu = 1° par défaut
  if (/R175-?4/i.test(a)) return 'r175_4';
  // R175-5-1 (inspection tiers) AVANT R175-5 (formation) : le regex R175-5
  // matcherait aussi « R175-5-1 » et gonflerait à tort l'axe formation.
  if (/R175-?5-?1/i.test(a)) return 'r175_5_1';
  if (/R175-?5/i.test(a)) return 'r175_5';
  if (/R175-?6/i.test(a)) return 'r175_6';
  return null;
}

// Date au format français long : « 1er janvier 2022 », « 24 septembre 2026 »
// (calendrier UTC : une date ISO sans heure ne glisse jamais d'un jour).
function frLongDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .replace(/^1 /, '1er ');
}

function verdictFromActions({ blocking, major }) {
  if (blocking > 0) return 'non_compliant';
  if (major > 0)    return 'partial';
  return 'compliant';
}

const VERDICT_LABEL = {
  compliant:          'Conforme',
  compliant_reserves: 'Conforme sous réserves', // verdict global
  reserve:            'Conforme sous réserve',  // verdict d'une exigence
  partial:            'Partiellement conforme',
  non_compliant:      'Non conforme',
  na:                 'Non applicable',
  unknown:            'À qualifier',
  info:               'Statut',
};

const VERDICT_ICON = {
  compliant: '✓', compliant_reserves: '✓', reserve: '✓', partial: '⚠', non_compliant: '✗', na: '–', unknown: '?', info: 'i', not_subject: '–',
};
// Libellés du verdict GLOBAL (couverture) : « À qualifier » convient à une
// ligne du tableau de bord, pas à l'état de conformité du site.
const GLOBAL_VERDICT_LABEL = {
  ...VERDICT_LABEL,
  unknown: 'Non déterminé',
  not_subject: 'Non assujetti',
};

// Calcul d'assujettissement R175-2 : déroulé en 3 lignes (puissance + PC + seuil)
// pour la page « L'essentiel ». Seuils du décret : 70 kW (échéance 2030, report
// acté au JO du 26 décembre 2025), 290 kW (2025).
function buildAssujettissement(document, powerSummary = null) {
  const power = document.bacs_total_power_kw || 0;
  const pcDate = document.bacs_building_permit_date || null;
  const status = document.bacs_applicability_status || null;
  // Statut PRÉSUMÉ : puissance retenue ≤ 70 kW mais puissances d'équipements
  // non saisies (règle protectrice de bacs-audit-power.js) — ne jamais
  // l'écrire comme un constat « entre 70 et 290 kW ».
  const presumed = status === 'subject_2030' && power <= 70
    && !!(powerSummary && powerSummary.incompletePowerCount > 0);
  const effectivePower = powerSummary?.effectiveKw != null ? powerSummary.effectiveKw : power;
  let conclusion;
  switch (status) {
    // Statut réservé aux bâtiments NEUFS (R175-2 II 1° et 3°).
    case 'subject_immediate': conclusion = effectivePower > 290
      ? 'Bâtiment neuf (permis de construire déposé à partir du 22 juillet 2021) de plus de 290 kW — obligation applicable dès la construction, avec raccordement de tous les systèmes techniques.'
      : 'Bâtiment neuf (permis de construire déposé à partir du 9 avril 2024) de plus de 70 kW — obligation applicable dès la construction, avec raccordement de tous les systèmes techniques.'; break;
    case 'subject_2025':      conclusion = 'Puissance supérieure à 290 kW — obligation applicable depuis le 1er janvier 2025.'; break;
    case 'subject_2030':      conclusion = presumed
      ? 'Puissances d\'équipements incomplètes — assujettissement présumé tant qu\'elles ne sont pas toutes renseignées (échéance au plus tard le 1er janvier 2030).'
      : 'Puissance entre 70 et 290 kW — obligation applicable lors du renouvellement du système de chauffage ou de climatisation, et au plus tard le 1er janvier 2030.'; break;
    case 'not_subject':       conclusion = 'Puissance inférieure ou égale à 70 kW — bâtiment non assujetti au décret BACS.'; break;
    default:                  conclusion = 'Statut d\'assujettissement non renseigné.';
  }
  const determined = !!status;
  // Seuil pertinent : 290 kW pour les statuts « 2025 » et « neuf > 290 kW »,
  // 70 kW dans tous les autres cas (dont « non assujetti » et neuf 70-290 kW).
  const threshold = (status === 'subject_2025' || (status === 'subject_immediate' && effectivePower > 290)) ? 290 : 70;
  return {
    powerKw: power,
    pcDate,
    pcDateLabel: pcDate ? frLongDate(pcDate) : null,
    threshold,
    // Tant que le statut n'est pas renseigné, on n'affiche pas un seuil
    // unique trompeur : les deux seuils du décret coexistent.
    determined,
    thresholdLabel: determined ? `${threshold} kW` : '70 kW (2030) ou 290 kW (2025)',
    status,
    presumed,
    conclusion,
  };
}

// ── Evidence par axe R175 (Lot 1 — Plan « Qualité du livrable PDF ») ────
// Chaque axe du tableau de bord R175 expose désormais les CHIFFRES SOURCES
// (« sur quelles données ce verdict est-il calculé ? ») afin de rendre le
// PDF auditable par un tiers (client, BE, avocat). Format stable :
//   evidence = {
//     kpis: [{ key, label, value, unit?, hint? }, ...],
//     explanation: 'phrase courte en clair sur l'état de l'axe',
//   }
// Si les données nécessaires ne sont pas fournies (cas legacy / fixtures
// incomplètes), evidence vaut `null` — le PDF affiche alors le bloc verdict
// sans le détail « sur quelles données ? ».
function pct(num, den) {
  if (!den || den < 1) return null;
  return Math.round((num / den) * 100);
}
function evR175_2({ document, powerSummary }) {
  const status = document.bacs_applicability_status || null;
  const power = powerSummary?.effectiveKw != null
    ? Math.round(powerSummary.effectiveKw * 10) / 10
    : (document.bacs_total_power_kw || 0);
  const threshold = (status === 'subject_2025' || (status === 'subject_immediate' && power > 290)) ? 290 : 70;
  const kpis = [
    { key: 'cumul_retained', label: 'Puissance retenue', value: power, unit: 'kW',
      hint: 'Cumul chaud d\'un côté, froid de l\'autre ; on retient le maximum des deux (ils ne s\'additionnent pas). Équipements de secours et systèmes mobiles exclus.' },
    { key: 'threshold', label: 'Seuil applicable', value: status ? threshold : null, unit: 'kW',
      hint: status === 'subject_2030' ? 'Seuil R175-2 II 4° (> 70 kW, existant) — lors du renouvellement du système de chauffage ou de climatisation, et au plus tard le 1er janvier 2030.'
        : status === 'subject_2025' ? 'Seuil R175-2 II 2° (> 290 kW, existant) — échéance 1er janvier 2025.'
        : status === 'subject_immediate' ? 'R175-2 II 1° / 3° (bâtiment neuf) — obligation dès la construction, tous les systèmes techniques reliés.'
        : status === 'not_subject' ? 'Seuil R175-2 I : puissance supérieure à 70 kW. En deçà (70 kW inclus), le bâtiment n\'est pas assujetti.'
        : 'Seuil non déterminé tant que la puissance et la date de permis ne sont pas renseignées.' },
  ];
  if (powerSummary?.autoHeatKw != null) {
    kpis.push({ key: 'auto_heat', label: 'Cumul chaud auto', value: Math.round(powerSummary.autoHeatKw * 10) / 10, unit: 'kW' });
  }
  if (powerSummary?.autoCoolKw != null) {
    kpis.push({ key: 'auto_cool', label: 'Cumul froid auto', value: Math.round(powerSummary.autoCoolKw * 10) / 10, unit: 'kW' });
  }
  return { kpis, explanation: null /* la conclusion est déjà dans assujettissement.conclusion */ };
}
function evR175_3_1({ recapStats }) {
  if (!recapStats) return null;
  const req = recapStats.metersRequired || 0;
  const present = recapStats.metersPresent || 0;
  const missing = recapStats.metersMissing || 0;
  const coverage = pct(present, req);
  return {
    kpis: [
      { key: 'meters_required', label: 'Compteurs requis (R175-3 1°)', value: req,
        hint: 'Compteurs prévus par le plan de comptage que Buildy préconise pour répondre au R175-3 1° (le décret ne fixe pas de nombre minimal de compteurs).' },
      { key: 'meters_present',  label: 'Compteurs présents sur site', value: present },
      { key: 'meters_missing',  label: 'Compteurs requis mais absents', value: missing,
        hint: 'Compteurs du plan de comptage constatés absents (y compris ceux couverts par le compteur unique d\'une zone regroupée).' },
      ...(recapStats.metersToInstall != null ? [{ key: 'meters_to_install', label: 'Compteurs à installer (plan d\'actions)', value: recapStats.metersToInstall,
        hint: 'Actions « Installer un compteur » du plan, dont celles sous condition de temps de retour sur investissement ; une zone regroupée ne compte qu\'un compteur (R175-3 1°).' }] : []),
      ...(coverage != null ? [{ key: 'coverage', label: 'Couverture comptage', value: coverage, unit: '%' }] : []),
    ],
    explanation: missing === 0 && req > 0
      ? 'Tous les compteurs prévus par le plan de comptage sont présents sur le site.'
      : missing > 0
        ? `${missing} compteur(s) requis sont absents — voir le plan d'action pour les installer.`
        : null,
  };
}
function evR175_3_2({ bms }) {
  if (!bms) return { kpis: [], explanation: 'GTB non encore qualifiée — verdict indéterminable.' };
  const rules = (bms.r175_3_p2_anomaly_rules_html || '').replace(/<[^>]*>/g, '').trim();
  return {
    kpis: [
      { key: 'bms_meets_p2', label: 'Détection des dérives par la GTB (R175-3 2°)',
        value: isTrue(bms.meets_r175_3_p2) ? 'Oui' : isFalse(bms.meets_r175_3_p2) ? 'Non' : 'Non renseigné',
        hint: 'La GTB compare les consommations aux valeurs de référence et signale les pertes d\'efficacité.' },
      ...(rules ? [{ key: 'anomaly_rules', label: 'Règles / seuils / alertes actives', value: rules }] : []),
    ],
    explanation: null,
  };
}
function evR175_3_3({ devices }) {
  if (!Array.isArray(devices)) return null;
  const live = devices.filter(d => !d.out_of_service);
  if (!live.length) return null;
  const integrated = live.filter(d => isTrue(d.managed_by_bms)).length;
  const notIntegrated = live.filter(d => isFalse(d.managed_by_bms)).length;
  const unanswered = live.filter(d => d.managed_by_bms == null).length;
  return {
    kpis: [
      { key: 'devices_present', label: 'Équipements en service', value: live.length },
      { key: 'devices_integrated', label: 'Équipements intégrés à la GTB', value: integrated },
      { key: 'devices_not_integrated', label: 'Équipements non intégrés', value: notIntegrated,
        hint: 'Équipements non raccordés à la GTB (R175-3 3°).' },
      ...(unanswered > 0 ? [{ key: 'devices_unanswered', label: 'Intégration non renseignée', value: unanswered,
        hint: 'Question « intégré à la GTB ? » non répondue — à clarifier avant livraison.' }] : []),
      { key: 'coverage', label: 'Couverture interopérabilité', value: pct(integrated, live.length), unit: '%' },
    ],
    explanation: notIntegrated === 0 && unanswered === 0
      ? 'Tous les équipements en service sont intégrés à la GTB.'
      : null,
  };
}
function evR175_3_4({ devices, bms }) {
  if (!Array.isArray(devices)) return null;
  const live = devices.filter(d => !d.out_of_service);
  if (!live.length) return null;
  const arret_ok = live.filter(d => isTrue(d.meets_r175_3_p4)).length;
  const arret_ko = live.filter(d => isFalse(d.meets_r175_3_p4)).length;
  const arret_unanswered = live.filter(d => d.meets_r175_3_p4 == null).length;
  const auto_ok = live.filter(d => isTrue(d.meets_r175_3_p4_autonomous)).length;
  const auto_ko = live.filter(d => isFalse(d.meets_r175_3_p4_autonomous)).length;
  const auto_unanswered = live.filter(d => d.meets_r175_3_p4_autonomous == null).length;
  return {
    kpis: [
      { key: 'arret_manuel_ok', label: 'Arrêt manuel possible depuis la GTB', value: arret_ok,
        hint: 'Équipements que la GTB permet d\'arrêter et de remettre en marche manuellement (R175-3 4°).' },
      ...(arret_ko > 0 ? [{ key: 'arret_manuel_ko', label: 'Arrêt manuel impossible', value: arret_ko }] : []),
      ...(arret_unanswered > 0 ? [{ key: 'arret_manuel_unanswered', label: 'Arrêt manuel non renseigné', value: arret_unanswered }] : []),
      { key: 'auto_ok', label: 'Fonctionnement autonome', value: auto_ok,
        hint: 'Équipements qui continuent de fonctionner si la GTB est arrêtée ou la communication coupée (R175-3 4°).' },
      ...(auto_ko > 0 ? [{ key: 'auto_ko', label: 'Pas de fonctionnement autonome', value: auto_ko }] : []),
      ...(auto_unanswered > 0 ? [{ key: 'auto_unanswered', label: 'Fonctionnement autonome non renseigné', value: auto_unanswered }] : []),
    ],
    explanation: null,
  };
}
function evR175_3_data({ bms }) {
  if (!bms) return { kpis: [], explanation: 'GTB non encore qualifiée — verdict indéterminable.' };
  return {
    kpis: [
      { key: 'bms_present', label: 'GTB présente sur le site', value: isTrue(bms.present) ? 'Oui' : isFalse(bms.present) ? 'Non' : 'Non renseigné' },
      { key: 'data_provision_manager', label: 'Données mises à disposition du gestionnaire',
        value: isTrue(bms.data_provision_to_manager) ? 'Oui' : isFalse(bms.data_provision_to_manager) ? 'Non' : 'Non renseigné' },
      { key: 'data_provision_operators', label: 'Données transmises aux exploitants',
        value: isTrue(bms.data_provision_to_operators) ? 'Oui' : isFalse(bms.data_provision_to_operators) ? 'Non' : 'Non renseigné' },
    ],
    explanation: null,
  };
}
function evR175_4({ bms, inspections }) {
  const kpis = [];
  if (bms) {
    kpis.push({ key: 'maint_procedures', label: 'Procédures de maintenance écrites',
      value: isTrue(bms.has_maintenance_procedures) ? 'Oui' : isFalse(bms.has_maintenance_procedures) ? 'Non' : 'Non renseigné',
      hint: 'R175-4 exige une procédure formalisée et appliquée.' });
  }
  if (Array.isArray(inspections) && inspections.length) {
    const last = inspections[0];
    kpis.push({ key: 'last_inspection', label: 'Dernière inspection R175-5-1',
      value: last.last_inspection_date || 'Non renseignée' });
  }
  return { kpis, explanation: null };
}
function evR175_5({ bms }) {
  if (!bms) return { kpis: [], explanation: 'GTB non encore qualifiée — verdict indéterminable.' };
  return {
    kpis: [
      { key: 'operator_trained', label: 'Exploitant formé au paramétrage',
        value: isTrue(bms.operator_trained) ? 'Oui' : isFalse(bms.operator_trained) ? 'Non' : 'Non renseigné',
        hint: 'R175-5 exige une formation de l\'exploitant au pilotage de la GTB.' },
    ],
    explanation: null,
  };
}
function evR175_5_1({ inspections }) {
  if (!Array.isArray(inspections) || !inspections.length) {
    return {
      kpis: [{ key: 'inspection', label: 'Inspection R175-5-1 réalisée', value: 'Aucune déclarée',
        hint: 'Inspection périodique de la GTB à l\'initiative du propriétaire, à une fréquence fixée par arrêté (au plus tard tous les 5 ans), rapport conservé 10 ans. La FAQ ministérielle n° 30 (non opposable) indique qu\'il « peut être pertinent » de la confier à un tiers indépendant ; le décret ne l\'impose pas.' }],
      explanation: null,
    };
  }
  const last = inspections[0];
  return {
    kpis: [
      { key: 'last_inspection', label: 'Dernière inspection', value: last.last_inspection_date || 'Date non renseignée' },
      ...(last.next_inspection_due_date ? [{ key: 'next_due', label: 'Prochaine échéance', value: last.next_inspection_due_date }] : []),
      ...(last.inspector_name ? [{ key: 'inspector', label: 'Organisme inspecteur', value: last.inspector_name }] : []),
    ],
    explanation: null,
  };
}
function evR175_6({ thermal, r175_6_applicable }) {
  if (r175_6_applicable?.undetermined) {
    return {
      kpis: [{ key: 'applies', label: 'R175-6 applicable', value: 'À confirmer', hint: r175_6_applicable.reason }],
      explanation: `Applicabilité de l'article R175-6 à confirmer : ${r175_6_applicable.reason}.`,
    };
  }
  if (r175_6_applicable && !r175_6_applicable.applies) {
    return {
      kpis: [
        { key: 'applies', label: 'R175-6 applicable', value: 'Non',
          hint: r175_6_applicable.reason || 'Bâtiment hors champ R175-6.' },
      ],
      explanation: r175_6_applicable.reason
        ? `Le bâtiment est hors champ R175-6 : ${r175_6_applicable.reason}.`
        : 'Le bâtiment est hors champ R175-6.',
    };
  }
  if (!Array.isArray(thermal)) return null;
  // R175-6 = régulation de la CHALEUR uniquement : les lignes de
  // refroidissement ne comptent pas dans la couverture de cet article.
  const heating = thermal.filter(t => (t.category || 'heating') !== 'cooling');
  const total = heating.length;
  const woodExempt  = heating.filter(t => isTrue(t.generator_exempt_wood)).length;
  // « Complète » = régulation d'émission saisie OU exemption bois. Union (pas
  // somme) sinon une ligne à la fois régulée et exemptée compterait double et
  // la couverture pouvait dépasser 100 %.
  const complete = heating.filter(t => t.emission_device_id != null || isTrue(t.generator_exempt_wood)).length;
  return {
    kpis: [
      { key: 'thermal_total', label: 'Régulations de chauffage requises', value: total,
        hint: 'Une par système de chauffage (zone × chauffage) présent sur le site.' },
      { key: 'thermal_complete', label: 'Régulations complètes saisies', value: complete },
      ...(woodExempt > 0 ? [{ key: 'thermal_wood_exempt', label: 'Exemptions bois (R175-6 II)', value: woodExempt }] : []),
      { key: 'coverage', label: 'Couverture R175-6', value: pct(complete, total), unit: '%' },
    ],
    explanation: null,
  };
}
function buildEvidence(axis, ctx) {
  switch (axis) {
    case 'r175_2':      return evR175_2(ctx);
    case 'r175_3_1':    return evR175_3_1(ctx);
    case 'r175_3_2':    return evR175_3_2(ctx);
    case 'r175_3_3':    return evR175_3_3(ctx);
    case 'r175_3_4':    return evR175_3_4(ctx);
    case 'r175_3_data': return evR175_3_data(ctx);
    case 'r175_4':      return evR175_4(ctx);
    case 'r175_5':      return evR175_5(ctx);
    case 'r175_5_1':    return evR175_5_1(ctx);
    case 'r175_6':      return evR175_6(ctx);
    default:            return null;
  }
}

/**
 * Calcule la synthèse de conformité.
 *
 * @param {object} args
 * @param {object} args.document — la ligne `documents` (au moins bacs_*)
 * @param {object} args.actionItems — { blocking: [...], major: [...], minor: [...] }
 * @param {Array} args.actionItemsRaw — liste plate des actions numérotées
 * @param {object|null} args.bms — la GTB existante (ou null)
 * @param {object} args.r175_6_applicable — { applies: bool, reason: string }
 * @param {string|null} args.applicabilityLabel — libellé pré-calculé
 * @param {Array} [args.devices] — équipements (pour evidence R175-3 §3/§4)
 * @param {Array} [args.thermal] — lignes régulation thermique (R175-6)
 * @param {Array} [args.inspections] — dernière inspection (R175-4)
 * @param {object} [args.powerSummary] — { effectiveKw, autoHeatKw, autoCoolKw } (R175-2)
 * @param {object} [args.recapStats] — { metersRequired, metersPresent, metersMissing… } (R175-3 §1°)
 * @returns {object} synthèse pour cover + L'essentiel + tableau de bord
 */
function buildComplianceSummary({
  document, actionItems, actionItemsRaw, bms, r175_6_applicable, applicabilityLabel,
  devices, thermal, inspections, powerSummary, recapStats,
}) {
  // actionItems.blocking/major/minor excluent les réserves (actionItems.reserves).
  const blocking = actionItems.blocking?.length || 0;
  const major    = actionItems.major?.length || 0;
  const minor    = actionItems.minor?.length || 0;
  const reserves = actionItems.reserves?.length || 0;

  let verdict = verdictFromActions({ blocking, major });
  if (verdict === 'compliant' && reserves > 0) verdict = 'compliant_reserves';
  // Verdict global "compliant" interdit si la GTB n'a pas été qualifiée.
  // Sans réponse à la question présence GTB, on ne peut pas conclure.
  if ((verdict === 'compliant' || verdict === 'compliant_reserves') && (!bms || bms.present == null)) {
    verdict = 'unknown';
  }

  // 3 actions phares : 3 premières en sévérité descendante (bloquantes
  // d'abord, puis majeures si moins de 3 bloquantes).
  const headlineActions = [
    ...(actionItems.blocking || []),
    ...(actionItems.major || []),
    ...(actionItems.minor || []),
  ].slice(0, 3);

  // Tableau de bord R175 : compte les actions par axe + déduit le verdict
  const actionsByAxis = new Map();
  const addToAxis = (axis, severity, a) => {
    if (!actionsByAxis.has(axis)) actionsByAxis.set(axis, { blocking: 0, major: 0, minor: 0, reserves: 0, items: [] });
    const bucket = actionsByAxis.get(axis);
    bucket[severity] = (bucket[severity] || 0) + 1;
    bucket.items.push(a);
  };
  for (const a of (actionItemsRaw || [])) {
    // Informations (exemption par la règle des 5 %, FAQ n° 16 ; points de
    // vigilance) : pas des écarts — elles ne pèsent sur aucune exigence.
    if (isInfoAction(a)) continue;
    const axis = axisOfArticle(a.r175_article);
    if (!axis) continue;
    // Réserve : comptée à part — l'exigence reste « conforme sous réserve ».
    addToAxis(axis, isReserveAction(a) ? 'reserves' : a.severity, a);
  }

  // Sans GTB sur le site, les exigences qui PORTENT sur la GTB ne peuvent
  // pas être satisfaites — quel que soit le nombre d'actions générées.
  // Si la GTB n'a pas été QUALIFIÉE (bms.present == null), le verdict des
  // axes GTB-dépendants est INCONNU (« à qualifier »), surtout pas
  // « conforme » sous prétexte qu'il n'y a pas d'actions générées.
  const noGtb = !!bms && bms.present === 0;
  const bmsUnanswered = !bms || bms.present == null;
  // GTB présente mais hors service : aucune des fonctions du décret n'est
  // assurée — traitée comme une GTB absente sur les exigences qui en
  // dépendent (hors R175-4, porté par l'action « Remettre en service »).
  const gtbOutOfService = !noGtb && !!bms && isTrue(bms.out_of_service);
  // Le 1° (suivi, enregistrement, analyse, conservation) est une fonction de
  // la GTB : sans GTB, il ne peut pas être satisfait, même si les compteurs
  // sont en place.
  const GTB_DEPENDENT_AXES = new Set([
    'r175_3_1', 'r175_3_2', 'r175_3_3', 'r175_3_4', 'r175_3_data', 'r175_4', 'r175_5',
  ]);
  // Inspection R175-5-1 : elle vise la GTB des bâtiments assujettis à
  // R175-2. « Non applicable » n'est donc juste que pour un bâtiment non
  // assujetti ou sans GTB. Quand l'auditeur a répondu « rien à tracer » sur
  // un bâtiment assujetti équipé d'une GTB (cas légitime : GTB installée il
  // y a moins de 2 ans ; cas fréquent : aucune inspection faite), on ne
  // conclut ni « non applicable » ni « conforme » : « à qualifier ».
  const applicability = document.bacs_applicability_status || null;
  const notSubject = applicability === 'not_subject';
  const inspectionFlagNa = isTrue(document.inspection_not_applicable);
  const inspReason = (document.inspection_not_applicable_reason || '').trim().replace(/\s+\.$/, '.');
  const inspReasonSuffix = inspReason ? ` Précision de l'auditeur : « ${inspReason.replace(/\.$/, '')} ».` : '';

  const r175Dashboard = R175_EXIGENCES.map(ex => {
    const bucket = actionsByAxis.get(ex.axis) || { blocking: 0, major: 0, minor: 0, reserves: 0, items: [] };
    const total = bucket.blocking + bucket.major + bucket.minor + bucket.reserves;
    let v;
    if (ex.axis === 'r175_2') {
      // R175-2 = statut d'assujettissement, pas un verdict
      v = 'info';
    } else if (ex.axis === 'r175_6' && r175_6_applicable?.undetermined) {
      // Une date manque (permis ou travaux sur le générateur) : jamais
      // « non applicable » déduit d'une absence de donnée.
      v = 'unknown';
    } else if (ex.axis === 'r175_6' && r175_6_applicable && !r175_6_applicable.applies) {
      v = 'na';
    } else if (ex.axis === 'r175_5_1' && noGtb) {
      // Sans GTB, il n'y a pas de BACS à inspecter — l'inspection n'a pas
      // d'objet (cohérent avec le generator qui skip l'action no_inspection).
      v = 'na';
    } else if (ex.axis === 'r175_5_1' && notSubject) {
      // Bâtiment non assujetti à R175-2 : pas d'inspection R175-5-1.
      v = 'na';
    } else if (ex.axis === 'r175_5_1' && bmsUnanswered) {
      v = 'unknown';
    } else if (ex.axis === 'r175_5_1' && inspectionFlagNa) {
      // « Rien à tracer » sur un bâtiment assujetti équipé d'une GTB :
      // jamais « conforme » (aucune inspection constatée), jamais « non
      // applicable » (l'obligation existe) → à qualifier. Un motif comme
      // « contrat de maintenance » relève de R175-4 et n'exonère pas de
      // l'inspection R175-5-1.
      // Réserve « Faire réaliser l'inspection » au plan : obligation à
      // respecter, mise en évidence (R3 N-M6).
      v = !applicability ? 'na' : (bucket.reserves > 0 ? 'reserve' : 'unknown');
    } else if (noGtb && GTB_DEPENDENT_AXES.has(ex.axis)) {
      // Pas de GTB → exigence GTB non satisfaite par construction.
      v = 'non_compliant';
    } else if (gtbOutOfService && GTB_DEPENDENT_AXES.has(ex.axis) && ex.axis !== 'r175_5') {
      // GTB hors service → ses fonctions ne sont pas assurées (R175-4 porte
      // l'action bloquante « Remettre en service la GTB »). La formation de
      // l'exploitant (R175-5) reste évaluée sur sa propre question.
      v = 'non_compliant';
    } else if (bmsUnanswered && GTB_DEPENDENT_AXES.has(ex.axis)) {
      // GTB non qualifiée → verdict indéterminable sur cet axe.
      v = 'unknown';
    } else if (
      AXIS_PIVOT_FIELD[ex.axis] && bms && total === 0
      && isUnanswered(bms[AXIS_PIVOT_FIELD[ex.axis]])
    ) {
      // Champ pivot de l'axe non répondu et aucune action → ne pas conclure
      // « conforme » par défaut (le générateur ne crée d'action que sur un
      // « non » explicite). Verdict indéterminé.
      v = 'unknown';
    } else {
      v = verdictFromActions({ blocking: bucket.blocking, major: bucket.major });
      // Exigence d'un seul tenant : un écart majeur la laisse non remplie.
      if (v === 'partial' && SINGLE_REQUIREMENT_AXES.has(ex.axis)) v = 'non_compliant';
      // Mise à disposition des données : ni le gestionnaire ni les
      // exploitants n'y ont accès → rien n'est satisfait (relecture R2 M14).
      if (v === 'partial' && ex.axis === 'r175_3_data' && bms
        && isFalse(bms.data_provision_to_manager) && isFalse(bms.data_provision_to_operators)) v = 'non_compliant';
      if (v === 'compliant' && bucket.reserves > 0) v = 'reserve';
    }
    // Résumé contextualisé selon les saisies (pour donner du sens)
    let contextSummary = ex.summary;
    // R175-2 : on NE remplace PAS le résumé par le statut — le résumé reste
    // « ce que le décret exige » (déterminer l'assujettissement), et le STATUT
    // réel (Assujetti / Non assujetti) est porté par la pilule verdict
    // ci-dessous. Sinon la ligne affiche un statut sous l'intitulé « exigence ».
    if (ex.axis === 'r175_6' && r175_6_applicable?.undetermined) {
      contextSummary = `Applicabilité à confirmer — ${r175_6_applicable.reason}.`;
    } else if (ex.axis === 'r175_6' && r175_6_applicable && !r175_6_applicable.applies) {
      contextSummary = `Non applicable — ${r175_6_applicable.reason}.`;
    } else if (ex.axis === 'r175_5_1' && noGtb) {
      contextSummary = 'Aucune GTB sur le site — pas de système à inspecter.';
    } else if (ex.axis === 'r175_5_1' && notSubject) {
      contextSummary = 'Bâtiment non assujetti au décret BACS — l\'inspection périodique de la GTB ne s\'applique pas.';
    } else if (ex.axis === 'r175_5_1' && inspectionFlagNa && !bmsUnanswered) {
      contextSummary = applicability
        ? `Aucune inspection n'est tracée dans l'audit. Pour ce bâtiment, l'inspection périodique de la GTB est obligatoire : au plus tard le 1er janvier 2025 pour une GTB déjà en place au 8 avril 2023, sinon dans les 2 ans qui suivent son installation, puis au moins tous les 5 ans.${inspReasonSuffix}`
        : `Inspection périodique marquée sans objet par l'auditeur.${inspReasonSuffix}`;
    } else if (noGtb && GTB_DEPENDENT_AXES.has(ex.axis)) {
      contextSummary = 'Aucune GTB sur le site — exigence non satisfaite.';
    } else if (gtbOutOfService && GTB_DEPENDENT_AXES.has(ex.axis) && ex.axis !== 'r175_5') {
      contextSummary = 'GTB hors service — exigence non satisfaite tant qu\'elle n\'est pas remise en service.';
    } else if (bmsUnanswered && (GTB_DEPENDENT_AXES.has(ex.axis) || ex.axis === 'r175_5_1')) {
      contextSummary = 'Présence d\'une GTB non renseignée lors de l\'audit : cette exigence reste à qualifier.';
    } else if (v === 'unknown' && AXIS_PIVOT_FIELD[ex.axis]) {
      contextSummary = `Information non communiquée lors de l'audit : ${AXIS_UNKNOWN_HINT[ex.axis] || 'ce point reste à qualifier'}.`;
    }
    // Lot 1 — evidence par axe : les chiffres-preuve qui ont mené au verdict.
    // Permet au PDF (Lot 4) et aux consommateurs MCP de tracer chaque
    // affirmation R175. `null` si les données nécessaires n'ont pas été
    // fournies (fixtures legacy).
    const evidence = buildEvidence(ex.axis, {
      document, bms, devices, thermal, inspections, powerSummary, recapStats, r175_6_applicable,
    });
    // Lot 4 — Lectures Buildy attachées à l'axe (interprétations Buildy
    // pertinentes pour cet article). Permet au PDF de citer la Lecture
    // sous le verdict (« sur quelle interprétation s'appuie-t-on ? »).
    const buildy_readings = readingsForAxis(ex.axis).map(r => ({
      code: r.code, title: r.title, summary: r.summary,
    }));
    // R175-2 : la pilule verdict porte le STATUT d'assujettissement réel
    // (Assujetti / Non assujetti / Assujetti · 2030) au lieu du générique
    // « Statut » — c'est le « où en est le site » de la ligne.
    let verdictLabel = VERDICT_LABEL[v];
    if (ex.axis === 'r175_2') {
      const st = document.bacs_applicability_status;
      verdictLabel =
        (st === 'subject_immediate' || st === 'subject_2025') ? 'Assujetti'
        : st === 'subject_2030' ? 'Assujetti (au plus tard 2030)'
        : st === 'not_subject' ? 'Non assujetti'
        : 'À déterminer';
    }
    // Inspection encore à faire réaliser : obligation du propriétaire, pas
    // un constat « conforme ».
    if (ex.axis === 'r175_5_1' && v === 'reserve') verdictLabel = 'Inspection à faire réaliser';
    return {
      code: ex.code,
      displayCode: ex.displayCode || ex.code,
      axis: ex.axis,
      label: ex.label,
      // `summary` = toujours « ce que le décret exige » ; `note` = constat
      // propre au site (non applicable, à qualifier, sans GTB…) quand il
      // diffère — jamais imprimé sous l'intitulé « Ce que le décret exige ».
      summary: ex.summary,
      note: contextSummary !== ex.summary ? contextSummary : null,
      verdict: v,
      verdictLabel,
      // Inspection à faire réaliser : pas de coche « conforme ».
      verdictIcon: ex.axis === 'r175_5_1' && v === 'reserve' ? '!' : VERDICT_ICON[v],
      actionsCount: total,
      actionsBlocking: bucket.blocking,
      actionsMajor: bucket.major,
      actionsMinor: bucket.minor,
      actionsReserves: bucket.reserves,
      evidence,
      buildy_readings,
    };
  });

  // Verdict global : ajustements qui ne découlent pas des seules actions.
  //  - Bâtiment non assujetti : les obligations R175-2 à R175-5-1 ne
  //    s'appliquent pas (seule la régulation R175-6 reste évaluée) — jamais
  //    « conforme » ni « non conforme » au décret sur ces points.
  //  - « Conforme » alors qu'une exigence reste à qualifier : la conformité
  //    ne peut pas être confirmée → non déterminée.
  let verdictReason = null;
  if (notSubject && verdict !== 'non_compliant' && verdict !== 'partial') {
    verdict = 'not_subject';
  } else if (verdict === 'unknown') {
    verdictReason = 'gtb_unanswered';
  } else if ((verdict === 'compliant' || verdict === 'compliant_reserves')
    && r175Dashboard.some(r => r.verdict === 'unknown')) {
    verdict = 'unknown';
    verdictReason = 'axes_unknown';
  }
  const plural = (n, one, many) => (n === 1 ? one : many);
  const deadline2030 = applicability === 'subject_2030'
    ? ' Obligation applicable lors du renouvellement du système de chauffage ou de climatisation, et au plus tard le 1er janvier 2030.'
    : '';
  const kw = powerSummary?.effectiveKw ?? document.bacs_total_power_kw;
  // Les mineures, affichées dans les tuiles de L'essentiel, sont citées pour
  // que la somme des tuiles ne contredise pas la phrase du verdict.
  const minorNote = minor > 0
    ? ` ${minor} action${plural(minor, '', 's')} mineure${plural(minor, '', 's')} ${plural(minor, 'complète', 'complètent')} le plan.`
    : '';
  const verdictHeadline = {
    compliant: 'Conforme au décret BACS',
    compliant_reserves: 'Conforme au décret BACS, sous réserves',
    partial: 'Partiellement conforme au décret BACS',
    non_compliant: 'Non conforme au décret BACS',
    unknown: 'Conformité au décret BACS non déterminée',
    not_subject: 'Bâtiment non assujetti au décret BACS',
  }[verdict];
  const verdictDetail = {
    // Les majeures empêchent aussi la conformité (annexe B) : on les compte
    // avec les bloquantes (relecture clarté R2 m13).
    non_compliant: major > 0
      ? `${blocking + major} actions sont à traiter pour atteindre la conformité au décret, dont ${blocking} bloquante${plural(blocking, '', 's')}.${minorNote}${deadline2030}`
      : `${blocking} action${plural(blocking, '', 's')} bloquante${plural(blocking, '', 's')} ${plural(blocking, 'est', 'sont')} à traiter pour atteindre la conformité au décret.${minorNote}${deadline2030}`,
    partial: `${major} action${plural(major, '', 's')} majeure${plural(major, '', 's')} ${plural(major, 'reste', 'restent')} à traiter pour atteindre la conformité complète.${minorNote}${deadline2030}`,
    compliant_reserves: 'Aucune action bloquante ni majeure : le site est conforme au décret BACS, sous réserve de respecter les obligations suivantes :',
    compliant: 'Aucune action bloquante ni majeure identifiée sur les points examinés.',
    unknown: verdictReason === 'axes_unknown'
      ? 'Aucune action bloquante ni majeure identifiée, mais certaines exigences restent à qualifier (voir le tableau de bord) : la conformité ne peut pas être confirmée à ce stade.'
      : 'La présence d\'une GTB sur le site n\'a pas été renseignée : la conformité au décret ne peut pas être établie à ce stade.',
    not_subject: `La puissance retenue${kw != null ? ` (${String(kw).replace('.', ',')} kW)` : ''} ne dépasse pas 70 kW : les obligations des articles R175-2 à R175-5-1 ne s'appliquent pas. La régulation automatique du chauffage (R175-6), qui ne dépend pas de ce seuil, reste évaluée.`,
  }[verdict];

  return {
    verdict,
    verdictLabel: GLOBAL_VERDICT_LABEL[verdict],
    verdictIcon: VERDICT_ICON[verdict],
    verdictHeadline,
    verdictDetail,
    stats: { blocking, major, minor, reserves, total: blocking + major + minor + reserves },
    // Réserves listées en tête du rapport (« Conforme sous réserves de… »).
    reservesList: (actionItems.reserves || []).map(a => ({
      title: a.title_plain || a.title, article: a.r175_article, number: a.display_number || null,
    })),
    headlineActions,
    assujettissement: buildAssujettissement(document, powerSummary),
    r175Dashboard,
    // Pour générer une accroche cover concise
    deadlineCallout: applicabilityLabel || null,
  };
}

/**
 * @deprecated kind 'site_audit' supprimé (mig 106). Conservé pour
 * éviter de casser un import externe pendant la transition. Toute
 * nouvelle synthèse passe par buildComplianceSummary.
 */
const COVERAGE_LABEL = {
  compliant:     'Couverture étendue',
  partial:       'Couverture partielle',
  non_compliant: 'Couverture insuffisante',
};
function buildClassiqueSummary({ document, actionItems, actionItemsRaw, devices = [], bms }) {
  const blocking = actionItems.blocking?.length || 0;
  const major    = actionItems.major?.length || 0;
  const minor    = actionItems.minor?.length || 0;

  // Verdict couverture GTB. Utilise isTrue strict (centralisé via _ternary.js)
  // pour ne PAS collapser `null` (non répondu) en `false` dans le décompte
  // « intégrés GTB ».
  const presentDevices = devices.filter(d => !d.out_of_service);
  const integratedDevices = presentDevices.filter(d => isTrue(d.managed_by_bms));
  const ratio = presentDevices.length ? integratedDevices.length / presentDevices.length : 0;
  let verdict;
  if (!bms || bms.out_of_service) verdict = 'non_compliant';
  else if (ratio >= 0.80) verdict = 'compliant';
  else if (ratio >= 0.30) verdict = 'partial';
  else verdict = 'non_compliant';

  const headlineActions = [
    ...(actionItems.blocking || []),
    ...(actionItems.major || []),
    ...(actionItems.minor || []),
  ].slice(0, 3);

  return {
    verdict,
    verdictLabel: COVERAGE_LABEL[verdict] || VERDICT_LABEL[verdict],
    verdictIcon: VERDICT_ICON[verdict],
    stats: { blocking, major, minor, total: blocking + major + minor },
    headlineActions,
    coverage: {
      integrated: integratedDevices.length,
      present: presentDevices.length,
      ratio: Math.round(ratio * 100),
    },
    // Pas de assujettissement R175-2 ni de r175Dashboard en classique.
    assujettissement: null,
    r175Dashboard: null,
  };
}

module.exports = {
  buildComplianceSummary,
  buildClassiqueSummary,
  R175_EXIGENCES,
  VERDICT_LABEL,
  VERDICT_ICON,
  COVERAGE_LABEL,
  RESERVE_SUBTYPES,
  isReserveAction,
  INFO_SUBTYPES,
  isInfoAction,
  axisOfArticle,
  frLongDate,
};
