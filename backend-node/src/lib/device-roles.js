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

module.exports = { parseRoles, serializeRoles };
