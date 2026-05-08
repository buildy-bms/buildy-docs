'use strict';

// Routes FAQ Buildy / Crisp Knowledge Base.
//
// Settings : credentials chiffrés via lib/crypto + website_id + locale.
// Catégories + articles : CRUD local + push manuel vers Crisp + pull global.
// IA : 3 endpoints (rewrite / generate / suggest-missing).

const { z } = require('zod');
const db = require('../database');
const log = require('../lib/logger').system;
const { encrypt } = require('../lib/crypto');
const {
  loadCrispCredentials,
  testConnection: testCrispConnection,
} = require('../lib/crisp');
const {
  pullFromCrisp,
  pushCategoryToCrisp,
  deleteCategoryOnCrisp,
  pushArticleToCrisp,
  deleteArticleOnCrisp,
} = require('../lib/faq-sync');
const {
  assistFaqRewrite,
  assistFaqGenerate,
  assistFaqSuggestMissing,
} = require('../lib/claude');
const { uploadImage } = require('../lib/faq-image-upload');
const { scoreArticle, DEFAULT_KEYWORDS, invalidateKeywordsCache } = require('../lib/seo-scorer');

// Recalcule et persiste le score SEO d'un article. Idempotent, lazy : à appeler
// après save/pull/generate pour garder la colonne seo_score à jour.
function recomputeSeoScore(article) {
  if (!article || !article.id) return null;
  const result = scoreArticle({
    title: article.title || '',
    contentHtml: article.content_html || '',
  });
  db.faqArticles.setSeoScore(article.id, { score: result.score, checks: result.checks });
  return result;
}

// ── Schemas ────────────────────────────────────────────────────────
const settingsSchema = z.object({
  api_identifier: z.string().min(1, 'Identifiant API requis'),
  api_key: z.string().min(1, 'Clé API requise'),
  website_id: z.string().min(1, 'Website ID requis'),
  default_locale: z.string().min(2).max(10).optional(),
});

const categorySchema = z.object({
  name: z.string().min(1, 'Nom requis'),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  order_index: z.number().int().optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  locale: z.string().min(2).max(10).optional(),
});

const articleCreateSchema = z.object({
  title: z.string().min(1, 'Titre requis'),
  description: z.string().max(160, 'Description max 160 caractères (limite Crisp)').nullable().optional(),
  content_html: z.string().nullable().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  locale: z.string().min(2).max(10).optional(),
});

const articleUpdateSchema = articleCreateSchema.partial().extend({
  // Optimistic locking : timestamp de la dernière version connue par le client.
  expected_updated_at: z.string().optional(),
});

// ── Helpers ────────────────────────────────────────────────────────
function settingsView() {
  const row = db.crispSettings.get();
  return {
    has_credentials: !!(row && row.api_identifier_encrypted && row.api_key_encrypted),
    website_id: row?.website_id || null,
    default_locale: row?.default_locale || 'fr',
    last_pull_at: row?.last_pull_at || null,
    last_pull_status: row?.last_pull_status || null,
    last_pull_error: row?.last_pull_error || null,
  };
}

async function routes(fastify) {
  // ── Settings ────────────────────────────────────────────────────
  fastify.get('/faq/settings', async () => settingsView());

  fastify.put('/faq/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0].message });
    }
    const { api_identifier, api_key, website_id, default_locale } = parsed.data;
    db.crispSettings.upsert({
      apiIdentifierEncrypted: encrypt(api_identifier),
      apiKeyEncrypted: encrypt(api_key),
      websiteId: website_id,
      defaultLocale: default_locale || 'fr',
    });
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'faq.settings.update',
      payload: { website_id, default_locale: default_locale || 'fr' },
    });
    log.info(`FAQ Crisp settings mis à jour par user=${request.authUser?.id}`);
    return settingsView();
  });

  fastify.post('/faq/test-connection', async () => {
    const creds = loadCrispCredentials();
    if (!creds) return { ok: false, error: 'Credentials Crisp non configurés' };
    return testCrispConnection(creds);
  });

  // ── Whitelist mots-clés SEO (override DB de DEFAULT_KEYWORDS) ─────
  const seoKeywordsSchema = z.object({
    keywords: z.array(
      z.string().trim().min(1, 'Mot-clé vide').max(60, 'Mot-clé trop long (max 60 chars)')
    ).min(1, 'Au moins un mot-clé requis').max(200, 'Maximum 200 mots-clés'),
  });

  function dedupKeywords(arr) {
    const seen = new Map();
    for (const raw of arr) {
      const trimmed = String(raw || '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    }
    return Array.from(seen.values());
  }

  fastify.get('/faq/settings/seo-keywords', async () => {
    const override = db.faqSettings.getSeoKeywords();
    return {
      keywords: override && override.length > 0 ? override : DEFAULT_KEYWORDS,
      defaults: DEFAULT_KEYWORDS,
      is_default: !override || override.length === 0,
    };
  });

  fastify.put('/faq/settings/seo-keywords', async (request, reply) => {
    const parsed = seoKeywordsSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0].message });
    }
    const cleaned = dedupKeywords(parsed.data.keywords);
    if (cleaned.length === 0) {
      return reply.code(400).send({ detail: 'Au moins un mot-clé non vide requis' });
    }
    db.faqSettings.setSeoKeywords(cleaned);
    invalidateKeywordsCache();
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'faq.seo_keywords.update',
      payload: { count: cleaned.length },
    });
    return { keywords: cleaned, defaults: DEFAULT_KEYWORDS, is_default: false };
  });

  fastify.post('/faq/settings/seo-keywords/reset', async (request) => {
    db.faqSettings.resetSeoKeywords();
    invalidateKeywordsCache();
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'faq.seo_keywords.reset',
      payload: {},
    });
    return { keywords: DEFAULT_KEYWORDS, defaults: DEFAULT_KEYWORDS, is_default: true };
  });

  fastify.post('/faq/sync/pull', async (request, reply) => {
    const creds = loadCrispCredentials();
    if (!creds) return reply.code(400).send({ detail: 'Credentials Crisp non configurés' });
    try {
      const result = await pullFromCrisp({});
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'faq.pull',
        payload: { ...result.pulled, conflicts: result.conflicts.length },
      });
      return result;
    } catch (e) {
      log.warn(`FAQ pull failed: ${e.message}`);
      return reply.code(e.status || 502).send({ detail: e.message });
    }
  });

  // ── Catégories ──────────────────────────────────────────────────
  fastify.get('/faq/categories', async () => {
    return db.faqCategories.list();
  });

  fastify.post('/faq/categories', async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0].message });
    }
    const data = parsed.data;
    const created = db.faqCategories.create({
      name: data.name,
      description: data.description || null,
      color: data.color || null,
      orderIndex: data.order_index || 0,
      parentId: data.parent_id || null,
      locale: data.locale || 'fr',
      dirty: 1,
    });
    return created;
  });

  fastify.patch('/faq/categories/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cat = db.faqCategories.getById(id);
    if (!cat) return reply.code(404).send({ detail: 'Catégorie introuvable' });
    const parsed = categorySchema.partial().safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0].message });
    }
    const patch = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.color !== undefined) patch.color = parsed.data.color;
    if (parsed.data.order_index !== undefined) patch.orderIndex = parsed.data.order_index;
    if (parsed.data.parent_id !== undefined) patch.parentId = parsed.data.parent_id;
    if (parsed.data.locale !== undefined) patch.locale = parsed.data.locale;
    patch.dirty = 1;
    return db.faqCategories.update(id, patch);
  });

  fastify.delete('/faq/categories/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const force = request.query?.force === '1' || request.query?.force === 'true';
    try {
      await deleteCategoryOnCrisp(id, { force });
      return { ok: true };
    } catch (e) {
      const code = e.status || 500;
      return reply.code(code).send({ detail: e.message });
    }
  });

  fastify.post('/faq/categories/:id/push', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    try {
      const updated = await pushCategoryToCrisp(id);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'faq.category.push',
        payload: { id, crisp_id: updated.crisp_id },
      });
      return updated;
    } catch (e) {
      log.warn(`FAQ push category ${id}: ${e.message}`);
      return reply.code(502).send({ detail: e.message });
    }
  });

  // ── Articles ────────────────────────────────────────────────────
  fastify.get('/faq/articles', async (request) => {
    const { category_id, status, q, locale } = request.query || {};
    return db.faqArticles.list({
      categoryId: category_id !== undefined ? parseInt(category_id, 10) : null,
      status: status || null,
      q: q || null,
      locale: locale || null,
    });
  });

  fastify.get('/faq/articles/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const article = db.faqArticles.getById(id);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    return article;
  });

  // ── Résolution de conflit pull/edit ──────────────────────────────
  // Un article en conflit (dirty=1 + remote modifié) reste verrouillé tant
  // que l'utilisateur n'a pas tranché : "garder local" ou "écraser par remote".
  fastify.post('/faq/articles/:id/resolve-conflict', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const strategy = request.body?.strategy || request.query?.strategy;
    const article = db.faqArticles.getById(id);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    if (!['local', 'remote'].includes(strategy)) {
      return reply.code(400).send({ detail: 'strategy doit être "local" ou "remote"' });
    }
    if (strategy === 'local') {
      // L'utilisateur garde sa version : on lève simplement le flag dirty au
      // prochain push réussi. On force déjà ici dirty=1 pour qu'il sache que
      // sa version doit être pushée pour réconcilier remote.
      db.faqArticles.update(id, { dirty: 1 }, request.authUser?.id || null);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'faq.article.conflict_resolved',
        payload: { article_id: id, strategy: 'local' },
      });
      return { ok: true, strategy: 'local', detail: 'Pousse vers Crisp pour propager ta version.' };
    }
    // strategy === 'remote' → snapshot puis re-pull cet article seul.
    if (!article.crisp_id) {
      return reply.code(400).send({ detail: 'Article jamais publié, "remote" non applicable.' });
    }
    try { db.faqArticles.snapshot(id, { reason: 'before_conflict_remote', userId: request.authUser?.id || null }); }
    catch (e) { log.warn(`Snapshot before_conflict_remote ${id} échec : ${e.message}`); }
    try {
      const creds = loadCrispCredentials();
      if (!creds) throw new Error('Credentials Crisp non configurés');
      const { crispClient } = require('../lib/crisp');
      const { crispMarkdownToHtml } = require('../lib/crisp-markdown');
      const client = crispClient(creds);
      const full = await client.getArticle(article.locale || creds.defaultLocale, article.crisp_id);
      db.faqArticles.update(id, {
        title: full.title || article.title,
        description: full.description || null,
        contentHtml: crispMarkdownToHtml(full.content || ''),
        status: full.status === 'published' || full.published ? 'published' : 'draft',
        dirty: 0,
        pulledAt: new Date().toISOString(),
        crispUrl: full.url || article.crisp_url || null,
      }, request.authUser?.id || null);
      const updated = db.faqArticles.getById(id);
      recomputeSeoScore(updated);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'faq.article.conflict_resolved',
        payload: { article_id: id, strategy: 'remote' },
      });
      return { ok: true, strategy: 'remote', article: updated };
    } catch (e) {
      log.warn(`Resolve conflict remote ${id}: ${e.message}`);
      return reply.code(502).send({ detail: e.message });
    }
  });

  // ── Historique de versions ───────────────────────────────────────
  fastify.get('/faq/articles/:id/versions', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const article = db.faqArticles.getById(id);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    return db.faqArticles.listVersions(id, { limit: 50 });
  });

  fastify.post('/faq/articles/:id/versions/:versionId/restore', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const versionId = parseInt(request.params.versionId, 10);
    const article = db.faqArticles.getById(id);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    const version = db.faqArticles.getVersion(versionId);
    if (!version || version.article_id !== id) {
      return reply.code(404).send({ detail: 'Version introuvable' });
    }
    // Snapshot l'état actuel avant l'écrasement, pour permettre un revert.
    try { db.faqArticles.snapshot(id, { reason: 'before_restore', userId: request.authUser?.id || null }); }
    catch (e) { log.warn(`Snapshot before_restore article=${id} échec : ${e.message}`); }
    // Restaure title + content_html + status. Description, category et meta divers
    // ne sont pas dans la table de versions historique → restés inchangés.
    db.faqArticles.update(id, {
      title: version.title,
      contentHtml: version.content_html,
      status: version.status,
      dirty: 1, // article diffère désormais de la version Crisp si déjà publié
    }, request.authUser?.id || null);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'faq.article.restore',
      payload: { article_id: id, version_id: versionId, version_reason: version.reason },
    });
    const updated = db.faqArticles.getById(id);
    recomputeSeoScore(updated);
    return db.faqArticles.getById(id);
  });

  fastify.post('/faq/articles', async (request, reply) => {
    const parsed = articleCreateSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0].message });
    }
    const data = parsed.data;
    const created = db.faqArticles.create({
      title: data.title,
      contentHtml: data.content_html || '',
      categoryId: data.category_id || null,
      status: data.status || 'draft',
      visibility: data.visibility || 'public',
      locale: data.locale || 'fr',
      dirty: 1,
      createdBy: request.authUser?.id || null,
    });
    return created;
  });

  fastify.patch('/faq/articles/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const article = db.faqArticles.getById(id);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    // Optimistic locking : si le client envoie expected_updated_at, on rejette
    // si l'article a été modifié entre temps (édition concurrente 2 onglets).
    // Header absent = comportement legacy (compat rétro).
    const expected = request.body?.expected_updated_at || request.headers['if-match'];
    if (expected && article.updated_at && expected !== article.updated_at) {
      return reply.code(409).send({
        detail: 'Cet article a été modifié ailleurs depuis votre dernier chargement.',
        current_updated_at: article.updated_at,
      });
    }
    const parsed = articleUpdateSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0].message });
    }
    const patch = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.content_html !== undefined) patch.contentHtml = parsed.data.content_html;
    if (parsed.data.category_id !== undefined) patch.categoryId = parsed.data.category_id;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;
    if (parsed.data.locale !== undefined) patch.locale = parsed.data.locale;
    patch.dirty = 1;
    const updated = db.faqArticles.update(id, patch, request.authUser?.id || null);
    // Recalcul SEO si le contenu ou le titre a changé
    if (parsed.data.title !== undefined || parsed.data.content_html !== undefined) {
      recomputeSeoScore(updated);
    }
    return db.faqArticles.getById(id);
  });

  // Endpoint dédié : retourne le score SEO + checks détaillés (pour le badge éditeur)
  fastify.get('/faq/articles/:id/seo-score', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const article = db.faqArticles.getById(id);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    // Recalcul live à chaque appel (pas de cache, c'est rapide)
    const result = scoreArticle({
      title: article.title || '',
      contentHtml: article.content_html || '',
    });
    // Persiste pour les requêtes futures (few-shot examples picker)
    db.faqArticles.setSeoScore(id, { score: result.score, checks: result.checks });
    return result;
  });

  fastify.delete('/faq/articles/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    try {
      await deleteArticleOnCrisp(id);
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ detail: e.message });
    }
  });

  fastify.post('/faq/articles/:id/push', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    try {
      const updated = await pushArticleToCrisp(id, request.authUser?.id || null);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'faq.article.push',
        payload: { id, crisp_id: updated.crisp_id, status: updated.status },
      });
      return updated;
    } catch (e) {
      log.warn(`FAQ push article ${id}: ${e.message}`);
      return reply.code(e.status || 502).send({ detail: e.message });
    }
  });

  // ── IA ──────────────────────────────────────────────────────────
  // Helper : snapshot avant tout appel IA mutant. Permet la restauration via
  // l'historique si Claude pourrit l'article. Idempotent, n'échoue jamais.
  function snapshotBeforeAi(articleId, reason, userId) {
    try { db.faqArticles.snapshot(articleId, { reason, userId }); }
    catch (e) { log.warn(`Snapshot ${reason} article=${articleId} échec : ${e.message}`); }
  }

  fastify.post('/faq/ai/rewrite', async (request, reply) => {
    const articleId = parseInt(request.body?.article_id, 10);
    if (!articleId) return reply.code(400).send({ detail: 'article_id requis' });
    const article = db.faqArticles.getById(articleId);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    const cat = article.category_id ? db.faqCategories.getById(article.category_id) : null;
    snapshotBeforeAi(articleId, 'before_ai_rewrite', request.authUser?.id || null);
    try {
      const result = await assistFaqRewrite({
        article: { ...article, category_name: cat?.name || null },
      });
      db.faqArticles.update(articleId, {
        lastAiAssistAt: new Date().toISOString(),
      }, request.authUser?.id || null);
      return result;
    } catch (e) {
      log.warn(`FAQ AI rewrite ${articleId}: ${e.message}`);
      return reply.code(500).send({ detail: e.message });
    }
  });

  // Reformulation IA du titre uniquement
  fastify.post('/faq/ai/rewrite-title', async (request, reply) => {
    const articleId = parseInt(request.body?.article_id, 10);
    if (!articleId) return reply.code(400).send({ detail: 'article_id requis' });
    const article = db.faqArticles.getById(articleId);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    snapshotBeforeAi(articleId, 'before_ai_rewrite_title', request.authUser?.id || null);
    try {
      const { assistFaqRewriteTitle } = require('../lib/claude');
      return await assistFaqRewriteTitle({ article });
    } catch (e) {
      log.warn(`FAQ AI rewrite-title ${articleId}: ${e.message}`);
      return reply.code(500).send({ detail: e.message });
    }
  });

  // Reformulation / génération IA de la description (meta-description SEO)
  fastify.post('/faq/ai/rewrite-description', async (request, reply) => {
    const articleId = parseInt(request.body?.article_id, 10);
    if (!articleId) return reply.code(400).send({ detail: 'article_id requis' });
    const article = db.faqArticles.getById(articleId);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    snapshotBeforeAi(articleId, 'before_ai_rewrite_description', request.authUser?.id || null);
    try {
      const { assistFaqRewriteDescription } = require('../lib/claude');
      return await assistFaqRewriteDescription({ article });
    } catch (e) {
      log.warn(`FAQ AI rewrite-description ${articleId}: ${e.message}`);
      return reply.code(500).send({ detail: e.message });
    }
  });

  // Réécriture IA d'une sélection HTML dans l'éditeur (BubbleMenu Tiptap).
  fastify.post('/faq/ai/rewrite-selection', async (request, reply) => {
    const articleId = parseInt(request.body?.article_id, 10);
    const selectionHtml = (request.body?.selection_html || '').trim();
    const instruction = (request.body?.instruction || '').trim();
    if (!articleId) return reply.code(400).send({ detail: 'article_id requis' });
    if (!selectionHtml) return reply.code(400).send({ detail: 'selection_html requis' });
    const article = db.faqArticles.getById(articleId);
    if (!article) return reply.code(404).send({ detail: 'Article introuvable' });
    snapshotBeforeAi(articleId, 'before_ai_rewrite_selection', request.authUser?.id || null);
    try {
      const { assistFaqRewriteSelection } = require('../lib/claude');
      return await assistFaqRewriteSelection({ article, selectionHtml, instruction });
    } catch (e) {
      log.warn(`FAQ AI rewrite-selection ${articleId}: ${e.message}`);
      return reply.code(500).send({ detail: e.message });
    }
  });

  fastify.post('/faq/ai/generate', async (request, reply) => {
    const question = (request.body?.question || '').trim();
    const categoryId = request.body?.category_id ? parseInt(request.body.category_id, 10) : null;
    if (!question) return reply.code(400).send({ detail: 'question requise' });
    const cat = categoryId ? db.faqCategories.getById(categoryId) : null;
    try {
      return await assistFaqGenerate({
        question,
        categoryName: cat?.name || null,
      });
    } catch (e) {
      log.warn(`FAQ AI generate: ${e.message}`);
      return reply.code(500).send({ detail: e.message });
    }
  });

  fastify.post('/faq/ai/missing-articles', async (request, reply) => {
    try {
      return await assistFaqSuggestMissing();
    } catch (e) {
      log.warn(`FAQ AI missing: ${e.message}`);
      return reply.code(500).send({ detail: e.message });
    }
  });

  // ── Upload image (multipart) ─────────────────────────────────────
  // Reçoit un fichier image, l'optimise (sharp), pousse sur FTP OVH,
  // renvoie l'URL publique pour insertion dans l'éditeur.
  fastify.post('/faq/upload-image', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ detail: 'Aucun fichier reçu' });
    try {
      const buffer = await file.toBuffer();
      const result = await uploadImage(buffer, file.mimetype);
      db.auditLog.add({
        userId: request.authUser?.id,
        action: 'faq.image.upload',
        payload: { filename: file.filename, size: result.size, format: result.format },
      });
      return result;
    } catch (e) {
      log.warn(`FAQ image upload: ${e.message}`);
      return reply.code(400).send({ detail: e.message });
    }
  });
}

module.exports = routes;
