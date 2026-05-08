'use strict';

/**
 * Catalogue des catégories de systèmes utilisé par la matrice zones × catégories
 * (page 2 de la synthèse PDF + tableau zones de l'éditeur AF).
 * - bacs : article R175-1 §X qui s'applique à la catégorie (null = hors décret)
 * - slugs : equipment_template.slug qui appartiennent à cette catégorie
 */
const SYSTEM_CATEGORIES = [
  { key: 'chauffage',       label: 'Chauffage',                 bacs: 'R175-1 §1',     slugs: ['chaudiere', 'aerotherme', 'destratificateur'] },
  { key: 'climatisation',   label: 'Climatisation',             bacs: 'R175-1 §2',     slugs: [] }, // pure clim — peuplé quand on ajoutera des templates groupe-froid / chiller
  { key: 'thermique_mixte', label: 'Chauffage + Climatisation', bacs: 'R175-1 §1, §2', slugs: ['drv', 'rooftop', 'cta'] },
  { key: 'ventilation',     label: 'Ventilation',               bacs: 'R175-1 §3',     slugs: ['cta', 'ventilation-generique', 'rooftop'] },
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

// Lecture des categories effectives depuis la DB (Lot 32). Fallback sur le
// constant SYSTEM_CATEGORIES si la DB n'a pas encore ete seedee (premier boot).
function loadCategoriesFromDb() {
  try {
    const db = require('../database');
    const rows = db.systemCategoriesDb.list();
    if (rows.length === 0) return SYSTEM_CATEGORIES;
    return rows.map(r => ({
      key: r.key, label: r.label, bacs: r.bacs, slugs: r.slugs,
      icon_value: r.icon_value, icon_color: r.icon_color,
    }));
  } catch {
    return SYSTEM_CATEGORIES;
  }
}

// Mapping `bacs_audit_systems.system_category` (BACS R175, anglais) → liste
// de `equipment_templates.category` (biblio, français) compatibles. Sert au
// pré-filtrage de la modale « Bibliothèque » dans une carte de système :
// quand on est dans un système Chauffage, on ne montre que les modèles
// chauffage / mixte (DRV, CTA…). Inclut volontairement la catégorie mixte
// `thermique_mixte` côté heating ET cooling : un DRV chauffe ET refroidit.
const LIBRARY_CATS_FOR_BACS_CATEGORY = {
  heating:               ['chauffage', 'thermique_mixte'],
  cooling:               ['climatisation', 'thermique_mixte'],
  ventilation:           ['ventilation', 'thermique_mixte'],
  dhw:                   ['ecs'],
  // 'eclairage' est l'ancienne valeur unique (templates seedés). 'eclairage_int'
  // et 'eclairage_ext' sont la nouvelle dichotomie BACS — on accepte les deux
  // pour ne pas masquer les modèles legacy.
  lighting_indoor:       ['eclairage_int', 'eclairage'],
  lighting_outdoor:      ['eclairage_ext', 'eclairage'],
  // 'pv' = nouveau slug ; 'electricite' = ancien slug du seed production-electricite.
  electricity_production: ['pv', 'electricite'],
};

function libraryCategoriesForBacsCategory(bacsCategory) {
  return LIBRARY_CATS_FOR_BACS_CATEGORY[bacsCategory] || [];
}

module.exports = {
  SYSTEM_CATEGORIES,
  normalizeText,
  candidateCategoriesForSlug,
  loadCategoriesFromDb,
  LIBRARY_CATS_FOR_BACS_CATEGORY,
  libraryCategoriesForBacsCategory,
};
