'use strict';

// Helpers partagés du kind 'maintenance_report' (mig 203) : squelette du
// corps à la création (routes/afs.js) + formatage de la période couverte
// (routes/maintenance-reports.js, cover PDF).

// Squelette pré-rempli à la création : guide la structure attendue
// (entrées datées en H2, sous-titres H3 Signalement / Réponse Buildy /
// Résultat, puis synthèse) sans imposer de formulaire rigide.
const MAINTENANCE_REPORT_SKELETON_HTML = `
<h2>JJ/MM/AAAA — Titre de la sollicitation</h2>
<h3>Signalement</h3>
<p>Décris ici l'origine de la sollicitation : alerte automatique de la plateforme Buildy, signalement du client…</p>
<h3>Réponse Buildy</h3>
<p>Diagnostic et actions menées par Buildy (à distance ou sur site), orientation vers le mainteneur le cas échéant.</p>
<h3>Résultat</h3>
<p>Issue du dossier : résolu par Buildy, par le mainteneur, par le client sur préconisation…</p>
<h2>Synthèse</h2>
<p>Nombre de sollicitations traitées sur la période, répartition par origine (plateforme / client), par objet (systèmes concernés) et par mode de traitement (à distance, mainteneur, client).</p>
`.trim();

/**
 * Formate la période couverte pour la cover et l'UI.
 * - Années pleines (01/01 → 31/12) : « Année 2025 » ou « 2025 – 2026 ».
 * - Sinon : « du 1 janvier 2025 au 30 juin 2026 » (fr-FR, dates longues).
 * - Bornes manquantes : retombe sur ce qui est disponible, ou ''.
 * @param {string|null} start - date ISO YYYY-MM-DD
 * @param {string|null} end   - date ISO YYYY-MM-DD
 * @returns {string}
 */
function formatPeriodLabel(start, end) {
  const longFr = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  if (start && end) {
    const startYear = start.slice(0, 4);
    const endYear = end.slice(0, 4);
    const fullYears = start.slice(4) === '-01-01' && end.slice(4) === '-12-31';
    if (fullYears) {
      return startYear === endYear ? `Année ${startYear}` : `${startYear} – ${endYear}`;
    }
    return `du ${longFr(start)} au ${longFr(end)}`;
  }
  if (start) return `depuis le ${longFr(start)}`;
  if (end) return `jusqu'au ${longFr(end)}`;
  return '';
}

/**
 * Regroupe le HTML Tiptap en blocs insécables pour le rendu PDF :
 *   1. chaque <h3> + son contenu jusqu'au prochain h2/h3 → <div class="mr-sub">
 *      (jamais de label « Signalement » orphelin en bas de page) ;
 *   2. chaque <h2> + le bloc qui le suit → <div class="mr-head">
 *      (jamais de bandeau d'entrée seul en bas de page — break-after: avoid
 *      est peu fiable dans Chromium sur les blocs à fond/bordure).
 * Le CSS applique break-inside: avoid sur .mr-sub / .mr-head ; Chromium
 * ignore l'avoid si un groupe dépasse une page (pas de page blanche).
 * @param {string} html - body_html Tiptap (déjà sanitizé à l'écriture)
 * @returns {string}
 */
function groupBodyForPdf(html) {
  if (!html) return '';
  const { parse } = require('node-html-parser');
  const root = parse(html);

  const isHeading = (node, tags) =>
    node.nodeType === 1 && tags.includes(node.rawTagName?.toLowerCase());

  // Passe 1 — sous-blocs h3.
  let out = [];
  let sub = null; // liste de nodes du mr-sub en cours
  const flushSub = () => {
    if (!sub) return;
    out.push(`<div class="mr-sub">${sub.map(n => n.toString()).join('')}</div>`);
    sub = null;
  };
  for (const node of root.childNodes) {
    if (isHeading(node, ['h2'])) { flushSub(); out.push(node.toString()); }
    else if (isHeading(node, ['h3'])) { flushSub(); sub = [node]; }
    else if (sub) { sub.push(node); }
    else { out.push(node.toString()); }
  }
  flushSub();

  // Passe 2 — chaque h2 absorbe le bloc suivant dans un mr-head.
  const grouped = [];
  for (let i = 0; i < out.length; i++) {
    const chunk = out[i];
    if (/^<h2[\s>]/i.test(chunk) && i + 1 < out.length) {
      grouped.push(`<div class="mr-head">${chunk}${out[i + 1]}</div>`);
      i++;
    } else {
      grouped.push(chunk);
    }
  }
  return grouped.join('');
}

module.exports = { MAINTENANCE_REPORT_SKELETON_HTML, formatPeriodLabel, groupBodyForPdf };
