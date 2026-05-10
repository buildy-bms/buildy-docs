// Tests du composable frontend `useDeviceRoleFilter` (ESM pure, aucune
// dépendance Vue). Le composable est l'équivalent côté navigateur de
// backend-node/src/lib/device-roles.js — on valide ici qu'il reste cohérent
// avec le serveur (même format JSON multi-rôles depuis mig 117) et que la
// logique de tri 3-buckets (pertinent / sans rôle / incompatible) est stable.
import { describe, it, expect } from 'vitest';
import {
  parseRoles,
  rankDeviceForRole,
  filterAndSortByRole,
} from '../../frontend/src/composables/useDeviceRoleFilter.js';

describe('parseRoles', () => {
  it('null / undefined / vide → []', () => {
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles('')).toEqual([]);
    expect(parseRoles('[]')).toEqual([]);
  });

  it('scalaire string toléré', () => {
    expect(parseRoles('production')).toEqual(['production']);
  });

  it('JSON array string', () => {
    expect(parseRoles('["production","distribution"]')).toEqual([
      'production',
      'distribution',
    ]);
  });

  it('Array natif', () => {
    expect(parseRoles(['production', 'emission'])).toEqual([
      'production',
      'emission',
    ]);
  });

  it('élimine les espaces et entrées vides', () => {
    expect(parseRoles(['production', '', '  ', 'distribution']))
      .toEqual(['production', 'distribution']);
    expect(parseRoles('  ')).toEqual([]);
  });

  it('JSON malformé fallback en scalaire', () => {
    expect(parseRoles('[oops')).toEqual(['[oops']);
  });
});

describe('rankDeviceForRole', () => {
  it('rôle pertinent → rank 0', () => {
    expect(rankDeviceForRole({ device_role: '["production"]' }, 'production'))
      .toBe(0);
  });

  it('rôle multi-valué dont un correspond → rank 0', () => {
    expect(
      rankDeviceForRole(
        { device_role: '["production","distribution"]' },
        'distribution'
      )
    ).toBe(0);
  });

  it('match case-insensitive', () => {
    expect(rankDeviceForRole({ device_role: '["PRODUCTION"]' }, 'production'))
      .toBe(0);
    expect(rankDeviceForRole({ device_role: '["production"]' }, 'PRODUCTION'))
      .toBe(0);
  });

  it('aucun rôle assigné → rank 1 (bucket neutre)', () => {
    expect(rankDeviceForRole({ device_role: null }, 'production')).toBe(1);
    expect(rankDeviceForRole({ device_role: '' }, 'production')).toBe(1);
    expect(rankDeviceForRole({ device_role: '[]' }, 'production')).toBe(1);
    expect(rankDeviceForRole({}, 'production')).toBe(1);
  });

  it('rôle incompatible → rank 2 (masqué)', () => {
    expect(rankDeviceForRole({ device_role: '["distribution"]' }, 'production'))
      .toBe(2);
  });
});

describe('filterAndSortByRole', () => {
  const devices = [
    { id: 1, name: 'Sans rôle', device_role: null },
    { id: 2, name: 'Production', device_role: '["production"]' },
    { id: 3, name: 'Distribution', device_role: '["distribution"]' },
    { id: 4, name: 'Mixte', device_role: '["production","distribution"]' },
    { id: 5, name: 'Régulation', device_role: '["regulation"]' },
  ];

  it('met les pertinents en tête, neutres en bas, masque les incompatibles', () => {
    const ids = filterAndSortByRole(devices, 'production').map(d => d.id);
    // Bucket 0 (production + mixte), bucket 1 (sans rôle). Distribution et
    // Régulation sont masquées (bucket 2).
    expect(ids.slice(0, 2).sort()).toEqual([2, 4]);
    expect(ids[2]).toBe(1);
    expect(ids).toHaveLength(3);
  });

  it('régulation masque les équipements process', () => {
    const ids = filterAndSortByRole(devices, 'regulation').map(d => d.id);
    expect(ids[0]).toBe(5); // bucket 0
    expect(ids).toContain(1); // bucket 1 (neutre)
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
  });

  it('liste vide → liste vide (pas de crash)', () => {
    expect(filterAndSortByRole([], 'production')).toEqual([]);
    expect(filterAndSortByRole(null, 'production')).toEqual([]);
    expect(filterAndSortByRole(undefined, 'production')).toEqual([]);
  });
});
