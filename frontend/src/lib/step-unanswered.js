// Questions affichées restées sans réponse qui bloquent la validation des étapes de l'audit
// (décision de Kévin, 14/10 : comme à l'étape Systèmes, toute question affichée a sa réponse).
// Une fonction par étape, à partir des données de l'audit : lignes « Reste à faire » du bandeau
// (STEP_DEFINITIONS de BacsAuditDetailView), dans les deux mises en page. Les étapes affichent les
// mêmes états avec les mêmes fonctions (guides de lib/*-guide.js). Le verrou serveur
// (lib/bacs-audit-step-completion.js) reste plus large, comme pour l'étape Systèmes.
// Ne bloquent pas (cadre « Encore à renseigner ») : préconisations du plan, étapes pas encore
// validées avant la synthèse, inspection gardée malgré un « Non » — ce ne sont pas des questions.
// Imports relatifs uniquement (testable sous Node : backend-node/test/step-unanswered.test.mjs).
import { identificationRubrics } from './identification-guide.js';
import { zoneMissing } from './zones-guide.js';
import { thermalGuideForRow } from './thermal-guide.js';
import { isMeterUnanswered } from './meter-plan-state.js';
import { bmsStepRubrics } from './bms-guide.js';
import {
  IDENT_OWNERSHIP_REASON, zonesNote, thermalOpenNote, metersTodoNote, bmsUnansweredReasons,
  inspectionsUndatedNote,
} from './audit-tips-guided.js';

/** Identification (audit BACS, site rattaché) : structure de propriété du site. */
export function identificationUnansweredReasons(doc, { isBacs, hasSite, structureLabel } = {}) {
  if (!isBacs) return [];
  const parties = identificationRubrics(doc, { hasSite, structureLabel }).find(r => r.key === 'parties');
  return parties?.unanswered.length ? [IDENT_OWNERSHIP_REASON] : [];
}

/** Zones : nature ; pour une zone fonctionnelle, aussi régime d'activité et surface. */
export function zonesUnansweredReasons(zones) {
  const n = (zones || []).filter(z => zoneMissing(z).length).length;
  return n ? [zonesNote(n)] : [];
}

/**
 * Régulation : guide de chaque ligne (émetteur manquant = `missing` ; équipement de production ou
 * type de régulation sans réponse = `unanswered`).
 * @param {Array} rows lignes affichées (systèmes chauffage / froid présents, zones techniques exclues)
 * @param {(row) => Array} devicesOfRow équipements du système de la ligne
 * @returns {{ missingRows: Array, openCount: number, reasons: string[] }}
 */
export function thermalStepTodo(rows, devicesOfRow) {
  const missingRows = [];
  let openCount = 0;
  for (const t of rows || []) {
    const g = thermalGuideForRow(t, devicesOfRow(t));
    if (g.missing.length) missingRows.push(t);
    else if (g.unanswered.length) openCount++;
  }
  return { missingRows, openCount, reasons: openCount ? [thermalOpenNote(openCount)] : [] };
}

/** Compteurs : compteurs attendus sans réponse à « Présent ? » (même décompte que le plan). */
export function metersUnansweredReasons(meters, planStatus) {
  const n = (meters || []).filter(m => isMeterUnanswered(m, planStatus)).length;
  return n ? [metersTodoNote(n)] : [];
}

/** GTB : questions sans réponse des rubriques (rubriques facultatives exclues, GTB hors service). */
export function bmsUnansweredReasonsFor(bms, ctx = {}) {
  if (bms?.present !== 1) return [];
  return bmsUnansweredReasons(bmsStepRubrics(bms, ctx));
}

/**
 * Inspections : inspections sans date autres que la plus récente (celle-ci est déjà exigée par la
 * règle de l'étape). Rien quand la réponse est « Non ».
 */
export function inspectionsUnansweredReasons(inspections, notApplicable) {
  if (notApplicable) return [];
  const n = (inspections || []).slice(1).filter(i => !i.last_inspection_date).length;
  return n ? [inspectionsUndatedNote(n)] : [];
}
