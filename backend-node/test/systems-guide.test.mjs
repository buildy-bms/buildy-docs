// Étape Systèmes, mise en page guidée (frontend/src/lib/systems-guide.js) : états « à compléter »
// / « à vérifier » / « sans réponse », compteurs par zone, parcours point par point.
import { describe, it, expect } from 'vitest';
import {
  indexChecks, systemGuide, zoneGuide, guideTotals, guideStops, nextStop, positionOf,
  missingSummary, zoneChecks, checkCells, MISSING_SHORT, MISSING_POWER_CODE, sortDevices,
  systemsStepTodo, deviceHomeId, loopMissing,
} from '../../frontend/src/lib/systems-guide.js';
import { deviceMissingFields, deviceMissingItems, isDeviceComplete, DEVICE_SECTIONS } from '../../frontend/src/lib/audit-options.js';

// Équipement complet (toutes les réponses Oui / Non données, énergie, communication, puissance).
const full = (over = {}) => ({
  name: 'Chaudière', device_role: ['production'], energy_source: 'gas', is_communicating: false,
  wired: false, meets_r175_3_p4: true, meets_r175_3_p4_autonomous: true, is_backup: false, out_of_service: false,
  has_regulation: false, serves_multiple_buildings: false, power_kw: 50,
  ...over,
});

function fixture() {
  const systems = [
    { id: 10, zone_id: 1, system_category: 'heating', is_bacs: 1, present: 1, not_concerned: 0 },
    { id: 11, zone_id: 1, system_category: 'cooling', is_bacs: 1, present: 1, not_concerned: 0 },
    { id: 12, zone_id: 1, system_category: 'dhw', is_bacs: 1, present: 0, not_concerned: 1 },
    { id: 13, zone_id: 1, system_category: 'ventilation', is_bacs: 1, present: 0, not_concerned: 0 },
    { id: 20, zone_id: 2, system_category: 'heating', is_bacs: 1, present: 1, not_concerned: 0 },
    { id: 21, zone_id: 2, system_category: 'lighting_indoor', is_bacs: 1, present: 1, not_concerned: 0 },
  ];
  const devices = [
    full({ id: 100, system_id: 10, name: 'Chaudière' }),
    full({ id: 101, system_id: 10, name: 'Radiateur', device_role: ['emission'], energy_source: null, wired: null }),
    full({ id: 110, system_id: 11, name: 'Split', device_role: ['production'], energy_source: 'electric' }),
    // Partagé depuis la zone 2 vers le chauffage de la zone 1 : compte dans la zone 2.
    full({ id: 200, system_id: 20, name: 'Pompe à chaleur', energy_source: 'electric', extra_system_ids: [10], is_backup: null }),
  ];
  const devicesBySystem = {};
  for (const d of devices) (devicesBySystem[d.system_id] ||= []).push(d);
  const groups = [
    { zone_id: 1, zone_name: 'Bureaux', items: systems.filter(s => s.zone_id === 1) },
    { zone_id: 2, zone_name: 'Atelier', items: systems.filter(s => s.zone_id === 2) },
  ];
  const precheck = {
    blocking: [],
    warnings: [
      { code: 'DEV-008', entity: 'device', entity_id: 110 },
      { code: 'DEV-002', entity: 'device', entity_id: 101 }, // manque pur : déjà « à compléter »
      { code: 'SYS-002', entity: 'system', entity_id: 21 },  // idem
      { code: 'SYS-003', entity: 'system', entity_id: null, system_category: 'heating' },
      { code: 'METER-001', entity: 'meter', entity_id: 5 },  // hors étape
    ],
  };
  return { systems, devices, devicesBySystem, groups, precheck };
}

describe('indexChecks', () => {
  it('garde les codes de l’étape, ignore les manques purs et les autres étapes', () => {
    const { precheck } = fixture();
    const idx = indexChecks(precheck, { missingPowerIds: [100] });
    expect([...idx.byDevice.keys()].sort()).toEqual([100, 110]);
    expect(idx.byDevice.get(100)[0].code).toBe(MISSING_POWER_CODE);
    expect(idx.bySystem.size).toBe(0);
    expect(idx.byCategory.get('heating')[0].code).toBe('SYS-003');
  });
  it('sans pré-contrôle : index vide', () => {
    const idx = indexChecks(null);
    expect(idx.byDevice.size + idx.bySystem.size + idx.byCategory.size).toBe(0);
  });
});

describe('systemGuide / zoneGuide', () => {
  const f = fixture();
  const ctx = { devicesBySystem: f.devicesBySystem, allDevices: f.devices, index: indexChecks(f.precheck, { missingPowerIds: [] }) };
  it('usage avec un équipement incomplet : « à compléter » (le partagé ne compte pas ici)', () => {
    const x = systemGuide(f.systems[0], ctx);
    expect(x.status).toBe('todo');
    expect(x.incomplete).toBe(1);
    expect(x.toComplete).toBe(1);
    expect(x.shared.map(e => e.device.id)).toEqual([200]);
    expect(x.devices.map(e => e.device.id)).toEqual([100, 101]); // production d'abord
  });
  it('usage avec un point du pré-contrôle : « à vérifier »', () => {
    const x = systemGuide(f.systems[1], ctx);
    expect(x.status).toBe('check');
    expect(x.toCheck).toBe(1);
  });
  it('non concerné, sans réponse', () => {
    expect(systemGuide(f.systems[2], ctx).status).toBe('not_concerned');
    expect(systemGuide(f.systems[3], ctx).status).toBe('unanswered');
  });
  it('présent sans équipement : « à compléter » (sans équipement)', () => {
    const x = systemGuide(f.systems[5], ctx);
    expect(x.status).toBe('empty');
    expect(x.toComplete).toBe(1);
  });
  it('règle des 5 % : seulement sur les usages exemptés de la catégorie', () => {
    const exempt = { ...f.systems[4], marked_negligible_under_5pct: 1 };
    expect(systemGuide(exempt, ctx).checks.map(c => c.code)).toEqual(['SYS-003']);
    expect(systemGuide(f.systems[4], ctx).checks).toEqual([]);
  });
  it('compteurs de zone et totaux', () => {
    const zones = f.groups.map(g => zoneGuide(g, ctx));
    expect(zones[0]).toMatchObject({ toComplete: 1, toCheck: 1, unanswered: 1, present: 2, done: 0 });
    // Zone 2 : la pompe à chaleur est incomplète (secours sans réponse), l'éclairage est vide.
    expect(zones[1]).toMatchObject({ toComplete: 2, toCheck: 0, unanswered: 0, present: 2, done: 0, emptySystems: 1 });
    expect(guideTotals(zones)).toMatchObject({ zones: 2, toComplete: 3, toCheck: 1, unanswered: 1 });
  });
  it('même comptage que l’ancienne mise en page (équipements incomplets des usages présents)', () => {
    const zones = f.groups.map(g => zoneGuide(g, ctx));
    expect(zones.map(z => z.incompleteDevices)).toEqual([1, 1]);
  });
});

describe('parcours point par point', () => {
  const f = fixture();
  const ctx = { devicesBySystem: f.devicesBySystem, allDevices: f.devices, index: indexChecks(f.precheck) };
  const zones = f.groups.map(g => zoneGuide(g, ctx));
  const stops = guideStops(zones);
  it('dans l’ordre de l’écran : zone, usage, équipements', () => {
    expect(stops.map(s => `${s.kind}:${s.deviceId ?? s.systemId}:${s.reason}`)).toEqual([
      'device:101:complete', 'device:110:check', 'system:13:unanswered', 'device:200:complete', 'system:21:empty',
    ]);
  });
  it('suivant après un équipement, puis zone suivante, puis retour au premier point restant', () => {
    expect(nextStop(stops, zones, { systemId: 10, deviceId: 101 }).deviceId).toBe(110);
    expect(nextStop(stops, zones, { systemId: 13 }).deviceId).toBe(200);
    expect(nextStop(stops, zones, { systemId: 21 }).deviceId).toBe(101);
  });
  it('position d’un équipement déjà repris : le point situé juste après', () => {
    expect(nextStop(stops, zones, { systemId: 10, deviceId: 100 }).deviceId).toBe(101);
    expect(positionOf(zones, { systemId: 10, deviceId: 100 })).toEqual([0, 0, 0]);
  });
  it('sans position : le premier point ; plus rien : null', () => {
    expect(nextStop(stops, zones, null).deviceId).toBe(101);
    expect(nextStop([], zones, null)).toBeNull();
  });
});

describe('lignes « reste à faire »', () => {
  const f = fixture();
  const ctx = { devicesBySystem: f.devicesBySystem, allDevices: f.devices, index: indexChecks(f.precheck) };
  it('réponses manquantes : libellés courts', () => {
    const z = zoneGuide(f.groups[0], ctx);
    expect(missingSummary(z)).toEqual({ answers: 1, devices: 1, labels: ['liaison câblée à la GTB'] });
  });
  it('points à vérifier de la zone, cases du tableau de présence', () => {
    const zones = f.groups.map(g => zoneGuide(g, ctx));
    expect(zoneChecks(zones[0]).map(c => `${c.kind}:${c.device?.id}:${c.finding.code}`)).toEqual(['device:110:DEV-008']);
    expect([...checkCells(zones)]).toEqual(['1:cooling']);
  });
  it('chaque manque de la fiche a son libellé court (non-dérive avec deviceMissingFields)', () => {
    const blank = { device_role: ['production'], is_communicating: true, extra_system_ids: [1] };
    const labels = [
      ...deviceMissingFields(blank, 'heating'),
      ...deviceMissingFields({ device_role: [] }, 'heating'),
    ];
    for (const l of labels) expect({ l, short: MISSING_SHORT[l] }).toEqual({ l, short: expect.any(String) });
    expect(labels.length).toBeGreaterThanOrEqual(10);
  });
  it('tri : production, distribution, émission, régulation, puis nom', () => {
    const list = sortDevices([
      { name: 'b', device_role: ['emission'] }, { name: 'a', device_role: ['regulation'] },
      { name: 'z', device_role: ['production'] }, { name: 'c', device_role: [] },
    ]);
    expect(list.map(d => d.name)).toEqual(['z', 'b', 'a', 'c']);
  });
});

describe('complétude d’un équipement : chaque question affichée a sa réponse', () => {
  const keys = (d, cat = 'heating') => deviceMissingItems(d, cat).map(m => m.key);
  it('l’équipement de référence est complet', () => {
    expect(deviceMissingItems(full(), 'heating')).toEqual([]);
    expect(isDeviceComplete(full(), 'heating')).toBe(true);
  });
  it('« dispose d’une régulation ? » sans réponse : à compléter (bug signalé par Kévin)', () => {
    expect(keys(full({ has_regulation: null }))).toEqual(['has_regulation']);
    expect(isDeviceComplete(full({ has_regulation: null }), 'heating')).toBe(false);
  });
  it('régulation « Oui » : intégrée ou déportée, puis le type de chaque fonction', () => {
    const d = full({ has_regulation: true, device_role: ['production', 'distribution', 'emission', 'regulation'] });
    expect(keys(d)).toEqual(['regulation_integrated', 'regulation_type_production', 'regulation_type_distribution', 'regulation_type_emission']);
    const done = { ...d, regulation_integrated: false, regulation_type_production: 'x', regulation_type_distribution: 'y', regulation_type_emission: 'z' };
    expect(keys(done)).toEqual([]);
    // Régulation « Non » : rien de plus.
    expect(keys(full({ has_regulation: false, device_role: ['emission'] }))).toEqual([]);
  });
  it('« dessert plusieurs bâtiments ? » sans réponse : à compléter', () => {
    expect(keys(full({ serves_multiple_buildings: null }))).toEqual(['serves_multiple_buildings']);
  });
  it('puissance d’une production de chauffage ou de froid (seuil des 70 kW)', () => {
    expect(keys(full({ power_kw: null }))).toEqual(['power']);
    expect(keys(full({ power_kw: 0 }), 'cooling')).toEqual(['power']);
    expect(keys(full({ power_kw: null, power_kw_cooling: 12 }), 'cooling')).toEqual([]);
    expect(keys(full({ power_kw: null, power_kw_unknown: 1 }))).toEqual([]);
    // Hors cumul : secours, hors service, « hors cumul », autres usages, autres fonctions.
    expect(keys(full({ power_kw: null, is_backup: true }))).toEqual([]);
    expect(keys(full({ power_kw: null, out_of_service: true }))).toEqual([]);
    expect(keys(full({ power_kw: null, power_calculation_type: 'out_of_scope' }))).toEqual([]);
    expect(keys(full({ power_kw: null }), 'ventilation')).toEqual([]);
    expect(keys(full({ power_kw: null, device_role: ['emission'], energy_source: null }))).toEqual([]);
  });
  it('fonction exigée partout sauf en production photovoltaïque', () => {
    for (const cat of ['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'process']) {
      expect({ cat, keys: keys(full({ device_role: [] }), cat) }).toEqual({ cat, keys: ['roles'] });
    }
    // PV : fonctions, énergie et comptage séparable masqués par la fiche, donc pas exigés.
    expect(keys(full({ device_role: [], energy_source: null, extra_system_ids: [3] }), 'electricity_production')).toEqual([]);
    expect(keys(full({ device_role: ['production'], energy_source: null }), 'electricity_production')).toEqual([]);
  });
  it('équipement hors du périmètre de la GTB : ses questions de raccordement ne sont pas exigées', () => {
    const d = full({ gtb_scope_override: false, wired: null, meets_r175_3_p4: null, meets_r175_3_p4_autonomous: null });
    expect(keys(d)).toEqual([]);
    expect(keys({ ...d, gtb_scope_override: null })).toEqual(['wired', 'manual_stop', 'autonomous']);
  });
  it('chaque manque est rangé dans une rubrique de la fiche, dans l’ordre de la fiche', () => {
    const blank = { device_role: ['production', 'emission'], is_communicating: true, extra_system_ids: [1], has_regulation: true };
    const items = deviceMissingItems(blank, 'heating');
    const order = items.map(m => DEVICE_SECTIONS.indexOf(m.section));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(items.map(m => m.section))).toEqual(new Set(DEVICE_SECTIONS));
  });
  it('chaque nouveau manque a son libellé court', () => {
    const blank = { device_role: ['production', 'distribution', 'emission'], is_communicating: true, extra_system_ids: [1], has_regulation: true };
    const labels = [...deviceMissingFields(blank, 'heating'), ...deviceMissingFields({ device_role: [] }, 'ventilation')];
    for (const l of labels) expect({ l, short: MISSING_SHORT[l] }).toEqual({ l, short: expect.any(String) });
  });
});

describe('bouclage de l’eau chaude, équipements partagés, bandeau de l’étape', () => {
  const sys = (over) => ({ is_bacs: 1, present: 1, not_concerned: 0, ...over });
  it('eau chaude présente sans réponse au bouclage : à compléter et point du parcours', () => {
    const ecs = sys({ id: 30, zone_id: 1, system_category: 'dhw', is_looped: null });
    const dev = full({ id: 300, system_id: 30, device_role: ['production'], energy_source: 'electric' });
    const ctx = { devicesBySystem: { 30: [dev] }, allDevices: [dev], index: indexChecks(null) };
    const x = systemGuide(ecs, ctx);
    expect(loopMissing(ecs)).toBe(true);
    expect(x).toMatchObject({ status: 'todo', loopMissing: true, toComplete: 1, incomplete: 0 });
    const z = zoneGuide({ zone_id: 1, zone_name: 'Bureaux', items: [ecs] }, ctx);
    expect(z.loops).toBe(1);
    expect(guideStops([z]).map(s => `${s.kind}:${s.reason}`)).toEqual(['system:loop']);
    expect(systemGuide({ ...ecs, is_looped: 'unknown' }, ctx).status).toBe('done');
    expect(loopMissing({ ...ecs, present: 0, not_concerned: 1 })).toBe(false);
  });
  it('équipement partagé dont l’usage d’origine n’est pas présent : compte dans le premier usage présent qui le partage', () => {
    const origin = sys({ id: 40, zone_id: 1, system_category: 'heating', present: 0, not_concerned: 1 });
    const target = sys({ id: 41, zone_id: 2, system_category: 'heating' });
    const dev = full({ id: 400, system_id: 40, extra_system_ids: [41], is_backup: null });
    const systemsById = new Map([[40, origin], [41, target]]);
    expect(deviceHomeId(dev, systemsById)).toBe(41);
    const ctx = { devicesBySystem: { 40: [dev] }, allDevices: [dev], index: indexChecks(null), systemsById };
    const x = systemGuide(target, ctx);
    expect(x).toMatchObject({ status: 'todo', incomplete: 1, toComplete: 1 });
    expect(x.shared[0].countsHere).toBe(true);
    // Sans le contexte des usages : comportement d'avant (le partagé ne compte pas ici).
    expect(systemGuide(target, { ...ctx, systemsById: null }).incomplete).toBe(0);
  });
  it('puissance manquante : « à compléter » seulement (le point « à vérifier » du cumul est retiré)', () => {
    const heat = sys({ id: 50, zone_id: 1, system_category: 'heating' });
    const dev = full({ id: 500, system_id: 50, power_kw: null });
    const ctx = { devicesBySystem: { 50: [dev] }, allDevices: [dev], index: indexChecks(null, { missingPowerIds: [500] }) };
    const x = systemGuide(heat, ctx);
    expect(x).toMatchObject({ status: 'todo', incomplete: 1, toCheck: 0 });
    // Production de ventilation sans puissance : pas exigée, reste « à vérifier ».
    const vent = sys({ id: 51, zone_id: 1, system_category: 'ventilation' });
    const dv = full({ id: 510, system_id: 51, power_kw: null });
    const cv = { devicesBySystem: { 51: [dv] }, allDevices: [dv], index: indexChecks(null, { missingPowerIds: [510] }) };
    expect(systemGuide(vent, cv)).toMatchObject({ status: 'check', incomplete: 0, toCheck: 1 });
  });
  it('bandeau de l’étape : mêmes règles que le guide (à vérifier ne bloque pas)', () => {
    const systems = [
      sys({ id: 60, system_category: 'heating' }),
      sys({ id: 61, system_category: 'cooling', present: 0, not_concerned: 0 }), // sans réponse
      sys({ id: 62, system_category: 'lighting_indoor' }),                      // présent sans équipement
      sys({ id: 63, system_category: 'dhw', is_looped: null }),                 // bouclage manquant
      sys({ id: 64, system_category: 'ventilation', present: 0, not_concerned: 1 }),
    ];
    const devices = [
      full({ id: 600, system_id: 60, has_regulation: null }),                   // incomplet
      full({ id: 630, system_id: 63, device_role: ['production'], energy_source: 'electric' }),
      full({ id: 640, system_id: 64, has_regulation: null }),                   // usage non concerné : pas audité
    ];
    expect(systemsStepTodo(systems, devices)).toEqual({ unanswered: 1, empty: 1, loops: 1, incompleteDevices: 1 });
    const fixed = systems.map(s => ({ ...s, present: 1, not_concerned: 0, is_looped: s.system_category === 'dhw' ? 'looped' : s.is_looped }));
    const allDevs = [...devices.map(d => ({ ...d, has_regulation: false })),
      full({ id: 610, system_id: 61 }), full({ id: 620, system_id: 62, device_role: ['emission'], energy_source: null })];
    expect(systemsStepTodo(fixed, allDevs)).toEqual({ unanswered: 0, empty: 0, loops: 0, incompleteDevices: 0 });
  });
});
