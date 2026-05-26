'use strict';

/**
 * Helper d'auto-création de l'équipement « Sous-station de réseau de
 * chaleur urbain » sur un audit BACS.
 *
 * Logique métier (refactor 2026-05-26) — quand l'auditeur coche au
 * niveau du site « Le bâtiment est-il raccordé à un réseau urbain de
 * chaleur ou de froid ? » (= `bacs_district_heating_substation_kw`
 * passe d'une valeur null à une valeur non-null), on insère
 * automatiquement un équipement de type sous-station dans le premier
 * système de chauffage présent du document. Cet équipement déclenche
 * ensuite la dérivation du cas E d'assujettissement (cf.
 * `_export-data.js` enrichedSystems + bacs-liability.js).
 *
 * Pourquoi cette stratégie ?
 *  · Cohérence : 1 question au site = 1 effet visible (l'équipement
 *    apparaît dans l'inventaire des systèmes).
 *  · Intuitif : l'auditeur peut ensuite le DÉPLACER vers un autre
 *    système ou zone si besoin (DRV + radiateurs eau chaude couplés
 *    au chauffage urbain : il met la sous-station sur le système des
 *    radiateurs, pas sur celui des DRV).
 *  · Idempotent : si un device basé sur ce modèle existe déjà dans
 *    le document, on ne fait rien (évite les doublons sur re-coche).
 *  · Tolérant : si aucun système chauffage n'est encore présent, on
 *    n'échoue pas — l'auditeur ajoutera l'équipement à la main plus
 *    tard via la bibliothèque.
 */

const SUBSTATION_SLUG = 'sous-station-reseau-urbain';

/**
 * Crée un device sous-station si nécessaire.
 * @param {Database} db better-sqlite3 instance
 * @param {number} documentId
 * @returns {{ created: boolean, deviceId?: number, systemId?: number, reason?: string }}
 */
function ensureDistrictHeatingSubstationDevice(db, documentId) {
  // 0. Récupère la puissance saisie au niveau site (R175-2 : puissance
  //    de la station d'échange = puissance retenue pour l'assujettissement).
  //    Si elle est null, on n'a pas lieu de créer l'équipement.
  const afRow = db.prepare(
    'SELECT bacs_district_heating_substation_kw FROM afs WHERE id = ?'
  ).get(documentId);
  const substationKw = afRow ? afRow.bacs_district_heating_substation_kw : null;
  if (substationKw == null) return { created: false, reason: 'no-power' };

  // 1. Récupère le modèle d'équipement sous-station depuis la biblio.
  const tpl = db.prepare(
    'SELECT id, name, default_energy_source, default_device_role FROM equipment_templates WHERE slug = ?'
  ).get(SUBSTATION_SLUG);
  if (!tpl) return { created: false, reason: 'template-missing' };

  // 2. Existe-t-il déjà un device basé sur ce modèle dans le document ?
  //    Si oui : on resynchronise sa puissance avec la valeur saisie au
  //    site (le user peut avoir modifié la valeur après création).
  const existing = db.prepare(`
    SELECT d.id, d.system_id FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    WHERE s.document_id = ? AND d.equipment_template_id = ?
    LIMIT 1
  `).get(documentId, tpl.id);
  if (existing) {
    db.prepare(
      'UPDATE bacs_audit_system_devices SET power_kw = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(substationKw, existing.id);
    syncSystemSubstationFlag(db, existing.system_id, 1);
    return { created: false, reason: 'already-exists', deviceId: existing.id };
  }

  // 3. Trouver le 1er système de chauffage présent (par ordre de zone
  //    puis de système). On filtre sur `present = 1` pour ne pas créer
  //    l'équipement dans un système marqué non-concerné.
  const targetSystem = db.prepare(`
    SELECT s.id AS system_id FROM bacs_audit_systems s
    LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ?
      AND s.system_category = 'heating'
      AND s.present = 1
    ORDER BY z.position NULLS LAST, z.name, s.position, s.id
    LIMIT 1
  `).get(documentId);
  if (!targetSystem) return { created: false, reason: 'no-heating-system' };

  // 4. Créer le device avec les defaults du modèle + la puissance saisie.
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), 0) AS p FROM bacs_audit_system_devices WHERE system_id = ?'
  ).get(targetSystem.system_id).p;
  const r = db.prepare(`
    INSERT INTO bacs_audit_system_devices
      (system_id, position, name, power_kw, energy_source, device_role,
       equipment_template_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    targetSystem.system_id,
    maxPos + 10,
    tpl.name,
    substationKw,
    tpl.default_energy_source || 'district_heating',
    tpl.default_device_role || null,
    tpl.id,
    'Équipement créé automatiquement lorsque le site a été déclaré raccordé à un réseau urbain. Déplace-le si besoin vers le système concerné. La puissance reprend la valeur saisie au site (R175-2 : puissance de la station d\'échange).',
  );
  syncSystemSubstationFlag(db, targetSystem.system_id, 1);
  return {
    created: true,
    deviceId: r.lastInsertRowid,
    systemId: targetSystem.system_id,
    templateName: tpl.name,
  };
}

/**
 * Synchronise la colonne legacy `bacs_audit_systems.is_district_heating_substation`
 * avec la présence d'au moins un device du modèle sous-station.
 *
 * Pourquoi : la dérivation se fait à l'export PDF, mais tout consommateur
 * direct de la colonne (UI temps réel, route GET /liability, MCP, requêtes
 * ad hoc) verrait `0` si on ne synchronise pas. Évite les désynchros
 * cross-canal (cf. mémoire `audit-ternary-helper`).
 *
 * @param {Database} db
 * @param {number} systemId
 * @param {0|1} value
 */
function syncSystemSubstationFlag(db, systemId, value) {
  db.prepare(
    'UPDATE bacs_audit_systems SET is_district_heating_substation = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(value, systemId);
}

module.exports = {
  SUBSTATION_SLUG,
  ensureDistrictHeatingSubstationDevice,
  syncSystemSubstationFlag,
};
