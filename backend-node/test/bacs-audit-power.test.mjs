// Cumul R175-2 chaud / froid (bacs-audit-power.js). Cas réels : Sénas (DRV
// rattaché au froid, partagé vers le chauffage → chaud cumulé 0 kW) et
// Communay (split non réversible en froid compté à tort en chaud).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { devicePowerContribution } = require('../src/lib/bacs-audit-power');
const PROD = JSON.stringify(['production']);

describe('devicePowerContribution — machines thermodynamiques', () => {
  it('Communay : split non réversible en froid → froid seul', () => {
    const c = devicePowerContribution({ system_category: 'cooling', device_role: PROD, energy_source: 'electric', power_kw: 3 });
    expect([c.heat, c.cool]).toEqual([0, 3]);
  });
  it('Sénas : DRV rattaché au froid, partagé en chauffage → chaud ET froid', () => {
    const c = devicePowerContribution({
      system_category: 'cooling', device_role: PROD, energy_source: 'electric',
      power_kw: 100, power_kw_cooling: 111, shared_to_heating: 1,
    });
    expect([c.heat, c.cool]).toEqual([100, 111]);
  });
  it('réversible avec une seule puissance saisie : comptée des deux côtés', () => {
    const c = devicePowerContribution({
      system_category: 'cooling', device_role: PROD, energy_source: 'electric',
      power_kw: 50, shared_to_heating: 1,
    });
    expect([c.heat, c.cool]).toEqual([50, 50]);
  });
  it('émetteur partagé en chauffage : toujours hors cumul', () => {
    const c = devicePowerContribution({
      system_category: 'cooling', device_role: JSON.stringify(['emission']),
      power_kw: 5, shared_to_heating: 1,
    });
    expect(c.inScope).toBe(false);
    expect([c.heat, c.cool]).toEqual([0, 0]);
  });
  it('réversible rattaché au chauffage : inchangé', () => {
    const c = devicePowerContribution({
      system_category: 'heating', device_role: PROD, energy_source: 'electric',
      power_calculation_type: 'thermodynamic_max', power_kw: 40, power_kw_cooling: 35,
    });
    expect([c.heat, c.cool]).toEqual([40, 35]);
  });
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-power-test-'));
let db;
beforeEach(() => {
  process.env.DATABASE_PATH = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
});
afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

describe('recomputeAndPersistAuditPower — partage vers chauffage lu en base', () => {
  it('Sénas : chaud cumulé non nul, puissance retenue = max(chaud, froid)', () => {
    const { recomputeAndPersistAuditPower } = require('../src/lib/bacs-audit-power');
    const D = db.db;
    const siteId = D.prepare(`INSERT INTO sites (site_uuid, name) VALUES ('s-pow', 'Site')`).run().lastInsertRowid;
    const zoneId = D.prepare(`INSERT INTO zones (site_id, name) VALUES (?, 'Bureaux')`).run(siteId).lastInsertRowid;
    const docId = D.prepare(`INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
      VALUES ('a-pow', 'C', 'A', 'bacs_audit', 'redaction', ?)`).run(siteId).lastInsertRowid;
    const sys = (cat) => D.prepare(`INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present)
      VALUES (?, ?, ?, 1)`).run(docId, zoneId, cat).lastInsertRowid;
    const cooling = sys('cooling'), heating = sys('heating');
    const drv = D.prepare(`INSERT INTO bacs_audit_system_devices
      (system_id, name, device_role, energy_source, power_kw, power_kw_cooling)
      VALUES (?, 'UE DRV', ?, 'electric', 125, 111)`).run(cooling, PROD).lastInsertRowid;
    D.prepare('INSERT INTO bacs_audit_device_shared_systems (device_id, system_id) VALUES (?, ?)').run(drv, heating);
    const auto = recomputeAndPersistAuditPower(D, docId);
    expect(auto.heatKw).toBe(125);
    expect(auto.coolKw).toBe(111);
    expect(auto.retainedKw).toBe(125);
  });
});
