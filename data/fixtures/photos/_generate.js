'use strict';

// Generateur de photos placeholders pour le fixture preview audit BACS.
// Skeleton gris uniforme sans texte — pour evaluer la composition de la
// grille photo dans le PDF (positionnement, ratio, espacement) sans etre
// distrait par un faux contenu.
//
// Usage : node data/fixtures/photos/_generate.js  (depuis backend-node/)

const path = require('path');
const sharp = require(path.resolve(__dirname, '../../../backend-node/node_modules/sharp'));

// 24 placeholders : on en attache 3-4 par element (zone, equipement, compteur,
// GTB) dans le fixture pour bien voir le rendu de la photo-grid en pleine
// charge.
const PHOTOS = [];
for (let i = 1; i <= 24; i++) {
  const id = String(i).padStart(3, '0');
  PHOTOS.push({ file: `P-${id}.png` });
}

// Skeleton uniforme : nuance neutre + leger pattern de hachures pour
// suggerer "photo a venir" sans surcharger.
const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="14" stroke="#e2e8f0" stroke-width="1.5"/>
    </pattern>
  </defs>
  <rect width="1280" height="720" fill="#f1f5f9"/>
  <rect width="1280" height="720" fill="url(#hatch)"/>
  <!-- Petit picto camera centre, tres discret -->
  <g transform="translate(620, 330)" fill="#cbd5e1">
    <rect x="0" y="14" width="40" height="32" rx="4"/>
    <circle cx="20" cy="30" r="9" fill="#f1f5f9"/>
    <circle cx="20" cy="30" r="6"/>
    <rect x="13" y="9" width="14" height="6" rx="1"/>
  </g>
</svg>`);

async function main() {
  const outDir = path.resolve(__dirname);
  for (const p of PHOTOS) {
    const outPath = path.join(outDir, p.file);
    await sharp(svg).png({ quality: 80, compressionLevel: 9 }).toFile(outPath);
    console.log(`✓ ${p.file}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
