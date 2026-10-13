// Contenus des infobulles du cadre de l'audit (frontend/src/lib/audit-tips-shell.js) : règles de
// rédaction de Kévin (français simple, tutoiement, pas d'article du décret dans le texte, pas de
// « (s) », pas d'anglais…) vérifiées sur TOUS les textes produits avec des valeurs typiques, et
// dates lisibles (jamais une date brute de la base).
import { describe, it, expect } from 'vitest';
import * as tips from '../../frontend/src/lib/audit-tips-shell.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

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
  }
  expect(normalizeTip(value) !== undefined).toBe(true);
}

// La typographie automatique (typo) pose des espaces insécables : on les aplatit pour comparer.
const flat = (s) => String(s).replace(/\u00a0/g, ' ');

const DB_DATE = '2026-10-12 08:15:00'; // CURRENT_TIMESTAMP de SQLite : UTC sans fuseau
const ISO_DATE = '2026-10-12T08:15:00.000Z';
const STEP = {
  key: 'meters',
  label: 'Compteurs',
  complete: false,
  blocking: true,
  incompleteReasons: ["aucun compteur n'a été pointé présent ou absent"],
};
const NEXT = { key: 'bms', label: 'GTB', number: 6 };

describe('audit-tips-shell : dates', () => {
  it('une date de la base (UTC sans fuseau) vaut la même date ISO', () => {
    expect(tips.parseDbDate(DB_DATE).getTime()).toBe(new Date(ISO_DATE).getTime());
    expect(tips.parseDbDate(ISO_DATE).getTime()).toBe(new Date(ISO_DATE).getTime());
    expect(tips.parseDbDate('n’importe quoi')).toBeNull();
    expect(tips.parseDbDate(null)).toBeNull();
  });

  it('date lisible, jamais brute', () => {
    const s = tips.formatDateTime(DB_DATE);
    expect(s).toMatch(/^\d{1,2} oct\. 2026 à \d{2}:\d{2}$/);
    expect(tips.formatDateTime('')).toBe('');
    const label = normalizeTip(tips.modifiedTip(DB_DATE)).label;
    expect(label).toMatch(/^Modifié le \d{1,2} oct\. 2026 à \d{2}:\d{2}$/);
    expect(label).not.toMatch(/2026-10-12|08:15:00/);
    expect(tips.modifiedTip(null)).toBeNull();
  });
});

describe('audit-tips-shell : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || /ICONS$/.test(name)) continue;
      expectClean(name, v);
    }
  });

  it('en-tête et barre d’outils', () => {
    expectClean('modifiedTip', tips.modifiedTip(DB_DATE));
    expectClean('auditTitleTip entier', tips.auditTitleTip('Audit BACS — STEF - Le SEVEN', false));
    expectClean('auditTitleTip coupé', tips.auditTitleTip('Audit BACS — STEF - Le SEVEN', true));
    expect(tips.auditTitleTip('Audit BACS — STEF - Le SEVEN', true).rows[0].value).toBe('Audit BACS — STEF - Le SEVEN');
    expect(tips.auditTitleTip('', true)).toBe('Renommer cet audit');
    expectClean('deliveredTip', tips.deliveredTip(ISO_DATE));
    expectClean('deliveredTip sans date', tips.deliveredTip(null));
    for (const sev of ['blocking', 'major', 'minor']) {
      for (const n of [0, 1, 3]) expectClean(`openActionsTip ${sev} ${n}`, tips.openActionsTip(sev, n));
      expectClean(`severityCountTip ${sev}`, tips.severityCountTip(sev));
    }
    expectClean('saveStatusTip saving 1', tips.saveStatusTip('saving', { inflight: 1 }));
    expectClean('saveStatusTip saving 3', tips.saveStatusTip('saving', { inflight: 3 }));
    expectClean('saveStatusTip error', tips.saveStatusTip('error'));
    expectClean('saveStatusTip saved', tips.saveStatusTip('saved', { lastSavedAt: new Date(ISO_DATE) }));
    for (const busy of [false, true]) {
      expectClean(`reportTip ${busy}`, tips.reportTip(busy));
      expectClean(`tablesTip ${busy}`, tips.tablesTip(busy));
      expectClean(`deliverTip ${busy}`, tips.deliverTip(busy));
      expectClean(`dossierTip ${busy}`, tips.dossierTip(busy));
    }
    expectClean('deliverTip déjà livré', tips.deliverTip(false, ISO_DATE));
  });

  it('étapes : pied, badge, ancien stepper', () => {
    expectClean('skipStepTip', tips.skipStepTip(NEXT));
    expectClean('validateAndContinueTip bloquée', tips.validateAndContinueTip(STEP, NEXT));
    expectClean('validateAndContinueTip complète', tips.validateAndContinueTip({ ...STEP, complete: true, incompleteReasons: [] }, NEXT));
    expectClean('validateAndContinueTip non bloquante', tips.validateAndContinueTip({ ...STEP, blocking: false }, NEXT));
    expectClean('validateAndContinueTip dernière', tips.validateAndContinueTip({ ...STEP, complete: true, incompleteReasons: [] }, null));
    expectClean('validateBadgeTip validée', tips.validateBadgeTip({ ...STEP, validated: true, validated_at: ISO_DATE, validated_by_name: 'Julien Desmaris' }));
    expectClean('validateBadgeTip complète', tips.validateBadgeTip({ ...STEP, complete: true }));
    expectClean('validateBadgeTip bloquée', tips.validateBadgeTip(STEP));
    expectClean('validateBadgeTip non bloquante', tips.validateBadgeTip({ ...STEP, blocking: false }));
    const desc = 'Compteurs attendus passés en revue : présents, absents ou en panne.';
    expectClean('stepperStepTip', tips.stepperStepTip({ ...STEP, description: desc }, 4));
    expectClean('stepperStepTip validée', tips.stepperStepTip({ ...STEP, description: desc, validated: true }, 4, 'bottom'));
  });

  it('plan d’actions, historique, photos, notes vocales, transcription, Claude', () => {
    for (const a of ['R175-3 1°', 'R175-3 §2', 'R175-6', 'R175-99']) expectClean(`decreeArticleTip ${a}`, tips.decreeArticleTip(a));
    for (const k of Object.keys(tips.AUDIT_TRAIL_TIPS)) expectClean(`auditTrailTip ${k}`, tips.auditTrailTip(k));
    expect(tips.auditTrailTip('af.update')).toBeNull();
    expectClean('activityDateTip', tips.activityDateTip(DB_DATE));
    for (const n of [0, 4]) {
      expectClean(`photoButtonTip ${n}`, tips.photoButtonTip('Chaudière gaz 1', n));
      expectClean(`voiceButtonTip ${n}`, tips.voiceButtonTip('GTB', n));
    }
    expectClean('photoButtonTip sans libellé', tips.photoButtonTip('', 2));
    const photo = { title: 'Armoire électrique', taken_at: ISO_DATE, camera_make: 'Apple', camera_model: 'iPhone 13', gps_latitude: 48.8566, gps_longitude: 2.3522 };
    expectClean('photoInfoTip', tips.photoInfoTip(photo));
    expect(tips.photoInfoTip({ title: 'Sans EXIF' })).toBeNull();
    expect(flat(normalizeTip(tips.photoInfoTip(photo)).rows.find((r) => r.label === 'Position').value)).toBe('48,85660° N, 2,35220° E');
    expect(tips.photoDateText({ taken_at: ISO_DATE })).toMatch(/^Prise le /);
    expect(tips.photoDateText({ uploaded_at: DB_DATE })).toMatch(/^Envoyée le /);
    for (const c of [0.35, 0.9]) expectClean(`confidenceTip ${c}`, tips.confidenceTip(c));
    expect(tips.confidenceTip(null)).toBeNull();
    expectClean('claudeUsageTip chargement', tips.claudeUsageTip(null));
    const usage = { requests: 12, cost_eur: 0.42, avg_cost_eur: 0.035, month_cost_eur: 0.31, monthly_budget_eur: 20, remaining_eur: 19.69 };
    expectClean('claudeUsageTip', tips.claudeUsageTip(usage));
    expectClean('claudeUsageTip sans budget', tips.claudeUsageTip({ ...usage, monthly_budget_eur: null, remaining_eur: null }));
  });
});

describe('audit-tips-shell : formes attendues', () => {
  it('pastille de l’en-tête : titre au pluriel, à traiter dans le plan', () => {
    const t = normalizeTip(tips.openActionsTip('blocking', 3));
    expect(t.kind).toBe('card');
    expect(t.title).toBe('3 actions bloquantes ouvertes');
    expect(t.tone).toBe('error');
    expect(normalizeTip(tips.openActionsTip('minor', 1)).title).toBe('1 action mineure ouverte');
    expect(normalizeTip(tips.openActionsTip('major', 0)).todo).toBeNull();
  });

  it('article du décret : en clair dans le texte, en pied seulement', () => {
    const t = normalizeTip(tips.decreeArticleTip('R175-3 1°'));
    expect(t.title).toBe('Suivre les consommations');
    expect(t.meta).toMatch(/Décret BACS · article R175-3 1°/);
  });

  it('coût de Claude : virgule décimale, pas de ligne fourre-tout', () => {
    const t = normalizeTip(tips.claudeUsageTip({ requests: 1, cost_eur: 0.42, avg_cost_eur: 0.012 }));
    expect(t.kind).toBe('card');
    expect(t.rows.map((r) => r.value).join(' ')).toMatch(/0,012/);
    expect(t.rows.map((r) => r.value).join(' ')).not.toMatch(/0\.012/);
    expect(t.rows.find((r) => r.label === '30 derniers jours').value).toMatch(/1 demande$/);
  });

  it('pied d’étape : bloquée → ce qui manque ; sinon valider et ouvrir la suivante', () => {
    const blocked = normalizeTip(tips.validateAndContinueTip(STEP, NEXT));
    expect(blocked.title).toBe('Pas encore validable');
    expect(blocked.todo.items[0]).toMatch(/^Aucun compteur/);
    const ok = normalizeTip(tips.validateAndContinueTip({ ...STEP, complete: true, incompleteReasons: [] }, NEXT));
    expect(flat(ok.blocks[0].text)).toMatch(/« GTB »/);
  });
});
