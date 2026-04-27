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
 * @param {object} opts
 * @param {string} opts.template — nom du template (sans .hbs), ex 'points-list' ou 'af'
 * @param {string} opts.styles — nom du CSS (sans .css), ex 'styles-points'
 * @param {object} opts.data — données fournies au template
 * @param {string} opts.outputPath — chemin du PDF généré
 * @param {object} opts.pdfOptions — options page.pdf() (format A3/A4, margin, etc.)
 */
async function renderPdf({ template, styles, data, outputPath, pdfOptions = {} }) {
  const tpl = loadTemplate(template);
  const css = loadStyles(styles);

  // Prepend les @font-face avec data URLs en debut de CSS
  const fullCss = getEmbeddedFontsCss() + '\n' + css;
  const html = tpl({
    ...data,
    styles: fullCss,
  });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // 'load' suffit : tout est inline (fonts + captures en data URL),
    // pas de fetch externe a attendre.
    await page.setContent(html, { waitUntil: 'load', timeout: 90_000 });
    await page.emulateMediaType('print');
    // Garantit que les fonts data: sont parsees par le browser
    await page.evaluateHandle('document.fonts.ready');

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const finalPdfOptions = {
      printBackground: true,
      preferCSSPageSize: true, // utilise @page size CSS
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
