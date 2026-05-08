'use strict';

// Service de synchronisation FAQ Buildy <-> Crisp Knowledge Base.
//
// Pull : récupère catégories + articles de Crisp, upsert en local. Si
// dirty=1 ET le contenu Crisp est plus récent -> conflit (pas écrasé).
// Push manuel : créé ou met à jour côté Crisp puis remet dirty=0.

const db = require('../database');
const { loadCrispCredentials, crispClient } = require('./crisp');
const { crispMarkdownToHtml, htmlToCrispMarkdown } = require('./crisp-markdown');
const { scoreArticle } = require('./seo-scorer');
const log = require('./logger').system;

// Lock applicatif en mémoire process pour éviter les pulls et pushes concurrents
// (race condition : un pull pendant un push peut écraser l'article qu'on vient de
// publier). Le lock est process-scoped → ok en single-PM2 (cas Buildy Docs).
// Réentrant : `acquire` retourne un flag indiquant si on est l'owner racine ;
// seul l'owner racine appelle `release`. TTL 5 min en cas de crash.
const SYNC_LOCK_TTL_MS = 5 * 60 * 1000;
let _syncLock = { active: false, kind: null, startedAt: 0, depth: 0 };

function acquireSyncLock(kind) {
  if (_syncLock.active) {
    const elapsed = Date.now() - _syncLock.startedAt;
    if (elapsed >= SYNC_LOCK_TTL_MS) {
      log.warn(`Sync lock stale ${_syncLock.kind} > ${SYNC_LOCK_TTL_MS}ms, on le force-libère.`);
      _syncLock = { active: false, kind: null, startedAt: 0, depth: 0 };
    } else {
      // Réentrance dans le même chemin async (ex : pushArticle → pushCategory).
      _syncLock.depth += 1;
      return false; // pas owner racine
    }
  }
  _syncLock = { active: true, kind, startedAt: Date.now(), depth: 1 };
  return true; // owner racine
}

function releaseSyncLock(isRoot) {
  if (!isRoot) {
    if (_syncLock.depth > 0) _syncLock.depth -= 1;
    return;
  }
  _syncLock = { active: false, kind: null, startedAt: 0, depth: 0 };
}

// Recalcule le score SEO d'un article après upsert (pull/push) et le persiste.
function _recomputeSeoScoreById(articleId) {
  if (!articleId) return null;
  const a = db.faqArticles.getById(articleId);
  if (!a) return null;
  const r = scoreArticle({ title: a.title || '', contentHtml: a.content_html || '' });
  db.faqArticles.setSeoScore(articleId, { score: r.score, checks: r.checks });
  return r;
}

function _toCrispCategoryPayload(cat) {
  return {
    name: cat.name,
    description: cat.description || undefined,
    color: cat.color || undefined,
    order: cat.order_index || 0,
  };
}

function _toCrispArticlePayload(article) {
  // Crisp stocke le content en Markdown Crisp-flavored.
  // L'éditeur Tiptap produit du HTML -> conversion avant push.
  // description : meta-description SEO (Crisp limite à 160 chars).
  return {
    title: article.title,
    description: article.description || null,
    content: htmlToCrispMarkdown(article.content_html || ''),
  };
}

async function pullFromCrisp({ locale } = {}) {
  const creds = loadCrispCredentials();
  if (!creds) throw new Error('Credentials Crisp non configurés');
  const useLocale = locale || creds.defaultLocale;
  const client = crispClient(creds);

  let categoriesPulled = 0;
  let articlesPulled = 0;
  const conflicts = [];

  const lockRoot = acquireSyncLock('pull');
  try {
    const cats = await client.listCategories(useLocale);
    const seenCatCrispIds = new Set();
    for (const c of cats) {
      const crispId = c.category_id || c.id;
      if (!crispId) continue;
      seenCatCrispIds.add(crispId);
      // Si la catégorie portait un tombstone (suppression antérieure), Crisp l'a
      // recréée → on accepte la résurrection en levant le tombstone.
      if (db.faqCategoriesTombstones.has(crispId)) {
        db.faqCategoriesTombstones.remove(crispId);
      }
      const existing = db.faqCategories.getByCrispId(crispId);
      const payload = {
        crispId,
        name: c.name || 'Sans titre',
        description: c.description || null,
        color: c.color || null,
        orderIndex: c.order || 0,
        locale: useLocale,
        dirty: 0,
        pulledAt: new Date().toISOString(),
      };
      if (existing) {
        if (!existing.dirty) {
          db.faqCategories.update(existing.id, payload);
        }
      } else {
        db.faqCategories.create(payload);
      }
      categoriesPulled += 1;
    }

    // Détecte les catégories locales avec crisp_id qui ne sont plus côté
    // Crisp (supprimées remote) → tombstone pour bloquer le re-import et
    // alerter l'utilisateur dans l'UI.
    let ghosts = 0;
    for (const c of db.faqCategories.list({ locale: useLocale })) {
      if (c.crisp_id && !seenCatCrispIds.has(c.crisp_id)) {
        db.faqCategoriesTombstones.add(c.crisp_id, { localId: c.id, reason: 'missing_in_remote_pull' });
        ghosts += 1;
      }
    }
    if (ghosts > 0) log.warn(`Pull Crisp : ${ghosts} catégorie(s) locale(s) absente(s) côté distant (tombstone posé).`);

    // Articles : endpoint flat /helpdesk/locale/{locale}/articles
    // Chaque article inclut category.category_id pour le rattachement.
    // Le content n'est pas dans la liste -> getArticle() pour le détail.
    const crispIdToLocalCatId = new Map();
    for (const c of db.faqCategories.list({ locale: useLocale })) {
      if (c.crisp_id) crispIdToLocalCatId.set(c.crisp_id, c.id);
    }
    let allArticles = [];
    try {
      allArticles = await client.listAllArticles(useLocale);
    } catch (e) {
      log.warn(`Crisp pull articles list: ${e.message}`);
    }
    for (const a of allArticles) {
      const crispId = a.article_id || a.id;
      if (!crispId) continue;
      let full = a;
      if (!a.content) {
        try {
          full = await client.getArticle(useLocale, crispId);
        } catch (e) {
          log.warn(`Crisp pull article=${crispId}: ${e.message}`);
          continue;
        }
      }
      const crispCatId = full.category?.category_id || a.category?.category_id || null;
      const localCatId = crispCatId ? (crispIdToLocalCatId.get(crispCatId) || null) : null;
      const existing = db.faqArticles.getByCrispId(crispId);
      const crispUpdatedAt = full.updated_at || full.updatedAt
        ? new Date(full.updated_at || full.updatedAt).toISOString()
        : null;
      const payload = {
        crispId,
        categoryId: localCatId,
        title: full.title || 'Sans titre',
        // Description : priorité local si renseignée (l'IA peut l'avoir générée
        // alors qu'elle est encore vide côté Crisp tant qu'on n'a pas push). Sinon
        // remote, sinon null.
        description: existing?.description || full.description || null,
        slug: full.slug || null,
        // Crisp renvoie le content en Markdown -> on convertit en HTML pour Tiptap.
        contentHtml: crispMarkdownToHtml(full.content || ''),
        status: full.status === 'published' || full.published ? 'published' : 'draft',
        visibility: full.visibility === 'visible' || full.visibility === 'public' ? 'public' : 'private',
        locale: useLocale,
        dirty: 0,
        pulledAt: new Date().toISOString(),
        crispUpdatedAt,
        crispUrl: full.url || null,
      };
      if (existing) {
        if (existing.dirty) {
          conflicts.push({
            article_id: existing.id,
            crisp_id: crispId,
            title: existing.title,
            local_updated_at: existing.updated_at,
            crisp_updated_at: crispUpdatedAt,
          });
        } else {
          db.faqArticles.update(existing.id, payload);
          _recomputeSeoScoreById(existing.id);
        }
      } else {
        const created = db.faqArticles.create(payload);
        if (created?.id) _recomputeSeoScoreById(created.id);
      }
      articlesPulled += 1;
    }

    db.crispSettings.setLastPull({ status: 'ok', error: null });
    return {
      pulled: { categories: categoriesPulled, articles: articlesPulled },
      conflicts,
    };
  } catch (e) {
    db.crispSettings.setLastPull({ status: 'error', error: e.message });
    throw e;
  } finally {
    releaseSyncLock(lockRoot);
  }
}

async function pushCategoryToCrisp(categoryId) {
  const creds = loadCrispCredentials();
  if (!creds) throw new Error('Credentials Crisp non configurés');
  const cat = db.faqCategories.getById(categoryId);
  if (!cat) throw new Error('Catégorie introuvable');
  const locale = cat.locale || creds.defaultLocale;
  const client = crispClient(creds);
  const payload = _toCrispCategoryPayload(cat);

  if (!cat.crisp_id) {
    const created = await client.createCategory(locale, payload);
    const crispId = created?.data?.category_id || created?.data?.id || created?.category_id;
    if (!crispId) throw new Error('Crisp createCategory : id manquant dans la réponse');
    db.faqCategories.update(cat.id, {
      crispId,
      dirty: 0,
      pushedAt: new Date().toISOString(),
    });
  } else {
    await client.updateCategory(locale, cat.crisp_id, payload);
    db.faqCategories.update(cat.id, {
      dirty: 0,
      pushedAt: new Date().toISOString(),
    });
  }
  return db.faqCategories.getById(cat.id);
}

async function deleteCategoryOnCrisp(categoryId, { force = false } = {}) {
  const cat = db.faqCategories.getById(categoryId);
  if (!cat) return { ok: true };
  const articleCount = db.faqCategories.countArticles(categoryId);
  if (articleCount > 0 && !force) {
    const e = new Error(`La catégorie contient ${articleCount} article(s). Supprimez-les ou utilisez force=1.`);
    e.status = 409;
    throw e;
  }
  if (cat.crisp_id) {
    const creds = loadCrispCredentials();
    if (!creds) throw new Error('Credentials Crisp non configurés');
    const client = crispClient(creds);
    try {
      await client.deleteCategory(cat.locale || creds.defaultLocale, cat.crisp_id);
    } catch (e) {
      if (!force) throw e;
      log.warn(`Crisp deleteCategory ${cat.crisp_id} échec (force=1) : ${e.message}`);
    }
  }
  db.faqCategories.remove(categoryId);
  return { ok: true };
}

async function pushArticleToCrisp(articleId, userId = null) {
  const creds = loadCrispCredentials();
  if (!creds) throw new Error('Credentials Crisp non configurés');
  const article = db.faqArticles.getById(articleId);
  if (!article) throw new Error('Article introuvable');
  const locale = article.locale || creds.defaultLocale;
  const client = crispClient(creds);

  const lockRoot = acquireSyncLock(`push article ${articleId}`);
  try {
  // S'assurer que la catégorie existe côté Crisp avant de pousser l'article
  let category = null;
  if (article.category_id) {
    category = db.faqCategories.getById(article.category_id);
    if (category && !category.crisp_id) {
      await pushCategoryToCrisp(category.id);
      category = db.faqCategories.getById(category.id);
    }
  }

  const payload = _toCrispArticlePayload(article);

  // Snapshot pré-push : permet de retrouver l'état envoyé en cas de désync.
  try { db.faqArticles.snapshot(article.id, { reason: 'before_push', userId }); } catch (e) {
    log.warn(`Snapshot before_push article=${article.id} échec : ${e.message}`);
  }

  let crispId = article.crisp_id;
  if (!crispId) {
    // Création : SDK addNewHelpdeskLocaleArticle prend juste un titre.
    const created = await client.createArticle(locale, article.title);
    crispId = created?.article_id || created?.id;
    if (!crispId) throw new Error('Crisp createArticle : id manquant dans la réponse');
    // CRITIQUE : persister crisp_id IMMÉDIATEMENT après l'allocation côté Crisp,
    // AVANT les updates suivants. Si un step ultérieur échoue, le retry user ne
    // recréera pas un doublon Crisp (idempotence via crisp_id désormais set).
    db.faqArticles.update(article.id, { crispId }, userId);
  }

  // Save complet : Crisp exige title, description, content, featured, order.
  await client.updateArticle(locale, crispId, {
    title: payload.title,
    description: payload.description,
    content: payload.content,
    featured: false,
    order: 0,
  });
  if (category && category.crisp_id) {
    try {
      await client.updateArticleCategory(locale, crispId, category.crisp_id);
    } catch (e) {
      log.warn(`Crisp updateArticleCategory article=${crispId} cat=${category.crisp_id} : ${e.message}`);
    }
  }
  await client.publishArticle(locale, crispId, article.status === 'published');

  // Récupère l'URL publique Crisp générée (sinon n'est dispo qu'au prochain pull).
  let crispUrl = null;
  try {
    const refreshed = await client.getArticle(locale, crispId);
    crispUrl = refreshed?.url || null;
  } catch (e) {
    log.warn(`Crisp getArticle post-push ${crispId} : ${e.message}`);
  }

  // Dirty=0 + pushed_at UNIQUEMENT en fin de chaîne réussie.
  db.faqArticles.update(article.id, {
    dirty: 0,
    pushedAt: new Date().toISOString(),
    ...(crispUrl ? { crispUrl } : {}),
  }, userId);

  return db.faqArticles.getById(article.id);
  } finally {
    releaseSyncLock(lockRoot);
  }
}

async function deleteArticleOnCrisp(articleId) {
  const article = db.faqArticles.getById(articleId);
  if (!article) return { ok: true };
  if (article.crisp_id) {
    const creds = loadCrispCredentials();
    if (creds) {
      const client = crispClient(creds);
      try {
        await client.deleteArticle(article.locale || creds.defaultLocale, article.crisp_id);
      } catch (e) {
        log.warn(`Crisp deleteArticle ${article.crisp_id} : ${e.message}`);
      }
    }
  }
  db.faqArticles.remove(articleId);
  return { ok: true };
}

module.exports = {
  pullFromCrisp,
  pushCategoryToCrisp,
  deleteCategoryOnCrisp,
  pushArticleToCrisp,
  deleteArticleOnCrisp,
};
