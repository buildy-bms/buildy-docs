/**
 * Score SEO heuristique pour articles FAQ Buildy.
 *
 * Score 0-100 sur 10 checks pondérés. Pure function, pas d'I/O ni dépendance externe.
 *
 * Usage côté backend :
 *   const { scoreArticle, DEFAULT_KEYWORDS } = require('./seo-scorer');
 *   const result = scoreArticle({ title, contentHtml, targetKeywords });
 *   // → { score, checks, weakChecks, suggestions }
 *
 * Le résultat est utilisé :
 * 1. Pour persister un score à chaque save/pull/generate (faq_articles.seo_score)
 * 2. Pour la boucle auto-rewrite dans claude.js (si score < 70, retry avec feedback)
 * 3. Pour le badge SEO dans la top-bar de l'éditeur (frontend)
 *
 * La whitelist effective est lue depuis la table `faq_settings` (override via
 * page Paramètres FAQ), avec fallback sur DEFAULT_KEYWORDS. Cache mémoire
 * invalidé à chaque PUT/reset via invalidateKeywordsCache().
 */

// ── Whitelist par défaut des mots-clés métier Buildy ─────────────────
// Surchargeable depuis l'UI (/faq/settings) — persisté dans faq_settings.
const DEFAULT_KEYWORDS = [
  // Produits / fonctions Buildy
  'GTB', 'gestion technique du bâtiment',
  'hypervision', 'supervision', 'supervision énergétique', 'supervision multi-sites',
  'pilotage à distance', 'télémaintenance',
  'alertes', 'programmation horaire', 'commandes virtuelles',
  // Audience cible
  'bâtiment tertiaire', 'parc immobilier', 'exploitation', 'maintenance énergétique',
  // Réglementaire
  'décret BACS', 'R175', 'RT 2027', 'conformité énergétique', 'performance énergétique',
  // Métier énergie
  'consommation', 'chauffage', 'climatisation', 'ventilation', 'éclairage',
  // Protocoles
  'BACnet', 'Modbus', 'M-Bus', 'KNX', 'LoRaWAN',
  // Buildy-specific
  'Hyperveez', 'Gojee', 'Buildy Edge',
];

// ── Cache de la whitelist (DB override) ──────────────────────────────
let cachedKeywords = null;

function loadKeywords() {
  if (cachedKeywords) return cachedKeywords;
  try {
    // Lazy require pour éviter une dépendance circulaire à l'init module.
    const db = require('../database');
    const override = db.faqSettings?.getSeoKeywords?.();
    cachedKeywords = (Array.isArray(override) && override.length > 0) ? override : DEFAULT_KEYWORDS;
  } catch {
    cachedKeywords = DEFAULT_KEYWORDS;
  }
  return cachedKeywords;
}

function invalidateKeywordsCache() {
  cachedKeywords = null;
}

// Acronymes qui devraient être développés à la 1re occurrence
const ACRONYMS_TO_EXPAND = [
  { acronym: 'GTB', expanded: ['Gestion Technique du B', 'gestion technique du b'] },
  { acronym: 'BACS', expanded: ['Building Automation', 'Bâtiment Automatisé'] },
  { acronym: 'RT 2027', expanded: ['Réglementation Thermique'] },
  { acronym: 'GTC', expanded: ['Gestion Technique Centralisée'] },
];

// ── Helpers ──────────────────────────────────────────────────────────

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&[#a-z0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return (text.match(re) || []).length;
}

// Extrait le texte d'une regex match sur le 1er groupe
function firstMatch(re, str) {
  const m = String(str || '').match(re);
  return m ? m[1] : null;
}

// Renvoie tous les <h2> et <h3> du HTML
function extractHeadings(html) {
  const out = [];
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    out.push({ level: parseInt(m[1], 10), text: stripHtml(m[2]) });
  }
  return out;
}

// 1er paragraphe (premier <p> non-vide)
function extractFirstParagraph(html) {
  const matches = String(html || '').match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [];
  for (const m of matches) {
    const txt = stripHtml(m);
    if (txt.length > 20) return txt;
  }
  return '';
}

// Compte les <strong> sur le HTML
function countStrong(html) {
  return (String(html || '').match(/<strong\b/gi) || []).length;
}

// Compte les liens internes (vers /article/)
function countInternalLinks(html) {
  const re = /<a\b[^>]*href=["'][^"']*\/article\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [];
  let m;
  while ((m = re.exec(String(html || '')))) {
    matches.push(stripHtml(m[1]));
  }
  return matches;
}

// Tokenize le texte pour compter les occurrences de chaque keyword
function findKeywordsInText(text, keywords) {
  const found = new Set();
  const lowerText = text.toLowerCase();
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) found.add(kw);
  }
  return Array.from(found);
}

// Détecte si un acronyme est développé à sa 1re occurrence
function isAcronymExpanded(text, acronym, expansions) {
  const idx = text.indexOf(acronym);
  if (idx < 0) return null; // pas trouvé → pas de check
  // Cherche une expansion dans les 80 chars autour de la 1re occurrence
  const window = text.slice(Math.max(0, idx - 5), idx + 80);
  return expansions.some((exp) => window.toLowerCase().includes(exp.toLowerCase()));
}

// ── Function principale ──────────────────────────────────────────────

function scoreArticle({ title = '', contentHtml = '', targetKeywords = [] } = {}) {
  const text = stripHtml(contentHtml);
  const wordCount = countWords(text);
  const headings = extractHeadings(contentHtml);
  const h2Count = headings.filter((h) => h.level === 2).length;
  const firstP = extractFirstParagraph(contentHtml);
  const strongCount = countStrong(contentHtml);
  const internalLinks = countInternalLinks(contentHtml);

  const activeKeywords = loadKeywords();
  const allKeywords = [...new Set([...targetKeywords, ...activeKeywords])];
  const foundKeywords = findKeywordsInText(text, allKeywords);
  const foundInTitle = findKeywordsInText(title, allKeywords);
  const foundInFirstP = findKeywordsInText(firstP.slice(0, 250), allKeywords);

  const checks = [];

  // 1. Titre 40-60 chars (5 pts)
  const titleLen = title.length;
  checks.push({
    id: 'title-length',
    label: 'Longueur du titre',
    weight: 5,
    passed: titleLen >= 30 && titleLen <= 70,
    message: titleLen < 30
      ? `Titre trop court (${titleLen} chars, idéal 40-60)`
      : titleLen > 70
      ? `Titre trop long (${titleLen} chars, idéal 40-60, max 70)`
      : `Titre ${titleLen} chars (idéal 40-60)`,
  });

  // 2. Mot-clé en tête de titre (10 pts)
  checks.push({
    id: 'title-keyword',
    label: 'Mot-clé métier dans le titre',
    weight: 10,
    passed: foundInTitle.length > 0,
    message: foundInTitle.length > 0
      ? `Titre contient : ${foundInTitle.slice(0, 3).join(', ')}`
      : `Aucun mot-clé métier dans le titre. Ajoute par ex. ${activeKeywords.slice(0, 5).join(', ')}…`,
  });

  // 3. 1er paragraphe contient ≥ 1 mot-clé prioritaire (15 pts)
  checks.push({
    id: 'intro-keyword',
    label: 'Mot-clé dans le 1er paragraphe',
    weight: 15,
    passed: foundInFirstP.length > 0,
    message: foundInFirstP.length > 0
      ? `1er paragraphe contient : ${foundInFirstP.slice(0, 3).join(', ')}`
      : `Aucun mot-clé métier dans les 250 premiers caractères. Google indexe lourd cette zone.`,
  });

  // 4. Au moins 2 H2 (5 pts)
  checks.push({
    id: 'headings-count',
    label: 'Au moins 2 sections H2',
    weight: 5,
    passed: h2Count >= 2,
    message: `${h2Count} H2 trouvé${h2Count > 1 ? 's' : ''}${h2Count < 2 ? ' (minimum 2 recommandé)' : ''}`,
  });

  // 5. ≥ 50% des H2/H3 contiennent un mot-clé (10 pts)
  const headingsWithKw = headings.filter((h) => findKeywordsInText(h.text, allKeywords).length > 0);
  const headingsKwRatio = headings.length > 0 ? headingsWithKw.length / headings.length : 0;
  checks.push({
    id: 'headings-descriptive',
    label: 'H2/H3 descriptifs',
    weight: 10,
    passed: headings.length === 0 ? true : headingsKwRatio >= 0.5,
    message: headings.length === 0
      ? 'Pas de H2/H3 (ok si article court)'
      : `${headingsWithKw.length}/${headings.length} titres contiennent un mot-clé métier (${Math.round(headingsKwRatio * 100)}%)`,
  });

  // 6. Couverture mots-clés (15 pts) — score linéaire
  const kwCoveragePct = Math.min(foundKeywords.length / 5, 1); // 5 mots-clés = 100% du critère
  checks.push({
    id: 'kw-coverage',
    label: 'Couverture mots-clés métier',
    weight: 15,
    passed: foundKeywords.length >= 3,
    message: `${foundKeywords.length} mot${foundKeywords.length > 1 ? 's' : ''}-clé${foundKeywords.length > 1 ? 's' : ''} métier dans l'article${foundKeywords.length > 0 ? ` (${foundKeywords.slice(0, 5).join(', ')}${foundKeywords.length > 5 ? '…' : ''})` : ''}. Cible : ≥ 3.`,
    partialScore: Math.round(kwCoveragePct * 15),
  });

  // 7. Liens internes ≥ 1 (10 pts)
  const linksDescriptive = internalLinks.filter((label) => {
    const l = label.toLowerCase().trim();
    return l && l !== 'ici' && l !== 'cliquez ici' && l !== 'lien' && l.length > 3;
  });
  checks.push({
    id: 'internal-links',
    label: 'Liens internes',
    weight: 10,
    passed: linksDescriptive.length >= 1,
    message: internalLinks.length === 0
      ? 'Aucun lien interne. Pour le maillage SEO, ajoute ≥ 1 lien vers un autre article FAQ.'
      : linksDescriptive.length === 0
      ? `${internalLinks.length} lien(s) interne(s) avec libellés non-descriptifs ("ici", "cliquez ici"). Préférer des libellés explicites.`
      : `${linksDescriptive.length} lien${linksDescriptive.length > 1 ? 's' : ''} interne${linksDescriptive.length > 1 ? 's' : ''} descriptif${linksDescriptive.length > 1 ? 's' : ''}.`,
  });

  // 8. ≥ 3 <strong> (10 pts)
  checks.push({
    id: 'strong-emphasis',
    label: 'Mise en gras des expressions clés',
    weight: 10,
    passed: strongCount >= 3,
    message: `${strongCount} <strong> dans l'article. Cible : ≥ 3 sur les expressions métier importantes.`,
  });

  // 9. Longueur 300-2000 mots (5 pts) — sweet spot 500-1500
  checks.push({
    id: 'length',
    label: 'Longueur de l\'article',
    weight: 5,
    passed: wordCount >= 300 && wordCount <= 2000,
    message: wordCount < 300
      ? `Article court (${wordCount} mots). Min 300 recommandé pour Google.`
      : wordCount > 2000
      ? `Article long (${wordCount} mots). Au-delà de 2000, le bénéfice SEO plafonne.`
      : `${wordCount} mots (sweet spot 500-1500)`,
  });

  // 10. Acronymes développés à la 1re occurrence (5 pts)
  const acronymChecks = ACRONYMS_TO_EXPAND
    .map((a) => ({ a, expanded: isAcronymExpanded(text, a.acronym, a.expanded) }))
    .filter((x) => x.expanded !== null); // ignore acronymes pas présents
  const acronymsOk = acronymChecks.length === 0
    ? true
    : acronymChecks.every((x) => x.expanded);
  const missingExpansions = acronymChecks.filter((x) => !x.expanded).map((x) => x.a.acronym);
  checks.push({
    id: 'acronyms',
    label: 'Acronymes développés à la 1re occurrence',
    weight: 5,
    passed: acronymsOk,
    message: acronymChecks.length === 0
      ? 'Aucun acronyme à développer'
      : missingExpansions.length === 0
      ? `Tous les acronymes (${acronymChecks.map((x) => x.a.acronym).join(', ')}) sont développés.`
      : `Acronymes non développés : ${missingExpansions.join(', ')} (ex : "GTB (Gestion Technique du Bâtiment)").`,
  });

  // 11. Anti keyword stuffing (10 pts)
  const stuffingCounts = foundKeywords
    .map((kw) => ({ kw, count: countOccurrences(text, kw) }))
    .filter((x) => x.count > 5);
  checks.push({
    id: 'no-stuffing',
    label: 'Pas de keyword stuffing',
    weight: 10,
    passed: stuffingCounts.length === 0,
    message: stuffingCounts.length === 0
      ? 'Aucune répétition excessive de mot-clé.'
      : `Mots-clés trop répétés (Google pénalise) : ${stuffingCounts.map((x) => `${x.kw} (${x.count}x)`).join(', ')}`,
  });

  // ── Score total ────────────────────────────────────────────────────
  let score = 0;
  for (const c of checks) {
    if (c.partialScore !== undefined) {
      score += c.partialScore;
    } else if (c.passed) {
      score += c.weight;
    }
  }
  // Cap à 100 (somme des poids = 100 exactement, mais on protège)
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Liste des checks non passés (pour le retry loop côté Claude)
  const weakChecks = checks.filter((c) => !c.passed).map((c) => ({
    id: c.id,
    label: c.label,
    weight: c.weight,
    message: c.message,
  }));

  // Suggestions d'amélioration concrètes (pour l'UI ou le retry)
  const suggestions = weakChecks.map((c) => c.message);

  return { score, checks, weakChecks, suggestions };
}

module.exports = {
  scoreArticle,
  DEFAULT_KEYWORDS,
  loadKeywords,
  invalidateKeywordsCache,
  ACRONYMS_TO_EXPAND,
};
