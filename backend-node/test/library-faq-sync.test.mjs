// Tests d'intégration du service Sync bibliothèque -> FAQ (Lot 138).
// Couvre les flows critiques sans appeler Claude ni FTP réels :
//   - création d'un article FAQ depuis une fonctionnalité
//   - détection de divergence (biblio modifiée après génération)
//   - garde-fou faq_publishable=0 (confidentiel)
//   - régénération forcée vs refus si édition manuelle (source_overridden=1)
//   - tracking BACS articles + maillage interne
//
// Stratégie de mock : pré-injecte des modules factices pour lib/claude
// (assistFaqGenerateFromFunctionality) et lib/faq-image-upload (uploadImage)
// AVANT le require de lib/library-faq-sync.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-faq-sync-test-'));
let db;
let service;
let mockClaudeReturn;
let claudeCallCount;
let mockUploadReturn;

beforeEach(() => {
  const dbPath = path.join(tmpDir, `db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  for (const k of Object.keys(require.cache)) delete require.cache[k];

  db = require('../src/database');
  db.init();

  // Mock lib/claude : retourne un article IA prédéfini par défaut.
  mockClaudeReturn = {
    title: 'Article généré IA',
    description: 'Meta-description SEO de test, 100 chars environ, dans la cible 140-155.',
    html: '<p>Contenu généré par l\'IA.</p>',
    seo_score: 75,
  };
  claudeCallCount = 0;
  const claudePath = require.resolve('../src/lib/claude');
  require.cache[claudePath] = {
    id: claudePath, filename: claudePath, loaded: true,
    exports: {
      assistFaqGenerateFromFunctionality: vi.fn(async () => {
        claudeCallCount++;
        return mockClaudeReturn;
      }),
    },
  };

  // Mock lib/faq-image-upload : retourne une URL FTP prédéfinie.
  mockUploadReturn = { url: 'https://www.buildy.fr/docs/crisp-faq/mock-uuid.webp', width: 800, size: 12345, format: 'webp' };
  const uploadPath = require.resolve('../src/lib/faq-image-upload');
  require.cache[uploadPath] = {
    id: uploadPath, filename: uploadPath, loaded: true,
    exports: {
      uploadImage: vi.fn(async () => mockUploadReturn),
    },
  };

  service = require('../src/lib/library-faq-sync');
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

// Helper : crée une fonctionnalité de test (section_template avec is_functionality=1).
function seedFunctionality(extra = {}) {
  const result = db.db.prepare(`
    INSERT INTO section_templates (slug, title, kind, is_functionality, body_html, bacs_articles, faq_publishable)
    VALUES (?, ?, 'standard', 1, ?, ?, ?)
  `).run(
    extra.slug || `func-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    extra.title || 'Fonctionnalité test',
    extra.body_html || '<p>Description riche.</p>',
    extra.bacs_articles || null,
    extra.faq_publishable === false ? 0 : 1,
  );
  return db.db.prepare('SELECT * FROM section_templates WHERE id = ?').get(result.lastInsertRowid);
}

describe('generateFaqFromFunctionality', () => {
  it('crée un nouvel article FAQ avec lien vers la fonctionnalité', async () => {
    const tpl = seedFunctionality({ title: 'Hypervision multi-sites GTB' });

    const article = await service.generateFaqFromFunctionality({
      sectionTemplateId: tpl.id,
      categoryId: null,
      locale: 'fr',
      userId: null,
    });

    expect(article.id).toBeDefined();
    expect(article.title).toBe('Article généré IA');
    expect(article.content_html).toContain('Contenu généré par l\'IA');
    expect(article.source_section_template_id).toBe(tpl.id);
    expect(article.source_synced_version).toBe(tpl.current_version || 1);
    expect(article.source_synced_at).toBeTruthy();
    expect(article.source_overridden).toBe(0);
    expect(article.status).toBe('draft');
    expect(article.dirty).toBe(1);
    expect(claudeCallCount).toBe(1);
  });

  it('rejette une fonctionnalité confidentielle (faq_publishable=0)', async () => {
    const tpl = seedFunctionality({ title: 'Algorithme propriétaire', faq_publishable: false });
    await expect(service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id }))
      .rejects.toMatchObject({ status: 403 });
    expect(claudeCallCount).toBe(0); // pas d'appel IA, garde-fou amont
  });

  it('rejette si la section_template n\'est pas une fonctionnalité', async () => {
    const result = db.db.prepare(`
      INSERT INTO section_templates (slug, title, kind, is_functionality) VALUES (?, ?, 'standard', 0)
    `).run('not-a-func-' + Date.now(), 'Section narrative');
    const id = result.lastInsertRowid;
    await expect(service.generateFaqFromFunctionality({ sectionTemplateId: id }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejette si la fonctionnalité n\'existe pas', async () => {
    await expect(service.generateFaqFromFunctionality({ sectionTemplateId: 999999 }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('persiste les codes BACS de la fonctionnalité sur l\'article', async () => {
    const tpl = seedFunctionality({ bacs_articles: 'R175-3 1°, R175-6' });
    const article = await service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id });
    expect(article.bacs_articles).toBe('R175-3 1°, R175-6');
  });
});

describe('getFaqStatusForFunctionality', () => {
  it('exists_template=false si fonctionnalité absente', () => {
    const status = service.getFaqStatusForFunctionality(999999);
    expect(status.exists_template).toBe(false);
  });

  it('article=null si aucun article FAQ généré', () => {
    const tpl = seedFunctionality();
    const status = service.getFaqStatusForFunctionality(tpl.id);
    expect(status.exists_template).toBe(true);
    expect(status.article).toBeNull();
    expect(status.faq_publishable).toBe(true);
    expect(status.diverged).toBe(false);
    expect(status.overridden).toBe(false);
  });

  it('faq_publishable=false si la fonctionnalité est confidentielle', () => {
    const tpl = seedFunctionality({ faq_publishable: false });
    const status = service.getFaqStatusForFunctionality(tpl.id);
    expect(status.faq_publishable).toBe(false);
  });

  it('diverged=true si version_biblio > version_synced', async () => {
    const tpl = seedFunctionality();
    await service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id });
    // Bump la version de la fonctionnalité pour simuler une modif post-sync
    db.db.prepare('UPDATE section_templates SET current_version = current_version + 1 WHERE id = ?').run(tpl.id);
    const status = service.getFaqStatusForFunctionality(tpl.id);
    expect(status.diverged).toBe(true);
    expect(status.article).toBeDefined();
  });

  it('diverged=false juste après génération', async () => {
    const tpl = seedFunctionality();
    await service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id });
    const status = service.getFaqStatusForFunctionality(tpl.id);
    expect(status.diverged).toBe(false);
  });
});

describe('regenerateFaqFromFunctionality', () => {
  it('regénère l\'article et reset source_overridden=0', async () => {
    const tpl = seedFunctionality();
    const article = await service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id });

    // Simule une édition manuelle utilisateur
    db.faqArticles.update(article.id, { sourceOverridden: 1, title: 'Modifié à la main' });

    mockClaudeReturn = { ...mockClaudeReturn, title: 'Nouveau titre IA', html: '<p>Nouveau contenu.</p>' };
    const regenerated = await service.regenerateFaqFromFunctionality({
      articleId: article.id,
      force: true,
    });

    expect(regenerated.title).toBe('Nouveau titre IA');
    expect(regenerated.content_html).toContain('Nouveau contenu');
    expect(regenerated.source_overridden).toBe(0);
    expect(claudeCallCount).toBe(2); // 1 generate + 1 regenerate
  });

  it('refuse la regénération si source_overridden=1 et force=false (409)', async () => {
    const tpl = seedFunctionality();
    const article = await service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id });
    db.faqArticles.update(article.id, { sourceOverridden: 1 });

    await expect(service.regenerateFaqFromFunctionality({ articleId: article.id, force: false }))
      .rejects.toMatchObject({ status: 409 });
    expect(claudeCallCount).toBe(1); // pas de 2e appel
  });

  it('crée un snapshot avant écrasement (rollback possible)', async () => {
    const tpl = seedFunctionality();
    const article = await service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id });
    db.faqArticles.update(article.id, { title: 'Édité manuellement' });

    await service.regenerateFaqFromFunctionality({ articleId: article.id, force: true });

    const versions = db.faqArticles.listVersions(article.id);
    const beforeResync = versions.find((v) => v.reason === 'before_library_resync');
    expect(beforeResync).toBeDefined();
    expect(beforeResync.title).toBe('Édité manuellement');
  });

  it('rejette si la fonctionnalité source devient confidentielle (403)', async () => {
    const tpl = seedFunctionality();
    const article = await service.generateFaqFromFunctionality({ sectionTemplateId: tpl.id });
    // L'admin marque la fonctionnalité confidentielle après coup
    db.db.prepare('UPDATE section_templates SET faq_publishable = 0 WHERE id = ?').run(tpl.id);

    await expect(service.regenerateFaqFromFunctionality({ articleId: article.id, force: true }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejette si l\'article n\'est pas lié à une fonctionnalité', async () => {
    const created = db.faqArticles.create({ title: 'Article standalone' });
    await expect(service.regenerateFaqFromFunctionality({ articleId: created.id, force: true }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('Maillage BACS interne (Lot 138 §3ter)', () => {
  it('listBacsCoverage retourne les articles publiés couvrant des codes BACS', () => {
    // Crée 3 articles publiés avec différents codes BACS
    db.faqArticles.create({
      title: 'Décret BACS R175 — Éligibilité',
      bacsArticles: 'R175-1',
      status: 'published',
      crispUrl: 'https://help.buildy.fr/fr/article/decret-bacs-eligibilite-abc/',
    });
    db.faqArticles.create({
      title: 'R175-3 : suivi horaire',
      bacsArticles: 'R175-3 1°, R175-3 2°',
      status: 'published',
      crispUrl: 'https://help.buildy.fr/fr/article/r175-3-suivi-def/',
    });
    db.faqArticles.create({
      title: 'Article sans BACS',
      bacsArticles: null,
      status: 'published',
      crispUrl: 'https://help.buildy.fr/fr/article/autre-xyz/',
    });

    const coverage = db.faqArticles.listBacsCoverage(['R175-1']);
    expect(coverage.length).toBe(1);
    expect(coverage[0].title).toContain('Éligibilité');

    const coverage2 = db.faqArticles.listBacsCoverage(['R175-3 1°']);
    expect(coverage2.length).toBe(1);
    expect(coverage2[0].title).toContain('suivi horaire');

    const coverageNone = db.faqArticles.listBacsCoverage(['R175-99']);
    expect(coverageNone.length).toBe(0);
  });

  it('listBacsCoverage exclut les articles non publiés ou sans crisp_url', () => {
    db.faqArticles.create({
      title: 'Draft BACS',
      bacsArticles: 'R175-1',
      status: 'draft', // pas publié
      crispUrl: 'https://help.buildy.fr/fr/article/test/',
    });
    db.faqArticles.create({
      title: 'Publié sans URL',
      bacsArticles: 'R175-1',
      status: 'published',
      crispUrl: null, // pas encore push
    });
    expect(db.faqArticles.listBacsCoverage(['R175-1']).length).toBe(0);
  });
});

describe('libraryAttachmentPublications (cache de l\'upload FTP)', () => {
  it('upsert + get + remove (FK satisfaite via vrai attachment)', () => {
    // Crée d'abord un section_template puis un attachment FK-valide
    const tpl = seedFunctionality();
    const userRes = db.db.prepare(`INSERT INTO users (oidc_sub, oidc_issuer, email, display_name) VALUES ('u', 'i', 'u@x', 'U')`).run();
    const userId = userRes.lastInsertRowid;
    const attRes = db.db.prepare(`
      INSERT INTO attachments (filename, original_name, section_template_id, position, uploaded_by)
      VALUES ('test.webp', 'test.webp', ?, 0, ?)
    `).run(tpl.id, userId);
    const attId = attRes.lastInsertRowid;

    db.libraryAttachmentPublications.upsert({
      attachmentId: attId,
      ftpUrl: 'https://www.buildy.fr/docs/crisp-faq/abc.webp',
      fileHash: 'sha256hash',
    });
    const row = db.libraryAttachmentPublications.get(attId);
    expect(row).toBeDefined();
    expect(row.ftp_url).toBe('https://www.buildy.fr/docs/crisp-faq/abc.webp');
    expect(row.file_hash).toBe('sha256hash');

    // Upsert avec hash différent → met à jour
    db.libraryAttachmentPublications.upsert({
      attachmentId: attId,
      ftpUrl: 'https://www.buildy.fr/docs/crisp-faq/new.webp',
      fileHash: 'newhash',
    });
    expect(db.libraryAttachmentPublications.get(attId).ftp_url).toContain('new.webp');

    db.libraryAttachmentPublications.remove(attId);
    expect(db.libraryAttachmentPublications.get(attId)).toBeUndefined();
  });

  it('CASCADE : suppression de l\'attachment efface le mapping', () => {
    const tpl = seedFunctionality();
    const userRes = db.db.prepare(`INSERT INTO users (oidc_sub, oidc_issuer, email, display_name) VALUES ('u2', 'i', 'u2@x', 'U2')`).run();
    const userId = userRes.lastInsertRowid;
    const attRes = db.db.prepare(`
      INSERT INTO attachments (filename, original_name, section_template_id, position, uploaded_by)
      VALUES ('cascade.webp', 'cascade.webp', ?, 0, ?)
    `).run(tpl.id, userId);
    const attId = attRes.lastInsertRowid;

    db.libraryAttachmentPublications.upsert({
      attachmentId: attId,
      ftpUrl: 'https://www.buildy.fr/docs/crisp-faq/cascade.webp',
      fileHash: 'h',
    });
    expect(db.libraryAttachmentPublications.get(attId)).toBeDefined();

    // Supprime l'attachment → cascade doit nettoyer
    db.db.prepare('DELETE FROM attachments WHERE id = ?').run(attId);
    expect(db.libraryAttachmentPublications.get(attId)).toBeUndefined();
  });
});
