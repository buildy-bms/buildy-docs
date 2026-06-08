// Tests unitaires de `_compliance-summary.js` — verdict R175 + evidence.
// Couvre les cas critiques identifiés sur les 4 audits prod (32, 40, 43, 45) :
//   - assujettissement R175-2 (2025 / 2030 / not_subject)
//   - verdict R175-3 quand GTB absente vs non qualifiée
//   - evidence kpis présents pour chaque axe quand données disponibles
//   - non-applicable R175-6 (bâtiment hors champ)
//
// Lot 6 du plan « Qualité du livrable PDF ». Lancé en CI avant tout tag.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildComplianceSummary, R175_EXIGENCES } = require('../src/routes/bacs-audit/_compliance-summary');

function makeDoc(over = {}) {
  return {
    bacs_total_power_kw: 100,
    bacs_applicability_status: 'subject_2030',
    bacs_building_permit_date: '2025-01-01',
    bacs_generator_works_date: null,
    ...over,
  };
}
function makeArgs(over = {}) {
  return {
    document: makeDoc(over.document),
    actionItems: { blocking: [], major: [], minor: [] },
    actionItemsRaw: [],
    bms: { present: 1 },
    r175_6_applicable: { applies: true, reason: '' },
    applicabilityLabel: null,
    devices: [],
    thermal: [],
    inspections: [],
    powerSummary: { effectiveKw: 100, autoHeatKw: 100, autoCoolKw: 0 },
    recapStats: { metersRequired: 0, metersPresent: 0, metersMissing: 0 },
    ...over,
  };
}

describe('buildComplianceSummary — assujettissement R175-2', () => {
  it('rapporte subject_2030 quand puissance entre 70 et 290 kW', () => {
    const c = buildComplianceSummary(makeArgs({
      document: makeDoc({ bacs_applicability_status: 'subject_2030', bacs_total_power_kw: 145 }),
    }));
    expect(c.assujettissement.status).toBe('subject_2030');
    expect(c.assujettissement.threshold).toBe(70);
    expect(c.assujettissement.conclusion).toMatch(/2030/);
  });

  it('rapporte subject_2025 quand puissance > 290 kW', () => {
    const c = buildComplianceSummary(makeArgs({
      document: makeDoc({ bacs_applicability_status: 'subject_2025', bacs_total_power_kw: 435 }),
    }));
    expect(c.assujettissement.status).toBe('subject_2025');
    expect(c.assujettissement.threshold).toBe(290);
  });

  it('rapporte not_subject quand puissance < 70 kW', () => {
    const c = buildComplianceSummary(makeArgs({
      document: makeDoc({ bacs_applicability_status: 'not_subject', bacs_total_power_kw: 50 }),
    }));
    expect(c.assujettissement.status).toBe('not_subject');
    expect(c.assujettissement.conclusion).toMatch(/non assujetti/i);
  });

  it('marque déterminable=false quand statut non renseigné', () => {
    const c = buildComplianceSummary(makeArgs({
      document: makeDoc({ bacs_applicability_status: null }),
    }));
    expect(c.assujettissement.determined).toBe(false);
    expect(c.assujettissement.thresholdLabel).toMatch(/70.*ou.*290/);
  });
});

describe('buildComplianceSummary — verdict R175 selon GTB', () => {
  it('verdict unknown quand bms.present == null sans actions', () => {
    const c = buildComplianceSummary(makeArgs({ bms: { present: null } }));
    expect(c.verdict).toBe('unknown');
    const row = c.r175Dashboard.find(r => r.axis === 'r175_3_3');
    expect(row.verdict).toBe('unknown');
  });

  it('verdict non_compliant sur tous les axes GTB-dépendants quand GTB absente', () => {
    const c = buildComplianceSummary(makeArgs({ bms: { present: 0 } }));
    const gtbAxes = ['r175_3_3', 'r175_3_4', 'r175_3_data', 'r175_4', 'r175_5'];
    for (const axis of gtbAxes) {
      const row = c.r175Dashboard.find(r => r.axis === axis);
      expect(row.verdict).toBe('non_compliant');
    }
  });

  it('verdict compliant possible quand GTB présente et aucune action bloquante', () => {
    const c = buildComplianceSummary(makeArgs({ bms: { present: 1 } }));
    expect(c.verdict).toBe('compliant');
  });
});

describe('buildComplianceSummary — evidence par axe', () => {
  it('renvoie evidence non-null pour R175-2 avec puissance', () => {
    const c = buildComplianceSummary(makeArgs());
    const row = c.r175Dashboard.find(r => r.axis === 'r175_2');
    expect(row.evidence).not.toBeNull();
    expect(row.evidence.kpis.length).toBeGreaterThan(0);
    expect(row.evidence.kpis.find(k => k.key === 'cumul_retained')).toBeTruthy();
  });

  it('R175-3 §1° expose le ratio compteurs requis/présents', () => {
    const c = buildComplianceSummary(makeArgs({
      recapStats: { metersRequired: 10, metersPresent: 7, metersMissing: 3 },
    }));
    const row = c.r175Dashboard.find(r => r.axis === 'r175_3_1');
    expect(row.evidence.kpis.find(k => k.key === 'meters_missing').value).toBe(3);
    expect(row.evidence.kpis.find(k => k.key === 'coverage').value).toBe(70);
  });

  it('R175-3 §3° distingue intégré / non intégré / non répondu', () => {
    const c = buildComplianceSummary(makeArgs({
      devices: [
        { id: 1, managed_by_bms: 1, out_of_service: 0 },
        { id: 2, managed_by_bms: 0, out_of_service: 0 },
        { id: 3, managed_by_bms: null, out_of_service: 0 },
      ],
    }));
    const row = c.r175Dashboard.find(r => r.axis === 'r175_3_3');
    expect(row.evidence.kpis.find(k => k.key === 'devices_integrated').value).toBe(1);
    expect(row.evidence.kpis.find(k => k.key === 'devices_not_integrated').value).toBe(1);
    expect(row.evidence.kpis.find(k => k.key === 'devices_unanswered').value).toBe(1);
  });

  it('R175-6 non applicable affiche explanation hors champ', () => {
    const c = buildComplianceSummary(makeArgs({
      r175_6_applicable: { applies: false, reason: 'PC < 21/07/2021' },
    }));
    const row = c.r175Dashboard.find(r => r.axis === 'r175_6');
    expect(row.verdict).toBe('na');
    expect(row.evidence.explanation).toMatch(/hors champ/i);
  });
});

describe('buildComplianceSummary — Lectures Buildy attachées', () => {
  it('attache au moins une Lecture Buildy sur chaque axe principal', () => {
    const c = buildComplianceSummary(makeArgs());
    for (const row of c.r175Dashboard) {
      if (row.axis === 'r175_4') continue; // R175-4 n'a pas de Lecture Buildy spécifique
      expect(row.buildy_readings, `axis ${row.axis} sans Lecture Buildy`).toBeDefined();
    }
  });
});

describe('R175_EXIGENCES — 8 axes ordonnés', () => {
  it('contient exactement les 8 axes attendus', () => {
    expect(R175_EXIGENCES.map(e => e.axis)).toEqual([
      'r175_2', 'r175_3_1', 'r175_3_3', 'r175_3_4', 'r175_3_data',
      'r175_4', 'r175_5', 'r175_6',
    ]);
  });
});
