// Contenus des infobulles propres à l'audit sur mobile (frontend/src/lib/audit-tips-mobile.js) :
// règles de rédaction de Kévin (français simple, tutoiement, pas d'article du décret dans le
// texte, pas de « (s) »…) vérifiées sur TOUS les textes produits, avec des valeurs typiques ;
// toutes les icônes citées existent dans free-solid et figurent dans AUDIT_MOBILE_TIP_ICONS.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as tips from '../../frontend/src/lib/audit-tips-mobile.js';
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

/** Toutes les icônes citées par une valeur de bulle. */
function icons(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v) => icons(v, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === 'icon' && typeof v === 'string') out.add(v);
    else icons(v, out);
  }
  return out;
}

const seen = [];
function expectClean(name, value) {
  seen.push(value);
  for (const s of shown(value)) {
    expect({ name, text: s.text, problems: checkCopy(s.text, { label: s.label }) }).toEqual({ name, text: s.text, problems: [] });
  }
  expect(normalizeTip(value) !== undefined).toBe(true);
}

describe('audit-tips-mobile : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || name === 'AUDIT_MOBILE_TIP_ICONS') continue;
      expectClean(name, v);
    }
  });

  it('barre du haut : hors ligne et envoi en attente', () => {
    for (const n of [0, 1, 4]) {
      expectClean(`offlineTip ${n}`, tips.offlineTip(n));
      expectClean(`pendingSyncTip ${n}`, tips.pendingSyncTip(n));
    }
    const off = normalizeTip(tips.offlineTip(3));
    expect(off.kind).toBe('card');
    expect(off.rows[0].value).toBe('3 modifications');
    expect(normalizeTip(tips.offlineTip(0)).rows[0].value).toBe('aucune modification');
    expect(normalizeTip(tips.pendingSyncTip(1)).blocks[0].text).toMatch(/^La modification/);
    expect(normalizeTip(tips.pendingSyncTip(5)).blocks[0].text).toMatch(/^5 modifications/);
  });

  it('pastilles des onglets', () => {
    expectClean('zones', tips.tabBadgeTip('zones', { tone: 'red' }));
    for (const n of [1, 3]) {
      expectClean(`systems ${n}`, tips.tabBadgeTip('systems', { tone: 'amber', count: n }));
      expectClean(`meters ${n}`, tips.tabBadgeTip('meters', { tone: 'red', count: n }));
      expectClean(`plan bloquantes ${n}`, tips.tabBadgeTip('plan', { tone: 'red', count: n }));
      expectClean(`plan majeures ${n}`, tips.tabBadgeTip('plan', { tone: 'amber', count: n }));
    }
    expectClean('bms', tips.tabBadgeTip('bms', { tone: 'amber' }));
    expect(tips.tabBadgeTip('site', null)).toBeNull();
    expect(tips.tabBadgeTip('docs', { tone: 'amber' })).toBeNull();
    expect(normalizeTip(tips.tabBadgeTip('plan', { tone: 'red', count: 2 })).title).toBe('2 actions bloquantes ouvertes');
    expect(normalizeTip(tips.tabBadgeTip('plan', { tone: 'amber', count: 1 })).title).toBe('1 action majeure ouverte');
    expect(normalizeTip(tips.tabBadgeTip('systems', { tone: 'amber', count: 2 })).title).toBe('2 usages sans réponse');
  });

  it('noms complets des onglets : étiquettes courtes', () => {
    for (const [k, v] of Object.entries(tips.TAB_FULL_LABELS)) {
      expect({ k, problems: checkCopy(v, { label: true }) }).toEqual({ k, problems: [] });
      expect(v.length).toBeLessThanOrEqual(40);
    }
  });

  it('variante mobile de la puissance saisie à la main : geste au doigt', () => {
    const t = normalizeTip(tips.POWER_MANUAL_MOBILE_TIP);
    expect(t.kind).toBe('card');
    expect(t.todo.items[0]).toMatch(/^Touche/);
  });
});

describe('audit-tips-mobile : icônes', () => {
  it('toutes les icônes citées existent dans free-solid et sont listées', () => {
    expectClean('constantes', Object.values(tips).filter((v) => v && typeof v === 'object' && !Array.isArray(v)));
    const used = new Set();
    for (const v of seen) icons(v, used);
    for (const n of used) {
      expect({ icon: n, free: !!free[exportName(n)] }).toEqual({ icon: n, free: true });
      expect({ icon: n, listed: tips.AUDIT_MOBILE_TIP_ICONS.includes(n) }).toEqual({ icon: n, listed: true });
    }
    for (const n of tips.AUDIT_MOBILE_TIP_ICONS) expect({ icon: n, free: !!free[exportName(n)] }).toEqual({ icon: n, free: true });
  });
});
