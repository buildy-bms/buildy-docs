// Plan d'actions lisible hors de l'audit : repères {{zone|system|device:id}}
// remplacés par les libellés (PDF, vue commerciale, CSV), numérotation
// BACS-xxx partagée, et fichier CSV lisible dans Excel réglé en français.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { makePlainTagResolver } = require('../src/routes/bacs-audit/_action-tags');
const { numberActionItems } = require('../src/routes/bacs-audit/_action-numbering');
const { buildActionItemsCsv } = require('../src/routes/bacs-audit/_actions-csv');

const resolver = makePlainTagResolver({
  zones: [{ id: 103, name: 'Atelier' }],
  systems: [
    { id: 7566, system_category: 'heating', zone_name: 'Atelier' },
    { id: 7567, system_category: 'ventilation', custom_label: 'CTA toiture', zone_name: null },
  ],
  devices: [
    { id: 1, name: 'Chaudière gaz' },
    { id: 2, name: null, brand: 'Daikin', model_reference: 'VRV IV' },
  ],
});

describe('makePlainTagResolver', () => {
  it('remplace les repères par les libellés', () => {
    expect(resolver.strip('Raccorder {{system:7566}} ({{zone:103}}) au BACS'))
      .toBe('Raccorder chauffage · Atelier (Atelier) au BACS');
    expect(resolver.strip('Arrêt manuel : {{device:1}}, {{device:2}}'))
      .toBe('Arrêt manuel : Chaudière gaz, Daikin VRV IV');
  });

  it('libellé personnalisé prioritaire, zone facultative', () => {
    expect(resolver.label('system', 7567)).toBe('CTA toiture');
    expect(resolver.label('system', '7566')).toBe('chauffage · Atelier');
  });

  it('élément supprimé : repli lisible (identique au PDF historique)', () => {
    expect(resolver.label('zone', 9)).toBe('Zone #9');
    expect(resolver.label('system', 9)).toBe('Système #9');
    expect(resolver.label('device', 9)).toBe('Équipement 9');
  });

  it('texte vide ou absent inchangé', () => {
    expect(resolver.strip(null)).toBe(null);
    expect(resolver.strip('')).toBe('');
    expect(resolver.strip('Sans repère')).toBe('Sans repère');
  });
});

const action = (over) => ({
  id: 1, category: 'meter_addition', severity: 'major', status: 'open',
  r175_article: 'R175-3 1°', title: 'Titre', description: null, position: 0,
  zone_name: null, equipment_name: null, estimated_effort: null, source_subtype: null,
  ...over,
});

describe('numberActionItems', () => {
  it('numérote seulement les actions visibles, réserves comprises', () => {
    const out = numberActionItems([
      action({ id: 1 }),
      action({ id: 2, status: 'done' }),
      action({ id: 3, status: 'declined' }),
      action({ id: 4, source_subtype: 'negligible_5pct' }),
      action({ id: 5, source_subtype: 'maintenance', category: 'documentation', severity: 'minor' }),
      action({ id: 6 }),
    ]);
    const byId = Object.fromEntries(out.map(a => [a.id, a]));
    expect(byId[2].display_number).toBe(null);
    expect(byId[3].display_number).toBe(null);
    expect(byId[4].display_number).toBe(null);
    expect(byId[4].is_info).toBe(true);
    expect(byId[5].is_reserve).toBe(true);
    const numbers = out.map(a => a.display_number).filter(Boolean);
    expect(numbers).toEqual(['BACS-001', 'BACS-002', 'BACS-003']);
  });
});

describe('buildActionItemsCsv', () => {
  const csv = buildActionItemsCsv(numberActionItems([
    action({
      id: 1, severity: 'blocking', estimated_effort: 'medium',
      title: 'Raccorder {{system:7566}} au BACS',
      description: 'Constat\n- Compteur absent ; à poser\nPrix "à définir"',
      zone_name: 'Atelier',
    }),
    action({ id: 2, status: 'done', title: '=1+1' }),
    action({ id: 3, source_subtype: 'no_inspection', category: 'documentation', severity: 'minor' }),
  ]), resolver.strip);
  const lines = csv.slice(1).split('\r\n');

  it('BOM UTF-8, séparateur « ; », fins de ligne CRLF', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('N°;Type;Gravité;Article;Catégorie;Titre;Description;Zone;Équipement;Statut;Effort');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('libellés en français, repères remplacés, numéros identiques à l\'écran', () => {
    // Ordre canonique des cartes (numberActionItems) : la réserve
    // « documentation » passe avant l'action compteur.
    expect(csv).toMatch(/\r\nBACS-00\d;Action;Bloquante;R175-3 1°;Ajout de compteur;Raccorder chauffage · Atelier au BACS;/);
    expect(csv).toContain(';Atelier;;Ouverte;Moyen');
    expect(csv).toMatch(/\r\nBACS-00\d;Réserve;Mineure;/);
    // Action terminée : dans le fichier, sans numéro (comme à l'écran).
    expect(csv).toMatch(/\r\n;Action;Majeure;.*;Terminée;\r\n/);
  });

  it('plan numéroté d\'abord, lignes sans numéro ensuite', () => {
    const numbers = lines.slice(1).filter(Boolean).map(l => l.split(';')[0]);
    const firstBlank = numbers.indexOf('');
    expect(firstBlank).toBeGreaterThan(0);
    expect(numbers.slice(firstBlank).every(n => n === '')).toBe(true);
  });

  it('cellules protégées : guillemets, « ; », retours à la ligne, formules', () => {
    expect(csv).toContain('"Constat\n- Compteur absent ; à poser\nPrix ""à définir"""');
    expect(csv).toContain(";'=1+1;");
  });
});
