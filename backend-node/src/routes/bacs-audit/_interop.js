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

const { isTrue } = require('./_ternary');

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

// Un équipement est « pertinent pour l'interopérabilité du système » s'il porte
// au moins un niveau actif (production / distribution / régulation). Les
// émetteurs purs (radiateur, ventilo-convecteur passif) sont exclus du critère
// R175-3 §3 — aucune obligation du décret de les rendre communicants.
function isInteropRelevant(d) {
  return deviceRoleArr(d).some(r => r === 'production' || r === 'distribution' || r === 'regulation');
}

// Un équipement offre une « voie GTB » s'il communique via un protocole ouvert
// ET est raccordé (câblé ou intégré à la GTB).
function deviceHasInteropPath(d) {
  return deviceProtocols(d).length > 0 && (isTrue(d.wired) || isTrue(d.managed_by_bms));
}

/**
 * Statut d'interopérabilité R175-3 §3 d'un système, dérivé de ses équipements
 * ACTIFS (déjà filtrés hors service / hors secours par l'appelant).
 *
 * @returns {{ verdict: 'na'|'pending'|'fail'|'ok', relevantCount: number }}
 *   - 'na'      : aucun équipement pertinent (production/distribution/régulation)
 *                 → l'exigence ne s'évalue pas (émetteurs passifs uniquement).
 *   - 'pending' : équipements pertinents mais aucune réponse explicite sur le
 *                 raccordement (wired / managed_by_bms tous null) → non qualifié
 *                 (principe ternaire, incident Communay).
 *   - 'fail'    : équipements pertinents, réponse explicite, mais aucune voie GTB.
 *   - 'ok'      : au moins un équipement pertinent offre une voie GTB.
 */
function systemInteropStatus(activeDevices) {
  const relevant = (activeDevices || []).filter(isInteropRelevant);
  if (!relevant.length) return { verdict: 'na', relevantCount: 0 };
  if (relevant.some(deviceHasInteropPath)) return { verdict: 'ok', relevantCount: relevant.length };
  const answered = relevant.some(d => d.wired != null || d.managed_by_bms != null);
  return { verdict: answered ? 'fail' : 'pending', relevantCount: relevant.length };
}

module.exports = {
  deviceProtocols,
  deviceRoleArr,
  isInteropRelevant,
  deviceHasInteropPath,
  systemInteropStatus,
};
