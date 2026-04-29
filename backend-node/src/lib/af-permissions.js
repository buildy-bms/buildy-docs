'use strict';

const db = require('../database');

/**
 * Assertions de permission pour les routes touchant une AF specifique.
 *
 * Logique :
 *   - Si AUCUNE permission n'est posee sur l'AF (af_permissions vide) →
 *     mode legacy = tous les utilisateurs connectes accedent (lecture +
 *     ecriture). Conservation de la compatibilite V1.
 *   - Sinon → owner (created_by) a tous les droits ; les autres doivent
 *     avoir une entree af_permissions avec role >= requiredRole.
 *
 * En cas de refus, repond 403 et retourne false. L'appelant DOIT verifier
 * et `return` immediatement.
 */
function assertWrite(request, reply, afId) {
  const userId = request.authUser?.id;
  if (!userId) {
    reply.code(401).send({ detail: 'Authentification requise' });
    return false;
  }
  const { ok, role } = db.afPermissions.hasAccess(afId, userId, 'write');
  if (!ok) {
    reply.code(403).send({
      detail: role === 'read'
        ? 'Accès en lecture seule sur cette AF — demandez un accès en écriture au propriétaire.'
        : 'Vous n\'avez pas accès à cette AF.',
    });
    return false;
  }
  return true;
}

function assertRead(request, reply, afId) {
  const userId = request.authUser?.id;
  if (!userId) {
    reply.code(401).send({ detail: 'Authentification requise' });
    return false;
  }
  const { ok } = db.afPermissions.hasAccess(afId, userId, 'read');
  if (!ok) {
    reply.code(403).send({ detail: 'Vous n\'avez pas accès à cette AF.' });
    return false;
  }
  return true;
}

// Section helpers : on remonte au section.af_id d'abord
function assertSectionWrite(request, reply, sectionId) {
  const sec = db.sections.getById(sectionId);
  if (!sec) {
    reply.code(404).send({ detail: 'Section non trouvée' });
    return false;
  }
  return assertWrite(request, reply, sec.af_id) ? sec : false;
}

module.exports = {
  assertRead,
  assertWrite,
  assertSectionWrite,
};
