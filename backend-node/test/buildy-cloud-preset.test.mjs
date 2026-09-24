// Modèle « Supervision Buildy Cloud » de la carte GTB (mig 205) : valeurs par
// niveau d'offre, non-écrasement des saisies, accès carte 10 créé une fois,
// et doctrine du 2026-09-23 : conforme quel que soit le niveau, SOUS RÉSERVE
// des obligations du niveau (export des données et maintenance en Essentials).
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
  it('Essentials : fonctions couvertes, maintenance laissée à l\'auditeur, deux réserves', () => {
    const { fixed } = preset.buildBuildyCloudPreset('essentials');
    expect([fixed.meets_r175_3_p1, fixed.meets_r175_3_p2, fixed.data_provision_to_operators]).toEqual([1, 1, 1]);
    expect(fixed.data_storage_5y_compliant).toBe('yes');
    expect('has_maintenance_procedures' in fixed).toBe(false);
    expect(preset.BUILDY_RESERVES_BY_LEVEL.essentials.map(r => r.key)).toEqual(['data_export_backup', 'maintenance']);
  });
  it('Premium : tout couvert, API REST fournie, aucune réserve', () => {
    const { fixed } = preset.buildBuildyCloudPreset('premium');
    expect([fixed.meets_r175_3_p1, fixed.meets_r175_3_p2, fixed.data_provision_to_operators]).toEqual([1, 1, 1]);
    expect(JSON.parse(fixed.provided_protocols)).toContain('rest');
    expect(preset.BUILDY_RESERVES_BY_LEVEL.premium).toEqual([]);
  });
  it('la formation R175-5 n\'est jamais présumée', () => {
    for (const level of ['essentials', 'smart', 'premium']) {
      const { fixed, defaults } = preset.buildBuildyCloudPreset(level);
      expect('operator_trained' in fixed).toBe(false);
      expect('operator_trained' in defaults).toBe(false);
    }
  });
  it('niveau inconnu refusé', () => {
    expect(() => preset.buildBuildyCloudPreset('gold')).toThrow();
  });
});

describe('application sur un audit', () => {
  it('ne remplace pas une saisie existante, mais réaligne les champs liés au niveau', () => {
    const a = seedAudit();
    db.db.prepare(`INSERT INTO bacs_audit_bms (document_id, existing_solution, meets_r175_3_p1) VALUES (?, 'Buildy (site pilote)', 1)`).run(a.docId);
    db.db.prepare('UPDATE bacs_audit_bms SET meets_r175_3_p1 = 0 WHERE document_id = ?').run(a.docId);
    const r = apply(a, 'essentials');
    expect(r.bms.existing_solution).toBe('Buildy (site pilote)');
    expect(r.bms.meets_r175_3_p1).toBe(1);
    expect(r.bms.present).toBe(1);
    expect(r.bms.is_buildy_supervision).toBe(1);
    expect(r.bms.buildy_offer_level).toBe('essentials');
    expect(r.bms.operator_trained).toBeNull();
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

describe('question préalable « supervision Buildy ? » (mig 206)', () => {
  it('un niveau déjà choisi vaut « oui », les autres GTB restent sans réponse', () => {
    const a = seedAudit();
    const b = seedAudit();
    db.db.prepare(`INSERT INTO bacs_audit_bms (document_id, present, buildy_offer_level) VALUES (?, 1, 'smart')`).run(a.docId);
    db.db.prepare(`INSERT INTO bacs_audit_bms (document_id, present) VALUES (?, 1)`).run(b.docId);
    db.db.prepare('UPDATE bacs_audit_bms SET is_buildy_supervision = NULL').run();
    db.db.pragma('user_version = 205');

    for (const k of Object.keys(require.cache)) delete require.cache[k];
    db = require('../src/database');
    db.init();
    const flag = (docId) => db.db.prepare('SELECT is_buildy_supervision f FROM bacs_audit_bms WHERE document_id = ?').get(docId).f;
    expect(db.db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(206);
    expect(flag(a.docId)).toBe(1);
    expect(flag(b.docId)).toBeNull();
  });
});

describe('plan de mise en conformité', () => {
  it('Essentials : deux réserves (export des données, maintenance), jamais d\'action « passer en Premium »', () => {
    const a = seedAudit();
    apply(a, 'essentials');
    const s = subtypes(a.docId);
    expect(s).not.toContain('buildy_offer_upgrade');
    expect(s).toContain('data_export_backup');
    expect(s).toContain('maintenance');
    for (const covered of ['r175_3_p1', 'r175_3_p2', 'data_storage_5y', 'data_provision_operators']) {
      expect(s).not.toContain(covered);
    }
    const maint = [...computeTargetActions(a.docId).values()].find(t => t.source_subtype === 'maintenance');
    expect(maint.description).toMatch(/personnel interne compétent/);
  });
  it('Essentials avec maintenance déclarée : seule la réserve d\'export demeure', () => {
    const a = seedAudit();
    apply(a, 'essentials');
    db.db.prepare('UPDATE bacs_audit_bms SET has_maintenance_procedures = 1 WHERE document_id = ?').run(a.docId);
    const s = subtypes(a.docId);
    expect(s).toContain('data_export_backup');
    expect(s).not.toContain('maintenance');
  });
  it('Smart et Premium : aucune réserve ni action liée au niveau d\'offre', () => {
    for (const level of ['smart', 'premium']) {
      const a = seedAudit();
      apply(a, level);
      const s = subtypes(a.docId);
      expect(s).not.toContain('buildy_offer_upgrade');
      expect(s).not.toContain('data_export_backup');
      expect(s).not.toContain('maintenance');
    }
  });
});
