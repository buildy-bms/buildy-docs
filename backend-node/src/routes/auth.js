'use strict';

const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').auth;
const oidc = require('../lib/oidc');
const { cookieOpts, issueAccessToken } = require('../lib/auth-hooks');

async function routes(fastify) {
  // Public : indique au frontend si OIDC est actif (et le mode dev bypass)
  fastify.get('/auth/oidc/config', async () => ({
    oidcEnabled: config.oidcEnabled,
    oidcIssuer: config.oidcEnabled ? config.oidcIssuer : null,
    devBypass: config.devBypassAuth,
  }));

  // GET /auth/oidc/login — redirige vers PocketID
  fastify.get('/auth/oidc/login', async (request, reply) => {
    if (!config.oidcEnabled) return reply.code(404).send({ detail: 'OIDC non active' });

    try {
      const params = oidc.generateOidcParams();
      // Cookie signe (HMAC via @fastify/cookie secret). Permet de detecter
      // toute manipulation par un client malveillant.
      reply.setCookie('docs_oidc_state', JSON.stringify({
        state: params.state,
        nonce: params.nonce,
        codeVerifier: params.codeVerifier,
      }), { ...cookieOpts(300), signed: true });

      const authUrl = await oidc.getAuthorizationUrl(config, params);
      return reply.redirect(authUrl);
    } catch (err) {
      log.error(`OIDC login init failed: ${err.message} (cause: ${err.cause?.message || 'n/a'})`);
      return reply.redirect(`${config.publicUrl}/login?oidc_error=${encodeURIComponent('OIDC init impossible : ' + err.message)}`);
    }
  });

  // GET /auth/oidc/callback — recoit le code de PocketID
  fastify.get('/auth/oidc/callback', async (request, reply) => {
    if (!config.oidcEnabled) return reply.code(404).send({ detail: 'OIDC non active' });

    const { code, state, error, error_description } = request.query;
    if (error) {
      log.warn(`OIDC callback error: ${error} — ${error_description}`);
      return reply.redirect(`${config.publicUrl}/login?oidc_error=${encodeURIComponent(error_description || error)}`);
    }

    let oidcState;
    try {
      // Verifie la signature HMAC du cookie avant de l'utiliser.
      const unsigned = request.unsignCookie(request.cookies.docs_oidc_state || '');
      if (!unsigned.valid) throw new Error('signature invalide');
      oidcState = JSON.parse(unsigned.value || '{}');
    } catch {
      return reply.code(400).send({ detail: 'Etat OIDC invalide' });
    }
    reply.clearCookie('docs_oidc_state', { path: '/' });

    if (!oidcState.state || oidcState.state !== state) {
      return reply.code(400).send({ detail: 'Etat OIDC invalide (state mismatch)' });
    }

    let tokens;
    try {
      tokens = await oidc.exchangeCode(config, code, oidcState.codeVerifier);
    } catch (err) {
      log.error(`OIDC token exchange failed: ${err.message}`);
      return reply.redirect(`${config.publicUrl}/login?oidc_error=${encodeURIComponent('Echec authentification OIDC')}`);
    }

    let claims;
    try {
      claims = await oidc.verifyIdToken(tokens.id_token, config);
    } catch (err) {
      log.error(`OIDC id_token verification failed: ${err.message}`);
      return reply.redirect(`${config.publicUrl}/login?oidc_error=${encodeURIComponent('Token OIDC invalide')}`);
    }

    if (claims.nonce !== oidcState.nonce) {
      return reply.code(400).send({ detail: 'Nonce OIDC invalide' });
    }

    if (!oidc.hasAnyBuildyGroup(claims.groups)) {
      log.warn(`OIDC login rejected: no Buildy group for ${claims.preferred_username || claims.sub}`);
      return reply.redirect(`${config.publicUrl}/login?oidc_error=${encodeURIComponent('Aucun groupe Buildy assigne dans PocketID')}`);
    }

    const sub = claims.sub;
    const issuer = claims.iss;
    const email = claims.email || null;
    const firstName = claims.given_name || null;
    const lastName = claims.family_name || null;
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() ||
                         claims.preferred_username || claims.name || email || sub;

    let user = db.users.getByOidcSub(sub, issuer);
    if (user) {
      db.users.updateProfile(user.id, { email, displayName, firstName, lastName });
      user = db.users.getById(user.id);
    } else {
      const result = db.users.createFromOidc({ sub, issuer, email, displayName, firstName, lastName });
      user = db.users.getById(result.lastInsertRowid);
    }

    db.users.touchLastSeen(user.id);
    issueAccessToken(fastify, reply, user);

    log.info(`OIDC login OK: ${displayName} (${email}) from ${request.ip}`);
    db.auditLog.add({
      userId: user.id,
      action: 'auth.login',
      payload: { method: 'oidc', email, ip: request.ip, user_agent: request.headers['user-agent'] || null },
    });
    return reply.redirect(`${config.publicUrl}/`);
  });

  // GET /auth/me — retourne le user courant
  fastify.get('/auth/me', async (request, reply) => {
    const decoded = request.authUser;
    if (!decoded) return reply.code(401).send({ detail: 'Non authentifie' });
    const user = db.users.getById(decoded.id);
    if (!user) return reply.code(401).send({ detail: 'Utilisateur introuvable' });
    return {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      first_name: user.first_name,
      last_name: user.last_name,
      dev_bypass: !!config.devBypassAuth,
    };
  });

  // POST /auth/logout
  fastify.post('/auth/logout', async (request, reply) => {
    let userId = null;
    try {
      const decoded = fastify.jwt.verify(request.cookies.docs_token);
      if (decoded.jti) db.sessions.revokeByJti(decoded.jti);
      userId = decoded.id || null;
    } catch { /* token invalide deja */ }
    if (userId) {
      db.auditLog.add({
        userId,
        action: 'auth.logout',
        payload: { ip: request.ip, user_agent: request.headers['user-agent'] || null },
      });
    }
    reply.clearCookie('docs_token', { path: '/' });
    return { ok: true };
  });
}

module.exports = routes;
