'use strict';

// Sanitisation HTML serveur-side pour les champs `*_html` saisis par
// l'utilisateur (notes système / device / meter / thermal, alternatives
// d'action, anomalies d'inspection, notes BMS, etc.). Mig audit BACS
// Vague 2 : on ne se contente plus de sanitize au render (SafeHtml.vue) ;
// on nettoie aussi à l'INSERT/UPDATE pour empêcher qu'un HTML hostile
// passé via une autre voie (intégration externe, partage entre users)
// reste persistant en DB.
//
// Whitelist alignée sur ce que l'éditeur Tiptap utilisé sur le frontend
// peut produire : titres H1-H6, paragraphes, listes, gras / italique /
// souligné, tableaux, liens, images, code. Tout le reste (script, style,
// iframe, on*, javascript:) est strippé silencieusement.

const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'div', 'span',
  'b', 'i', 'em', 'strong', 'u', 's', 'sup', 'sub', 'small', 'mark',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
];

const ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['class'], // utile pour les classes Tiptap (highlight, callout-*, etc.)
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];

const SANITIZE_OPTS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ALLOWED_SCHEMES,
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'], // images en data URL (PDF Puppeteer, captures)
  },
  // Strip plutôt qu'échapper : c'est le comportement attendu pour des
  // notes utilisateur (un `<script>` ne doit pas réapparaître en
  // texte brut au PDF).
  disallowedTagsMode: 'discard',
  // `<a target="_blank">` doit avoir noopener pour la sécurité (sinon
  // l'onglet ouvert peut accéder à window.opener).
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: attribs.target === '_blank' ? 'noopener noreferrer' : (attribs.rel || undefined),
      },
    }),
  },
};

/**
 * Nettoie un fragment HTML utilisateur. Retourne null si l'entrée
 * est null/undefined/vide (préserve la sémantique « pas de note »
 * vs « note vide »).
 */
function sanitize(html) {
  if (html == null) return html;
  if (typeof html !== 'string') return html;
  if (html.trim() === '') return null;
  return sanitizeHtml(html, SANITIZE_OPTS);
}

/**
 * Applique `sanitize` à toutes les clés se terminant par `_html` dans
 * un objet body de route (PATCH / POST). Mute l'objet en place ET le
 * retourne pour chaining. Les autres clés sont laissées telles quelles.
 */
function sanitizeBodyHtmlFields(body) {
  if (!body || typeof body !== 'object') return body;
  for (const k of Object.keys(body)) {
    if (k.endsWith('_html')) {
      body[k] = sanitize(body[k]);
    }
  }
  return body;
}

module.exports = { sanitize, sanitizeBodyHtmlFields };
