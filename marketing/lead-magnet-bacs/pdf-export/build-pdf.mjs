#!/usr/bin/env node
// Export PDF vectoriel du livre blanc "Methode audit BACS Buildy".
// Reutilise le binaire puppeteer deja installe dans buildy-docs/backend-node/.
// Pre-flight overflow check : si une page deborde, on avorte plutot que de
// produire un PDF dont les pieds de page se decaleraient.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromBackend = createRequire(
  path.resolve(here, '../../../backend-node/package.json')
);
const puppeteer = requireFromBackend('puppeteer');

// Usage : node build-pdf.mjs [fichier.html]
// Defaut : methode-audit-bacs.html → Methode-audit-BACS-Buildy.pdf
const NAME_TO_OUT = {
  'methode-audit-bacs.html': 'Methode-audit-BACS-Buildy.pdf',
  'checklist-bacs-1page.html': 'Checklist-audit-BACS-Buildy-1page.pdf',
};
const srcName = process.argv[2] || 'methode-audit-bacs.html';
const outName = NAME_TO_OUT[srcName] || srcName.replace(/\.html?$/i, '.pdf');
const SRC = path.join(here, srcName);
const OUT = path.join(here, outName);

console.log('› Lancement Chromium headless…');
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
  await page.goto('file://' + SRC, {
    waitUntil: 'networkidle0',
    timeout: 120_000,
  });
  await page.evaluate(() => document.body.classList.add('puppeteer-export'));
  await page.evaluate(() => (document.fonts && document.fonts.ready) || true);
  await new Promise((r) => setTimeout(r, 1500));

  // Pre-flight : tolerance de 3mm (cf. METHODE-FIX-DEBORDEMENT.md §7).
  // Au-dela, le risque de chevauchement entre pages est reel.
  const overflows = await page.evaluate(() => {
    const PX_PER_MM = 96 / 25.4;
    const MAX = 297 * PX_PER_MM;
    const TOLERANCE_MM = 3;
    const sel = 'section.page, section.cover, section.pivot, section.back';
    return [...document.querySelectorAll(sel)]
      .map((p, i) => ({
        index: i + 1,
        tag: p.className,
        overMm: Math.max(0, (p.scrollHeight - MAX) / PX_PER_MM),
        pageNum: p.querySelector('.page-foot .num')?.textContent || '—',
      }))
      .filter((x) => x.overMm > TOLERANCE_MM);
  });
  if (overflows.length) {
    console.error('\n✗ Pages en debordement > 3mm (PDF avorte) :');
    overflows.forEach((o) =>
      console.error(
        `  · page ${o.pageNum} (#${o.index}, ${o.tag}) — deborde de ${o.overMm.toFixed(1)}mm`
      )
    );
    console.error('\nOuvrir le HTML dans Chrome → corriger les pages flaggees → relancer.');
    process.exit(1);
  }
  console.log('✓ Pre-flight OK — aucune page ne deborde');

  console.log('› Generation PDF…');
  await page.pdf({
    path: OUT,
    width: '210mm',
    height: '297mm',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  const { size } = await fs.stat(OUT);
  console.log(`✓ ${OUT} (${(size / 1024).toFixed(0)} Ko)`);
} finally {
  await browser.close();
}
