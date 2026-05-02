import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { slugify, uniqueSlug } = require('../src/lib/slug');

describe('slug — slugify', () => {
  it('lowercase + remplace les non alphanum par tirets', () => {
    expect(slugify('Mon AF Tertiaire')).toBe('mon-af-tertiaire');
  });

  it('strip les accents', () => {
    expect(slugify('Hôtel Été')).toBe('hotel-ete');
  });

  it('retire les tirets multiples / debut / fin', () => {
    expect(slugify('  --foo--bar--  ')).toBe('foo-bar');
  });

  it('limite a 80 caracteres', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long)).toHaveLength(80);
  });

  it('renvoie chaine vide pour input vide', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });
});

describe('slug — uniqueSlug', () => {
  it('renvoie le slug de base si non pris', () => {
    expect(uniqueSlug('Hello World', () => false)).toBe('hello-world');
  });

  it('suffixe -2 / -3 / ... si conflit', () => {
    const taken = new Set(['hello-world', 'hello-world-2']);
    expect(uniqueSlug('Hello World', s => taken.has(s))).toBe('hello-world-3');
  });

  it('fallback "af" si la base est vide', () => {
    expect(uniqueSlug('', () => false)).toBe('af');
    expect(uniqueSlug('!@#', () => false)).toBe('af');
  });
});
