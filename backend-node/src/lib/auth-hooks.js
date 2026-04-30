'use strict';

const config = require('../config');
const db = require('../database');

/**
 * Cookie options helper — secure en prod ou HTTPS.
 */
function cookieOpts(maxAge, path = '/') {
  return {
    path,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction || config.httpsEnabled,
    maxAge,
  };
}

/**
 * Issue access token (Lot 1 minimal — pas de refresh token pour l'instant).
 */
function issueAccessToken(fastify, reply, user) {
  const crypto = require('crypto');
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.accessTokenMaxAge * 1000).toISOString();

  const token = fastify.jwt.sign(
    { id: user.id, email: user.email, jti },
    { expiresIn: config.accessTokenMaxAge }
  );
  db.sessions.create(user.id, jti, expiresAt);
  reply.setCookie('docs_token', token, cookieOpts(config.accessTokenMaxAge));
  return { jti };
}

/**
 * Hook global onRequest qui protege /api/* sauf endpoints publics.
 * En mode DEV_BYPASS_AUTH, injecte un user fictif sur chaque requete.
 */
function registerAuthHook(fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];

    // Endpoints publics
    if (
      url === '/api/health' ||
      url === '/api/auth/oidc/login' ||
      url === '/api/auth/oidc/callback' ||
      url === '/api/auth/oidc/config' ||
      url === '/api/auth/logout' ||
      url === '/api/sites/sync' // auth Bearer (BUILDY_SITES_SYNC_TOKEN) verifiee dans la route
    ) return;

    // Protege /api/* ET /attachments/* (les captures sont sensibles meme avec
    // des filenames UUID).
    const isApi = url.startsWith('/api/');
    const isAttachment = url.startsWith('/attachments/');
    if (!isApi && !isAttachment) return;

    // DEV bypass : injecte un user fictif sans cookie
    if (config.devBypassAuth) {
      const user = db.users.ensureDevUser(config.devBypassUser.email, config.devBypassUser.displayName);
      request.authUser = { id: user.id, email: user.email, display_name: user.display_name };
      return;
    }

    // Auth normale par cookie JWT
    let decoded;
    try {
      const token = request.cookies.docs_token;
      if (!token) throw new Error('No token');
      decoded = fastify.jwt.verify(token);
    } catch {
      return reply.code(401).send({ detail: 'Non authentifie' });
    }

    if (decoded.jti) {
      const session = db.sessions.getByJti(decoded.jti);
      if (!session || session.is_revoked) {
        return reply.code(401).send({ detail: 'Session revoquee' });
      }
    }

    request.authUser = decoded;
    db.users.touchLastSeen(decoded.id);

    // Sliding session : ré-émet le token + cookie quand il reste moins de la
    // moitié du TTL. Évite que l'utilisateur soit déconnecté en plein boulot.
    const now = Math.floor(Date.now() / 1000);
    const remaining = (decoded.exp || 0) - now;
    if (remaining > 0 && remaining < config.accessTokenMaxAge / 2) {
      const newToken = fastify.jwt.sign(
        { id: decoded.id, email: decoded.email, jti: decoded.jti },
        { expiresIn: config.accessTokenMaxAge }
      );
      reply.setCookie('docs_token', newToken, cookieOpts(config.accessTokenMaxAge));
      if (decoded.jti) {
        const newExpiresAt = new Date(Date.now() + config.accessTokenMaxAge * 1000).toISOString();
        db.sessions.extendByJti?.(decoded.jti, newExpiresAt);
      }
    }
  });
}

/**
 * Garde par AF — vérifie que l'utilisateur authentifié a au moins le rôle requis
 * sur l'AF cible (Lot 28). Renvoie 403 sinon, 404 si l'AF n'existe pas.
 */
function requireAfAccess(requiredRole = 'read') {
  return async (request, reply) => {
    if (!request.authUser?.id) return reply.code(401).send({ detail: 'Non authentifie' });
    let afId = parseInt(request.params.afId || request.params.id, 10);
    if (!afId && request.params.id) {
      // params.id peut être section_id → résoudre vers af_id
      const sec = db.prepare ? null : null; // évite circular
      const section = db.sections?.getById?.(parseInt(request.params.id, 10));
      if (section) afId = section.af_id;
    }
    if (!afId) return; // route non scopée AF
    const af = db.afs.getById(afId);
    if (!af || af.deleted_at) return reply.code(404).send({ detail: 'AF non trouvée' });
    const access = db.afPermissions.hasAccess(afId, request.authUser.id, requiredRole);
    if (!access.ok) {
      return reply.code(403).send({
        detail: access.role
          ? `Permissions insuffisantes (vous avez ${access.role}, ${requiredRole} requis)`
          : 'Vous n\'êtes pas autorisé à accéder à cette AF',
      });
    }
    request.afRole = access.role;
  };
}

module.exports = { cookieOpts, issueAccessToken, registerAuthHook, requireAfAccess };
