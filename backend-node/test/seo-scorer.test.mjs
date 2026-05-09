// Tests unitaires du scorer SEO (lib/seo-scorer.js).
// Pure function : pas de DB ni mock pour la majorité, sauf les tests qui
// vérifient l'override DB de la whitelist (loadKeywords + invalidateKeywordsCache).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-test-'));

let scoreArticle;
let DEFAULT_KEYWORDS;
let invalidateKeywordsCache;
let db;

beforeEach(() => {
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
  ({ scoreArticle, DEFAULT_KEYWORDS, invalidateKeywordsCache } = require('../src/lib/seo-scorer'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

describe('scoreArticle — edge cases', () => {
  it('article vide ne crash pas et retourne un score bas', () => {
    const r = scoreArticle({ title: '', contentHtml: '' });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThan(30);
    expect(r.weakChecks.length).toBeGreaterThanOrEqual(5);
  });

  it('renvoie une structure complète (score, checks, weakChecks, suggestions)', () => {
    const r = scoreArticle({ title: 'Test', contentHtml: '<p>Hello</p>' });
    expect(r).toHaveProperty('score');
    expect(r).toHaveProperty('checks');
    expect(r).toHaveProperty('weakChecks');
    expect(r).toHaveProperty('suggestions');
    expect(Array.isArray(r.checks)).toBe(true);
  });
});

describe('scoreArticle — checks individuels', () => {
  function findCheck(r, id) { return r.checks.find((c) => c.id === id); }

  it('title-keyword passe quand le titre contient un mot-clé métier', () => {
    const r = scoreArticle({ title: 'GTB pour le tertiaire', contentHtml: '<p>x</p>' });
    expect(findCheck(r, 'title-keyword').passed).toBe(true);
  });

  it('title-keyword échoue si aucun mot-clé métier dans le titre', () => {
    const r = scoreArticle({ title: 'Comment ça marche ?', contentHtml: '<p>x</p>' });
    expect(findCheck(r, 'title-keyword').passed).toBe(false);
  });

  it('title-length pass dans la fourchette [30, 70]', () => {
    const r1 = scoreArticle({ title: 'a'.repeat(15), contentHtml: '' });
    expect(findCheck(r1, 'title-length').passed).toBe(false);
    const r2 = scoreArticle({ title: 'a'.repeat(50), contentHtml: '' });
    expect(findCheck(r2, 'title-length').passed).toBe(true);
    const r3 = scoreArticle({ title: 'a'.repeat(100), contentHtml: '' });
    expect(findCheck(r3, 'title-length').passed).toBe(false);
  });

  it('strong-emphasis : 0/2/3/5 strong → false/false/true/true', () => {
    const html2 = '<p><strong>a</strong> <strong>b</strong></p>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html2 }), 'strong-emphasis').passed).toBe(false);
    const html3 = '<p><strong>a</strong> <strong>b</strong> <strong>c</strong></p>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html3 }), 'strong-emphasis').passed).toBe(true);
  });

  it('headings-count passe avec ≥ 2 H2', () => {
    const html = '<h2>A</h2><p>x</p><h2>B</h2>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html }), 'headings-count').passed).toBe(true);
  });

  it('internal-links : libellé "ici" non descriptif → fail', () => {
    const html = '<p><a href="/article/foo">cliquez ici</a></p>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html }), 'internal-links').passed).toBe(false);
  });

  it('internal-links : libellé descriptif → pass', () => {
    const html = '<p><a href="/article/foo">guide complet GTB</a></p>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html }), 'internal-links').passed).toBe(true);
  });

  it('no-stuffing : "GTB" ≤ 5 fois → pass', () => {
    const html = '<p>GTB GTB GTB</p>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html }), 'no-stuffing').passed).toBe(true);
  });

  it('no-stuffing : "GTB" répété 7 fois → fail avec stuffingCounts', () => {
    const html = '<p>GTB ' + 'GTB '.repeat(7) + '</p>';
    const r = scoreArticle({ title: '', contentHtml: html });
    expect(findCheck(r, 'no-stuffing').passed).toBe(false);
  });

  it('kw-coverage : partialScore proportionnel au nombre de keywords trouvés', () => {
    // 0 keywords → partial 0
    const r0 = scoreArticle({ title: '', contentHtml: '<p>texte sans mot-clé métier</p>' });
    const c0 = findCheck(r0, 'kw-coverage');
    expect(c0.partialScore).toBe(0);
    // 5 keywords → partial 15 (max)
    const html = '<p>GTB hypervision supervision BACnet KNX</p>';
    const r5 = scoreArticle({ title: '', contentHtml: html });
    const c5 = findCheck(r5, 'kw-coverage');
    expect(c5.partialScore).toBe(15);
  });

  it('acronyme GTB développé dans la fenêtre 80 chars → pass', () => {
    const html = '<p>GTB (Gestion Technique du Bâtiment) sert à piloter votre site.</p>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html }), 'acronyms').passed).toBe(true);
  });

  it('acronyme GTB sans expansion proche → fail', () => {
    // GTB en début, expansion 200 chars plus loin → hors fenêtre 80 chars
    const html = '<p>GTB ' + 'a '.repeat(150) + 'Gestion Technique du Bâtiment</p>';
    expect(findCheck(scoreArticle({ title: '', contentHtml: html }), 'acronyms').passed).toBe(false);
  });
});

describe('scoreArticle — override DB whitelist (faqSettings)', () => {
  it('utilise DEFAULT_KEYWORDS quand aucun override DB', () => {
    invalidateKeywordsCache();
    const r = scoreArticle({ title: '', contentHtml: '<p>GTB hypervision</p>' });
    const c = r.checks.find((x) => x.id === 'kw-coverage');
    expect(c.partialScore).toBeGreaterThan(0);
  });

  it('override DB → seul le mot-clé custom compte', () => {
    db.faqSettings.setSeoKeywords(['custom-only-2026']);
    invalidateKeywordsCache();
    // GTB ne fait plus partie de la liste
    const rGtb = scoreArticle({ title: '', contentHtml: '<p>GTB GTB GTB</p>' });
    expect(rGtb.checks.find((c) => c.id === 'kw-coverage').partialScore).toBe(0);
    // custom-only-2026 est reconnu
    const rCustom = scoreArticle({ title: '', contentHtml: '<p>custom-only-2026 dans le texte</p>' });
    expect(rCustom.checks.find((c) => c.id === 'kw-coverage').partialScore).toBeGreaterThan(0);
  });

  it('reset whitelist → DEFAULT_KEYWORDS restauré', () => {
    db.faqSettings.setSeoKeywords(['only']);
    invalidateKeywordsCache();
    db.faqSettings.resetSeoKeywords();
    invalidateKeywordsCache();
    const r = scoreArticle({ title: '', contentHtml: '<p>GTB</p>' });
    expect(r.checks.find((c) => c.id === 'kw-coverage').partialScore).toBeGreaterThan(0);
  });

  it('JSON corrompu en DB → tombe sur DEFAULT_KEYWORDS sans crash', () => {
    db.db.prepare('UPDATE faq_settings SET seo_keywords_json = ? WHERE id = 1').run('NOT VALID JSON {');
    invalidateKeywordsCache();
    const r = scoreArticle({ title: '', contentHtml: '<p>GTB</p>' });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.checks.find((c) => c.id === 'kw-coverage').partialScore).toBeGreaterThan(0);
  });
});

describe('DEFAULT_KEYWORDS export', () => {
  it('contient les mots-clés métier critiques', () => {
    expect(DEFAULT_KEYWORDS).toContain('GTB');
    expect(DEFAULT_KEYWORDS).toContain('hypervision');
    expect(DEFAULT_KEYWORDS).toContain('décret BACS');
    expect(DEFAULT_KEYWORDS).toContain('BACnet');
    expect(DEFAULT_KEYWORDS.length).toBeGreaterThan(20);
  });
});
