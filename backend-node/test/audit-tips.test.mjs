// Contenus des infobulles de l'audit (frontend/src/lib/audit-tips.js, meter-plan-state.js,
// audit-steps-ui.js) : règles de rédaction de Kévin (français simple, tutoiement, pas
// d'article du décret dans le texte, pas de « (s) »…) vérifiées sur TOUS les textes produits,
// et toutes les icônes citées sont enregistrées.
import { describe, it, expect } from 'vitest';
import * as tips from '../../frontend/src/lib/audit-tips.js';
import { meterPlanNote } from '../../frontend/src/lib/meter-plan-state.js';
import { AUDIT_STEP_OBJECTIVES } from '../../frontend/src/lib/audit-steps-ui.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';
import { wantedIconNames } from '../../frontend/scripts/gen-tooltip-icons.mjs';
import { TOOLTIP_ICON_NAMES } from '../../frontend/src/lib/tooltip-icons.js';

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

const STEP = {
  number: 5,
  label: 'Compteurs',
  objective: AUDIT_STEP_OBJECTIVES.meters,
  incompleteReasons: ["aucun compteur n'a été pointé présent ou absent"],
  validated_at: '2026-10-12 08:15:00',
  validated_by_name: 'Julien Desmaris',
  blocking: true,
};

describe('audit-tips : règles de rédaction', () => {
  it('constantes', () => {
    for (const [name, v] of Object.entries(tips)) {
      if (typeof v === 'function' || name === 'AUDIT_TIP_ICONS') continue;
      expectClean(name, v);
    }
  });

  it('fonctions, avec des valeurs typiques', () => {
    expectClean('stepTip todo', tips.stepTip(STEP, 'equipment'));
    expectClean('stepTip prête', tips.stepTip({ ...STEP, incompleteReasons: [], complete: true }, 'equipment'));
    expectClean('stepTip validée', tips.stepTip({ ...STEP, validated: true, with_pending: true }, 'equipment'));
    expectClean('stepTip sans objet', tips.stepTip({ ...STEP, disabled: true, disabledReason: 'Sans objet : il n’y a pas de GTB.' }));
    expectClean('phaseTip', tips.phaseTip({ key: 'site', label: 'Site' }));
    expectClean('stepNotValidableTip', tips.stepNotValidableTip(STEP));
    for (const n of [1, 3]) {
      expectClean('metersMissingTip', tips.metersMissingTip(n));
      expectClean('metersUnansweredTip', tips.metersUnansweredTip(n));
      expectClean('metersPresentTip', tips.metersPresentTip(n));
      expectClean('metersCommunicatingTip', tips.metersCommunicatingTip(n));
    }
    expectClean('energyTabTip', tips.energyTabTip({ value: 'electric', label: 'Électrique', total: 4, present: 2, missing: 1, unanswered: 1 }));
    expect(tips.energyTabTip({ value: 'electric', label: 'Électrique', total: 4, present: 2 }).title).toBe('Compteurs électriques');
    expect(tips.energyTabTip({ value: 'gas', label: 'Gaz', total: 0 }).label).toMatch(/^Aucun compteur de gaz/);
    expectClean('energyTabTip vide', tips.energyTabTip({ label: 'Gaz', total: 0 }));
    expectClean('thermalMeterTip', tips.thermalMeterTip('Calorimètre', 'heating'));
    expectClean('thermalMeterTip froid', tips.thermalMeterTip('Frigorimètre', 'cooling'));
    expectClean('meterDragTip', tips.meterDragTip(false));
    expectClean('meterDragTip actif', tips.meterDragTip(true));
  });

  it('notes du plan de comptage (couvert, commun, non exigé)', () => {
    const plan = {
      1: { status: 'covered', group: 'Circulation X + Lot bureau X' },
      2: { status: 'lead', group: 'Circulation X + Lot bureau X' },
      3: { status: 'not_required', reason: 'exempt_5pct' },
      4: { status: 'not_required', reason: 'excluded_by_auditor' },
    };
    for (const id of [1, 2, 3, 4]) {
      const note = meterPlanNote({ id }, plan);
      expectClean(`meterPlanNote ${id}`, note.tooltip);
      expect(checkCopy(note.text)).toEqual([]);
      expect(checkCopy(note.label, { label: true })).toEqual([]);
    }
  });

  it('objectifs des étapes (texte visible) sans jargon', () => {
    for (const [k, v] of Object.entries(AUDIT_STEP_OBJECTIVES)) {
      expect({ k, problems: checkCopy(v) }).toEqual({ k, problems: [] });
    }
  });

  it('carte d’étape : objectif, état, reste à faire', () => {
    const t = normalizeTip(tips.stepTip(STEP, 'equipment'));
    expect(t.kind).toBe('card');
    expect(t.title).toBe('5. Compteurs');
    expect(t.accent).toBe('equipment');
    expect(t.todo.items[0]).toMatch(/^Aucun compteur/);
    const v = normalizeTip(tips.stepTip({ ...STEP, validated: true }, 'equipment'));
    expect(v.rows[0].label).toBe('Validée');
    expect(v.rows[0].value).toMatch(/Julien Desmaris/);
  });
});

describe('icônes', () => {
  it('toutes les icônes citées dans src/ sont enregistrées (node scripts/gen-tooltip-icons.mjs)', () => {
    const missing = wantedIconNames().filter((n) => !TOOLTIP_ICON_NAMES.has(n));
    expect(missing).toEqual([]);
  });
});
