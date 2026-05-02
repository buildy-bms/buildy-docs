import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildAuditRefs, STEPS } = require('../src/lib/bacs-audit-refs');

describe('bacs-audit-refs — buildAuditRefs', () => {
  it('numerote les zones par position croissante', () => {
    const r = buildAuditRefs({
      zones: [
        { zone_id: 5, position: 1 },
        { zone_id: 3, position: 0 },
      ],
    });
    expect(r.zones.get(3).ref).toBe('2.Z01');
    expect(r.zones.get(5).ref).toBe('2.Z02');
  });

  it('numerote les systemes dans l\'ordre des categories puis id', () => {
    const r = buildAuditRefs({
      zones: [{ zone_id: 1, position: 0 }],
      systems: [
        { id: 20, zone_id: 1, system_category: 'cooling' },
        { id: 10, zone_id: 1, system_category: 'heating' },
        { id: 30, zone_id: 1, system_category: 'ventilation' },
      ],
    });
    expect(r.systems.get(10).ref).toBe('3.Z01.01');
    expect(r.systems.get(20).ref).toBe('3.Z01.02');
    expect(r.systems.get(30).ref).toBe('3.Z01.03');
  });

  it('numerote les devices sous leur systeme parent', () => {
    const r = buildAuditRefs({
      zones: [{ zone_id: 1, position: 0 }],
      systems: [{ id: 10, zone_id: 1, system_category: 'heating' }],
      devices: [
        { id: 100, system_id: 10, position: 1 },
        { id: 101, system_id: 10, position: 0 },
      ],
    });
    expect(r.devices.get(101).ref).toBe('3.Z01.01.01');
    expect(r.devices.get(100).ref).toBe('3.Z01.01.02');
  });

  it('compteurs zonals et generaux ont des prefixes differents', () => {
    const r = buildAuditRefs({
      zones: [{ zone_id: 1, position: 0 }],
      meters: [
        { id: 200, zone_id: 1, usage: 'heating' },
        { id: 201, zone_id: null, usage: 'other' },
      ],
    });
    expect(r.meters.get(200).ref).toBe('4.Z01.01');
    expect(r.meters.get(201).ref).toBe('4.G.01');
  });

  it('regulation thermique : 1 ref par zone', () => {
    const r = buildAuditRefs({
      zones: [{ zone_id: 1, position: 0 }, { zone_id: 2, position: 1 }],
      thermal: [
        { id: 300, zone_id: 1 },
        { id: 301, zone_id: 2 },
      ],
    });
    expect(r.thermal.get(300).ref).toBe('5.Z01');
    expect(r.thermal.get(301).ref).toBe('5.Z02');
  });

  it('STEPS expose les indices de chaque etape du wizard', () => {
    expect(STEPS.zones).toBe(2);
    expect(STEPS.systems).toBe(3);
    expect(STEPS.meters).toBe(4);
    expect(STEPS.thermal).toBe(5);
    expect(STEPS.bms).toBe(6);
    expect(STEPS.inspections).toBe(7);
  });

  it('renvoie des Maps vides si pas de donnees', () => {
    const r = buildAuditRefs({});
    expect(r.zones.size).toBe(0);
    expect(r.systems.size).toBe(0);
    expect(r.devices.size).toBe(0);
    expect(r.meters.size).toBe(0);
    expect(r.thermal.size).toBe(0);
  });
});
