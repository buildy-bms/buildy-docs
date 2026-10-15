// Textes de la mise en page guidée de l'étape Systèmes (frontend/src/lib/audit-tips-systems-guide.js) :
// règles de rédaction de Kévin vérifiées sur TOUS les textes produits, avec des valeurs typiques.
import { describe, it, expect } from 'vitest';
import * as tips from '../../frontend/src/lib/audit-tips-systems-guide.js';
import { CHECK_DEVICE_CODES, CHECK_SYSTEM_CODES, MISSING_POWER_CODE } from '../../frontend/src/lib/systems-guide.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const SKIP = new Set(['meta', 'article', 'icon', 'tone', 'accent', 'placement', 'keys', 'layout', 'variant', 'value']);

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
  }
  const tip = normalizeTip(value);
  if (tip && tip.kind === 'card') {
    for (const b of tip.blocks) {
      if (b.type === 'p') expect({ name, length: b.text.length <= 160 }).toEqual({ name, length: true });
    }
    expect({ name, words: tip.title.split(/\s+/).length <= 6 }).toEqual({ name, words: true });
  }
  if (tip && tip.kind === 'label') expect({ name, label: tip.label.length <= 90 }).toEqual({ name, label: true });
}

/** Textes affichés tels quels dans la page (pas des bulles) : mêmes règles de rédaction. */
function expectCleanText(name, text) {
  expect({ name, text, problems: checkCopy(text, { label: false }) }).toEqual({ name, text, problems: [] });
}

describe('mise en page guidée : bulles', () => {
  it('filtres, parcours', () => {
    for (const [k, v] of Object.entries(tips.GUIDE_FILTER_TIPS)) expectClean(`GUIDE_FILTER_TIPS.${k}`, v);
    for (const k of ['RESUME_TIP', 'NEXT_STOP_TIP', 'RESUME_ALL_TIP', 'TODO_COLUMN_TIP', 'CHECK_FIX_TIP']) expectClean(k, tips[k]);
    for (const k of ['MISSING_DETAIL_TIP', 'MISSING_HIDE_TIP', 'GO_TO_SYSTEM_TIP', 'OPEN_DEVICE_TIP', 'CHECK_CELL_TIP',
      'ADD_FREE_ENTRY_TIP', 'ADD_TEMPLATE_TIP', 'SAME_USAGE_TIP']) expectClean(k, tips[k]);
    for (const [k, v] of Object.entries(tips.ADD_SCOPE_TIPS)) expectClean(`ADD_SCOPE_TIPS.${k}`, v);
  });

  it('onglets : zone et synthèse, avec et sans reste à faire', () => {
    const z = { name: 'Bureaux Anciens', nature: 'Bureaux', present: 4, total: 6, done: 0, incomplete: 5, empty: 1, toCheck: 1, unanswered: 2 };
    expectClean('zoneGuideTabTip', tips.zoneGuideTabTip(z));
    expectClean('zoneGuideTabTip fini', tips.zoneGuideTabTip({ ...z, technical: true, done: 4, incomplete: 0, empty: 0, toCheck: 0, unanswered: 0 }));
    expectClean('synthesisGuideTabTip', tips.synthesisGuideTabTip({ zones: 6, incomplete: 20, empty: 2, toCheck: 2, unanswered: 13 }));
    expectClean('synthesisGuideTabTip fini', tips.synthesisGuideTabTip({ zones: 1, incomplete: 0, empty: 0, toCheck: 0, unanswered: 0 }));
    expect(tips.guideBadges({ toComplete: 5, toCheck: 1, unanswered: 2 }).map(b => b.text)).toEqual(['5', '! 1', '? 2']);
    for (const b of tips.guideBadges({ toComplete: 5, toCheck: 1, unanswered: 1 })) expectCleanText('guideBadges', b.label);
  });

  it('guide des usages', () => {
    const base = { devices: [{}, {}], shared: [], present: true, empty: false, incomplete: 0, toCheck: 0, status: 'done' };
    for (const x of [
      base,
      { ...base, status: 'todo', incomplete: 2 },
      { ...base, status: 'check', incomplete: 1, toCheck: 1 },
      { ...base, status: 'empty', devices: [], empty: true },
      { ...base, status: 'unanswered', present: false, devices: [] },
    ]) {
      expectClean(`railItemTip ${x.status}`, tips.railItemTip(x, 'Refroidissement'));
      for (const p of tips.systemStatusParts(x)) expectCleanText('systemStatusParts', p.text);
    }
    for (const [d, p] of [[0, 4], [1, 4], [3, 4], [0, 0]]) expectCleanText('progressLabel', tips.progressLabel(d, p));
    expectCleanText('resumeLabel', tips.resumeLabel(6));
    expectCleanText('resumeLabel 1', tips.resumeLabel(1));
  });

  it('lignes « reste à faire »', () => {
    expectCleanText('missingLineText', tips.missingLineText({ answers: 21, devices: 5, labels: ['liaison câblée à la GTB', 'secours', 'hors service', 'arrêt à la main', 'fonctionnement sans la GTB', 'énergie'] }));
    expectCleanText('missingLineText 1', tips.missingLineText({ answers: 1, devices: 1, labels: ['énergie'] }));
    expect(tips.missingLineText({ answers: 0, devices: 0, labels: [] })).toBe('');
    expectCleanText('emptySystemsLineText', tips.emptySystemsLineText(['Refroidissement', 'Ventilation']));
    expectCleanText('emptySystemsLineText 1', tips.emptySystemsLineText(['Refroidissement']));
    expectCleanText('unansweredLineText', tips.unansweredLineText(['Eau chaude sanitaire', 'Éclairage extérieur']));
    expectCleanText('unansweredLineText 1', tips.unansweredLineText(['Eau chaude sanitaire']));
    expectCleanText('hiddenByFilterText', tips.hiddenByFilterText(3));
    expectCleanText('panelMissingText', tips.panelMissingText(['énergie', 'secours']));
    expectCleanText('nextStopLabel', tips.nextStopLabel('Unité intérieure (DRV, split…)'));
    expectClean('nextStopTip', tips.nextStopTip('Unité intérieure (DRV, split…)'));
    expect(tips.nextStopTip('Chaudière').text.startsWith('Suivant à reprendre : Chaudière')).toBe(true);
    expectCleanText('moreChecksLabel', tips.moreChecksLabel(2));
    expectCleanText('elsewhereLabel', tips.elsewhereLabel(3));
  });

  it('chaque point « à vérifier » de l’étape a son texte, sa ligne et sa carte', () => {
    const codes = [...CHECK_DEVICE_CODES, ...CHECK_SYSTEM_CODES, MISSING_POWER_CODE];
    expect(codes.filter(c => !tips.CHECK_CODES.includes(c))).toEqual([]);
    const device = {
      name: 'Chaudière 1', device_role: ['emission'], energy_source: 'gas', power_kw: 9000, age_years: 75,
      managed_by_bms: 1, regulation_granularity: 'central_only', regulation_type_emission: 'robinets_thermostatiques',
    };
    for (const code of codes) {
      const line = tips.checkLine({ code }, 'Mono Split');
      expectCleanText(`checkLine ${code}`, line.lead);
      expectCleanText(`checkLine ${code} suite`, line.text);
      expectClean(`checkCardTip ${code}`, tips.checkCardTip({ code }, device, 'heating'));
      const fix = tips.checkFixLabel(code);
      if (fix) expectClean(`checkFixLabel ${code}`, fix);
    }
    expectClean('deviceChecksTip', tips.deviceChecksTip([{ code: 'DEV-008' }, { code: MISSING_POWER_CODE }], 3));
    expectClean('checkCardTip inconnu', tips.checkCardTip({ code: 'XYZ-999' }));
  });

  it('synthèse : totaux, colonne « Reste à faire »', () => {
    for (const p of tips.synthesisTotals({ incompleteDevices: 20, emptySystems: 2, toCheck: 2, unanswered: 13 })) {
      expectCleanText('synthesisTotals', p.label);
      expectClean(`synthesisTotals tip ${p.label}`, p.tip);
    }
    for (const p of tips.zoneTodoParts({ toComplete: 5, toCheck: 1, unanswered: 2 })) expectCleanText('zoneTodoParts', p.text);
    expect(tips.zoneTodoParts({ toComplete: 0, toCheck: 0, unanswered: 0, present: 3 })).toEqual([{ text: 'Complet', tone: 'green' }]);
    expect(tips.zoneTodoParts({ toComplete: 0, toCheck: 0, unanswered: 0, present: 0 })).toEqual([{ text: 'Rien à faire', tone: 'slate' }]);
  });

  it('fenêtres : ajout d’équipement, ajout de système, déplacer ou partager', () => {
    for (const c of ['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'lighting_outdoor', 'electricity_production', 'custom:x']) {
      expectCleanText(`usageModelsLabel ${c}`, tips.usageModelsLabel(c));
    }
    for (const t of Object.values(tips.GUIDE_TEXTS)) expectCleanText('GUIDE_TEXTS', t);
    for (const k of ['ADD_SEARCH_PLACEHOLDER', 'ADD_FREE_ENTRY_LABEL', 'ADD_BACK_LABEL', 'ALL_LIBRARY_LABEL',
      'CREATE_SYSTEM_NAME_HINT', 'ADD_NO_MATCH', 'OTHER_USAGES_TITLE', 'MOVE_SEARCH_PLACEHOLDER', 'MOVE_NO_MATCH',
      'ALL_DONE_TEXT', 'GUIDE_DONE_TEXT', 'SHOW_ALL_LABEL', 'RESUME_ALL_LABEL', 'DEVICE_DONE_LABEL']) {
      expectCleanText(k, tips[k]);
    }
    for (const s of [{ count: 0 }, { count: 1 }, { count: 2 }, { notConcerned: true }, { other: true }]) {
      expectCleanText('usageTileStatus', tips.usageTileStatus(s));
    }
    expectCleanText('sameUsageLabel', tips.sameUsageLabel('Refroidissement'));
  });
});

describe('textes ajoutés le 13/10 (fiche en rubriques, fenêtre déplacer ou partager, puissances, bouclage)', () => {
  it('rubriques, puissances manquantes, corriger dans…', () => {
    expectClean('rubricHeaderTip ouvert', tips.rubricHeaderTip('Régulation', { open: true }));
    expectClean('rubricHeaderTip fermé', tips.rubricHeaderTip('Régulation', { open: false }));
    expectClean('RUBRICS_ALL_TIPS.all', tips.RUBRICS_ALL_TIPS.all);
    expectClean('RUBRICS_ALL_TIPS.todo', tips.RUBRICS_ALL_TIPS.todo);
    expectClean('POWER_REQUIRED_TIP', tips.POWER_REQUIRED_TIP);
    for (const n of [1, 3]) {
      expectClean(`missingPowersLabel ${n}`, tips.missingPowersLabel(n));
      expectClean(`missingPowersTip ${n}`, tips.missingPowersTip(n));
      expectClean(`missingPowersTip présumé ${n}`, tips.missingPowersTip(n, true));
    }
    for (const code of [...CHECK_DEVICE_CODES, MISSING_POWER_CODE]) expectCleanText(`checkGoLabel ${code}`, tips.checkGoLabel(code));
    expect(tips.checkGoLabel('DEV-008')).toBe('Corriger dans l’étape GTB');
    expect(tips.checkGoLabel('THERMAL-002')).toBe('Corriger dans « Régulation »');
    expectClean('CHECK_GO_TIPS.rubric', tips.CHECK_GO_TIPS.rubric);
    expectClean('CHECK_GO_TIPS.bms', tips.CHECK_GO_TIPS.bms);
    // Chaque code « à vérifier » d'un équipement a sa rubrique (null = autre étape).
    for (const code of CHECK_DEVICE_CODES) expect(code in tips.CHECK_RUBRIC).toBe(true);
  });
  it('fenêtre « Déplacer ou partager »', () => {
    for (const t of tips.MOVE_SHARE_TABS) expectCleanText(`onglet ${t.key}`, t.label);
    for (const kind of ['share', 'move']) {
      expectCleanText(`intro ${kind}`, tips.moveShareIntro(kind, { zone: 'Bureaux 1', usage: 'Chauffage' }));
      expectCleanText(`intro ${kind} sans zone`, tips.moveShareIntro(kind));
      for (const n of [1, 4]) expectCleanText(`pied ${kind} ${n}`, tips.moveShareFooter(kind, n));
    }
    expect(tips.moveShareFooter('share', 1)).toBe('Dessert 1 zone en tout. Chaque case cochée est enregistrée aussitôt.');
  });
  it('bouclage de l’eau chaude : état et raison du parcours', () => {
    expect(tips.systemStatusParts({ status: 'todo', present: true, loopMissing: true, incomplete: 0, toCheck: 0 }))
      .toEqual([{ text: 'bouclage à renseigner', tone: 'amber' }]);
    expect(tips.stopReasonLabel('loop')).toBe('bouclage à renseigner');
  });
});

describe('filtre par usage du guide (13/10)', () => {
  it('« Tous les usages » : état de la zone, carte, ligne de rappel', () => {
    expectCleanText('ALL_USAGES_LABEL', tips.ALL_USAGES_LABEL);
    expect(tips.zoneStatusParts({ toComplete: 3, toCheck: 1, unanswered: 2 }).map(p => p.text))
      .toEqual(['3 à compléter', '1 à vérifier', '2 sans réponse']);
    expect(tips.zoneStatusParts({ toComplete: 0, toCheck: 0, unanswered: 0 })).toEqual([{ text: 'Complet', tone: 'green' }]);
    expectClean('allUsagesTip', tips.allUsagesTip({ present: 5 }));
    expectCleanText('usageFilterText', tips.usageFilterText('Éclairage intérieur'));
    expectCleanText('SHOW_ALL_USAGES_LABEL', tips.SHOW_ALL_USAGES_LABEL);
    const t = tips.railItemTip({ devices: [], shared: [], present: true, status: 'done', incomplete: 0, toCheck: 0 }, 'Chauffage');
    expectClean('railItemTip avec rappel du filtre', t);
    expect(t.meta).toBe('Un clic n’affiche que cet usage.');
  });
});
