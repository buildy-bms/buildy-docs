'use strict';

/**
 * Catalogue centralisé des « Lectures Buildy » — interprétations d'articles
 * du décret R175 qui complètent ou précisent la lettre du décret avec
 * l'expérience terrain Buildy (Lot 4 — Plan « Qualité du livrable PDF »).
 *
 * **Pourquoi un catalogue unique** : avant 0.1.138, les Lectures Buildy
 * étaient dispersées dans `R175Tooltip.vue` (UI) et `bacs-audit-methodology.js`
 * (PDF + MCP). Risque de divergence + impossible de citer une Lecture
 * spécifique dans le PDF avec un code stable.
 *
 * **Format de code** : `LB-<article>-<sous-clé>` (ex: `LB-R175-3-P3-PASSIF`,
 * `LB-R175-3-P4-AUTONOMOUS`). Le code est gravé dans le PDF audit livré ; un
 * lecteur (BE, avocat) peut s'y référer pour comprendre l'interprétation.
 *
 * **Statut juridique** : Buildy ne se substitue PAS au décret. Chaque
 * Lecture est explicitement marquée comme une interprétation Buildy
 * (`authority: 'internal'`). Le verdict R175 du PDF reste cohérent avec
 * la lettre du décret quand celle-ci est claire.
 */

// Version du catalogue. À bumper si un libellé change ; le PDF audit livré
// gravera cette version pour traçabilité.
const CATALOG_VERSION = '1.1';
const CATALOG_DATE = '2026-09-24';

const READINGS = [
  // ── R175-3 1° — Suivi continu pas horaire ────────────────────────────
  {
    code: 'LB-R175-3-P1-PERIMETRE',
    article: 'R175-3 1°',
    title: 'Périmètre du suivi continu',
    summary: 'Un compteur par énergie pour le bâtiment et un sous-comptage par zone fonctionnelle pour chaque système relié.',
    body: `Le décret impose un suivi, un enregistrement et une analyse en
      continu, <strong>par zone fonctionnelle et à un pas de temps horaire</strong>,
      des données de production et de consommation énergétique des systèmes
      techniques, conservées à l'échelle mensuelle pendant cinq ans (R175-3 1°).
      <em>Lecture Buildy</em> : le décret ne fixe pas de plan de comptage ;
      Buildy attend un compteur par énergie au niveau du bâtiment et un
      sous-comptage par zone fonctionnelle pour chaque système technique
      relié à la GTB (chauffage, refroidissement, ventilation, eau chaude
      sanitaire, éclairage, production d'électricité). Pour un bâtiment
      existant, seuls les systèmes à relier selon le II de l'article R175-2
      sont concernés.`,
    authority: 'internal',
  },
  // ── R175-3 3° — Interopérabilité ─────────────────────────────────────
  {
    code: 'LB-R175-3-P3-PASSIF',
    article: 'R175-3 3°',
    title: 'Émetteurs passifs et régulation autonome exclus',
    summary: 'Radiateurs, ventilo-convecteurs passifs, robinets thermostatiques : pas d\'interopérabilité requise.',
    body: `Le décret impose que la GTB soit <strong>interopérable avec les
      différents systèmes techniques du bâtiment</strong> (R175-3 3°), sans
      imposer de protocole : un protocole normalisé, une interface de
      programmation ou une passerelle conviennent (guide du ministère).
      <em>Lecture Buildy</em> : l'interopérabilité est vérifiée sur les
      équipements qui produisent, distribuent ou régulent l'énergie de chaque
      système : chaque générateur communique avec la GTB, directement ou par
      l'automate ou le régulateur qui le pilote (guide PROFEEL). Les émetteurs
      sans interface de communication (radiateurs, ventilo-convecteurs
      passifs) et la régulation locale autonome (robinet thermostatique,
      thermostat intégré) ne sont pas visés : l'action porte sur le générateur
      ou le régulateur amont. Un usage que la GTB en place ne traite pas est
      considéré comme non relié.`,
    authority: 'internal',
  },
  // ── R175-3 4° — Arrêt manuel + gestion autonome ──────────────────────
  {
    code: 'LB-R175-3-P4-PAR-SYSTEME',
    article: 'R175-3 4°',
    title: 'Arrêt manuel et gestion autonome vérifiés par système',
    summary: 'Chaque système relié peut être arrêté depuis la GTB et continue de fonctionner si elle est arrêtée.',
    body: `Le décret impose que la GTB <strong>permette un arrêt manuel et
      la gestion autonome d'un ou plusieurs systèmes techniques</strong>
      (R175-3 4°). Selon le guide du ministère, les systèmes reliés doivent
      continuer à fonctionner normalement lorsque la supervision est
      arrêtée ; selon le guide PROFEEL, la GTB permet de les arrêter puis de
      les remettre en marche manuellement (ou de les passer en hors gel).
      <em>Lecture Buildy</em> : ces deux capacités sont vérifiées pour chaque
      système technique relié ; un système satisfait l'exigence dès qu'un de
      ses équipements de production, de distribution ou de régulation la
      remplit.`,
    authority: 'internal',
  },
  // ── R175-3 dernier alinéa — Mise à disposition des données ──────────
  {
    code: 'LB-R175-3-DATA-EXPLOITANT',
    article: 'R175-3 dernier alinéa',
    title: 'Mise à disposition des données aux exploitants',
    summary: 'Le gestionnaire et chaque exploitant accèdent aux données qui les concernent.',
    body: `Le décret impose au propriétaire de la GTB, propriétaire des
      données produites et archivées, de les <strong>mettre à disposition
      du gestionnaire du bâtiment</strong>, à sa demande, et de transmettre
      à chacun des exploitants des systèmes techniques reliés les données
      qui les concernent (R175-3, dernier alinéa). <em>Lecture Buildy</em> :
      un accès continu en lecture (comptes nominatifs, exports ou interface
      de programmation) est la façon la plus simple d'y répondre ; le décret
      n'impose pas de moyen particulier.`,
    authority: 'internal',
  },
  // ── R175-5 — Formation de l'exploitant ───────────────────────────────
  {
    code: 'LB-R175-5-FORMATION',
    article: 'R175-5',
    title: 'Formation au paramétrage, avec preuve',
    summary: 'L\'exploitant sait modifier lui-même consignes, horaires et seuils d\'alarme ; la formation est attestée.',
    body: `Le décret impose au propriétaire de la GTB de veiller à ce que
      l'exploitant soit formé à son fonctionnement, notamment aux
      <strong>modalités de son paramétrage</strong> (R175-5).
      <em>Lecture Buildy</em> : la formation doit permettre à l'exploitant de
      modifier lui-même consignes, horaires et seuils d'alarme ; une
      démonstration sans manipulation ne suffit pas. Buildy demande une
      preuve (date, intervenant, contenu, feuille d'émargement), que la FAQ
      du ministère cite parmi les pièces à présenter lors de l'inspection.`,
    authority: 'internal',
  },
  // ── R175-6 — Régulation thermique automatique ────────────────────────
  {
    code: 'LB-R175-6-GRANULARITE',
    article: 'R175-6',
    title: 'Granularité de la régulation',
    summary: 'Régulation par pièce, ou par zone chauffée si cela est justifié, exigée pour conclure à la conformité.',
    body: `La loi impose une régulation automatique de la température
      <strong>par pièce ou, si cela est justifié, par zone chauffée</strong>
      (L. 175-2 ; R175-6). <em>Lecture Buildy</em> : la granularité est
      déduite de la régulation relevée au niveau des émetteurs — thermostat
      d'ambiance ou robinet thermostatique : par pièce ; sonde de zone : par
      zone chauffée ; régulation centrale seule (loi d'eau, par exemple) :
      insuffisante pour conclure à la conformité.`,
    authority: 'internal',
  },
  // ── R175-2 — Assujettissement ────────────────────────────────────────
  {
    code: 'LB-R175-2-CUMUL',
    article: 'R175-2',
    title: 'Cumul des puissances (chaud et froid séparés)',
    summary: 'Le seuil s\'apprécie séparément pour le chaud et pour le froid ; les puissances d\'un même usage s\'additionnent.',
    body: `Le décret fixe les seuils d'assujettissement de 290 kW et 70 kW
      (R175-2). Selon la FAQ du ministère, les puissances de chauffage et de
      climatisation ne s'additionnent pas : le seuil s'apprécie d'un côté
      pour le chaud, de l'autre pour le froid (FAQ n° 11) ; au sein d'un même
      usage, les puissances de tous les équipements s'additionnent (FAQ
      n° 12). La capacité calorifique d'une pompe à chaleur réversible est
      comptée avec le chauffage et sa capacité frigorifique avec la
      climatisation ; la puissance retenue est la plus élevée des deux
      totaux (guide PROFEEL). Les équipements de secours au sens de la FAQ
      n° 8 ne sont pas comptés.`,
    authority: 'internal',
  },
];

function listReadings() {
  return READINGS.slice();
}
function getReading(code) {
  return READINGS.find(r => r.code === code) || null;
}
function readingsForArticle(article) {
  if (!article) return [];
  return READINGS.filter(r => r.article === article || r.code.includes(article.replace(/\s+/g, '-')));
}
function readingsForAxis(axis) {
  // axis = 'r175_2', 'r175_3_1', 'r175_3_3', 'r175_3_4', 'r175_3_data', 'r175_4', 'r175_5', 'r175_6'
  const map = {
    r175_2:      ['LB-R175-2-CUMUL'],
    r175_3_1:    ['LB-R175-3-P1-PERIMETRE'],
    r175_3_3:    ['LB-R175-3-P3-PASSIF'],
    r175_3_4:    ['LB-R175-3-P4-PAR-SYSTEME'],
    r175_3_data: ['LB-R175-3-DATA-EXPLOITANT'],
    r175_5:      ['LB-R175-5-FORMATION'],
    r175_6:      ['LB-R175-6-GRANULARITE'],
  };
  const codes = map[axis] || [];
  return codes.map(c => getReading(c)).filter(Boolean);
}

module.exports = {
  CATALOG_VERSION, CATALOG_DATE, READINGS,
  listReadings, getReading, readingsForArticle, readingsForAxis,
};
