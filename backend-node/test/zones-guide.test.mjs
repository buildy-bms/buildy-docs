// Étape Zones, mise en page « Nouvelle » (frontend/src/lib/zones-guide.js).
import { describe, it, expect } from 'vitest';
import { zoneMissing, groupZones, zoneGroupTotals, zonesTodoLine } from '../../frontend/src/lib/zones-guide.js';

const fz = (over = {}) => ({ kind: 'functional', nature: 'bureaux', occupancy_profile: 'office_hours', surface_m2: 100, ...over });
const tz = (over = {}) => ({ kind: 'technical', nature: 'local_technique', ...over });

describe('zones', () => {
  it('zone fonctionnelle complète : rien ne manque', () => {
    expect(zoneMissing(fz())).toEqual([]);
  });
  it('zone fonctionnelle : nature, régime et surface attendus', () => {
    expect(zoneMissing(fz({ nature: null, occupancy_profile: null, surface_m2: null })))
      .toEqual(['nature', 'régime d’activité', 'surface']);
  });
  it('une surface de 0 est une réponse', () => {
    expect(zoneMissing(fz({ surface_m2: 0 }))).toEqual([]);
  });
  it('local technique : seule la nature est attendue', () => {
    expect(zoneMissing(tz({ occupancy_profile: null, surface_m2: null }))).toEqual([]);
    expect(zoneMissing(tz({ nature: null }))).toEqual(['nature']);
  });
  it('zone sans type : traitée comme fonctionnelle', () => {
    expect(zoneMissing({ nature: 'x' })).toEqual(['régime d’activité', 'surface']);
  });
  it('groupes : fonctionnelles puis techniques, ordre conservé', () => {
    const zones = [tz({ id: 1 }), fz({ id: 2 }), tz({ id: 3 }), fz({ id: 4 })];
    expect(groupZones(zones).map(z => z.id)).toEqual([2, 4, 1, 3]);
  });
  it('totaux et ligne « reste à faire »', () => {
    expect(zoneGroupTotals([fz(), fz({ surface_m2: 50, nature: null })])).toEqual({ count: 2, surface: 150, todo: 1 });
    expect(zonesTodoLine(1)).toBe('1 zone à compléter : nature, régime d’activité ou surface manquants.');
  });
});
