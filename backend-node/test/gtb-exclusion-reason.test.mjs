// Motif d'un équipement « pas à raccorder » à la GTB (mig 217, demande de Kévin 2026-10-15) :
// unité extérieure de DRV pilotée par ses unités intérieures, raccordées par une passerelle.
// Exigé pour une production (chauffage, froid, ventilation, eau chaude), facultatif ailleurs ;
// un motif lève le point « Générateur exclu de la GTB » (DEV-007) du pré-contrôle.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { deviceMissingItems } from '../../frontend/src/lib/audit-options.js';
import { MISSING_SHORT } from '../../frontend/src/lib/systems-guide.js';
const require = createRequire(import.meta.url);

const ue = (extra = {}) => ({
  id: 1, name: 'Unité extérieure', device_role: ['production'], energy_source: 'electric', power_kw: 40,
  is_communicating: false, gtb_scope_override: 0, serves_multiple_buildings: 0, is_backup: 0, out_of_service: 0,
  has_regulation: 0, ...extra,
});

describe('Motif « pas à raccorder » : complétude', () => {
  it('exigé pour une production de froid déclarée « pas à raccorder », levé par un motif', () => {
    const keys = (d) => deviceMissingItems(d, 'cooling').map((m) => m.key);
    expect(keys(ue())).toContain('gtb_exclusion_reason');
    expect(keys(ue({ gtb_exclusion_reason: 'Piloté par les unités intérieures' }))).not.toContain('gtb_exclusion_reason');
    expect(keys(ue({ gtb_exclusion_reason: '   ' }))).toContain('gtb_exclusion_reason');
  });
  it('facultatif pour un émetteur, sans objet quand l’équipement est à raccorder', () => {
    expect(deviceMissingItems(ue({ device_role: ['emission'] }), 'heating').map((m) => m.key)).not.toContain('gtb_exclusion_reason');
    expect(deviceMissingItems(ue({ gtb_scope_override: null }), 'cooling').map((m) => m.key)).not.toContain('gtb_exclusion_reason');
  });
  it('a son libellé court dans le guide', () => {
    const item = deviceMissingItems(ue(), 'cooling').find((m) => m.key === 'gtb_exclusion_reason');
    expect(MISSING_SHORT[item.label]).toBeTruthy();
  });
});

describe('Motif « pas à raccorder » : pré-contrôle DEV-007 et migration 217', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig217-'));
  let db; let buildPrecheck; let deviceId; let systemId; let auditId;
  beforeAll(() => {
    process.env.DATABASE_PATH = path.join(tmpDir, 'db.sqlite');
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    db = require('../src/database');
    db.init();
    ({ buildPrecheck } = require('../src/lib/bacs-audit-precheck'));
    const D = db.db;
    const siteId = D.prepare(`INSERT INTO sites (site_uuid, name) VALUES ('s-217', 'Site')`).run().lastInsertRowid;
    const zoneId = D.prepare(`INSERT INTO zones (site_id, name) VALUES (?, 'Z')`).run(siteId).lastInsertRowid;
    auditId = D.prepare(`INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
      VALUES ('a-217', 'C', 'A', 'bacs_audit', 'draft', ?)`).run(siteId).lastInsertRowid;
    systemId = D.prepare(`INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present)
      VALUES (?, ?, 'cooling', 1)`).run(auditId, zoneId).lastInsertRowid;
    deviceId = D.prepare(`INSERT INTO bacs_audit_system_devices (system_id, name, device_role, gtb_scope_override)
      VALUES (?, 'UE DRV', '["production"]', 0)`).run(systemId).lastInsertRowid;
  });
  afterAll(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } });
  const dev007 = () => (buildPrecheck(auditId).warnings || []).filter((w) => w.code === 'DEV-007');

  it('la migration crée la colonne du motif', () => {
    const cols = db.db.prepare('PRAGMA table_info(bacs_audit_system_devices)').all().map((c) => c.name);
    expect(cols).toContain('gtb_exclusion_reason');
    expect(db.db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(217);
  });
  it('signale une production « pas à raccorder » sans motif, plus avec un motif', () => {
    expect(dev007()).toHaveLength(1);
    db.db.prepare('UPDATE bacs_audit_system_devices SET gtb_exclusion_reason = ? WHERE id = ?')
      .run('Piloté par les unités intérieures, raccordées à la GTB par une passerelle', deviceId);
    expect(dev007()).toHaveLength(0);
  });
  it('ne signale pas un système exempté par la règle des 5 %', () => {
    db.db.prepare('UPDATE bacs_audit_system_devices SET gtb_exclusion_reason = NULL WHERE id = ?').run(deviceId);
    db.db.prepare('UPDATE bacs_audit_systems SET marked_negligible_under_5pct = 1 WHERE id = ?').run(systemId);
    expect(dev007()).toHaveLength(0);
  });
});
