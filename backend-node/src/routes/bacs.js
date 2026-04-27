'use strict';

const { BACS_ARTICLES, BACS_INTRO_HTML, ARTICLE_TITLES } = require('../seeds/bacs-articles');

async function routes(fastify) {
  // GET /api/bacs/articles — liste statique des articles R175-1 à R175-6
  fastify.get('/bacs/articles', async () => {
    return {
      intro_html: BACS_INTRO_HTML,
      articles: BACS_ARTICLES,
      titles_by_code: ARTICLE_TITLES,
    };
  });
}

module.exports = routes;
