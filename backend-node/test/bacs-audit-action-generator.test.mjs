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
let computeMeterPlanStatus;

beforeEach(() => {
  // Chaque test a sa propre DB (DATABASE_PATH lu au require de config).
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  // Reset les caches require pour relire la config + reinitialiser db
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
  ({ computeTargetActions, computeMeterPlanStatus } = require('../src/lib/bacs-audit-action-generator'));
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
  it('R175-5-1 : aucune inspection => action "Faire réaliser l\'inspection"', () => {
    const { afId } = seedAudit({});
    const target = [...computeTargetActions(afId).values()];
    const insp = target.find(t => t.r175_article === 'R175-5-1');
    expect(insp).toBeTruthy();
    expect(insp.title).toMatch(/Faire réaliser l'inspection périodique/i);
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

  it('R175-3 1° : meets_r175_3_p1=0 => action suivi horaire', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { meets_r175_3_p1: 0 } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-3 1°' && t.source_subtype === 'r175_3_p1');
    expect(a).toBeTruthy();
  });

  it('R175-4 : has_maintenance_procedures=0 => réserve maintenance (prestataire ou personnel interne)', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { has_maintenance_procedures: 0 } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-4');
    expect(a).toBeTruthy();
    expect(a.source_subtype).toBe('maintenance');
    expect(a.title).toMatch(/maintenance/i);
    expect(a.description).toMatch(/personnel interne compétent/);
  });

  it('R175-5 : operator_trained=0 (non-Buildy) => action formation', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { operator_trained: 0, existing_solution: 'Trend' } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-5');
    expect(a).toBeTruthy();
  });

  // Doctrine 2026-09-23 : l'assistance intégrée d'une solution Buildy ne
  // remplace pas une formation attestée (R175-5, FAQ n° 30).
  it('R175-5 : operator_trained=0 avec solution Buildy => action formation quand même', () => {
    const { afId } = seedAudit({ withBms: true, bmsFlags: { operator_trained: 0, existing_solution: 'Buildy supervision' } });
    const target = [...computeTargetActions(afId).values()];
    const a = target.find(t => t.r175_article === 'R175-5');
    expect(a).toBeTruthy();
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
    return [...computeTargetActions(afId).values()].filter(t => /^R175-6/.test(t.r175_article || ''));
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

// Revue de conformité 2026-09-24 : périmètre de raccordement R175-2 II,
// périmètre GTB déclaré, compteurs, GTB hors service, non assujetti,
// principe ternaire sur les réponses partielles.
describe('bacs-audit-action-generator — revue 2026-09-24', () => {
  function seedSite({ status, permit, heatKw = 400, coolKw = 0, bms = { present: 1 } } = {}) {
    const { afId, zoneId } = seedAudit({});
    db.db.prepare('UPDATE afs SET bacs_applicability_status = ?, bacs_building_permit_date = ? WHERE id = ?')
      .run(status ?? null, permit ?? null, afId);
    const cols = Object.keys(bms);
    db.db.prepare(`INSERT INTO bacs_audit_bms (document_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`)
      .run(afId, ...Object.values(bms));
    const addSystem = (category, devices = []) => {
      const sysId = db.db.prepare(
        'INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present, is_bacs) VALUES (?, ?, ?, 1, 1)'
      ).run(afId, zoneId, category).lastInsertRowid;
      for (const d of devices) {
        const c = Object.keys(d);
        db.db.prepare(`INSERT INTO bacs_audit_system_devices (system_id, ${c.join(', ')}) VALUES (?, ${c.map(() => '?').join(', ')})`)
          .run(sysId, ...Object.values(d));
      }
      return sysId;
    };
    const addMeter = (m) => {
      const c = Object.keys(m);
      return db.db.prepare(`INSERT INTO bacs_audit_meters (document_id, zone_id, ${c.join(', ')}) VALUES (?, ?, ${c.map(() => '?').join(', ')})`)
        .run(afId, zoneId, ...Object.values(m)).lastInsertRowid;
    };
    // Générateurs de chaleur / froid qui portent les puissances du cumul.
    if (heatKw) addSystem('heating', [{ name: 'Chaudière', device_role: '["production"]', power_kw: heatKw, is_communicating: 1, wired: 1 }]);
    if (coolKw) addSystem('cooling', [{ name: 'Groupe froid', device_role: '["production"]', power_kw_cooling: coolKw, is_communicating: 1, wired: 1 }]);
    const targets = () => [...computeTargetActions(afId).values()];
    return { afId, zoneId, addSystem, addMeter, targets };
  }
  const notLinked = { device_role: '["production"]', is_communicating: 0, wired: 0, managed_by_bms: 0 };

  it('bâtiment existant : éclairage non raccordé = recommandation mineure avec condition de TRI', () => {
    const s = seedSite({ status: 'subject_2025', permit: '2010-01-01' });
    s.addSystem('lighting_indoor', [{ name: 'Éclairage', ...notLinked }]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable');
    expect(a.severity).toBe('minor');
    expect(a.description).toMatch(/temps de retour sur investissement inférieur à dix ans/);
  });

  it('bâtiment neuf : même éclairage = écart majeur, sans condition', () => {
    const s = seedSite({ status: 'subject_immediate', permit: '2022-01-01' });
    s.addSystem('lighting_indoor', [{ name: 'Éclairage', ...notLinked }]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable');
    expect(a.severity).toBe('major');
    expect(a.description).not.toMatch(/Condition d'application/);
  });

  it('bâtiment existant : froid sous le seuil conditionnel, chauffage au-delà obligatoire', () => {
    const s = seedSite({ status: 'subject_2025', permit: '2010-01-01', heatKw: 400, coolKw: 100 });
    s.addSystem('cooling', [{ name: 'Split', ...notLinked, power_kw_cooling: 5 }]);
    s.addSystem('heating', [{ name: 'Chaudière 2', ...notLinked, power_kw: 50 }]);
    const inter = s.targets().filter(t => t.source_subtype === 'system_not_interoperable');
    expect(inter.map(t => t.severity).sort()).toEqual(['major', 'minor']);
  });

  it('périmètre GTB déclaré : un usage non traité par la GTB reste à raccorder (R175-2 II)', () => {
    // Le périmètre de la GTB en place ne réduit pas celui du décret : la VMC
    // communicante et câblée, mais d'un usage que la GTB ne traite pas, est
    // « non reliée » (relecture juridique R1 M4).
    const linkedButOutOfScope = { device_role: '["production"]', is_communicating: 1, wired: 1 };
    const s = seedSite({ status: 'subject_immediate', bms: { present: 1, manages_heating: 1, manages_ventilation: 0 } });
    s.addSystem('ventilation', [{ name: 'VMC', ...linkedButOutOfScope }]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable');
    expect(a.severity).toBe('major');
    expect(a.description).toMatch(/qui ne traite pas cet usage/);
  });

  it('bâtiment existant : usage hors périmètre GTB = recommandation mineure avec condition', () => {
    const linkedButOutOfScope = { device_role: '["production"]', is_communicating: 1, wired: 1 };
    const s = seedSite({ status: 'subject_2025', permit: '2010-01-01', bms: { present: 1, manages_heating: 1, manages_ventilation: 0 } });
    s.addSystem('ventilation', [{ name: 'VMC', ...linkedButOutOfScope }]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable');
    expect(a.severity).toBe('minor');
    expect(a.description).toMatch(/Condition d'application/);
  });

  it('réponses partielles : un équipement pertinent non renseigné → pas de conclusion', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('ventilation', [{ name: 'CTA', ...notLinked }, { name: 'Régulateur', device_role: '["regulation"]' }]);
    expect(s.targets().find(t => t.source_subtype === 'system_not_interoperable')).toBeFalsy();
  });

  it('« non communicant » explicite sans raccordement renseigné → action', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('heating', [{ name: 'Chaudière 3', device_role: '["production"]', communication_protocols: '["non_communicant"]', power_kw: 10 }]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable');
    expect(a).toBeTruthy();
    expect(a.description).toMatch(/Aucune interface de communication/);
  });

  it('radiateur à robinet thermostatique : jamais visé par l\'interopérabilité', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('heating', [{ name: 'Radiateur', device_role: '["emission","regulation"]', regulation_type_emission: 'vanne_thermostatique', is_communicating: 0, wired: 0, managed_by_bms: 0 }]);
    expect(s.targets().find(t => t.source_subtype === 'system_not_interoperable')).toBeFalsy();
  });

  it('arrêt manuel : action « depuis la GTB » seulement si tous les équipements répondent non', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('heating', [{ name: 'Chaudière 4', device_role: '["production"]', is_communicating: 1, wired: 1, meets_r175_3_p4: 0, power_kw: 10 }]);
    const a = s.targets().find(t => t.source_subtype === 'system_no_manual_stop');
    expect(a.title).toMatch(/depuis la GTB/);
    expect(a.r175_article).toBe('R175-3 4°');
  });

  it('compteur d\'eau présent non communicant : aucune action R175-3 1°', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addMeter({ usage: 'other', meter_type: 'water', required: 1, present_actual: 1, communicating: 0 });
    expect(s.targets().filter(t => t.source_meter_id)).toHaveLength(0);
  });

  it('compteur requis communicant mais non intégré à la GTB : action d\'intégration', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addMeter({ usage: 'heating', meter_type: 'gas', required: 1, present_actual: 1, communicating: 1, managed_by_bms: 0 });
    const a = s.targets().find(t => t.source_subtype === 'meter_bms_integration');
    expect(a).toBeTruthy();
    expect(a.r175_article).toBe('R175-3 1°');
  });

  it('compteur requis hors service : action bloquante de remise en service', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addMeter({ usage: 'heating', meter_type: 'gas', required: 1, present_actual: 1, out_of_service: 1 });
    const a = s.targets().find(t => t.source_subtype === 'meter_out_of_service');
    expect(a.severity).toBe('blocking');
  });

  it('GTB hors service : action bloquante « Remettre en service la GTB »', () => {
    const s = seedSite({ status: 'subject_immediate', bms: { present: 1, out_of_service: 1 } });
    const a = s.targets().find(t => t.source_subtype === 'bms_out_of_service');
    expect(a.severity).toBe('blocking');
    expect(a.r175_article).toBe('R175-4');
  });

  // Relectures finales R1 / R2 (2026-09-24).
  it('générateur non raccordé : un circulateur raccordé ne suffit pas (R1 C1)', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('heating', [
      { name: 'Chaudière 5', device_role: '["production"]', communication_protocols: '["non_communicant"]', power_kw: 10 },
      { name: 'Pompe', device_role: '["distribution"]', is_communicating: 1, wired: 1 },
    ]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable' && /Chaudière|device/.test(t.title));
    expect(a).toBeTruthy();
    expect(a.description).toMatch(/Aucune interface de communication/);
  });

  it('générateur piloté par un régulateur raccordé : conforme (PROFEEL)', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('heating', [
      { name: 'Chaudière 6', device_role: '["production"]', communication_protocols: '["non_communicant"]', power_kw: 10 },
      { name: 'Régulateur de chaufferie', device_role: '["regulation"]', is_communicating: 1, wired: 1 },
    ]);
    expect(s.targets().filter(t => t.source_subtype === 'system_not_interoperable')).toHaveLength(0);
  });

  it('site sans GTB : « géré par la GTB » saisi par erreur est ignoré (R1 M7)', () => {
    const s = seedSite({ status: 'subject_2030', permit: '2010-01-01', heatKw: 0, bms: { present: 0 } });
    s.addSystem('heating', [{ name: 'Chaudière 1', device_role: '["production"]', power_kw: 120, managed_by_bms: 1 }]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable');
    expect(a).toBeTruthy();
    expect(a.description).toMatch(/aucune GTB n'est présente sur le site/);
  });

  it('éclairage fait de luminaires seuls, non communicants : raccordement à prévoir (R2 M8)', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('lighting_indoor', [{ name: 'Luminaires', device_role: '["emission"]', communication_protocols: '["non_communicant"]' }]);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable');
    expect(a).toBeTruthy();
    expect(a.description).not.toMatch(/Lecture Buildy du décret/);
  });

  it('système non raccordé : pas d\'action 4° en doublon, le raccordement la porte', () => {
    const s = seedSite({ status: 'subject_immediate' });
    s.addSystem('heating', [{ name: 'Chaudière 7', device_role: '["production"]', communication_protocols: '["non_communicant"]', power_kw: 10, meets_r175_3_p4: 0, meets_r175_3_p4_autonomous: 0 }]);
    const t = s.targets();
    expect(t.find(x => x.source_subtype === 'system_not_interoperable').description).toMatch(/R175-3 4°/);
    expect(t.find(x => x.source_subtype === 'system_no_manual_stop')).toBeFalsy();
    expect(t.find(x => x.source_subtype === 'system_not_autonomous')).toBeFalsy();
  });

  it('froid sous le seuil mais puissance manquante : exigé, avec « Portée à confirmer » (R2 C3)', () => {
    const s = seedSite({ status: 'subject_2025', permit: '2010-01-01', heatKw: 400, coolKw: 100 });
    s.addSystem('cooling', [{ name: 'Mono Split', ...notLinked }]);
    const a = s.targets().filter(t => t.source_subtype === 'system_not_interoperable' && /Portée à confirmer/.test(t.description));
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe('major');
    expect(a[0].description).toMatch(/Mono Split/);
  });

  it('split réversible partagé vers le chauffage : suit la portée du chauffage (R1 M7)', () => {
    const s = seedSite({ status: 'subject_2025', permit: '2010-01-01', heatKw: 400 });
    const coolSys = s.addSystem('cooling', [{ name: 'Split réversible', ...notLinked, power_kw: 10, power_kw_cooling: 9 }]);
    const heatSys = db.db.prepare('INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present, is_bacs) VALUES (?, ?, ?, 1, 1)')
      .run(s.afId, s.zoneId, 'heating').lastInsertRowid;
    const devId = db.db.prepare('SELECT id FROM bacs_audit_system_devices WHERE system_id = ?').get(coolSys).id;
    db.db.prepare('INSERT INTO bacs_audit_device_shared_systems (device_id, system_id) VALUES (?, ?)').run(devId, heatSys);
    const a = s.targets().find(t => t.source_subtype === 'system_not_interoperable' && t.source_system_id === coolSys);
    expect(a.severity).toBe('major');
    expect(a.description).not.toMatch(/Condition d'application/);
  });

  it('zones regroupées (comptage non séparable) : un seul compteur exigé (R1 M3, R2 C2)', () => {
    const s = seedSite({ status: 'subject_immediate', heatKw: 0 });
    const zone2 = db.db.prepare('INSERT INTO zones (site_id, name, position) SELECT site_id, ?, 99 FROM zones WHERE id = ?')
      .run('Cellule B', s.zoneId).lastInsertRowid;
    const sysA = s.addSystem('heating', [{ name: 'Chaudière commune', device_role: '["production"]', power_kw: 300, is_communicating: 1, wired: 1, metering_separable: 'no' }]);
    const sysB = db.db.prepare('INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present, is_bacs) VALUES (?, ?, ?, 1, 1)')
      .run(s.afId, zone2, 'heating').lastInsertRowid;
    const devId = db.db.prepare('SELECT id FROM bacs_audit_system_devices WHERE system_id = ?').get(sysA).id;
    db.db.prepare('INSERT INTO bacs_audit_device_shared_systems (device_id, system_id) VALUES (?, ?)').run(devId, sysB);
    s.addMeter({ usage: 'heating', meter_type: 'thermal', required: 1, present_actual: 0 });
    db.db.prepare('INSERT INTO bacs_audit_meters (document_id, zone_id, usage, meter_type, required, present_actual) VALUES (?, ?, ?, ?, 1, 0)')
      .run(s.afId, zone2, 'heating', 'thermal');
    const adds = s.targets().filter(t => t.category === 'meter_addition');
    expect(adds).toHaveLength(1);
    expect(adds[0].title).toMatch(/zone regroupée/);
  });

  it('bâtiment non assujetti : aucune action R175-3 à R175-5-1', () => {
    const s = seedSite({ status: 'not_subject', heatKw: 50, bms: { present: 0 } });
    s.addSystem('lighting_indoor', [{ name: 'Éclairage', ...notLinked }]);
    s.addMeter({ usage: 'heating', meter_type: 'gas', required: 1, present_actual: 0 });
    const t = s.targets();
    expect(t.filter(x => /^R175-(2|3|4|5)/.test(x.r175_article || ''))).toHaveLength(0);
  });

  it('GTB absente : action R175-2 avec échéance et dispense TRI', () => {
    const s = seedSite({ status: 'subject_2030', heatKw: 150, bms: { present: 0 } });
    const a = s.targets().find(t => t.source_subtype === 'no_gtb');
    expect(a.r175_article).toBe('R175-2');
    expect(a.description).toMatch(/1er janvier 2030/);
    expect(a.description).toMatch(/inférieur à dix ans/);
  });

  it('émetteur exclu par l\'auditeur mais chaleur d\'un générateur partagé : compteur de la zone exigé (audit 56)', () => {
    const s = seedSite({ status: 'subject_immediate', heatKw: 0 });
    const zone2 = db.db.prepare('INSERT INTO zones (site_id, name, position) SELECT site_id, ?, 99 FROM zones WHERE id = ?')
      .run('Local de charge', s.zoneId).lastInsertRowid;
    const sysA = s.addSystem('heating', [{ name: 'Chaudière gaz', device_role: '["production"]', power_kw: 300, is_communicating: 1, wired: 1 }]);
    const sysB = db.db.prepare('INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present, is_bacs) VALUES (?, ?, ?, 1, 1)')
      .run(s.afId, zone2, 'heating').lastInsertRowid;
    db.db.prepare('INSERT INTO bacs_audit_system_devices (system_id, name, device_role, gtb_scope_override) VALUES (?, ?, ?, 0)')
      .run(sysB, 'Aérotherme', '["emission","regulation"]');
    const boilerId = db.db.prepare('SELECT id FROM bacs_audit_system_devices WHERE system_id = ?').get(sysA).id;
    db.db.prepare('INSERT INTO bacs_audit_device_shared_systems (device_id, system_id) VALUES (?, ?)').run(boilerId, sysB);
    const meterB = db.db.prepare('INSERT INTO bacs_audit_meters (document_id, zone_id, usage, meter_type, required, present_actual) VALUES (?, ?, ?, ?, 1, 0)')
      .run(s.afId, zone2, 'heating', 'thermal').lastInsertRowid;
    const add = s.targets().find(t => t.category === 'meter_addition' && t.source_meter_id === meterB);
    expect(add).toBeTruthy();
    expect(computeMeterPlanStatus(s.afId)[meterB]).toBeUndefined();
  });

  it('statut des compteurs pour l\'interface : zone regroupée et usage exempté (même lecture que le PDF)', () => {
    const s = seedSite({ status: 'subject_immediate', heatKw: 0 });
    const zone2 = db.db.prepare('INSERT INTO zones (site_id, name, position) SELECT site_id, ?, 99 FROM zones WHERE id = ?')
      .run('Cellule B', s.zoneId).lastInsertRowid;
    const sysA = s.addSystem('heating', [{ name: 'Chaudière commune', device_role: '["production"]', power_kw: 300, is_communicating: 1, wired: 1, metering_separable: 'no' }]);
    const sysB = db.db.prepare('INSERT INTO bacs_audit_systems (document_id, zone_id, system_category, present, is_bacs) VALUES (?, ?, ?, 1, 1)')
      .run(s.afId, zone2, 'heating').lastInsertRowid;
    const devId = db.db.prepare('SELECT id FROM bacs_audit_system_devices WHERE system_id = ?').get(sysA).id;
    db.db.prepare('INSERT INTO bacs_audit_device_shared_systems (device_id, system_id) VALUES (?, ?)').run(devId, sysB);
    const coolId = s.addSystem('cooling', [{ name: 'Split', device_role: '["production"]', power_kw_cooling: 5 }]);
    db.db.prepare('UPDATE bacs_audit_systems SET marked_negligible_under_5pct = 1 WHERE id = ?').run(coolId);
    const meterA = s.addMeter({ usage: 'heating', meter_type: 'thermal', required: 1, present_actual: 0 });
    const meterB = db.db.prepare('INSERT INTO bacs_audit_meters (document_id, zone_id, usage, meter_type, required, present_actual) VALUES (?, ?, ?, ?, 1, 0)')
      .run(s.afId, zone2, 'heating', 'thermal').lastInsertRowid;
    const meterCool = s.addMeter({ usage: 'cooling', meter_type: 'electric', required: 1, present_actual: 0 });
    const st = computeMeterPlanStatus(s.afId);
    const roles = [st[meterA]?.status, st[meterB]?.status].sort();
    expect(roles).toEqual(['covered', 'lead']);
    expect(st[meterA].group).toMatch(/Cellule B/);
    expect(st[meterCool]).toEqual({ status: 'not_required', reason: 'exempt_5pct' });
  });
});
