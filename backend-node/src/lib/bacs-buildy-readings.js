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
const CATALOG_VERSION = '1.0';
const CATALOG_DATE = '2026-06-08';

const READINGS = [
  // ── R175-3 §1° — Suivi continu pas horaire ───────────────────────────
  {
    code: 'LB-R175-3-P1-PERIMETRE',
    article: 'R175-3 1°',
    title: 'Périmètre du suivi continu',
    summary: 'Compteurs principaux + sous-comptage par zone fonctionnelle.',
    body: `Le décret demande un <strong>suivi continu des consommations énergétiques</strong>
      au pas horaire, avec conservation des données 5 ans. La lettre du
      décret ne précise pas la granularité spatiale.
      <em>Lecture Buildy</em> : pour respecter l'esprit du décret (suivi par
      zone fonctionnelle), on attend un compteur pour chaque énergie (gaz,
      électricité, fioul, réseau de chaleur…) au niveau du bâtiment, et un
      sous-comptage par zone fonctionnelle pour les usages chauffage,
      refroidissement, ECS et éclairage. Cette lecture est plus précise
      que le décret nu — elle permet à l'exploitant de localiser une dérive.`,
    authority: 'internal',
  },
  // ── R175-3 §3° — Interopérabilité ────────────────────────────────────
  {
    code: 'LB-R175-3-P3-PASSIF',
    article: 'R175-3 3°',
    title: 'Émetteurs passifs et régulation autonome exclus',
    summary: 'Radiateurs, FCU, vannes thermostatiques mécaniques : pas d\'interopérabilité requise.',
    body: `Le décret demande l'interopérabilité des <strong>systèmes techniques</strong>.
      <em>Lecture Buildy</em> : les émetteurs passifs sans interface
      technique (radiateurs simples, ventilo-convecteurs passifs) et la
      régulation d'émission autonome (vanne thermostatique mécanique,
      thermostat de zone non communicant) ne sont pas concernés par
      l'exigence d'interopérabilité R175-3 §3 — l'action portera sur le
      générateur ou le régulateur amont, pas sur l'émetteur.`,
    authority: 'internal',
  },
  // ── R175-3 §4° — Arrêt manuel + redémarrage autonome ─────────────────
  {
    code: 'LB-R175-3-P4-PAR-EQUIPEMENT',
    article: 'R175-3 4°',
    title: 'Arrêt manuel et redémarrage évalués par équipement',
    summary: 'Critère évalué pour chaque équipement, pas seulement au niveau GTB global.',
    body: `Le décret demande que la GTB <strong>permette un arrêt manuel
      et la gestion autonome d'un ou plusieurs systèmes techniques</strong>.
      <em>Lecture Buildy</em> : ces deux critères (arrêt manuel possible
      sur place, redémarrage autonome après coupure) sont évalués au
      niveau de <strong>chaque équipement</strong> de l'audit, et pas
      seulement au niveau GTB global. Lecture plus stricte que le décret
      qui parle « d'un ou plusieurs systèmes techniques » — un seul
      équipement non conforme déclenche une action corrective.`,
    authority: 'internal',
  },
  // ── R175-3 dernier alinéa — Mise à disposition des données ──────────
  {
    code: 'LB-R175-3-DATA-EXPLOITANT',
    article: 'R175-3 dernier alinéa',
    title: 'Mise à disposition des données aux exploitants',
    summary: 'Les exploitants (mainteneurs, conseil énergie) doivent accéder aux historiques.',
    body: `Le décret demande la <strong>mise à disposition des données</strong>
      au gestionnaire technique et à l'exploitant. <em>Lecture Buildy</em> :
      les exploitants au sens large (mainteneurs, conseil en énergie,
      bureau de contrôle R175-5-1) doivent avoir un accès en lecture aux
      historiques. L'envoi mensuel par email ou un export Excel manuel
      ne suffisent pas — l'accès doit être continu (API, web, ou rapport
      automatisé hebdomadaire au minimum).`,
    authority: 'internal',
  },
  // ── R175-5 — Formation de l'exploitant ───────────────────────────────
  {
    code: 'LB-R175-5-FORMATION',
    article: 'R175-5',
    title: 'Formation au paramétrage, pas seulement au pilotage',
    summary: 'L\'exploitant doit savoir modifier consignes, horaires, alarmes — pas juste regarder.',
    body: `Le décret demande la <strong>formation de l'exploitant</strong>
      au pilotage de la GTB. <em>Lecture Buildy</em> : la formation doit
      couvrir le <strong>paramétrage</strong> (modification des consignes,
      des horaires, des seuils d'alarme) et pas seulement le pilotage
      passif (consultation des écrans). Une formation purement
      « démonstration » sans manipulation par l'exploitant ne suffit pas
      à satisfaire l'esprit du décret.`,
    authority: 'internal',
  },
  // ── R175-6 — Régulation thermique automatique ────────────────────────
  {
    code: 'LB-R175-6-GRANULARITE',
    article: 'R175-6',
    title: 'Granularité spatiale de la régulation',
    summary: 'Per_room ou per_zone exigés pour atteindre le verdict « Conforme R175-6 ».',
    body: `Le décret R175-6 demande une régulation thermique
      <strong>automatique</strong>, sans préciser la granularité spatiale
      à atteindre. <em>Lecture Buildy</em> : la granularité est dérivée
      du type d'émission saisi — thermostat ambiant et vanne
      thermostatique → <code>per_room</code>, sonde de zone →
      <code>per_zone</code>, autre/null → <code>central_only</code>
      (insuffisant pour le verdict Conforme R175-6).`,
    authority: 'internal',
  },
  // ── R175-2 — Assujettissement ────────────────────────────────────────
  {
    code: 'LB-R175-2-CUMUL',
    article: 'R175-2',
    title: 'Règle du cumul de puissance (chaud + froid retenu max)',
    summary: 'On retient max(chaud, froid) — le chaud et le froid ne s\'additionnent pas.',
    body: `Le décret R175-2 fixe les seuils d'assujettissement (290 kW,
      70 kW) sans préciser comment cumuler chauffage et climatisation.
      <em>Lecture Buildy</em> : pour les systèmes thermodynamiques
      réversibles, on retient <strong>max(puissance chaud, puissance
      froid)</strong> — la même machine produit les deux, à des moments
      différents. Pour les équipements distincts (chaudière gaz +
      groupe froid), on retient la somme. Cette lecture est conforme au
      guide PROFEEL et à la FAQ ministérielle.`,
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
    r175_3_4:    ['LB-R175-3-P4-PAR-EQUIPEMENT'],
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
