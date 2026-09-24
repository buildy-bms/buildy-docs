// Interopérabilité R175-3 §3 — source UNIQUE de la logique de communication et
// de raccordement d'un équipement, partagée par le générateur d'actions
// (lib/bacs-audit-action-generator.js) et le calcul de conformité par système
// (_export-data.js computeSystemCompliance).
//
// Avant cette extraction, computeSystemCompliance lisait une colonne
// `meets_r175_3_p3` inexistante sur bacs_audit_system_devices (elle n'existe
// qu'au niveau système, plus saisie depuis la mig 42) : le verdict « Conforme »
// était structurellement inatteignable et le motif §3° ne pouvait jamais
// apparaître. On dérive désormais l'interopérabilité des champs réellement
// saisis (protocoles + raccordement), exactement comme le générateur.

const { isTrue, isFalse } = require('./_ternary');

// Protocoles de communication actifs d'un équipement (hors « non communicant »).
// Tolère les deux formes : chaîne JSON (colonne DB) OU tableau déjà
// désérialisé (payload /full lu par le MCP).
function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function deviceProtocols(d) {
  let arr = parseJsonArray(d.communication_protocols);
  const legacy = d.communication_protocol
    && d.communication_protocol !== 'non_communicant'
    && d.communication_protocol !== 'absent';
  if (!arr.length && legacy) arr = [d.communication_protocol];
  return arr.filter(p => p && p !== 'non_communicant' && p !== 'absent');
}

function deviceRoleArr(d) {
  return parseJsonArray(d.device_role);
}

// Un équipement est « pertinent pour l'interopérabilité du système » s'il
// produit, distribue ou régule l'énergie du système. Exclus du critère
// R175-3 3° (aucune obligation du décret de les rendre communicants) : les
// émetteurs purs (radiateur, ventilo-convecteur passif) et les émetteurs à
// régulation locale autonome (robinet thermostatique, thermostat intégré).
function isInteropRelevant(d) {
  const roles = deviceRoleArr(d);
  if (roles.includes('production') || roles.includes('distribution')) return true;
  if (!roles.includes('regulation')) return false;
  const autonomousEmitter = roles.includes('emission')
    && (isTrue(d.regulation_integrated) || d.regulation_type_emission === 'vanne_thermostatique');
  return !autonomousEmitter;
}

// Équipements pertinents d'un système. Chauffage et climatisation : ceux qui
// produisent, distribuent ou régulent (isInteropRelevant). Autres systèmes
// (éclairage, ventilation, eau chaude sanitaire, production d'électricité) :
// quand aucun équipement n'a l'un de ces rôles, ce sont les équipements
// eux-mêmes (luminaires, VMC…) qui constituent le système à relier.
const THERMAL_CATEGORIES = new Set(['heating', 'cooling']);
function interopRelevantDevices(activeDevices, category) {
  // Équipement déclaré « non concerné par l'intégration à la GTB » par
  // l'auditeur (gtb_scope_override = 0) : écarté de l'évaluation.
  const list = (activeDevices || []).filter(d => !isFalse(d.gtb_scope_override));
  const relevant = list.filter(isInteropRelevant);
  if (relevant.length || !category || THERMAL_CATEGORIES.has(category)) return relevant;
  return list.slice();
}

// Communication de l'équipement : 'yes' (protocole saisi ou « communicant »),
// 'no' (« non communicant » explicite), null (non renseigné).
function deviceCommState(d) {
  if (deviceProtocols(d).length > 0 || isTrue(d.is_communicating)) return 'yes';
  const raw = parseJsonArray(d.communication_protocols);
  const explicitNo = isFalse(d.is_communicating)
    || raw.some(p => p === 'non_communicant' || p === 'absent')
    || d.communication_protocol === 'non_communicant' || d.communication_protocol === 'absent';
  return explicitNo ? 'no' : null;
}

// Voie GTB de l'équipement : 'ok' (intégré à la GTB, ou communicant et câblé),
// 'ko' (aucune interface de communication, ou ni câblé ni intégré), null (à
// qualifier — on ne conclut pas, principe ternaire).
// opts.noGtb      : aucune GTB sur le site → rien n'est relié (les champs
//                   « intégré » / « câblé » éventuellement saisis sont sans objet).
// opts.outOfScope : (d) => true si l'équipement relève d'un usage que la GTB
//                   en place ne traite pas (périmètre déclaré) → non relié.
function deviceInteropState(d, opts = {}) {
  if (opts.noGtb) return 'ko';
  const comm = deviceCommState(d);
  if (isTrue(d.managed_by_bms)) {
    // « Intégré à la GTB » mais « non communicant » : données
    // contradictoires, on ne conclut pas (relecture R3 N-C1 ; précheck
    // DEV-008). Le rapport ne dit plus « le générateur communique ».
    return comm === 'no' ? null : 'ok';
  }
  if (opts.outOfScope && opts.outOfScope(d)) return 'ko';
  // « Non intégré à la GTB » explicite : la GTB n'exploite pas
  // l'équipement, même câblé (R3 M17).
  if (isFalse(d.managed_by_bms)) return 'ko';
  if (comm === 'yes' && isTrue(d.wired)) return 'ok';
  if (comm === 'no') return 'ko';
  return null;
}

// Données contradictoires : « intégré à la GTB » et « non communicant ».
function deviceInteropContradiction(d) {
  return isTrue(d.managed_by_bms) && deviceCommState(d) === 'no';
}

// Compatibilité : un équipement offre une « voie GTB ».
function deviceHasInteropPath(d, opts = {}) {
  return deviceInteropState(d, opts) === 'ok';
}

// Générateur (fonction Production) et régulateur autonome d'un système
// (fonction Régulation, sans production ni émission : régulateur de
// chaufferie, automate, gestionnaire d'éclairage…).
function isProducer(d) {
  return deviceRoleArr(d).includes('production');
}
function isController(d) {
  const roles = deviceRoleArr(d);
  return roles.includes('regulation') && !roles.includes('production') && !roles.includes('emission');
}

/**
 * Statut d'interopérabilité R175-3 3° d'un système, dérivé de ses équipements
 * ACTIFS (déjà filtrés hors service par l'appelant).
 *
 * Règle (PROFEEL § 3.1.2 : « les automates de pilotage embarqués dans les
 * générateurs […] ou les régulateurs contrôlant ces équipements, sont à
 * raccorder au BACS ») : chaque générateur du système (hors secours)
 * communique avec la GTB, directement ou via un régulateur du système
 * raccordé qui le pilote. Un circulateur raccordé ne suffit pas à rendre
 * interopérable une chaufferie dont la chaudière ne l'est pas. Sans
 * générateur dans le système (émetteurs d'une zone alimentés par une
 * production partagée…), un équipement pertinent raccordé suffit.
 *
 * opts.category : catégorie du système (repli des systèmes non thermiques,
 *                  cf. interopRelevantDevices) ; opts.noGtb / opts.outOfScope :
 *                  cf. deviceInteropState.
 *
 * @returns {{ verdict: 'na'|'pending'|'fail'|'ok', relevantCount: number,
 *             relevant: Array, targets: Array, basis: 'producers'|'relevant'|null }}
 *   - basis     : 'producers' si la règle a porté sur les générateurs du
 *                 système, 'relevant' sinon.
 *   - 'na'      : aucun équipement pertinent (émetteurs passifs uniquement).
 *   - 'ok'      : la règle ci-dessus est satisfaite.
 *   - 'fail'    : au moins un générateur (ou, sans générateur, tous les
 *                 équipements pertinents) sans voie GTB établie, sans
 *                 régulateur raccordé ni régulateur non renseigné qui
 *                 pourrait le couvrir. `targets` = équipements à raccorder.
 *   - 'pending' : sinon (réponses manquantes) → on ne conclut pas (principe
 *                 ternaire, incident Communay).
 */
function systemInteropStatus(activeDevices, opts = {}) {
  const relevant = interopRelevantDevices(activeDevices, opts.category);
  if (!relevant.length) return { verdict: 'na', relevantCount: 0, relevant, targets: [], basis: null };
  const state = (d) => deviceInteropState(d, opts);
  const producers = relevant.filter(d => isProducer(d) && !isTrue(d.is_backup));
  const base = { relevantCount: relevant.length, relevant, basis: producers.length ? 'producers' : 'relevant' };
  if (producers.length) {
    const controllers = relevant.filter(isController);
    if (controllers.some(c => state(c) === 'ok')) return { ...base, verdict: 'ok', targets: [] };
    const uncovered = producers.filter(p => state(p) !== 'ok');
    if (!uncovered.length) return { ...base, verdict: 'ok', targets: [] };
    const controllerUnknown = controllers.some(c => state(c) === null);
    const failed = uncovered.filter(p => state(p) === 'ko');
    if (failed.length && !controllerUnknown) return { ...base, verdict: 'fail', targets: failed };
    return { ...base, verdict: 'pending', targets: [] };
  }
  const states = relevant.map(state);
  if (states.includes('ok')) return { ...base, verdict: 'ok', targets: [] };
  const allKo = states.every(st => st === 'ko');
  return allKo ? { ...base, verdict: 'fail', targets: relevant } : { ...base, verdict: 'pending', targets: [] };
}

module.exports = {
  deviceProtocols,
  deviceRoleArr,
  isInteropRelevant,
  interopRelevantDevices,
  deviceCommState,
  deviceInteropState,
  deviceInteropContradiction,
  deviceHasInteropPath,
  isProducer,
  isController,
  systemInteropStatus,
};
