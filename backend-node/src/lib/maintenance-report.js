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

module.exports = { MAINTENANCE_REPORT_SKELETON_HTML, formatPeriodLabel };
