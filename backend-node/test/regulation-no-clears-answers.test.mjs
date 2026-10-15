// « L'équipement dispose-t-il d'une régulation ? » = Non : les réponses de
// régulation de la fiche deviennent cachées et sont effacées. Couvre la règle
// d'écriture (clearRegulationAnswersOnNo, appelée par le PATCH devices) et le
// rattrapage de l'existant (mig 215).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const {
  clearRegulationAnswersOnNo: clear,
  REGULATION_ANSWER_FIELDS: FIELDS,
} = require('../src/routes/bacs-audit/_shared');

describe('règle d\'écriture : passage à « Non »', () => {
  it('Oui → Non : toutes les réponses de régulation sont effacées', () => {
    const body = { has_regulation: false };
    clear(body, { has_regulation: 1 });
    expect(Object.keys(body)).toEqual(['has_regulation', ...FIELDS]);
    for (const k of FIELDS) expect(body[k]).toBeNull();
  });
  it('sans réponse → Non : idem', () => {
    const body = { has_regulation: false };
    clear(body, { has_regulation: null });
    for (const k of FIELDS) expect(body[k]).toBeNull();
  });
  it('une valeur envoyée dans la même requête est respectée', () => {
    const body = { has_regulation: false, regulation_type_distribution: 'equilibrage' };
    clear(body, { has_regulation: 1 });
    expect(body.regulation_type_distribution).toBe('equilibrage');
    expect(body.regulation_integrated).toBeNull();
  });
  it('déjà à « Non » : rien n\'est effacé (type choisi depuis l\'étape Régulation)', () => {
    const body = { has_regulation: false, name: 'Circuit' };
    clear(body, { has_regulation: 0 });
    expect(body).toEqual({ has_regulation: false, name: 'Circuit' });
  });
  it('Oui, sans réponse, ou question absente de la requête : rien à effacer', () => {
    const cases = [
      [{ has_regulation: true }, { has_regulation: 0 }],
      [{ has_regulation: null }, { has_regulation: 1 }],
      [{ regulation_type_distribution: 'equilibrage' }, { has_regulation: 0 }],
    ];
    for (const [body, row] of cases) {
      const before = { ...body };
      clear(body, row);
      expect(body).toEqual(before);
    }
  });
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig215-'));
let db;
beforeEach(() => {
  process.env.DATABASE_PATH = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
});
afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

function replay215() {
  db.db.pragma('user_version = 214');
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
}

describe('Migration 215 — réponses de régulation restées derrière un « Non »', () => {
  it('efface les réponses cachées, et elles seules', () => {
    db.init();
    const D = db.db;
    const siteId = D.prepare(`INSERT INTO sites (site_uuid, name) VALUES ('s-215', 'Site')`).run().lastInsertRowid;
    const zoneId = D.prepare(`INSERT INTO zones (site_id, name) VALUES (?, 'Z')`).run(siteId).lastInsertRowid;
    const audit = (slug, status) => D.prepare(`INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
      VALUES (?, 'C', 'A', 'bacs_audit', ?, ?)`).run(slug, status, siteId).lastInsertRowid;
    const docId = audit('a-215', 'redaction');
    const deliveredId = audit('a-215-livree', 'livree');
    const system = (doc, cat) => D.prepare(`INSERT INTO bacs_audit_systems (document_id, zone_id, system_category)
      VALUES (?, ?, ?)`).run(doc, zoneId, cat).lastInsertRowid;
    const lighting = system(docId, 'lighting_indoor');
    const heating = system(docId, 'heating');
    const deliveredLighting = system(deliveredId, 'lighting_indoor');
    const device = (sysId, fields) => {
      const cols = Object.keys(fields);
      return D.prepare(`INSERT INTO bacs_audit_system_devices (system_id, name, ${cols.join(', ')})
        VALUES (?, 'D', ${cols.map(() => '?').join(', ')})`).run(sysId, ...Object.values(fields)).lastInsertRowid;
    };
    // Une valeur pour chacune des réponses de la règle d'écriture : la migration
    // doit effacer exactement la même liste.
    const ALL = {
      regulation_integrated: 0, regulation_granularity: 'per_room',
      regulation_type_production: 'loi_d_eau', regulation_type_distribution: 'vanne_3_voies',
      regulation_type_emission: 'thermostat_ambiant',
      regulator_brand: 'Siemens', regulator_model_reference: 'RVS46', regulator_location_zone_id: zoneId,
      regulator_location_production: 'Chaufferie', regulator_location_distribution: 'Chaufferie',
      regulator_location_emission: 'Bureau',
    };
    expect(Object.keys(ALL).sort()).toEqual([...FIELDS].sort());

    const lightNo = device(lighting, { has_regulation: 0, regulation_integrated: 1, regulation_type_emission: 'detection_presence' });
    const allNo = device(heating, { has_regulation: 0, ...ALL });
    const circuit = device(heating, { has_regulation: 0, regulation_type_distribution: 'equilibrage' });
    const extra = device(heating, { has_regulation: 0, regulation_integrated: 0 });
    const yes = device(lighting, { has_regulation: 1, regulation_integrated: 1, regulation_type_emission: 'detection_presence' });
    const unanswered = device(lighting, { regulation_type_emission: 'detection_presence' });
    const delivered = device(deliveredLighting, { has_regulation: 0, regulation_integrated: 1 });
    // Étape Régulation : le circuit y est désigné, l'autre équipement y figure en
    // complément ; une liste illisible ne doit pas faire échouer la migration.
    D.prepare(`INSERT INTO bacs_audit_thermal_regulation
      (document_id, zone_id, category, system_id, distribution_device_id, distribution_extra_device_ids, emission_extra_device_ids)
      VALUES (?, ?, 'heating', ?, ?, ?, 'pas une liste')`).run(docId, zoneId, heating, circuit, JSON.stringify([extra]));
    const updatedAt = D.prepare('SELECT updated_at u FROM bacs_audit_system_devices WHERE id = ?').get(lightNo).u;

    replay215();
    const row = (id) => db.db.prepare('SELECT * FROM bacs_audit_system_devices WHERE id = ?').get(id);
    expect(db.db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(215);
    expect(row(lightNo)).toMatchObject({ has_regulation: 0, regulation_integrated: null, regulation_type_emission: null });
    expect(row(lightNo).updated_at).toBe(updatedAt);
    for (const k of FIELDS) expect(row(allNo)[k]).toBeNull();
    expect(row(circuit).regulation_type_distribution).toBe('equilibrage');
    expect(row(extra).regulation_integrated).toBe(0);
    expect(row(yes)).toMatchObject({ regulation_integrated: 1, regulation_type_emission: 'detection_presence' });
    expect(row(unanswered).regulation_type_emission).toBe('detection_presence');
    expect(row(delivered).regulation_integrated).toBe(1);

    // Rejouable : un second passage ne change plus rien.
    const snapshot = db.db.prepare('SELECT * FROM bacs_audit_system_devices ORDER BY id').all();
    replay215();
    expect(db.db.prepare('SELECT * FROM bacs_audit_system_devices ORDER BY id').all()).toEqual(snapshot);
  });
});
