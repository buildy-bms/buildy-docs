'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./lib/logger').system;

let db;

function init() {
  const dir = path.dirname(config.databasePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Migrations minimales (Lot 1) — users + sessions OIDC.
  // Les tables AF, equipment_templates, etc. arrivent au Lot 2.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      oidc_sub TEXT NOT NULL,
      oidc_issuer TEXT NOT NULL,
      email TEXT,
      display_name TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT,
      UNIQUE(oidc_sub, oidc_issuer)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      jti TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      is_revoked INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  log.info(`Database ready at ${config.databasePath}`);
}

// ── Users ──
const users = {
  getById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  getByOidcSub(sub, issuer) {
    return db.prepare('SELECT * FROM users WHERE oidc_sub = ? AND oidc_issuer = ?').get(sub, issuer);
  },
  createFromOidc({ sub, issuer, email, displayName, firstName, lastName }) {
    return db.prepare(`
      INSERT INTO users (oidc_sub, oidc_issuer, email, display_name, first_name, last_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sub, issuer, email || null, displayName || null, firstName || null, lastName || null);
  },
  updateProfile(id, { email, displayName, firstName, lastName }) {
    db.prepare(`
      UPDATE users SET email = ?, display_name = ?, first_name = ?, last_name = ?
      WHERE id = ?
    `).run(email || null, displayName || null, firstName || null, lastName || null, id);
  },
  touchLastSeen(id) {
    db.prepare('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },
  // Pour DEV_BYPASS_AUTH : retourne (et cree au besoin) un user fictif.
  ensureDevUser(email, displayName) {
    const existing = db.prepare('SELECT * FROM users WHERE oidc_sub = ?').get('dev-bypass');
    if (existing) return existing;
    const result = db.prepare(`
      INSERT INTO users (oidc_sub, oidc_issuer, email, display_name)
      VALUES ('dev-bypass', 'local-dev', ?, ?)
    `).run(email, displayName);
    return this.getById(result.lastInsertRowid);
  },
};

// ── Sessions ──
const sessions = {
  create(userId, jti, expiresAt) {
    return db.prepare(`
      INSERT INTO sessions (user_id, jti, expires_at)
      VALUES (?, ?, ?)
    `).run(userId, jti, expiresAt);
  },
  getByJti(jti) {
    return db.prepare('SELECT * FROM sessions WHERE jti = ?').get(jti);
  },
  revokeByJti(jti) {
    db.prepare('UPDATE sessions SET is_revoked = 1 WHERE jti = ?').run(jti);
  },
  deleteExpired() {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  },
};

module.exports = { init, users, sessions, get db() { return db; } };
