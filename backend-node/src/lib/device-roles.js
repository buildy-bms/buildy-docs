'use strict';

/**
 * Helpers pour le champ rôle multi-valeurs (Production / Distribution /
 * Émission / Régulation / Autre + free text creatable).
 *
 * Stockage DB : JSON array dans une colonne TEXT (mig 117).
 *   - equipment_templates.default_device_role
 *   - bacs_audit_system_devices.device_role
 *
 * Format attendu en API : array de strings (vide → null à l'écriture).
 */

function parseRoles(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
      }
    } catch { /* legacy non-JSON */ }
  }
  return [s];
}

function serializeRoles(arr) {
  if (!Array.isArray(arr)) return null;
  const cleaned = arr.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
  if (!cleaned.length) return null;
  return JSON.stringify(cleaned);
}

/**
 * `energy_source` = énergie primaire CONSOMMÉE par le device. Cela n'a de
 * sens que pour un équipement de production (chaudière qui brûle du gaz,
 * PAC qui consomme de l'électricité, capteurs PV qui captent le soleil…).
 * Un radiateur à eau chaude, un ventilo-convecteur ou une unité intérieure
 * DRV ne consomment pas d'énergie primaire — ils reçoivent un fluide d'un
 * autre équipement. Pour eux, energy_source DOIT être null.
 */
function rolesAllowEnergySource(roles) {
  const parsed = parseRoles(roles);
  return parsed.some(r => /production|generator/i.test(r));
}

module.exports = { parseRoles, serializeRoles, rolesAllowEnergySource };
