// Tests d'integration sur le generateur d'actions correctives R175.
// On cree une DB SQLite ephemere par test (DATABASE_PATH env override),
// applique le schema via runMigrations, seed quelques entites, puis
// verifie que la liste cible des actions correspond aux gaps R175 attendus.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-test-'));

let db;          // DAO singleton
let computeTargetActions;

beforeEach(() => {
  // Chaque test a sa propre DB (DATABASE_PATH lu au require de config).
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  // Reset les caches require pour relire la config + reinitialiser db
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
  ({ computeTargetActions } = require('../src/lib/bacs-audit-action-generator'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

function seedAudit({ withInspection, inspectionFuture, withBms, bmsFlags } = {}) {
  // Site + zone + AF (kind=bacs_audit)
  const siteRes = db.db.prepare(
    `INSERT INTO sites (site_uuid, name, address) VALUES (?, ?, ?)`
  ).run('site-test-' + Math.random(), 'Test Site', '1 rue Test');
  const siteId = siteRes.lastInsertRowid;

  const zoneRes = db.db.prepare(
    `INSERT INTO zones (site_id, name, position) VALUES (?, ?, 0)`
  ).run(siteId, 'Bureau');
  const zoneId = zoneRes.lastInsertRowid;

  const afRes = db.db.prepare(
    `INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
     VALUES (?, ?, ?, 'bacs_audit', 'redaction', ?)`
  ).run('test-' + Date.now() + '-' + Math.random(), 'Client test', 'Audit test', siteId);
  const afId = afRes.lastInsertRowid;

  if (withBms) {
    const cols = Object.keys(bmsFlags || {}).join(', ');
    const placeholders = Object.keys(bmsFlags || {}).map(() => '?').join(', ');
    const values = Object.values(bmsFlags || {});
    db.db.prepare(
      `INSERT INTO bacs_audit_bms (document_id${cols ? ', ' + cols : ''}) VALUES (?${cols ? ', ' + placeholders : ''})`
    ).run(afId, ...values);
  }

  if (withInspection) {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    db.db.prepare(
      `INSERT INTO bacs_audit_inspections (document_id, last_inspection_date, next_inspection_due_date)
       VALUES (?, ?, ?)`
    ).run(
      afId,
      past.toISOString().slice(0, 10),
      (inspectionFuture ? future : past).toISOString().slice(0, 10),
    );
  }

  return { afId, siteId, zoneId };
}

describe('bacs-audit-action-generator — R175 compliance', () => {
  it('R175-5-1 : aucune inspection => action "Programmer une inspection"', () => {
    const { afId } = seedAudit({});
    const target = [...computeTargetActions(afId).values()];
    const insp = target.find(t => t.r175_article === 'R175-5-1');
    expect(insp).toBeTruthy();
    expect(insp.title).toMatch(/Programmer une inspection/i);
  });

  it('R175-5-1 : echeance future => pas d\'action', () => {
    const { afId } = seedAudit({ withInspection: true, inspectionFuture: true });
    const target = [...computeTargetActions(afId).values()];
    const insp = target.find(t => t.r175_article === 'R175-5-1');
    expect(insp).toBeFalsy();
  });

  it('R175-5-1 : echeance depassee => action "replanifier"', () => {
    const { afId } = seedAudit({ withInspection: true, inspectionFuture: false });
    const target = [...computeTargetActions(afId).values()];
    const insp = target.find(t => t.r175_article === 'R175-5-1');
    expect(insp).toBeTruthy();
    expect(insp.title).toMatch(/depass|replanifier/i);
  });

  it('R175-3 §1 : meets_r175_3_p1=0 => action archivage', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { meets_r175_3_p1: 0 } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-3 §1');
    expect(a).toBeTruthy();
  });

  it('R175-4 : has_maintenance_procedures=0 => action consignes maintenance', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { has_maintenance_procedures: 0 } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-4');
    expect(a).toBeTruthy();
    expect(a.title).toMatch(/consignes/i);
  });

  it('R175-5 : operator_trained=0 (non-Buildy) => action formation', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { operator_trained: 0, existing_solution: 'Trend' } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-5');
    expect(a).toBeTruthy();
  });

  it('R175-5 : operator_trained=0 mais solution Buildy => pas d\'action (couverte)', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { operator_trained: 0, existing_solution: 'Buildy supervision' } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-5');
    expect(a).toBeFalsy();
  });

  it('Toutes les capacites GTB ok => pas d\'action GTB', () => {
    const { afId } = seedAudit({
      withInspection: true, inspectionFuture: true,
      withBms: true,
      bmsFlags: {
        meets_r175_3_p1: 1, meets_r175_3_p2: 1,
        has_maintenance_procedures: 1, operator_trained: 1,
        data_provision_to_manager: 1, data_provision_to_operators: 1,
      },
    });
    const target = [...computeTargetActions(afId).values()];
    const r175 = target.filter(t => t.source_table === 'bms');
    expect(r175).toHaveLength(0);
  });
});

// Reproduit l'audit Sénas (2026-09) : cellule sans chauffage (système absent
// créé d'office par l'inventaire) + bureaux VRF dont l'unité intérieure est
// « Thermostat ambiant » / « Par pièce ». Aucune action R175-6 attendue.
describe('bacs-audit-action-generator — R175-6 régulation thermique', () => {
  function seedThermal({ present, emitter } = {}) {
    const { afId, zoneId } = seedAudit({});
    db.db.prepare('UPDATE afs SET bacs_building_permit_date = ? WHERE id = ?').run('2022-01-01', afId);
    const sysId = db.db.prepare(
      `INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present) VALUES (?, ?, 'heating', ?)`
    ).run(afId, zoneId, present).lastInsertRowid;
    let emitId = null;
    if (emitter) {
      emitId = db.db.prepare(
        `INSERT INTO bacs_audit_system_devices (system_id, name, device_role, regulation_type_emission, regulation_granularity)
         VALUES (?, 'Unité intérieure', '["emission","regulation"]', ?, ?)`
      ).run(sysId, emitter.type ?? null, emitter.granularity ?? null).lastInsertRowid;
    }
    db.db.prepare(
      `INSERT INTO bacs_audit_thermal_regulation (document_id, zone_id, system_id, category, has_automatic_regulation, emission_device_id)
       VALUES (?, ?, ?, 'heating', 0, ?)`
    ).run(afId, zoneId, sysId, emitId);
    return [...computeTargetActions(afId).values()].filter(t => t.r175_article === 'R175-6');
  }

  it('chauffage déclaré absent => pas d\'action', () => {
    expect(seedThermal({ present: 0 })).toHaveLength(0);
  });

  it('émetteur « Thermostat ambiant » + granularité « Par pièce » => pas d\'action', () => {
    expect(seedThermal({ present: 1, emitter: { type: 'thermostat_ambiant', granularity: 'per_room' } })).toHaveLength(0);
  });

  it('granularité dérivée du type (sonde de zone, sans saisie explicite) => pas d\'action', () => {
    expect(seedThermal({ present: 1, emitter: { type: 'sonde_zone' } })).toHaveLength(0);
  });

  it('granularité explicite « Centralisée » prime sur le type => action', () => {
    expect(seedThermal({ present: 1, emitter: { type: 'thermostat_ambiant', granularity: 'central_only' } })).toHaveLength(1);
  });

  it('chauffage présent sans émetteur lié => action', () => {
    expect(seedThermal({ present: 1 })).toHaveLength(1);
  });
});
