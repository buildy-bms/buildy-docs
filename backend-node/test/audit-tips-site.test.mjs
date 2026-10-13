// Contenus des infobulles de l'audit, lot « site, zones, régulation, dossier, plan d'actions »
// (frontend/src/lib/audit-tips-site.js) : règles de rédaction de Kévin (français simple,
// tutoiement, pas d'article du décret dans le texte, pas de « (s) »…) vérifiées sur TOUS les
// textes produits, avec des valeurs typiques ; toutes les icônes citées existent dans
// free-solid et figurent dans AUDIT_SITE_TIP_ICONS.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as tips from '../../frontend/src/lib/audit-tips-site.js';
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

describe('audit-tips-site : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || name === 'AUDIT_SITE_TIP_ICONS') continue;
      expectClean(name, v);
    }
  });

  it('identification : puissance, verdict, régulation pièce par pièce', () => {
    for (const status of ['subject_immediate', 'subject_2025', 'subject_2030', 'not_subject']) {
      const t = tips.applicabilityTip(status);
      expectClean(`applicabilityTip ${status}`, t);
      expect(normalizeTip(t).kind).toBe('card');
    }
    expectClean('applicabilityTip présumé', tips.applicabilityTip('subject_2030', { presumed: true }));
    expect(tips.applicabilityTip(null)).toBeNull();
    expectClean('powerDeviceTip compté', tips.powerDeviceTip({
      name: 'Chaudière gaz', system_category: 'heating', zone_name: 'Bureaux', power_kw: 120.5, quantity: 2, in_scope: true,
    }));
    expectClean('powerDeviceTip exclu', tips.powerDeviceTip({
      name: 'Ventilo-convecteur', system_category: 'cooling', zone_name: 'Open-space', power_kw: 4, in_scope: false,
      exclusion_reason_label: 'émetteur — puissance déjà comptée sur la production amont',
    }));
    expect(normalizeTip(tips.powerDeviceTip({ system_category: 'heating', power_kw: 12.5 })).rows[0].value).toBe('12,5 kW');
    for (const c of ['heating', 'cooling']) expectClean(`powerCategoryLabel ${c}`, tips.powerCategoryLabel(c));
    expectClean('thermalTriggerTip oui', tips.thermalTriggerTip({ applies: true, permitDate: '2022-03-01', worksDate: '2023-05-12' }));
    expectClean('thermalTriggerTip non', tips.thermalTriggerTip({ applies: false, permitDate: null, worksDate: '2019-05-12' }));
  });

  it('zones et parties prenantes', () => {
    expectClean('zoneLegendTip', tips.zoneLegendTip('B'));
    expectClean('comfortConstraintTip vide', tips.comfortConstraintTip(''));
    expectClean('comfortConstraintTip rempli', tips.comfortConstraintTip('Température minimale 19 °C imposée par le bail'));
  });

  it('régulation pièce par pièce', () => {
    for (const level of ['production', 'distribution', 'emission']) {
      expectClean(`thermalNoteTip vide ${level}`, tips.thermalNoteTip(level, ''));
      expectClean(`thermalNoteTip ${level}`, tips.thermalNoteTip(level, 'Sonde d’ambiance à déplacer, trop près de la fenêtre.'));
    }
    expect(normalizeTip(tips.thermalNoteTip('emission', '')).label).toBe('Ajouter une note sur l’émission');
    expect(tips.granularityTip({ key: 'per_room', category: 'heating' })).toBeNull();
    expectClean('granularityTip centralisée', tips.granularityTip({ key: 'central_only', category: 'heating' }));
    expectClean('granularityTip froid', tips.granularityTip({ key: 'central_only', category: 'cooling' }));
    expectClean('granularityTip libre', tips.granularityTip({ key: 'Par étage', label: 'Par étage', category: 'heating' }));
    expectClean('granularityTip sans émetteur', tips.granularityTip({ key: 'central_only', category: 'heating', hasEmitter: false }));
    expectClean('thermalSystemLinkTip', tips.thermalSystemLinkTip('Chaufferie gaz'));
    expectClean('deportedRegulationTip complet', tips.deportedRegulationTip({ brand: 'Siemens', reference: 'RDG160T', location: 'Couloir R+1' }));
    expectClean('deportedRegulationTip vide', tips.deportedRegulationTip({}));
  });

  it('check-list, inspections', () => {
    for (const kind of ['zones', 'systems', 'meters', 'bms']) {
      expectClean(`coverageTileTip ${kind} vide`, tips.coverageTileTip(kind, { total: 0, covered: 0 }));
      expectClean(`coverageTileTip ${kind} partiel`, tips.coverageTileTip(kind, { total: 5, covered: 2 }));
      expectClean(`coverageTileTip ${kind} complet`, tips.coverageTileTip(kind, { total: 3, covered: 3 }));
    }
    for (const tone of ['red', 'amber', 'emerald']) {
      expectClean(`inspectionStatusTip ${tone}`, tips.inspectionStatusTip(tone, '2027-03-15'));
    }
    expectClean('nextInspectionLabel', tips.nextInspectionLabel('2031-10-12'));
    expect(tips.nextInspectionLabel(null)).toBeNull();
  });

  it('plan d’actions', () => {
    for (const it of [{ severity: 'blocking' }, { severity: 'major' }, { severity: 'minor' }, { is_reserve: 1 }, { is_info: 1 }]) {
      expectClean('levelTip', tips.levelTip(it));
    }
    for (const level of ['blocking', 'major', 'minor', 'reserve', 'info']) {
      expectClean(`levelCountTip ${level} 1`, tips.levelCountTip(level, 1));
      expectClean(`levelCountTip ${level} 3`, tips.levelCountTip(level, 3));
    }
    expect(normalizeTip(tips.levelCountTip('blocking', 3)).title).toBe('3 actions bloquantes');
    expectClean('actionNumberTip', tips.actionNumberTip('BACS-007'));
    for (const code of ['R175-3 1°', 'R175-3 dernier alinéa', 'R175-6 II 1°', 'R175-2 II', 'R175-5-1', 'R175-4', 'Article libre']) {
      const t = tips.articleTip(code);
      expectClean(`articleTip ${code}`, t);
      expect(normalizeTip(t).meta).toMatch(/^Décret BACS · article /);
    }
    expect(normalizeTip(tips.articleTip('R175-6 II 2°')).title).toBe('Réguler la température pièce par pièce');
    expect(tips.articleTip(null)).toBeNull();
    for (const p of [{ has: true }, { has: false, open: true }, { has: false, open: false }]) {
      expectClean('preconisationTip', tips.preconisationTip(p));
    }
  });

  it('synthèse, documents, accès', () => {
    expectClean('claudeUsageTip vide', tips.claudeUsageTip(null));
    expectClean('claudeUsageTip', tips.claudeUsageTip({
      avg_cost_eur: 0.0123, cost_eur: 1.5, requests: 4, month_cost_eur: 0.8, monthly_budget_eur: 20, remaining_eur: 19.2,
    }));
    expect(normalizeTip(tips.claudeUsageTip({ avg_cost_eur: 0.0123, cost_eur: 1.5, requests: 1 })).rows[0].value).toBe('≈ 0,012 €');
    expectClean('exifTip', tips.exifTip({
      taken_at: '2026-10-12T10:15:00', camera_make: 'Apple', camera_model: 'iPhone 15', gps_latitude: 45.764, gps_longitude: -4.8357,
    }));
    expect(tips.exifTip({})).toBeNull();
    expectClean('attachmentTip site', tips.attachmentTip({ kind: 'Site', label: '' }));
    expectClean('attachmentTip zone', tips.attachmentTip({ kind: 'Zone', label: 'Bureaux R+1' }));
  });

  it('dates lisibles, jamais brutes', () => {
    expect(tips.longDate('2026-10-12')).toBe('12 octobre 2026');
    expect(tips.longDate('')).toBe('');
    expect(tips.longDate('pas une date')).toBe('');
    expect(tips.longDateTime('2026-10-12T10:15:00')).toMatch(/^12 oct\. 2026 à 10:15$/);
    expect(tips.fmtKw(12.25)).toBe('12,3 kW');
  });
});

describe('icônes', () => {
  it('chaque icône citée existe dans free-solid et figure dans AUDIT_SITE_TIP_ICONS', () => {
    const listed = new Set(tips.AUDIT_SITE_TIP_ICONS);
    const missingFa = [...listed].filter((n) => !free[exportName(n)]);
    expect(missingFa).toEqual([]);
    const used = new Set();
    for (const v of Object.values(tips)) if (v && typeof v === 'object') icons(v, used);
    for (const v of seen) icons(v, used);
    const unlisted = [...used].filter((n) => !listed.has(n));
    expect(unlisted).toEqual([]);
  });
});
