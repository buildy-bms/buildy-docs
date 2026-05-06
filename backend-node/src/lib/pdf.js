'use strict';

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const log = require('./logger').system;

// Helpers Handlebars (utilises dans les templates .hbs)
Handlebars.registerHelper('gt', (a, b) => a > b);
Handlebars.registerHelper('lt', (a, b) => a < b);
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('minus', (a, b) => Number(a) - Number(b));
Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
Handlebars.registerHelper('and', function(...args) { args.pop(); return args.every(Boolean); });

// FontAwesome icons inline en SVG, parametrables (couleur + taille).
// Utilisation : {{{faIcon "building" "#4f46e5" "16"}}}
//
// Resolution :
// 1. Pro Solid en priorite (meme jeu que le picker frontend
//    @fortawesome/pro-solid-svg-icons), sinon Free Solid en fallback
// 2. Conversion kebab-case → CamelCase prefixee 'fa' (ex: "chart-line"
//    → "faChartLine"). Ainsi le helper accepte n'importe quel nom FA
//    saisi via FaIconPicker.vue, sans alias manuel.
// 3. Alias historique conserve pour les libelles deja utilises dans
//    les CSS / templates qui ne suivent pas la regle FA standard.
const faIconsFree = require('@fortawesome/free-solid-svg-icons');
let faIconsPro = null;
try { faIconsPro = require('@fortawesome/pro-solid-svg-icons'); } catch { /* pas dispo */ }
const FA_ALIAS = {
  'temperature': 'faTemperatureHalf',
  'shield':      'faShieldHalved',
  'sparkles':    'faWandMagicSparkles',
};
function kebabToFaKey(name) {
  if (!name) return null;
  if (FA_ALIAS[name]) return FA_ALIAS[name];
  // Deja en CamelCase prefixe (ex: faBuilding) -> tel quel.
  // /^fa[A-Z]/ et non `name[2] === toUpperCase` qui passait sur "fa-fire"
  // (le '-' est sa propre majuscule -> bug : icone non resolue).
  if (/^fa[A-Z]/.test(name)) return name;
  // Strip prefixe "fa-" si present (icon_value DB = 'fa-fire' / 'fa-snowflake'…)
  const base = name.startsWith('fa-') ? name.slice(3) : name;
  // kebab-case -> faCamelCase
  return 'fa' + base.split('-').map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join('');
}
function lookupFaIcon(name) {
  const key = kebabToFaKey(name);
  if (!key) return null;
  if (faIconsPro && faIconsPro[key]?.icon) return faIconsPro[key];
  if (faIconsFree[key]?.icon) return faIconsFree[key];
  return null;
}
// Mapping categorie BACS -> icone + couleur (aligne avec
// frontend/components/SystemCategoryIcon.vue).
const CATEGORY_ICON = {
  heating:                { name: 'fire',             color: '#dc2626' },
  cooling:                { name: 'snowflake',        color: '#0891b2' },
  thermique_mixte:        { name: 'temperature-half', color: '#a855f7' },
  ventilation:            { name: 'fan',              color: '#64748b' },
  dhw:                    { name: 'faucet',           color: '#0284c7' },
  lighting_indoor:        { name: 'lightbulb',        color: '#f59e0b' },
  lighting_outdoor:       { name: 'tower-cell',       color: '#f59e0b' },
  electricity_production: { name: 'solar-panel',      color: '#16a34a' },
};
Handlebars.registerHelper('faIcon', (name, color, size) => {
  const def = lookupFaIcon(name);
  if (!def) return '';
  const [w, h, , , path] = def.icon;
  // FA peut renvoyer path = string (icone simple) ou array (icone duotone) — on prend la string
  const d = Array.isArray(path) ? path[path.length - 1] : path;
  const px = size || '16';
  const fill = color || 'currentColor';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${px}" height="${px}" style="vertical-align:middle;display:inline-block;flex-shrink:0;"><path fill="${fill}" d="${d}"/></svg>`;
  return new Handlebars.SafeString(svg);
});
// {{{categoryIcon "heating" "16"}}} -> icone + couleur dediees a la categorie BACS
Handlebars.registerHelper('categoryIcon', (category, size) => {
  const cfg = CATEGORY_ICON[category];
  if (!cfg) return '';
  const def = lookupFaIcon(cfg.name);
  if (!def) return '';
  const [w, h, , , path] = def.icon;
  const d = Array.isArray(path) ? path[path.length - 1] : path;
  const px = size || '16';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${px}" height="${px}" style="vertical-align:middle;display:inline-block;flex-shrink:0;margin-right:2mm"><path fill="${cfg.color}" d="${d}"/></svg>`;
  return new Handlebars.SafeString(svg);
});

// ── Pastilles type / usage compteur — alignées sur l'UI ─────────────
// Source : frontend/src/components/MeterTypePill.vue + MeterUsagePill.vue
// Mêmes icônes FA, mêmes couleurs (Tailwind → hex tenu).
const METER_TYPE_PILL = {
  electric:            { icon: 'bolt',             label: 'Électrique',       bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
  electric_production: { icon: 'solar-panel',      label: 'Élec. production', bg: '#d1fae5', fg: '#065f46', border: '#6ee7b7' },
  gas:                 { icon: 'fire',             label: 'Gaz',              bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
  water:               { icon: 'droplet',          label: 'Eau',              bg: '#e0f2fe', fg: '#075985', border: '#7dd3fc' },
  thermal:             { icon: 'temperature-half', label: 'Thermique',        bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' },
  other:               { icon: 'gauge',            label: 'Autre',            bg: '#f3f4f6', fg: '#374151', border: '#d1d5db' },
};
const METER_USAGE_PILL = {
  heating:  { icon: 'fire',         label: 'Chauffage',     bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  cooling:  { icon: 'snowflake',    label: 'Climatisation', bg: '#ecfeff', fg: '#155e75', border: '#a5f3fc' },
  dhw:      { icon: 'faucet',       label: 'ECS',           bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' },
  pv:       { icon: 'solar-panel',  label: 'PV',            bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  lighting: { icon: 'lightbulb',    label: 'Éclairage',     bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  other:    { icon: 'circle-notch', label: 'Général',       bg: '#f9fafb', fg: '#374151', border: '#e5e7eb' },
};
function renderMeterPill(cfg, size = '11') {
  if (!cfg) return '';
  const def = lookupFaIcon(cfg.icon);
  let svgHtml = '';
  if (def) {
    const [w, h, , , p] = def.icon;
    const d = Array.isArray(p) ? p[p.length - 1] : p;
    svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" style="vertical-align:-1px;flex-shrink:0;margin-right:1.2mm"><path fill="${cfg.fg}" d="${d}"/></svg>`;
  }
  return new Handlebars.SafeString(
    `<span class="m-pill" style="background:${cfg.bg};color:${cfg.fg};border:0.4pt solid ${cfg.border}">${svgHtml}${cfg.label}</span>`
  );
}
// {{{meterTypePill type}}} -> pastille type compteur (élec, gaz, eau, etc.)
Handlebars.registerHelper('meterTypePill', (type) => {
  const cfg = METER_TYPE_PILL[type] || METER_TYPE_PILL.other;
  return renderMeterPill(cfg);
});
// {{{meterUsagePill usage}}} -> pastille usage compteur (chauffage, ECS, PV...)
Handlebars.registerHelper('meterUsagePill', (usage) => {
  const cfg = METER_USAGE_PILL[usage] || METER_USAGE_PILL.other;
  return renderMeterPill(cfg);
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

function loadTemplate(name, { fresh = false } = {}) {
  // fresh:true = bypass du cache + reload partials (atelier de design PDF :
  // edition .hbs sans pm2 restart). N'utiliser qu'en dev (route preview).
  if (fresh) {
    registerPartials();
    const tplPath = path.resolve(templatesDir, `${name}.hbs`);
    return Handlebars.compile(fs.readFileSync(tplPath, 'utf-8'));
  }
  if (templateCache.has(name)) return templateCache.get(name);
  const tplPath = path.resolve(templatesDir, `${name}.hbs`);
  const compiled = Handlebars.compile(fs.readFileSync(tplPath, 'utf-8'));
  templateCache.set(name, compiled);
  return compiled;
}

function loadStyles(name) {
  // Accepte un nom unique (string) ou une liste (array) de fichiers CSS
  // (sans extension). Les fichiers sont concatenes dans l'ordre — utile
  // pour appliquer un partial CSS partage en *override* a la fin (cas
  // _offerings-table.css mutualise entre offering-catalog et brochure).
  const names = Array.isArray(name) ? name : [name];
  return names
    .map(n => fs.readFileSync(path.resolve(templatesDir, `${n}.css`), 'utf-8'))
    .join('\n');
}

// ── Fonts embed (data URL base64) ────────────────────────────────────
// On embed Poppins + Manrope WOFF2 directement dans le CSS pour eviter
// tout fetch reseau (Google Fonts est bloque par le firewall Jelastic).
const FONT_FILES = [
  // Titres : Poppins (geometric sans, modern)
  { family: 'Poppins', weight: 500, file: '@fontsource/poppins/files/poppins-latin-500-normal.woff2' },
  { family: 'Poppins', weight: 600, file: '@fontsource/poppins/files/poppins-latin-600-normal.woff2' },
  { family: 'Poppins', weight: 700, file: '@fontsource/poppins/files/poppins-latin-700-normal.woff2' },
  // Corps : Inter (reference editoriale Stripe / Linear / Vercel / GitHub).
  // Source de verite cross-app : `frontend/src/main.js` charge les memes
  // poids cote UI Vue. Voir `docs/pdf-design-system.md` section Typographie.
  { family: 'Inter', weight: 400, file: '@fontsource/inter/files/inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 500, file: '@fontsource/inter/files/inter-latin-500-normal.woff2' },
  { family: 'Inter', weight: 600, file: '@fontsource/inter/files/inter-latin-600-normal.woff2' },
  { family: 'Inter', weight: 700, file: '@fontsource/inter/files/inter-latin-700-normal.woff2' },
  // Manrope embed pour COMPATIBILITE DESCENDANTE uniquement — plus utilisee
  // dans aucun template PDF actuel (migration mai 2026 vers Inter). Conservee
  // 30 jours au cas ou un export historique serait ouvert ; a retirer apres
  // ce delai si rien ne casse.
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

async function _renderPdfImpl({ template, styles, data, outputPath, pdfOptions = {}, populateToc = false, pageFormat = 'A4', pageOrientation = 'portrait', skipFirstPageHeaderFooter = false, watermark = null, coverFullBleed = false, addFormFields = false, pageContainerSelector = '.page', fresh = false, pageMarginTopMm = 22, pageMarginBottomMm = 18 }) {
  const tpl = loadTemplate(template, { fresh });
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
      // 4. Rend la TOC cliquable : ajoute id="X" sur les ancres et wrappe
      //    le contenu des items TOC dans <a href="#X"> (Puppeteer genere
      //    alors des liens internes cliquables dans le PDF).
      // Hauteur utile = format - margins haut/bas. Defaut 22+18 (AF/BACS) ;
      // la brochure utilise 14+14 par exemple. On calcule dynamiquement
      // pour que populateToc reste juste quand les marges varient.
      // 1mm = 3.7795px (96 DPI Puppeteer)
      const pageHeightMm = pageFormat === 'A3' ? 420 : 297;
      const innerHeightMm = pageHeightMm - pageMarginTopMm - pageMarginBottomMm;
      const pageInnerPx = Math.round(innerHeightMm * 3.7795);
      await page.evaluate((innerPx) => {
        // Trouve le scroll-top du container des sections
        const sectionsContainer = document.querySelector('.sections');
        if (!sectionsContainer) return;
        const sectionsTop = sectionsContainer.getBoundingClientRect().top + window.scrollY;
        // firstPage = nombre d'elements frontmatter (page-break-after:always)
        // avant .sections + 1 (la page sur laquelle .sections commence).
        // Selecteur explicite des frontmatter connus du template BACS audit
        // + .cover (commun a tous les PDF). Robuste aux variantes (essential
        // present uniquement en isBacs, dashboard idem, etc.).
        const frontmatterEls = document.querySelectorAll(
          '.cover, .essential, .toc, .r175-dashboard'
        );
        const firstPage = frontmatterEls.length + 1;

        const anchors = document.querySelectorAll('[data-toc-anchor]');
        const anchorPages = new Map();
        for (const a of anchors) {
          const id = a.getAttribute('data-toc-anchor');
          // Ajoute id="X" si absent — necessaire pour que <a href="#X">
          // soit cliquable dans le PDF.
          if (!a.id) a.id = `toc-${id}`;
          const top = a.getBoundingClientRect().top + window.scrollY;
          const offsetInSections = Math.max(0, top - sectionsTop);
          const pageNum = firstPage + Math.floor(offsetInSections / innerPx);
          anchorPages.set(id, pageNum);
        }

        // Met a jour les liens TOC + les rend cliquables
        for (const link of document.querySelectorAll('[data-toc-link]')) {
          const id = link.getAttribute('data-toc-link');
          const pageNum = anchorPages.get(id);
          const pageEl = link.querySelector('.toc-page');
          if (pageEl && pageNum != null) pageEl.textContent = String(pageNum);
          // Wrap les enfants dans un <a href="#toc-X"> pour rendre la
          // ligne cliquable. Idempotent (no-op si deja wrappe).
          if (!link.querySelector(':scope > a.toc-link-anchor')) {
            const a = document.createElement('a');
            a.className = 'toc-link-anchor';
            a.href = `#toc-${id}`;
            while (link.firstChild) a.appendChild(link.firstChild);
            link.appendChild(a);
          }
        }
      }, pageInnerPx);
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
    //
    // ATTENTION : si coverFullBleed est actif, la page 1 a deja ete re-rendue
    // SANS header/footer (cf bloc plus haut). Appliquer maskFirstPage par
    // dessus dessinerait 2 rectangles bleu marine qui tronquent le contenu
    // reel de la cover (logo en haut, legal en bas). Bug isole 2026-05-04.
    const skipMaskBecauseFullBleed = coverFullBleed;
    const needMask = skipFirstPageHeaderFooter && pdfOptions.displayHeaderFooter
      && pdfOptions.margin && !skipMaskBecauseFullBleed;
    const needPostProcess =
      needMask ||
      watermark || (addFormFields && extractedFields && extractedFields.length);
    if (needPostProcess) {
      await postProcessPdf(outputPath, {
        maskFirstPage: needMask ? { margin: pdfOptions.margin, color: '#1b2842' } : null,
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
// genere par Puppeteer). Reset les marges @page (print-only), simule
// une feuille de papier centree sur fond gris.
//
// Le format page (A4 portrait par defaut, mais aussi A3 paysage pour la
// liste de points) doit etre passe par l'appelant pour que la cover et
// le contenu rendent dans les bonnes dimensions.
function buildPreviewOverride({ pageFormat = 'A4', pageOrientation = 'portrait' } = {}) {
  // Dimensions par format (en mm). Largeur visible utilisee pour body max-width
  // et la mise a l'echelle de la cover.
  const dims = {
    'A4-portrait':  { w: 210, h: 297, padX: 12, padY: 18 },
    'A4-landscape': { w: 297, h: 210, padX: 14, padY: 14 },
    'A3-portrait':  { w: 297, h: 420, padX: 14, padY: 18 },
    'A3-landscape': { w: 420, h: 297, padX: 14, padY: 14 },
  };
  const key = `${pageFormat}-${pageOrientation}`;
  const d = dims[key] || dims['A4-portrait'];
  return `
/* Override preview HTML — page ${key} */
html { background: #e5e7eb; }
body {
  background: #ffffff;
  max-width: ${d.w}mm;
  margin: 12mm auto;
  padding: ${d.padY}mm ${d.padX}mm ${d.padY}mm ${d.padX}mm;
  box-sizing: border-box;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}
/* La page de garde s'etend bord-a-bord (couleur de fond definie dans
   les styles du template). La marge negative compense le padding du body. */
body > .cover:first-child {
  margin: -${d.padY}mm -${d.padX}mm 8mm -${d.padX}mm;
  width: calc(100% + ${d.padX * 2}mm);
}
`;
}

// Header/footer Puppeteer unifie pour tous les PDF Buildy.
// - HEADER : "CLIENT · PROJET" a gauche (uppercase), "<Doc> · <version>" a droite (mono)
// - FOOTER : [logo Buildy] | "<Doc> · note" | "Page X / Y"
// Toujours utiliser cet helper, jamais de header/footer custom dans une route :
// l'objectif est d'avoir des en-tetes/pieds de page identiques sur tous les exports.
function buildHeaderFooter({
  clientName,
  projectName,
  docType,        // ex: "Analyse Fonctionnelle", "Synthèse", "Audit BACS", "Liste de points"
  version,        // ex: "af-v0.14"
  logoDataUrl,    // result of loadAssetDataUrl('logo-buildy.svg')
  footerNote,     // optionnel, defaut = "<docType> · document confidentiel"
  margin,         // optionnel, defaut adapte au portrait A4
}) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  const ctx = `${esc(clientName)} · ${esc(projectName)}`;
  const docRight = `${esc(docType)} · ${esc(version)}`;
  const note = footerNote || `${docType} · document confidentiel`;
  return {
    displayHeaderFooter: true,
    margin: margin || { top: '18mm', bottom: '16mm', left: '12mm', right: '12mm' },
    headerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:7.5pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; justify-content:space-between; align-items:center; letter-spacing:0.02em;">
      <span style="text-transform:uppercase; letter-spacing:0.1em; font-size:6.5pt; color:#9ca3af;">${ctx}</span>
      <span style="font-family:'SFMono-Regular',Menlo,monospace; font-size:7pt; color:#6b7280;">${docRight}</span>
    </div>`,
    footerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:7.5pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; align-items:center; gap:4mm; border-top:0.4pt solid #e5e7eb; padding-top:2mm;">
      <img src="${logoDataUrl}" style="height:4mm; opacity:0.55;" />
      <span style="flex:1; color:#9ca3af; font-size:7pt;">${esc(note)}</span>
      <span style="font-family:'SFMono-Regular',Menlo,monospace; font-size:7pt; color:#4b5563; font-weight:600;">
        <span class="pageNumber"></span> <span style="color:#9ca3af; font-weight:400;">/</span> <span class="totalPages"></span>
      </span>
    </div>`,
  };
}

function renderHtml({ template, styles, data, pageFormat = 'A4', pageOrientation = 'portrait', fresh = false }) {
  const tpl = loadTemplate(template, { fresh });
  const css = loadStyles(styles);
  const fullCss = getEmbeddedFontsCss() + '\n' + css + '\n' + buildPreviewOverride({ pageFormat, pageOrientation });
  return tpl({ ...data, styles: fullCss });
}

module.exports = {
  renderPdf,
  renderHtml,
  buildHeaderFooter,
  loadAssetDataUrl,
  loadFileAsDataUrl,
  shutdown,
};
