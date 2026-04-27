'use strict';

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const log = require('./logger').system;

// Helpers Handlebars (utilises dans les templates .hbs)
Handlebars.registerHelper('gt', (a, b) => a > b);
Handlebars.registerHelper('eq', (a, b) => a === b);

// Charge tous les partials (.hbs commencant par _) au demarrage
const templatesDir = path.resolve(__dirname, '../../templates/pdf');
function registerPartials() {
  for (const file of fs.readdirSync(templatesDir)) {
    if (file.startsWith('_') && file.endsWith('.hbs')) {
      const name = file.replace(/^_|\.hbs$/g, '');
      Handlebars.registerPartial(`_${name}`, fs.readFileSync(path.join(templatesDir, file), 'utf-8'));
    }
  }
}
registerPartials();

// Cache des templates compilés (évite de recompiler à chaque export)
const templateCache = new Map();

function loadTemplate(name) {
  if (templateCache.has(name)) return templateCache.get(name);
  const tplPath = path.resolve(templatesDir, `${name}.hbs`);
  const compiled = Handlebars.compile(fs.readFileSync(tplPath, 'utf-8'));
  templateCache.set(name, compiled);
  return compiled;
}

function loadStyles(name) {
  const cssPath = path.resolve(templatesDir, `${name}.css`);
  return fs.readFileSync(cssPath, 'utf-8');
}

// ── Fonts embed (data URL base64) ────────────────────────────────────
// On embed Poppins + Manrope WOFF2 directement dans le CSS pour eviter
// tout fetch reseau (Google Fonts est bloque par le firewall Jelastic).
const FONT_FILES = [
  { family: 'Poppins', weight: 500, file: '@fontsource/poppins/files/poppins-latin-500-normal.woff2' },
  { family: 'Poppins', weight: 600, file: '@fontsource/poppins/files/poppins-latin-600-normal.woff2' },
  { family: 'Poppins', weight: 700, file: '@fontsource/poppins/files/poppins-latin-700-normal.woff2' },
  { family: 'Manrope', weight: 400, file: '@fontsource/manrope/files/manrope-latin-400-normal.woff2' },
  { family: 'Manrope', weight: 500, file: '@fontsource/manrope/files/manrope-latin-500-normal.woff2' },
  { family: 'Manrope', weight: 600, file: '@fontsource/manrope/files/manrope-latin-600-normal.woff2' },
  { family: 'Manrope', weight: 700, file: '@fontsource/manrope/files/manrope-latin-700-normal.woff2' },
];

let _embeddedFontsCss = null;
function getEmbeddedFontsCss() {
  if (_embeddedFontsCss != null) return _embeddedFontsCss;
  const parts = [];
  for (const f of FONT_FILES) {
    try {
      const fontPath = require.resolve(f.file);
      const base64 = fs.readFileSync(fontPath).toString('base64');
      parts.push(`@font-face {
  font-family: '${f.family}';
  font-style: normal;
  font-weight: ${f.weight};
  font-display: swap;
  src: url(data:font/woff2;base64,${base64}) format('woff2');
}`);
    } catch (err) {
      // Si une font manque, on continue (le rendu utilisera le fallback system)
      require('./logger').system.warn(`Font ${f.family} ${f.weight} absente : ${err.message}`);
    }
  }
  _embeddedFontsCss = parts.join('\n');
  return _embeddedFontsCss;
}

function loadFileAsDataUrl(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml'
             : ext === 'jpg' ? 'image/jpeg'
             : `image/${ext}`;
  const base64 = fs.readFileSync(absPath).toString('base64');
  return `data:${mime};base64,${base64}`;
}

function loadAssetDataUrl(filename) {
  const filePath = path.resolve(__dirname, '../../templates/pdf/assets', filename);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${base64}`;
}

// ── Pool de browser Puppeteer (1 instance partagée) ──
let _browserPromise = null;

function getBrowser() {
  if (!_browserPromise) {
    _browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    }).then((b) => {
      log.info('Puppeteer browser started');
      b.on('disconnected', () => {
        log.warn('Puppeteer browser disconnected — will relaunch on next export');
        _browserPromise = null;
      });
      return b;
    }).catch((err) => {
      _browserPromise = null;
      throw err;
    });
  }
  return _browserPromise;
}

/**
 * Rend un template Handlebars en PDF Puppeteer.
 *
 * Si `populateToc` est true (default false) :
 *  - Mesure la page de chaque element [data-toc-anchor="X"] apres render
 *  - Met a jour les .toc-page des [data-toc-link="X"] correspondants
 *  - Recompose le PDF avec les vrais numeros de page dans la TOC
 *
 * @param {object} opts
 * @param {string} opts.template — nom du template (sans .hbs)
 * @param {string} opts.styles — nom du CSS (sans .css)
 * @param {object} opts.data — données fournies au template
 * @param {string} opts.outputPath — chemin du PDF généré
 * @param {object} opts.pdfOptions — options page.pdf()
 * @param {boolean} opts.populateToc — true pour injecter les n° de page dans la TOC
 * @param {string} opts.pageFormat — 'A4' | 'A3' (pour calcul hauteur page)
 */
async function renderPdf({ template, styles, data, outputPath, pdfOptions = {}, populateToc = false, pageFormat = 'A4' }) {
  const tpl = loadTemplate(template);
  const css = loadStyles(styles);
  const fullCss = getEmbeddedFontsCss() + '\n' + css;
  const html = tpl({ ...data, styles: fullCss });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Viewport en pixels = format de page A4 ou A3 a 96 DPI (1mm = 3.7795px)
    // A4 = 210x297mm = 794x1123px, A3 = 297x420mm = 1123x1587px
    const viewportPortrait = pageFormat === 'A3'
      ? { width: 1123, height: 1587 }
      : { width: 794, height: 1123 };
    await page.setViewport(viewportPortrait);

    await page.setContent(html, { waitUntil: 'load', timeout: 90_000 });
    await page.emulateMediaType('print');
    await page.evaluateHandle('document.fonts.ready');

    if (populateToc) {
      // 1. Mesure les positions de chaque ancre (data-toc-anchor)
      // 2. Calcule sa page basee sur la hauteur de page utile
      // 3. Met a jour les .toc-page correspondants
      // Note : margins @page CSS = 22mm/18mm. Hauteur utile A4 ≈ 257mm = 971px,
      // A3 ≈ 380mm = 1436px. Cover + TOC = 2 pages avant les sections.
      const pageInnerPx = pageFormat === 'A3' ? 1436 : 971;
      const FIRST_SECTION_PAGE = 3; // page 1 = cover, page 2 = TOC
      await page.evaluate((innerPx, firstPage) => {
        // Trouve le scroll-top du container des sections (apres cover + TOC)
        const sectionsContainer = document.querySelector('.sections');
        if (!sectionsContainer) return;
        const sectionsTop = sectionsContainer.getBoundingClientRect().top + window.scrollY;

        const anchors = document.querySelectorAll('[data-toc-anchor]');
        const anchorPages = new Map();
        for (const a of anchors) {
          const top = a.getBoundingClientRect().top + window.scrollY;
          const offsetInSections = Math.max(0, top - sectionsTop);
          const pageNum = firstPage + Math.floor(offsetInSections / innerPx);
          anchorPages.set(a.getAttribute('data-toc-anchor'), pageNum);
        }

        // Met a jour les liens TOC
        for (const link of document.querySelectorAll('[data-toc-link]')) {
          const id = link.getAttribute('data-toc-link');
          const pageNum = anchorPages.get(id);
          const pageEl = link.querySelector('.toc-page');
          if (pageEl && pageNum != null) pageEl.textContent = String(pageNum);
        }
      }, pageInnerPx, FIRST_SECTION_PAGE);
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const finalPdfOptions = {
      printBackground: true,
      preferCSSPageSize: true,
      ...pdfOptions,
      path: outputPath,
    };
    await page.pdf(finalPdfOptions);
  } finally {
    await page.close().catch(() => {});
  }

  const stats = fs.statSync(outputPath);
  return { path: outputPath, sizeBytes: stats.size };
}

async function shutdown() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      await b.close();
    } catch { /* ignore */ }
    _browserPromise = null;
  }
}

module.exports = {
  renderPdf,
  loadAssetDataUrl,
  loadFileAsDataUrl,
  shutdown,
};
