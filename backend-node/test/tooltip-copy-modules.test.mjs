// Tous les modules de contenus d'infobulles (frontend/src/lib/*tips*.js) : chaque texte
// CONSTANT (objet ou chaîne exportés) respecte les règles de rédaction de Kévin (français
// simple, tutoiement, pas d'article du décret dans le texte, pas de « (s) »…). Les textes
// produits par des fonctions sont testés dans le fichier de test de chaque module.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '../../frontend/src/lib');
const MODULES = readdirSync(LIB).filter((f) => /tips.*\.js$/.test(f) && !f.endsWith('.test.js'));
const SKIP = new Set(['meta', 'article', 'icon', 'tone', 'accent', 'placement', 'keys', 'layout', 'variant']);

function shown(value, inCard = false, key = null) {
  if (value == null || value === false) return [];
  if (typeof value === 'string') return [{ text: value, label: !inCard && (!key || key === 'label' || key === 'text') }];
  if (Array.isArray(value)) return value.flatMap((v) => shown(v, inCard, key));
  if (typeof value === 'object') {
    const card = inCard || !!value.title;
    return Object.entries(value).flatMap(([k, v]) => (SKIP.has(k) ? [] : shown(v, card, k)));
  }
  return [];
}

describe('modules de contenus d’infobulles', () => {
  it('il y en a au moins un', () => {
    expect(MODULES.length).toBeGreaterThan(0);
  });

  for (const file of MODULES) {
    it(`${file} : textes constants conformes`, async () => {
      const mod = await import(pathToFileURL(join(LIB, file)).href);
      for (const [name, v] of Object.entries(mod)) {
        if (typeof v === 'function' || /ICONS$/.test(name)) continue;
        for (const s of shown(v)) {
          expect({ file, name, text: s.text, problems: checkCopy(s.text, { label: s.label }) })
            .toEqual({ file, name, text: s.text, problems: [] });
        }
      }
    });
  }
});
