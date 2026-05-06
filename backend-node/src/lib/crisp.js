'use strict';

// Wrapper minimal autour du SDK officiel `crisp-api` (npm).
//
// Auth tier `website` : Settings -> Workspace Settings -> Advanced
// configuration -> API Token -> Generate Token. Limité à 10 000
// requêtes/jour, accès au seul workspace pour lequel le token a été créé.
// Doc : https://docs.crisp.chat/guides/rest-api/authentication/website-token/

const { Crisp } = require('crisp-api');
const db = require('../database');
const { decrypt } = require('./crypto');
const log = require('./logger').system;

function loadCrispCredentials() {
  const row = db.crispSettings.get();
  if (!row || !row.api_identifier_encrypted || !row.api_key_encrypted || !row.website_id) {
    return null;
  }
  return {
    apiIdentifier: decrypt(row.api_identifier_encrypted),
    apiKey: decrypt(row.api_key_encrypted),
    websiteId: row.website_id,
    defaultLocale: row.default_locale || 'fr',
  };
}

// Le SDK pagine via un paramètre `pageNumber`. Helper pour aller jusqu'au
// bout (50 items/page max côté Crisp, on s'arrête quand la page est plus courte).
async function _paginate(callPage, hardLimit = 50) {
  const out = [];
  let page = 1;
  /* eslint-disable no-constant-condition */
  while (true) {
    const items = await callPage(page);
    if (!Array.isArray(items) || items.length === 0) break;
    out.push(...items);
    if (items.length < 50) break;
    page += 1;
    if (page > hardLimit) break;
  }
  return out;
}

function crispClient(creds) {
  if (!creds) throw new Error('Credentials Crisp manquants');
  const sdk = new Crisp();
  sdk.authenticateTier('website', creds.apiIdentifier, creds.apiKey);
  const wid = creds.websiteId;

  return {
    sdk,
    websiteId: wid,

    // Categories
    async listCategories(locale = creds.defaultLocale) {
      return _paginate((page) => sdk.website.listHelpdeskLocaleCategories(wid, locale, page));
    },
    async createCategory(locale, payload) {
      // SDK signature : addHelpdeskLocaleCategory(websiteID, locale, name)
      // Le payload Crisp ne supporte que `name` à la création ; les autres
      // champs (description, color, order) passent par updateHelpdeskLocaleCategory.
      const created = await sdk.website.addHelpdeskLocaleCategory(wid, locale, payload.name);
      const id = created?.category_id || created?.id;
      if (!id) return created;
      // Patch du reste si fourni
      if (payload.description || payload.color || typeof payload.order === 'number') {
        await sdk.website.updateHelpdeskLocaleCategory(wid, locale, id, {
          name: payload.name,
          description: payload.description || '',
          color: payload.color || null,
          order: payload.order || 0,
        });
      }
      return { ...(created || {}), category_id: id };
    },
    async updateCategory(locale, categoryId, payload) {
      return sdk.website.updateHelpdeskLocaleCategory(wid, locale, categoryId, {
        name: payload.name,
        description: payload.description || '',
        color: payload.color || null,
        order: payload.order || 0,
      });
    },
    async deleteCategory(locale, categoryId) {
      return sdk.website.deleteHelpdeskLocaleCategory(wid, locale, categoryId);
    },

    // Articles
    async listAllArticles(locale = creds.defaultLocale) {
      return _paginate((page) => sdk.website.listHelpdeskLocaleArticles(wid, locale, page));
    },
    async getArticle(locale, articleId) {
      return sdk.website.resolveHelpdeskLocaleArticle(wid, locale, articleId);
    },
    async createArticle(locale, title) {
      // SDK : addNewHelpdeskLocaleArticle(websiteID, locale, title) -> { article_id, ... }
      return sdk.website.addNewHelpdeskLocaleArticle(wid, locale, title);
    },
    async updateArticle(locale, articleId, payload) {
      // saveHelpdeskLocaleArticle(websiteID, locale, articleID, article)
      // article = { title, description, content, featured, order }
      return sdk.website.saveHelpdeskLocaleArticle(wid, locale, articleId, payload);
    },
    async updateArticleCategory(locale, articleId, categoryId) {
      return sdk.website.updateHelpdeskLocaleArticleCategory(wid, locale, articleId, categoryId);
    },
    async publishArticle(locale, articleId, published) {
      if (published) return sdk.website.publishHelpdeskLocaleArticle(wid, locale, articleId);
      return sdk.website.unpublishHelpdeskLocaleArticle(wid, locale, articleId);
    },
    async deleteArticle(locale, articleId) {
      return sdk.website.deleteHelpdeskLocaleArticle(wid, locale, articleId);
    },
  };
}

async function testConnection(creds) {
  try {
    const client = crispClient(creds);
    await client.listCategories(creds.defaultLocale);
    return { ok: true };
  } catch (e) {
    log.warn(`Crisp testConnection failed: ${e.message}`);
    return { ok: false, error: e.message, status: e.statusCode || e.status || null };
  }
}

module.exports = {
  loadCrispCredentials,
  crispClient,
  testConnection,
};
