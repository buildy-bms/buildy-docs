// Contenus des infobulles de la FAQ Buildy et des pages d'administration
// (frontend/src/lib/faq-tips.js) : règles de rédaction de Kévin (français simple, tutoiement,
// pas d'article du décret dans le texte, pas de « (s) », pas d'anglais…) vérifiées sur TOUS les
// textes produits, et toutes les icônes citées existent dans FontAwesome (free-solid).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as tips from '../../frontend/src/lib/faq-tips.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const require = createRequire(import.meta.url);
const free = require('../../frontend/node_modules/@fortawesome/free-solid-svg-icons');
const exportName = (n) => 'fa' + n.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');

const SKIP = new Set(['meta', 'article', 'icon', 'tone', 'accent', 'placement', 'keys', 'layout']);

/** Tous les textes affichés d'une valeur de bulle : [{ text, label }]. */
function shown(value, inCard = false, key = null) {
  if (value == null || value === false) return [];
  if (typeof value === 'string') return [{ text: value, label: !inCard && (!key || key === 'label' || key === 'text') }];
  if (typeof value === 'number') return [];
  if (Array.isArray(value)) return value.flatMap((v) => shown(v, inCard, key));
  if (typeof value === 'object') {
    const card = inCard || !!value.title;
    return Object.entries(value).flatMap(([k, v]) => (SKIP.has(k) ? [] : shown(v, card, k)));
  }
  return [];
}

function expectClean(name, value) {
  for (const s of shown(value)) {
    expect({ name, text: s.text, problems: checkCopy(s.text, { label: s.label }) }).toEqual({ name, text: s.text, problems: [] });
    // Étiquette : 40 caractères au plus (règle de Kévin, au-delà → carte).
    if (s.label) expect({ name, text: s.text, long: s.text.length > 40 }).toEqual({ name, text: s.text, long: false });
  }
  expect(normalizeTip(value) !== undefined).toBe(true);
}

describe('faq-tips : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || /ICONS$/.test(name)) continue;
      expectClean(name, v);
    }
  });

  it('fonctions, avec des valeurs typiques', () => {
    for (const score of [92, 80, 79, 60, 59, 12, null]) expectClean(`seoScoreTip ${score}`, tips.seoScoreTip(score));
    expectClean('syncCellTip à publier', tips.syncCellTip({ dirty: 1, pushed_at: '2026-10-12T08:15:00.000Z' }));
    expectClean('syncCellTip publié', tips.syncCellTip({ dirty: 0, pushed_at: '2026-10-12T08:15:00.000Z' }));
    expectClean('syncCellTip lu', tips.syncCellTip({ dirty: 0, crisp_id: 'abc' }));
    expectClean('syncCellTip local', tips.syncCellTip({ dirty: 0 }));
    expectClean('pullFailedTip', tips.pullFailedTip('Délai de réponse dépassé'));
    expectClean('pullFailedTip sans message', tips.pullFailedTip(null));
    expectClean('promptHistoryTip vide', tips.promptHistoryTip(0));
    expectClean('promptHistoryTip fermé', tips.promptHistoryTip(3, false));
    expectClean('promptHistoryTip ouvert', tips.promptHistoryTip(3, true));
    expectClean('promptResetTip origine', tips.promptResetTip(false));
    expectClean('promptResetTip modifié', tips.promptResetTip(true));
    expectClean('generationUsageTip', tips.generationUsageTip({ input_tokens: 45231, output_tokens: 1820 }));
    expectClean('generationUsageTip vide', tips.generationUsageTip(null));
    for (const c of ['#ef4444', '#f97316', '#eab308', '#22c55e', '#6366f1', '#ffffff', '#111827', '#123456']) {
      expectClean(`annotationColorLabel ${c}`, tips.annotationColorLabel(c));
    }
    expectClean('undoTip', [tips.undoTip(true), tips.undoTip(false), tips.redoTip(true), tips.redoTip(false)]);
    for (const code of ['auth.login', 'af.share.grant', 'section.move', 'section_template.update', 'template.create',
      'attachment.upload', 'export.af', 'inspection.add', 'claude.draft', 'zone.create', 'faq.pull', '']) {
      expectClean(`auditTypeTip ${code}`, tips.auditTypeTip(code));
    }
    for (const code of ['R175-1', 'R175-2', 'R175-3', 'R175-4', 'R175-5', 'R175-5-1', 'R175-6']) {
      expectClean(`decreeArticleTip ${code}`, tips.decreeArticleTip(code));
    }
  });

  it('dates lisibles, jamais brutes', () => {
    expect(tips.formatDateTime('2026-10-12T08:15:00.000Z')).toMatch(/^\d{1,2} oct\. 2026 à \d{2}:\d{2}$/);
    expect(tips.formatDateTime('2026-10-12 08:15:00')).toMatch(/^12 oct\. 2026 à \d{2}:\d{2}$/);
    expect(tips.formatDateTime(null)).toBe('');
    expect(tips.formatDateTime('pas une date')).toBe('');
    expect(tips.syncCellTip({ pushed_at: '2026-10-12T08:15:00.000Z' })).toMatch(/^Publié sur Crisp le \d{1,2} oct\. 2026 à /);
  });

  it('cartes et étiquettes attendues', () => {
    expect(normalizeTip(tips.seoScoreTip(85)).tone).toBe('success');
    expect(normalizeTip(tips.seoScoreTip(65)).tone).toBe('warning');
    expect(normalizeTip(tips.seoScoreTip(30)).tone).toBe('error');
    expect(normalizeTip(tips.seoScoreTip(85)).todo).toBeNull();
    expect(normalizeTip(tips.syncCellTip({ dirty: 1 })).kind).toBe('card');
    expect(normalizeTip(tips.promptHistoryTip(0)).kind).toBe('card');
    expect(normalizeTip(tips.promptHistoryTip(2)).kind).toBe('label');
    expect(tips.auditTypeTip('section_template.update').title).toBe('Section type');
    expect(tips.auditTypeTip('section.move').title).toBe('Section d’un document');
    expect(tips.auditTypeTip('whitepaper.create').title).toBe('Autre action');
    const decree = normalizeTip(tips.decreeArticleTip('R175-3'));
    expect(decree.meta).toBe('Décret BACS · article R175-3');
    expect(tips.decreeArticleTip('R175-99')).toBeNull();
    expect(Object.keys(tips.ANNOTATION_TOOL_TIPS)).toEqual(['select', 'arrow', 'rect', 'ellipse', 'pin', 'spotlight', 'blur', 'text']);
  });

  it('les icônes citées existent dans FontAwesome (free-solid)', () => {
    const missing = tips.FAQ_TIP_ICONS.filter((n) => !free[exportName(n)]);
    expect(missing).toEqual([]);
  });
});
