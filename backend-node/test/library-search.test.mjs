// Recherche de modèles d'équipement (frontend/src/lib/library-search.js) : noms en français,
// mots du métier gardés en synonymes (« chiller » retrouve le groupe d'eau glacée).
import { describe, it, expect } from 'vitest';
import { templateMatches, normalizeSearch } from '../../frontend/src/lib/library-search.js';

const chiller = { slug: 'groupe-eau-glacee', name: 'Groupe d’eau glacée' };
const split = { slug: 'split', name: 'Split / Multi-split' };

describe('templateMatches', () => {
  it('cherche dans le nom, sans accents ni apostrophes', () => {
    expect(templateMatches(chiller, 'eau glacee')).toBe(true);
    expect(templateMatches(chiller, "Groupe d'eau")).toBe(true);
    expect(templateMatches(split, 'multi')).toBe(true);
  });
  it('retrouve le modèle par un mot du métier', () => {
    expect(templateMatches(chiller, 'chiller')).toBe(true);
    expect(templateMatches(chiller, 'groupe froid')).toBe(true);
    expect(templateMatches(split, 'chiller')).toBe(false);
  });
  it('recherche vide : tout correspond', () => {
    expect(templateMatches(split, '')).toBe(true);
    expect(normalizeSearch('Éclairage')).toBe('eclairage');
  });
});
