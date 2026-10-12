// Tests d'intégration : génération des compteurs requis (seeder resync) avec
// équipements partagés entre systèmes (mig 143), + verrou serveur de l'étape
// « Inspections ». Cas réels : audit STEF (VC 4 tubes), Sénas (inspection
// « Non »), et non-régressions Communay / CLR / Sausheim JDW.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-meters-test-'));

let db;
let seeder;
let isStepComplete;

beforeEach(() => {
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
  seeder = require('../src/lib/seeder');
  // Référentiels semés au boot serveur : sans eux le resync ne crée aucun système.
  seeder.seedSystemCategoriesOnBoot();
  seeder.seedBacsRequirementsOnBoot();
  seeder.seedBacsMeterRequirementsOnBoot();
  ({ isStepComplete } = require('../src/lib/bacs-audit-step-completion'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

// Crée un audit BACS avec les zones demandées, systèmes générés par le resync.
function seedAudit(zoneNames) {
  const siteId = db.db.prepare(`INSERT INTO sites (site_uuid, name) VALUES (?, 'Site test')`)
    .run('site-' + Math.random()).lastInsertRowid;
  const zoneIds = {};
  zoneNames.forEach((n, i) => {
    zoneIds[n] = db.db.prepare(`INSERT INTO zones (site_id, name, nature, position) VALUES (?, ?, 'office', ?)`)
      .run(siteId, n, i).lastInsertRowid;
  });
  const docId = db.db.prepare(
    `INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
     VALUES (?, 'Client', 'Audit', 'bacs_audit', 'redaction', ?)`
  ).run('t-' + Math.random(), siteId).lastInsertRowid;
  seeder.resyncBacsAuditWithSiteZones(docId);
  const system = (zone, cat) => {
    const id = db.db.prepare(
      'SELECT id FROM bacs_audit_systems WHERE document_id = ? AND zone_id = ? AND system_category = ?'
    ).get(docId, zoneIds[zone], cat)?.id;
    db.db.prepare('UPDATE bacs_audit_systems SET present = 1, is_bacs = 1 WHERE id = ?').run(id);
    return id;
  };
  const device = (systemId, name, roles, extra = {}) => db.db.prepare(
    `INSERT INTO bacs_audit_system_devices (system_id, name, device_role, energy_source, metering_separable)
     VALUES (?, ?, ?, ?, ?)`
  ).run(systemId, name, JSON.stringify(roles), extra.energy || null, extra.separable || null).lastInsertRowid;
  const share = (deviceId, systemId) => db.db.prepare(
    'INSERT INTO bacs_audit_device_shared_systems (device_id, system_id) VALUES (?, ?)'
  ).run(deviceId, systemId);
  const meters = () => {
    seeder.resyncBacsAuditWithSiteZones(docId);
    return db.db.prepare(
      `SELECT COALESCE(z.name, 'Général') || '|' || m.usage || '|' || m.meter_type AS k
       FROM bacs_audit_meters m LEFT JOIN zones z ON z.id = m.zone_id
       WHERE m.document_id = ? AND m.required = 1`
    ).all(docId).map(r => r.k);
  };
  return { docId, system, device, share, meters };
}

describe('compteurs requis — équipements partagés', () => {
  it('STEF : VC 4 tubes froid partagé en chauffage → thermique chaud + froid, plus de froid électrique', () => {
    const a = seedAudit(['Lot Bureau X']);
    const cooling = a.system('Lot Bureau X', 'cooling');
    const heating = a.system('Lot Bureau X', 'heating');
    const vc = a.device(cooling, 'VC 4 tubes', ['emission']);
    a.share(vc, heating);
    const m = a.meters();
    expect(m).toContain('Lot Bureau X|heating|thermal');
    expect(m).toContain('Lot Bureau X|cooling|thermal');
    expect(m).not.toContain('Lot Bureau X|cooling|electric');
  });

  it('PAC réversible de la zone partagée froid → chauffage : production locale, pas de thermique', () => {
    const a = seedAudit(['Plot Bureaux']);
    const cooling = a.system('Plot Bureaux', 'cooling');
    const heating = a.system('Plot Bureaux', 'heating');
    const pac = a.device(cooling, 'PAC air/eau', ['production', 'distribution'], { energy: 'electric', separable: 'yes' });
    const vc = a.device(cooling, 'VC', ['emission'], { separable: 'partial' });
    a.share(pac, heating);
    a.share(vc, heating);
    const m = a.meters();
    expect(m).not.toContain('Plot Bureaux|heating|thermal');
    expect(m).toContain('Plot Bureaux|cooling|electric');
  });

  it('émetteur partagé déclaré non séparable : pas de compteur par zone', () => {
    const a = seedAudit(['Bureaux 2', 'Locaux sociaux 2']);
    const h1 = a.system('Bureaux 2', 'heating');
    const h2 = a.system('Locaux sociaux 2', 'heating');
    const boiler = a.device(h1, 'Chaudière', ['production'], { energy: 'gas', separable: 'no' });
    const rad = a.device(h1, 'Radiateur', ['emission'], { separable: 'no' });
    a.share(boiler, h2);
    a.share(rad, h2);
    expect(a.meters()).not.toContain('Locaux sociaux 2|heating|thermal');
  });

  it('chaudière chauffage + ECS de la même zone : le thermique ECS reste requis', () => {
    const a = seedAudit(['Bureaux']);
    const heating = a.system('Bureaux', 'heating');
    const dhw = a.system('Bureaux', 'dhw');
    const boiler = a.device(heating, 'Chaudière', ['production'], { energy: 'gas' });
    a.device(dhw, 'Boucle ECS', ['distribution']);
    a.share(boiler, dhw);
    const m = a.meters();
    expect(m).toContain('Bureaux|dhw|thermal');
    expect(m).toContain('Bureaux|heating|gas');
  });

  it('STEF #60 : chaudière + groupe froid déclarés dans une zone et partagés → thermiques dans cette zone aussi, compteurs d\'entrée conservés', () => {
    const a = seedAudit(['Circulation X', 'Circulation Y', 'Lot bureau X']);
    const heat = Object.fromEntries(['Circulation X', 'Circulation Y', 'Lot bureau X'].map(z => [z, a.system(z, 'heating')]));
    const cool = Object.fromEntries(['Circulation X', 'Circulation Y', 'Lot bureau X'].map(z => [z, a.system(z, 'cooling')]));
    const boiler = a.device(heat['Circulation X'], 'Chaudière gaz', ['production', 'regulation'], { energy: 'gas', separable: 'yes' });
    const chiller = a.device(cool['Circulation X'], 'Groupe d\'eau glacée', ['production'], { energy: 'electric', separable: 'yes' });
    const vc = a.device(cool['Circulation X'], 'Ventilo-convecteur', ['emission', 'regulation'], { separable: 'yes' });
    for (const z of ['Circulation Y', 'Lot bureau X']) {
      a.share(boiler, heat[z]);
      a.share(chiller, cool[z]);
      a.share(vc, cool[z]);
    }
    for (const sys of Object.values(heat)) a.share(vc, sys);
    const m = a.meters();
    for (const z of ['Circulation X', 'Circulation Y', 'Lot bureau X']) {
      expect(m).toContain(`${z}|heating|thermal`);
      expect(m).toContain(`${z}|cooling|thermal`);
    }
    for (const z of ['Circulation Y', 'Lot bureau X']) expect(m).not.toContain(`${z}|cooling|electric`);
    // Compteurs d'entrée de la chaudière et du groupe froid (R175-3 1°
    // « production et consommation », PROFEEL 3.1.1) : toujours requis.
    expect(m).toContain('Circulation X|heating|gas');
    expect(m).toContain('Circulation X|cooling|electric');
    // Affiché comme compteur d'entrée du groupe froid (3 zones desservies).
    const zx = db.db.prepare(`SELECT id FROM zones WHERE name = 'Circulation X'`).get().id;
    const gens = seeder.meterGeneratorsByKey(a.docId);
    expect(gens.get(seeder.meterTargetKey({ zone_id: zx, usage: 'cooling', meter_type: 'electric' })))
      .toEqual([{ name: 'Groupe d\'eau glacée', zones: 3 }]);
    expect(gens.get(seeder.meterTargetKey({ zone_id: zx, usage: 'cooling', meter_type: 'thermal' }))).toBeUndefined();
  });

  it('production partagée sans réponse « séparable » : zone hôte inchangée (pas de thermique)', () => {
    const a = seedAudit(['Cellule 1', 'Cellule 2']);
    const h1 = a.system('Cellule 1', 'heating');
    const h2 = a.system('Cellule 2', 'heating');
    const boiler = a.device(h1, 'Chaudière', ['production'], { energy: 'gas' });
    a.device(h1, 'Aérotherme', ['emission']);
    a.device(h2, 'Aérotherme', ['emission']);
    a.share(boiler, h2);
    const m = a.meters();
    expect(m).toContain('Cellule 1|heating|gas');
    expect(m).not.toContain('Cellule 1|heating|thermal');
    expect(m).toContain('Cellule 2|heating|thermal');
  });

  it('chaudière partagée déclarée non séparable : comptage d\'entrée conservé dans la zone hôte', () => {
    const a = seedAudit(['Bureaux 3', 'Atelier 3']);
    const h1 = a.system('Bureaux 3', 'heating');
    const h2 = a.system('Atelier 3', 'heating');
    const boiler = a.device(h1, 'Chaudière', ['production'], { energy: 'gas', separable: 'no' });
    a.device(h1, 'Radiateur', ['emission']);
    a.share(boiler, h2);
    const m = a.meters();
    expect(m).toContain('Bureaux 3|heating|gas');
    expect(m).not.toContain('Bureaux 3|heating|thermal');
  });

  it('« Requis » calculé sans écriture (compteur ajouté à la main)', () => {
    const a = seedAudit(['Salle 4']);
    const cooling = a.system('Salle 4', 'cooling');
    const heating = a.system('Salle 4', 'heating');
    const vc = a.device(cooling, 'VC 4 tubes', ['emission']);
    a.share(vc, heating);
    a.meters();
    const zoneId = db.db.prepare(`SELECT id FROM zones WHERE name = 'Salle 4'`).get().id;
    const count = () => db.db.prepare('SELECT COUNT(*) n FROM bacs_audit_meters WHERE document_id = ?').get(a.docId).n;
    const before = count();
    expect(seeder.isMeterRequiredByRules(a.docId, { zone_id: zoneId, usage: 'heating', meter_type: 'thermal' })).toBe(true);
    expect(seeder.isMeterRequiredByRules(a.docId, { zone_id: zoneId, usage: 'cooling', meter_type: 'electric' })).toBe(false);
    expect(count()).toBe(before);
  });

  it('froid présent sans équipement saisi : repli électrique conservé', () => {
    const a = seedAudit(['Salle']);
    a.system('Salle', 'cooling');
    expect(a.meters()).toContain('Salle|cooling|electric');
  });
});

describe('étape Check-list — couverture photo réaliste + non bloquante', () => {
  it('Sénas : un compteur absent ou non renseigné ne demande pas de photo', () => {
    const a = seedAudit(['Cellule']);
    const ins = db.db.prepare(`INSERT INTO bacs_audit_meters (document_id, usage, meter_type, required, present_actual)
      VALUES (?, 'other', ?, 1, ?)`);
    db.db.prepare('DELETE FROM bacs_audit_meters WHERE document_id = ?').run(a.docId);
    ins.run(a.docId, 'electric', 1);   // présent → photo attendue
    ins.run(a.docId, 'gas', 0);        // absent → impossible à photographier
    ins.run(a.docId, 'thermal', null); // non renseigné
    expect(db.bacsAuditChecklist.photoCoverage(a.docId).meters.total).toBe(1);
  });

  it('pas de photo GTB exigée sans GTB déclarée présente', () => {
    const a = seedAudit(['Cellule']);
    db.db.prepare('UPDATE bacs_audit_bms SET present = 0 WHERE document_id = ?').run(a.docId);
    expect(db.bacsAuditChecklist.photoCoverage(a.docId).bms.total).toBe(0);
    db.db.prepare('UPDATE bacs_audit_bms SET present = 1 WHERE document_id = ?').run(a.docId);
    expect(db.bacsAuditChecklist.photoCoverage(a.docId).bms.total).toBe(1);
  });

  it('la check-list est la seule étape non bloquante', () => {
    const { NON_BLOCKING_STEPS } = require('../src/lib/bacs-audit-step-completion');
    expect([...NON_BLOCKING_STEPS]).toEqual(['docs-checklist']);
  });
});

describe('étape Inspections — verrou serveur', () => {
  it('Sénas : réponse « Non » (rien à tracer) → étape validable', () => {
    const a = seedAudit(['Cellule']);
    db.db.prepare('UPDATE bacs_audit_bms SET present = 1 WHERE document_id = ?').run(a.docId);
    expect(isStepComplete(a.docId, 'inspections')).toBe(false);
    db.db.prepare('UPDATE afs SET inspection_not_applicable = 1 WHERE id = ?').run(a.docId);
    expect(isStepComplete(a.docId, 'inspections')).toBe(true);
  });

  it('une inspection datée suffit, même si une autre ne l\'est pas', () => {
    const a = seedAudit(['Cellule']);
    db.db.prepare('UPDATE bacs_audit_bms SET present = 1 WHERE document_id = ?').run(a.docId);
    db.db.prepare('INSERT INTO bacs_audit_inspections (document_id) VALUES (?)').run(a.docId);
    expect(isStepComplete(a.docId, 'inspections')).toBe(false);
    db.db.prepare(`INSERT INTO bacs_audit_inspections (document_id, last_inspection_date) VALUES (?, '2024-05-01')`).run(a.docId);
    expect(isStepComplete(a.docId, 'inspections')).toBe(true);
  });
});
