#!/usr/bin/env node
/**
 * Régénère src/lib/tooltip-icons.js (2026-10-12) : toutes les icônes qu'une infobulle peut
 * afficher, importées UNE PAR UNE depuis free-solid (hors du chunk pro de 2,5 Mo).
 * Sources : VERB_ICONS / DEFAULT_ICONS / ACCENTS (lib/tooltip-content.js) + toute valeur
 * `icon: 'nom'` écrite dans src/ (contenus d'infobulles des écrans et des modules lib/*).
 *
 *   node scripts/gen-tooltip-icons.mjs           # réécrit src/lib/tooltip-icons.js
 *   node scripts/gen-tooltip-icons.mjs --check   # code 1 si une icône manque (CI / tests)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tooltipIconNames } from '../src/lib/tooltip-content.js';

const require = createRequire(import.meta.url);
const free = require('@fortawesome/free-solid-svg-icons');
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(SRC, 'lib', 'tooltip-icons.js');

const exportName = (n) => 'fa' + n.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(vue|js)$/.test(name) && !p.endsWith('tooltip-icons.js')) out.push(p);
  }
  return out;
}

/** Noms d'icônes à enregistrer (existant dans free-solid). */
export function wantedIconNames() {
  const names = new Set(tooltipIconNames());
  for (const f of walk(SRC)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bicon\s*:\s*['"]([a-z][a-z0-9-]+)['"]/g)) {
      if (free[exportName(m[1])]) names.add(m[1]);
    }
  }
  return [...names].filter((n) => free[exportName(n)]).sort();
}

function render(names) {
  const ids = names.map(exportName);
  const lines = [];
  for (let i = 0; i < ids.length; i += 6) lines.push('  ' + ids.slice(i, i + 6).join(', ') + ',');
  return `// Icônes des infobulles (2026-10-12) — FICHIER GÉNÉRÉ par scripts/gen-tooltip-icons.mjs.
// Enregistrées au chargement de l'infobulle, depuis free-solid (icônes identiques à pro-solid,
// mais HORS du chunk pro de 2,5 Mo que vite.config.js isole : l'importer ici le chargerait au
// démarrage). Sources : VERB_ICONS / DEFAULT_ICONS / ACCENTS (lib/tooltip-content.js) et toute
// valeur \`icon: 'nom'\` écrite dans src/. Nouvelle icône dans une bulle = relancer le script
// (test : backend-node/test/tooltip-content.test.mjs).
import { library } from '@fortawesome/fontawesome-svg-core'
import {
${lines.join('\n')}
} from '@fortawesome/free-solid-svg-icons'

export const TOOLTIP_ICONS = [
${lines.join('\n')}
]

library.add(...TOOLTIP_ICONS)

/** Noms des icônes enregistrées (« trash », « circle-info »…). */
export const TOOLTIP_ICON_NAMES = new Set(TOOLTIP_ICONS.map((i) => i.iconName))
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = wantedIconNames();
  if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    const missing = names.filter((n) => !current.includes(exportName(n) + ','));
    if (missing.length) {
      console.error(`Icônes manquantes dans tooltip-icons.js : ${missing.join(', ')}\n→ node scripts/gen-tooltip-icons.mjs`);
      process.exit(1);
    }
    console.log(`OK : ${names.length} icônes enregistrées.`);
  } else {
    writeFileSync(OUT, render(names));
    console.log(`tooltip-icons.js : ${names.length} icônes.`);
  }
}
