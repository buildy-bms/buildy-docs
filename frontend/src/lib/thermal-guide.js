// Étape Régulation, mise en page « Nouvelle » : verdict de chaque système (circuit production →
// distribution → émission) et ce qui reste à faire. Logique pure (testée :
// backend-node/test/thermal-guide.test.mjs). Mêmes règles que le plan d'actions
// (backend lib/bacs-audit-action-generator.js, R175-6) :
//  - conformité jugée sur l'ÉMISSION : régulation par pièce ou par zone ; centralisée = non conforme ;
//  - émetteur relié mais régulation non renseignée (ni granularité, ni type, ni « pas de
//    régulation ») : pas de conclusion (« à préciser ») ;
//  - le froid est décrit mais pas évalué ; un appareil indépendant au bois est dispensé.
// « À compléter » (missing) = un émetteur par système ; « sans réponse » (unanswered) = équipement
// de production ou type de régulation à préciser. Les deux bloquent la validation de l'étape
// (décision de Kévin, 14/10 : toute question affichée a sa réponse, comme à l'étape Systèmes).
// Imports relatifs uniquement (testable sous Node).
import { resolveGranularity } from './audit-options.js';

export const THERMAL_LEVELS = ['production', 'distribution', 'emission'];
const LEVEL_LABEL = { production: 'production', distribution: 'distribution', emission: 'émission' };
const COMPLIANT = new Set(['per_room', 'per_zone']);

const isTrue = (v) => v === 1 || v === true;
const isFalse = (v) => v === 0 || v === false;

/**
 * @param {object} row ligne bacs_audit_thermal_regulation ({ category, emission_device_id, generator_exempt_wood })
 * @param {object} ctx { devices: { production, distribution, emission } (équipement ou null),
 *   granularity: clé résolue de l'émetteur (saisie, sinon déduite du type), woodExempt: dispense bois déduite }
 * @returns {{ missing: string[], unanswered: string[], verdict: { tone, text }, state: 'todo'|'ko'|'open'|'done' }}
 */
export function thermalRowGuide(row, ctx = {}) {
  const category = row?.category || 'heating';
  const devices = ctx.devices || {};
  const wood = !!ctx.woodExempt || isTrue(row?.generator_exempt_wood);
  const missing = [];
  const unanswered = [];
  const emitter = devices.emission || null;
  if (!row?.emission_device_id && !wood) missing.push('émetteur');
  if (!devices.production && !wood) unanswered.push('équipement de production');
  for (const level of THERMAL_LEVELS) {
    const d = devices[level];
    if (d && !d[`regulation_type_${level}`]) unanswered.push(`type de régulation (${LEVEL_LABEL[level]})`);
  }

  let verdict;
  if (wood) verdict = { tone: 'green', text: 'Dispensé : chauffage au bois' };
  else if (missing.length) verdict = { tone: 'amber', text: 'Émetteur à indiquer' };
  else if (category === 'cooling') verdict = { tone: 'slate', text: 'Froid non évalué' };
  else if (emitter && !emitter.regulation_granularity && !emitter.regulation_type_emission && !isFalse(emitter.has_regulation)) {
    verdict = { tone: 'amber', text: 'Régulation de l’émetteur à préciser' };
  } else if (COMPLIANT.has(ctx.granularity)) {
    verdict = { tone: 'green', text: ctx.granularity === 'per_room' ? 'Par pièce' : 'Par zone' };
  } else if (ctx.granularity === 'central_only' || !ctx.granularity) {
    verdict = { tone: 'red', text: 'Centralisée : non conforme' };
  } else {
    verdict = { tone: 'slate', text: 'Granularité à vérifier' };
  }
  const state = missing.length ? 'todo' : verdict.tone === 'red' ? 'ko' : (unanswered.length || verdict.tone === 'amber') ? 'open' : 'done';
  return { missing, unanswered, verdict, state };
}

// Équipement désigné à chaque niveau d'une ligne (colonnes de bacs_audit_thermal_regulation).
export const LEVEL_DEVICE_FIELD = {
  production: 'generator_device_id',
  distribution: 'distribution_device_id',
  emission: 'emission_device_id',
};

/**
 * Guide d'une ligne à partir des équipements de son système : même recherche que l'étape Régulation
 * (équipement de chaque niveau, granularité de l'émetteur, dispense bois du générateur). Sert à
 * l'étape (verdicts) et à la règle de validation de la vue (questions sans réponse).
 * @param {object} row ligne bacs_audit_thermal_regulation
 * @param {Array} devs équipements du système de la ligne
 */
export function thermalGuideForRow(row, devs) {
  const list = devs || [];
  const find = (id) => (id ? list.find(d => d.id === id) || null : null);
  const devices = Object.fromEntries(THERMAL_LEVELS.map(l => [l, find(row?.[LEVEL_DEVICE_FIELD[l]])]));
  return thermalRowGuide(row, {
    devices,
    granularity: resolveGranularity(devices.emission),
    woodExempt: !!row?.generator_device_id && devices.production?.energy_source === 'wood',
  });
}

/** Totaux d'une liste de lignes (zone ou étape) : systèmes, à compléter, non conformes, à préciser. */
export function thermalTotals(guides) {
  const list = guides || [];
  return {
    count: list.length,
    todo: list.filter(g => g.state === 'todo').length,
    ko: list.filter(g => g.state === 'ko').length,
    open: list.filter(g => g.state === 'open').length,
  };
}
