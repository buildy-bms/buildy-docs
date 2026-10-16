// « La GTB et la supervision sont-elles fonctionnelles ? » (mig 218, demande de Kévin 2026-10-16) :
// 'functional' | 'partial' | 'not_functional' | null, tenu d'accord avec l'ancien
// `out_of_service` (« hors service » = « Non »), que lisent le plan d'actions, la conformité, les
// rapports, le mobile et les outils Claude.
'use strict';

const STATES = ['functional', 'partial', 'not_functional'];

const outOfServiceOf = (state) => (state == null ? null : state === 'not_functional');

/**
 * Accorde `functional_state` et `out_of_service` dans le corps d'une mise à jour de la GTB (modifié
 * en place et renvoyé). `out_of_service` est un booléen ou null (après validation Zod).
 * - `functional_state` envoyé : `out_of_service` en découle.
 * - `out_of_service` seul (ancienne version mobile, outils Claude) : l'état en découle ; « en
 *   service » garde un « Partiellement » déjà saisi (`currentState`).
 * - Les deux en désaccord (ancienne version qui renvoie toute la fiche mais n'a changé que « hors
 *   service ») : « hors service » l'emporte.
 * Notes : espaces retirés, vide → null.
 */
function syncBmsFunctionalState(body, currentState = null) {
  if (body.functional_state !== undefined && body.out_of_service !== undefined
      && outOfServiceOf(body.functional_state) !== body.out_of_service) {
    delete body.functional_state;
  }
  if (body.functional_state !== undefined) {
    body.out_of_service = outOfServiceOf(body.functional_state);
  } else if (body.out_of_service !== undefined) {
    body.functional_state = body.out_of_service == null ? null
      : body.out_of_service ? 'not_functional' : (currentState === 'partial' ? 'partial' : 'functional');
  }
  if (typeof body.functional_notes === 'string') body.functional_notes = body.functional_notes.trim() || null;
  return body;
}

module.exports = { STATES, syncBmsFunctionalState };
