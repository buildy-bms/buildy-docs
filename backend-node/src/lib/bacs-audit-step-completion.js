'use strict';

/**
 * Verrou serveur de la validation des étapes du stepper audit BACS.
 *
 * ⚠️ MIROIR de `STEP_DEFINITIONS[].isComplete()` dans
 * `frontend/src/views/BacsAuditDetailView.vue`. Toute modification d'une
 * condition de complétude doit être répercutée des deux côtés.
 *
 * Utilisé par `routes/bacs-audit/lifecycle.js` (validate-step) : on refuse
 * de valider une étape dont les infos essentielles ne sont pas saisies.
 */

const db = require('../database');

function isStepComplete(documentId, stepKey) {
  const af = db.afs.getById(documentId);
  if (!af) return false;

  const count = (sql, ...args) =>
    db.db.prepare(sql).get(documentId, ...args)?.n || 0;

  switch (stepKey) {
    case 'identification':
      return !!af.site_id && !!af.bacs_applicability_status;

    case 'zones':
      if (!af.site_id) return false;
      return db.db.prepare(
        `SELECT COUNT(*) n FROM zones
         WHERE site_id = ? AND deleted_at IS NULL
           AND COALESCE(kind, 'functional') != 'technical'`
      ).get(af.site_id).n > 0;

    case 'technical-zones':
      return true;

    case 'systems':
      return count(
        `SELECT COUNT(*) n FROM bacs_audit_systems s
         WHERE s.document_id = ? AND s.present = 1
           AND EXISTS (SELECT 1 FROM bacs_audit_system_devices d WHERE d.system_id = s.id)`
      ) > 0;

    case 'meters':
      return count('SELECT COUNT(*) n FROM bacs_audit_meters WHERE document_id = ?') > 0;

    case 'thermal':
      return count('SELECT COUNT(*) n FROM bacs_audit_thermal_regulation WHERE document_id = ?') > 0;

    case 'bms': {
      const bms = db.db.prepare(
        'SELECT present, existing_solution FROM bacs_audit_bms WHERE document_id = ?'
      ).get(documentId);
      if (!bms) return false;
      if (bms.present === 0) return true;            // « Pas de GTB » → étape OK
      return bms.present === 1 && !!(bms.existing_solution && bms.existing_solution.trim());
    }

    case 'inspections': {
      const bms = db.db.prepare(
        'SELECT present FROM bacs_audit_bms WHERE document_id = ?'
      ).get(documentId);
      if (bms && bms.present === 0) return true;     // étape masquée sans GTB
      const ins = db.db.prepare(
        'SELECT last_inspection_date FROM bacs_audit_inspections WHERE document_id = ? ORDER BY id LIMIT 1'
      ).get(documentId);
      return !!(ins && ins.last_inspection_date);
    }

    case 'docs-checklist': {
      const items = db.bacsAuditChecklist.listForDocument(documentId);
      const allHandled = items.length > 0 && items.every(i => i.status !== 'pending');
      const cov = db.bacsAuditChecklist.photoCoverage(documentId);
      const total = cov.zones.total + cov.systems.total + cov.meters.total + cov.bms.total;
      const covered = cov.zones.covered + cov.systems.covered + cov.meters.covered + cov.bms.covered;
      return allHandled && total > 0 && covered === total;
    }

    case 'documents':
      if (!af.site_id) return false;
      return db.db.prepare(
        `SELECT COUNT(*) n FROM site_documents
         WHERE site_id = ? AND COALESCE(category, '') != 'photo'`
      ).get(af.site_id).n > 0;

    case 'credentials':
      if (!af.site_id) return false;
      return db.db.prepare(
        'SELECT COUNT(*) n FROM site_credentials WHERE site_id = ?'
      ).get(af.site_id).n > 0;

    case 'review':
      // Le plan n'a plus de champ par action à renseigner (mig UI) :
      // l'étape est un sign-off manuel, jamais bloquante.
      return true;

    case 'synthesis':
      return !!(af.audit_synthesis_html &&
        af.audit_synthesis_html.replace(/<[^>]*>/g, '').trim());

    default:
      return true;
  }
}

module.exports = { isStepComplete };
