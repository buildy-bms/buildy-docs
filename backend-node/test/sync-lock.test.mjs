// Tests du lock de synchronisation Crisp (in-memory) — fix B4.
// Le lock est process-scoped, exposé via __test_* pour les tests unitaires.
// API simple : acquire throw si quelqu'un détient déjà ; pas de réentrance
// automatique — les nested calls passent `{ skipLock: true }` à la fonction.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-lock-test-'));
let acquireSyncLock;
let releaseSyncLock;

beforeEach(() => {
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  const db = require('../src/database');
  db.init();
  // Stub `lib/crisp` pour éviter de dépendre des credentials
  require.cache[require.resolve('../src/lib/crisp')] = {
    id: '', filename: '', loaded: true,
    exports: { loadCrispCredentials: () => null, crispClient: () => ({}), testConnection: () => ({}) },
  };
  ({ __test_acquireSyncLock: acquireSyncLock, __test_releaseSyncLock: releaseSyncLock } = require('../src/lib/faq-sync'));
});

describe('acquireSyncLock / releaseSyncLock', () => {
  it('acquire libre → release → re-acquire OK', () => {
    expect(() => acquireSyncLock('pull')).not.toThrow();
    releaseSyncLock();
    expect(() => acquireSyncLock('push')).not.toThrow();
    releaseSyncLock();
  });

  it('acquire alors que lock détenu → throw 409', () => {
    acquireSyncLock('pull');
    let err;
    try { acquireSyncLock('push'); }
    catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/déjà en cours/);
    releaseSyncLock();
  });

  it('release sans acquire préalable ne crash pas', () => {
    expect(() => releaseSyncLock()).not.toThrow();
  });

  it('release reset le state : nouvelle acquire OK avec un kind différent', () => {
    acquireSyncLock('pull');
    releaseSyncLock();
    expect(() => acquireSyncLock('push')).not.toThrow();
    releaseSyncLock();
  });
});
