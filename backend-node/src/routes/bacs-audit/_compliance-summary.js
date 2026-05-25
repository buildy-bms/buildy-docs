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

const { isTrue } = require('./_ternary');

// Mapping exigence R175 → libellé court grand public + référence article
// pour le tableau de bord. La liste est volontairement courte et tenue.
const R175_EXIGENCES = [
  { code: 'R175-2',                axis: 'r175_2',     label: 'Assujettissement du bâtiment',
    summary: 'Le bâtiment relève-t-il du décret BACS et à quelle échéance ?' },
  { code: 'R175-3 1°',             axis: 'r175_3_1',   label: 'Suivi continu pas horaire',
    summary: 'Toutes les consommations énergétiques sont mesurées et archivées 5 ans.' },
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
  { code: 'R175-6',                axis: 'r175_6',     label: 'Régulation thermique automatique',
    summary: 'Chaque zone dispose d\'une régulation thermique adaptée.' },
];

// Mappe l'article R175 brut d'une action vers l'axe du tableau de bord.
// Exemples : 'R175-3 1°' → 'r175_3_1', 'R175-3 dernier alinéa' → 'r175_3_data'.
function axisOfArticle(article) {
  if (!article) return null;
  const a = String(article).trim();
  if (/^R175-?2/i.test(a)) return 'r175_2';
  if (/R175-?3.*1°/i.test(a) || /R175-?3.*§\s*1/i.test(a)) return 'r175_3_1';
  if (/R175-?3.*3°/i.test(a) || /R175-?3.*§\s*3/i.test(a)) return 'r175_3_3';
  if (/R175-?3.*4°/i.test(a) || /R175-?3.*§\s*4/i.test(a)) return 'r175_3_4';
  if (/R175-?3.*(dernier|alin|donn)/i.test(a)) return 'r175_3_data';
  if (/R175-?3.*(§\s*2|§\s*P2)/i.test(a)) return 'r175_3_1'; // P2 anomalies → assimilé suivi
  if (/R175-?3/i.test(a)) return 'r175_3_1';                  // R175-3 nu = 1° par défaut
  if (/R175-?4/i.test(a)) return 'r175_4';
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
 * @returns {object} synthèse pour cover + L'essentiel + tableau de bord
 */
function buildComplianceSummary({
  document, actionItems, actionItemsRaw, bms, r175_6_applicable, applicabilityLabel,
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
    'r175_3_3', 'r175_3_4', 'r175_3_data', 'r175_4', 'r175_5',
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
    } else if (noGtb && GTB_DEPENDENT_AXES.has(ex.axis)) {
      contextSummary = 'Aucune GTB sur le site — exigence non satisfaite.';
    } else if (bmsUnanswered && GTB_DEPENDENT_AXES.has(ex.axis)) {
      contextSummary = 'GTB non renseignée — verdict non calculable tant que la question n\'est pas répondue.';
    }
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
