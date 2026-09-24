'use strict';

/**
 * Périmètre GTB déclaré par l'auditeur : usages que la GTB est censée
 * piloter (bacs_audit_bms.manages_*) et exception par équipement
 * (bacs_audit_system_devices.gtb_scope_override, mig 201 : 1 = forcé dans
 * le périmètre, 0 = forcé hors périmètre, null = suit l'usage).
 *
 * Source unique pour le PDF (chapitre GTB, _export-data.js) et le
 * générateur d'actions (bacs-audit-action-generator.js). Le périmètre de la
 * GTB en place ne réduit PAS celui du décret (R175-2 II) : un équipement
 * d'un usage que la GTB ne traite pas est « non relié » (deviceOutOfGtbScope)
 * et reçoit, selon la portée du système, une action obligatoire ou une
 * recommandation sous condition de temps de retour sur investissement.
 */

const { isTrue, isFalse } = require('../routes/bacs-audit/_ternary');

// Catégorie de système → drapeau « usage traité par la GTB ».
// Production d'électricité : aucun drapeau, jamais dans le périmètre par
// défaut (exception possible équipement par équipement).
const MANAGES_FLAG_BY_CATEGORY = {
  heating: 'manages_heating',
  cooling: 'manages_cooling',
  ventilation: 'manages_ventilation',
  dhw: 'manages_dhw',
  lighting_indoor: 'manages_lighting',
  lighting_outdoor: 'manages_lighting',
};

// Usage de compteur → drapeau. Compteurs généraux ('other') et de
// production ('pv') : hors de cette table, jamais filtrés par l'usage.
const MANAGES_FLAG_BY_METER_USAGE = {
  heating: 'manages_heating',
  cooling: 'manages_cooling',
  ventilation: 'manages_ventilation',
  dhw: 'manages_dhw',
  lighting: 'manages_lighting',
};

const MANAGES_FLAGS = ['manages_heating', 'manages_cooling', 'manages_ventilation', 'manages_dhw', 'manages_lighting'];

/** La GTB est-elle censée piloter cette catégorie de système ? */
function gtbManagesCategory(bms, category) {
  const flag = MANAGES_FLAG_BY_CATEGORY[category];
  return !!(bms && flag && isTrue(bms[flag]));
}

/** Équipement dans le périmètre GTB (exception par équipement prioritaire). */
function gtbInScope(bms, device) {
  if (isTrue(device.gtb_scope_override)) return true;
  if (isFalse(device.gtb_scope_override)) return false;
  return gtbManagesCategory(bms, device.system_category);
}

/** L'auditeur a-t-il déclaré au moins un usage traité par la GTB ? */
function hasDeclaredGtbScope(bms) {
  return !!bms && MANAGES_FLAGS.some(f => isTrue(bms[f]));
}

/**
 * Équipement d'un USAGE que la GTB en place ne traite pas (usage non déclaré
 * alors qu'au moins un usage l'est). Sans GTB présente : false (sans objet,
 * l'équipement n'est relié à rien). Un tel équipement est « non relié »
 * (_interop.js, opts.outOfScope) : le périmètre de la GTB ne réduit pas
 * celui du décret. L'exclusion EXPLICITE d'un équipement par l'auditeur
 * (« non concerné par l'intégration », ex. unité extérieure pilotée par les
 * unités intérieures d'un DRV) relève de deviceExcludedByAuditor.
 */
function deviceOutOfGtbScope(bms, device, category) {
  if (!bms || !isTrue(bms.present)) return false;
  if (isFalse(device.gtb_scope_override) || isTrue(device.gtb_scope_override)) return false;
  if (!hasDeclaredGtbScope(bms)) return false;
  return !gtbManagesCategory(bms, category || device.system_category);
}

/**
 * Équipement déclaré par l'auditeur « non concerné par l'intégration à la
 * GTB » (gtb_scope_override = 0) : décision motivée de l'auditeur, écartée de
 * l'évaluation de l'interopérabilité et affichée comme telle dans le rapport.
 */
function deviceExcludedByAuditor(device) {
  return isFalse(device.gtb_scope_override);
}

/**
 * Compteur dans le périmètre GTB déclaré : filtré par son usage seulement
 * pour les usages rattachés à un drapeau ; compteurs généraux et de
 * production toujours dans le périmètre.
 */
function meterInGtbScope(bms, meter) {
  const flag = MANAGES_FLAG_BY_METER_USAGE[meter.usage];
  if (!flag) return true;
  return !!(bms && isTrue(bms[flag]));
}

module.exports = {
  MANAGES_FLAG_BY_CATEGORY,
  MANAGES_FLAG_BY_METER_USAGE,
  gtbManagesCategory,
  gtbInScope,
  hasDeclaredGtbScope,
  deviceOutOfGtbScope,
  deviceExcludedByAuditor,
  meterInGtbScope,
};
