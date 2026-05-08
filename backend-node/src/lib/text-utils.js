'use strict';

// Utilitaires de manipulation de texte / HTML — partagés par claude.js,
// seo-scorer.js, faq-sync.js, etc. (avant : dupliqués dans 2 modules).

// Strip toutes les balises HTML, décode les entités HTML les plus courantes,
// normalise les whitespaces.
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { stripHtml };
