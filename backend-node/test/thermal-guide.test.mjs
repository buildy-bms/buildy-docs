// Étape Régulation, mise en page « Nouvelle » (frontend/src/lib/thermal-guide.js) : verdict de
// chaque système, aligné sur le plan d'actions (R175-6 : conformité jugée sur l'émission).
import { describe, it, expect } from 'vitest';
import { thermalRowGuide, thermalTotals } from '../../frontend/src/lib/thermal-guide.js';

const prod = { regulation_type_production: 'loi_d_eau' };
const dist = { regulation_type_distribution: 'vanne_3_voies' };
const emit = (over = {}) => ({ regulation_type_emission: 'thermostat_ambiant', has_regulation: 1, ...over });
const row = (over = {}) => ({ category: 'heating', emission_device_id: 3, ...over });
const devices = (over = {}) => ({ production: prod, distribution: dist, emission: emit(), ...over });

describe('verdict d’un système de régulation', () => {
  it('régulation par pièce : conforme, rien à faire', () => {
    const g = thermalRowGuide(row(), { devices: devices(), granularity: 'per_room' });
    expect(g).toEqual({ missing: [], unanswered: [], verdict: { tone: 'green', text: 'Par pièce' }, state: 'done' });
  });
  it('par zone : conforme', () => {
    expect(thermalRowGuide(row(), { devices: devices(), granularity: 'per_zone' }).verdict.text).toBe('Par zone');
  });
  it('centralisée : non conforme', () => {
    const g = thermalRowGuide(row(), { devices: devices({ emission: emit({ regulation_type_emission: 'sonde_retour' }) }), granularity: 'central_only' });
    expect(g.verdict).toEqual({ tone: 'red', text: 'Centralisée : non conforme' });
    expect(g.state).toBe('ko');
  });
  it('sans émetteur : « à compléter » (bloque l’étape)', () => {
    const g = thermalRowGuide(row({ emission_device_id: null }), { devices: devices({ emission: null }) });
    expect(g.missing).toEqual(['émetteur']);
    expect(g.state).toBe('todo');
    expect(g.verdict.text).toBe('Émetteur à indiquer');
  });
  it('émetteur sans régulation renseignée : pas de conclusion, comme le plan', () => {
    const e = { has_regulation: null };
    const g = thermalRowGuide(row(), { devices: devices({ emission: e }), granularity: 'central_only' });
    expect(g.verdict.tone).toBe('amber');
    expect(g.state).toBe('open');
  });
  it('émetteur déclaré sans régulation : centralisée, non conforme (comme le plan)', () => {
    const g = thermalRowGuide(row(), { devices: devices({ emission: { has_regulation: 0 } }), granularity: 'central_only' });
    expect(g.state).toBe('ko');
  });
  it('froid : décrit, jamais « non conforme »', () => {
    const g = thermalRowGuide(row({ category: 'cooling' }), { devices: devices(), granularity: 'central_only' });
    expect(g.verdict.tone).toBe('slate');
    expect(g.state).toBe('done');
  });
  it('chauffage au bois : dispensé, rien n’est exigé', () => {
    const g = thermalRowGuide(row({ emission_device_id: null }), { devices: { production: prod }, woodExempt: true });
    expect(g.missing).toEqual([]);
    expect(g.verdict.tone).toBe('green');
  });
  it('types de régulation manquants : « sans réponse », sans bloquer', () => {
    const g = thermalRowGuide(row(), { devices: devices({ production: {}, distribution: {} }), granularity: 'per_room' });
    expect(g.unanswered).toEqual(['type de régulation (production)', 'type de régulation (distribution)']);
    expect(g.missing).toEqual([]);
    expect(g.state).toBe('open');
  });
  it('équipement de production absent : « sans réponse »', () => {
    expect(thermalRowGuide(row(), { devices: devices({ production: null }), granularity: 'per_room' }).unanswered)
      .toEqual(['équipement de production']);
  });
  it('totaux', () => {
    const list = [
      thermalRowGuide(row(), { devices: devices(), granularity: 'per_room' }),
      thermalRowGuide(row({ emission_device_id: null }), { devices: devices({ emission: null }) }),
      thermalRowGuide(row(), { devices: devices(), granularity: 'central_only' }),
    ];
    expect(thermalTotals(list)).toEqual({ count: 3, todo: 1, ko: 1, open: 0 });
  });
});
