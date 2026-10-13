// Contenus des infobulles des étapes Systèmes et GTB de l'audit (frontend/src/lib/
// audit-tips-systems.js) : règles de rédaction de Kévin (français simple, tutoiement, pas
// d'article du décret dans le texte, pas de « (s) », pas d'anglais…) vérifiées sur TOUS les
// textes produits par les fonctions, avec des valeurs typiques. Les constantes exportées sont
// déjà vérifiées par tooltip-copy-modules.test.mjs ; on les repasse ici avec normalizeTip.
import { describe, it, expect } from 'vitest';
import * as tips from '../../frontend/src/lib/audit-tips-systems.js';
import { deviceMissingFields } from '../../frontend/src/lib/audit-options.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const SKIP = new Set(['meta', 'article', 'icon', 'tone', 'accent', 'placement', 'keys', 'layout', 'variant']);

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
  }
  // Une carte : titre court (≤ 6 mots hors noms saisis), phrases ≤ 160 caractères.
  const tip = normalizeTip(value);
  if (tip && tip.kind === 'card') {
    for (const b of tip.blocks) {
      if (b.type === 'p') expect({ name, length: b.text.length <= 160 }).toEqual({ name, length: true });
    }
  }
  if (tip && tip.kind === 'label') expect({ name, label: tip.label.length <= 90 }).toEqual({ name, label: true });
}

const ALL_MISSING = deviceMissingFields(
  { extra_system_ids: [12], device_role: ['production'], is_communicating: true },
  'heating',
);

describe('audit-tips-systems : règles de rédaction', () => {
  it('constantes (normalisées)', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function') continue;
      expectClean(name, v);
    }
  });

  it('zones et puissances', () => {
    expectClean('zoneTabTip complet', tips.zoneTabTip({ name: 'Bureaux RDC', nature: 'Bureaux', active: 4, total: 6 }));
    expectClean('zoneTabTip à reprendre', tips.zoneTabTip({ name: 'Chaufferie', technical: true, active: 1, total: 2, incomplete: 3, noDevice: 2, unanswered: 1 }));
    expectClean('zoneTabTip à reprendre (1)', tips.zoneTabTip({ name: 'Hall', active: 1, total: 2, incomplete: 1, noDevice: 1, unanswered: 2 }));
    expectClean('zoneActiveCountLabel', tips.zoneActiveCountLabel(2, 5));
    expectClean('systemsSynthesisTabTip complet', tips.systemsSynthesisTabTip({ zones: 6 }));
    expectClean('systemsSynthesisTabTip à reprendre', tips.systemsSynthesisTabTip({ zones: 6, incomplete: 4, noDevice: 2, unanswered: 3 }));
    expectClean('systemsSynthesisTabTip à reprendre (1)', tips.systemsSynthesisTabTip({ zones: 1, incomplete: 1, noDevice: 1, unanswered: 1 }));
    expect(tips.systemsSynthesisTabTip({ zones: 6 }).todo).toBeNull();
    expect(tips.systemsSynthesisTabTip({ zones: 6, unanswered: 2 }).todo.items).toEqual(['Réponds « Présent » ou « Non concerné » pour 2 usages']);
    expectClean('powerDiscrepancyTip', tips.powerDiscrepancyTip({ pct: 18, manualKw: 120, autoKw: 101.5 }));
    for (const n of [1, 3]) expectClean(`missingPowerTip ${n}`, tips.missingPowerTip(n));
    expect(normalizeTip(tips.powerDiscrepancyTip({ pct: 18, manualKw: 120, autoKw: 101.5 })).rows[1].value).toMatch(/^101,5\s?kW$/);
  });

  it('systèmes', () => {
    expectClean('notConcernedChipTip', tips.notConcernedChipTip('Chauffage (Chaudière gaz)'));
    expectClean('notConcernedChipTip note', tips.notConcernedChipTip('Éclairage extérieur', true));
    expectClean('systemDevicesSummaryTip', tips.systemDevicesSummaryTip({ own: 3, shared: 1, kw: 125.5 }));
    expectClean('systemDevicesSummaryTip seul', tips.systemDevicesSummaryTip({ own: 1, shared: 0, kw: 0 }));
    // Résumé coupé dans l'en-tête de la carte : la bulle le reprend tel quel.
    const cut = tips.systemDevicesSummaryTip({ own: 0, shared: 2, kw: 0, summary: '2 équipements · partagés depuis une autre zone' });
    expectClean('systemDevicesSummaryTip résumé', cut);
    expect(cut.text.startsWith('2 équipements · partagés depuis une autre zone')).toBe(true);
    expect(tips.systemDevicesSummaryTip({ own: 1, summary: '1 équipement' }).text).toBe('');
    expectClean('createSystemDisabledTip', tips.createSystemDisabledTip({ hasCategory: false, hasName: false }));
    expect(tips.createSystemDisabledTip({ hasCategory: true, hasName: true })).toBeNull();
  });

  it('équipements', () => {
    for (const r of ['production', 'distribution', 'emission', 'regulation', 'autre', 'Pompe de relevage']) {
      expectClean(`roleTip ${r}`, tips.roleTip(r));
    }
    expect(tips.roleTip(null)).toBeNull();
    expectClean('deviceStatusTip incomplet', tips.deviceStatusTip(ALL_MISSING));
    expectClean('deviceStatusTip un seul', tips.deviceStatusTip(['l’énergie']));
    expectClean('deviceStatusTip complet', tips.deviceStatusTip([]));
    expectClean('deviceStatusTip forcé', tips.deviceStatusTip([], { forced: true }));
    expectClean('deviceStatusTip forcé + manquants', tips.deviceStatusTip(ALL_MISSING, { forced: true }));
    expectClean('deviceQuantityTip', tips.deviceQuantityTip(4));
    expectClean('deviceSharedTip', tips.deviceSharedTip('Bureaux RDC'));
    for (const n of [1, 3]) expectClean(`deviceAlsoInTip ${n}`, tips.deviceAlsoInTip(n));
    for (const s of ['not_applicable', 'unknown', 'empty']) {
      expectClean(`devicePowerCellTip ${s}`, tips.devicePowerCellTip(s));
      expectClean(`deviceEnergyCellTip ${s}`, tips.deviceEnergyCellTip(s));
    }
    expectClean('deviceProtocolsTip 1', tips.deviceProtocolsTip(['Modbus TCP']));
    expectClean('deviceProtocolsTip 3', tips.deviceProtocolsTip(['Modbus TCP', 'BACnet IP', 'KNX']));
    expect(tips.deviceProtocolsTip([])).toBeNull();
    for (const info of [{ none: true }, { label: 'Intégrée' }, { label: 'Déportée' }, { label: 'Oui' }]) {
      expectClean(`deviceRegulationTip ${info.label || 'aucune'}`, tips.deviceRegulationTip(info));
    }
    for (const category of ['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'electricity_production']) {
      expectClean(`devicePowerFieldTip ${category}`, tips.devicePowerFieldTip({ category }));
    }
    expectClean('devicePowerFieldTip inconnue', tips.devicePowerFieldTip({ category: 'heating', unknown: true }));
    for (const v of [null, false, true]) expectClean(`deviceProtocolsLockedTip ${v}`, tips.deviceProtocolsLockedTip(v));
    expectClean('addDeviceDisabledTip', tips.addDeviceDisabledTip(['un nom, une marque ou une référence', 'l’énergie primaire', 'la fonction', 'au moins un protocole']));
    expect(tips.addDeviceDisabledTip([])).toBeNull();
  });

  it('libellés des champs manquants (lib/audit-options.js) sans jargon', () => {
    expect(ALL_MISSING.length).toBeGreaterThan(8);
    for (const m of ALL_MISSING) expect({ m, problems: checkCopy(m) }).toEqual({ m, problems: [] });
  });

  it('tableau de présence', () => {
    expectClean('presenceCellTip présent', tips.presenceCellTip({ zone: 'Bureaux RDC', usage: 'Chauffage', category: 'heating', kind: 'single', state: true, count: 4, incomplete: 1 }));
    expectClean('presenceCellTip sans réponse', tips.presenceCellTip({ zone: 'Hall', usage: 'Eau chaude sanitaire', category: 'dhw', kind: 'single', state: null }));
    expectClean('presenceCellTip non concerné', tips.presenceCellTip({ zone: 'Hall', usage: 'Refroidissement', category: 'cooling', kind: 'single', state: false }));
    expectClean('presenceCellTip plusieurs', tips.presenceCellTip({ zone: 'Atelier', usage: 'Autres usages', category: '__other', kind: 'multi', systems: 2, count: 3, withoutDevice: 1, unanswered: 1 }));
    expectClean('presenceAddTip', tips.presenceAddTip({ zone: 'Chaufferie', usage: 'Ventilation', technical: true }));
    for (const n of [1, 4]) {
      expectClean(`presenceUnansweredTip ${n}`, tips.presenceUnansweredTip(n));
      expectClean(`presenceToFixTip ${n}`, tips.presenceToFixTip(n));
    }
  });

  it('GTB', () => {
    for (const level of ['essentials', 'smart', 'premium']) expectClean(`bmsLevelTip ${level}`, tips.bmsLevelTip(level));
    expect(tips.bmsLevelTip('inconnu')).toBeNull();
    for (const v of [null, false, true]) expectClean(`bmsMeterIntegratedTip ${v}`, tips.bmsMeterIntegratedTip(v));
    for (const kind of ['device', 'meter']) {
      for (const state of [
        { integrated: false },
        { integrated: true, outOfService: true },
        { integrated: true, wired: null },
        { integrated: true, wired: false },
        { integrated: true, wired: true },
      ]) {
        expectClean(`bmsOperationalTip ${kind} ${JSON.stringify(state)}`, tips.bmsOperationalTip({ kind, ...state }));
      }
    }
    for (const active of [true, false]) expectClean(`bmsUsageToggleLabel ${active}`, tips.bmsUsageToggleLabel(active));
  });

  it('cartes : pied du décret et accents', () => {
    expect(normalizeTip(tips.POWER_SUMMARY_TIPS.retained).meta).toBe('Décret BACS · article R175-2');
    expect(normalizeTip(tips.GRANULARITY_TIP).meta).toBe('Décret BACS · article R175-6');
    expect(normalizeTip(tips.presenceCellTip({ zone: 'Z', usage: 'Chauffage', category: 'heating', kind: 'single', state: true })).accent).toBe('heating');
    expect(tips.categoryAccent('lighting_outdoor')).toBe('lighting_outdoor');
    expect(tips.categoryAccent('custom:abc')).toBeNull();
    const st = normalizeTip(tips.deviceStatusTip(['l’énergie', 'hors service (oui ou non)']));
    expect(st.title).toBe('2 informations à compléter');
    expect(st.todo.items).toEqual(['L’énergie', 'Hors service (oui ou non)']);
  });
});
