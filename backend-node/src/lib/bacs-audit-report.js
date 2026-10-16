'use strict';

// Rapport d'audit BACS — nouvelle mise en page (charte graphique Buildy, validée par Kévin le
// 2026-10-15). Remplace bacs-audit.hbs, gardé comme « ancienne mise en page » pour comparer.
//
// Organisation : partie 1 « L'essentiel » (verdict en trois questions, mot de l'auditeur,
// exigences du décret, plan d'actions par domaine), partie 2 « Le constat détaillé » par domaine
// (chaque chapitre finit par ses actions, justification comprise : l'ancienne annexe C), annexes.
// Rien de ce qu'imprimait bacs-audit.hbs n'est perdu : contrôle par comparaison des textes sur
// des audits réels et sur des variantes qui forcent chaque cas rare (2026-10-15).
//
// Entrée : les données de buildBacsAuditExportData (les mêmes que l'ancien gabarit).
// Sortie : HTML autonome (polices, logos, photos en data URL).
//   - mode 'print' : paginé par Paged.js dans lib/pdf.js renderPagedHtmlPdf() (en-tête, pied de
//     page, numéros de page des renvois et du sommaire, pages sombres à fond perdu) ;
//   - mode 'screen' : aperçu de l'application (cadre sans script), d'un bloc, sans numéros.
// Styles : templates/pdf/styles-bacs-audit-report.css (+ bloc @page ci-dessous, qui porte le
// client et la version). Polices et logos : templates/pdf/charte/ (copie de charte-graphique/,
// script sync-buildy-docs.mjs).

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { lookupFaIcon, typographyForTemplate } = require('./pdf');

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/pdf');
const CHARTE_DIR = path.join(TEMPLATES_DIR, 'charte');

// Icônes : noms courts du gabarit → Font Awesome (pro, repli free)
const ICONS = {
  fire: 'faFire', snowflake: 'faSnowflake', fan: 'faFan', faucet: 'faFaucet', lightbulb: 'faLightbulb', solar: 'faSolarPanel',
  check: 'faCheck', warn: 'faTriangleExclamation', xmark: 'faXmark', bolt: 'faBolt', flame: 'faFireFlameSimple', droplet: 'faDroplet',
  heat: 'faTemperatureHigh', minus: 'faMinus', clock: 'faClock', building: 'faBuilding', gauge: 'faGaugeHigh', sliders: 'faSliders',
  server: 'faServer', search: 'faMagnifyingGlass', file: 'faFileLines', info: 'faCircleInfo', map: 'faMapLocationDot', list: 'faListCheck',
  arrow: 'faArrowRight', plug: 'faPlug', calendar: 'faCalendarDays', users: 'faUsers', layer: 'faLayerGroup', camera: 'faCamera',
  pin: 'faLocationDot', swap: 'faArrowRightArrowLeft', liable: 'faUserTie', wrench: 'faWrench', clipcheck: 'faClipboardCheck',
  listcheck: 'faListCheck', power: 'faPowerOff', rotate: 'faRotate', signal: 'faTowerBroadcast', mail: 'faEnvelope', phone: 'faPhone',
  globe: 'faGlobe', thermo: 'faTemperatureHalf', note: 'faNoteSticky', link: 'faLinkSlash', cube: 'faCube', chart: 'faChartLine',
  question: 'faCircleQuestion', euro: 'faEuroSign',
};
const _iconCache = new Map();
function ic(name, cls = '') {
  const key = `${name}|${cls}`;
  if (_iconCache.has(key)) return _iconCache.get(key);
  const def = lookupFaIcon(ICONS[name] || 'faCircleInfo') || lookupFaIcon('faCircleInfo');
  const [w, h, , , p] = def.icon;
  const d = Array.isArray(p) ? p[p.length - 1] : p;
  const svg = `<svg class="ic ${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
  _iconCache.set(key, svg);
  return svg;
}

// Polices de la charte (graisses fixes) en data URL ; chiffres 0–9 en Sora (« Sora Digits »)
const FONTS = [
  ['Sora Digits', 400, 'sora-latin-400-normal.woff2'], ['Sora Digits', 500, 'sora-latin-500-normal.woff2'],
  ['Sora Digits', 600, 'sora-latin-600-normal.woff2'], ['Sora Digits', 700, 'sora-latin-700-normal.woff2'],
  ['Poppins', 400, 'poppins-latin-400-normal.woff2'], ['Poppins', 600, 'poppins-latin-600-normal.woff2'],
  ['Manrope', 400, 'manrope-latin-400-normal.woff2'], ['Manrope', 500, 'manrope-latin-500-normal.woff2'],
  ['Manrope', 600, 'manrope-latin-600-normal.woff2'], ['Manrope', 700, 'manrope-latin-700-normal.woff2'],
];
// Sous-ensembles complémentaires (paquets @fontsource du serveur, mêmes versions que la charte)
const EXTRA_SUBSETS = [
  ['latin-ext', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    [['Poppins', 400], ['Poppins', 600], ['Manrope', 400], ['Manrope', 500], ['Manrope', 600], ['Manrope', 700]]],
  ['greek', 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF',
    [['Manrope', 400], ['Manrope', 500], ['Manrope', 600], ['Manrope', 700]]],
];
let _fontsCss = null;
function fontsCss() {
  if (_fontsCss != null) return _fontsCss;
  const face = (family, weight, b64, range) => `@font-face {\n  font-family: '${family}';\n  src: url(data:font/woff2;base64,${b64}) format('woff2');\n  font-weight: ${weight};\n  font-style: normal;\n  font-display: block;${range ? `\n  unicode-range: ${range};` : ''}\n}`;
  const charter = FONTS.map(([family, weight, file]) => face(family, weight,
    fs.readFileSync(path.join(CHARTE_DIR, 'fonts', file)).toString('base64'), family === 'Sora Digits' ? 'U+0030-0039' : null));
  // Mêmes familles, alphabets au-delà du latin courant (noms « Łódź », « ΔT » dans une note) :
  // sinon Chromium prend une police du système (Liberation Sans en production, vu le 2026-10-15).
  const extra = [];
  for (const [subset, range, weights] of EXTRA_SUBSETS) {
    for (const [family, weight] of weights) {
      try {
        const file = require.resolve(`@fontsource/${family.toLowerCase()}/files/${family.toLowerCase()}-${subset}-${weight}-normal.woff2`);
        extra.push(face(family, weight, fs.readFileSync(file).toString('base64'), range));
      } catch { /* sous-ensemble absent : repli sur la police du système pour ces caractères */ }
    }
  }
  _fontsCss = [...charter, ...extra].join('\n');
  return _fontsCss;
}

let _logos = null;
function logos() {
  if (_logos) return _logos;
  const url = (f) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(CHARTE_DIR, 'logos', f)).toString('base64')}`;
  _logos = {
    dark: url('buildy-logo-fond-sombre.svg'),
    darkNoTagline: url('buildy-logo-fond-sombre-sans-signature.svg'),
    footer: url('buildy-logo-couleur-sans-signature.svg'),
  };
  return _logos;
}

// Textes « en clair » du décret : source unique côté interface (fiche ⓘ du décret)
let _decreePlain = null;
async function decreePlainModule() {
  if (!_decreePlain) {
    _decreePlain = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/lib/decree-plain.js')).href);
  }
  return _decreePlain;
}

// Chiffres en indice ou en exposant Unicode (« CO₂ », « m⁴ ») : absents de toutes les polices
// embarquées ; écrits en <sub> / <sup> avec le chiffre ordinaire. Texte seulement (jamais dans
// les balises, les styles ni les attributs).
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function scriptDigits(html) {
  return html
    .split(/(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<title[\s\S]*?<\/title>)/i)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/>([^<]+)</g, (_m, text) => `>${text
      .replace(/[₀-₉]+/g, (m) => `<sub>${[...m].map((c) => SUB.indexOf(c)).join('')}</sub>`)
      .replace(/[⁰⁴-⁹]+/g, (m) => `<sup>${[...m].map((c) => SUP.indexOf(c)).join('')}</sup>`)}<`)))
    .join('');
}

/**
 * HTML du rapport d'audit BACS.
 * @param {object} data — buildBacsAuditExportData()
 * @param {object} [opts]
 * @param {'print'|'screen'} [opts.mode='print'] — 'print' pour Paged.js, 'screen' pour l'aperçu
 */
async function buildBacsAuditReportHtml(data, { mode = 'print' } = {}) {
  const { decreePlain, normalizeArticle } = await decreePlainModule();
  const env = {
    mode, ic, logo: logos(), fontsCss: fontsCss(),
    css: fs.readFileSync(path.join(TEMPLATES_DIR, 'styles-bacs-audit-report.css'), 'utf8'),
    decreePlain, normalizeArticle,
  };
  // Copie : le gabarit complète des listes absentes
  const html = buildHtml(JSON.parse(JSON.stringify(data)), env);
  return typographyForTemplate('bacs-audit-report', scriptDigits(html));
}

function buildHtml(d, env) {
  const { decreePlain, normalizeArticle } = env;
  // Listes absentes (données plus anciennes que l'export) : vides plutôt qu'une erreur
  for (const k of ['bmsManagedDevices', 'bmsUnmanagedDevices', 'bmsUnansweredDevices', 'bmsNotTargetedDevices', 'bmsOutOfScopeDevices', 'bmsDevicesByZone',
    'bmsManagedMeters', 'bmsBrokenLinkMeters', 'bmsUnmanagedMeters', 'bmsUnansweredMeters', 'bmsMetersByEnergy', 'bmsComponents', 'pointsToQualify',
    'exemptionItems', 'vigilanceItems', 'outOfDecreeItems', 'zonesOutOfBacsScope', 'meters', 'metersForPdf', 'metersWithDetails', 'meterEnergyGroups',
    'thermal', 'systemsByZone', 'zones', 'zonesFunctional', 'zonesTechnical', 'siteParties', 'heatingCoolingBreakdown', 'reportAttachments',
    'reportAttachmentImages', 'reportAttachmentTranscripts', 'actionItemsRaw', 'actionItemsByCard', 'bacsArticles', 'methodology', 'disclaimers']) d[k] ??= [];

  // ─── Outils ──────────────────────────────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cssStr = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const nf = (n, dec = 2) => (n == null || n === '' ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: dec }));
  const ic = env.ic;
  const plural = (n, one, many) => `${nf(n, 0)} ${Number(n) > 1 ? many : one}`;
  const stripHtml = (h) => String(h || '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const isYes = (v) => v === 1 || v === true || v === 'yes';
  const isNo = (v) => v === 0 || v === false || v === 'no';
  const frDate = (s) => {
    if (!s) return '';
    const t = new Date(`${String(s).slice(0, 10)}T12:00:00`);
    return Number.isNaN(t.getTime()) ? String(s) : t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/^1 /, '1er ');
  };
  const join = (list, sep = ', ') => list.filter(Boolean).join(sep);
  const artLabel = (code) => normalizeArticle(String(code || '').replace(/D\.A\./, 'dernier alinéa'));
  const art = (code) => (code ? `<span class="art">${esc(artLabel(code))}</span>` : '');
  const plainOf = (code) => decreePlain(artLabel(code)) || { title: code, text: '' };
  const rich = (html, plain) => (html ? `<div class="rich">${html}</div>` : plain ? `<p>${esc(plain)}</p>` : '');
  // Renvoi vers une autre partie du rapport : « titre », p. N (Paged.js)
  const TITLES = {};
  const xref = (id, label) => `<a class="xref" href="#${id}">« ${esc(label || TITLES[id] || id)} »</a>`;
  const pageOf = (id) => `<a class="pg" href="#${id}"></a>`;

  // Coche / croix / tiret, avec le mot (lisible en noir et blanc)
  const mark = (v, { neutral = false, yes = 'Oui', no = 'Non', none = '—' } = {}) => {
    if (isYes(v)) return `<span class="mk ok">${ic('check')}${esc(yes)}</span>`;
    if (isNo(v)) return `<span class="mk ${neutral ? 'neu' : 'bad'}">${ic('xmark')}${esc(no)}</span>`;
    return `<span class="mk na">${esc(none)}</span>`;
  };

  // États (charte 2.3) : ok / watch / bad / na / reserve / info
  const STATE = {
    compliant: ['ok', 'check', 'Conforme'],
    compliant_reserves: ['reserve', 'clock', 'Conforme sous réserve'],
    reserve: ['reserve', 'clock', 'Sous réserve'],
    non_compliant: ['bad', 'xmark', 'Non conforme'],
    partial: ['watch', 'warn', 'Partiellement conforme'],
    conditional: ['watch', 'clock', 'Sous condition'],
    unknown: ['na', 'question', 'À qualifier'],
    not_subject: ['na', 'minus', 'Non assujetti'],
    info: ['info', 'info', 'Concerné'],
    na: ['na', 'minus', 'Sans objet'],
    exempt: ['na', 'minus', 'Exempté'],
    shared: ['na', 'swap', 'Évalué avec son système d’origine'],
  };
  const pill = (state, label) => {
    const [cls, i, l] = STATE[state] || STATE.na;
    return `<span class="pill ${cls}">${ic(i)}${esc(label || l)}</span>`;
  };
  const SEV = { blocking: 'Bloquante', major: 'Majeure', minor: 'Mineure' };
  const SEV_PL = { blocking: 'Bloquantes', major: 'Majeures', minor: 'Mineures' };
  const sevPill = (a, n) => (a.is_reserve
    ? `<span class="pill reserve">${ic('clock')}Réserve</span>`
    : `<span class="pill sev-${a.severity}"><span class="dot"></span>${n ? `${SEV_PL[a.severity]} × ${n}` : SEV[a.severity] || a.severity}</span>`);

  // Usages : couleur de l'icône (palette V3), pastille neutre
  const USAGE = {
    heating: ['fire', '#E95369'], cooling: ['snowflake', '#73B0F2'], ventilation: ['fan', '#768EA5'],
    dhw: ['faucet', '#4792F8'], lighting_indoor: ['lightbulb', '#F5C259'], lighting_outdoor: ['lightbulb', '#F5C259'],
    lighting: ['lightbulb', '#F5C259'], electricity_production: ['solar', '#00CD92'], pv: ['solar', '#00CD92'],
    other: ['building', '#768EA5'],
  };
  const uIcon = (cat) => { const [i, c] = USAGE[cat] || ['layer', '#768EA5']; return `<span class="u-ic" style="color:${c}">${ic(i)}</span>`; };
  const usagePill = (cat, label) => `<span class="pill usage">${uIcon(cat)}${esc(label)}</span>`;
  // Énergies : couleur du tag Hyperveez (défauts de la charte)
  const ENERGY = {
    electric: ['bolt', '#2A78D6', 'Électricité'], gas: ['flame', '#FF7C2B', 'Gaz'], water: ['droplet', '#1496FF', 'Eau'],
    thermal: ['heat', '#B73995', 'Chaleur'], heat: ['heat', '#B73995', 'Chaleur'], cold: ['snowflake', '#73B0F2', 'Froid'],
  };
  const energyHead = (e) => { const [i, c, l] = ENERGY[e?.value] || ['gauge', '#768EA5', e?.label]; return { icon: ic(i), color: c, label: l || e?.label }; };
  const ROLE = { production: 'Production', distribution: 'Distribution', emission: 'Émission', regulation: 'Régulation', other: 'Autre' };
  const roles = (list) => join((Array.isArray(list) ? list : []).map((r) => ROLE[r] || r));
  const photos = (list) => ((list || []).length ? `<div class="photos">${list.map((p) => `<img src="${p.dataUrl}" alt="">`).join('')}</div>` : '');

  // ─── Données dérivées ───────────────────────────────────────────────────────────────────
  const doc = d.document;
  const isBacs = d.isBacs !== false;
  const site = d.site || {};
  const projectName = String(doc.project_name || '').replace(/^Audit (BACS|GTB) — /, '');
  const siteName = site.name || projectName;
  const client = site.customer_name || doc.client_name;
  const comp = d.compliance;
  const dash = comp.r175Dashboard || [];
  const reqs = dash.filter((r) => r.verdict !== 'info');
  const countV = (...v) => reqs.filter((r) => v.includes(r.verdict)).length;
  const actions = d.actionItemsRaw || [];
  const actionByNum = Object.fromEntries(actions.map((a) => [a.display_number, a]));
  const justifOf = {};
  for (const g of d.justificationGroups || []) for (const it of g.items || []) justifOf[it.number] = it;
  const originOf = (a) => `${esc(a.source_label || justifOf[a.display_number]?.source || '—')}${a.auto_generated === 0 || justifOf[a.display_number]?.manual ? ' · action ajoutée par l’auditeur' : ''}`;
  const asg = comp.assujettissement || {};
  const ps = d.powerSummary;
  const versionLabel = d.versionLabel || d.version;
  const planCards = d.actionItemsByCard || [];
  const cardOf = (key) => planCards.find((c) => c.key === key);
  const actionsFor = (code) => {
    const c = artLabel(code);
    return actions.filter((a) => artLabel(a.r175_article) === c || (/dernier alinéa/.test(c) && /dernier alin|D\.A\./.test(a.r175_article || '')));
  };
  // Les numéros d'une action groupée renvoient à la carte du groupe
  const groupOfNumber = {};
  for (const c of planCards) for (const g of c.grouped || []) if (g.kind === 'group') for (const it of g.items) groupOfNumber[it.display_number] = `grp-${g.first_number}`;
  const anchorOf = (num) => groupOfNumber[num] || `action-${num}`;

  // Domaine du plan → chapitre de la partie 2
  const CHAPTER_OF_CARD = { identification: 'site', systems: 'systemes', meters: 'comptage', thermal: 'regulation', priority: 'gtb', bms: 'gtb', inspections: 'inspection', misc: 'autres' };
  Object.assign(TITLES, {
    verdict: 'Le verdict', mot: 'Le mot de l’auditeur', exigences: 'Les exigences du décret', plan: 'Le plan d’actions',
    site: 'Le site et ses zones', systemes: 'Les systèmes techniques', comptage: 'Le comptage', regulation: 'La régulation du chauffage',
    gtb: 'La GTB', inspection: 'L’inspection périodique', autres: 'Autres actions',
    'annexe-a': 'Le décret BACS, texte intégral', 'annexe-b': 'Méthodologie et hypothèses', 'annexe-c': 'Mentions légales', 'annexe-d': 'Documents joints',
  });
  // Les textes calculés citent les chapitres du rapport actuel : renvois vers les nouveaux titres
  const fixRefs = (s) => String(s || '')
    .replace(/\s*\(chapitre 7\)/g, ` (voir ${xref('inspection')})`)
    .replace(/chapitre 3/g, xref('systemes'))
    .replace(/chapitre 4 « Compteurs et mesurage »/g, xref('comptage'));

  // ─── Sections d'une action (Constat, Exigence, À faire…) ──────────────────────────────────
  const SECTION_LABEL = (t) => {
    const s = stripHtml(t);
    if (/^Obligation à respecter$/i.test(s)) return 'À faire';
    if (/^Strict minimum/i.test(s)) return 'Le minimum pour être conforme';
    if (/^Décret/i.test(s)) return 'Ce que dit le décret';
    return s;
  };
  const acdSections = (html) => {
    const out = [];
    const re = /<div class="acd-title">([\s\S]*?)<\/div><div class="acd-body">([\s\S]*?)<\/div><\/div>/g;
    let m;
    while ((m = re.exec(html || ''))) out.push({ title: SECTION_LABEL(m[1]), body: m[2] });
    if (!out.length && html) out.push({ title: 'Justification', body: html });
    return out;
  };
  const dl = (rows) => `<dl class="adl">${rows.filter(Boolean).map(([t, b, cls]) => `<dt${cls ? ` class="${cls}"` : ''}>${esc(t)}</dt><dd${cls ? ` class="${cls}"` : ''}>${b}</dd>`).join('')}</dl>`;

  const actionCard = (a) => `
    <article class="action" id="action-${esc(a.display_number)}">
      <header>
        <span class="num">${esc(a.display_number)}</span>${sevPill(a)}${art(a.r175_article)}
        ${a.zone_name ? `<span class="chip">${ic('pin')}${esc(a.zone_name)}</span>` : ''}
        ${a.device_system_category ? `<span class="chip">${uIcon(a.device_system_category)}</span>` : ''}
        ${a.effortLabel ? `<span class="chip">Effort : ${esc(a.effortLabel)}</span>` : ''}
      </header>
      <h4>${esc(a.title_plain || stripHtml(a.title))}</h4>
      ${dl([
        ...acdSections(a.description).map((s) => [s.title, s.body, s.title === 'À faire' ? 'todo' : '']),
        a.alternative_solutions_html ? ['Préconisations Buildy', a.alternative_solutions_html] : null,
        a.scope_condition ? ['Condition d’application', esc(a.scope_condition)] : null,
        a.scope_note ? ['Portée à confirmer', esc(a.scope_note)] : null,
        ['Origine du constat', originOf(a), 'src'],
      ])}
    </article>`;

  // Action groupée : passages communs une fois (au nom de l'élément près), puis une ligne par action
  const COLS = { zone: 'Zone', usage: 'Usage', meter_type: 'Énergie', system: 'Système', device: 'Équipement' };
  const groupCard = (g, prefix = '') => {
    const items = g.items.map((it) => ({ ...it, raw: actionByNum[it.display_number] || {} }));
    const secs = items.map((it) => acdSections(it.raw.description));
    const norm = (s, it) => stripHtml(s).toLowerCase().replace(String(it.raw.source_label || '').toLowerCase(), '§');
    const titles = secs[0].map((s) => s.title);
    const common = []; const own = [];
    titles.forEach((t, k) => {
      const same = secs.every((ss, i) => ss[k] && ss[k].title === t && norm(ss[k].body, items[i]) === norm(secs[0][k].body, items[0]));
      if (same && items.length > 1) common.push({ title: t, body: stripHtml(secs[0][k].body).replace(new RegExp(String(items[0].raw.source_label || '§').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'chaque élément listé') });
      else own.push(k);
    });
    const cols = (g.columns || []).filter((c) => COLS[c]);
    const cell = (it, c) => ({
      zone: esc(it.zone_name || '—'),
      usage: it.meter_usage ? usagePill(it.meter_usage === 'other' ? 'other' : it.meter_usage, it.meter_usage === 'other' ? 'Général' : it.meter_usage_label || it.meter_usage) : esc(it.meter_usage_label || '—'),
      meter_type: esc(it.meter_type_label || (ENERGY[it.meter_type] || [])[2] || '—'),
      system: esc(it.system_label || '—'),
      device: `<b>${esc(it.device_name || '—')}</b>${it.device_brand ? ` · ${esc(it.device_brand)}` : ''}`,
    }[c]);
    return `
    <article class="action group" id="grp-${esc(g.first_number)}">
      <div class="keep">${prefix}<header><span class="num">${esc(g.numbers_label || `${g.first_number} à ${g.last_number}`)}</span>${sevPill(g, g.count)}${art(g.r175_article)}</header>
      <h4>${esc(g.label)}</h4>
      ${dl([
        g.justification ? ['Pourquoi', esc(g.justification)] : null,
        ...common.map((s) => [s.title, esc(s.body), s.title === 'À faire' ? 'todo' : '']),
        g.condition ? ['Condition d’application', esc(g.condition)] : null,
        g.scope_note ? ['Portée à confirmer', esc(g.scope_note)] : null,
      ])}</div>
      <table class="data gtab">
        <thead><tr><th>N°</th>${cols.map((c) => `<th>${COLS[c]}</th>`).join('')}</tr></thead>
        <tbody>${items.map((it, i) => `<tr class="gi" id="action-${esc(it.display_number)}"><td class="n">${esc(it.display_number)}</td>${cols.map((c) => `<td>${cell(it, c)}</td>`).join('')}</tr><tr class="det"><td colspan="${cols.length + 1}"><p class="own"><b>${esc(it.raw.title_plain || stripHtml(it.raw.title || ''))}</b></p>${own.map((k) => (secs[i][k] ? `<p class="own"><b>${esc(secs[i][k].title)} :</b> ${esc(stripHtml(secs[i][k].body))}</p>` : '')).join('')}<p class="own src">Origine du constat : ${originOf({ ...it.raw, display_number: it.display_number })}</p></td></tr>`).join('')}</tbody>
      </table>
    </article>`;
  };
  const domainActions = (keys, heading = 'Les actions de ce domaine') => {
    const cards = keys.map(cardOf).filter(Boolean);
    if (!cards.length) return '';
    // Le titre et la 1re action restent ensemble (pas de titre seul en bas de page)
    const blocks = [];
    for (const c of cards) {
      for (const s of c.subsections || []) {
        const sub = (c.subsections.length > 1 || cards.length > 1) ? `<h3 class="acts-sub">${esc(s.label)} <span class="muted">· ${plural(s.count, 'action', 'actions')}</span></h3>` : '';
        (s.grouped || []).forEach((g, i) => blocks.push({ head: i === 0 ? sub : '', g, group: g.kind === 'group' }));
      }
    }
    const title = `<h2 class="acts-title">${ic('listcheck')}${esc(heading)}</h2>`;
    return `<div class="acts">${blocks.map((bl, i) => (bl.group
      ? groupCard(bl.g, `${i === 0 ? title : ''}${bl.head}`)
      : `<div class="keep">${i === 0 ? title : ''}${bl.head}${actionCard(bl.g.item)}</div>`)).join('')}</div>`;
  };
  const noteBlock = (title, html, plain) => ((html || plain) ? `<div class="note"><span class="note-t">${esc(title)}</span>${rich(html, plain)}</div>` : '');
  const topicNotes = (key) => `${noteBlock('Notes de l’auditeur', d.bmsTopicNotes?.[key])}${noteBlock('Pistes d’amélioration', d.bmsTopicOpportunities?.[key])}`;
  const kvs = (pairs) => pairs.filter(Boolean).map(([k, val]) => (k ? `<span class="kv"><span class="k">${esc(k)}</span> ${val}</span>` : `<span class="kv">${val}</span>`)).join('<span class="sep"> · </span>');
  const box = (kind, icon, html) => `<aside class="box ${kind}">${ic(icon)}<div>${html}</div></aside>`;

  // ─── Couverture ─────────────────────────────────────────────────────────────────────────
  const verdictDot = { compliant: '#00CD92', compliant_reserves: '#FFFFFF', partial: '#F5C259', non_compliant: '#E95369' }[comp.verdict] || '#8499AE';
  const cover = `
  <section class="cover">
    <img class="logo" src="${env.logo.dark}" alt="Buildy">
    <div class="cover-main">
      <p class="kind">${isBacs ? 'Audit de conformité au décret BACS' : 'Audit GTB · préparation devis Buildy'}</p>
      <h1 class="cover-title">${esc(siteName)}</h1>
      <p class="cover-client">${esc(client)}${site.address ? `<br>${esc(site.address)}` : ''}</p>
    </div>
    <div class="cover-verdict">
      <p class="k"><span class="dot" style="background:${verdictDot}"></span>${esc(comp.verdictHeadline || comp.verdictLabel)}</p>
      ${d.applicabilityLabel ? `<p class="v">Échéance du décret : ${esc(d.applicabilityLabel)}.</p>` : ''}
    </div>
    <div class="cover-meta">
      <span><b>${esc(d.exportDate)}</b>Date du rapport</span>
      <span><b>${esc(d.authorName)}</b>Auditeur</span>
      <span><b>${esc(versionLabel)}</b>Version</span>
    </div>
  </section>`;

  // ─── Sommaire, mode d'emploi, sigles ────────────────────────────────────────────────────
  const part2Ids = ['site', 'systemes', 'comptage', ...(isBacs ? ['regulation'] : []), 'gtb', ...(d.showInspectionsChapter ? ['inspection'] : []), ...(cardOf('misc') ? ['autres'] : [])];
  const annexIds = ['annexe-a', 'annexe-b', 'annexe-c', ...((d.reportAttachments || []).length ? ['annexe-d'] : [])];
  const toc = [
    ['Partie 1 · L’essentiel'], ['verdict'], ...(d.synthesisHtml ? [['mot']] : []), ['exigences'], ['plan'],
    ['Partie 2 · Le constat détaillé'], ...part2Ids.map((i) => [i]),
    ['Annexes'], ...annexIds.map((i) => [i]),
  ];
  const ANNEX_LETTER = Object.fromEntries(annexIds.map((id, i) => [id, 'ABCD'[i]]));
  const GLOSSARY = [
    ['BACS', 'système d’automatisation et de contrôle du bâtiment, au sens du décret'],
    ['GTB', 'gestion technique du bâtiment ; désigne ici le BACS du site'],
    ['ECS', 'eau chaude sanitaire'], ['CTA', 'centrale de traitement d’air'],
    ['DRV', 'climatisation à débit de réfrigérant variable'], ['PAC', 'pompe à chaleur'],
    ['TRI', 'temps de retour sur investissement'], ['CEE', 'certificats d’économies d’énergie'],
    ['VMC', 'ventilation mécanique contrôlée'], ['TGBT', 'tableau général basse tension'],
    ['TD', 'tableau divisionnaire'], ['FCU', 'ventilo-convecteur'], ['HS', 'hors service'],
  ];
  const sommaire = `
  <section class="page-sommaire">
    <h1 class="chapter">Sommaire</h1>
    <ol class="toc">${toc.map(([id]) => (TITLES[id]
      ? `<li><a href="#${id}">${ANNEX_LETTER[id] ? `<span class="al">${ANNEX_LETTER[id]}</span>` : ''}${esc(TITLES[id])}</a></li>`
      : `<li class="toc-part">${esc(id)}</li>`)).join('')}</ol>
    <div class="howto">
      <h2>Comment lire ce rapport</h2>
      <p>La partie 1 donne le verdict, les obligations et les actions à mener, pour décider. La partie 2 détaille le constat domaine par domaine, pour l’exploitant et l’entreprise qui réalisera les travaux ; chaque domaine se termine par ses actions, avec leur justification. Les articles du décret figurent en petits repères, comme ${art('R175-3 1°')}.</p>
      <div class="legend">
        <div>${pill('compliant')}<span>L’exigence est remplie.</span></div>
        <div>${pill('reserve')}<span>Remplie, à condition de tenir une obligation dans la durée.</span></div>
        <div>${pill('partial')}<span>Remplie en partie : des actions restent à mener.</span></div>
        <div>${pill('non_compliant')}<span>L’exigence n’est pas remplie : une action est nécessaire.</span></div>
        <div>${pill('unknown')}<span>Information manquante : le verdict reste à confirmer.</span></div>
      </div>
    </div>
    <div class="glossary">
      <h2>Sigles utilisés</h2>
      <dl>${GLOSSARY.filter(([k]) => isBacs || k !== 'BACS').map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    </div>
  </section>`;

  // ─── Partie 1 · Le verdict ──────────────────────────────────────────────────────────────
  const subject = asg.determined && /^subject/.test(asg.status || '');
  const q1Answer = !asg.determined ? 'À confirmer.' : subject || asg.presumed ? 'Oui.' : 'Non.';
  const liab = d.defaultLiability;
  const gaugeSeg = (r) => {
    const [cls] = STATE[r.verdict] || STATE.na;
    return `<div class="seg ${cls}"><span class="bar"></span><span class="lbl">${esc(plainOf(r.code).title)}</span></div>`;
  };
  const st = comp.stats || {};
  const kpi = (v, l, cls = '') => `<div class="kpi ${cls}${Number(v) ? '' : ' zero'}"><b>${esc(nf(v, 0))}</b><span>${esc(l)}</span></div>`;
  const fixesCount = (st.blocking || 0) + (st.major || 0) + (st.minor || 0);
  const er = d.energyReference;
  const verdict = `
  <section class="part-start" id="p1">
    <h1 class="chapter" id="verdict">Le verdict</h1>
    <div class="q">
      <h2><span class="qn">1</span>Le bâtiment est-il concerné par le décret ?</h2>
      <p class="answer">${q1Answer}</p>
      <dl class="steps">
        <div><dt>Puissance retenue</dt><dd><b>${nf(asg.powerKw)} kW</b> (le plus grand du chauffage et du froid)${ps ? ` · chaud cumulé ${nf(ps.heatKw)} kW · froid cumulé ${nf(ps.coolKw)} kW · ${ps.source === 'auto' ? 'calcul automatique' : 'valeur déclarée'}, détail dans ${xref('site')}` : ''}</dd></div>
        ${asg.pcDateLabel ? `<div><dt>Permis de construire</dt><dd><b>${esc(asg.pcDateLabel)}</b></dd></div>` : ''}
        <div><dt>Seuil applicable</dt><dd><b>${esc(asg.thresholdLabel || '—')}</b> → ${esc(asg.conclusion || '')} ${art('R175-2')}</dd></div>
        ${!liab && d.ownershipStructureLabel ? `<div><dt>Structure juridique</dt><dd><b>${esc(d.ownershipStructureLabel)}</b>. La personne assujettie au décret (propriétaire du système de chauffage ou de climatisation) est déterminée système par système (${xref('systemes')}).${d.ownershipNotes ? ` ${esc(d.ownershipNotes)}` : ''}</dd></div>` : ''}
        ${liab ? `<div><dt>Personne assujettie</dt><dd><b>${esc((liab.partyNames || []).join(', ') || '—')}</b>${d.ownershipStructureLabel ? ` · structure : ${esc(d.ownershipStructureLabel)}` : ''}. ${esc(liab.generalExplanation || '')} Elle est déterminée système par système (${xref('systemes')}).${d.ownershipNotes ? ` ${esc(d.ownershipNotes)}` : ''}</dd></div>` : ''}
      </dl>
      ${ps?.discrepancy ? box('warn', 'warn', `<p>La valeur déclarée (${nf(ps.manualKw)} kW) est retenue ; elle s’écarte de ${nf(ps.discrepancyPct, 0)} % du cumul calculé à partir des équipements relevés (${nf(ps.autoKw)} kW).</p>`) : ''}
      ${ps?.incompletePowerNote ? box('warn', 'warn', `<p>${esc(ps.incompletePowerNote)}</p>`) : ''}
      ${isBacs && !asg.determined ? box('warn', 'info', '<p>Assujettissement au décret non déterminé : le statut du bâtiment n’a pas pu être établi (puissance ou date de dépôt du permis de construire à confirmer). Le verdict porte sur les écarts constatés et sera confirmé une fois l’assujettissement déterminé.</p>') : ''}
      <p class="deadline">${ic('calendar')}<span><b>Échéance</b> : ${esc(comp.deadlineCallout || d.applicabilityLabel || '—')}.</span></p>
      ${d.tertiaryDecreeApplies ? box('info', 'info', '<p><b>Décret tertiaire.</b> La surface déclarée dépasse 1 000 m² : le site relève probablement aussi du dispositif Éco Énergie Tertiaire, à confirmer selon la surface consacrée aux activités tertiaires. Les comptages et le suivi énergétique mis en place au titre du décret BACS peuvent alors alimenter les déclarations sur la plateforme OPERAT.</p>') : ''}
    </div>
    <div class="q">
      <h2><span class="qn">2</span>Où en est-il ?</h2>
      <p class="answer">${esc(comp.verdictLabel)}.</p>
      <p>${esc(comp.verdictDetail || '')} ${plural(countV('compliant', 'reserve'), 'exigence remplie', 'exigences remplies')} sur ${reqs.length}${countV('reserve') ? `, dont ${plural(countV('reserve'), 'sous réserve', 'sous réserve')}` : ''}.</p>
      <div class="gauge" style="grid-template-columns: repeat(${reqs.length}, 1fr)">${reqs.map(gaugeSeg).join('')}</div>
      ${(d.pointsToQualify || []).length ? box('warn', 'question', `<p><b>Points à qualifier.</b> Ces informations n’ont pas été communiquées lors de l’audit ; elles peuvent modifier le verdict des exigences concernées.</p><ul>${d.pointsToQualify.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`) : ''}
    </div>
    <div class="q">
      <h2><span class="qn">3</span>Que faut-il faire ?</h2>
      <p class="answer">${fixesCount ? `${plural(fixesCount, 'action', 'actions')} pour atteindre la conformité` : 'Aucune action pour atteindre la conformité'}${st.reserves ? `, ${plural(st.reserves, 'obligation', 'obligations')} à tenir dans la durée` : ''}.</p>
      <div class="kpis">${kpi(st.blocking, 'bloquantes', 'blocking')}${kpi(st.major, 'majeures', 'major')}${kpi(st.minor, 'mineures', 'minor')}${kpi(st.reserves, 'réserves', 'reserve')}</div>
      ${(comp.headlineActions || []).length ? `<h3>Actions prioritaires</h3><ul class="todo">${comp.headlineActions.map((x) => `<li>${sevPill(x)}<span>${esc(x.title_plain || stripHtml(x.title))} ${art(x.r175_article)}</span><a class="see" href="#${anchorOf(x.display_number)}">${esc(x.display_number)}</a></li>`).join('')}</ul>` : ''}
      ${(comp.reservesList || []).length ? `<h3>Obligations à tenir dans la durée</h3><ul class="todo">${comp.reservesList.map((x) => `<li><span class="pill reserve">${ic('clock')}Réserve</span><span>${esc(x.title)} ${art(x.article)}</span>${x.number ? `<a class="see" href="#${anchorOf(x.number)}">${esc(x.number)}</a>` : '<span></span>'}</li>`).join('')}</ul>` : ''}
      <p class="muted">Toutes les actions : ${xref('plan')}.</p>
    </div>
    ${er ? `<div class="q energy-ref">
      <h2>Consommations de référence · année ${esc(er.referenceYear)}</h2>
      <table class="data"><thead><tr><th>Énergie</th><th class="r">Consommation</th><th class="r">Par m²</th><th class="r">Coût sur l’année</th></tr></thead>
      <tbody>${(er.energies || []).map((e) => `<tr><td><b>${esc(e.label)}</b></td><td class="r">${esc(e.totalQuantityFmt)} ${esc(e.unit)}</td><td class="r">${e.ratioPerM2Fmt ? `${esc(e.ratioPerM2Fmt)} ${esc(e.unit)}/m²` : '—'}</td><td class="r">${e.totalCostFmt ? `${esc(e.totalCostFmt)} €` : '—'}</td></tr>`).join('')}</tbody></table>
      ${d.energyMonthlyChartDataUrl ? `<img class="chart" src="${d.energyMonthlyChartDataUrl}" alt="Répartition mensuelle des consommations">` : ''}
      <p class="muted">Base de référence saisie depuis les factures fournies par le client / les preneurs. Elle permettra de mesurer les économies réelles après mise en place du BACS.</p>
    </div>` : ''}
  </section>`;

  const mot = d.synthesisHtml ? `
  <section id="mot">
    <h1 class="chapter">Le mot de l’auditeur</h1>
    <p class="sign">${esc(d.authorName)}, auditeur Buildy${d.synthesisDateFr ? ` · note rédigée le ${esc(d.synthesisDateFr)}` : ''}</p>
    <div class="prose">${d.synthesisHtml}</div>
  </section>` : '';

  // ─── Partie 1 · Les exigences du décret ─────────────────────────────────────────────────
  const actsCell = (r) => {
    const list = actionsFor(r.code);
    if (r.actionsCount) {
      const label = r.actionsReserves === r.actionsCount ? plural(r.actionsCount, 'réserve', 'réserves') : plural(r.actionsCount, 'action', 'actions');
      return `${label}${list.length ? `<br><a class="see" href="#${anchorOf(list[0].display_number)}">${esc(list.length > 1 ? `${list[0].display_number} …` : list[0].display_number)}</a>` : ''}`;
    }
    if (r.seeActionNumber) return `voir <a class="see" href="#${anchorOf(r.seeActionNumber)}">${esc(r.seeActionNumber)}</a>`;
    return '—';
  };
  const exigences = `
  <section id="exigences">
    <h1 class="chapter">Les exigences du décret</h1>
    <p class="lead">Pour chaque exigence : ce que demande le décret, en clair, et la situation constatée sur le site.</p>
    ${d.r175DashboardCommonNote ? box('info', 'info', `<p><b>Constat sur le site pour les exigences ${esc(d.r175DashboardCommonNote.codes || '')} :</b> ${esc(d.r175DashboardCommonNote.text || d.r175DashboardCommonNote)}</p>`) : ''}
    <table class="data req">
      <thead><tr><th>Exigence</th><th>Situation constatée</th><th>Actions</th></tr></thead>
      <tbody>${dash.map((r) => {
        const p = plainOf(r.code);
        const stp = r.verdict === 'info' ? `<span class="pill info">${ic('info')}${esc(r.verdictLabel)}</span>` : pill(r.verdict, r.verdictLabel);
        return `<tr class="v-${esc(r.verdict)}"><td><b>${esc(p.title)}</b> ${art(r.displayCode || r.code)}<br><span class="muted">${esc(r.summary || p.text)}</span>${r.source_url ? ` <a class="ext" href="${esc(r.source_url)}">Légifrance</a>` : ''}${r.evidence?.explanation ? `<span class="evid"><b>Constat :</b> ${esc(r.evidence.explanation)}</span>` : ''}${r.note && !r.noteShared ? `<span class="note-inline"><b>Constat sur le site :</b> ${esc(r.note)}</span>` : ''}</td><td>${stp}</td><td class="acts">${actsCell(r)}</td></tr>`;
      }).join('')}</tbody>
    </table>
  </section>`;

  // ─── Partie 1 · Le plan d'actions (sommaire par domaine) ────────────────────────────────
  const sevCounts = (c) => join([
    c.count - c.reserves ? plural(c.count - c.reserves, 'action', 'actions') : '',
    c.blocking ? `<span class="sd blocking"></span>${plural(c.blocking, 'bloquante', 'bloquantes')}` : '',
    c.major ? `<span class="sd major"></span>${plural(c.major, 'majeure', 'majeures')}` : '',
    c.minor ? `<span class="sd minor"></span>${plural(c.minor, 'mineure', 'mineures')}` : '',
    c.reserves ? `<span class="sd reserve"></span>${plural(c.reserves, 'réserve', 'réserves')}` : '',
  ], ' · ');
  const planRow = (g) => (g.kind === 'group'
    ? `<tr><td class="n">${esc(g.numbers_label || `${g.first_number} à ${g.last_number}`)}</td><td>${esc(g.label)} ${art(g.r175_article)}</td><td>${sevPill(g, g.count)}</td><td class="pgc">${pageOf(`grp-${g.first_number}`)}</td></tr>`
    : `<tr><td class="n">${esc(g.item.display_number)}</td><td>${esc(g.item.title_plain || stripHtml(g.item.title))} ${art(g.item.r175_article)}</td><td>${sevPill(g.item)}</td><td class="pgc">${pageOf(`action-${g.item.display_number}`)}</td></tr>`);
  const as = d.actionStats || {};
  const plan = `
  <section id="plan">
    <h1 class="chapter">Le plan d’actions</h1>
    ${planCards.length ? `
    <p class="lead">${plural(actions.length, 'action', 'actions')}, rangées par domaine. Chacune est détaillée à la fin du chapitre de son domaine, dans la partie 2 : constat, exigence, ce qu’il faut faire et origine du constat.</p>
    ${isBacs ? `<div class="plan-legend">
      ${as.blocking ? `<div><span class="pill sev-blocking"><span class="dot"></span>Bloquante</span><span>Écart qui empêche à lui seul la conformité, par exemple l’absence de GTB ou d’un compteur requis.</span></div>` : ''}
      ${as.major ? `<div><span class="pill sev-major"><span class="dot"></span>Majeure</span><span>Exigence du décret non satisfaite, à traiter pour atteindre la conformité.</span></div>` : ''}
      ${as.minor ? `<div><span class="pill sev-minor"><span class="dot"></span>Mineure</span><span>Recommandation, ou raccordement exigé seulement sous condition de temps de retour sur investissement.</span></div>` : ''}
      ${as.reserves ? `<div><span class="pill reserve">${ic('clock')}Réserve</span><span>Obligation du propriétaire à respecter dans la durée (maintenance, inspection périodique, export des données), sans effet sur la conformité de l’installation.</span></div>` : ''}
    </div>` : ''}
    ${planCards.map((c) => `
      <h2 class="dom">${esc(c.label)} <span class="muted">· ${sevCounts(c)}</span></h2>
      <table class="data plan">
        <thead><tr><th>N°</th><th>Action</th><th>Gravité</th><th class="pgc">Page</th></tr></thead>
        <tbody>${(c.subsections || []).map((s) => `${c.subsections.length > 1 ? `<tr class="sub"><td colspan="4">${esc(s.label)} · ${nf(s.count, 0)}</td></tr>` : ''}${(s.grouped || []).map(planRow).join('')}`).join('')}</tbody>
      </table>`).join('')}` : `<p class="lead">${isBacs ? 'Aucune action corrective à ce stade.' : 'Aucune préconisation à ce stade — la GTB couvre l’intégralité du périmètre.'}</p>`}
    ${(d.exemptionItems || []).length ? box('info', 'info', `<p><b>Systèmes exemptés du raccordement à la GTB (règle des 5 %).</b> Ces systèmes ne donnent lieu à aucune action : les consommations d’énergie effectives et induites de l’ensemble des équipements régulés par la même fonction ont été estimées à moins de 5 % de la consommation d’énergie totale du bâtiment, ce qui permet de ne pas les raccorder à la GTB. Cette part s’apprécie sur tous les équipements concernés du bâtiment, et non système par système (FAQ ministérielle n° 16, non opposable). La justification relevée lors de l’audit figure dans ${xref('systemes')}.</p><ul>${d.exemptionItems.map((x) => `<li><b>${esc(x.title)}</b>${x.zones_label ? ` — ${esc(x.zones_label)}` : ''}${x.justification ? ` (justification relevée : ${esc(x.justification)})` : ''}</li>`).join('')}</ul>`) : ''}
    ${(d.outOfDecreeItems || []).length ? box('info', 'info', `<p><b>Recommandations hors décret (non comptées dans le plan).</b> Ces points ne sont pas exigés par le décret BACS ; ils facilitent l’exploitation de la GTB.</p><ul>${d.outOfDecreeItems.map((x) => `<li><b>${esc(x.title)}.</b> ${esc(x.description)}</li>`).join('')}</ul>`) : ''}
    ${(d.vigilanceItems || []).length ? box('warn', 'warn', `<p><b>Points de vigilance.</b> Ces points ne sont pas des écarts au décret ; ils encadrent la mise en œuvre des actions.</p><ul>${d.vigilanceItems.map((x) => `<li><b>${esc(x.title)}.</b> ${esc(x.description)}</li>`).join('')}</ul>`) : ''}
    ${er ? box('info', 'chart', `<p><b>Base de consommations de référence (année ${esc(er.referenceYear)}) disponible.</b> Saisie depuis les factures du site, elle permettra de mesurer les économies réelles après mise en place du BACS et d’objectiver le retour sur investissement des actions.</p>`) : ''}
    ${planCards.length ? `<p class="sources"><b>Sources d’aide à l’interprétation (non opposables).</b> Les actions reposent sur le <b>décret BACS</b> (articles L. 174-3, L. 175-2 et R. 175-1 à R. 175-6 du code de la construction et de l’habitation, et arrêté du 7 avril 2023 : seuls textes juridiquement opposables), éclairé par : <i>Guide d’application du décret BACS</i> (ministère, version 2, janvier 2026) ; <i>FAQ BACS</i> du ministère ; <i>Guide pratique d’application du décret BACS</i> (PROFEEL, novembre 2025).</p>` : ''}
  </section>`;

  const divider = (id, title, items, note) => `
  <section class="divider" id="${id}">
    <img class="logo" src="${env.logo.darkNoTagline}" alt="">
    <div>
      <h1 class="divider-title">${esc(title)}</h1>
      ${note ? `<p class="divider-note">${esc(note)}</p>` : ''}
      <ol class="divider-list">${items.map((i) => `<li><a href="#${i}">${ANNEX_LETTER[i] ? `${ANNEX_LETTER[i]} · ` : ''}${esc(TITLES[i])}</a></li>`).join('')}</ol>
    </div>
  </section>`;

  // ─── Partie 2 · Le site et ses zones ────────────────────────────────────────────────────
  const zf = d.zonesFunctional || [];
  const zt = d.zonesTechnical || [];
  const facts = [
    ['Site', siteName], ['Client', client], site.address ? ['Adresse', site.address] : null, site.coords_label ? ['Coordonnées GPS', site.coords_label] : null,
    d.siteSurfaceM2 ? ['Surface des zones', `${nf(d.siteSurfaceM2, 0)} m²`] : null,
    isBacs && doc.bacs_total_power_kw != null ? ['Puissance retenue', `${nf(ps ? ps.effectiveKw : doc.bacs_total_power_kw)} kW`] : null,
    isBacs && doc.bacs_district_heating_substation_kw ? ['Station d’échange (réseau urbain)', `${nf(doc.bacs_district_heating_substation_kw)} kW · référence R175-2`] : null,
    isBacs && doc.bacs_building_permit_date ? ['Permis de construire', frDate(doc.bacs_building_permit_date)] : null,
    isBacs && d.applicabilityLabel ? ['Échéance du décret', d.applicabilityLabel, 'wide'] : null,
  ].filter(Boolean);
  const hcb = d.heatingCoolingBreakdown || [];
  const powerCell = (x) => {
    const out = [];
    if (x.power_kw) out.push(`${nf(x.has_multiple ? x.total_power_kw : x.power_kw)} kW${x.power_kw_cooling ? ' chaud' : ''}`);
    if (x.power_kw_cooling) out.push(`${nf(x.has_multiple ? x.total_power_kw_cooling : x.power_kw_cooling)} kW froid`);
    if (x.power_missing) out.push('<span class="muted">non renseignée</span>');
    return out.map((o) => `<span class="nw">${o}</span>`).join('<br>') || '—';
  };
  const countedCell = (x) => {
    if (x.power_missing) return '<b class="nw">Non comptée</b>';
    if (x.in_scope) return join([x.heat_contrib ? `<span class="nw"><b>+${nf(x.heat_contrib)} kW</b> chaud</span>` : '', x.cool_contrib ? `<span class="nw"><b>+${nf(x.cool_contrib)} kW</b> froid</span>` : ''], '<br>') || '0 kW';
    return '<span class="nw">Hors cumul</span>';
  };
  const powerDetail = (x) => kvs([
    x.brand || x.model_reference ? ['', `<b>${esc(join([x.brand, x.model_reference], ' · '))}</b>`] : null,
    x.has_multiple ? ['Unités', x.power_missing ? `${nf(x.quantity, 0)} unités` : join([x.power_kw ? `${nf(x.quantity, 0)} × ${nf(x.power_kw)} kW` : '', x.power_kw_cooling ? `${nf(x.quantity, 0)} × ${nf(x.power_kw_cooling)} kW froid` : ''], ', ')] : null,
    x.sharedWithLabel ? ['Dessert aussi', esc(x.sharedWithLabel)] : null,
    x.power_missing ? ['', 'puissance à relever'] : null,
    !x.power_missing && !x.in_scope && x.exclusion_reason_label ? ['Hors cumul', esc(x.exclusion_reason_label)] : null,
  ]);
  const zoneNotes = (list, title) => {
    const withNotes = list.filter((z) => z.notes_html || z.notes || (z.photos || []).length || z.comfort_constraint);
    if (!withNotes.length) return '';
    return `<h3>${esc(title)}</h3>${withNotes.map((z) => `<div class="elem">
      <div class="elem-body"><h4>${esc(z.name)}</h4>${z.comfort_constraint ? `<p><b>Contrainte de confort :</b> ${esc(z.comfort_constraint_display || z.comfort_constraint)}</p>` : ''}${rich(z.notes_html, z.notes)}</div>${photos(z.photos)}</div>`).join('')}`;
  };
  const fz = d.functionalZones || {};
  const ch1 = `
  <section id="site" class="chapter-start">
    <h1 class="chapter">Le site et ses zones</h1>
    <dl class="facts">${facts.map(([k, v, cls]) => `<div${cls ? ` class="${cls}"` : ''}><dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl>
    ${(d.siteParties || []).length ? `
    <h2>Structure juridique et parties prenantes</h2>
    ${d.ownershipStructureLabel ? `<p>Structure de propriété et d’occupation : <b>${esc(d.ownershipStructureLabel)}</b>. La personne assujettie au décret BACS (propriétaire du système de chauffage ou de climatisation) est déterminée système par système (${xref('systemes')}).${d.ownershipNotes ? ` ${esc(d.ownershipNotes)}` : ''}</p>` : ''}
    <table class="data"><thead><tr><th>Partie prenante</th><th>Rôle</th><th>Contact</th><th>Zones rattachées</th></tr></thead>
    <tbody>${d.siteParties.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.kindLabel)}</td><td>${esc(p.contact_email || '—')}</td><td>${esc((p.zoneNames || []).join(', ') || '—')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${isBacs && hcb.length ? `
    <h2>Le calcul de la puissance ${art('R175-2')}</h2>
    <p class="small">Cumul des puissances nominales utiles chaud et froid des équipements relevés (${xref('systemes')}). Certains équipements sont <b>hors cumul</b>, la raison figure sur leur ligne. Cas courant : un émetteur alimenté en eau chaude ou glacée (radiateur à eau, aérotherme à eau, ventilo-convecteur) dont la puissance est déjà comptée sur son générateur — l’additionner ferait un double comptage ; les radiateurs électriques et les aérothermes à gaz, qui produisent eux-mêmes la chaleur, sont comptés. Sont aussi exclus les équipements de secours (FAQ BACS n° 8), les usages autres que le chauffage et la climatisation, et l’aval d’un réseau de chaleur. La puissance retenue est le maximum entre le cumul chaud et le cumul froid (FAQ BACS n° 11).</p>
    <table class="data pw">
      <thead><tr><th>Équipement</th><th>Usage</th><th>Zone</th><th class="r">Puissance nominale</th><th class="r">Pris en compte</th></tr></thead>
      <tbody>${hcb.map((x) => { const det = powerDetail(x); return `<tr class="${det ? 'has-sub' : ''}"><td><b>${esc(x.name)}</b></td><td>${usagePill(x.category, x.categoryLabel)}</td><td>${esc(x.zone_name || '—')}</td><td class="r">${powerCell(x)}</td><td class="r">${countedCell(x)}</td></tr>${det ? `<tr class="det"><td colspan="5"><p class="kvl">${det}</p></td></tr>` : ''}`; }).join('')}
        <tr class="tot"><td colspan="4">Cumul chaud retenu</td><td class="r">${nf(d.powerRecap?.heatRetained)} kW</td></tr>
        <tr class="tot"><td colspan="4">Cumul froid retenu</td><td class="r">${nf(d.powerRecap?.coolRetained)} kW</td></tr>
        <tr class="tot strong"><td colspan="4">Puissance retenue (le plus grand du chaud et du froid)</td><td class="r">${nf(d.powerRecap?.retained)} kW</td></tr>
      </tbody>
    </table>
    ${ps?.incompletePowerNote ? `<p class="muted">${esc(ps.incompletePowerNote)}</p>` : ''}` : ''}
    <h2>Les zones fonctionnelles ${isBacs ? art('R175-1 6°') : ''}</h2>
    ${d.zonesMap?.dataUrl ? `<figure class="map"><img src="${d.zonesMap.dataUrl}" alt="Vue satellite des zones"><figcaption>${(d.zonesMap.legend || []).map((l) => `<span><b style="background:${esc(l.color)}">${esc(l.initial)}</b>${esc(l.name)}</span>`).join('')}<span class="muted">Vue satellite : chaque repère renvoie à une zone du tableau.</span></figcaption></figure>`
      : d.siteMapDataUrl ? `<figure class="map"><img src="${d.siteMapDataUrl}" alt="Vue satellite du site"><figcaption><span class="muted">Vue satellite du site — repère du bâtiment principal.</span></figcaption></figure>` : ''}
    ${(d.zones || []).length ? '' : '<p>Aucune zone définie.</p>'}
    ${zf.length ? `<table class="data"><thead><tr><th>Zone</th><th>Nature</th><th>Régime d’activité</th><th class="r">Surface</th></tr></thead>
    <tbody>${zf.map((z) => `<tr><td>${z.mapInitial ? `<span class="zpin" style="background:${esc(z.mapColor)}">${esc(z.mapInitial)}</span>` : ''}<b>${esc(z.name)}</b></td><td>${esc(z.natureLabel)}</td><td>${esc(z.occupancyLabel || '—')}</td><td class="r">${z.surface_m2 ? `${nf(z.surface_m2, 0)} m²` : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    ${zoneNotes(zf, 'Notes terrain par zone')}
    ${zt.length ? `
    <h3>Les locaux techniques</h3>
    <p class="small muted">Les locaux techniques (tableaux électriques, locaux de comptage, chaufferies…) ne sont pas retenus comme zones fonctionnelles dans cet audit (méthode Buildy, ${xref('annexe-b')}). Ils sont listés ici pour situer les compteurs et les organes de coupure ; les équipements qu’ils abritent restent dans le champ du décret.</p>
    <table class="data"><thead><tr><th>Local</th><th>Nature</th><th class="r">Surface</th></tr></thead>
    <tbody>${zt.map((z) => `<tr><td><b>${esc(z.name)}</b></td><td>${esc(z.natureLabel)}</td><td class="r">${z.surface_m2 ? `${nf(z.surface_m2, 0)} m²` : '—'}</td></tr>`).join('')}</tbody></table>
    ${zoneNotes(zt, 'Notes terrain par local technique')}` : ''}
    ${fz.mergedCount ? `
    <h3>Le regroupement par usage technique</h3>
    <p class="small">Le décret définit la zone fonctionnelle comme « toute zone dans laquelle les usages sont homogènes » ${art('R175-1 6°')}. Lorsque des espaces sont desservis par un même équipement sans comptage séparable, ils sont regroupés en une seule zone de suivi ; le découpage peut varier selon le système technique (FAQ BACS n° 25).</p>
    <table class="data regroup"><thead><tr><th>Usage</th><th>Zones fonctionnelles de suivi</th></tr></thead><tbody>
    ${(fz.byCategory || []).filter((c) => c.functional_zone_count > 0).map((c) => `<tr><td>${usagePill(c.category, c.categoryLabel)}<br><span class="muted nw">${plural(c.physical_zone_count, 'zone d’usage', 'zones d’usage')} → ${plural(c.functional_zone_count, 'zone de suivi', 'zones de suivi')}</span></td><td>${(c.groups || []).map((g) => `<div class="grp"><b>${esc(g.label)}</b>${g.merged && g.justification ? ` — ${esc(g.justification)}` : ''}${g.separateMetersPresent ? ' <span class="warn-t">Des compteurs séparés sont toutefois présents dans plusieurs de ces zones : regroupement à confirmer.</span>' : ''}</div>`).join('')}</td></tr>`).join('')}
    </tbody></table>` : ''}
    ${domainActions(['identification'])}
  </section>`;

  // ─── Partie 2 · Les systèmes techniques ─────────────────────────────────────────────────
  const SYS_STATE = { compliant: 'compliant', non_compliant: 'non_compliant', conditional: 'conditional', exempt: 'exempt', shared: 'shared', na: 'na' };
  const devPower = (v) => {
    const out = [];
    if (v.power_kw) out.push(`<span class="nw">${nf(v.has_multiple ? v.total_power_kw : v.power_kw)} kW${v.power_kw_cooling ? ' chaud' : ''}</span>`);
    if (v.power_kw_cooling) out.push(`<span class="nw">${nf(v.has_multiple ? v.total_power_kw_cooling : v.power_kw_cooling)} kW froid</span>`);
    if (!v.power_kw && !v.power_kw_cooling) out.push('<span class="muted nw">non renseignée</span>');
    return out.join('<br>');
  };
  // Raison « hors cumul » : une fois pour le système quand tous ses équipements la partagent
  const sysOutReason = (it) => {
    const reasons = (it.devices || []).map((v) => (v.powerCalc && !v.powerCalc.inScope ? v.powerCalc.reasonLabel || '' : null));
    return reasons.length && reasons.every((r) => r && r === reasons[0]) ? reasons[0] : null;
  };
  // Trois colonnes courtes : communique, arrêt manuel, fonctionnement autonome (R175-3 3° et 4°)
  const r175Cells = (v, it) => {
    if (!it.is_bacs) return '<td class="c">—</td><td class="c">—</td><td class="c">—</td>';
    const neutral = !!it.marked_negligible_under_5pct;
    if (v.p4NotApplicable) return `<td class="c">${mark(v.commTri, { neutral })}</td><td class="c"><span class="mk na">sans objet</span></td><td class="c"><span class="mk na">sans objet</span></td>`;
    return `<td class="c">${mark(v.commTri, { neutral })}</td><td class="c">${mark(v.meets_r175_3_p4)}</td><td class="c">${mark(v.meets_r175_3_p4_autonomous)}</td>`;
  };
  const devDetail = (v, sysReason) => {
    const qty = (kw) => `${nf(v.quantity, 0)} × ${nf(kw)} kW`;
    const calc = !v.powerCalc ? '' : v.powerCalc.inScope
      ? esc(v.power_kw || v.power_kw_cooling ? v.powerCalc.typeLabel : 'non comptée tant que la puissance n’est pas relevée')
      : `hors cumul${!sysReason && v.powerCalc.reasonLabel ? ` : ${esc(v.powerCalc.reasonLabel)}` : ''}`;
    const regulator = v.regulation_integrated === 0 && (v.regulator_brand || v.regulator_model_reference || v.regulator_location_production || v.regulator_location_distribution || v.regulator_location_emission)
      ? join([esc(join([v.regulator_brand, v.regulator_model_reference], ' · ')), v.regulator_location_production ? `production : ${esc(v.regulator_location_production)}` : '', v.regulator_location_distribution ? `distribution : ${esc(v.regulator_location_distribution)}` : '', v.regulator_location_emission ? `émission : ${esc(v.regulator_location_emission)}` : ''], ' · ') : '';
    return kvs([
      v.out_of_service ? ['', '<span class="tag bad">Hors service</span>'] : null,
      v.is_backup ? ['', '<span class="tag">Secours</span>'] : null,
      v.bms_integration_out_of_service ? ['', '<span class="tag bad">Liaison GTB hors service</span>'] : null,
      v.brand || v.model_reference ? ['', `<b>${esc(join([v.brand, v.model_reference], ' '))}</b>`] : null,
      ['Énergie', esc(v.energyLabel || '—')],
      ['Fonctions', esc(roles(v.device_role).toLowerCase() || '—')],
      v.has_multiple && (v.power_kw || v.power_kw_cooling) ? ['Unités', join([v.power_kw ? qty(v.power_kw) : '', v.power_kw_cooling && v.power_kw_cooling !== v.power_kw ? `${qty(v.power_kw_cooling)} froid` : ''], ', ')] : v.has_multiple ? ['Unités', nf(v.quantity, 0)] : null,
      calc ? ['Puissance', calc] : null,
      v.is_communicating && (v.wired === 0 || v.wired === 1) ? ['Liaison', v.wired === 1 ? 'filaire' : 'sans fil'] : null,
      v.sharedWithLabel ? ['Dessert aussi', esc(v.sharedWithLabel)] : null,
      v.gtb_scope_override === 0 || v.gtb_scope_override === false ? ['Raccordement à la GTB', `pas à raccorder${String(v.gtb_exclusion_reason || '').trim() ? ` — ${esc(v.gtb_exclusion_reason.trim())}` : ''}`] : null,
      ['Localisation', esc(v.location || '—')],
      v.has_regulation || v.regulation_integrated != null || v.regulator_brand || v.regulator_model_reference ? ['Régulation', v.regulation_integrated === 1 ? 'intégrée' : v.regulation_integrated === 0 ? 'déportée' : '—'] : null,
      regulator ? ['Régulateur déporté', regulator] : null,
      v.age_years ? ['Âge', plural(v.age_years, 'an', 'ans')] : null,
      [1, 0, 'yes', 'no'].includes(v.metering_separable) ? ['Mesurage séparable', `${isYes(v.metering_separable) ? 'oui' : 'non'}${v.metering_separable_note ? ` — ${esc(v.metering_separable_note)}` : ''}`] : null,
    ]);
  };
  const devRows = (it) => {
    const sysReason = sysOutReason(it);
    const rows = (it.devices || []).map((v) => `<tr class="dev${v.out_of_service ? ' hs' : ''}">
        <td><b>${esc(v.name)}</b>${v.has_multiple ? ` <span class="qty">× ${nf(v.quantity, 0)}</span>` : ''}</td>
        <td class="r">${devPower(v)}</td>
        <td>${esc(v.commLabel || '—')}</td>
        ${r175Cells(v, it)}
      </tr>
      <tr class="det${v.out_of_service ? ' hs' : ''}"><td colspan="6"><div class="elem"><div class="elem-body"><p class="kvl">${devDetail(v, sysReason)}</p>${rich(v.notes_html, v.notes)}</div>${photos(v.photos)}</div></td></tr>`);
    const shared = (it.shared_devices || []).map((v) => `<tr class="dev shared">
        <td><b>${esc(v.name)}</b> <span class="tag">${ic('swap')}partagé</span></td>
        <td class="r"><span class="muted nw">${v.powerCalc?.inScope ? 'comptée à l’origine' : 'voir l’origine'}</span></td>
        <td>${esc(v.commLabel || '—')}</td>
        ${r175Cells(v, it)}
      </tr>
      <tr class="det shared"><td colspan="6"><p class="kvl">${kvs([
        v.out_of_service ? ['', '<span class="tag bad">Hors service</span>'] : null,
        v.brand || v.model_reference ? ['', `<b>${esc(join([v.brand, v.model_reference], ' '))}</b>`] : null,
        ['Partagé depuis', `${esc(v.sharedFromLabel)} (fiche complète, puissance et photos dans le système d’origine)`],
        ['Fonctions', esc(roles(v.device_role).toLowerCase() || '—')],
        !v.powerCalc?.inScope && v.powerCalc?.reasonLabel ? ['Puissance', `hors cumul : ${esc(v.powerCalc.reasonLabel)}`] : null,
      ])}</p></td></tr>`);
    return rows.join('') + shared.join('');
  };
  const sysBlock = (it) => {
    const c = it.compliance;
    const power = it.power_differs
      ? `${it.retained_power_kw ? `${nf(it.retained_power_kw)} kW retenus` : 'Hors cumul'} (${nf(it.total_power_kw)} kW installés)`
      : it.display_power_kw ? `${nf(it.display_power_kw)} kW` : '';
    const flags = join([
      it.serves_multiple_buildings ? '<span class="tag">Dessert plusieurs bâtiments</span>' : '',
      it.is_district_heating_substation ? '<span class="tag">Sous-station de réseau urbain</span>' : '',
      it.managed_by_bms ? '<span class="tag">Géré par la GTB</span>' : '',
      it.is_looped === 'looped' ? '<span class="tag">Bouclée</span>' : '',
      it.is_looped === 'not_looped' ? '<span class="tag">Sans boucle</span>' : '',
    ], ' ');
    const count = it.device_count ? `${plural(it.device_count, 'équipement', 'équipements')}${it.shared_device_count ? ` dont ${plural(it.shared_device_count, 'partagé', 'partagés')}` : ''}` : 'Équipements non détaillés';
    const short = (it.devices || []).length + (it.shared_devices || []).length <= 5;
    return `
    <div class="sys${short ? ' short' : ''}">
      <div class="sys-head">
        ${uIcon(it.system_category)}<h3>${esc(it.displayLabel)}</h3>
        <span class="sys-meta">${join([power, count, sysOutReason(it) ? `puissance hors cumul : ${esc(sysOutReason(it))}` : ''], ' · ')}</span>
        ${c ? pill(SYS_STATE[c.verdict] || 'na', { compliant: 'Conforme', non_compliant: 'Non conforme', conditional: 'Sous condition', exempt: 'Exempté (règle des 5 %)', shared: 'Évalué avec son système d’origine', na: 'Non concerné' }[c.verdict]) : ''}
      </div>
      ${flags ? `<div class="flags">${flags}</div>` : ''}
      ${c ? `<p class="reasons"><b>${esc(c.label)}.</b> ${(c.reasons || []).map(esc).join(' ')}</p>` : ''}
      ${it.system_category === 'dhw' && it.is_looped === 'looped' ? box('warn', 'warn', '<p><b>Eau chaude sanitaire bouclée — point de vigilance sanitaire.</b> En période d’occupation, et dans les 24 heures qui précèdent l’utilisation, les températures de production et de distribution fixées par l’arrêté du 30 novembre 2005 doivent être respectées (risque lié aux légionelles). Un arrêt n’est envisageable que pendant une inoccupation de plusieurs semaines, suivi d’une remise en service selon les recommandations sanitaires. Les commandes d’arrêt ou de réduction pilotées par la GTB en tiennent compte (guide PROFEEL, non opposable).</p>') : ''}
      ${it.marked_negligible_under_5pct ? `<p class="small"><b>Règle des 5 %.</b> Le raccordement à la GTB n’est pas exigé lorsque les consommations d’énergie effectives et induites (par exemple, les pertes thermiques par extraction pour la ventilation) de l’ensemble des équipements régulés par la même fonction représentent moins de 5 % de la consommation d’énergie totale du bâtiment. Cette part s’apprécie sur tous les équipements concernés du bâtiment, et non système par système (FAQ ministérielle n° 16, non opposable).${it.negligible_justification ? ` Justification relevée : ${esc(it.negligible_justification)}.` : ''}</p>` : ''}
      ${it.liability && d.hasLiabilityData && !it.liabilityIsDefault ? `<p class="small">${ic('liable')} <b>${esc(it.liability.label)}.</b> ${esc(it.liability.explanation || '')}</p>` : ''}
      ${(it.devices || []).length || (it.shared_devices || []).length ? `<table class="data devt">
        <thead><tr><th>Équipement</th><th class="r">Puissance</th><th>Communication</th><th class="c">Communique</th><th class="c">Arrêt manuel</th><th class="c">Autonome</th></tr></thead>
        <tbody>${devRows(it)}</tbody></table>` : '<p class="muted">Système présent sur site ; ses équipements n’ont pas été détaillés lors de l’audit.</p>'}
      ${it.notes_html || it.notes || (it.photos || []).length ? `<div class="elem">${`<div class="elem-body">${noteBlock('Notes sur le système', it.notes_html, it.notes)}</div>`}${photos(it.photos)}</div>` : ''}
    </div>`;
  };
  const ch2 = `
  <section id="systemes" class="chapter-start">
    <h1 class="chapter">Les systèmes techniques ${isBacs ? art('R175-1 4°') : ''}</h1>
    <p class="lead">Zone par zone, les usages présents et leurs équipements. Pour chaque équipement, trois points de la GTB : il communique avec elle, il peut être arrêté à la main depuis elle, et il continue de fonctionner si elle s’arrête ${art('R175-3')}.</p>
    ${isBacs && d.hasLiabilityData && d.defaultLiability ? box('info', 'liable', `<p><b>Sauf mention contraire sur un système — ${esc(d.defaultLiability.label)}.</b> ${esc(d.defaultLiability.generalExplanation || '')}</p>`) : ''}
    ${d.hasConditionalSystems ? box('info', 'clock', '<p><b>Systèmes raccordés sous condition.</b> Dans un bâtiment existant, le raccordement à la GTB de certains systèmes n’est exigé que s’il est réalisable avec un temps de retour sur investissement inférieur à dix ans, déduction faite des aides financières publiques (R175-2 II). Ces systèmes sont signalés ci-dessous ; leurs écarts figurent au plan d’actions en actions mineures, avec cette condition d’application.</p>') : ''}
    ${(d.zonesOutOfBacsScope || []).length ? box('info', 'info', `<p><b>Zones sans système technique relevé :</b> aucun système de chauffage, de climatisation, d’eau chaude sanitaire, de ventilation, d’éclairage ou de production d’énergie n’a été relevé dans <b>${esc(d.zonesOutOfBacsScope.map((z) => z.name || z.zone_name || z).join(', '))}</b>.</p>`) : ''}
    ${(d.systemsByZone || []).filter((z) => !z.allAbsent).map((z) => {
      // Le titre de zone reste avec son premier système (pas de titre seul en bas de page)
      const head = `<h2>${esc(z.zone_name)}</h2>
      ${(z.absentLabels || []).length || (z.unansweredLabels || []).length ? `<p class="absent">${(z.absentLabels || []).length ? `Usages absents : ${z.absentLabels.map((x) => `${uIcon(x.system_category)}${esc(x.categoryLabel)}`).join(', ')}.` : ''}${(z.unansweredLabels || []).length ? ` Présence non renseignée : ${z.unansweredLabels.map((x) => `${uIcon(x.system_category)}${esc(x.categoryLabel)}`).join(', ')}.` : ''}</p>` : ''}`;
      const blocks = (z.items || []).filter((i) => i.present).map(sysBlock);
      return `
    <div class="zone">
      ${blocks.length && blocks[0].includes('class="sys short"') ? `<div class="keep">${head}${blocks[0]}</div>${blocks.slice(1).join('')}` : `${head}${blocks.join('')}`}
    </div>`;
    }).join('')}
    ${domainActions(['systems'])}
  </section>`;

  // ─── Partie 2 · Le comptage ─────────────────────────────────────────────────────────────
  const meterRows = (m) => {
    const usage = `${usagePill(m.isGeneral ? 'other' : m.usage, m.isGeneral ? 'Général' : m.usageLabel)}${m.thermalName ? ` <b>${esc(m.thermalName)}</b>` : ''}`;
    const required = m.notRequiredReason ? '<span class="muted">Non requis</span>' : m.coveredByGroup ? '<span class="muted">Commun</span>' : mark(m.required, { neutral: true });
    const present = mark(m.present_actual, { neutral: !isYes(m.required) });
    const cells = m.isPresent
      ? `<td>${mark(m.communicating)}</td><td>${esc(m.protocolsLabel || '—')}</td><td>${mark(m.wired)}</td><td>${m.bms_integration_out_of_service ? '<span class="mk bad">HS</span>' : mark(m.managed_by_bms)}</td>`
      : `<td colspan="4" class="muted">${m.presenceState === 'no' ? 'Sans objet : compteur absent' : 'Présence à vérifier'}</td>`;
    const subs = [
      m.purpose && !m.coveredByGroup ? `${esc(m.purpose)}.` : '',
      m.notRequiredReason ? `Non requis : ${esc(m.notRequiredReason)}.` : '',
      m.coveredByGroup ? `Zone regroupée : comptage commun à ${esc(m.coveredByGroup)}${m.coveredLeadZone ? ` (voir le compteur de ${esc(m.coveredLeadZone)})` : ''} ; aucun compteur propre n’est exigé.` : '',
      m.mergedLeadGroup ? `Zone regroupée : compteur unique de la zone ${esc(m.mergedLeadGroup)}.` : '',
      m.recommendation ? `Recommandation : ${esc(m.recommendation)}` : '',
    ].filter(Boolean);
    return `<tr class="${m.out_of_service ? 'hs' : ''}${m.complianceFailed ? ' nc' : ''}${subs.length ? ' has-sub' : ''}"><td>${usage}</td><td>${required}</td><td>${present}</td><td>${esc(m.locationLabel || '—')}</td>${cells}${d.metersAnyOutOfService ? `<td>${m.out_of_service ? '<span class="mk bad">HS</span>' : '—'}</td>` : ''}</tr>${subs.length ? `<tr class="msub"><td colspan="${d.metersAnyOutOfService ? 9 : 8}">${subs.join(' ')}</td></tr>` : ''}`;
  };
  const meg = d.meterEnergyGroups || [];
  const ch3 = `
  <section id="comptage" class="chapter-start">
    <h1 class="chapter">Le comptage ${isBacs ? art('R175-3 1°') : ''}</h1>
    ${isBacs ? `<p class="lead">La GTB doit <b>suivre, enregistrer et analyser en continu</b>, <b>par zone fonctionnelle</b> et <b>heure par heure</b>, la production et la consommation d’énergie des systèmes qui lui sont reliés, et garder ces données mois par mois pendant <b>cinq ans</b> ${art('R175-3 1°')}. Le décret ne fixe pas de nombre minimal de compteurs : il en faut autant que nécessaire pour obtenir ces données (FAQ BACS n° 26). Le plan de comptage ci-dessous est celui que Buildy préconise ; un compteur « requis mais manquant » est un point de mesure prévu par ce plan mais absent du site, traité dans les actions de ce domaine.</p>` : ''}
    ${meg.length ? `
    <div class="kpis">${kpi((d.metersForPdf || []).filter((m) => isYes(m.required)).length, 'compteurs requis')}${kpi((d.metersForPdf || []).filter((m) => isYes(m.required) && m.isPresent).length, 'requis présents', 'good')}${kpi(meg.reduce((n, g) => n + (g.stats.missing || 0), 0), 'requis manquants', 'blocking')}${kpi((d.metersForPdf || []).filter((m) => m.isPresent && isYes(m.managed_by_bms)).length, 'relevés par la GTB')}</div>
    ${isBacs ? `<p class="colkey"><b>Requis</b> : prévu par le plan de comptage Buildy · <b>Présent</b> : installé sur le site · <b>Communique</b> : peut transmettre ses relevés · <b>Câblé</b> : raccordé physiquement à la GTB · <b>Relevé GTB</b> : ses données remontent réellement dans la GTB et y sont exploitées · <b>—</b> : sans objet${d.metersAnyOutOfService ? ' · <b>HS</b> : hors service' : ''}.</p>` : ''}
    ${meg.map((g) => {
      const e = energyHead(g.energy);
      const s = g.stats || {};
      return `<div class="meg">
      <h2 class="energy" style="--energy:${e.color}"><span style="color:${e.color}">${e.icon}</span>${esc(e.label)} <span class="muted">· ${join([plural(s.total, 'point de comptage', 'points de comptage'), s.present ? plural(s.present, 'compteur en service', 'compteurs en service') : 'aucun compteur en service', s.hs ? `${nf(s.hs, 0)} hors service` : '', s.missing ? plural(s.missing, 'requis manquant', 'requis manquants') : '', s.unanswered ? `${nf(s.unanswered, 0)} à qualifier` : '', s.covered ? plural(s.covered, 'couvert par une zone regroupée', 'couverts par une zone regroupée') : ''], ' · ')}</span></h2>
      <table class="data met"><thead><tr><th>Ce qu’il mesure</th><th>Requis</th><th>Présent</th><th>Emplacement</th><th>Communique</th><th>Protocole</th><th>Câblé</th><th>Relevé GTB</th>${d.metersAnyOutOfService ? '<th>Hors service</th>' : ''}</tr></thead>
      <tbody>${(g.zones || []).map((z) => `<tr class="zrow"><td colspan="${d.metersAnyOutOfService ? 9 : 8}">${z.is_general ? ic('building') : ''}${esc(z.zone_name)} <span class="muted">· ${plural((z.items || []).length, 'compteur', 'compteurs')}</span></td></tr>${(z.items || []).map(meterRows).join('')}`).join('')}</tbody></table></div>`;
    }).join('')}` : ''}
    ${(d.meters || []).length > (d.metersForPdf || []).length ? `<p class="muted small">Note : ${plural(d.meters.length - d.metersForPdf.length, 'compteur ni requis ni présent figure', 'compteurs ni requis ni présents figurent')} pour mémoire dans les tableaux ci-dessus, hors du plan de comptage.</p>` : ''}
    ${(d.metersWithDetails || []).length ? `<h3>Notes terrain et photos</h3>${d.metersWithDetails.map((m) => `<div class="elem"><div class="elem-body"><h4>${usagePill(m.isGeneral ? 'other' : m.usage, m.isGeneral ? 'Général' : m.usageLabel)} ${esc(m.typeLabel)} · ${esc(m.zoneLabel)}${m.thermalName ? ` — ${esc(m.thermalName)}` : ''}</h4>${rich(m.notes_html, m.notes)}</div>${photos(m.photos)}</div>`).join('')}` : ''}
    ${(d.metersForPdf || []).length ? '' : '<p>Aucun compteur n’a été relevé ni prévu pour ce site.</p>'}
    ${domainActions(['meters'])}
  </section>`;

  // ─── Partie 2 · La régulation du chauffage ──────────────────────────────────────────────
  const r6 = d.r175_6_applicable || {};
  const R6_RULE = 'L’article R175-6, qui applique l’article L. 175-2, impose aux propriétaires des émetteurs de chauffage reliés à un générateur de chaleur installé ou remplacé une régulation automatique de la température par pièce ou, si cela est justifié, par zone chauffée. Elle vise : (1) les bâtiments dont le permis de construire a été déposé à partir du 22 juillet 2021 ; (2) les autres bâtiments, dès que des travaux d’installation ou de remplacement d’un générateur de chaleur y sont engagés depuis cette date, sauf étude établissant que cette régulation n’est pas réalisable avec un temps de retour sur investissement inférieur à six ans. Seul le chauffage est visé ; les appareils indépendants de chauffage au bois ne sont pas concernés.';
  const r6Box = r6.applies
    ? box('law', 'info', `<p><b>L’exigence s’applique</b> — ${esc(r6.reason)}.</p><p class="small"><i>Ce qu’impose le décret.</i> Pour chaque système de chauffage concerné, les émetteurs doivent disposer d’une régulation automatique de la température par pièce ou, si cela est justifié, par zone chauffée${r6.byWorks ? ' (émetteurs reliés au générateur installé ou remplacé)' : ''} — article R175-6, qui applique l’article L. 175-2. ${r6.byWorks ? 'Pour ce bâtiment (R175-6 II 2°), l’obligation ne s’applique pas si une étude établit que cette régulation n’est pas réalisable avec un temps de retour sur investissement inférieur à six ans.' : 'Ce bâtiment relève du 1° de l’article R175-6 (permis de construire déposé à partir du 22 juillet 2021) : aucune dispense fondée sur le temps de retour sur investissement ne s’applique ; la dispense de six ans ne concerne que les autres bâtiments (R175-6 II 2°).'} Le refroidissement n’est pas visé.</p>`)
    : r6.undetermined
      ? box('warn', 'question', `<p><b>Applicabilité à confirmer</b> — ${esc(r6.reason)}.</p><p class="small"><i>Ce qu’impose le décret.</i> ${R6_RULE}</p><p class="small"><i>Constats de l’audit.</i> ${r6.permitDateFr ? `Permis de construire : <b>${esc(r6.permitDateFr)}</b>.` : 'Date du permis de construire non communiquée.'} ${r6.worksDateFr ? `Derniers travaux sur le générateur de chaleur : <b>${esc(r6.worksDateFr)}</b>.` : 'Date des derniers travaux sur le générateur de chaleur non communiquée.'} ${(r6.recentGeneratorVigilance || []).length ? `Générateur de chaleur d’installation récente relevé sur site : ${r6.recentGeneratorVigilance.map((g) => `${esc(g.zone)}, installé vers ${esc(g.installYear)}`).join(' ; ')}.` : ''} Si des travaux d’installation ou de remplacement d’un générateur de chaleur ont été engagés à partir du 22 juillet 2021, l’obligation s’applique aux émetteurs reliés à ce générateur (R175-6 II 2°).</p>`)
      : box('info', 'minus', `<p><b>Régulation automatique du chauffage : non applicable à ce bâtiment à la date de l’audit.</b></p><p class="small"><i>Ce qu’impose le décret.</i> ${R6_RULE}</p><p class="small"><i>Constats de l’audit.</i> ${r6.noHeating ? 'Aucun système de chauffage n’a été relevé sur le site.' : `Permis de construire : <b>${esc(r6.permitDateFr || '—')}</b>. ${r6.worksDateFr ? `Derniers travaux sur le générateur de chaleur : <b>${esc(r6.worksDateFr)}</b>.` : 'Générateurs de chaleur installés avant 2021, d’après leur âge relevé sur site.'} Aucun de ces déclencheurs n’est postérieur au 21 juillet 2021 : l’obligation ne s’applique pas à ce stade.`}</p><p class="small"><i>Point de vigilance.</i> L’installation ou le remplacement d’un générateur de chaleur (chaudière, pompe à chaleur, sous-station de réseau de chaleur…) déclenchera l’obligation pour les émetteurs reliés à ce générateur, sauf étude établissant qu’une régulation par pièce ou par zone chauffée n’est pas réalisable avec un temps de retour sur investissement inférieur à six ans (R175-6 II 2°).</p>`);
  const thermalActs = new Set(actions.filter((a) => a.source_thermal_id).map((a) => a.source_thermal_id));
  const thermalState = (t) => {
    if (t.outOfR175_6) return pill('na', 'Hors champ, pour information');
    if (!r6.applies) return pill('na', 'Pour information');
    if (thermalActs.has(t.id)) return pill('non_compliant');
    if (t.autoRegState === 'yes') return pill('compliant');
    return pill('unknown', 'À préciser');
  };
  const level = (l, t) => `<div class="lvl lvl-${l.key}">
    <span class="lvl-t">${esc(l.label)}</span>
    <span class="kv"><span>Équipement</span>${esc(l.device_name || '—')}</span>
    <span class="kv"><span>Type de régulation</span>${esc(l.regulation_type || '—')}</span>
    <span class="kv"><span>Régulateur</span>${esc(l.regulator_brand ? join([l.regulator_brand, l.regulator_model_reference], ' · ') : l.regulator_model_reference || (l.has_any_regulation ? 'Non renseigné' : l.device_name ? 'Régulation non renseignée' : 'Aucun équipement désigné à ce niveau'))}</span>
    ${l.regulator_location ? `<span class="kv"><span>Emplacement</span>${esc(l.regulator_location)}</span>` : ''}
    ${l.key === 'production' && t.generatorLabel ? `<span class="kv"><span>Énergie</span>${esc(t.generatorLabel)}</span>` : ''}
    ${l.key === 'production' && t.generator_age_years ? `<span class="kv"><span>Âge du générateur</span>${plural(t.generator_age_years, 'an', 'ans')}</span>` : ''}
    ${l.notes_html ? `<div class="rich small">${l.notes_html}</div>` : ''}
  </div>`;
  const ch4 = isBacs ? `
  <section id="regulation" class="chapter-start">
    <h1 class="chapter">La régulation du chauffage ${art('R175-6')}</h1>
    ${r6Box}
    ${(d.thermal || []).length ? `
    ${!r6.applies ? `<p class="small"><b>Inventaire documenté à titre informatif.</b> ${r6.undetermined ? 'L’applicabilité de l’article R175-6 reste à confirmer (voir ci-dessus) ; la régulation relevée sur site est présentée ci-dessous.' : 'L’obligation ne s’applique pas à ce stade (voir ci-dessus) ; la régulation relevée sur site est conservée ci-dessous, exploitable le jour où un remplacement de générateur de chaleur déclenchera l’obligation.'}</p>` : ''}
    ${d.thermal.map((t) => `<div class="therm">
      <div class="sys-head">${uIcon(t.category)}<h3>${esc(t.zone_name)} · ${esc(t.categoryLabel)}${t.displayLabel ? ` · ${esc(t.displayLabel)}` : ''}</h3>
        <span class="sys-meta">${join([`Régulation automatique : ${t.autoRegState === 'yes' ? 'oui' : t.autoRegState === 'no' ? 'non' : 'non renseignée'}`, t.has_automatic_regulation && t.regulationLabel ? `granularité : ${esc(t.regulationLabel)}` : '', t.generator_exempt_wood ? 'exempté bois (R175-6 II)' : ''], ' · ')}</span>
        ${thermalState(t)}</div>
      ${rich(t.notes_html, t.notes)}
      <div class="lvls">${(t.levels || []).map((l) => level(l, t)).join('')}</div>
    </div>`).join('')}` : r6.applies ? '<p>Régulation thermique non documentée.</p>' : ''}
    ${(d.thermal || []).some((t) => t.category === 'cooling') ? '<p class="muted small">Le froid est décrit pour mémoire : le décret ne vise que le chauffage pour cette exigence.</p>' : ''}
    ${domainActions(['thermal'])}
  </section>` : '';

  // ─── Partie 2 · La GTB ──────────────────────────────────────────────────────────────────
  const b = d.bms;
  const capRow = (title, expl, value, extra = '') => `<tr><td><b>${title}</b><br><span class="muted small">${expl}</span>${extra}</td><td>${value}</td></tr>`;
  const triLabel = (v, opts) => mark(v, { none: 'Non renseigné', ...opts });
  const STORAGE = { local: 'Serveur local', cloud_editeur: 'Cloud de l’éditeur de la GTB', cloud_proprietaire: 'Cloud du propriétaire' };
  const AF_STATUS = {
    absent: '<span class="mk bad">' + ic('xmark') + 'Aucune analyse fonctionnelle remise lors de l’audit</span> <span class="muted small">(document examiné lors de la première inspection périodique, R175-5-1 1°)</span>',
    present: '<span class="mk ok">' + ic('check') + 'Remise par le propriétaire ou son exploitant</span>',
  };
  const devIntegration = (v) => {
    if (v.excludedByAuditor) return String(v.gtb_exclusion_reason || '').trim()
      ? `<span class="muted">Pas à raccorder : ${esc(v.gtb_exclusion_reason.trim())}</span>`
      : '<span class="muted">Non concerné (décision de l’auditeur)</span>';
    if (v.interopNotTargeted) return '<span class="muted">Non visé</span>';
    if (v.outOfGtbScope) return `${mark(0)} <span class="muted small">usage non traité par la GTB</span>`;
    if (v.bms_integration_out_of_service) return '<span class="mk bad">Liaison interrompue</span>';
    return mark(v.managed_by_bms, { none: 'À qualifier' });
  };
  // « La GTB et la supervision sont-elles fonctionnelles ? » (mig 218) ; repli sur « hors service ».
  const gtbState = !b ? null : (['functional', 'partial', 'not_functional'].includes(b.functional_state) ? b.functional_state
    : b.out_of_service == null ? null : (b.out_of_service ? 'not_functional' : 'functional'));
  const gtbNotes = String(b?.functional_notes || '').trim();
  const GTB_STATE_LABEL = { functional: 'Fonctionnelle', partial: 'Partiellement fonctionnelle', not_functional: 'Non fonctionnelle' };
  const ch5 = `
  <section id="gtb" class="chapter-start">
    <h1 class="chapter">La GTB ${isBacs ? art('R175-3') : ''}</h1>
    ${isBacs ? '<p class="lead">La <b>GTB (gestion technique du bâtiment)</b> supervise et pilote les équipements techniques (chauffage, climatisation, ventilation, eau chaude sanitaire, éclairage) et en suit les consommations. Au sens du décret, elle suit et analyse les consommations, ajuste automatiquement le fonctionnement des systèmes, permet leur arrêt manuel et les laisse fonctionner seuls si elle est arrêtée.</p>' : ''}
    ${!b ? '<p>Évaluation de la GTB non renseignée.</p>' : b.present === 0 || b.present === false ? box('bad', 'xmark', `<p><b>Aucune GTB sur le site.</b> Le bâtiment ne dispose d’aucun système de gestion technique. L’installation d’une GTB conforme au décret BACS figure dans les actions ci-dessous. Les exigences R175-3, R175-4 et R175-5 ne sont donc pas évaluées en détail dans ce chapitre.</p>`) : `
    ${gtbState === 'not_functional' ? box('bad', 'warn', `<p><b>GTB hors service au moment de l’audit.</b> Ses fonctions ne sont pas assurées : sa remise en service figure dans les actions ci-dessous. Les réponses ci-dessous décrivent les capacités déclarées de la solution ; elles n’ont pas pu être constatées en fonctionnement.</p>${gtbNotes ? `<p>Constat : ${esc(gtbNotes)}</p>` : ''}`) : ''}
    ${gtbState === 'partial' ? box('warn', 'warn', `<p><b>GTB et supervision partiellement fonctionnelles au moment de l’audit.</b>${gtbNotes ? ` ${esc(gtbNotes)}` : ''}</p><p>La remise en état de ce qui ne fonctionne pas figure dans les actions ci-dessous ; ce que la GTB sait faire reste évalué.</p>`) : ''}
    ${b.buildyOffer && isBacs ? box('info', 'server', `<p><b>Supervision Buildy Cloud — niveau ${esc(b.buildyOffer.levelLabel)}.</b> La solution assure les fonctions exigées par le décret (suivi des consommations, détection des dérives, interopérabilité, arrêt manuel et gestion autonome, mise à disposition des données).${b.buildyOffer.hasReserves ? ' La conformité est acquise sous réserve des obligations suivantes, reprises dans les actions :' : ''}</p>${b.buildyOffer.hasReserves ? `<ul>${b.buildyOffer.reserves.map((r) => `<li>${esc(r.label)} ${art(r.article)}</li>`).join('')}</ul>` : ''}`) : ''}
    <dl class="facts">
      <div><dt>Solution en place</dt><dd>${esc(b.existing_solution || 'Non renseigné')}</dd></div>
      ${b.existing_solution_brand ? `<div><dt>Marque, éditeur</dt><dd>${esc(b.existing_solution_brand)}</dd></div>` : ''}
      ${b.buildyOffer ? `<div><dt>Niveau d’offre Buildy</dt><dd>${esc(b.buildyOffer.levelLabel)}</dd></div>` : ''}
      ${b.model_reference ? `<div><dt>Référence</dt><dd>${esc(b.model_reference)}</dd></div>` : ''}
      ${b.location ? `<div><dt>Emplacement</dt><dd>${esc(b.location)}</dd></div>` : ''}
      ${(b.providedProtocolsLabels || []).length ? `<div><dt>Protocoles proposés</dt><dd>${esc(b.providedProtocolsLabels.join(', '))}</dd></div>` : ''}
      ${gtbState ? `<div class="wide"><dt>Fonctionnement</dt><dd>${GTB_STATE_LABEL[gtbState]}${gtbNotes && gtbState === 'functional' ? ` — ${esc(gtbNotes)}` : ''}</dd></div>` : ''}
      <div class="wide"><dt>Analyse fonctionnelle de la GTB existante</dt><dd>${AF_STATUS[doc.audit_existing_af_status] || '<span class="muted">Non renseigné</span>'}</dd></div>
    </dl>
    ${topicNotes('analyse_fonctionnelle')}
    ${(d.bmsComponents || []).length ? `<h3>Les composants matériels</h3><p class="small muted">Serveurs, contrôleurs, passerelles, automates relevés sur site.</p>
    <table class="data"><thead><tr><th>Type</th><th>Marque · modèle</th><th>Emplacement</th><th>Adresse IP</th><th>Protocoles</th><th>Micrologiciel</th></tr></thead>
    <tbody>${d.bmsComponents.map((c) => `<tr><td>${esc(c.component_type || '—')}</td><td><b>${esc(c.brand || '—')}</b>${c.model ? ` · ${esc(c.model)}` : ''}</td><td>${esc(c.location || '—')}</td><td>${esc(c.ip_address || '—')}</td><td>${esc(c.protocolsLabel || '—')}</td><td>${esc(c.firmware_version || '—')}</td></tr>${c.notes_html || c.notes ? `<tr class="msub"><td colspan="6">${rich(c.notes_html, c.notes)}</td></tr>` : ''}`).join('')}</tbody></table>` : ''}
    ${isBacs ? `
    <h2>Ce que la GTB sait faire</h2>
    <p class="small muted">L’interopérabilité et l’arrêt manuel / la gestion autonome sont appréciés équipement par équipement : voir ${xref('systemes')}.</p>
    <table class="data caps">
      <thead><tr><th>Point vérifié</th><th>Constat</th></tr></thead>
      <tbody>
        ${capRow(`Suivre les consommations heure par heure, garder 5 ans ${art('R175-3 1°')}`, 'La GTB collecte et analyse en continu, au pas horaire et par zone fonctionnelle, les consommations et productions d’énergie de chaque système, ajuste automatiquement ces systèmes et conserve les données à l’échelle mensuelle pendant cinq ans.', triLabel(b.meets_r175_3_p1), `${isYes(b.meets_r175_3_p1) && b.data_storage_5y_compliant !== 'yes' ? `<br><span class="warn-t small">Conservation sur 5 ans : ${b.data_storage_5y_compliant === 'no' ? 'non conforme' : 'à qualifier'} (voir « Conservation et accès » ci-dessous).</span>` : ''}${isYes(b.meets_r175_3_p1) && (b.r175_3_p1_archival_format || [0, 1].includes(b.r175_3_p1_retention_verified)) ? `<br><span class="small">${b.r175_3_p1_archival_format ? `Format d’archivage : ${esc(b.r175_3_p1_archival_format)}. ` : ''}${[0, 1].includes(b.r175_3_p1_retention_verified) ? `Conservation sur 5 ans : ${b.r175_3_p1_retention_verified ? 'vérifiée' : 'non vérifiée'} lors de l’audit.` : ''}</span>` : ''}`)}
        ${capRow(`Repérer les dérives ${art('R175-3 2°')}`, 'La GTB situe l’efficacité énergétique du bâtiment par rapport à des valeurs de référence (étude énergétique, caractéristiques nominales de chaque système), détecte automatiquement les pertes d’efficacité et informe l’exploitant des améliorations possibles.', triLabel(b.meets_r175_3_p2), isYes(b.meets_r175_3_p2) && b.r175_3_p2_anomaly_rules_html ? `<div class="rich small"><b>Règles de détection en place :</b> ${b.r175_3_p2_anomaly_rules_html}</div>` : '')}
        ${capRow(`Données mises à disposition du gestionnaire ${art('R175-3 dernier alinéa')}`, 'Le propriétaire de la GTB, propriétaire des données produites et archivées, les met à la disposition du gestionnaire du bâtiment, à sa demande. Le décret n’impose pas de procédure écrite : Buildy vérifie que l’accès existe (canal, format, délai).', triLabel(b.data_provision_to_manager))}
        ${capRow(`Données transmises aux exploitants ${art('R175-3 dernier alinéa')}`, 'Le propriétaire de la GTB transmet à chaque exploitant des systèmes reliés (chauffage, climatisation, ventilation, éclairage…) les données qui le concernent, pour qu’il puisse suivre, diagnostiquer et optimiser son périmètre.', triLabel(b.data_provision_to_operators), `${b.notes_data_provision ? `<br><span class="small"><b>Mécanisme :</b> ${esc(b.notes_data_provision)}</span>` : ''}${b.data_provision_frequency || b.data_provision_format ? `<br><span class="small">${b.data_provision_frequency ? `<b>Fréquence :</b> ${esc(b.data_provision_frequency)}. ` : ''}${b.data_provision_format ? `<b>Format :</b> ${esc(b.data_provision_format)}.` : ''}</span>` : ''}`)}
        ${capRow(`Vérifications périodiques de la GTB ${art('R175-4')}`, 'La GTB fait l’objet de vérifications périodiques, par un prestataire externe ou un personnel interne compétent, encadrées par des consignes écrites données au gestionnaire : périodicité des interventions, points à contrôler, réparation rapide ou remplacement des éléments défaillants.', d.maintenanceReserveNumber ? `<span class="pill reserve">${ic('clock')}À mettre en place</span>` : triLabel(b.has_maintenance_procedures), `${d.maintenanceReserveNumber ? `<br><span class="small">Réserve : obligation à respecter, sans effet sur la conformité de l’installation (voir <a class="see" href="#${anchorOf(d.maintenanceReserveNumber)}">${esc(d.maintenanceReserveNumber)}</a>).</span>` : ''}${isYes(b.has_maintenance_procedures) && (b.maintenance_periodicity || b.maintenance_responsible) ? `<br><span class="small">${b.maintenance_periodicity ? `<b>Périodicité :</b> ${esc(b.maintenance_periodicity)}. ` : ''}${b.maintenance_responsible ? `<b>Responsable :</b> ${esc(b.maintenance_responsible)}.` : ''}</span>` : ''}`)}
        ${capRow(`Exploitant formé au paramétrage ${art('R175-5')}${b.operator_training_date ? ` <span class="muted">(formation du ${esc(frDate(b.operator_training_date))})</span>` : ''}`, 'Le propriétaire de la GTB s’assure que son exploitant est formé au fonctionnement de la GTB, en particulier aux modalités de son paramétrage (consignes, programmes horaires, seuils d’alarme…).', triLabel(b.operator_trained), `${isYes(b.operator_trained) && (b.operator_training_provider || b.operator_training_topics) ? `<br><span class="small">${b.operator_training_provider ? `<b>Formateur :</b> ${esc(b.operator_training_provider)}. ` : ''}${b.operator_training_topics ? `<b>Sujets couverts :</b> ${esc(b.operator_training_topics)}.` : ''}</span>` : ''}${d.buildySolution ? `<br><span class="small">${isYes(b.operator_trained) ? `<b>Solution Buildy déployée.</b> L’aide en ligne et le support de la solution facilitent la prise en main. Formation de l’exploitant${b.operator_training_date ? ` du ${esc(frDate(b.operator_training_date))}` : ''}${b.operator_training_provider ? ` (${esc(b.operator_training_provider)})` : ''} : la feuille d’émargement est à conserver, elle est demandée lors de l’inspection périodique (R175-5, FAQ n° 30).` : '<b>Solution Buildy déployée.</b> L’aide en ligne et le support de la solution facilitent la prise en main. La formation de l’exploitant au fonctionnement et au paramétrage de la GTB reste à attester (date, participants, feuille d’émargement), comme le prévoit l’inspection périodique (R175-5, FAQ n° 30).'}</span>` : ''}`)}
      </tbody>
    </table>
    ${topicNotes('r175_3_capacites')}${topicNotes('r175_3_mise_dispo')}${topicNotes('r175_4')}${topicNotes('r175_5')}
    ${b.data_storage_5y_compliant || b.data_owner_access || b.gestionnaire_exploitant_access || b.export_capability ? `
    <div class="keep"><h3>Conservation et accès aux données ${art('R175-3 1°')}</h3>
    <table class="data kvt"><tbody>
      <tr><td>Consommations gardées mois par mois pendant 5 ans</td><td>${b.data_storage_5y_compliant === 'yes' ? `${mark(1, { yes: 'Conforme' })}${b.buildyOffer?.retentionByExport ? `<span class="small">, sous réserve d’exports réguliers depuis Hyperveez (12 mois conservés en ${esc(b.buildyOffer.levelLabel)})</span>` : ''}` : b.data_storage_5y_compliant === 'no' ? mark(0, { no: 'Non conforme' }) : '<span class="mk na">Non déterminé</span>'}</td></tr>
      <tr><td>Emplacement du stockage des données</td><td>${esc(STORAGE[b.data_storage_location] || 'Non déterminé')}</td></tr>
      <tr><td>Accès direct du propriétaire à ses données</td><td>${b.data_owner_access === 'partial' ? '<span class="mk neu">Partiel</span>' : triLabel(b.data_owner_access)}</td></tr>
      <tr><td>Accès du gestionnaire et des exploitants</td><td>${d.dataAccessRow ? `<span class="mk ${d.dataAccessRow.state === 'yes' ? 'ok' : d.dataAccessRow.state === 'no' ? 'bad' : d.dataAccessRow.state === 'partial' ? 'neu' : 'na'}">${d.dataAccessRow.state === 'yes' ? ic('check') : d.dataAccessRow.state === 'no' ? ic('xmark') : ''}${esc(d.dataAccessRow.label)}</span>` : '—'}</td></tr>
      <tr><td>Export dans un format ouvert (CSV ou tableur) — non exigé par le décret</td><td>${mark(b.export_capability, { yes: 'Possible', no: 'Impossible', neutral: true })}</td></tr>
    </tbody></table></div>
    ${b.data_access_notes ? `<p class="small"><b>Observations :</b> ${esc(b.data_access_notes)}</p>` : ''}` : ''}` : ''}
    ${(d.bmsDevicesByZone || []).length || d.bmsTopicNotes?.equipements ? `
    <h2>Les équipements raccordés à la GTB</h2>
    <p class="small">${plural(d.bmsManagedDevices.length, 'équipement déjà intégré', 'équipements déjà intégrés')}, ${plural(d.bmsUnmanagedDevices.length, 'à intégrer', 'à intégrer')}${(d.bmsOutOfScopeDevices || []).length ? ` (dont ${nf(d.bmsOutOfScopeDevices.length, 0)} d’usages que la GTB ne traite pas)` : ''}${(d.bmsUnansweredDevices || []).length ? `, ${nf(d.bmsUnansweredDevices.length, 0)} à qualifier` : ''}${(d.bmsNotTargetedDevices || []).length ? `, ${plural(d.bmsNotTargetedDevices.length, 'non visé', 'non visés')} (émetteurs à régulation locale, ou équipements déclarés non concernés par l’auditeur)` : ''}.${d.bmsUnmanagedDevices.length ? ' Les équipements marqués « Non » ne sont pas raccordés à la GTB ; les actions ci-dessous précisent les raccordements à réaliser (en priorité les générateurs, directement ou par leur régulateur : passerelle, module de communication ou remplacement selon le cas) ; dans un bâtiment existant, certains ne sont exigés que sous condition de temps de retour sur investissement.' : ''}</p>
    <table class="data integ"><thead><tr><th>Équipement</th><th>Usage</th><th>Intégré à la GTB</th></tr></thead>
    <tbody>${d.bmsDevicesByZone.map((z) => `<tr class="zrow"><td colspan="3">${esc(z.zone_name)}</td></tr>${z.devices.map((v) => `<tr><td><b>${esc(v.name)}</b>${v.brand || v.model_reference ? `<br><span class="muted">${esc(join([v.brand, v.model_reference], ' '))}</span>` : ''}${v.sharedWithLabel ? `<br><span class="muted small">Dessert aussi : ${esc(v.sharedWithLabel)}</span>` : ''}</td><td>${usagePill(v.system_category, (d.systemsByZone.flatMap((zz) => zz.items).find((i) => i.system_category === v.system_category) || {}).categoryLabel || v.system_category)}</td><td>${devIntegration(v)}</td></tr>`).join('')}`).join('')}</tbody></table>
    ${topicNotes('equipements')}` : ''}
    ${(d.bmsMetersByEnergy || []).length || d.bmsTopicNotes?.compteurs ? `
    <h2>Les compteurs relevés par la GTB</h2>
    <p class="small">Seulement les compteurs <b>déjà installés</b> : ${plural(d.bmsManagedMeters.length, 'déjà relevé par la GTB', 'déjà relevés par la GTB')}${d.bmsBrokenLinkMeters.length ? `, ${plural(d.bmsBrokenLinkMeters.length, 'dont la liaison avec la GTB est interrompue', 'dont la liaison avec la GTB est interrompue')}` : ''}, ${plural(d.bmsUnmanagedMeters.length, 'présent mais non relevé', 'présents mais non relevés')}${d.bmsUnansweredMeters.length ? `, ${nf(d.bmsUnansweredMeters.length, 0)} à qualifier` : ''} (à raccorder). Les compteurs <b>requis mais absents</b> — souvent le principal écart au décret — sont recensés dans ${xref('comptage')} et traités dans ses actions.</p>
    <table class="data integ"><thead><tr><th>Compteur</th><th>Usage</th><th>Relevé par la GTB</th></tr></thead>
    <tbody>${d.bmsMetersByEnergy.map((g) => { const e = energyHead(g.energy); return `<tr class="zrow"><td colspan="3"><span style="color:${e.color}">${e.icon}</span> ${esc(e.label)}</td></tr>${g.meters.map((m) => `<tr><td><b>${esc(m.zoneLabel)}</b> · ${esc(m.locationLabel || '—')}</td><td>${usagePill(m.isGeneral ? 'other' : m.usage, m.isGeneral ? 'Général' : m.usageLabel)}</td><td>${m.bms_integration_out_of_service ? '<span class="mk bad">Liaison interrompue</span>' : mark(m.managed_by_bms, { none: 'À qualifier' })}</td></tr>`).join('')}`; }).join('')}</tbody></table>
    ${topicNotes('compteurs')}` : ''}
    ${b.notes_html || (b.photos || []).length ? `<h3>Notes terrain et photos de la GTB</h3><div class="elem"><div class="elem-body">${rich(b.notes_html)}</div>${photos(b.photos)}</div>` : ''}`}
    ${domainActions(['priority', 'bms'])}
  </section>`;

  // ─── Partie 2 · L'inspection périodique ─────────────────────────────────────────────────
  const insp = d.inspections || {};
  const ch6 = d.showInspectionsChapter ? `
  <section id="inspection" class="chapter-start">
    <h1 class="chapter">L’inspection périodique ${art('R175-5-1')}</h1>
    <p class="lead">Le décret soumet la GTB d’un bâtiment assujetti à une inspection périodique, à l’initiative de son propriétaire. Ce chapitre trace la dernière inspection : date, inspecteur, rapport et prochaine échéance.</p>
    <p class="small"><i>Ce qu’impose le décret.</i> Selon l’arrêté du 7 avril 2023, l’inspection a lieu au moins tous les cinq ans ; la première était due au plus tard le 1er janvier 2025 pour une GTB déjà en place au 8 avril 2023, et intervient dans les deux ans qui suivent l’installation ou le remplacement de la GTB ou d’un système qui lui est relié. Le rapport est remis dans le mois qui suit la visite et conservé dix ans. La FAQ ministérielle n° 30 (non opposable) indique qu’il « peut être pertinent » de confier l’inspection à un tiers indépendant des fabricants et installateurs ; le décret ne l’impose pas. Elle est distincte des contrôles et inspections des chaudières et des systèmes thermodynamiques prévus par le code de l’environnement, dont les systèmes reliés à une GTB sont exemptés (article R175-4, dernier alinéa). Depuis le décret du 7 avril 2023, ces systèmes restent soumis à l’entretien prévu par le code de l’environnement (entretien annuel des chaudières de 4 à 400 kW, entretien tous les deux ans des systèmes thermodynamiques de 4 à 70 kW).</p>
    ${doc.inspection_not_applicable ? box('warn', 'warn', `<p><b>${esc(d.inspectionNotice?.title || '')}</b> ${esc(d.inspectionNotice?.body || '')}</p>${doc.inspection_not_applicable_reason ? `<p><i>Précision de l’auditeur :</i> ${esc(doc.inspection_not_applicable_reason)}</p>` : ''}`) : `
    <h2>La dernière inspection réalisée</h2>
    <dl class="facts">
      ${insp.last_inspection_date ? `<div><dt>Date de l’inspection</dt><dd>${esc(frDate(insp.last_inspection_date))}</dd></div>` : ''}
      ${insp.last_inspection_inspector ? `<div><dt>Inspecteur</dt><dd>${esc(insp.last_inspection_inspector)}</dd></div>` : ''}
      ${insp.last_inspection_report_filename ? `<div><dt>Rapport d’inspection</dt><dd>${esc(insp.last_inspection_report_filename)}</dd></div>` : ''}
      ${insp.next_inspection_due_date ? `<div><dt>Prochaine inspection due</dt><dd>${esc(frDate(insp.next_inspection_due_date))}</dd></div>` : ''}
      ${insp.retained_until_date ? `<div><dt>Rapport conservé jusqu’au</dt><dd>${esc(frDate(insp.retained_until_date))}</dd></div>` : ''}
    </dl>
    ${noteBlock('Anomalies relevées par l’inspecteur', insp.last_inspection_anomalies_html)}
    ${noteBlock('Recommandations de l’inspecteur', insp.last_inspection_recommendations_html)}
    ${noteBlock('Notes de l’auditeur', null, insp.notes)}`}
    ${domainActions(['inspections'])}
  </section>` : '';
  const ch7 = cardOf('misc') ? `
  <section id="autres" class="chapter-start">
    <h1 class="chapter">Autres actions</h1>
    <p class="lead">Actions ajoutées par l’auditeur sans domaine de rattachement.</p>
    ${domainActions(['misc'], 'Les actions')}
  </section>` : '';

  // ─── Annexes ────────────────────────────────────────────────────────────────────────────
  const annexA = `
  <section id="annexe-a" class="annex chapter-start">
    <h1 class="chapter"><span class="al">A</span>Le décret BACS, texte intégral</h1>
    <p class="lead">Articles R175-1 à R175-6 du code de la construction et de l’habitation, dans leur version en vigueur : la base réglementaire de l’évaluation de ce rapport.${d.currentDecreeVersionLabel ? ` <b>${esc(d.currentDecreeVersionLabel)}.</b>` : ''} Texte officiel sur Légifrance (lien sous chaque article). Les repères de lecture sur fond gris sont des aides de Buildy, sans valeur réglementaire.</p>
    <div class="cols">${(d.bacsArticles || []).map((x) => `<div class="article"><h3>${esc(x.code)} · ${esc(x.title)}</h3>${x.html}${x.reading_note_html ? `<div class="reading"><b>Repère de lecture Buildy — non opposable</b>${x.reading_note_html}</div>` : ''}${x.source_url ? `<p class="src">${x.version_label ? `${esc(x.version_label)} · ` : ''}Texte officiel : ${esc(x.source_url)}</p>` : ''}</div>`).join('')}</div>
  </section>`;
  const method = (title, body) => `<div class="article"><h3>${esc(title)}</h3>${body}</div>`;
  const annexB = `
  <section id="annexe-b" class="annex chapter-start">
    <h1 class="chapter"><span class="al">B</span>Méthodologie et hypothèses</h1>
    <p class="lead">Les choix de méthode de Buildy, sur lesquels repose l’évaluation de ce rapport. Ces hypothèses n’ont pas de valeur réglementaire : en cas de divergence, le texte du décret prime.</p>
    <div class="cols">
      ${method('Sources réglementaires opposables', '<p>Le présent audit évalue la conformité au regard des seuls textes réglementaires ci-dessous, qui ont seuls valeur de norme ; les documents listés ensuite en éclairent l’interprétation :</p><ul><li>Articles L. 174-3, L. 175-2 et R. 175-1 à R. 175-6 du code de la construction et de l’habitation — accessibles sur Légifrance.</li><li>Décret n° 2020-887 du 20 juillet 2020 (recodifié par le décret n° 2021-872 du 30 juin 2021), modifié par les décrets n° 2023-259 du 7 avril 2023 et n° 2025-1343 du 26 décembre 2025.</li><li>Arrêté du 7 avril 2023 (fréquence et modalités de l’inspection de la GTB ; méthode de calcul du temps de retour sur investissement).</li></ul>')}
      ${method('Références méthodologiques (non opposables, à titre indicatif)', '<p>Les documents suivants éclairent l’interprétation du décret mais n’ont pas valeur réglementaire. L’audit s’inspire des bonnes pratiques qui y sont décrites sans en faire une exigence :</p><ul><li>Guide d’application du décret BACS, version 2 — ministère chargé de la construction, janvier 2026.</li><li>FAQ BACS — ministère chargé de la construction, 30 questions publiées en juin 2025, mises à jour en janvier et février 2026.</li><li>Guide pratique d’application du décret BACS — PROFEEL / COSTIC, version 1.1, novembre 2025.</li><li>Fiche décryptage du décret BACS — Cerema, 2023 (antérieure à la FAQ de 2025 sur le cumul des puissances).</li></ul><p>Ces documents sont des supports d’interprétation utiles mais n’ont pas valeur réglementaire. En cas de contradiction avec le texte du décret, le décret prime.</p>')}
      ${(d.methodology || []).map((m) => method(m.title, `<p>${esc(m.body)}</p>`)).join('')}
      ${method('Sur les estimations d’économies d’énergie', '<p>Le présent audit établit la <b>conformité fonctionnelle</b> du bâtiment aux exigences de l’article R175-3 du décret BACS. Il ne préjuge ni de la classe atteinte au sens de la norme NF EN ISO 52120-1, ni du montant des économies d’énergie qui seront réellement obtenues après la mise en conformité.</p><p>Comme le rappelle le guide pratique PROFEEL / COSTIC : <i>« Les économies dépendent beaucoup de la situation de départ. Les pourcentages d’économies annoncés, basés sur la norme NF EN ISO 52120-1, peuvent être très différents de ceux réellement obtenus. »</i></p><p>En conséquence, Buildy n’affiche aucune estimation chiffrée d’économies et ne réalise aucun calcul de temps de retour sur investissement (TRI) — ce calcul relève de la seule responsabilité du propriétaire. Pour la GTB, il suit la méthode fixée par l’arrêté du 7 avril 2023 : coût établi sur au moins deux devis réels, aides déduites ; gain de 15 % ou issu d’un audit énergétique ; coût moyen facturé de chaque énergie (clause de dispense de l’article R175-2 ; voir les mentions légales).</p>')}
      ${method('Contre-indications de pilotage par type d’équipement', '<p>Certains équipements ne doivent pas être arrêtés par une simple coupure de leur alimentation, pour des raisons techniques ou sanitaires (guide PROFEEL). L’arrêt manuel exigé par le décret passe alors par la régulation de l’équipement (arrêt piloté, mise en hors gel, réduction de consigne), jamais par une coupure brutale :</p><ul><li><b>Eau chaude sanitaire bouclée</b> — en période d’occupation, et dans les 24 heures qui la précèdent, les températures de l’arrêté du 30 novembre 2005 doivent être respectées : pas d’arrêt de la boucle. Un arrêt pendant une inoccupation de plusieurs semaines reste possible, avec une remise en service encadrée (risque lié aux légionelles).</li><li><b>Équipement thermodynamique</b> (PAC, DRV, climatisation) — ne pas couper l’alimentation électrique en cours de fonctionnement (lubrification du compresseur).</li><li><b>Chaudière en période hivernale</b> — ne pas couper l’alimentation : perte de la protection hors-gel.</li><li><b>Ballon ECS à anode à courant imposé (ACI)</b> — pas de coupure prolongée au-delà de 8 h : perte de la protection anti-corrosion.</li><li><b>Circulateur avec fonction de dégommage</b> — ne pas couper en été : perte de la protection anti-grippage.</li><li><b>Ventilation en EHPAD, hôpitaux et locaux sanitaires</b> — ventilation en continu requise pour la qualité de l’air et l’hygiène.</li><li><b>Éclairage déjà optimisé</b> (détection de présence + LED récentes) — généraliser une commande BACS n’apporte pas de gisement d’économies.</li></ul><p>Dans ces cas, le rapport rappelle le pilotage adapté à mettre en œuvre (programmation de consigne, surveillance, dérogation contrôlée).</p>')}
      ${method('Cumul automatique des puissances chaud et froid', '<p>La puissance nominale utile servant à l’assujettissement (article R175-2) est calculée automatiquement à partir des équipements relevés sur site. La règle de cumul dépend du type de chaque système (guide PROFEEL / COSTIC, tableau 2) :</p><ul><li><b>Systèmes thermodynamiques</b> (PAC, DRV, climatisation) — la puissance retenue est le maximum déclaré entre puissance calorifique et frigorifique (norme EN 14511) ; la machine ne compte qu’une fois.</li><li><b>Chaudières</b> — somme des puissances nominales constructeur.</li><li><b>Effet Joule</b> (radiateurs et batteries électriques) — somme des puissances électriques.</li><li><b>Réseau de chaleur ou de froid urbain</b> — puissance nominale de la sous-station (échangeur primaire). Les <b>émetteurs aval</b> alimentés par cette sous-station (radiateurs eau chaude, ventilo-convecteurs sur boucle secondaire, batteries CTA alimentées en eau du réseau urbain) ne sont <b>pas additionnés</b> au cumul — seule la puissance de la station d’échange est retenue (R175-2 I).</li><li><b>Exclus du cumul</b> — équipements de secours au sens de la FAQ BACS n° 8 (normalement à l’arrêt, démarrés seulement après un défaut de l’équipement principal ; un générateur appelé en cascade n’en est pas un), systèmes mobiles, appareils indépendants de chauffage au bois, systèmes non destinés au chauffage ou à la climatisation.</li></ul><p>La puissance chaud cumulée et la puissance froid cumulée ne s’additionnent pas : la puissance retenue est le maximum des deux (FAQ BACS n° 11). Un équipement de production dont la puissance n’est pas relevée n’est pas compté : la puissance retenue est alors un minimum, ce que le rapport signale. La valeur calculée peut être remplacée par une valeur déclarée par l’auditeur ; tout écart supérieur à 10 % entre la valeur déclarée et le calcul est signalé.</p>')}
      ${method('Découpage et regroupement des zones fonctionnelles', `<p>Une zone distincte est créée dès que l’usage diffère : activité ou amplitude d’utilisation (R175-1 6° ; FAQ ministérielle n° 25, non opposable). Le découpage <b>peut varier selon le système technique concerné</b> : une école peut former une seule zone fonctionnelle pour le chauffage (chaudière et circuit uniques) mais deux pour l’éclairage (tableaux électriques distincts).</p><p>Le suivi peut être regroupé lorsqu’il n’est pas techniquement séparable (FAQ ministérielle n° 25) ou, à titre de préconisation Buildy, pour un poste de très faible poids (guide PROFEEL), avec une justification écrite dans ${xref('site')}. Lorsqu’un équipement partagé dessert plusieurs zones sans comptage séparable, ces zones forment une seule zone fonctionnelle de suivi : un compteur unique suffit alors pour l’ensemble.</p>`)}
    </div>
  </section>`;
  const annexC = `
  <section id="annexe-c" class="annex chapter-start">
    <h1 class="chapter"><span class="al">C</span>Mentions légales</h1>
    <p class="lead">Lecture obligatoire avant utilisation du présent rapport en support de devis ou de procédure de mise en conformité.</p>
    <ol class="legal">${(d.disclaimers || []).map((x) => `<li>${esc(typeof x === 'string' ? x : x.body || x.text)}</li>`).join('')}</ol>
  </section>`;
  const annexD = (d.reportAttachments || []).length ? `
  <section id="annexe-d" class="annex chapter-start">
    <h1 class="chapter"><span class="al">D</span>Documents joints</h1>
    <p class="lead">Documents relevés ou remis lors de l’audit et joints au rapport. Les images sont reproduites ci-dessous, sauf les photos déjà présentes dans un chapitre, qui y renvoient ; les notes vocales sont retranscrites ; les autres fichiers (PDF, plans, schémas, tableurs) sont seulement listés.</p>
    <table class="data att"><thead><tr><th>Réf.</th><th>Document</th><th>Type</th><th>Rattaché à</th><th>Date</th><th class="r">Taille</th></tr></thead>
    <tbody>${d.reportAttachments.map((x) => `<tr><td class="n">${esc(x.ref)}</td><td>${esc(x.title)}${x.shownInChapter ? `<br><span class="muted small">Photo reproduite au chapitre ${esc(x.shownInChapter)}.</span>` : x.dataUrl ? '<br><span class="muted small">Image reproduite ci-dessous.</span>' : ''}</td><td>${esc(x.typeLabel)} · ${esc(x.formatLabel)}</td><td>${esc(x.attachedTo)}</td><td>${x.date ? esc(frDate(x.date)) : '—'}</td><td class="r">${esc(x.sizeLabel)}</td></tr>`).join('')}</tbody></table>
    ${(d.reportAttachmentTranscripts || []).length ? `<h2>Notes vocales — transcription</h2>${d.reportAttachmentTranscripts.map((x) => `<div class="note"><span class="note-t">${esc(x.ref)} — ${esc(x.title)} · ${esc(x.attachedTo)}</span><p>${esc(x.transcript)}</p></div>`).join('')}` : ''}
    ${(d.reportAttachmentImages || []).length ? `<h2>Images</h2><div class="gallery">${d.reportAttachmentImages.map((x) => `<figure><img src="${x.dataUrl}" alt=""><figcaption><b>${esc(x.ref)}</b> — ${esc(x.title)} · ${esc(x.attachedTo)}</figcaption></figure>`).join('')}</div>` : ''}
  </section>` : '';

  const closing = `
  <section class="closing">
    <img class="logo" src="${env.logo.dark}" alt="Buildy">
    <div>
      <p class="kind">${isBacs ? 'Mise en conformité · Décret BACS' : 'Extension de la GTB'}</p>
      <h1 class="closing-title">${isBacs ? 'La mise en conformité avec Buildy' : 'L’évolution de la GTB avec Buildy'}</h1>
      <p class="closing-text">${as.total ? `Ce rapport identifie ${d.closingActionCount ? `<b>${plural(d.closingActionCount, 'action corrective', 'actions correctives')}</b>${d.closingConditionalCount ? ` (dont ${nf(d.closingConditionalCount, 0)} sous condition de temps de retour sur investissement)` : ''}` : ''}${as.reserves ? `${d.closingActionCount ? ' et ' : ''}<b>${plural(as.reserves, 'réserve', 'réserves')}</b>` : ''}.${isBacs ? ` ${esc(d.closingDeadlinePhrase || '')} ${esc(String(d.closingInspectionNote || '').replace(/\s*\(chapitre \d+\)/, ''))}` : ''}` : 'Ce rapport dresse l’état des lieux complet de l’installation.'} Buildy accompagne les propriétaires et exploitants de la définition du plan d’actions jusqu’à sa mise en œuvre.</p>
      <ul class="closing-points"><li>Chiffrage du plan d’actions et priorisation par échéance.</li><li>Déploiement de la solution Buildy : supervision multi-sites, suivi des consommations, conservation des données.</li><li>Suivi de la conformité dans le temps et préparation de l’inspection périodique.</li></ul>
      <a class="closing-cta" href="${esc(d.quoteMailto || 'mailto:contact@buildy.fr')}">${isBacs ? 'Devis de mise en conformité BACS sur demande' : 'Devis d’extension de la GTB sur demande'}</a>
    </div>
    <div class="closing-contact">
      <p>Pour échanger sur la suite</p>
      <span><b>Courriel</b>contact@buildy.fr</span><span><b>Téléphone</b>04 28 39 03 34</span><span><b>Site</b>www.buildy.fr</span>
    </div>
  </section>`;

  // ─── En-tête et pied de page (charte : client et projet à gauche, type et version à droite ;
  // logo sans signature, mention de confidentialité et version du décret, « page X / Y ») ───────
  // Version du décret : gravée à la livraison (document), sinon version en vigueur.
  const decreeLabel = doc.decree_version_label || d.currentDecreeVersionLabel || null;
  const pageCss = `
@page {
  size: A4; margin: 18mm 18mm 16mm 18mm;
  @top-left { content: ${cssStr(`${client} · ${projectName}`)}; font: 500 7pt var(--buildy-font-body); color: #5D7189; vertical-align: bottom; padding-bottom: 4mm; }
  @top-right { content: ${cssStr(`${isBacs ? 'Audit BACS' : 'Audit GTB'} · ${versionLabel}`)}; font: 500 7pt var(--buildy-font-body); color: #5D7189; vertical-align: bottom; padding-bottom: 4mm; }
  @bottom-left { content: ${cssStr(isBacs ? `Audit de conformité au décret BACS · document confidentiel${decreeLabel ? ` · ${decreeLabel}` : ''}` : 'Audit GTB · préparation devis · document confidentiel')}; font: 500 6.5pt var(--buildy-font-body); color: #5D7189; padding-left: 14mm; background: url("${env.logo.footer}") no-repeat left 3.6mm / auto 3.6mm; vertical-align: top; padding-top: 4mm; border-top: 0.2mm solid #E3E6EE; width: 152mm; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 600 7pt var(--buildy-font-body); color: #3B4A6B; vertical-align: top; padding-top: 4mm; border-top: 0.2mm solid #E3E6EE; width: 22mm; text-align: right; white-space: nowrap; }
}
`;

  const html = `<!doctype html>
  <html lang="fr" class="${env.mode}"><head><meta charset="utf-8"><title>${esc(isBacs ? 'Audit BACS' : 'Audit GTB')} · ${esc(siteName)}</title>
  <style>${env.fontsCss}
  ${pageCss}
  ${env.css}</style>
  </head><body>
  ${cover}
  ${sommaire}
  ${verdict}
  ${mot}
  ${exigences}
  ${plan}
  ${divider('p2', 'Le constat détaillé', part2Ids, 'Domaine par domaine : ce que l’audit a relevé sur le site, puis les actions qui en découlent, avec leur justification.')}
  ${ch1}${ch2}${ch3}${ch4}${ch5}${ch6}${ch7}
  ${divider('annexes', 'Annexes', annexIds)}
  ${annexA}${annexB}${annexC}${annexD}
  ${closing}
  </body></html>`;
  
  // « → » n'existe pas dans Manrope : icône SVG (la charte interdit toute police de remplacement)
  // « → » n'existe pas dans Manrope : icône SVG (la charte interdit toute police de remplacement)
  return html.replace(/→/g, ic('arrow', 'arr'));
}

module.exports = { buildBacsAuditReportHtml };
