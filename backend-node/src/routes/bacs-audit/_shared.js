'use strict';

const db = require('../../database');

const SYSTEM_CATEGORIES = ['heating','cooling','ventilation','dhw',
  'lighting_indoor','lighting_outdoor','electricity_production'];
const COMMUNICATION_VALUES = ['modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp',
  'knx','mbus','mqtt','autre','non_communicant','absent'];
const METER_USAGES = ['heating','cooling','dhw','pv','lighting','other'];
const METER_TYPES = ['electric','electric_production','gas','water','thermal'];
const RECOMMENDATIONS = ['to_add','to_replace','to_connect','compliant'];
const REGULATION_TYPES = ['per_room','per_zone','central_only','none'];
const GENERATOR_TYPES = ['gas','electric','heat_pump','wood_appliance','district_heating','other'];

/**
 * Vérifie qu'un document BACS existe ET que l'utilisateur courant a au
 * moins le droit `requiredRole` dessus (mig 107 : creator-only par
 * défaut, partage explicite via /afs/:id/permissions).
 *
 * Signature : `(documentId, request, reply, { requiredRole })`. `request`
 * est obligatoire pour récupérer authUser.id et faire le check de perm.
 *
 * Retourne `null` (et la réponse a déjà été envoyée — l'appelant doit
 * `return`) si :
 *   - le document n'existe pas (404)
 *   - ce n'est pas un audit BACS (400)
 *   - l'user courant n'a pas accès (403)
 */
function assertBacsAuditExists(documentId, request, reply, { requiredRole = 'read' } = {}) {
  const af = db.afs.getById(documentId);
  if (!af) {
    reply.code(404).send({ detail: 'Document non trouve' });
    return null;
  }
  if (af.kind !== 'bacs_audit') {
    reply.code(400).send({ detail: 'Document n\'est pas un audit BACS' });
    return null;
  }
  const userId = request?.authUser?.id;
  if (!userId) {
    reply.code(401).send({ detail: 'Authentification requise' });
    return null;
  }
  const { ok, role } = db.afPermissions.hasAccess(documentId, userId, requiredRole);
  if (!ok) {
    reply.code(403).send({
      detail: role === 'read'
        ? 'Accès en lecture seule sur cet audit — demandez un accès en écriture au propriétaire.'
        : 'Vous n\'avez pas accès à cet audit.',
    });
    return null;
  }
  return af;
}

/**
 * Helper de journalisation des modifications d'un audit BACS. Wrap
 * `db.auditLog.add` en injectant automatiquement le user courant et
 * en silenciant les erreurs (le log ne doit jamais bloquer l'écriture
 * métier — au pire, il est manqué).
 *
 * Utilisation à la fin d'une route write :
 *   logBacsAudit(request, 'bacs.system.update', documentId, { systemId, fields });
 *
 * Convention d'action : `bacs.<entity>.<verb>` (verbe = create | update |
 * delete | duplicate | reorder | merge | regenerate | upload | apply).
 */
function logBacsAudit(request, action, afId, payload = {}) {
  try {
    db.auditLog.add({
      afId,
      userId: request?.authUser?.id || null,
      action,
      payload,
    });
  } catch { /* fail-soft : pas de log = pas de bloquage */ }
}

module.exports = {
  SYSTEM_CATEGORIES, COMMUNICATION_VALUES, METER_USAGES, METER_TYPES,
  RECOMMENDATIONS, REGULATION_TYPES, GENERATOR_TYPES,
  assertBacsAuditExists,
  logBacsAudit,
};
