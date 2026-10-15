// Questions sans réponse qui bloquent la validation des étapes (frontend/src/lib/step-unanswered.js).
import { describe, it, expect } from 'vitest';
import {
  identificationUnansweredReasons, zonesUnansweredReasons, thermalStepTodo, metersUnansweredReasons,
  bmsUnansweredReasonsFor, inspectionsUnansweredReasons,
} from '../../frontend/src/lib/step-unanswered.js';
import { bmsStepRubrics, bmsDeviceInScope, bmsManagesMeterUsage, bmsIsBuildySupervision } from '../../frontend/src/lib/bms-guide.js';
import { thermalGuideForRow } from '../../frontend/src/lib/thermal-guide.js';
import { IDENT_OWNERSHIP_REASON, bmsUnansweredReasons, thermalTodoLine } from '../../frontend/src/lib/audit-tips-guided.js';

const doc = { bacs_total_power_kw: 400, bacs_building_permit_date: '2015-01-23' };

describe('Identification', () => {
  it('audit BACS, site rattaché, structure de propriété vide : bloque', () => {
    expect(identificationUnansweredReasons(doc, { isBacs: true, hasSite: true, structureLabel: '' })).toEqual([IDENT_OWNERSHIP_REASON]);
  });
  it('structure renseignée, audit de site ou pas de site : rien', () => {
    expect(identificationUnansweredReasons(doc, { isBacs: true, hasSite: true, structureLabel: 'Propriétaire occupant' })).toEqual([]);
    expect(identificationUnansweredReasons(doc, { isBacs: false, hasSite: true, structureLabel: '' })).toEqual([]);
    expect(identificationUnansweredReasons(doc, { isBacs: true, hasSite: false, structureLabel: '' })).toEqual([]);
  });
});

describe('Zones', () => {
  it('compte les zones à compléter (local technique : la nature seule)', () => {
    const zones = [
      { nature: 'bureaux', occupancy_profile: 'office', surface_m2: 600 },
      { nature: 'bureaux', occupancy_profile: null, surface_m2: 600 },
      { kind: 'technical', nature: 'chaufferie' },
      { kind: 'technical', nature: null },
    ];
    expect(zonesUnansweredReasons(zones)).toEqual(['2 zones à compléter : nature, régime d’activité ou surface manquants']);
    expect(zonesUnansweredReasons([zones[0], zones[2]])).toEqual([]);
  });
});

describe('Régulation', () => {
  const prod = { id: 1, regulation_type_production: 'loi_eau' };
  const emit = { id: 3, regulation_type_emission: 'thermostat', regulation_granularity: 'per_room' };
  const row = (over = {}) => ({ id: 10, category: 'heating', generator_device_id: 1, emission_device_id: 3, ...over });
  it('ligne complète : rien', () => {
    expect(thermalStepTodo([row()], () => [prod, emit])).toEqual({ missingRows: [], openCount: 0, reasons: [] });
  });
  it('sans émetteur : « à compléter » (règle existante) ; type de régulation vide : sans réponse, bloque aussi', () => {
    const t = thermalStepTodo([row({ id: 1, emission_device_id: null }), row({ id: 2 })], () => [{ id: 1 }, emit]);
    expect(t.missingRows.map(r => r.id)).toEqual([1]);
    expect(t.openCount).toBe(1);
    expect(t.reasons).toEqual(['1 système à préciser : équipement de production ou type de régulation']);
  });
  it('générateur au bois : dispensé d’émetteur, comme l’affiche l’étape', () => {
    const g = thermalGuideForRow(row({ emission_device_id: null }), [{ ...prod, energy_source: 'wood' }]);
    expect(g.missing).toEqual([]);
    expect(g.verdict.text).toBe('Dispensé : chauffage au bois');
  });
  it('équipements cherchés par leur id, granularité de l’émetteur', () => {
    const g = thermalGuideForRow(row(), [emit, prod]);
    expect(g.verdict.text).toBe('Par pièce');
  });
  it('encadré : émetteurs manquants et systèmes à préciser', () => {
    expect(thermalTodoLine(2, 3)).toBe('2 systèmes sans émetteur et 3 à préciser (équipement de production ou type de régulation).');
    expect(thermalTodoLine(0, 1)).toBe('1 système à préciser : équipement de production ou type de régulation.');
  });
});

describe('Compteurs', () => {
  it('compteurs requis sans réponse à « Présent ? » (compteurs non exigés exclus)', () => {
    const meters = [
      { id: 1, required: 1, present_actual: null },
      { id: 2, required: 1, present_actual: null },
      { id: 3, required: 1, present_actual: 0 },
      { id: 4, required: 0, present_actual: null },
    ];
    expect(metersUnansweredReasons(meters, { 2: { status: 'covered' } })).toEqual(['1 compteur attendu sans réponse à « Présent ? »']);
    expect(metersUnansweredReasons(meters.slice(2), {})).toEqual([]);
  });
});

describe('GTB', () => {
  const bms = {
    present: 1, existing_solution: 'Buildy', is_buildy_supervision: 1, buildy_offer_level: 'essentials',
    provided_protocols: '["bacnet_ip"]', out_of_service: 0, manages_heating: 1,
    meets_r175_3_p1: 1, r175_3_p1_retention_verified: 1, meets_r175_3_p2: 0,
    data_provision_to_manager: 1, data_provision_to_operators: 1,
    data_storage_5y_compliant: 'yes', data_owner_access: 'yes', gestionnaire_exploitant_access: 'yes',
    export_capability: 'yes', data_storage_location: 'cloud_editeur',
    has_maintenance_procedures: 0, operator_trained: 1,
  };
  const ctx = { isBacs: true, afStatus: 'absent', afDocsCount: 0, devicesWithMeta: [], metersPresent: [] };
  it('tout répondu : rien', () => {
    expect(bmsUnansweredReasonsFor(bms, ctx)).toEqual([]);
  });
  it('questions sans réponse, rubrique par rubrique', () => {
    const r = bmsUnansweredReasonsFor({ ...bms, operator_trained: null }, { ...ctx, afStatus: 'present', afDocsCount: 0 });
    expect(r).toEqual([
      '« Analyse fonctionnelle » : document à déposer',
      '« Vérifications et formation de l’exploitant » : formation de l’exploitant',
    ]);
  });
  it('plus de trois rubriques : une ligne qui les nomme', () => {
    const r = bmsUnansweredReasonsFor({ ...bms, provided_protocols: '[]', operator_trained: null, export_capability: null, meets_r175_3_p2: null },
      { ...ctx, afStatus: null });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^5 questions sans réponse dans 5 rubriques : Partage des données, Analyse fonctionnelle, /);
  });
  it('GTB hors service : rubriques facultatives exclues', () => {
    expect(bmsUnansweredReasonsFor({ ...bms, out_of_service: 1, operator_trained: null, meets_r175_3_p1: null }, ctx)).toEqual([]);
  });
  it('pas de GTB, ou présence non indiquée : rien de plus (la règle existante s’en charge)', () => {
    expect(bmsUnansweredReasonsFor({ present: 0 }, ctx)).toEqual([]);
    expect(bmsUnansweredReasonsFor({ present: null }, ctx)).toEqual([]);
  });
  it('périmètre : équipements des usages traités (ou forcés), compteurs suivis', () => {
    expect(bmsDeviceInScope(bms, { system_category: 'heating' })).toBe(true);
    expect(bmsDeviceInScope(bms, { system_category: 'cooling' })).toBe(false);
    expect(bmsDeviceInScope(bms, { system_category: 'cooling', gtb_scope_override: 1 })).toBe(true);
    expect(bmsDeviceInScope(bms, { system_category: 'heating', gtb_scope_override: 0 })).toBe(false);
    expect(bmsManagesMeterUsage(bms, 'other')).toBe(true);
    expect(bmsManagesMeterUsage(bms, 'lighting')).toBe(false);
    const rub = bmsStepRubrics(bms, { ...ctx,
      devicesWithMeta: [{ system_category: 'heating', managed_by_bms: null }, { system_category: 'cooling', managed_by_bms: null }],
      metersPresent: [{ usage: 'heating', communicating: 1, managed_by_bms: null }, { usage: 'lighting', communicating: 1, managed_by_bms: null }] });
    expect(rub.find(r => r.key === 'integrated').unanswered).toEqual(['1 équipement : intégré ?', '1 compteur : intégré ?']);
  });
  it('supervision Buildy : un niveau choisi vaut Oui', () => {
    expect(bmsIsBuildySupervision({ is_buildy_supervision: null, buildy_offer_level: 'smart' })).toBe(true);
    expect(bmsIsBuildySupervision({ is_buildy_supervision: 0, buildy_offer_level: 'smart' })).toBe(false);
    expect(bmsIsBuildySupervision({})).toBe(null);
  });
  it('lignes : rien sans question', () => {
    expect(bmsUnansweredReasons([{ title: 'X', unanswered: [] }])).toEqual([]);
  });
});

describe('Inspections', () => {
  it('inspections sans date autres que la plus récente ; rien sur « Non »', () => {
    const list = [{ last_inspection_date: null }, { last_inspection_date: '2020-01-01' }, { last_inspection_date: null }];
    expect(inspectionsUnansweredReasons(list, false)).toEqual(['1 inspection sans date : indique la date ou supprime-la']);
    expect(inspectionsUnansweredReasons(list, true)).toEqual([]);
    expect(inspectionsUnansweredReasons([{ last_inspection_date: null }], false)).toEqual([]);
  });
});
