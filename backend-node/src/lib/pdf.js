'use strict';

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const log = require('./logger').system;

// Helpers Handlebars (utilises dans les templates .hbs)
Handlebars.registerHelper('gt', (a, b) => a > b);
Handlebars.registerHelper('eq', (a, b) => a === b);

// FontAwesome icons inline en SVG, parametrables (couleur + taille).
// Utilisation : {{{faIcon "building" "#4f46e5" "16"}}}
const faIcons = require('@fortawesome/free-solid-svg-icons');
const FA_ALIAS = {
  'building': 'faBuilding',
  'map-pin': 'faMapPin',
  'wrench': 'faWrench',
  'fire': 'faFire',
  'snowflake': 'faSnowflake',
  'fan': 'faFan',
  'faucet': 'faFaucet',
  'lightbulb': 'faLightbulb',
  'tower-cell': 'faTowerCell',
  'solar-panel': 'faSolarPanel',
  'bolt': 'faBolt',
  'gauge': 'faGauge',
  'sparkles': 'faWandMagicSparkles',
  'check-circle': 'faCircleCheck',
  'triangle-exclamation': 'faTriangleExclamation',
  'clipboard-list': 'faClipboardList',
  'list-check': 'faListCheck',
  'plug': 'faPlug',
  'shield': 'faShieldHalved',
  'temperature': 'faTemperatureHalf',
};
// Mapping categorie BACS -> icone + couleur (aligne avec
// frontend/components/SystemCategoryIcon.vue).
const CATEGORY_ICON = {
  heating:                { name: 'fire',         color: '#dc2626' },
  cooling:                { name: 'snowflake',    color: '#0891b2' },
  ventilation:            { name: 'fan',          color: '#64748b' },
  dhw:                    { name: 'faucet',       color: '#0284c7' },
  lighting_indoor:        { name: 'lightbulb',    color: '#f59e0b' },
  lighting_outdoor:       { name: 'tower-cell',   color: '#f59e0b' },
  electricity_production: { name: 'solar-panel',  color: '#16a34a' },
};
Handlebars.registerHelper('faIcon', (name, color, size) => {
  const key = FA_ALIAS[name] || name;
  const def = faIcons[key];
  if (!def || !def.icon) return '';
  const [w, h, , , path] = def.icon;
  const px = size || '16';
  const fill = color || 'currentColor';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${px}" height="${px}" style="vertical-align:middle;display:inline-block;flex-shrink:0;"><path fill="${fill}" d="${path}"/></svg>`;
  return new Handlebars.SafeString(svg);
});
// {{{categoryIcon "heating" "16"}}} -> icone + couleur dediees a la categorie BACS
Handlebars.registerHelper('categoryIcon', (category, size) => {
  const cfg = CATEGORY_ICON[category];
  if (!cfg) return '';
  const def = faIcons[FA_ALIAS[cfg.name] || cfg.name];
  if (!def || !def.icon) return '';
  const [w, h, , , path] = def.icon;
  const px = size || '16';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${px}" height="${px}" style="vertical-align:middle;display:inline-block;flex-shrink:0;margin-right:2mm"><path fill="${cfg.color}" d="${path}"/></svg>`;
  return new Handlebars.SafeString(svg);
});
Handlebars.registerHelper('or', function(...args) {
  // Handlebars passe l'options en dernier argument, on l'exclut
  return args.slice(0, -1).some(v => !!v);
});
Handlebars.registerHelper('and', function(...args) {
  return args.slice(0, -1).every(v => !!v);
});

// boolLabel : 1 -> 'Oui', 0 -> 'Non', null/undefined -> '—'
Handlebars.registerHelper('boolLabel', (v) => {
  if (v === 1 || v === true) return 'Oui';
  if (v === 0 || v === false) return 'Non';
  return '—';
});

// Lot 31 — Libelle du contrat requis a partir du service_level d'une section
Handlebars.registerHelper('requiredContractLabel', (level) => {
  if (!level) return 'Smart ou Premium';
  const v = String(level).toUpperCase();
  if (v === 'P') return 'Premium';
  if (v === 'S') return 'Smart';
  if (v.includes('S') && v.includes('P')) return 'Smart ou Premium';
  return 'Smart ou Premium';
});

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

const { optimizeFileToDataUrl } = require('./image-optimizer');

// Renvoie une data URL JPEG optimisee (resize 1600px max, q=82, mozjpeg)
// avec cache disque mtime-keyed adjacent au fichier source.
// Conserve les SVG tels quels. Async — cause de sharp.
async function loadFileAsDataUrl(absPath) {
  return optimizeFileToDataUrl(absPath);
}

function loadAssetDataUrl(filename) {
  const filePath = path.resolve(__dirname, '../../templates/pdf/assets', filename);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${base64}`;
}

// ── Pool de browser Puppeteer (1 instance partagee, recyclee periodiquement) ──
// Recycle apres N renders pour eviter les fuites memoire long-terme.
// Healthcheck (version()) avant chaque utilisation : si l'instance est
// morte, on la relance immediatement. Timeout global RENDER_TIMEOUT_MS
// applique par renderPdf (Promise.race) pour eviter les freezes.
const RENDER_RECYCLE_AFTER = parseInt(process.env.PUPPETEER_RECYCLE_AFTER || '50', 10);
const RENDER_TIMEOUT_MS = parseInt(process.env.PUPPETEER_RENDER_TIMEOUT_MS || '120000', 10);

let _browserPromise = null;
let _browserUseCount = 0;

async function _launchBrowser() {
  const b = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  log.info(`Puppeteer browser started (pid=${b.process()?.pid || '?'})`);
  b.on('disconnected', () => {
    log.warn('Puppeteer browser disconnected — will relaunch on next export');
    _browserPromise = null;
    _browserUseCount = 0;
  });
  return b;
}

async function getBrowser() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      // Healthcheck : si version() echoue, l'instance est morte.
      await b.version();
      // Recyclage planifie apres N renders.
      if (_browserUseCount >= RENDER_RECYCLE_AFTER) {
        log.info(`Puppeteer recycle apres ${_browserUseCount} renders`);
        _browserPromise = null;
        _browserUseCount = 0;
        try { await b.close(); } catch { /* ignore */ }
      } else {
        _browserUseCount++;
        return b;
      }
    } catch (err) {
      log.warn(`Puppeteer healthcheck KO (${err.message}) — relance`);
      _browserPromise = null;
      _browserUseCount = 0;
    }
  }
  _browserPromise = _launchBrowser().catch((err) => {
    _browserPromise = null;
    throw err;
  });
  _browserUseCount = 1;
  return _browserPromise;
}

function _withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
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
/**
 * Si skipFirstPageHeaderFooter=true, on rend deux PDFs et on les merge :
 *   - page 1 (cover) sans header/footer
 *   - pages 2..N avec header/footer
 * Necessite displayHeaderFooter=true dans pdfOptions, sinon ignore.
 */
async function renderPdf(opts) {
  // Timeout global : si la pipeline complete depasse RENDER_TIMEOUT_MS,
  // on rejette pour eviter qu'une requete bloque l'instance Puppeteer
  // indefiniment. Puppeteer n'est pas killee — c'est l'appelant qui
  // decide (en pratique le handler Fastify renvoie 502).
  return _withTimeout(_renderPdfImpl(opts), RENDER_TIMEOUT_MS, `renderPdf(${opts.template})`);
}

async function _renderPdfImpl({ template, styles, data, outputPath, pdfOptions = {}, populateToc = false, pageFormat = 'A4', pageOrientation = 'portrait', skipFirstPageHeaderFooter = false, watermark = null, coverFullBleed = false, addFormFields = false, pageContainerSelector = '.page' }) {
  const tpl = loadTemplate(template);
  const css = loadStyles(styles);
  const fullCss = getEmbeddedFontsCss() + '\n' + css;
  const html = tpl({ ...data, styles: fullCss });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Viewport en pixels = format de page A4 ou A3 a 96 DPI (1mm = 3.7795px)
    // A4 = 210x297mm = 794x1123px, A3 = 297x420mm = 1123x1587px
    let viewport = pageFormat === 'A3'
      ? { width: 1123, height: 1587 }
      : { width: 794, height: 1123 };
    if (pageOrientation === 'landscape') {
      viewport = { width: viewport.height, height: viewport.width };
    }
    await page.setViewport(viewport);

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

    const baseOptions = {
      printBackground: true,
      preferCSSPageSize: true,
      ...pdfOptions,
    };

    // Pour les checklists editables : on capture la position des elements
    // [data-field="text|textarea|checkbox"] AVANT de fermer la page, en
    // les rattachant a leur conteneur .page (chaque .page = 1 page PDF
    // grace au page-break-before:always).
    let extractedFields = null;
    if (addFormFields) {
      extractedFields = await page.evaluate((selector) => {
        const containers = Array.from(document.querySelectorAll(selector));
        const out = [];
        for (let i = 0; i < containers.length; i++) {
          const c = containers[i];
          const cRect = c.getBoundingClientRect();
          const fields = c.querySelectorAll('[data-field]');
          for (const el of fields) {
            const r = el.getBoundingClientRect();
            out.push({
              pageIndex: i,
              kind: el.dataset.field,
              name: el.dataset.name || `f${out.length}`,
              x_css: r.left - cRect.left,
              y_css: r.top - cRect.top,
              w_css: r.width,
              h_css: r.height,
            });
          }
        }
        return out;
      }, pageContainerSelector);
    }

    await page.pdf({ ...baseOptions, path: outputPath });

    // Cover plein-bord en deux passes : Chromium ne respecte pas fiablement
    // @page :first { margin: 0 } en paysage avec preferCSSPageSize. On
    // injecte un override CSS qui force @page { margin: 0; size: A4/A3 landscape },
    // re-rend la page 1, puis remplace la page 1 du PDF principal.
    if (coverFullBleed) {
      const coverTmpPath = outputPath.replace(/\.pdf$/i, '.cover-tmp.pdf');
      const sizeRule = pageOrientation === 'landscape'
        ? `${pageFormat} landscape`
        : `${pageFormat} portrait`;
      const overrideStyleId = await page.evaluate((size) => {
        const id = '__cover_fullbleed_override__';
        const style = document.createElement('style');
        style.id = id;
        // Surcharge tous les @page (y compris @page :first et named pages)
        // avec margin 0 et la taille demandee.
        style.textContent = `@page { size: ${size}; margin: 0 !important; padding: 0 !important; }`;
        document.head.appendChild(style);
        return id;
      }, sizeRule);
      await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        pageRanges: '1',
        path: coverTmpPath,
      });
      // Retire l'override pour que le PDF principal (deja genere) ne soit
      // pas affecte si une autre passe arrive.
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      }, overrideStyleId);
      await replaceFirstPage(outputPath, coverTmpPath);
      try { fs.unlinkSync(coverTmpPath); } catch { /* ignore */ }
    }

    // Post-processing pdf-lib en une seule passe (charge/save) :
    //   - Masque header/footer de la page 1 si demande (preserve liens TOC).
    //   - Applique le filigrane Buildy sur les pages demandees.
    //   - Injecte les champs AcroForm (text/textarea/checkbox) si demande.
    const needPostProcess =
      (skipFirstPageHeaderFooter && pdfOptions.displayHeaderFooter && pdfOptions.margin) ||
      watermark || (addFormFields && extractedFields && extractedFields.length);
    if (needPostProcess) {
      await postProcessPdf(outputPath, {
        maskFirstPage: (skipFirstPageHeaderFooter && pdfOptions.displayHeaderFooter)
          ? { margin: pdfOptions.margin, color: '#1b2842' }
          : null,
        watermark,
        formFields: addFormFields ? extractedFields : null,
        pageFormat,
        pageOrientation,
      });
    }
  } finally {
    await page.close().catch(() => {});
  }

  const stats = fs.statSync(outputPath);
  return { path: outputPath, sizeBytes: stats.size };
}

const mmToPt = (mm) => parseFloat(mm) * 2.83465;

async function replaceFirstPage(mainPath, coverPath) {
  const { PDFDocument } = require('pdf-lib');
  const mainBytes = fs.readFileSync(mainPath);
  const coverBytes = fs.readFileSync(coverPath);
  const mainDoc = await PDFDocument.load(mainBytes);
  const coverDoc = await PDFDocument.load(coverBytes);
  const [coverPage] = await mainDoc.copyPages(coverDoc, [0]);
  mainDoc.removePage(0);
  mainDoc.insertPage(0, coverPage);
  fs.writeFileSync(mainPath, await mainDoc.save());
}

async function postProcessPdf(pdfPath, { maskFirstPage, watermark, formFields, pageFormat, pageOrientation }) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const bytes = fs.readFileSync(pdfPath);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();

  // 1. Masque header/footer page 1
  if (maskFirstPage && pages.length > 0) {
    const { margin, color } = maskFirstPage;
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();
    const topPt = margin.top ? mmToPt(margin.top) : 0;
    const botPt = margin.bottom ? mmToPt(margin.bottom) : 0;
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    const fill = rgb(r, g, b);
    if (topPt > 0) firstPage.drawRectangle({ x: 0, y: height - topPt, width, height: topPt, color: fill });
    if (botPt > 0) firstPage.drawRectangle({ x: 0, y: 0, width, height: botPt, color: fill });
  }

  // 2. Filigrane Buildy — preservation d'aspect, dimensionne pour couvrir
  // au moins widthRatio x page_width ET heightRatio x page_height (la plus
  // contraignante des deux dicte l'echelle ; l'autre dimension deborde et
  // est rognee par les bords de page).
  if (watermark) {
    const {
      imagePath,
      skipFirstPage = false,
      widthRatio = 1.5,
      heightRatio = 1.5,
      opacity = 0.05,
    } = watermark;
    const imageBytes = fs.readFileSync(imagePath);
    const img = imagePath.toLowerCase().endsWith('.png')
      ? await doc.embedPng(imageBytes)
      : await doc.embedJpg(imageBytes);
    const aspect = img.height / img.width;
    const startIdx = skipFirstPage ? 1 : 0;
    for (let i = startIdx; i < pages.length; i++) {
      const p = pages[i];
      const { width: pw, height: ph } = p.getSize();
      const wByWidth = pw * widthRatio;
      const wByHeight = (ph * heightRatio) / aspect;
      const wPt = Math.max(wByWidth, wByHeight);
      const hPt = wPt * aspect;
      const x = (pw - wPt) / 2;
      const y = (ph - hPt) / 2;
      p.drawImage(img, { x, y, width: wPt, height: hPt, opacity });
    }
  }

  // 3. Champs AcroForm — convertit les bbox CSS en coords PDF.
  // Calibration : Puppeteer rend a 96dpi, donc 1px CSS = 0.75pt PDF.
  // L'origine (0,0) en CSS est en haut-gauche, en PDF c'est en bas-gauche.
  // On positionne chaque champ relativement a sa .page conteneur (1:1
  // avec une page PDF) en tenant compte des @page margins (header CSS).
  if (formFields && formFields.length) {
    const PT_PER_PX = 0.75;
    // Marges @page CSS de styles-bacs-audit-checklist.css (14mm 12mm 14mm 12mm)
    const TOP_MARGIN_PT = 14 * 2.83465;
    const LEFT_MARGIN_PT = 12 * 2.83465;
    const form = doc.getForm();
    for (const f of formFields) {
      if (f.pageIndex >= pages.length) continue;
      const page = pages[f.pageIndex];
      const { width: pw, height: ph } = page.getSize();
      const x_pt = LEFT_MARGIN_PT + f.x_css * PT_PER_PX;
      const w_pt = Math.max(8, f.w_css * PT_PER_PX);
      const h_pt = Math.max(8, f.h_css * PT_PER_PX);
      // y CSS du haut du champ depuis le haut de la zone utile
      const y_top_pt = TOP_MARGIN_PT + f.y_css * PT_PER_PX;
      const y_pt = ph - y_top_pt - h_pt;
      try {
        const { rgb: rgbFn } = require('pdf-lib');
        const borderColor = rgbFn(0.7, 0.74, 0.78); // gris #b3bcc6
        if (f.kind === 'text' || f.kind === 'textarea') {
          const tf = form.createTextField(f.name);
          if (f.kind === 'textarea') tf.enableMultiline();
          tf.addToPage(page, {
            x: x_pt, y: y_pt, width: w_pt, height: h_pt,
            borderWidth: 0.4,
            borderColor,
          });
        } else if (f.kind === 'checkbox') {
          const cb = form.createCheckBox(f.name);
          cb.addToPage(page, {
            x: x_pt, y: y_pt, width: w_pt, height: h_pt,
            borderWidth: 0.6,
            borderColor: rgbFn(0.1, 0.16, 0.26), // bleu sombre
          });
        }
      } catch {
        // Nom en doublon ou autre — on saute, pas bloquant
      }
    }
    // Police par defaut (Helvetica) : pdf-lib cree les appearances au save
  }

  fs.writeFileSync(pdfPath, await doc.save());
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

/**
 * Rend juste le HTML d'un template Handlebars (sans Puppeteer).
 * Utilise pour la preview HTML in-browser : on retourne le HTML completement
 * autonome (CSS embed + fonts data URL) que le frontend peut afficher dans
 * une iframe sandboxee. La preview ne fait PAS la post-passe TOC (les
 * numeros de page ne sont pas connus sans rendu PDF), mais elle suffit
 * pour valider visuellement le contenu avant de declencher le PDF.
 */
// Override CSS injecte uniquement en mode preview HTML (pas dans le PDF
// genere par Puppeteer). Reset les marges A4 que @page applique normalement
// en print, simule une feuille de papier centree sur fond gris pour donner
// l'illusion de "rapport sur le bureau" sans pagination reelle.
const PREVIEW_CSS_OVERRIDE = `
/* Override preview HTML — neutralise les marges @page (print-only) */
html { background: #e5e7eb; }
body {
  background: #ffffff;
  max-width: 210mm;
  margin: 12mm auto;
  padding: 18mm 12mm 16mm 12mm;
  box-sizing: border-box;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}
/* La page de garde garde sa pleine largeur (deja 210mm + bg bleu) */
body > .cover:first-child {
  margin: -18mm -12mm 8mm -12mm;
  width: calc(100% + 24mm);
}
`;

function renderHtml({ template, styles, data }) {
  const tpl = loadTemplate(template);
  const css = loadStyles(styles);
  const fullCss = getEmbeddedFontsCss() + '\n' + css + '\n' + PREVIEW_CSS_OVERRIDE;
  return tpl({ ...data, styles: fullCss });
}

module.exports = {
  renderPdf,
  renderHtml,
  loadAssetDataUrl,
  loadFileAsDataUrl,
  shutdown,
};
