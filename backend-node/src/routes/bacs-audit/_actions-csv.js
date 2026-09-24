'use strict';

// Export CSV du plan d'actions, lisible tel quel dans Excel réglé en
// français : séparateur « ; », BOM UTF-8 (accents), fins de ligne CRLF,
// libellés en français, numéros BACS-xxx identiques à l'écran et au PDF.

const {
  ACTION_CATEGORY_LABEL, ACTION_SEVERITY_LABEL, ACTION_STATUS_LABEL, ACTION_EFFORT_LABEL,
} = require('./_labels');

const HEADERS = ['N°', 'Type', 'Gravité', 'Article', 'Catégorie', 'Titre', 'Description',
  'Zone', 'Équipement', 'Statut', 'Effort'];

function cell(v) {
  if (v == null) return '';
  let s = String(v).replace(/\r\n?/g, '\n');
  // Une cellule qui commence par = + - @ serait lue comme une formule par
  // Excel (« - Compteur absent » → #NOM?) : apostrophe de protection.
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function typeLabel(a) {
  if (a.is_info) return 'Information';
  if (a.is_reserve) return 'Réserve';
  return 'Action';
}

/**
 * @param {Array} items — actions numérotées (numberActionItems) + zone_name / equipment_name
 * @param {(text: string) => string} [strip] — remplace les repères {{system:…}}
 * @returns {string} contenu du fichier CSV
 */
function buildActionItemsCsv(items, strip = (t) => t) {
  const lines = [HEADERS.map(cell).join(';')];
  // Plan numéroté d'abord (ordre du PDF), puis les lignes sans numéro :
  // informations, actions terminées ou non retenues.
  const ordered = [...items.filter(a => a.display_number), ...items.filter(a => !a.display_number)];
  for (const a of ordered) {
    lines.push([
      a.display_number,
      typeLabel(a),
      ACTION_SEVERITY_LABEL[a.severity] || a.severity,
      a.r175_article,
      ACTION_CATEGORY_LABEL[a.category] || a.category,
      strip(a.title),
      strip(a.description),
      a.zone_name,
      a.equipment_name,
      ACTION_STATUS_LABEL[a.status] || a.status,
      a.estimated_effort ? (ACTION_EFFORT_LABEL[a.estimated_effort] || a.estimated_effort) : '',
    ].map(cell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { buildActionItemsCsv };
