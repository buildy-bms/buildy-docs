// Tests de la migration 129 : thermal_regulation par niveau (P/D/É).
// Couvre :
//   - Application sur DB neuve (les 6 colonnes nouvelles + 3 anciennes droppées)
//   - Idempotence (la 2e init ne doit rien casser)
//   - Préservation des saisies texte (production_regulation, etc.) qui doivent
//     migrer vers production_notes_html sous forme <p>...</p>
//   - Pas d'<p></p> parasite quand le champ est vide ou NULL
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import Database from 'better-sqlite3';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig129-'));
let db;
let dbPath;

beforeEach(() => {
  dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

function columns(table) {
  return db.db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

describe('Migration 129 — schema', () => {
  it('applique sur DB neuve : 6 colonnes ajoutées, 3 anciennes droppées', () => {
    db.init();
    const cols = columns('bacs_audit_thermal_regulation');
    // Ajouts
    expect(cols).toContain('production_regulation_device_id');
    expect(cols).toContain('distribution_regulation_device_id');
    expect(cols).toContain('emission_regulation_device_id');
    expect(cols).toContain('production_notes_html');
    expect(cols).toContain('distribution_notes_html');
    expect(cols).toContain('emission_notes_html');
    // Retraits
    expect(cols).not.toContain('production_regulation');
    expect(cols).not.toContain('distribution_regulation');
    expect(cols).not.toContain('emission_regulation');
  });

  it('TARGET_VERSION atteint après init', () => {
    db.init();
    const v = db.db.pragma('user_version', { simple: true });
    expect(v).toBeGreaterThanOrEqual(129);
  });

  it('idempotente : 2e init ne casse rien', () => {
    db.init();
    const v1 = db.db.pragma('user_version', { simple: true });
    // Ré-import + ré-init sur le même fichier
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    process.env.DATABASE_PATH = dbPath;
    const db2 = require('../src/database');
    db2.init();
    const v2 = db2.db.pragma('user_version', { simple: true });
    expect(v2).toBe(v1);
  });
});

describe('Migration 129 — préservation des saisies texte', () => {
  it('insère et relit une row avec les 6 nouvelles colonnes (notes par niveau + FK régulation)', () => {
    db.init();
    // Insères directs en SQL pour ne pas dépendre de la signature des wrappers.
    const siteRes = db.db.prepare(`
      INSERT INTO sites (site_uuid, name) VALUES ('mig129-test-uuid', 'Site test')
    `).run();
    const siteId = siteRes.lastInsertRowid;
    const docRes = db.db.prepare(`
      INSERT INTO afs (kind, slug, title, client_name, project_name, site_id) VALUES ('bacs_audit', 'audit-mig129', 'Audit', 'Client', 'Project', ?)
    `).run(siteId);
    const docId = docRes.lastInsertRowid;
    const zoneRes = db.db.prepare(`
      INSERT INTO zones (site_id, name) VALUES (?, 'Zone test')
    `).run(siteId);
    const zoneId = zoneRes.lastInsertRowid;
    db.db.prepare(`
      INSERT INTO bacs_audit_thermal_regulation
        (document_id, zone_id, category, has_automatic_regulation,
         production_notes_html, distribution_notes_html, emission_notes_html)
      VALUES (?, ?, 'heating', 1, ?, ?, ?)
    `).run(docId, zoneId,
      '<p>note prod</p>',
      null,
      '<p>note ém</p>'
    );
    const row = db.db.prepare(`SELECT * FROM bacs_audit_thermal_regulation WHERE document_id = ?`).get(docId);
    expect(row.production_notes_html).toBe('<p>note prod</p>');
    expect(row.distribution_notes_html).toBeNull();
    expect(row.emission_notes_html).toBe('<p>note ém</p>');
    expect(row.production_regulation_device_id).toBeNull();
    expect(row.distribution_regulation_device_id).toBeNull();
    expect(row.emission_regulation_device_id).toBeNull();
  });

  // Le test "vraie copie depuis colonnes texte" nécessiterait de revenir au
  // schéma pré-mig 129. On valide donc la *logique SQL* de copie sur une
  // table-réplique manuelle.
  it('SQL de copie : <p>texte</p> si non vide, NULL si vide ou trim vide', () => {
    const tmp = new Database(':memory:');
    tmp.exec(`
      CREATE TABLE t (
        id INTEGER PRIMARY KEY,
        production_regulation TEXT,
        production_notes_html TEXT
      );
      INSERT INTO t (id, production_regulation) VALUES
        (1, 'sonde extérieure'),
        (2, ''),
        (3, '   '),
        (4, NULL);
      UPDATE t
         SET production_notes_html = '<p>' || production_regulation || '</p>'
       WHERE production_regulation IS NOT NULL AND TRIM(production_regulation) <> '';
    `);
    const rows = tmp.prepare('SELECT id, production_notes_html FROM t ORDER BY id').all();
    expect(rows[0].production_notes_html).toBe('<p>sonde extérieure</p>');
    expect(rows[1].production_notes_html).toBeNull();
    expect(rows[2].production_notes_html).toBeNull();
    expect(rows[3].production_notes_html).toBeNull();
    tmp.close();
  });
});

describe('Migration 129 — FK ON DELETE SET NULL', () => {
  it('supprimer un device pointé par production_regulation_device_id passe la FK à NULL', () => {
    db.init();
    const siteId = db.db.prepare(`INSERT INTO sites (site_uuid, name) VALUES ('mig129-fk-test', 'Site')`).run().lastInsertRowid;
    const docId = db.db.prepare(`INSERT INTO afs (kind, slug, title, client_name, project_name, site_id) VALUES ('bacs_audit', 'audit-mig129', 'Audit', 'Client', 'Project', ?)`).run(siteId).lastInsertRowid;
    const zoneId = db.db.prepare(`INSERT INTO zones (site_id, name) VALUES (?, 'Z')`).run(siteId).lastInsertRowid;
    const systemId = db.db.prepare(`
      INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present)
      VALUES (?, ?, 'heating', 1)
    `).run(docId, zoneId).lastInsertRowid;
    const deviceId = db.db.prepare(`
      INSERT INTO bacs_audit_system_devices (system_id, name, device_role)
      VALUES (?, 'Sonde extérieure', '["regulation"]')
    `).run(systemId).lastInsertRowid;
    const thermalId = db.db.prepare(`
      INSERT INTO bacs_audit_thermal_regulation
        (document_id, zone_id, category, production_regulation_device_id)
      VALUES (?, ?, 'heating', ?)
    `).run(docId, zoneId, deviceId).lastInsertRowid;
    db.db.prepare('DELETE FROM bacs_audit_system_devices WHERE id = ?').run(deviceId);
    const row = db.db.prepare('SELECT production_regulation_device_id FROM bacs_audit_thermal_regulation WHERE id = ?').get(thermalId);
    expect(row.production_regulation_device_id).toBeNull();
  });
});
