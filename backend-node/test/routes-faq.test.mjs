// Tests d'intégration des routes FAQ via fastify.inject (in-process, pas de
// HTTP réseau). Couvre : optimistic locking PATCH, /versions historique,
// /versions/:vid/restore, /resolve-conflict, /seo-keywords (GET/PUT/reset).
// Pas de mock Crisp ici — les routes Crisp (push/pull) sont testées dans
// faq-sync.test.mjs avec mocks SDK.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-faq-test-'));
let db;
let fastify;
let app;

async function buildApp() {
  const Fastify = require('fastify');
  const f = Fastify({ logger: false });
  // Stub minimal : injecte un authUser fictif pour passer l'auth-hook (non
  // enregistré ici). Les routes utilisent juste `request.authUser?.id`.
  f.addHook('onRequest', async (request) => {
    request.authUser = { id: 1, email: 'test@buildy.fr', display_name: 'Test User' };
  });
  await f.register(require('../src/routes/faq'), { prefix: '/api' });
  await f.ready();
  return f;
}

beforeEach(async () => {
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  db = require('../src/database');
  db.init();
  // Seed un user pour les FK created_by / updated_by
  db.db.prepare(`INSERT INTO users (id, oidc_sub, oidc_issuer, email, display_name)
                 VALUES (1, 'test-sub', 'test', 'test@buildy.fr', 'Test User')`).run();
  app = await buildApp();
});

afterAll(async () => {
  if (app) await app.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

function seedArticle(extra = {}) {
  return db.faqArticles.create({
    title: 'Article test',
    contentHtml: '<p>contenu initial</p>',
    status: 'draft',
    visibility: 'public',
    locale: 'fr',
    dirty: 1,
    createdBy: 1,
    ...extra,
  });
}

describe('PATCH /faq/articles/:id — optimistic locking', () => {
  it('200 sans expected_updated_at (legacy compat)', async () => {
    const a = seedArticle();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/faq/articles/${a.id}`,
      payload: { title: 'Nouveau titre' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).title).toBe('Nouveau titre');
  });

  it('200 avec expected_updated_at correct', async () => {
    const a = seedArticle();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/faq/articles/${a.id}`,
      payload: { title: 'Edit', expected_updated_at: a.updated_at },
    });
    expect(res.statusCode).toBe(200);
  });

  it('409 si expected_updated_at obsolète (édition concurrente)', async () => {
    const a = seedArticle();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/faq/articles/${a.id}`,
      payload: { title: 'Edit', expected_updated_at: '2020-01-01 00:00:00' },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.detail).toMatch(/modifié ailleurs/);
    expect(body.current_updated_at).toBe(a.updated_at);
  });

  it('409 via header If-Match (équivalent body field)', async () => {
    const a = seedArticle();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/faq/articles/${a.id}`,
      headers: { 'if-match': '2020-01-01 00:00:00' },
      payload: { title: 'Edit' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /faq/articles/:id/versions', () => {
  it('404 article inexistant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/faq/articles/99999/versions' });
    expect(res.statusCode).toBe(404);
  });

  it('[] si aucun snapshot', async () => {
    const a = seedArticle();
    const res = await app.inject({ method: 'GET', url: `/api/faq/articles/${a.id}/versions` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('liste les snapshots avec reasons', async () => {
    const a = seedArticle();
    db.faqArticles.snapshot(a.id, { reason: 'before_push', userId: 1 });
    db.faqArticles.snapshot(a.id, { reason: 'before_ai_rewrite', userId: 1 });
    const res = await app.inject({ method: 'GET', url: `/api/faq/articles/${a.id}/versions` });
    expect(res.statusCode).toBe(200);
    const versions = JSON.parse(res.body);
    expect(versions.length).toBe(2);
    expect(versions.map((v) => v.reason).sort()).toEqual(['before_ai_rewrite', 'before_push']);
  });
});

describe('POST /faq/articles/:id/versions/:vid/restore', () => {
  it('404 si version d\'un autre article', async () => {
    const a1 = seedArticle();
    const a2 = seedArticle({ title: 'A2' });
    const vidA1 = db.faqArticles.snapshot(a1.id, { reason: 'before_push', userId: 1 });
    const res = await app.inject({
      method: 'POST',
      url: `/api/faq/articles/${a2.id}/versions/${vidA1}/restore`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('restore : article repris, dirty=1, snapshot before_restore créé', async () => {
    const a = seedArticle({ title: 'V1', contentHtml: '<p>v1</p>' });
    const vid = db.faqArticles.snapshot(a.id, { reason: 'before_push', userId: 1 });
    db.faqArticles.update(a.id, { title: 'V2', contentHtml: '<p>v2</p>', dirty: 0 });
    const res = await app.inject({
      method: 'POST',
      url: `/api/faq/articles/${a.id}/versions/${vid}/restore`,
    });
    expect(res.statusCode).toBe(200);
    const restored = JSON.parse(res.body);
    expect(restored.title).toBe('V1');
    expect(restored.content_html).toBe('<p>v1</p>');
    expect(restored.dirty).toBe(1); // article diffère désormais de Crisp
    // Snapshot before_restore doit exister
    const versions = db.faqArticles.listVersions(a.id);
    const beforeRestore = versions.find((v) => v.reason === 'before_restore');
    expect(beforeRestore).toBeDefined();
    expect(beforeRestore.title).toBe('V2'); // l'état AVANT restore
  });
});

describe('POST /faq/articles/:id/resolve-conflict', () => {
  it('400 strategy invalide', async () => {
    const a = seedArticle();
    const res = await app.inject({
      method: 'POST',
      url: `/api/faq/articles/${a.id}/resolve-conflict`,
      payload: { strategy: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('strategy=local force dirty=1', async () => {
    const a = seedArticle({ dirty: 0 });
    const res = await app.inject({
      method: 'POST',
      url: `/api/faq/articles/${a.id}/resolve-conflict`,
      payload: { strategy: 'local' },
    });
    expect(res.statusCode).toBe(200);
    expect(db.faqArticles.getById(a.id).dirty).toBe(1);
  });

  it('strategy=remote sans crisp_id → 400', async () => {
    const a = seedArticle({ crispId: null });
    const res = await app.inject({
      method: 'POST',
      url: `/api/faq/articles/${a.id}/resolve-conflict`,
      payload: { strategy: 'remote' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET/PUT/POST /faq/settings/seo-keywords', () => {
  it('GET défaut : is_default true, keywords = DEFAULT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/faq/settings/seo-keywords' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.is_default).toBe(true);
    expect(body.keywords).toContain('GTB');
  });

  it('PUT [] → 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/faq/settings/seo-keywords',
      payload: { keywords: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT mot-clé > 60 chars → 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/faq/settings/seo-keywords',
      payload: { keywords: ['x'.repeat(70)] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT 201 entries → 400 (max 200)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/faq/settings/seo-keywords',
      payload: { keywords: Array.from({ length: 201 }, (_, i) => `kw-${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT dédup case-insensitive', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/faq/settings/seo-keywords',
      payload: { keywords: ['alpha', 'ALPHA', 'beta'] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.keywords.length).toBe(2);
    expect(body.is_default).toBe(false);
  });

  it('POST reset → DEFAULT restauré', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/faq/settings/seo-keywords',
      payload: { keywords: ['custom'] },
    });
    const res = await app.inject({ method: 'POST', url: '/api/faq/settings/seo-keywords/reset' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.is_default).toBe(true);
  });
});
