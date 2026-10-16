// « La GTB et la supervision sont-elles fonctionnelles ? » Oui / Partiellement / Non + notes
// (mig 218, demande de Kévin 2026-10-16) : accord avec l'ancien « hors service », reprise de
// l'existant, rubrique de l'étape GTB, rapport.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { bmsRubrics, bmsFunctionalState } from '../../frontend/src/lib/bms-guide.js';
const require = createRequire(import.meta.url);
const { syncBmsFunctionalState } = require('../src/lib/bms-functional-state.js');

describe('accord avec « hors service »', () => {
  it('l’état envoyé fixe « hors service » (« Non » = hors service)', () => {
    expect(syncBmsFunctionalState({ functional_state: 'not_functional' })).toMatchObject({ out_of_service: true });
    expect(syncBmsFunctionalState({ functional_state: 'partial' })).toMatchObject({ out_of_service: false });
    expect(syncBmsFunctionalState({ functional_state: null })).toMatchObject({ out_of_service: null });
  });
  it('« hors service » seul (ancienne version, outils Claude) : l’état suit, « Partiellement » gardé si en service', () => {
    expect(syncBmsFunctionalState({ out_of_service: true }, 'partial')).toMatchObject({ functional_state: 'not_functional' });
    expect(syncBmsFunctionalState({ out_of_service: false }, 'partial')).toMatchObject({ functional_state: 'partial' });
    expect(syncBmsFunctionalState({ out_of_service: false }, 'not_functional')).toMatchObject({ functional_state: 'functional' });
  });
  it('les deux en désaccord (ancienne version qui renvoie toute la fiche) : « hors service » l’emporte', () => {
    expect(syncBmsFunctionalState({ functional_state: 'functional', out_of_service: true }, 'functional'))
      .toMatchObject({ functional_state: 'not_functional', out_of_service: true });
    expect(syncBmsFunctionalState({ functional_state: 'partial', out_of_service: false }, 'functional'))
      .toMatchObject({ functional_state: 'partial', out_of_service: false });
  });
  it('notes : espaces retirés, vide = rien', () => {
    expect(syncBmsFunctionalState({ functional_notes: '  Alarmes coupées ' }).functional_notes).toBe('Alarmes coupées');
    expect(syncBmsFunctionalState({ functional_notes: '   ' }).functional_notes).toBeNull();
  });
});

describe('rubrique « Fonctionnement de la GTB »', () => {
  const rubric = (b) => bmsRubrics({ present: 1, ...b }, { isBacs: true }).find(r => r.key === 'out-of-service');
  it('sans réponse, puis « Partiellement » exige les notes', () => {
    expect(rubric({}).unanswered).toEqual(['fonctionnelle ?']);
    expect(rubric({ functional_state: 'partial' }).missing).toEqual(['ce qui ne fonctionne pas']);
    expect(rubric({ functional_state: 'partial', functional_notes: 'Alarmes coupées' })).toMatchObject({
      missing: [], unanswered: [], state: 'done', summary: 'Partiellement fonctionnelle : Alarmes coupées' });
    expect(rubric({ functional_state: 'functional' })).toMatchObject({ missing: [], summary: 'Fonctionnelle' });
  });
  it('ligne qui n’a que « hors service » : lue comme « Oui » / « Non »', () => {
    expect(bmsFunctionalState({ out_of_service: 1 })).toBe('not_functional');
    expect(bmsFunctionalState({ out_of_service: 0 })).toBe('functional');
    expect(bmsFunctionalState({})).toBeNull();
  });
  it('« Non » : les rubriques de ce que sait faire la GTB deviennent facultatives', () => {
    const rubrics = bmsRubrics({ present: 1, functional_state: 'not_functional', out_of_service: 1 }, { isBacs: true });
    expect(rubrics.find(r => r.key === 'capabilities').optional).toBe(true);
    expect(rubrics.find(r => r.key === 'out-of-service').optional).toBe(false);
  });
});

describe('migration 218 et rapport', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig218-'));
  afterAll(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } });

  it('reprend « hors service » des audits existants, sans toucher une réponse déjà donnée', () => {
    process.env.DATABASE_PATH = path.join(tmpDir, 'db.sqlite');
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    let db = require('../src/database');
    db.init();
    const D = db.db;
    const siteId = D.prepare(`INSERT INTO sites (site_uuid, name) VALUES ('s-218', 'Site')`).run().lastInsertRowid;
    const audit = (slug, oos, st = null) => {
      const id = D.prepare(`INSERT INTO afs (slug, client_name, project_name, kind, status, site_id)
        VALUES (?, 'C', 'A', 'bacs_audit', 'redaction', ?)`).run(slug, siteId).lastInsertRowid;
      D.prepare('INSERT INTO bacs_audit_bms (document_id, present, out_of_service, functional_state) VALUES (?, 1, ?, ?)').run(id, oos, st);
      return id;
    };
    const ids = { on: audit('a-on', 0), off: audit('a-off', 1), none: audit('a-none', null), kept: audit('a-kept', 0, 'partial') };
    D.pragma('user_version = 217');
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    db = require('../src/database');
    db.init();
    const st = (id) => db.db.prepare('SELECT functional_state FROM bacs_audit_bms WHERE document_id = ?').get(id).functional_state;
    expect([st(ids.on), st(ids.off), st(ids.none), st(ids.kept)]).toEqual(['functional', 'not_functional', null, 'partial']);
    expect(db.db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(218);
  });

  it('le rapport dit « partiellement fonctionnelle » avec les notes', async () => {
    const { buildBacsAuditReportHtml } = require('../src/lib/bacs-audit-report');
    const { buildFixturePreviewData } = require('../src/routes/bacs-audit/_preview-fixture');
    const d = JSON.parse(JSON.stringify(await buildFixturePreviewData({ user: null })));
    d.bms = { ...d.bms, out_of_service: 0, functional_state: 'partial', functional_notes: 'Alarmes plus remontées' };
    const t = (await buildBacsAuditReportHtml(d)).replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
    expect(t).toContain('GTB et supervision partiellement fonctionnelles au moment de l’audit. Alarmes plus remontées');
    expect(t).toContain('Fonctionnement Partiellement fonctionnelle');
  });
});
