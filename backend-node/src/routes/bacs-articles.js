'use strict';

// Lecture des articles R175-1 à R175-6 du décret BACS, source de vérité
// statique côté code (seeds/bacs-articles.js, alignée sur la page Notion
// « Décret BACS 2023 »). Exposé en lecture seule : la modification d'un
// article est volontairement réservée à un commit + déploiement (source
// de droit, immuable côté UI).
//
// Consommé par l'onglet « Textes PDF & Articles R175 » de la page
// /admin/bacs-parameters pour permettre une consultation rapide depuis
// l'app sans aller chercher Notion ou ouvrir un PDF d'audit.

const { BACS_ARTICLES, BACS_INTRO_HTML } = require('../seeds/bacs-articles');

async function routes(fastify) {
  fastify.get('/bacs-articles', async () => {
    return {
      intro_html: BACS_INTRO_HTML,
      articles: BACS_ARTICLES.map(a => ({
        code: a.code,
        title: a.title,
        summary: a.summary,
        full_html: a.full_html,
      })),
    };
  });
}

module.exports = routes;
