// Contenus des infobulles de l'éditeur d'AF (frontend/src/lib/editor-tips.js) : règles de
// rédaction de Kévin (français simple, tutoiement, pas d'article du décret dans le texte, pas
// de « (s) »…) vérifiées sur TOUS les textes produits, longueurs (étiquette ≤ 40 caractères,
// titre de carte ≤ 6 mots, texte ≤ 160 caractères), raccourcis Tiptap réellement actifs et
// icônes existantes dans free-solid (enregistrées ensuite par scripts/gen-tooltip-icons.mjs).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as tips from '../../frontend/src/lib/editor-tips.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const frontRequire = createRequire(new URL('../../frontend/package.json', import.meta.url));
const free = frontRequire('@fortawesome/free-solid-svg-icons');

const SKIP = new Set(['meta', 'article', 'icon', 'tone', 'accent', 'placement', 'keys', 'layout']);

/** Tous les textes affichés d'une valeur de bulle : [{ text, label, key }]. */
function shown(value, inCard = false, key = null) {
  if (value == null || value === false) return [];
  if (typeof value === 'string') return [{ text: value, label: !inCard && (!key || key === 'label' || key === 'text'), key }];
  if (typeof value === 'number') return [];
  if (Array.isArray(value)) return value.flatMap((v) => shown(v, inCard, key));
  if (typeof value === 'object') {
    const card = inCard || !!value.title;
    return Object.entries(value).flatMap(([k, v]) => (SKIP.has(k) ? [] : shown(v, card, k)));
  }
  return [];
}

/** Règles de rédaction + longueurs ; renvoie la bulle normalisée. */
function expectClean(name, value) {
  for (const s of shown(value)) {
    expect({ name, text: s.text, problems: checkCopy(s.text, { label: s.label }) }).toEqual({ name, text: s.text, problems: [] });
    if (s.label) expect({ name, label: s.text, ok: s.text.length <= 40 }).toEqual({ name, label: s.text, ok: true });
  }
  const tip = normalizeTip(value);
  if (tip?.kind === 'card') {
    expect({ name, title: tip.title, words: tip.title.split(/\s+/).length <= 6 }).toEqual({ name, title: tip.title, words: true });
    const text = (value.text || '').trim();
    expect({ name, text, ok: text.length <= 160 }).toEqual({ name, text, ok: true });
  }
  return tip;
}

const NETWORK_ERROR = { code: 'ERR_NETWORK', message: 'Network Error' };

describe('editor-tips : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || /ICONS$/.test(name)) continue;
      // Tables (types de section, colonnes, types de point…) : chaque entrée est une bulle.
      const isTable = v && typeof v === 'object' && !v.title && !v.label;
      if (isTable) for (const [k, entry] of Object.entries(v)) expectClean(`${name}.${k}`, entry);
      else expectClean(name, v);
    }
  });

  it('fonctions, avec des valeurs typiques', () => {
    expectClean('updatedAtTip', tips.updatedAtTip('2026-10-12 08:15:00'));
    for (const k of ['standard', 'equipment', 'hyperveez_page', 'synthesis', 'zones', 'inconnu']) expectClean(`sectionKindTip ${k}`, tips.sectionKindTip(k));
    expectClean('categoryNodeTip', tips.categoryNodeTip('Chauffage'));
    expectClean('categoryNodeTip vide', tips.categoryNodeTip(null));
    expectClean('paidOptionTip tous', tips.paidOptionTip({ e: 'paid_option', s: 'paid_option', p: 'paid_option' }));
    expectClean('paidOptionTip partiel', tips.paidOptionTip({ e: null, s: 'paid_option', p: 'included' }));
    for (const [c, s] of [[true, true], [false, false]]) expectClean('deleteSectionTip', tips.deleteSectionTip(c, s));
    for (const n of [0, 1, 12]) expectClean(`unverifiedFilterTip ${n}`, tips.unverifiedFilterTip(false, n));
    expectClean('unverifiedFilterTip actif', tips.unverifiedFilterTip(true, 3));
    for (const n of [0, 1, 3]) expectClean(`batchDeleteTip ${n}`, tips.batchDeleteTip(n));
    for (const b of [true, false]) {
      expectClean('linkButtonTip', tips.linkButtonTip(b));
      expectClean('claudeOptionsTip', tips.claudeOptionsTip(b));
      expectClean('checkAllTip', tips.checkAllTip(b, 'toutes les zones'));
    }
    for (const s of ['neighbors', 'summary', 'full', undefined]) expectClean(`corpusPillTip ${s}`, tips.corpusPillTip(s));
    for (const isMac of [true, false]) {
      expectClean('autosaveErrorTip', tips.autosaveErrorTip({ error: NETWORK_ERROR, attempt: 2, lastSaved: '10:15:32', isMac }));
    }
    expectClean('autosaveErrorTip sans détail', tips.autosaveErrorTip());
    expectClean('savedAtTip', tips.savedAtTip('10:15:32'));
    expectClean('templateDriftTip', tips.templateDriftTip(2, 5));
    for (const src of ['section_template', 'equipment_template']) expectClean(`inheritedCaptureTip ${src}`, tips.inheritedCaptureTip(src));
    expectClean('pointOptionalToggleTip ajouté', tips.pointOptionalToggleTip({ source: 'local-add' }));
    expectClean('pointOptionalToggleTip optionnel', tips.pointOptionalToggleTip({ source: 'template', is_optional: 1 }));
    expectClean('pointOptionalToggleTip obligatoire', tips.pointOptionalToggleTip({ source: 'local-edit', is_optional: 0 }));
    expectClean('bacsCategoryTip', tips.bacsCategoryTip('R175-1 §1, §2'));
    for (const [active, dir] of [[false, 'asc'], [true, 'asc'], [true, 'desc']]) expectClean('sortTip', tips.sortTip('type d’occupation', active, dir));
    for (const o of [{ hasTemplate: false }, { anyChecked: false }, { anyChecked: true }, { loading: true }]) {
      expectClean('librarySyncDisabledTip', tips.librarySyncDisabledTip(o));
    }
    expectClean('openTemplateTip court', tips.openTemplateTip('Chaudière gaz'));
    expectClean('openTemplateTip long', tips.openTemplateTip('Engagement de commande du contrat de services requis'));
  });

  it('modèle d’une section : nom complet en ligne, carte d’une ligne de titre quelle que soit sa longueur', () => {
    const long = tips.openTemplateTip('Engagement de commande du contrat de services requis');
    expect(long).toMatchObject({ title: 'Modèle de la bibliothèque', icon: 'book' });
    expect(long.rows[0].value).toBe('Engagement de commande du contrat de services requis');
    expect(tips.openTemplateTip('').rows).toEqual([]);
  });
});

describe('editor-tips : contenu', () => {
  it('dates lisibles, jamais une date SQL brute', () => {
    expect(tips.formatWhen('2026-10-12 08:15:00')).toMatch(/^le 12 oct\. 2026 à \d{2}:\d{2}$/);
    expect(tips.formatWhen('2026-10-12T08:15:00Z')).toMatch(/^le 12 oct\. 2026 à \d{2}:\d{2}$/);
    expect(tips.formatWhen(null)).toBe('');
    expect(tips.formatWhen('pas une date')).toBe('');
    expect(tips.updatedAtTip(null)).toBe(null);
    expect(tips.updatedAtTip('2026-10-12 08:15:00').label).toMatch(/^Modifiée le 12 oct\. 2026 à /);
  });

  it('raccourcis de la barre d’outils = ceux de Tiptap (titres 2 et 3, StarterKit + Underline)', () => {
    const t = tips.EDITOR_TOOLBAR_TIPS;
    expect(t.bold.keys).toEqual(['Mod', 'B']);
    expect(t.italic.keys).toEqual(['Mod', 'I']);
    expect(t.underline.keys).toEqual(['Mod', 'U']);
    expect(t.h2.keys).toEqual(['Mod', 'Alt', '2']);
    expect(t.h3.keys).toEqual(['Mod', 'Alt', '3']);
    expect(t.blockquote.keys).toEqual(['Mod', 'Shift', 'B']);
    expect(t.bulletList.keys).toEqual(['Mod', 'Shift', '8']);
    expect(t.orderedList.keys).toEqual(['Mod', 'Shift', '7']);
    expect(tips.linkButtonTip(false).keys).toBeUndefined();
  });

  it('arbre : pas de faux raccourci sur les déplacements, Suppr seulement sur la section sélectionnée', () => {
    for (const v of Object.values(tips.MOVE_TIPS)) expect(typeof v === 'string' || !v.keys).toBe(true);
    expect(tips.deleteSectionTip(false, true).keys).toEqual(['Delete']);
    expect(tips.deleteSectionTip(true, false).keys).toEqual([]);
    expect(tips.deleteSectionTip(true, false).label).toBe('Supprimer avec ses sous-sections');
  });

  it('option payante : disponibilité par niveau d’offre', () => {
    const t = normalizeTip(tips.paidOptionTip({ e: null, s: 'paid_option', p: 'included' }));
    expect(t.rows.map((r) => [r.label, r.value])).toEqual([
      ['Essentiel', 'Non disponible'],
      ['Smart', 'Option payante'],
      ['Premium', 'Incluse'],
    ]);
    expect(normalizeTip(tips.paidOptionTip({ e: 'paid_option', s: 'paid_option', p: 'paid_option' })).rows).toEqual([]);
  });

  it('filtre « à vérifier » : nombre au pluriel, jamais « (s) »', () => {
    expect(normalizeTip(tips.unverifiedFilterTip(false, 1)).rows[0].value).toBe('1 section');
    expect(normalizeTip(tips.unverifiedFilterTip(false, 12)).rows[0].value).toBe('12 sections');
    expect(normalizeTip(tips.unverifiedFilterTip(false, 0)).rows[0].value).toBe('aucune');
    expect(tips.batchDeleteTip(3)).toBe('Supprimer 3 sections cochées');
  });

  it('échec d’enregistrement : détail lisible (pas le message réseau brut en anglais) + raccourci', () => {
    expect(tips.saveErrorDetail(NETWORK_ERROR)).toBe('Pas de connexion au serveur');
    expect(tips.saveErrorDetail({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' })).toBe('Le serveur ne répond pas à temps');
    expect(tips.saveErrorDetail({ response: { status: 502 }, message: 'Request failed with status code 502' })).toBe('Réponse du serveur : erreur 502');
    expect(tips.saveErrorDetail({ response: { status: 422, data: { detail: 'Titre trop long' } } })).toBe('Titre trop long');
    expect(tips.saveErrorDetail(null)).toBe('');
    const mac = normalizeTip(tips.autosaveErrorTip({ error: NETWORK_ERROR, attempt: 3, lastSaved: '10:15:32', isMac: true }));
    expect(mac.title).toBe('Échec de l’enregistrement');
    expect(mac.tone).toBe('error');
    expect(mac.rows.map((r) => r.label)).toEqual(['Dernier enregistrement réussi', 'Nouveaux essais automatiques', 'Détail']);
    expect(mac.todo.items[0]).toMatch(/⌘S\.$/);
    expect(normalizeTip(tips.autosaveErrorTip({ isMac: false })).todo.items[0]).toMatch(/Ctrl\+S\.$/);
  });

  it('pastille BACS : article du décret en pied seulement', () => {
    const t = normalizeTip(tips.bacsCategoryTip('R175-1 §1, §2'));
    expect(t.meta).toBe('Décret BACS · article R175-1 1°, 2°');
    expect(t.blocks.map((b) => b.text).join(' ')).not.toMatch(/R175/);
  });

  it('bouton grisé : la raison seulement quand il est grisé', () => {
    expect(tips.librarySyncDisabledTip({ anyChecked: false })).toBe('Coche au moins un élément à récupérer');
    expect(tips.librarySyncDisabledTip({ hasTemplate: false })).toBe('Aucun modèle de bibliothèque à reprendre');
    expect(tips.librarySyncDisabledTip({ anyChecked: true })).toBe(null);
    expect(tips.librarySyncDisabledTip({ loading: true })).toBe(null);
  });

  it('icônes citées : toutes existent dans free-solid (enregistrement : node scripts/gen-tooltip-icons.mjs)', () => {
    const exportName = (n) => 'fa' + n.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
    const missing = tips.EDITOR_TIP_ICONS.filter((n) => !free[exportName(n)]);
    expect(missing).toEqual([]);
  });
});
