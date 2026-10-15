// Rapport d'audit BACS, nouvelle mise en page (lib/bacs-audit-report.js, charte 2026-10).
// Données : jeu d'exemple Atlas Sud de l'atelier PDF (plus ancien que l'export : listes absentes
// tolérées), sur une base neuve. Garde-fous des trous trouvés en comparant avec l'ancien gabarit
// (2026-10-15) : note de structure sans personne assujettie, origine d'une action reprise de sa
// justification, titre de chaque action d'un groupe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-report-'));
let buildBacsAuditReportHtml;
let fixture;
beforeAll(async () => {
  process.env.DATABASE_PATH = path.join(tmpDir, 'db.sqlite');
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require('../src/database').init();
  ({ buildBacsAuditReportHtml } = require('../src/lib/bacs-audit-report'));
  const { buildFixturePreviewData } = require('../src/routes/bacs-audit/_preview-fixture');
  fixture = await buildFixturePreviewData({ user: null });
});
afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '')
  .replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

describe('Rapport d’audit BACS — nouvelle mise en page', () => {
  it('imprime chaque action, chaque domaine du plan et un sommaire sans renvoi mort', async () => {
    const html = await buildBacsAuditReportHtml(fixture);
    const t = text(html);
    expect(html).toMatch(/<html lang="fr" class="print">/);
    expect(html).not.toMatch(/<script/);
    expect(html).toContain("font-family: 'Sora Digits'");
    expect(html).not.toContain('→'); // absent de Manrope : icône SVG
    for (const a of fixture.actionItemsRaw) expect(t).toContain(a.display_number);
    for (const c of fixture.actionItemsByCard) expect(t).toContain(c.label);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const links = [...html.matchAll(/<a (?:class="[^"]*" )?href="#([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(10);
    expect(links.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('aperçu de l’application : même contenu, sans pagination', async () => {
    const html = await buildBacsAuditReportHtml(fixture, { mode: 'screen' });
    expect(html).toMatch(/<html lang="fr" class="screen">/);
    expect(text(html)).toContain('Le constat détaillé');
  });

  it('note de structure imprimée sans personne assujettie ; origine d’une action reprise de sa justification', async () => {
    const d = JSON.parse(JSON.stringify(fixture));
    d.defaultLiability = null;
    d.ownershipStructureLabel = 'Propriétaire bailleur et preneurs';
    d.ownershipNotes = 'Note de structure de contrôle';
    const a = d.actionItemsRaw[0];
    a.source_label = null;
    a.auto_generated = 0;
    d.justificationGroups = [{ items: [{ number: a.display_number, source: 'Origine de contrôle', manual: true }] }];
    for (const c of d.actionItemsByCard) for (const s of c.subsections || []) for (const g of s.grouped || []) if (g.kind === 'single' && g.item.id === a.id) Object.assign(g.item, a);
    const t = text(await buildBacsAuditReportHtml(d));
    expect(t).toContain('Note de structure de contrôle');
    expect(t).toContain('Origine de contrôle · action ajoutée par l’auditeur');
  });

  it('action groupée : le titre de chaque action est imprimé', async () => {
    const d = JSON.parse(JSON.stringify(fixture));
    const card = d.actionItemsByCard.find((c) => (c.subsections || []).some((s) => (s.grouped || []).some((g) => g.kind === 'single')));
    const sub = card.subsections.find((s) => (s.grouped || []).filter((g) => g.kind === 'single').length >= 2);
    const singles = sub.grouped.filter((g) => g.kind === 'single').slice(0, 2).map((g) => g.item);
    singles.forEach((it, i) => { d.actionItemsRaw.find((a) => a.id === it.id).title_plain = `Titre propre de contrôle ${i + 1}`; });
    sub.grouped = [{
      kind: 'group', label: 'Groupe de contrôle', count: 2, severity: 'major', r175_article: 'R175-3 3°', columns: ['zone'],
      first_number: singles[0].display_number, last_number: singles[1].display_number,
      items: singles.map((it) => ({ display_number: it.display_number, zone_name: 'Zone de contrôle' })),
    }];
    const t = text(await buildBacsAuditReportHtml(d));
    expect(t).toContain('Titre propre de contrôle 1');
    expect(t).toContain('Titre propre de contrôle 2');
    expect(t).toContain('Groupe de contrôle');
  });
});
