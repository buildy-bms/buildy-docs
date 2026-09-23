// Compteur / équipement hors service ET intégré à la GTB = non opérationnel.
// Couvre la règle d'écriture (forceNotOperationalWhenOutOfService, appelée
// par les PATCH meters/devices) et le rattrapage de l'existant (mig 204).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { forceNotOperationalWhenOutOfService: force } = require('../src/routes/bacs-audit/_shared');

describe('règle HS + intégré → non opérationnel', () => {
  it('passer intégré sur un compteur déjà HS', () => {
    const body = { managed_by_bms: true };
    force(body, { out_of_service: 1, managed_by_bms: null });
    expect(body.bms_integration_out_of_service).toBe(true);
  });
  it('passer HS un compteur déjà intégré', () => {
    const body = { out_of_service: true };
    force(body, { out_of_service: 0, managed_by_bms: 1 });
    expect(body.bms_integration_out_of_service).toBe(true);
  });
  it('remise en service : on ne touche pas à l\'opérationnel (à revérifier)', () => {
    const body = { out_of_service: false };
    force(body, { out_of_service: 1, managed_by_bms: 1 });
    expect('bms_integration_out_of_service' in body).toBe(false);
  });
  it('HS mais non intégré : rien à forcer', () => {
    const body = { managed_by_bms: false };
    force(body, { out_of_service: 1, managed_by_bms: 1 });
    expect('bms_integration_out_of_service' in body).toBe(false);
  });
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig204-'));
let db;
beforeEach(() => {
  process.env.DATABASE_PATH = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
});
afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

describe('Migration 204 — rattrapage HS + intégré', () => {
  it('passe en non opérationnel les compteurs et équipements HS intégrés, et eux seuls', () => {
    db.init();
    const D = db.db;
    const siteId = D.prepare(`INSERT INTO sites (site_uuid, name) VALUES ('s-204', 'Site')`).run().lastInsertRowid;
    const zoneId = D.prepare(`INSERT INTO zones (site_id, name) VALUES (?, 'Z')`).run(siteId).lastInsertRowid;
    const docId = D.prepare(`INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
      VALUES ('a-204', 'C', 'A', 'bacs_audit', 'redaction', ?)`).run(siteId).lastInsertRowid;
    const sysId = D.prepare(`INSERT INTO bacs_audit_systems (document_id, zone_id, system_category)
      VALUES (?, ?, 'heating')`).run(docId, zoneId).lastInsertRowid;
    const meter = (hs, managed) => D.prepare(`INSERT INTO bacs_audit_meters
      (document_id, zone_id, usage, meter_type, out_of_service, managed_by_bms, bms_integration_out_of_service)
      VALUES (?, ?, 'heating', 'thermal', ?, ?, 0)`).run(docId, zoneId, hs, managed).lastInsertRowid;
    const device = (hs, managed) => D.prepare(`INSERT INTO bacs_audit_system_devices
      (system_id, name, out_of_service, managed_by_bms, bms_integration_out_of_service)
      VALUES (?, 'D', ?, ?, 0)`).run(sysId, hs, managed).lastInsertRowid;
    const mHsManaged = meter(1, 1), mHsOnly = meter(1, 0), mManagedOnly = meter(0, 1);
    const dHsManaged = device(1, 1), dManagedOnly = device(0, 1);
    D.pragma('user_version = 203');

    for (const k of Object.keys(require.cache)) delete require.cache[k];
    db = require('../src/database');
    db.init();
    const flag = (table, id) => db.db.prepare(`SELECT bms_integration_out_of_service f FROM ${table} WHERE id = ?`).get(id).f;
    expect(db.db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(204);
    expect(flag('bacs_audit_meters', mHsManaged)).toBe(1);
    expect(flag('bacs_audit_meters', mHsOnly)).toBe(0);
    expect(flag('bacs_audit_meters', mManagedOnly)).toBe(0);
    expect(flag('bacs_audit_system_devices', dHsManaged)).toBe(1);
    expect(flag('bacs_audit_system_devices', dManagedOnly)).toBe(0);
  });
});
