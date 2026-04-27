'use strict';

/**
 * Slug generator pour les AFs : derive d'un texte humain (client + projet)
 * vers un identifiant URL-safe stable. Si le slug existe deja, suffixe -2,
 * -3, etc. via le check du caller.
 */
function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Genere un slug unique en testant `existsFn(candidate)` (callback synchrone
 * qui retourne true si le slug est deja pris).
 */
function uniqueSlug(base, existsFn) {
  let slug = slugify(base) || 'af';
  let i = 1;
  while (existsFn(slug)) {
    i++;
    slug = `${slugify(base)}-${i}`;
  }
  return slug;
}

module.exports = { slugify, uniqueSlug };
