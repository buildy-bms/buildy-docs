'use strict';

/**
 * Validations de cohérence transversale entre entités BACS audit.
 *
 * Ces helpers protègent les FKs métier qui ne sont pas contraintes au
 * niveau SQL (la base accepte n'importe quel device_id du même document).
 *
 * Utilisé par la route PATCH /bacs-audit/thermal-regulation/:id pour
 * refuser une assignation incohérente (cf. plan Partie B chantier 2).
 */

const db = require('../database');

const THERMAL_DEVICE_COLS = [
  'generator_device_id',
  'distribution_device_id',
  'emission_device_id',
];
const THERMAL_EXTRA_COLS = [
  'production_extra_device_ids',
  'distribution_extra_device_ids',
  'emission_extra_device_ids',
];
const THERMAL_REGULATION_COLS = [
  'production_regulation_device_id',
  'distribution_regulation_device_id',
  'emission_regulation_device_id',
];

/**
 * Récupère { id, name, regulation_integrated, system_id, zone_id,
 * system_category, document_id } d'un device par son id, et la liste
 * des systèmes auxquels il est explicitement partagé (mig 143).
 * Renvoie null si inexistant.
 */
function getDeviceContext(deviceId) {
  if (deviceId == null) return null;
  const row = db.db.prepare(`
    SELECT d.id, d.name, d.regulation_integrated, d.system_id,
           s.zone_id, s.system_category, s.document_id
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    WHERE d.id = ?
  `).get(deviceId);
  if (!row) return null;
  const sharedSystemIds = db.db.prepare(`
    SELECT system_id FROM bacs_audit_device_shared_systems WHERE device_id = ?
  `).all(deviceId).map(r => r.system_id);
  return { ...row, sharedSystemIds };
}

/**
 * Vrai si le device appartient au système thermique (par FK directe ou
 * via partage explicite mig 143).
 */
function deviceBelongsToSystem(deviceCtx, targetSystemId) {
  if (!deviceCtx || targetSystemId == null) return false;
  if (deviceCtx.system_id === targetSystemId) return true;
  if (deviceCtx.sharedSystemIds.includes(targetSystemId)) return true;
  return false;
}

/**
 * Pour un payload de PATCH thermal-regulation, valide que chaque
 * device_id assigné appartient bien à un système de la même zone et
 * de la même catégorie que la régulation.
 *
 * @param {object} body — payload Zod déjà parsé (peut contenir
 *   zone_id, category, generator_device_id, …)
 * @param {object} currentRow — ligne thermal_regulation actuelle en DB
 * @returns {string|null} message d'erreur lisible ou null si OK
 */
function validateThermalDeviceCoherence(body, currentRow) {
  // Système courant (mig 188). Si fourni, on filtre strictement dessus.
  // Sinon fallback historique (zone × catégorie).
  const effectiveSystemId = body.system_id !== undefined ? body.system_id : currentRow.system_id;
  const effectiveZone = body.zone_id !== undefined ? body.zone_id : currentRow.zone_id;
  const effectiveCat = body.category !== undefined ? body.category : currentRow.category;

  function checkDevice(deviceId, col) {
    const ctx = getDeviceContext(deviceId);
    if (!ctx) return `Équipement #${deviceId} introuvable pour ${col}.`;
    // Exception équipements réversibles (heating ↔ cooling) — une PAC
    // air/eau ou un DRV réversible sert à la fois chauffage ET
    // refroidissement, mais côté DB il n'a qu'un seul system_id. Quand
    // l'auditeur veut le désigner (production, distribution, émission ou
    // extras) dans la régul thermique de l'autre catégorie sur la même
    // zone, on accepte tant que le document et la zone matchent. Placé
    // AVANT l'exception distribution pour couvrir aussi les circuits
    // d'un système réversible qui desservent l'autre catégorie.
    if (ctx.document_id === currentRow.document_id
        && ctx.zone_id === effectiveZone
        && (effectiveCat === 'heating' || effectiveCat === 'cooling')
        && (ctx.system_category === 'heating' || ctx.system_category === 'cooling')
        && ctx.system_category !== effectiveCat) {
      return null;
    }

    // Exception niveau distribution — un circuit de distribution (bouclage
    // ECS, circuits eau chaude/glacée…) est souvent rattaché au système
    // central de production (chaufferie, PAC air/eau) mais dessert plusieurs
    // zones aval. On accepte cross-system tant que la catégorie d'usage
    // correspond et que le document est le même (site cohérent). Aligné sur
    // le comportement UI (frontend/audit/ThermalSection deviceOptionsForLevel).
    if (col === 'distribution_device_id' || col === 'distribution_extra_device_ids') {
      if (ctx.document_id !== currentRow.document_id) {
        return `Équipement « ${ctx.name || '#' + deviceId} » appartient à un autre audit.`;
      }
      if (ctx.system_category !== effectiveCat) {
        return `Équipement « ${ctx.name || '#' + deviceId} » est dans une autre catégorie d'usage (${ctx.system_category}) que la régulation (${effectiveCat}).`;
      }
      return null;
    }
    if (effectiveSystemId != null) {
      if (!deviceBelongsToSystem(ctx, effectiveSystemId)) {
        return `Équipement « ${ctx.name || '#' + deviceId} » n'appartient pas à ce système (et n'y est pas partagé). Choisis un équipement du système courant ou partagé explicitement.`;
      }
    } else {
      // Pas de system_id : on retombe sur le filtre zone × catégorie.
      if (ctx.zone_id !== effectiveZone) {
        return `Équipement « ${ctx.name || '#' + deviceId} » est dans une autre zone (zone ${ctx.zone_id}) que la régulation thermique (zone ${effectiveZone}).`;
      }
      if (ctx.system_category !== effectiveCat) {
        return `Équipement « ${ctx.name || '#' + deviceId} » est dans une autre catégorie d'usage (${ctx.system_category}) que la régulation (${effectiveCat}).`;
      }
    }
    return null;
  }

  // FKs primaires.
  for (const col of THERMAL_DEVICE_COLS) {
    if (!(col in body)) continue;
    const deviceId = body[col];
    if (deviceId == null) continue;
    const err = checkDevice(deviceId, col);
    if (err) return err;
  }

  // Extras JSON arrays.
  for (const col of THERMAL_EXTRA_COLS) {
    if (!(col in body)) continue;
    const raw = body[col];
    if (raw == null || raw === '') continue;
    let ids;
    try {
      const parsed = JSON.parse(raw);
      ids = Array.isArray(parsed) ? parsed : [];
    } catch {
      return `Format JSON invalide pour ${col}.`;
    }
    for (const id of ids) {
      const err = checkDevice(id, col);
      if (err) return err;
    }
  }

  // *_regulation_device_id : refuser si le device a regulation_integrated=1
  // (un équipement autonome ne peut pas être désigné comme régulateur
  // déporté d'un autre niveau — contradiction sémantique).
  for (const col of THERMAL_REGULATION_COLS) {
    if (!(col in body)) continue;
    const deviceId = body[col];
    if (deviceId == null) continue;
    const ctx = getDeviceContext(deviceId);
    if (!ctx) continue; // FK manquante traitée ailleurs
    if (ctx.regulation_integrated === 1) {
      return `Équipement « ${ctx.name || '#' + deviceId} » a sa régulation intégrée — il ne peut pas être désigné comme régulateur déporté.`;
    }
  }

  return null;
}

module.exports = {
  validateThermalDeviceCoherence,
};
