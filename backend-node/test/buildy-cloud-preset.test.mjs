// Modèle « Supervision Buildy Cloud » de la carte GTB (mig 205) : valeurs par
// niveau d'offre, non-écrasement des saisies, accès carte 10 créé une fois,
// et action unique « passer en Premium » dans le plan de mise en conformité.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildy-preset-test-'));
let db, preset, computeTargetActions;

beforeEach(() => {
  process.env.DATABASE_PATH = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
  preset = require('../src/lib/buildy-cloud-preset');
  ({ computeTargetActions } = require('../src/lib/bacs-audit-action-generator'));
});
afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

function seedAudit() {
  const siteId = db.db.prepare(`INSERT INTO sites (site_uuid, name) VALUES (?, 'Site')`)
    .run('s-' + Math.random()).lastInsertRowid;
  const docId = db.db.prepare(`INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
    VALUES (?, 'C', 'A', 'bacs_audit', 'redaction', ?)`).run('a-' + Math.random(), siteId).lastInsertRowid;
  return { siteId, docId };
}
const apply = (a, level) => preset.applyBuildyCloudPreset(db.db, { documentId: a.docId, siteId: a.siteId, level, userId: null });
const subtypes = (docId) => [...computeTargetActions(docId).values()]
  .filter(t => t.source_bms_document_id === docId).map(t => t.source_subtype);

describe('valeurs du modèle par niveau', () => {
  it('Essentials : R175-3 1°/2° non couverts, pas de transmission exploitants, maintenance laissée', () => {
    const { fixed } = preset.buildBuildyCloudPreset('essentials');
    expect(fixed.meets_r175_3_p1).toBe(0);
    expect(fixed.meets_r175_3_p2).toBe(0);
    expect(fixed.data_storage_5y_compliant).toBe('no');
    expect(fixed.data_provision_to_operators).toBe(0);
    expect('has_maintenance_procedures' in fixed).toBe(false);
  });
  it('Premium : tout couvert, API REST fournie', () => {
    const { fixed } = preset.buildBuildyCloudPreset('premium');
    expect([fixed.meets_r175_3_p1, fixed.meets_r175_3_p2, fixed.data_provision_to_operators]).toEqual([1, 1, 1]);
    expect(JSON.parse(fixed.provided_protocols)).toContain('rest');
    expect(preset.BUILDY_UNCOVERED_BY_LEVEL.premium).toEqual([]);
  });
  it('niveau inconnu refusé', () => {
    expect(() => preset.buildBuildyCloudPreset('gold')).toThrow();
  });
});

describe('application sur un audit', () => {
  it('ne remplace pas une saisie existante, mais réaligne les champs liés au niveau', () => {
    const a = seedAudit();
    db.db.prepare(`INSERT INTO bacs_audit_bms (document_id, existing_solution, meets_r175_3_p1) VALUES (?, 'Buildy (site pilote)', 1)`).run(a.docId);
    const r = apply(a, 'essentials');
    expect(r.bms.existing_solution).toBe('Buildy (site pilote)');
    expect(r.bms.meets_r175_3_p1).toBe(0);
    expect(r.bms.present).toBe(1);
    expect(r.bms.buildy_offer_level).toBe('essentials');
    expect(r.bms.operator_trained).toBe(1);
  });
  it('crée l\'accès « comptes nominatifs » une seule fois par site', () => {
    const a = seedAudit();
    expect(apply(a, 'smart').credentialCreated).toBe(true);
    expect(apply(a, 'premium').credentialCreated).toBe(false);
    const creds = db.db.prepare('SELECT title, url, password_encrypted FROM site_credentials WHERE site_id = ?').all(a.siteId);
    expect(creds).toHaveLength(1);
    expect(creds[0].url).toBe(preset.BUILDY_CLOUD_URL);
    expect(creds[0].password_encrypted).toBeNull();
  });
});

describe('plan de mise en conformité', () => {
  it('Essentials : une action bloquante « passer en Premium » remplace les actions génériques', () => {
    const a = seedAudit();
    apply(a, 'essentials');
    const s = subtypes(a.docId);
    expect(s).toContain('buildy_offer_upgrade');
    for (const covered of ['r175_3_p1', 'r175_3_p2', 'data_storage_5y', 'data_provision_operators']) {
      expect(s).not.toContain(covered);
    }
    const up = [...computeTargetActions(a.docId).values()].find(t => t.source_subtype === 'buildy_offer_upgrade');
    expect(up.severity).toBe('blocking');
    expect(up.title).toMatch(/Premium/);
  });
  it('Smart : action majeure, seule la transmission exploitants est couverte', () => {
    const a = seedAudit();
    apply(a, 'smart');
    const up = [...computeTargetActions(a.docId).values()].find(t => t.source_subtype === 'buildy_offer_upgrade');
    expect(up.severity).toBe('major');
    expect(subtypes(a.docId)).not.toContain('data_provision_operators');
  });
  it('Premium : aucune action liée au niveau d\'offre', () => {
    const a = seedAudit();
    apply(a, 'premium');
    expect(subtypes(a.docId)).not.toContain('buildy_offer_upgrade');
  });
});
