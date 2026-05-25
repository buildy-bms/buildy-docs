'use strict';

/**
 * Helpers ternaires partagés pour l'audit BACS.
 *
 * Beaucoup de champs métier sont ternaires (null / 0/false / 1/true). Sans
 * helper centralisé, chaque consommateur a tendance à utiliser un filtre
 * truthy JS qui collapse silencieusement `null` en `false` — c'est la cause
 * racine de l'incident audit Communay (mai 2026) où Claude a présenté
 * « 0 communicants » pour des compteurs qui n'avaient simplement pas été
 * répondus.
 *
 * Règle d'or : pour TOUT compteur d'agrégation sur un champ ternaire,
 * utiliser `ternaryCounts(arr, field)` qui renvoie les 3 sous-compteurs
 * séparés.
 */

const isTrue = v => v === 1 || v === true;
const isFalse = v => v === 0 || v === false;
const isUnanswered = v => v == null;

/**
 * Renvoie les 3 compteurs d'un champ ternaire sur un array d'objets.
 * @param {Array<object>} arr - tableau d'entités
 * @param {string} fieldName - nom du champ ternaire
 * @returns {{ true_count: number, false_count: number, unanswered_count: number }}
 */
function ternaryCounts(arr, fieldName) {
  const a = arr || [];
  return {
    true_count: a.filter(x => isTrue(x[fieldName])).length,
    false_count: a.filter(x => isFalse(x[fieldName])).length,
    unanswered_count: a.filter(x => isUnanswered(x[fieldName])).length,
  };
}

module.exports = { isTrue, isFalse, isUnanswered, ternaryCounts };
