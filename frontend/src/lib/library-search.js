// Recherche dans la bibliothèque de modèles d'équipement (ajout d'un équipement à un audit).
// Les noms de la bibliothèque sont en français pour les exploitants ; les mots du métier qu'un
// technicien peut taper (« chiller ») restent des synonymes de recherche, par modèle (slug).
// Fonctions pures : testées côté backend (backend-node/test/library-search.test.mjs).

export const SEARCH_SYNONYMS = {
  'groupe-eau-glacee': ['chiller', 'groupe froid', 'groupe de production d’eau glacée'],
};

export function normalizeSearch(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
}

/** Le modèle correspond-il à la recherche ? (nom, puis synonymes du métier) */
export function templateMatches(template, query) {
  const q = normalizeSearch(String(query || '').trim());
  if (!q) return true;
  if (normalizeSearch(template?.name).includes(q)) return true;
  return (SEARCH_SYNONYMS[template?.slug] || []).some((s) => normalizeSearch(s).includes(q));
}
