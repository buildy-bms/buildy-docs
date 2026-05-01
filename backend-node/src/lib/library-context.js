'use strict';

// Construit un bloc texte resumant le corpus existant de la bibliotheque
// (fonctionnalites, sections types narratives, modeles d'equipement) pour
// enrichir les prompts Claude et favoriser la coherence cross-features.
//
// Trois strategies de selection :
//   - 'neighbors' : voisins immediats (meme parent_template_id pour les
//                    sections, meme categorie pour les equipements).
//   - 'summary'   : tout le corpus, en resume tres compact (titre + 1
//                    phrase + matrice E/S/P pour fonctionnalites).
//   - 'full'      : tout le corpus avec body_html complet, plafonne a
//                    ~30 000 caracteres (FIFO sur updated_at) pour ne pas
//                    saturer le contexte.

const db = require('../database');

const FULL_CHAR_BUDGET = 30000;
const NEIGHBOR_SUMMARY_LEN = 240;

const AVAIL_LABEL = {
  included:    'Inclus',
  paid_option: 'Option payante',
};

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentences(text, n = 2, max = 240) {
  const t = stripHtml(text);
  if (!t) return '';
  const parts = t.split(/(?<=[.!?])\s+/);
  const joined = parts.slice(0, n).join(' ');
  return joined.length > max ? joined.slice(0, max - 1).trimEnd() + '…' : joined;
}

function fmtAvail(v) {
  if (!v) return 'Non disponible';
  return AVAIL_LABEL[v] || v;
}

function formatFunctionality(t, { detail = 'short' } = {}) {
  const lines = [`- ${t.title}`];
  if (t.bacs_articles) lines.push(`  BACS: ${t.bacs_articles}`);
  lines.push(`  Disponibilite: E=${fmtAvail(t.avail_e)} S=${fmtAvail(t.avail_s)} P=${fmtAvail(t.avail_p)}`);
  if (detail === 'short') {
    const s = firstSentences(t.body_html, 1, 180);
    if (s) lines.push(`  ${s}`);
  } else if (detail === 'medium') {
    const s = firstSentences(t.body_html, 2, NEIGHBOR_SUMMARY_LEN);
    if (s) lines.push(`  ${s}`);
  } else if (detail === 'full') {
    const s = stripHtml(t.body_html);
    if (s) lines.push(`  ${s}`);
  }
  return lines.join('\n');
}

function formatNarrative(t, { detail = 'short' } = {}) {
  const lines = [`- ${t.title}`];
  if (detail === 'short') {
    const s = firstSentences(t.body_html, 1, 180);
    if (s) lines.push(`  ${s}`);
  } else if (detail === 'medium') {
    const s = firstSentences(t.body_html, 2, NEIGHBOR_SUMMARY_LEN);
    if (s) lines.push(`  ${s}`);
  } else if (detail === 'full') {
    const s = stripHtml(t.body_html);
    if (s) lines.push(`  ${s}`);
  }
  return lines.join('\n');
}

function formatEquipment(t, { detail = 'short' } = {}) {
  const lines = [`- ${t.name}${t.category ? ` (${t.category})` : ''}`];
  if (t.bacs_articles) lines.push(`  BACS: ${t.bacs_articles}`);
  if (detail === 'short') {
    const s = firstSentences(t.description_html, 1, 180);
    if (s) lines.push(`  ${s}`);
  } else if (detail === 'medium') {
    const s = firstSentences(t.description_html, 2, NEIGHBOR_SUMMARY_LEN);
    if (s) lines.push(`  ${s}`);
  } else if (detail === 'full') {
    const desc = stripHtml(t.description_html);
    if (desc) lines.push(`  Description: ${desc}`);
    const just = stripHtml(t.bacs_justification);
    if (just) lines.push(`  Justification BACS: ${just}`);
  }
  return lines.join('\n');
}

function pickNeighbors({ kind, currentTemplateId, parentTemplateId, category }) {
  if (kind === 'functionality') {
    return db.sectionTemplates.list({ kind: 'functionality' })
      .filter(t => t.id !== currentTemplateId)
      .filter(t => (t.parent_template_id || null) === (parentTemplateId || null));
  }
  if (kind === 'narrative_section') {
    return db.sectionTemplates.list({ kind: 'standard' })
      .filter(t => t.id !== currentTemplateId)
      .filter(t => (t.parent_template_id || null) === (parentTemplateId || null));
  }
  if (kind === 'equipment_description' || kind === 'equipment_bacs_justification') {
    if (!category) return [];
    return db.equipmentTemplates.list({ category })
      .filter(t => t.id !== currentTemplateId);
  }
  return [];
}

function buildNeighborsBlock({ kind, currentTemplateId, parentTemplateId, category }) {
  const neighbors = pickNeighbors({ kind, currentTemplateId, parentTemplateId, category });
  if (!neighbors.length) return '';
  const isEquipment = kind === 'equipment_description' || kind === 'equipment_bacs_justification';
  const isFunctionality = kind === 'functionality';
  const header = isEquipment
    ? `Autres modeles d'equipement de la meme categorie deja rediges :`
    : isFunctionality
      ? `Autres fonctionnalites de la meme branche deja redigees :`
      : `Autres sections narratives de la meme branche deja redigees :`;
  const lines = neighbors.map(t =>
    isEquipment ? formatEquipment(t, { detail: 'medium' })
      : isFunctionality ? formatFunctionality(t, { detail: 'medium' })
        : formatNarrative(t, { detail: 'medium' })
  );
  return [header, ...lines].join('\n\n');
}

function buildSummaryBlock({ currentTemplateId, kind }) {
  const blocks = [];
  // Fonctionnalites
  const fns = db.sectionTemplates.list({ kind: 'functionality' })
    .filter(t => !(kind === 'functionality' && t.id === currentTemplateId))
    .filter(t => (t.body_html || '').trim());
  if (fns.length) {
    blocks.push(`Fonctionnalites Buildy deja redigees :\n` +
      fns.map(t => formatFunctionality(t, { detail: 'short' })).join('\n'));
  }
  // Sections narratives
  const narr = db.sectionTemplates.list({ kind: 'standard' })
    .filter(t => !(kind === 'narrative_section' && t.id === currentTemplateId))
    .filter(t => (t.body_html || '').trim());
  if (narr.length) {
    blocks.push(`Sections narratives deja redigees :\n` +
      narr.map(t => formatNarrative(t, { detail: 'short' })).join('\n'));
  }
  // Equipements
  const eq = db.equipmentTemplates.list()
    .filter(t => !(kind === 'equipment_description' && t.id === currentTemplateId)
              && !(kind === 'equipment_bacs_justification' && t.id === currentTemplateId))
    .filter(t => (t.description_html || '').trim() || (t.bacs_justification || '').trim());
  if (eq.length) {
    blocks.push(`Modeles d'equipement deja rediges :\n` +
      eq.map(t => formatEquipment(t, { detail: 'short' })).join('\n'));
  }
  return blocks.join('\n\n');
}

function buildFullBlock({ currentTemplateId, kind }) {
  // Concat de toutes les entites avec body complet, ordonnees du plus recent
  // au plus ancien (updated_at) puis tronque pour rester sous le budget.
  const items = [];
  for (const t of db.sectionTemplates.list({ kind: 'functionality' })) {
    if (kind === 'functionality' && t.id === currentTemplateId) continue;
    if (!(t.body_html || '').trim()) continue;
    items.push({ updated_at: t.updated_at, text: `[Fonctionnalite] ${formatFunctionality(t, { detail: 'full' })}` });
  }
  for (const t of db.sectionTemplates.list({ kind: 'standard' })) {
    if (kind === 'narrative_section' && t.id === currentTemplateId) continue;
    if (!(t.body_html || '').trim()) continue;
    items.push({ updated_at: t.updated_at, text: `[Section narrative] ${formatNarrative(t, { detail: 'full' })}` });
  }
  for (const t of db.equipmentTemplates.list()) {
    if ((kind === 'equipment_description' || kind === 'equipment_bacs_justification')
        && t.id === currentTemplateId) continue;
    if (!(t.description_html || '').trim() && !(t.bacs_justification || '').trim()) continue;
    items.push({ updated_at: t.updated_at, text: `[Equipement] ${formatEquipment(t, { detail: 'full' })}` });
  }
  items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const out = [];
  let used = 0;
  for (const it of items) {
    if (used + it.text.length + 2 > FULL_CHAR_BUDGET) break;
    out.push(it.text);
    used += it.text.length + 2;
  }
  return out.join('\n\n');
}

/**
 * Construit le bloc de contexte bibliotheque a injecter dans le prompt.
 * @returns { text: string, charCount: number, approxTokens: number, strategy: string }
 *   ou null si vide.
 */
function buildLibraryContext({ kind, currentTemplateId, parentTemplateId, category, strategy }) {
  let body = '';
  if (strategy === 'neighbors') {
    body = buildNeighborsBlock({ kind, currentTemplateId, parentTemplateId, category });
  } else if (strategy === 'summary') {
    body = buildSummaryBlock({ currentTemplateId, kind });
  } else if (strategy === 'full') {
    body = buildFullBlock({ currentTemplateId, kind });
  } else {
    return null;
  }
  if (!body) return null;
  const charCount = body.length;
  return {
    text: body,
    charCount,
    approxTokens: Math.ceil(charCount / 4),
    strategy,
  };
}

module.exports = { buildLibraryContext, stripHtml };
