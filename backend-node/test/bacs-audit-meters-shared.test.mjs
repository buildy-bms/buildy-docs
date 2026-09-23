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

  it('froid présent sans équipement saisi : repli électrique conservé', () => {
    const a = seedAudit(['Salle']);
    a.system('Salle', 'cooling');
    expect(a.meters()).toContain('Salle|cooling|electric');
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
