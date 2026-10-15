// Étape Identification, mise en page « Nouvelle » (frontend/src/lib/identification-guide.js).
import { describe, it, expect } from 'vitest';
import { identificationRubrics, frenchDate, formatKw, IDENTIFICATION_RUBRICS } from '../../frontend/src/lib/identification-guide.js';

const doc = (over = {}) => ({ bacs_total_power_kw: 1200, bacs_building_permit_date: '2015-01-23', ...over });
const byKey = (list) => Object.fromEntries(list.map(r => [r.key, r]));

describe('rubriques de l’identification', () => {
  it('site rattaché et tout renseigné : 4 rubriques complètes, résumés en clair', () => {
    const list = identificationRubrics(doc(), { hasSite: true, structureLabel: 'Propriétaire occupant', partiesCount: 5, historyCount: 0 });
    expect(list.map(r => r.key)).toEqual(IDENTIFICATION_RUBRICS.map(r => r.key));
    expect(list.every(r => r.state === 'done')).toBe(true);
    const r = byKey(list);
    expect(r.applicability.summary).toBe('1\u202f200 kW · permis du 23 janvier 2015');
    expect(r.triggers.summary).toBe('Pas de travaux sur le générateur · pas de réseau urbain');
    expect(r.parties.summary).toBe('Propriétaire occupant · 5 parties prenantes');
    expect(r.history.summary).toBe('Aucune consommation saisie');
  });
  it('puissance ou permis manquant : « à compléter » (donnent le verdict)', () => {
    const r = byKey(identificationRubrics(doc({ bacs_total_power_kw: null, bacs_building_permit_date: null }), { hasSite: true, structureLabel: 'x' }));
    expect(r.applicability.missing).toEqual(['puissance de chauffage et de climatisation', 'date du permis de construire']);
    expect(r.applicability.state).toBe('todo');
  });
  it('une puissance de 0 kW est une réponse', () => {
    expect(byKey(identificationRubrics(doc({ bacs_total_power_kw: 0 }), {})).applicability.state).toBe('done');
  });
  it('structure juridique vide : « sans réponse »', () => {
    const r = byKey(identificationRubrics(doc(), { hasSite: true, structureLabel: '', partiesCount: 0 }));
    expect(r.parties).toMatchObject({ state: 'open', unanswered: ['structure de propriété'], summary: 'aucune partie prenante' });
  });
  it('travaux et réseau urbain', () => {
    const r = byKey(identificationRubrics(doc({ bacs_generator_works_date: '2022-03-01', bacs_district_heating_substation_kw: 450 }), {}));
    expect(r.triggers.summary).toBe('Travaux sur le générateur le 1er mars 2022 · réseau urbain (450 kW)');
  });
  it('sans site rattaché : ni parties prenantes ni consommations', () => {
    expect(identificationRubrics(doc(), { hasSite: false }).map(r => r.key)).toEqual(['applicability', 'triggers']);
  });
  it('formats', () => {
    expect(formatKw(1234.56)).toBe('1\u202f234,6 kW');
    expect(frenchDate('2025-01-01')).toBe('1er janvier 2025');
    expect(frenchDate('2015-01-23')).toBe('23 janvier 2015');
    expect(frenchDate('2015-01-11')).toBe('11 janvier 2015');
  });
  it('résumé : la puissance retenue par l’audit (celle du verdict), pas la valeur enregistrée', () => {
    // Audit #56 : calcul automatique, 949 kW enregistrés d'un ancien calcul, 1 002 kW retenus.
    const r = byKey(identificationRubrics(doc({ bacs_total_power_kw: 949 }), { retainedKw: 1002 }));
    expect(r.applicability.summary).toBe('1\u202f002 kW · permis du 23 janvier 2015');
    expect(byKey(identificationRubrics(doc({ bacs_total_power_kw: null }), { retainedKw: 80 })).applicability.state).toBe('done');
  });
});
