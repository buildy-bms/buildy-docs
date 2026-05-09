// Tests d'intégration de faq-sync.js (push, pull) avec mock du wrapper
// `lib/crisp.js`. Couvre les régressions Sprint 1-3 :
//   - B1 push transactionnel : crisp_id sauvegardé immédiatement, pas de
//     doublon Crisp si étape ultérieure échoue
//   - I3 updateArticleCategory log warn (pas swallow muet)
//   - I4 fetch crisp_url post-push
//   - I5 pull respecte description locale
//   - I6 ghost catégorie → tombstone
//   - I6 résurrection catégorie → tombstone levé
//
// Stratégie de mock : on pré-injecte une fausse exports object dans
// require.cache pour `lib/crisp` AVANT de require `faq-sync`, qui destructure
// `{ loadCrispCredentials, crispClient }` à son chargement. La fausse fixture
// est mutée par chaque test via `installClient(...)`.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faq-sync-test-'));
let db;
let faqSync;
let sharedClient; // singleton client object — muté par chaque test via installClient

function makeDefaultClient() {
  return {
    listCategories: vi.fn().mockResolvedValue([]),
    listAllArticles: vi.fn().mockResolvedValue([]),
    getArticle: vi.fn().mockResolvedValue({}),
    createArticle: vi.fn().mockResolvedValue({ article_id: 'crisp-new' }),
    updateArticle: vi.fn().mockResolvedValue({}),
    publishArticle: vi.fn().mockResolvedValue({}),
    updateArticleCategory: vi.fn().mockResolvedValue({}),
    createCategory: vi.fn().mockResolvedValue({ data: { category_id: 'crisp-cat-new' } }),
    updateCategory: vi.fn().mockResolvedValue({}),
    deleteArticle: vi.fn().mockResolvedValue({}),
    deleteCategory: vi.fn().mockResolvedValue({}),
  };
}

beforeEach(() => {
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];

  db = require('../src/database');
  db.init();

  // Singleton client object : faq-sync appelle crispClient(creds) dans chaque
  // fonction, on retourne TOUJOURS le même objet. Les tests mutent ses méthodes
  // via installClient(...) avant d'appeler les fonctions de faq-sync.
  sharedClient = makeDefaultClient();
  const crispMockExports = {
    loadCrispCredentials: () => ({ apiIdentifier: 'tid', apiKey: 'tkey', websiteId: 'wid', defaultLocale: 'fr' }),
    crispClient: () => sharedClient,
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  };
  const crispPath = require.resolve('../src/lib/crisp');
  require.cache[crispPath] = {
    id: crispPath, filename: crispPath, loaded: true, exports: crispMockExports,
  };

  faqSync = require('../src/lib/faq-sync');
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

// Mute les méthodes du client partagé. À appeler AVANT push/pull dans le test.
function installClient(overrides) {
  Object.assign(sharedClient, overrides);
  return sharedClient;
}

function seedArticle(extra = {}) {
  return db.faqArticles.create({
    title: 'Article test',
    contentHtml: '<p>contenu</p>',
    status: 'draft',
    visibility: 'public',
    locale: 'fr',
    dirty: 1,
    ...extra,
  });
}

describe('pushArticleToCrisp — B1 transactionnel', () => {
  it('push article neuf : crisp_id, dirty=0, crisp_url, snapshot before_push', async () => {
    const a = seedArticle({ title: 'Mon article', contentHtml: '<p>texte</p>' });
    const client = installClient({
      createArticle: vi.fn().mockResolvedValue({ article_id: 'crisp-42' }),
      getArticle: vi.fn().mockResolvedValue({ url: 'https://help.buildy.fr/fr/article/x-42/' }),
    });

    await faqSync.pushArticleToCrisp(a.id);

    const after = db.faqArticles.getById(a.id);
    expect(after.crisp_id).toBe('crisp-42');
    expect(after.dirty).toBe(0);
    expect(after.crisp_url).toBe('https://help.buildy.fr/fr/article/x-42/');
    expect(after.pushed_at).toBeTruthy();

    // Snapshot before_push créé
    const versions = db.faqArticles.listVersions(a.id);
    expect(versions.some((v) => v.reason === 'before_push')).toBe(true);

    // Ordre des appels : createArticle puis updateArticle puis publishArticle
    expect(client.createArticle).toHaveBeenCalled();
    expect(client.updateArticle).toHaveBeenCalled();
    expect(client.publishArticle).toHaveBeenCalled();
  });

  it('échec mi-chemin : crisp_id sauvegardé, mais dirty reste à 1 (pas de doublon au retry)', async () => {
    const a = seedArticle();
    installClient({
      createArticle: vi.fn().mockResolvedValue({ article_id: 'crisp-77' }),
      updateArticle: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    await expect(faqSync.pushArticleToCrisp(a.id)).rejects.toThrow('Network error');

    // CRITIQUE : crisp_id est désormais set en DB, donc un retry ne va PAS recréer un doublon Crisp
    const after = db.faqArticles.getById(a.id);
    expect(after.crisp_id).toBe('crisp-77');
    expect(after.dirty).toBe(1); // toujours pas synchronisé
    expect(after.pushed_at).toBeNull();
  });

  it('updateArticleCategory échec ne bloque pas le push (log warn, I3)', async () => {
    // Article avec catégorie existante mais updateArticleCategory rejette
    const cat = db.faqCategories.create({ name: 'Cat', locale: 'fr', dirty: 0, crispId: 'crisp-cat-1' });
    const a = seedArticle({ crispId: 'crisp-existing', categoryId: cat.id });

    const client = installClient({
      updateArticleCategory: vi.fn().mockRejectedValue(new Error('Cat 404')),
    });

    // Ne doit PAS throw
    await faqSync.pushArticleToCrisp(a.id);

    const after = db.faqArticles.getById(a.id);
    expect(after.dirty).toBe(0); // push réussi globalement
    expect(client.publishArticle).toHaveBeenCalled(); // chain a continué
  });

  it('I4 : crisp_url récupéré post-push via getArticle', async () => {
    const a = seedArticle({ crispId: 'crisp-99' });
    installClient({
      getArticle: vi.fn().mockResolvedValue({ url: 'https://help.buildy.fr/fr/article/y-99/' }),
    });
    await faqSync.pushArticleToCrisp(a.id);
    expect(db.faqArticles.getById(a.id).crisp_url).toBe('https://help.buildy.fr/fr/article/y-99/');
  });
});

describe('pullFromCrisp — I5/I6/I7', () => {
  it('I5 : pull respecte description locale (priorité local || remote)', async () => {
    // Article local avec description IA, remote vide
    db.faqArticles.create({
      title: 'X', crispId: 'crisp-X', dirty: 0, locale: 'fr',
      description: 'Description IA générée localement',
    });

    installClient({
      listCategories: vi.fn().mockResolvedValue([]),
      listAllArticles: vi.fn().mockResolvedValue([{
        article_id: 'crisp-X',
        title: 'X',
        description: '', // remote vide
        content: 'corps',
        status: 'draft',
      }]),
    });

    await faqSync.pullFromCrisp({});

    const after = db.faqArticles.getByCrispId('crisp-X');
    // La description locale doit être préservée
    expect(after.description).toBe('Description IA générée localement');
  });

  it('I6 : catégorie absente du listing remote → tombstone posé', async () => {
    db.faqCategories.create({ name: 'Ghost', crispId: 'crisp-cat-A', locale: 'fr', dirty: 0 });
    installClient({
      listCategories: vi.fn().mockResolvedValue([{ category_id: 'crisp-cat-B', name: 'B', order: 0 }]),
      listAllArticles: vi.fn().mockResolvedValue([]),
    });

    await faqSync.pullFromCrisp({});

    expect(db.faqCategoriesTombstones.has('crisp-cat-A')).toBe(true);
    expect(db.faqCategoriesTombstones.has('crisp-cat-B')).toBe(false);
  });

  it('I6 : résurrection catégorie → tombstone levé', async () => {
    db.faqCategoriesTombstones.add('crisp-cat-Z', { reason: 'missing_in_remote_pull' });
    installClient({
      listCategories: vi.fn().mockResolvedValue([{ category_id: 'crisp-cat-Z', name: 'Recreated', order: 0 }]),
      listAllArticles: vi.fn().mockResolvedValue([]),
    });

    await faqSync.pullFromCrisp({});

    expect(db.faqCategoriesTombstones.has('crisp-cat-Z')).toBe(false);
    // Et la catégorie est créée localement
    expect(db.faqCategories.getByCrispId('crisp-cat-Z')).toBeDefined();
  });

  it('article dirty=1 + remote modifié → conflit signalé, DB inchangée', async () => {
    const local = db.faqArticles.create({
      title: 'Original local', crispId: 'crisp-conflict', dirty: 1, locale: 'fr',
      contentHtml: '<p>local edits</p>',
    });

    installClient({
      listCategories: vi.fn().mockResolvedValue([]),
      listAllArticles: vi.fn().mockResolvedValue([{
        article_id: 'crisp-conflict',
        title: 'Modifié remote',
        content: 'remote edits',
        description: 'remote',
        status: 'draft',
      }]),
    });

    const result = await faqSync.pullFromCrisp({});
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].crisp_id).toBe('crisp-conflict');

    // DB pas écrasée (article reste dirty=1, titre local préservé)
    const after = db.faqArticles.getById(local.id);
    expect(after.title).toBe('Original local');
    expect(after.dirty).toBe(1);
  });
});
