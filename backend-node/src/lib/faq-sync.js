'use strict';

// Service de synchronisation FAQ Buildy <-> Crisp Knowledge Base.
//
// Pull : récupère catégories + articles de Crisp, upsert en local. Si
// dirty=1 ET le contenu Crisp est plus récent -> conflit (pas écrasé).
// Push manuel : créé ou met à jour côté Crisp puis remet dirty=0.

const db = require('../database');
const { loadCrispCredentials, crispClient } = require('./crisp');
const { crispMarkdownToHtml, htmlToCrispMarkdown } = require('./crisp-markdown');
const log = require('./logger').system;

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
  return {
    title: article.title,
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

  try {
    const cats = await client.listCategories(useLocale);
    for (const c of cats) {
      const crispId = c.category_id || c.id;
      if (!crispId) continue;
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
        slug: full.slug || null,
        // Crisp renvoie le content en Markdown -> on convertit en HTML pour Tiptap.
        contentHtml: crispMarkdownToHtml(full.content || ''),
        status: full.status === 'published' || full.published ? 'published' : 'draft',
        visibility: full.visibility === 'visible' || full.visibility === 'public' ? 'public' : 'private',
        locale: useLocale,
        dirty: 0,
        pulledAt: new Date().toISOString(),
        crispUpdatedAt,
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
        }
      } else {
        db.faqArticles.create(payload);
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

  if (!article.crisp_id) {
    // Création : SDK addNewHelpdeskLocaleArticle prend juste un titre.
    const created = await client.createArticle(locale, article.title);
    const crispId = created?.article_id || created?.id;
    if (!crispId) throw new Error('Crisp createArticle : id manquant dans la réponse');
    // Save complet : title + content (markdown) + featured + order
    await client.updateArticle(locale, crispId, {
      title: payload.title,
      content: payload.content,
      featured: false,
      order: 0,
    });
    if (category && category.crisp_id) {
      await client.updateArticleCategory(locale, crispId, category.crisp_id);
    }
    if (article.status === 'published') {
      await client.publishArticle(locale, crispId, true);
    }
    db.faqArticles.update(article.id, {
      crispId,
      dirty: 0,
      pushedAt: new Date().toISOString(),
    }, userId);
  } else {
    await client.updateArticle(locale, article.crisp_id, {
      title: payload.title,
      content: payload.content,
      featured: false,
      order: 0,
    });
    if (category && category.crisp_id) {
      await client.updateArticleCategory(locale, article.crisp_id, category.crisp_id).catch(() => {});
    }
    await client.publishArticle(locale, article.crisp_id, article.status === 'published');
    db.faqArticles.update(article.id, {
      dirty: 0,
      pushedAt: new Date().toISOString(),
    }, userId);
  }
  return db.faqArticles.getById(article.id);
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
