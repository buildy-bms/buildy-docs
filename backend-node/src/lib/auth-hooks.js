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
  reply.setCookie('af_token', token, cookieOpts(config.accessTokenMaxAge));
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
      url === '/api/auth/logout'
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
      const token = request.cookies.af_token;
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
  });
}

module.exports = { cookieOpts, issueAccessToken, registerAuthHook };
