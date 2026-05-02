// Tests pour le chiffrement AES-256-GCM des credentials sensibles.
// On set JWT_SECRET avant le require pour que la cle soit deterministe.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let crypt;

beforeAll(() => {
  process.env.JWT_SECRET = 'unit-test-secret-' + 'a'.repeat(48);
  // Reset les caches require pour que la cle scrypt soit re-derivee
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  crypt = require('../src/lib/crypto');
});

describe('crypto AES-256-GCM', () => {
  it('encrypt produit 3 segments hex separes par :', () => {
    const enc = crypt.encrypt('hello');
    expect(enc.split(':')).toHaveLength(3);
    expect(enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('encrypt + decrypt roundtrip preserve la valeur', () => {
    const values = ['', 'a', 'mot de passe avec accents é€', 'a'.repeat(1000)];
    for (const v of values) {
      expect(crypt.decrypt(crypt.encrypt(v))).toBe(v);
    }
  });

  it('encrypt(null) renvoie null', () => {
    expect(crypt.encrypt(null)).toBeNull();
    expect(crypt.encrypt(undefined)).toBeNull();
  });

  it('decrypt(null) renvoie null', () => {
    expect(crypt.decrypt(null)).toBeNull();
  });

  it('decrypt rejette un ciphertext malforme', () => {
    expect(() => crypt.decrypt('not-valid')).toThrow(/malforme/);
    expect(() => crypt.decrypt('aa:bb')).toThrow(/malforme/);
  });

  it('decrypt rejette une signature falsifiee (authTag KO)', () => {
    const enc = crypt.encrypt('secret');
    const [iv, , data] = enc.split(':');
    // Remplace l'authTag par n'importe quoi
    const tampered = `${iv}:${'00'.repeat(16)}:${data}`;
    expect(() => crypt.decrypt(tampered)).toThrow();
  });

  it('chaque encrypt produit un IV different (donc ciphertext different)', () => {
    const a = crypt.encrypt('same input');
    const b = crypt.encrypt('same input');
    expect(a).not.toBe(b);
    expect(crypt.decrypt(a)).toBe(crypt.decrypt(b));
  });
});
