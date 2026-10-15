// Pré-remplissage de l'étape Régulation depuis les équipements (frontend/src/lib/thermal-prefill.js).
// Bug du 2026-10-15 (Sénas) : l'unité extérieure d'un DRV, à régulation intégrée, était proposée
// comme « régulateur déporté » des trois niveaux → PATCH refusé (400) par la vérification de
// cohérence du serveur, « Erreur de sauvegarde ».
import { describe, it, expect } from 'vitest';
import { buildPrefillPatch, bestDeviceForLevel } from '../../frontend/src/lib/thermal-prefill.js';

const UE = { id: 203, device_role: ['production', 'regulation'], has_regulation: 1, regulation_integrated: 1, power_kw: 37 };
const UI = { id: 204, device_role: ['emission', 'regulation'], has_regulation: 1, regulation_integrated: 0 };
const REG = { id: 300, device_role: ['regulation'], has_regulation: 1, regulation_integrated: null };
const PUMP = { id: 301, device_role: ['distribution'] };
const row = (extra = {}) => ({ id: 1, system_id: 10, generator_device_id: null, distribution_device_id: null, emission_device_id: null, ...extra });
const devicesOf = (list) => () => list;

describe('Pré-remplissage de la régulation', () => {
  it('ne propose jamais un équipement à régulation intégrée ni un équipement de production / émission comme régulateur', () => {
    expect(bestDeviceForLevel([UE, UI], 'regulation')).toBeNull();
    const patch = buildPrefillPatch(row({ generator_device_id: 203, emission_device_id: 204 }), devicesOf([UE, UI]));
    expect(patch).toBeNull(); // cas de Sénas : rien de valide à remplir, plus d'erreur de sauvegarde
  });

  it('propose un régulateur dédié, pour les seuls niveaux qui ont un équipement', () => {
    const patch = buildPrefillPatch(row(), devicesOf([UE, UI, REG]));
    expect(patch).toEqual({
      generator_device_id: 203,
      emission_device_id: 204,
      production_regulation_device_id: 300,
      emission_regulation_device_id: 300,
    });
    expect(patch).not.toHaveProperty('distribution_regulation_device_id');
  });

  it('remplit la distribution quand elle a un équipement, sans écraser une saisie existante', () => {
    const patch = buildPrefillPatch(row({ generator_device_id: 203, production_regulation_device_id: 999 }), devicesOf([UE, PUMP, REG]));
    expect(patch).toEqual({ distribution_device_id: 301, distribution_regulation_device_id: 300 });
  });
});
