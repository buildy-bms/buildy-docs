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

const { isTrue, isFalse } = require('./_ternary');
const { readingsForAxis } = require('../../lib/bacs-buildy-readings');

// Mapping exigence R175 → libellé court grand public + référence article
// pour le tableau de bord. La liste est volontairement courte et tenue.
const R175_EXIGENCES = [
  { code: 'R175-2',                axis: 'r175_2',     label: 'Assujettissement du bâtiment',
    summary: 'Le bâtiment relève-t-il du décret BACS et à quelle échéance ?' },
  { code: 'R175-3 1°',             axis: 'r175_3_1',   label: 'Suivi continu pas horaire',
    summary: 'Toutes les consommations énergétiques sont mesurées et archivées 5 ans.' },
  { code: 'R175-3 2°',             axis: 'r175_3_2',   label: 'Détection des pertes d\'efficacité',
    summary: 'La GTB compare aux valeurs de référence et signale les dérives de consommation.' },
  { code: 'R175-3 3°',             axis: 'r175_3_3',   label: 'Interopérabilité des systèmes',
    summary: 'Tous les équipements communiquent avec la GTB de supervision.' },
  { code: 'R175-3 4°',             axis: 'r175_3_4',   label: 'Arrêt manuel et autonome',
    summary: 'Chaque équipement peut être arrêté manuellement et fonctionne en autonome.' },
  { code: 'R175-3 D.A.',           axis: 'r175_3_data', label: 'Mise à disposition des données',
    summary: 'Dernier alinéa — les données sont transmises au gestionnaire et aux exploitants.' },
  { code: 'R175-4',                axis: 'r175_4',     label: 'Vérifications périodiques',
    summary: 'Une procédure de maintenance écrite est en place et appliquée.' },
  { code: 'R175-5',                axis: 'r175_5',     label: 'Formation de l\'exploitant',
    summary: 'L\'exploitant est formé au paramétrage et au pilotage.' },
  { code: 'R175-5-1',              axis: 'r175_5_1',   label: 'Inspection périodique par un tiers',
    summary: 'Une inspection indépendante du BACS est réalisée et son rapport conservé 10 ans.' },
  { code: 'R175-6',                axis: 'r175_6',     label: 'Régulation thermique automatique',
    summary: 'Chaque système thermique (chauffage / refroidissement) dispose d\'une régulation déclarée.' },
];

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

function verdictFromActions({ blocking, major }) {
  if (blocking > 0) return 'non_compliant';
  if (major > 0)    return 'partial';
  return 'compliant';
}

const VERDICT_LABEL = {
  compliant:     'Conforme',
  partial:       'Partiellement conforme',
  non_compliant: 'Non conforme',
  na:            'Non applicable',
  unknown:       'À qualifier',
  info:          'Statut',
};

const VERDICT_ICON = {
  compliant: '✓', partial: '⚠', non_compliant: '✗', na: '–', unknown: '?', info: 'i',
};

// Calcul d'assujettissement R175-2 : déroulé en 3 lignes (puissance + PC + seuil)
// pour la page « L'essentiel ». Seuils du décret : 70 kW (échéance 2030, report
// acté au JO du 26 décembre 2025), 290 kW (2025).
function buildAssujettissement(document) {
  const power = document.bacs_total_power_kw || 0;
  const pcDate = document.bacs_building_permit_date || null;
  const status = document.bacs_applicability_status || null;
  let conclusion;
  switch (status) {
    case 'subject_immediate': conclusion = 'Bâtiment > 290 kW déjà existant — assujetti immédiatement.'; break;
    case 'subject_2025':      conclusion = 'Puissance > 290 kW — assujetti au 1ᵉʳ janvier 2025.'; break;
    case 'subject_2030':      conclusion = 'Puissance entre 70 et 290 kW — assujetti au 1ᵉʳ janvier 2030.'; break;
    case 'not_subject':       conclusion = 'Puissance < 70 kW — non assujetti au décret BACS.'; break;
    default:                  conclusion = 'Statut d\'assujettissement non renseigné.';
  }
  const determined = !!status;
  const threshold = status === 'subject_2030' ? 70 : 290;
  return {
    powerKw: power,
    pcDate,
    pcDateLabel: pcDate ? new Date(pcDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null,
    threshold,
    // Tant que le statut n'est pas renseigné, on n'affiche pas un seuil
    // unique trompeur : les deux seuils du décret coexistent.
    determined,
    thresholdLabel: determined ? `${threshold} kW` : '70 kW (2030) ou 290 kW (2025)',
    status,
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
  const threshold = status === 'subject_2030' ? 70 : 290;
  const kpis = [
    { key: 'cumul_retained', label: 'Puissance retenue', value: power, unit: 'kW',
      hint: 'Cumul chaud + froid (max retenu si réversible), équipements de secours et bois exclus.' },
    { key: 'threshold', label: 'Seuil applicable', value: status ? threshold : null, unit: 'kW',
      hint: status === 'subject_2030' ? 'Seuil R175-2 §1 b) — échéance 1ᵉʳ janvier 2030.'
        : status === 'subject_2025' || status === 'subject_immediate' ? 'Seuil R175-2 §1 a) — échéance 1ᵉʳ janvier 2025.'
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
        hint: 'Compteurs exigés par le décret pour suivre les consommations.' },
      { key: 'meters_present',  label: 'Compteurs présents sur site', value: present },
      { key: 'meters_missing',  label: 'Compteurs requis mais absents', value: missing,
        hint: 'Manque à combler dans le plan d\'action pour atteindre R175-3 §1°.' },
      ...(coverage != null ? [{ key: 'coverage', label: 'Couverture comptage', value: coverage, unit: '%' }] : []),
    ],
    explanation: missing === 0 && req > 0
      ? 'Tous les compteurs R175-3 §1° requis sont présents sur le site.'
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
        hint: 'Doivent être raccordés à la GTB pour respecter R175-3 §3.' },
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
      { key: 'arret_manuel_ok', label: 'Arrêt manuel possible', value: arret_ok,
        hint: 'Équipements pour lesquels l\'auditeur a confirmé un arrêt manuel sur place.' },
      ...(arret_ko > 0 ? [{ key: 'arret_manuel_ko', label: 'Arrêt manuel impossible', value: arret_ko }] : []),
      ...(arret_unanswered > 0 ? [{ key: 'arret_manuel_unanswered', label: 'Arrêt manuel non renseigné', value: arret_unanswered }] : []),
      { key: 'auto_ok', label: 'Redémarrage autonome', value: auto_ok,
        hint: 'Équipements qui repartent seuls après coupure réseau ou redémarrage GTB.' },
      ...(auto_ko > 0 ? [{ key: 'auto_ko', label: 'Redémarrage manuel uniquement', value: auto_ko }] : []),
      ...(auto_unanswered > 0 ? [{ key: 'auto_unanswered', label: 'Redémarrage non renseigné', value: auto_unanswered }] : []),
    ],
    explanation: null,
  };
}
function evR175_3_data({ bms }) {
  if (!bms) return { kpis: [], explanation: 'GTB non encore qualifiée — verdict indéterminable.' };
  return {
    kpis: [
      { key: 'bms_present', label: 'GTB présente sur le site', value: isTrue(bms.present) ? 'Oui' : isFalse(bms.present) ? 'Non' : 'Non renseigné' },
      { key: 'bms_meets_p2', label: 'Mise à disposition des données (R175-3 dernier alinéa)',
        value: isTrue(bms.meets_r175_3_p2) ? 'Oui' : isFalse(bms.meets_r175_3_p2) ? 'Non' : 'Non renseigné' },
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
        hint: 'Le décret impose une inspection périodique du BACS par un tiers indépendant, rapport conservé 10 ans.' }],
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
  if (r175_6_applicable && !r175_6_applicable.applies) {
    return {
      kpis: [
        { key: 'applies', label: 'R175-6 applicable', value: 'Non',
          hint: r175_6_applicable.reason || 'Bâtiment hors champ R175-6.' },
      ],
      explanation: 'Le bâtiment est hors champ R175-6 (permis de construire et travaux générateurs antérieurs au 21/07/2021).',
    };
  }
  if (!Array.isArray(thermal)) return null;
  const total = thermal.length;
  const withEmission = thermal.filter(t => t.emission_device_id != null).length;
  const woodExempt  = thermal.filter(t => isTrue(t.generator_exempt_wood)).length;
  const complete    = withEmission + woodExempt;
  return {
    kpis: [
      { key: 'thermal_total', label: 'Régulations thermiques requises', value: total,
        hint: 'Une par couple (zone × catégorie chauffage/refroidissement) attendu sur le site.' },
      { key: 'thermal_complete', label: 'Régulations complètes saisies', value: complete },
      ...(woodExempt > 0 ? [{ key: 'thermal_wood_exempt', label: 'Exemptions bois (R175-6 §3)', value: woodExempt }] : []),
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
  const blocking = actionItems.blocking?.length || 0;
  const major    = actionItems.major?.length || 0;
  const minor    = actionItems.minor?.length || 0;

  let verdict = verdictFromActions({ blocking, major });
  // Verdict global "compliant" interdit si la GTB n'a pas été qualifiée.
  // Sans réponse à la question présence GTB, on ne peut pas conclure.
  if (verdict === 'compliant' && (!bms || bms.present == null)) {
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
  for (const a of (actionItemsRaw || [])) {
    const axis = axisOfArticle(a.r175_article);
    if (!axis) continue;
    if (!actionsByAxis.has(axis)) actionsByAxis.set(axis, { blocking: 0, major: 0, minor: 0, items: [] });
    const bucket = actionsByAxis.get(axis);
    bucket[a.severity] = (bucket[a.severity] || 0) + 1;
    bucket.items.push(a);
  }

  // Sans GTB sur le site, les exigences qui PORTENT sur la GTB ne peuvent
  // pas être satisfaites — quel que soit le nombre d'actions générées.
  // Si la GTB n'a pas été QUALIFIÉE (bms.present == null), le verdict des
  // axes GTB-dépendants est INCONNU (« à qualifier »), surtout pas
  // « conforme » sous prétexte qu'il n'y a pas d'actions générées.
  const noGtb = !!bms && bms.present === 0;
  const bmsUnanswered = !bms || bms.present == null;
  const GTB_DEPENDENT_AXES = new Set([
    'r175_3_2', 'r175_3_3', 'r175_3_4', 'r175_3_data', 'r175_4', 'r175_5',
  ]);

  const r175Dashboard = R175_EXIGENCES.map(ex => {
    const bucket = actionsByAxis.get(ex.axis) || { blocking: 0, major: 0, minor: 0, items: [] };
    const total = bucket.blocking + bucket.major + bucket.minor;
    let v;
    if (ex.axis === 'r175_2') {
      // R175-2 = statut d'assujettissement, pas un verdict
      v = 'info';
    } else if (ex.axis === 'r175_6' && r175_6_applicable && !r175_6_applicable.applies) {
      v = 'na';
    } else if (ex.axis === 'r175_5_1' && noGtb) {
      // Sans GTB, il n'y a pas de BACS à inspecter — l'inspection n'a pas
      // d'objet (cohérent avec le generator qui skip l'action no_inspection).
      v = 'na';
    } else if (ex.axis === 'r175_5_1' && bmsUnanswered) {
      v = 'unknown';
    } else if (noGtb && GTB_DEPENDENT_AXES.has(ex.axis)) {
      // Pas de GTB → exigence GTB non satisfaite par construction.
      v = 'non_compliant';
    } else if (bmsUnanswered && GTB_DEPENDENT_AXES.has(ex.axis)) {
      // GTB non qualifiée → verdict indéterminable sur cet axe.
      v = 'unknown';
    } else {
      v = verdictFromActions({ blocking: bucket.blocking, major: bucket.major });
    }
    // Résumé contextualisé selon les saisies (pour donner du sens)
    let contextSummary = ex.summary;
    if (ex.axis === 'r175_2' && applicabilityLabel) {
      contextSummary = applicabilityLabel;
    } else if (ex.axis === 'r175_6' && r175_6_applicable && !r175_6_applicable.applies) {
      contextSummary = `Non applicable — ${r175_6_applicable.reason}.`;
    } else if (ex.axis === 'r175_5_1' && noGtb) {
      contextSummary = 'Aucune GTB sur le site — pas de BACS à inspecter.';
    } else if (noGtb && GTB_DEPENDENT_AXES.has(ex.axis)) {
      contextSummary = 'Aucune GTB sur le site — exigence non satisfaite.';
    } else if (bmsUnanswered && (GTB_DEPENDENT_AXES.has(ex.axis) || ex.axis === 'r175_5_1')) {
      contextSummary = 'GTB non renseignée — verdict non calculable tant que la question n\'est pas répondue.';
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
    return {
      code: ex.code,
      axis: ex.axis,
      label: ex.label,
      summary: contextSummary,
      verdict: v,
      verdictLabel: VERDICT_LABEL[v],
      verdictIcon: VERDICT_ICON[v],
      actionsCount: total,
      actionsBlocking: bucket.blocking,
      actionsMajor: bucket.major,
      actionsMinor: bucket.minor,
      evidence,
      buildy_readings,
    };
  });

  return {
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    verdictIcon: VERDICT_ICON[verdict],
    stats: { blocking, major, minor, total: blocking + major + minor },
    headlineActions,
    assujettissement: buildAssujettissement(document),
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
};
