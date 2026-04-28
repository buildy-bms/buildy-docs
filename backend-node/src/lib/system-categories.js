'use strict';

/**
 * Catalogue des catégories de systèmes utilisé par la matrice zones × catégories
 * (page 2 de la synthèse PDF + tableau zones de l'éditeur AF).
 * - bacs : article R175-1 §X qui s'applique à la catégorie (null = hors décret)
 * - slugs : equipment_template.slug qui appartiennent à cette catégorie
 */
const SYSTEM_CATEGORIES = [
  { key: 'chauffage',     label: 'Chauffage',         bacs: 'R175-1 §1', slugs: ['chaudiere', 'aerotherme', 'destratificateur', 'drv', 'rooftop', 'cta'] },
  { key: 'climatisation', label: 'Climatisation',     bacs: 'R175-1 §2', slugs: ['drv', 'rooftop', 'cta'] },
  { key: 'ventilation',   label: 'Ventilation',       bacs: 'R175-1 §3', slugs: ['cta', 'ventilation-generique', 'rooftop'] },
  { key: 'ecs',           label: 'ECS',               bacs: 'R175-1 §4', slugs: ['ecs'] },
  { key: 'pv',            label: 'Production PV',     bacs: 'R175-1 §4', slugs: ['production-electricite'] },
  { key: 'eclairage_int', label: 'Éclairage int.',    bacs: 'R175-1 §4', slugs: ['eclairage-interieur'] },
  { key: 'eclairage_ext', label: 'Éclairage ext.',    bacs: null,        slugs: ['eclairage-exterieur'] },
  { key: 'prises',        label: 'Prises pilotées',   bacs: null,        slugs: ['prises-pilotees'] },
  { key: 'comptage',      label: 'Comptage',          bacs: null,        slugs: ['compteur-electrique', 'compteur-gaz', 'compteur-eau', 'compteur-calories'] },
  { key: 'qai',           label: 'QAI',               bacs: null,        slugs: ['qai'] },
  { key: 'occultation',   label: 'Occultation',       bacs: null,        slugs: ['volets', 'stores'] },
  { key: 'process',       label: 'Process',           bacs: null,        slugs: ['process-industriel'] },
  { key: 'autres',        label: 'Autres',            bacs: null,        slugs: ['equipement-generique'] },
];

function normalizeText(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Catégories candidates pour un slug d'equipement (= toutes les catégories
// qui listent ce slug dans leurs candidats). Ex : pour 'cta' → ventilation,
// chauffage, climatisation. L'utilisateur choisit ensuite les categories
// effectives au niveau de chaque INSTANCE.
function candidateCategoriesForSlug(slug) {
  if (!slug) return [];
  return SYSTEM_CATEGORIES.filter(c => c.slugs.includes(slug)).map(c => c.key);
}

module.exports = { SYSTEM_CATEGORIES, normalizeText, candidateCategoriesForSlug };
