'use strict';

const db = require('../database');
const config = require('../config');
const log = require('../lib/logger').auth;
// fetch + Agent du MEME undici (le fetch global de Node embarque une autre
// version → « invalid onRequestStart method » si on melange).
const { Agent, fetch } = require('undici');

// PocketID est souvent en self-signed cert (NetBird). On accepte ces certs
// uniquement pour les fetch PocketID, pas globalement.
const POCKETID_DISPATCHER = new Agent({ connect: { rejectUnauthorized: false } });

// Cache des users PocketID (évite de hammer l'API à chaque autocomplete).
let _pocketidCache = { ts: 0, users: [] };
const POCKETID_CACHE_TTL_MS = 60_000;

async function fetchPocketidUsers() {
  if (!config.pocketidApiKey || !config.pocketidApiUrl) return [];
  if (Date.now() - _pocketidCache.ts < POCKETID_CACHE_TTL_MS) return _pocketidCache.users;
  try {
    const url = `${config.pocketidApiUrl.replace(/\/$/, '')}/api/users?pageSize=200`;
    const res = await fetch(url, {
      headers: { 'X-API-Key': config.pocketidApiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
      dispatcher: POCKETID_DISPATCHER,
    });
    if (!res.ok) {
      log.warn(`PocketID /api/users HTTP ${res.status}`);
      return _pocketidCache.users;
    }
    const body = await res.json();
    // PocketID retourne { data: [...], pagination: {...} } ou directement [...] selon version
    const list = Array.isArray(body) ? body : (body.data || []);
    const normalized = list.map(u => ({
      // pocketid_id : id PocketID (uuid). Pas d'id local en DB Docs tant
      // que l'user ne s'est pas loggé. On préfixe pour distinguer.
      id: u.id ? `pocketid:${u.id}` : null,
      pocketid_id: u.id || null,
      email: u.email || null,
      display_name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.email,
      first_name: u.firstName || null,
      last_name: u.lastName || null,
      groups: (u.userGroups || []).map(g => g.name || g),
      _source: 'pocketid',
    })).filter(u => u.email);
    _pocketidCache = { ts: Date.now(), users: normalized };
    return normalized;
  } catch (e) {
    log.warn(`Fetch PocketID users échoué: ${e.message}`);
    return _pocketidCache.users;
  }
}

async function fetchPocketidUserById(pocketidId) {
  if (!config.pocketidApiKey || !config.pocketidApiUrl || !pocketidId) return null;
  try {
    const url = `${config.pocketidApiUrl.replace(/\/$/, '')}/api/users/${encodeURIComponent(pocketidId)}`;
    const res = await fetch(url, {
      headers: { 'X-API-Key': config.pocketidApiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
      dispatcher: POCKETID_DISPATCHER,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function routes(fastify) {
  // GET /api/users — liste des utilisateurs (pour autocomplete partage AF/audit)
  // Combine : utilisateurs locaux (déjà loggés sur Docs) + utilisateurs
  // PocketID (si POCKETID_API_KEY configurée). Dédup par email.
  fastify.get('/users', async (request) => {
    const search = (request.query.q || '').trim().toLowerCase();
    const localRows = db.db.prepare(`
      SELECT id, email, display_name, first_name, last_name, last_seen_at
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY display_name, email
    `).all().map(u => ({ ...u, _source: 'local' }));

    const pocketidRows = await fetchPocketidUsers();
    const byEmail = new Map();
    // Local d'abord (id numérique réutilisable côté permissions)
    for (const u of localRows) byEmail.set((u.email || '').toLowerCase(), u);
    // PocketID complète seulement les emails absents du local
    for (const u of pocketidRows) {
      const k = (u.email || '').toLowerCase();
      if (!byEmail.has(k)) byEmail.set(k, u);
    }
    let merged = [...byEmail.values()];

    if (search.length >= 2) {
      merged = merged.filter(u =>
        (u.display_name || '').toLowerCase().includes(search) ||
        (u.email || '').toLowerCase().includes(search)
      );
    }
    merged.sort((a, b) =>
      (a.display_name || a.email || '').localeCompare(b.display_name || b.email || '')
    );
    return merged.slice(0, 50);
  });

  // POST /api/users/ensure-by-pocketid-id
  // Crée (ou retourne) un utilisateur local dont l'oidc_sub = pocketid id.
  // Permet de poser des permissions sur des collègues qui ne se sont pas
  // encore loggés sur Docs. Au prochain login OIDC, getByOidcSub retrouve
  // l'enregistrement et complète le profil via updateProfile.
  fastify.post('/users/ensure-by-pocketid-id', async (request, reply) => {
    const { pocketid_id } = request.body || {};
    if (!pocketid_id) return reply.code(400).send({ detail: 'pocketid_id requis' });

    const issuer = config.oidcIssuer || '';
    let user = db.users.getByOidcSub(pocketid_id, issuer);
    if (user) return user;

    // Pas en local : on fetch les infos depuis PocketID pour pré-remplir le profil
    const pid = await fetchPocketidUserById(pocketid_id);
    if (!pid) return reply.code(404).send({ detail: 'Utilisateur PocketID introuvable' });

    const result = db.users.createFromOidc({
      sub: pocketid_id,
      issuer,
      email: pid.email || null,
      displayName: [pid.firstName, pid.lastName].filter(Boolean).join(' ') || pid.username || pid.email,
      firstName: pid.firstName || null,
      lastName: pid.lastName || null,
    });
    return db.users.getById(result.lastInsertRowid);
  });
}

module.exports = routes;
