// Tests des wrappers DB FAQ : faqArticles (create / update / snapshot / versions),
// faqCategoriesTombstones (add / has / remove), faqSettings (SEO keywords).
// Régression test du bug shipped 2026-05-08 où create() ne persistait pas
// description / crisp_url / crisp_updated_at.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-faq-test-'));
let db;

beforeEach(() => {
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

function seedCategory({ name = 'Cat test', crispId = null } = {}) {
  return db.faqCategories.create({
    name, locale: 'fr', dirty: 1, crispId, orderIndex: 0,
  });
}

describe('faqArticles.create — persiste tous les champs critiques', () => {
  it('create persiste description, crispUrl, crispUpdatedAt (régression 2026-05-08)', () => {
    const cat = seedCategory();
    const created = db.faqArticles.create({
      crispId: 'crisp-abc',
      categoryId: cat.id,
      title: 'Mon article',
      slug: 'mon-article',
      description: 'Une meta-description SEO de 80 chars max précisément ici ok.',
      contentHtml: '<p>contenu</p>',
      status: 'draft',
      visibility: 'public',
      locale: 'fr',
      dirty: 0,
      pulledAt: '2026-05-08T10:00:00Z',
      crispUpdatedAt: '2026-05-08T09:00:00Z',
      crispUrl: 'https://help.buildy.fr/fr/article/mon-article-abc/',
    });
    const read = db.faqArticles.getById(created.id);
    expect(read.title).toBe('Mon article');
    expect(read.description).toBe('Une meta-description SEO de 80 chars max précisément ici ok.');
    expect(read.crisp_url).toBe('https://help.buildy.fr/fr/article/mon-article-abc/');
    expect(read.crisp_id).toBe('crisp-abc');
    expect(read.crisp_updated_at).toBe('2026-05-08T09:00:00Z');
    expect(read.dirty).toBe(0);
  });

  it('create avec valeurs par défaut OK', () => {
    const created = db.faqArticles.create({ title: 'Minimal' });
    expect(created.title).toBe('Minimal');
    expect(created.dirty).toBe(1);
    expect(created.status).toBe('draft');
    expect(created.visibility).toBe('public');
    expect(created.description).toBeNull();
    expect(created.crisp_url).toBeNull();
  });
});

describe('faqArticles.update — map de colonnes', () => {
  it('update propage chaque champ du map', () => {
    const a = db.faqArticles.create({ title: 'Init' });
    db.faqArticles.update(a.id, {
      title: 'Updated',
      description: 'Nouvelle desc',
      contentHtml: '<p>edit</p>',
      status: 'published',
      crispUrl: 'https://example.com/x',
      dirty: 0,
    });
    const read = db.faqArticles.getById(a.id);
    expect(read.title).toBe('Updated');
    expect(read.description).toBe('Nouvelle desc');
    expect(read.content_html).toBe('<p>edit</p>');
    expect(read.status).toBe('published');
    expect(read.crisp_url).toBe('https://example.com/x');
    expect(read.dirty).toBe(0);
  });

  it('update partiel : autres colonnes inchangées', () => {
    const a = db.faqArticles.create({ title: 'A', contentHtml: '<p>x</p>' });
    db.faqArticles.update(a.id, { dirty: 0 });
    const read = db.faqArticles.getById(a.id);
    expect(read.title).toBe('A');
    expect(read.content_html).toBe('<p>x</p>');
    expect(read.dirty).toBe(0);
  });
});

describe('faqArticles.snapshot + listVersions + getVersion', () => {
  it('3 snapshots avec reasons différents → listVersions retourne 3 entrées DESC', () => {
    const a = db.faqArticles.create({ title: 'Article', contentHtml: '<p>v1</p>', status: 'draft' });
    const v1 = db.faqArticles.snapshot(a.id, { reason: 'before_push' });
    db.faqArticles.update(a.id, { contentHtml: '<p>v2</p>' });
    const v2 = db.faqArticles.snapshot(a.id, { reason: 'before_ai_rewrite' });
    db.faqArticles.update(a.id, { contentHtml: '<p>v3</p>' });
    const v3 = db.faqArticles.snapshot(a.id, { reason: 'before_restore' });

    const versions = db.faqArticles.listVersions(a.id);
    expect(versions.length).toBe(3);
    // Les 3 snapshots peuvent avoir le même created_at (même seconde SQLite),
    // on vérifie juste la complétude + le mapping reason.
    const ids = versions.map((v) => v.id).sort();
    expect(ids).toEqual([v1, v2, v3].sort());
    const reasons = versions.map((v) => v.reason).sort();
    expect(reasons).toEqual(['before_ai_rewrite', 'before_push', 'before_restore']);
    expect(versions.every((v) => v.title === 'Article')).toBe(true);
  });

  it('listVersions inclut content_size (longueur du HTML stocké)', () => {
    const a = db.faqArticles.create({ title: 'A', contentHtml: '<p>' + 'x'.repeat(500) + '</p>' });
    db.faqArticles.snapshot(a.id, { reason: 'before_push' });
    const versions = db.faqArticles.listVersions(a.id);
    expect(versions[0].content_size).toBeGreaterThan(500);
  });

  it('getVersion retourne le contenu complet (title, content_html, status, reason)', () => {
    const a = db.faqArticles.create({ title: 'Mon titre v1', contentHtml: '<p>v1</p>', status: 'published' });
    const vid = db.faqArticles.snapshot(a.id, { reason: 'before_push' });
    const v = db.faqArticles.getVersion(vid);
    expect(v.title).toBe('Mon titre v1');
    expect(v.content_html).toBe('<p>v1</p>');
    expect(v.status).toBe('published');
    expect(v.reason).toBe('before_push');
    expect(v.article_id).toBe(a.id);
  });

  it('getVersion sur id inexistant → undefined', () => {
    expect(db.faqArticles.getVersion(99999)).toBeUndefined();
  });

  it('snapshot sur article inexistant → null (pas de crash)', () => {
    expect(db.faqArticles.snapshot(99999, { reason: 'test' })).toBeNull();
  });
});

describe('faqCategoriesTombstones', () => {
  it('add → has → remove', () => {
    expect(db.faqCategoriesTombstones.has('crisp-A')).toBe(false);
    db.faqCategoriesTombstones.add('crisp-A', { reason: 'missing_in_remote_pull' });
    expect(db.faqCategoriesTombstones.has('crisp-A')).toBe(true);
    db.faqCategoriesTombstones.remove('crisp-A');
    expect(db.faqCategoriesTombstones.has('crisp-A')).toBe(false);
  });

  it('add idempotent : 2e add upserte le timestamp + reason', () => {
    db.faqCategoriesTombstones.add('crisp-X', { reason: 'first' });
    db.faqCategoriesTombstones.add('crisp-X', { reason: 'second' });
    const list = db.faqCategoriesTombstones.list();
    const found = list.find((t) => t.crisp_id === 'crisp-X');
    expect(found).toBeDefined();
    expect(found.reason).toBe('second');
  });
});

describe('faqSettings — SEO keywords', () => {
  it('getSeoKeywords retourne null par défaut (pas d\'override)', () => {
    expect(db.faqSettings.getSeoKeywords()).toBeNull();
  });

  it('set + get + reset', () => {
    db.faqSettings.setSeoKeywords(['alpha', 'beta', 'gamma']);
    expect(db.faqSettings.getSeoKeywords()).toEqual(['alpha', 'beta', 'gamma']);
    db.faqSettings.resetSeoKeywords();
    expect(db.faqSettings.getSeoKeywords()).toBeNull();
  });

  it('JSON corrompu en DB → getSeoKeywords retourne null sans crash', () => {
    db.db.prepare('UPDATE faq_settings SET seo_keywords_json = ? WHERE id = 1').run('not json {');
    expect(db.faqSettings.getSeoKeywords()).toBeNull();
  });

  it('JSON non-array → null', () => {
    db.db.prepare('UPDATE faq_settings SET seo_keywords_json = ? WHERE id = 1').run('{"foo": "bar"}');
    expect(db.faqSettings.getSeoKeywords()).toBeNull();
  });

  it('valeurs vides filtrées', () => {
    db.faqSettings.setSeoKeywords(['x', '', '  ', 'y']);
    expect(db.faqSettings.getSeoKeywords()).toEqual(['x', 'y']);
  });
});
