'use strict';

// Tri canonique et numérotation BACS-001…NNN des actions d'un audit. Source
// unique pour l'écran (desktop, PWA), le MCP et l'export CSV : tous
// partagent EXACTEMENT la numérotation du PDF, sans recalcul côté client.

const { sortActions, cardOfAction } = require('./_action-cards');
const { isReserveAction, isInfoAction } = require('./_compliance-summary');

// Tri par carte de l'audit (Identification → Systèmes → Compteurs → GTB →
// Régulation → Inspections → Divers), puis sous-section GTB, sévérité,
// article et id. Seuls les items VISIBLES (statut ni « terminée » ni « non
// retenue ») reçoivent un numéro, comme dans le PDF (_export-data.js :
// WHERE status NOT IN ('done','declined')). Les informations (exemption
// 5 %, vigilance, recommandation hors décret) restent sans numéro, hors plan
// et hors décomptes.
function numberActionItems(rows) {
  let nbr = 0;
  return sortActions(rows).map(r => {
    const c = cardOfAction(r);
    const isInfo = isInfoAction(r);
    const visible = r.status !== 'done' && r.status !== 'declined' && !isInfo;
    if (visible) nbr++;
    return {
      ...r,
      display_number: visible ? 'BACS-' + String(nbr).padStart(3, '0') : null,
      card_key: c.card,
      card_subsection: c.subsection,
      // Réserve (obligation à respecter) / information : l'UI les compte à
      // part, comme le PDF.
      is_reserve: isReserveAction(r),
      is_info: isInfo,
    };
  });
}

module.exports = { numberActionItems };
