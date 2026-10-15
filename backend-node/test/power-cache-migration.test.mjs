// Migration 216 — puissance enregistrée périmée (cache du cumul des équipements en calcul automatique).
// Rejoue la migration sur une base neuve : seuls les audits BACS non livrés en calcul automatique
// voient leur puissance (et leur statut) recalculés ; saisie à la main et audits livrés intacts.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig216-'));
let db;
beforeEach(() => {
  process.env.DATABASE_PATH = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
});
afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

function replay216() {
  db.db.pragma('user_version = 215');
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
}

describe('Migration 216 — puissance enregistrée périmée', () => {
  it('recalcule le cache des audits non livrés en calcul automatique, et lui seul', () => {
    db.init();
    const D = db.db;
    const siteId = D.prepare(`INSERT INTO sites (site_uuid, name) VALUES ('s-216', 'Site')`).run().lastInsertRowid;
    const zoneId = D.prepare(`INSERT INTO zones (site_id, name) VALUES (?, 'Z')`).run(siteId).lastInsertRowid;
    // Cache ancien : 120 kW (concerné en 2030) alors que la chaudière fait 300 kW (concerné en 2025).
    const audit = (slug, status, source) => {
      const id = D.prepare(`INSERT INTO afs (slug, client_name, project_name, kind, status, site_id,
          bacs_total_power_kw, bacs_total_power_source, bacs_building_permit_date,
          bacs_applicability_status, bacs_applicable_deadline)
        VALUES (?, 'C', 'A', 'bacs_audit', ?, ?, 120, ?, '2015-01-01', 'subject_2030', '2030-01-01')`)
        .run(slug, status, siteId, source).lastInsertRowid;
      const sys = D.prepare(`INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present)
        VALUES (?, ?, 'heating', 1)`).run(id, zoneId).lastInsertRowid;
      D.prepare(`INSERT INTO bacs_audit_system_devices (system_id, name, device_role, power_kw)
        VALUES (?, 'Chaudière', 'production', 300)`).run(sys);
      return id;
    };
    const auto = audit('a-216-auto', 'redaction', 'auto');
    const manual = audit('a-216-manuel', 'redaction', 'manual_override');
    const delivered = audit('a-216-livre', 'livree', 'auto');
    const row = (id) => D.prepare(`SELECT bacs_total_power_kw AS kw, bacs_total_power_source AS src,
      bacs_applicability_status AS st, updated_at FROM afs WHERE id = ?`).get(id);
    const before = { auto: row(auto), manual: row(manual), delivered: row(delivered) };

    replay216();

    expect(row(auto)).toMatchObject({ kw: 300, src: 'auto', st: 'subject_2025', updated_at: before.auto.updated_at });
    expect(row(manual)).toMatchObject({ kw: 120, src: 'manual_override' });
    expect(row(delivered)).toEqual(before.delivered);
    expect(db.db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(216);

    // Rejouable : rien ne bouge au second passage.
    const once = row(auto);
    replay216();
    expect(row(auto)).toEqual(once);
  });
});
