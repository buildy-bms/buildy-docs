'use strict';

const crypto = require('crypto');
const { Agent } = require('undici');

// PocketID tourne en HTTPS auto-signe sur le VPS Jelastic. Node refuse
// les certs invalides par defaut → on declare un dispatcher dedie OIDC
// qui les accepte (uniquement pour les fetch OIDC, pas globalement).
const oidcDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
const oidcFetch = (url, opts = {}) => fetch(url, { ...opts, dispatcher: oidcDispatcher });

// Lazy-load jose (ESM-only)
let _jose;
async function jose() {
  if (!_jose) _jose = await import('jose');
  return _jose;
}

const cache = { discovery: null, discoveryAt: 0, jwks: null, jwksAt: 0 };
const TTL = 3600_000; // 1h

async function discoverOidc(issuerUrl) {
  if (cache.discovery && Date.now() - cache.discoveryAt < TTL) return cache.discovery;
  const url = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await oidcFetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText} (URL: ${url})`);
  cache.discovery = await res.json();
  cache.discoveryAt = Date.now();
  return cache.discovery;
}

async function fetchJwks(jwksUri) {
  if (cache.jwks && Date.now() - cache.jwksAt < TTL) return cache.jwks;
  const { createRemoteJWKSet, customFetch } = await jose();
  cache.jwks = createRemoteJWKSet(new URL(jwksUri), { [customFetch]: oidcFetch });
  cache.jwksAt = Date.now();
  return cache.jwks;
}

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge: challenge };
}

function generateOidcParams() {
  return {
    state: crypto.randomBytes(16).toString('base64url'),
    nonce: crypto.randomBytes(16).toString('base64url'),
    ...generatePkce(),
  };
}

async function getAuthorizationUrl(config, params) {
  const discovery = await discoverOidc(config.oidcIssuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('client_id', config.oidcClientId);
  url.searchParams.set('redirect_uri', config.oidcRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email groups');
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function exchangeCode(config, code, codeVerifier) {
  const discovery = await discoverOidc(config.oidcIssuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.oidcClientId,
    client_secret: config.oidcClientSecret,
    code,
    redirect_uri: config.oidcRedirectUri,
    code_verifier: codeVerifier,
  });
  const res = await oidcFetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function verifyIdToken(idToken, config) {
  const discovery = await discoverOidc(config.oidcIssuer);
  const jwks = await fetchJwks(discovery.jwks_uri);
  const { jwtVerify } = await jose();
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: discovery.issuer,
    audience: config.oidcClientId,
  });
  return payload;
}

// On accepte tous les groupes Buildy (admin, integrator, viewer, partner) — la
// granularite role/permission viendra plus tard. Pour l'instant : connecte =
// peut tout faire. Si aucun groupe Buildy → refus.
function hasAnyBuildyGroup(groups) {
  if (!Array.isArray(groups)) return false;
  return groups.some(g => /^buildy-/.test(g));
}

module.exports = {
  generateOidcParams,
  getAuthorizationUrl,
  exchangeCode,
  verifyIdToken,
  hasAnyBuildyGroup,
};
