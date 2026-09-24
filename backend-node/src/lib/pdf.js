'use strict';

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const log = require('./logger').system;
const { createBrowserPool } = require('./browser-pool');

// Helpers Handlebars (utilises dans les templates .hbs)
Handlebars.registerHelper('gt', (a, b) => a > b);
Handlebars.registerHelper('lt', (a, b) => a < b);
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('minus', (a, b) => (Number(a) || 0) - (Number(b) || 0));
Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
// Date ISO au format français long : {{frDate "2022-01-01"}} → « 1er janvier 2022 ».
Handlebars.registerHelper('frDate', (v) => {
  if (!v) return v;
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .replace(/^1 /, '1er ');
});
// Nombre au format français (virgule décimale, espace des milliers) :
// {{frNum 155.8}} → « 155,8 ». Valeur non numérique renvoyée telle quelle.
Handlebars.registerHelper('frNum', (v, digits) => {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return v;
  // Petites valeurs (0,03 kW par luminaire) : deux décimales, sinon « 0 ».
  const abs = Math.abs(Number(v));
  const max = typeof digits === 'number' ? digits : (abs > 0 && abs < 1 ? 2 : 1);
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: max }).replace(/ /g, ' ');
});
Handlebars.registerHelper('and', function(...args) { args.pop(); return args.every(Boolean); });
Handlebars.registerHelper('join', (arr, sep) => Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : '');

// Pill colorée représentant une fonction d'équipement dans la chaîne
// énergétique (production / distribution / émission / régulation /
// autre). Aligne le PDF sur ROLE_OPTIONS du frontend (lib/audit-options.js).
// Pas d'icône depuis 0.1.147/0.1.158 — fa-fan pour Émission pouvait
// être confondu avec la catégorie d'usage Ventilation, fa-industry
// pour Production évoquait à tort l'industriel. La couleur fait
// office de marqueur, le label porte le sens.
// Charte PDF : rouge / orange / vert réservés aux verdicts. La production
// (le générateur) en navy, les autres fonctions en ardoise.
const ROLE_PILL = {
  production:   { label: 'Production',   color: '#1b2842' },
  distribution: { label: 'Distribution', color: '#475569' },
  emission:     { label: 'Émission',     color: '#475569' },
  regulation:   { label: 'Régulation',   color: '#475569' },
  autre:        { label: 'Autre',        color: '#6b7280' },
};
Handlebars.registerHelper('rolePill', (role, variant) => {
  const cfg = ROLE_PILL[String(role || '').toLowerCase()];
  if (!cfg) return '';
  const isSm = typeof variant === 'string' && variant === 'sm';
  const cls = isSm ? 'role-pill role-pill-sm' : 'role-pill';
  return new Handlebars.SafeString(
    `<span class="${cls}" style="background:${cfg.color}1a;color:${cfg.color};border:0.3pt solid ${cfg.color}66">${cfg.label}</span>`
  );
});

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
  heating:     { icon: 'fire',      label: 'Chauffage',     bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  cooling:     { icon: 'snowflake', label: 'Refroidissement', bg: '#ecfeff', fg: '#155e75', border: '#a5f3fc' },
  ventilation: { icon: 'fan',       label: 'Ventilation',   bg: '#f0fdfa', fg: '#0f766e', border: '#99f6e4' },
  dhw:      { icon: 'faucet',       label: 'ECS',           bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' },
  pv:       { icon: 'solar-panel',  label: 'PV',            bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  lighting: { icon: 'lightbulb',    label: 'Éclairage',     bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  // Jauge : l'anneau « circle-notch » se lisait comme une icône de chargement
  // dans le PDF (relecture 2026-09-24).
  other:    { icon: 'gauge',        label: 'Général',       bg: '#f9fafb', fg: '#374151', border: '#e5e7eb' },
};
// Charte PDF : catégories, usages, types de compteur et énergies en pastille
// NEUTRE ; seule l'icône garde la couleur de la catégorie. Le rouge, l'orange
// et le vert restent aux verdicts (sinon « Gaz » ou « Chauffage » en rouge
// se lisaient comme une non-conformité).
const NEUTRAL_PILL = { bg: '#f8fafc', fg: '#374151', border: '#e2e8f0' };
function neutralPill(cfg) {
  return cfg ? { ...cfg, iconColor: cfg.iconColor || cfg.fg, ...NEUTRAL_PILL } : cfg;
}
function renderMeterPill(cfg, opts = {}) {
  if (!cfg) return '';
  // Variantes de taille : 'md' (défaut, cards / encarts) | 'sm' (tableaux
  // denses : action-group-table, énergie-section, plan de comptage…).
  const variant = opts.variant === 'sm' ? 'sm' : 'md';
  const iconSize = variant === 'sm' ? '8' : '11';
  const cls = variant === 'sm' ? 'm-pill m-pill-sm' : 'm-pill';
  const def = lookupFaIcon(cfg.icon);
  let svgHtml = '';
  if (def) {
    const [w, h, , , p] = def.icon;
    const d = Array.isArray(p) ? p[p.length - 1] : p;
    const margin = variant === 'sm' ? '0.8mm' : '1.2mm';
    svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${iconSize}" height="${iconSize}" style="vertical-align:-1px;flex-shrink:0;margin-right:${margin}"><path fill="${cfg.iconColor || cfg.fg}" d="${d}"/></svg>`;
  }
  return new Handlebars.SafeString(
    `<span class="${cls}" style="background:${cfg.bg};color:${cfg.fg};border:0.4pt solid ${cfg.border}">${svgHtml}${cfg.label}</span>`
  );
}
// {{{meterTypePill type}}}    -> pastille md (défaut)
// {{{meterTypePill type "sm"}}} -> pastille sm pour tableaux denses
Handlebars.registerHelper('meterTypePill', (type, variant) => {
  const cfg = METER_TYPE_PILL[type] || METER_TYPE_PILL.other;
  return renderMeterPill(neutralPill(cfg), { variant: typeof variant === 'string' ? variant : 'md' });
});
// Usage de compteur → catégorie de système : l'icône d'un usage a la même
// couleur que celle de la catégorie partout dans le rapport (chapitres 3, 4,
// 6, 8 et tableaux A3 — relecture PDF 2026-09-24).
const USAGE_TO_CATEGORY = { heating: 'heating', cooling: 'cooling', ventilation: 'ventilation', dhw: 'dhw', pv: 'electricity_production', lighting: 'lighting_indoor' };
function usageIconColor(usage) {
  const cat = USAGE_TO_CATEGORY[usage];
  return cat && CATEGORY_ICON[cat] ? CATEGORY_ICON[cat].color : '#64748b';
}
Handlebars.registerHelper('meterUsagePill', (usage, variant) => {
  const base = METER_USAGE_PILL[usage] || METER_USAGE_PILL.other;
  const cfg = { ...base, iconColor: usageIconColor(usage) };
  return renderMeterPill(neutralPill(cfg), { variant: typeof variant === 'string' ? variant : 'md' });
});

// Pill « catégorie système » pour les équipements (heating / cooling /
// ventilation / dhw / lighting_indoor / lighting_outdoor / electricity_production).
// Distinct de meterUsagePill (qui couvre les compteurs avec un set un peu
// différent — pas de ventilation, pas de PV par exemple). Aligné sur les
// couleurs system_category de l'UI (cf. frontend/lib/audit-options).
const SYSTEM_CATEGORY_PILL = {
  heating:                { icon: 'fire',        label: 'Chauffage',          bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  cooling:                { icon: 'snowflake',   label: 'Refroidissement',    bg: '#ecfeff', fg: '#155e75', border: '#a5f3fc' },
  ventilation:            { icon: 'fan',         label: 'Ventilation',        bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
  dhw:                    { icon: 'faucet',      label: 'ECS',                bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' },
  lighting_indoor:        { icon: 'lightbulb',   label: 'Éclairage intérieur',bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  lighting_outdoor:       { icon: 'lightbulb',   label: 'Éclairage extérieur',bg: '#fefce8', fg: '#a16207', border: '#fde047' },
  lighting:               { icon: 'lightbulb',   label: 'Éclairage',          bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  electricity_production: { icon: 'solar-panel', label: 'Production photovoltaïque', bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  other:                  { icon: 'gauge',       label: 'Autre',              bg: '#f9fafb', fg: '#374151', border: '#e5e7eb' },
};
Handlebars.registerHelper('systemCategoryPill', (cat, variant) => {
  const base = SYSTEM_CATEGORY_PILL[cat] || SYSTEM_CATEGORY_PILL.other;
  // Icône à la couleur de la catégorie (CATEGORY_ICON = UI SystemCategoryIcon) :
  // la même catégorie garde la même couleur partout dans le rapport.
  const catColor = (CATEGORY_ICON[cat] || (String(cat || '').startsWith('lighting') ? CATEGORY_ICON.lighting_indoor : null))?.color;
  const cfg = catColor ? { ...base, iconColor: catColor } : base;
  return renderMeterPill(neutralPill(cfg), { variant: typeof variant === 'string' ? variant : 'md' });
});

// Pill « énergie primaire » pour la colonne Énergie d'un équipement
// (PDF synthèse tableau systèmes). Aligné sur ENERGY_LABEL (_labels.js)
// + couleurs métier (gaz rouge flamme, élec jaune éclair, etc.).
const ENERGY_PILL = {
  gas:              { icon: 'fire',                 label: 'Gaz',                 bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
  electric:         { icon: 'bolt',                 label: 'Électrique',          bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
  heat_pump:        { icon: 'bolt',                 label: 'Électrique',          bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
  wood:             { icon: 'tree',                 label: 'Bois',                bg: '#ecfccb', fg: '#3f6212', border: '#bef264' },
  biomass:          { icon: 'leaf',                 label: 'Biomasse',            bg: '#ecfccb', fg: '#3f6212', border: '#bef264' },
  fuel_oil:         { icon: 'oil-can',              label: 'Fioul',               bg: '#f3f4f6', fg: '#374151', border: '#d1d5db' },
  district_heating: { icon: 'temperature-half',     label: 'Réseau de chaleur / de froid', bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' },
  solar:            { icon: 'solar-panel',          label: 'Solaire',             bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  autre:            { icon: 'circle-question',      label: 'Autre',               bg: '#f9fafb', fg: '#374151', border: '#e5e7eb' },
};
Handlebars.registerHelper('energyPill', (energy, variant) => {
  if (!energy) return '';
  const cfg = ENERGY_PILL[energy] || ENERGY_PILL.autre;
  return renderMeterPill(neutralPill(cfg), { variant: typeof variant === 'string' ? variant : 'md' });
});

// Pastille Oui / Non / —, colorée + texte (au lieu d'un simple ✓/✗
// dans les tableaux denses). Améliore la scannabilité du PDF synthèse
// sur les colonnes booléennes : un lecteur voit immédiatement les Non
// (rouge pâle) à corriger sans devoir interpréter un symbole nu.
// Argument : valeur ternaire (true / 1 / 'yes' = Oui, false / 0 / 'no'
// = Non, null / undefined = —).
const BOOL_PILL = {
  yes: { label: 'Oui', bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  no:  { label: 'Non', bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  na:  { label: '—',   bg: '#f3f4f6', fg: '#6b7280', border: '#d1d5db' },
};
function triState(v) {
  if (v === true || v === 1 || v === '1' || v === 'yes' || v === 'true') return 'yes';
  if (v === false || v === 0 || v === '0' || v === 'no' || v === 'false') return 'no';
  return 'na';
}
function renderBoolPill(state, opts = {}) {
  const cfg = BOOL_PILL[state] || BOOL_PILL.na;
  const isSm = opts.variant === 'sm';
  const cls = isSm ? 'bool-pill bool-pill-sm' : 'bool-pill';
  return new Handlebars.SafeString(
    `<span class="${cls}" style="background:${cfg.bg};color:${cfg.fg};border:0.4pt solid ${cfg.border}">${cfg.label}</span>`
  );
}
// {{{boolPill v "sm" "neutral"}}} : question dont le « Non » n'est pas un
// écart (ex. « Requis : Non ») → Oui navy, Non gris, jamais de rouge.
const BOOL_PILL_NEUTRAL = {
  yes: { label: 'Oui', bg: '#f1f5f9', fg: '#1b2842', border: '#cbd5e1' },
  no:  { label: 'Non', bg: '#f8fafc', fg: '#6b7280', border: '#e5e7eb' },
};
// 4e argument facultatif : libellé de la réponse manquante, à la place du
// « — » muet — {{{boolPill v "sm" "" "À qualifier"}}} (règle ternaire :
// non répondu n'est ni Oui ni Non).
Handlebars.registerHelper('boolPill', (v, variant, tone, naLabel) => {
  const state = triState(v);
  // « dash » : tiret simple, sans pastille (réponse sans objet ou non
  // qualifiable dans un tableau dense — plus de pastille vide).
  if (state === 'na' && naLabel === 'dash') {
    return new Handlebars.SafeString('<span class="muted">—</span>');
  }
  if (state === 'na' && typeof naLabel === 'string' && naLabel) {
    const cls = variant === 'sm' ? 'bool-pill bool-pill-sm' : 'bool-pill';
    return new Handlebars.SafeString(
      `<span class="${cls}" style="background:#f8fafc;color:#475569;border:0.4pt solid #cbd5e1">${Handlebars.escapeExpression(naLabel)}</span>`
    );
  }
  if (typeof tone === 'string' && tone === 'neutral' && BOOL_PILL_NEUTRAL[state]) {
    const cfg = BOOL_PILL_NEUTRAL[state];
    const cls = variant === 'sm' ? 'bool-pill bool-pill-sm' : 'bool-pill';
    return new Handlebars.SafeString(
      `<span class="${cls}" style="background:${cfg.bg};color:${cfg.fg};border:0.4pt solid ${cfg.border}">${cfg.label}</span>`
    );
  }
  return renderBoolPill(state, { variant: typeof variant === 'string' ? variant : 'md' });
});

// Pill communication équipement : rouge pâle quand non communicant,
// vert quand communicant + suffixe filaire/sans fil discret. Pour le
// tableau synthèse uniquement (le rapport principal a son propre
// rendu avec pilules R175-3 dédiées).
const COMM_STATE_PILL = {
  yes: { icon: 'wifi',              label: 'Communicant',     bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  no:  { icon: 'plug-circle-xmark', label: 'Non communicant', bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  unknown: { icon: 'circle-question', label: 'Non renseigné', bg: '#f8fafc', fg: '#64748b', border: '#e2e8f0' },
};
// Pastille à trois états (ternaire, jamais « non répondu » = « non ») :
// state ∈ 'yes' | 'no' | autre (non renseigné). Cf. commState (_export-data.js).
Handlebars.registerHelper('commStatePill', (state, variant) => {
  const cfg = state === 'yes' ? COMM_STATE_PILL.yes : state === 'no' ? COMM_STATE_PILL.no : COMM_STATE_PILL.unknown;
  return renderMeterPill(cfg, { variant: typeof variant === 'string' ? variant : 'md' });
});
Handlebars.registerHelper('commPill', (hasProtocol, variant) => {
  const cfg = hasProtocol ? COMM_STATE_PILL.yes : COMM_STATE_PILL.no;
  return renderMeterPill(cfg, { variant: typeof variant === 'string' ? variant : 'md' });
});
Handlebars.registerHelper('or', function(...args) {
  // Handlebars passe l'options en dernier argument, on l'exclut
  return args.slice(0, -1).some(v => !!v);
});
Handlebars.registerHelper('and', function(...args) {
  return args.slice(0, -1).every(v => !!v);
});

// boolLabel : 1 -> 'Oui', 0 -> 'Non', null/undefined -> 'Non renseigné'
// (jamais un tiret seul : le lecteur doit distinguer « non répondu » de « non »).
Handlebars.registerHelper('boolLabel', (v) => {
  if (v === 1 || v === true) return 'Oui';
  if (v === 0 || v === false) return 'Non';
  return 'Non renseigné';
});

// Symboles (✓ ✗ ⚠ ? i –) rendus en icônes vectorielles : ces glyphes
// n'existent pas dans Inter et tombaient sur des polices système (Zapf
// Dingbats, Lucida Grande…) au rendu variable d'un poste à l'autre
// (relecture PDF 2026-09-24). Couleur héritée du texte (currentColor).
const GLYPH_ICON = {
  '✓': 'check', '✗': 'xmark', '✕': 'xmark', '⚠': 'triangle-exclamation',
  '?': 'question', 'i': 'info', '–': 'minus', '↗': 'arrow-up-right-from-square',
  '→': 'arrow-right',
};
function glyphSvg(ch, size = '9') {
  const name = GLYPH_ICON[String(ch == null ? '' : ch).trim()];
  const def = name ? lookupFaIcon(name) : null;
  if (!def) return ch == null ? '' : String(ch);
  const [w, h, , , path] = def.icon;
  const d = Array.isArray(path) ? path[path.length - 1] : path;
  return new Handlebars.SafeString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" style="vertical-align:-0.1em;display:inline-block;flex-shrink:0"><path fill="currentColor" d="${d}"/></svg>`);
}
// {{{glyph verdictIcon "9"}}}
Handlebars.registerHelper('glyph', (ch, size) => glyphSvg(ch, typeof size === 'string' ? size : '9'));

// Colonnes facultatives (notes, surface…) : affichées seulement si au moins
// une ligne est renseignée (relecture PDF 2026-09-24 : colonnes vides sur la
// moitié de la largeur). {{#if (anyOf list "notes" "notes_html")}} ;
// anyItemOf pour une liste de groupes { items: [...] }.
const hasContent = (v) => v != null && String(v).replace(/<[^>]*>/g, '').trim() !== '';
Handlebars.registerHelper('anyOf', function (list, ...fields) {
  fields.pop();
  return Array.isArray(list) && list.some(it => it && fields.some(f => hasContent(it[f])));
});
Handlebars.registerHelper('anyItemOf', function (groups, ...fields) {
  fields.pop();
  return Array.isArray(groups) && groups.some(g => (g && g.items || []).some(it => it && fields.some(f => hasContent(it[f]))));
});
// Variantes « au moins une valeur VRAIE » (0 / false / '' ne comptent pas) :
// colonne « Statut » seulement si un compteur est hors service, « Âge »
// seulement si un âge est connu, etc.
const isTruthyVal = (v) => v === true || (typeof v === 'number' && v !== 0)
  || (typeof v === 'string' && v.trim() !== '' && v !== '0' && v !== 'false');
Handlebars.registerHelper('anyTrue', function (list, ...fields) {
  fields.pop();
  return Array.isArray(list) && list.some(it => it && fields.some(f => isTruthyVal(it[f])));
});
Handlebars.registerHelper('anyItemTrue', function (groups, ...fields) {
  fields.pop();
  return Array.isArray(groups) && groups.some(g => (g && g.items || []).some(it => it && fields.some(f => isTruthyVal(it[f]))));
});

// Tri-état (oui / non / non renseigne) pour les questions de conformite
// dont la valeur peut etre NULL = jamais saisie (cf migration 172).
Handlebars.registerHelper('triSym', (v) => (v == null ? '—' : glyphSvg(v ? '✓' : '✗', '10')));
Handlebars.registerHelper('triCls', (v, yes, no, na) => (v == null ? na : (v ? yes : no)));

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
  // Titres : Poppins (geometric sans, modern). Normal + italic (italic
  // utilise par les punchlines editoriales, ex .chapter-big .punch).
  { family: 'Poppins', weight: 400, file: '@fontsource/poppins/files/poppins-latin-400-normal.woff2' },
  { family: 'Poppins', weight: 500, file: '@fontsource/poppins/files/poppins-latin-500-normal.woff2' },
  { family: 'Poppins', weight: 600, file: '@fontsource/poppins/files/poppins-latin-600-normal.woff2' },
  { family: 'Poppins', weight: 700, file: '@fontsource/poppins/files/poppins-latin-700-normal.woff2' },
  { family: 'Poppins', weight: 400, style: 'italic', file: '@fontsource/poppins/files/poppins-latin-400-italic.woff2' },
  { family: 'Poppins', weight: 500, style: 'italic', file: '@fontsource/poppins/files/poppins-latin-500-italic.woff2' },
  { family: 'Poppins', weight: 600, style: 'italic', file: '@fontsource/poppins/files/poppins-latin-600-italic.woff2' },
  { family: 'Poppins', weight: 700, style: 'italic', file: '@fontsource/poppins/files/poppins-latin-700-italic.woff2' },
  // Corps : Inter (reference editoriale Stripe / Linear / Vercel / GitHub).
  // Source de verite cross-app : `frontend/src/main.js` charge les memes
  // poids cote UI Vue. Voir `docs/pdf-design-system.md` section Typographie.
  // Italic embed aussi (utilisé sur back-cover, action notes, etc.).
  { family: 'Inter', weight: 400, file: '@fontsource/inter/files/inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 500, file: '@fontsource/inter/files/inter-latin-500-normal.woff2' },
  { family: 'Inter', weight: 600, file: '@fontsource/inter/files/inter-latin-600-normal.woff2' },
  { family: 'Inter', weight: 700, file: '@fontsource/inter/files/inter-latin-700-normal.woff2' },
  { family: 'Inter', weight: 400, style: 'italic', file: '@fontsource/inter/files/inter-latin-400-italic.woff2' },
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
  font-style: ${f.style || 'normal'};
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
// Le recyclage attend la fin des rendus en cours (lib/browser-pool.js).
const RENDER_RECYCLE_AFTER = parseInt(process.env.PUPPETEER_RECYCLE_AFTER || '50', 10);
const RENDER_TIMEOUT_MS = parseInt(process.env.PUPPETEER_RENDER_TIMEOUT_MS || '120000', 10);

async function _launchBrowser() {
  const b = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  log.info(`Puppeteer browser started (pid=${b.process()?.pid || '?'})`);
  return b;
}

const _browserPool = createBrowserPool({
  launch: _launchBrowser,
  recycleAfter: RENDER_RECYCLE_AFTER,
  // Filet : une instance recyclée ferme au plus tard après le délai
  // maximal d'un rendu (+ 30 s), même si un rendu figé ne l'a pas rendue.
  retireGraceMs: RENDER_TIMEOUT_MS + 30000,
  log,
});

// Réserve le navigateur et ouvre un onglet pour un rendu. L'appelant ferme
// l'onglet puis appelle `release()` (bloc finally).
async function _openRenderPage() {
  const lease = await _browserPool.lease();
  try {
    return { page: await lease.browser.newPage(), release: lease.release };
  } catch (err) {
    lease.release();
    throw err;
  }
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

// Rapports d'audit BACS : espace insécable entre un nombre et son unité
// (« 290 kW » ne se coupe plus en fin de ligne — relecture clarté R2 m4).
// Limité aux gabarits bacs-audit* ; n'agit que sur « chiffre espace unité ».
const NBSP_UNITS_RE = /(\d) (kWh|kW|MWh|m²|°C|%)(?=[\s,.;:!?)<\]»]|$)/g;
// Typographie française sur les seuls NŒUDS TEXTE (jamais dans les balises,
// les attributs, les <style> ni les <script>) : espace insécable avant « : ;
// ! ? » » et après « « » (relecture clarté R2 m4).
function frenchTypography(text) {
  // Forme composée (NFC) : un nom de fichier macOS arrive décomposé (« a »
  // + accent combinant), glyphe absent de la police embarquée.
  return text.normalize('NFC')
    // « R175-1 6° » jamais coupé avant l'alinéa (avant l'habillage ci-dessous).
    .replace(/(R175-\d+(?:-\d+)?) (\d+°)/g, '$1\u00a0$2')
    // Références d'articles jamais coupées au trait d'union (« R175- » / « 2 »).
    .replace(/\b((?:R|L)\.?\u00a0?\s?1\d{2}-\d+(?:-\d+)?)/g, '<span style="white-space:nowrap">$1</span>')
    .replace(NBSP_UNITS_RE, '$1\u00a0$2')
    // Groupes de milliers saisis en dur (« 1 000 m² ») jamais coupés.
    .replace(/(?<=\d) (?=\d{3}(?!\d))/g, '\u00a0')
    // Tiret d'incise jamais en début de ligne ; « (44 unités) » et « (zone
    // Cellule 1) » jamais coupés avant leur nombre.
    .replace(/ — /g, '\u00a0— ')
    .replace(/(\d) (unités?|équipements?|ans?)\b/g, '$1\u00a0$2')
    .replace(/ (\d{1,3}\))/g, '\u00a0$1')
    // Séparateurs « · » et « - » (noms de zone « Vestiaires - Sanitaires »)
    // jamais en début de ligne.
    .replace(/ · /g, '\u00a0· ')
    .replace(/ - /g, '\u00a0- ')
    // Ordinal « 1er » / « 1re » en exposant (comme dans l'annexe A), lié au
    // mot suivant (« 1er janvier » jamais coupé).
    .replace(/\b1(er|re)\b( ?)/g, (_m, suf, sp) => `1<sup class="ord">${suf}</sup>${sp ? '\u00a0' : ''}`)
    .replace(/ ([:;!?»])/g, '\u00a0$1')
    .replace(/« /g, '«\u00a0')
    .replace(/n° (\d)/g, 'n°\u00a0$1');
}
function typographyForTemplate(template, html) {
  if (!/^bacs-audit/.test(template)) return html;
  return html
    .split(/(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<title[\s\S]*?<\/title>)/i)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/>([^<]+)</g, (_m, text) => `>${frenchTypography(text)}<`)))
    .join('');
}

async function _renderPdfImpl({ template, styles, data, outputPath, pdfOptions = {}, populateToc = false, pageFormat = 'A4', pageOrientation = 'portrait', skipFirstPageHeaderFooter = false, watermark = null, coverFullBleed = false, closingFullBleed = false, backCoverFullBleed = false, addFormFields = false, pageContainerSelector = '.page', fresh = false, pageMarginTopMm = 22, pageMarginBottomMm = 18 }) {
  const tpl = loadTemplate(template, { fresh });
  const css = loadStyles(styles);
  const fullCss = getEmbeddedFontsCss() + '\n' + css;
  const html = typographyForTemplate(template, tpl({ ...data, styles: fullCss }));

  const { page, release } = await _openRenderPage();
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

        // Chaque [data-toc-anchor] est un <h1 class="chapter"> en
        // page-break-before:always → il demarre une nouvelle page. La page
        // d'un chapitre = page du precedent + nombre de pages qu'il occupe
        // (>=1, +1 par tranche de debordement). Un simple offset / hauteur
        // de page serait faux : le rendu ecran ignore les sauts de page,
        // donc des chapitres courts se retrouveraient sur la meme "page"
        // calculee alors qu'ils sont paginés séparément.
        const anchors = [...document.querySelectorAll('[data-toc-anchor]')];
        const sectionsBottom = sectionsContainer.getBoundingClientRect().bottom + window.scrollY;
        const anchorPages = new Map();
        let currentPage = firstPage;
        for (let i = 0; i < anchors.length; i++) {
          const a = anchors[i];
          const id = a.getAttribute('data-toc-anchor');
          // Ajoute id="X" si absent — necessaire pour que <a href="#X">
          // soit cliquable dans le PDF.
          if (!a.id) a.id = `toc-${id}`;
          anchorPages.set(id, currentPage);
          const top = a.getBoundingClientRect().top + window.scrollY;
          const nextTop = (i + 1 < anchors.length)
            ? anchors[i + 1].getBoundingClientRect().top + window.scrollY
            : sectionsBottom;
          const chapterHeight = Math.max(0, nextTop - top);
          currentPage += Math.max(1, Math.ceil(chapterHeight / innerPx));
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

    // Numéros de page EXACTS de la TOC. L'estimation ci-dessus (hauteur écran
    // ÷ hauteur de page) dérive dès qu'un chapitre contient des sauts forcés
    // (break-inside: avoid, tableau de bord sur 2 pages…) : sommaire décalé
    // d'1 à 2 pages sur les audits BACS réels. On rend donc une première fois
    // le PDF avec les mêmes options, on lit la page réelle de chaque
    // destination « toc-X » (Chrome les inscrit dans /Dests grâce aux liens
    // de la TOC), puis on réécrit les numéros avant le rendu définitif.
    // En cas d'échec, l'estimation est conservée.
    if (populateToc) {
      try {
        const probe = await page.pdf(baseOptions);
        const exactPages = await readTocDestinationPages(probe);
        if (exactPages.size) {
          await page.evaluate((entries) => {
            for (const [id, n] of entries) {
              const el = document.querySelector(`[data-toc-link="${CSS.escape(id)}"] .toc-page`);
              if (el) el.textContent = String(n);
            }
          }, [...exactPages]);
        }
      } catch (err) {
        log.warn(`populateToc : numéros de page exacts indisponibles (${err.message}) — estimation conservée`);
      }
    }

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

    // Back-cover plein-bord : même technique que coverFullBleed, appliquée
    // à la DERNIÈRE page (CTA marketing navy plein-bord d'un livre blanc).
    // Le mécanisme `closingFullBleed` qui pose juste des rectangles navy en
    // post-process ne couvre que top/bottom (pas left/right) et superpose
    // une bande verte qu'on ne veut pas toujours. Ce re-render produit une
    // vraie page navy edge-to-edge.
    if (backCoverFullBleed) {
      const lastTmpPath = outputPath.replace(/\.pdf$/i, '.last-tmp.pdf');
      const sizeRule = pageOrientation === 'landscape'
        ? `${pageFormat} landscape`
        : `${pageFormat} portrait`;
      // Injecte deux choses pour le re-render :
      //   1. @page sans margin (vrai plein-bord Puppeteer)
      //   2. body { background: navy } pour que toute la zone page hors
      //      .closing soit aussi peinte (sinon blanc autour si le
      //      contenu .closing ne couvre pas tout).
      // On re-rend le DOM ENTIER (pas pageRanges) car le retrait des
      // margins change le re-flow → pageCount du tmp ≠ pageCount du
      // PDF principal. replaceLastPage() prend ensuite la DERNIÈRE
      // page du tmp pour la réinjecter à la dernière position du
      // PDF principal. Cf. incident 0.1.166 « Page range exceeds
      // page count ».
      const overrideStyleId = await page.evaluate((size) => {
        const id = '__back_cover_fullbleed_override__';
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `@page { size: ${size}; margin: 0 !important; padding: 0 !important; }
                             body { background: #1b2842 !important; }`;
        document.head.appendChild(style);
        return id;
      }, sizeRule);
      try {
        await page.pdf({
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          path: lastTmpPath,
        });
        await replaceLastPage(outputPath, lastTmpPath);
      } catch (err) {
        // Fail-safe : on garde le PDF initial sans back-cover plein-bord.
        log.warn(`backCoverFullBleed re-render failed : ${err.message}`);
      } finally {
        await page.evaluate((id) => {
          const el = document.getElementById(id);
          if (el) el.remove();
        }, overrideStyleId);
        try { fs.unlinkSync(lastTmpPath); } catch { /* ignore */ }
      }
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
    // closingFullBleed : la derniere page est une page de cloture plein-bord
    // (fond navy edge-to-edge via @page nommee margin:0). Puppeteer dessine
    // quand meme le header/footer dans la bande de marge -> on masque ces
    // 2 bandes avec des rectangles navy, comme maskFirstPage pour la cover.
    const needMaskLast = closingFullBleed && pdfOptions.displayHeaderFooter
      && pdfOptions.margin;
    const needPostProcess =
      needMask || needMaskLast ||
      watermark || (addFormFields && extractedFields && extractedFields.length);
    if (needPostProcess) {
      await postProcessPdf(outputPath, {
        maskFirstPage: needMask ? { margin: pdfOptions.margin, color: '#1b2842' } : null,
        maskLastPage: needMaskLast ? { margin: pdfOptions.margin, color: '#1b2842', accentTop: { heightMm: 4, hex: '#00cd92' } } : null,
        watermark,
        formFields: addFormFields ? extractedFields : null,
        pageFormat,
        pageOrientation,
      });
    }
  } finally {
    await page.close().catch(() => {});
    release();
  }

  const stats = fs.statSync(outputPath);
  return { path: outputPath, sizeBytes: stats.size };
}

const mmToPt = (mm) => parseFloat(mm) * 2.83465;

// Page réelle (1 = première page du PDF, comme le pied de page « N / total »)
// de chaque destination nommée « toc-X » d'un PDF rendu par Chrome.
// Renvoie une Map X → numéro de page.
async function readTocDestinationPages(pdfBuffer) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } = require('pdf-lib');
  const pdf = await PDFDocument.load(pdfBuffer);
  const refToPage = new Map(pdf.getPages().map((p, i) => [p.ref.toString(), i + 1]));
  const out = new Map();
  const dests = pdf.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (!dests) return out;
  for (const [key, value] of dests.entries()) {
    const name = key.decodeText();
    if (!name.startsWith('toc-')) continue;
    let target = value instanceof PDFRef ? pdf.context.lookup(value) : value;
    if (target instanceof PDFDict) target = target.lookup(PDFName.of('D'));
    if (!(target instanceof PDFArray)) continue;
    const pageNum = refToPage.get(target.get(0).toString());
    if (pageNum) out.set(name.slice(4), pageNum);
  }
  return out;
}

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

async function replaceLastPage(mainPath, lastPath) {
  const { PDFDocument } = require('pdf-lib');
  const mainBytes = fs.readFileSync(mainPath);
  const lastBytes = fs.readFileSync(lastPath);
  const mainDoc = await PDFDocument.load(mainBytes);
  const lastDoc = await PDFDocument.load(lastBytes);
  const mainPageCount = mainDoc.getPageCount();
  const tmpPageCount = lastDoc.getPageCount();
  // Combien de pages la closing occupe-t-elle dans le PDF principal ?
  // Hypothèse : cover + chapters prennent le même nombre de pages dans
  // les 2 rendus (margins identiques pour eux). Donc :
  //   closingPagesInMain = mainPageCount - (tmpPageCount - 1)
  // où (tmpPageCount - 1) = pages cover+chapters du re-render plein-bord
  // (et 1 page de closing tmp qu'on va injecter). Incident 0.1.167 :
  // si la closing débordait sur 2 pages dans le main, on ne remplaçait
  // que la dernière → l'ancienne 1ère moitié de la closing restait
  // visible en avant-dernière page (bandes blanches autour, mocheté).
  const closingPagesInMain = Math.max(1, mainPageCount - (tmpPageCount - 1));
  // Retire toutes les pages "closing" du main, puis ajoute la closing
  // plein-bord re-rendue (= dernière page du tmp).
  for (let i = 0; i < closingPagesInMain; i++) {
    mainDoc.removePage(mainDoc.getPageCount() - 1);
  }
  const lastTmpIdx = lastDoc.getPageCount() - 1;
  const [lastPage] = await mainDoc.copyPages(lastDoc, [lastTmpIdx]);
  mainDoc.addPage(lastPage);
  fs.writeFileSync(mainPath, await mainDoc.save());
}

async function postProcessPdf(pdfPath, { maskFirstPage, maskLastPage, watermark, formFields, pageFormat, pageOrientation }) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const bytes = fs.readFileSync(pdfPath);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();

  // Masque les bandes header/footer d'une page avec un rectangle plein.
  // accentTop: { heightMm, hex } facultatif — bandeau couleur dessine APRES
  // le masque navy, au tout haut de la page. Utilise pour la bande verte
  // Buildy de la page de cloture (sinon le masque navy l'efface).
  const maskHeaderFooter = (page, { margin, color, accentTop }) => {
    const { width, height } = page.getSize();
    const topPt = margin.top ? mmToPt(margin.top) : 0;
    const botPt = margin.bottom ? mmToPt(margin.bottom) : 0;
    const hexToRgb = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return rgb(r, g, b);
    };
    const fill = hexToRgb(color);
    if (topPt > 0) page.drawRectangle({ x: 0, y: height - topPt, width, height: topPt, color: fill });
    if (botPt > 0) page.drawRectangle({ x: 0, y: 0, width, height: botPt, color: fill });
    if (accentTop && accentTop.heightMm > 0) {
      const accentH = mmToPt(accentTop.heightMm);
      page.drawRectangle({ x: 0, y: height - accentH, width, height: accentH, color: hexToRgb(accentTop.hex) });
    }
  };

  // 1. Masque header/footer page 1
  if (maskFirstPage && pages.length > 0) {
    maskHeaderFooter(pages[0], maskFirstPage);
  }
  // 1bis. Masque header/footer derniere page (page de cloture plein-bord)
  if (maskLastPage && pages.length > 0) {
    maskHeaderFooter(pages[pages.length - 1], maskLastPage);
  }

  // 2. Filigrane Buildy — preservation d'aspect, dimensionne pour couvrir
  // au moins widthRatio x page_width ET heightRatio x page_height (la plus
  // contraignante des deux dicte l'echelle ; l'autre dimension deborde et
  // est rognee par les bords de page).
  if (watermark) {
    const {
      imagePath,
      skipFirstPage = false,
      skipLastPage = false,
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
    const endIdx = skipLastPage ? pages.length - 1 : pages.length;
    for (let i = startIdx; i < endIdx; i++) {
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
  await _browserPool.shutdown();
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
/* Idem pour la page de cloture plein-bord (derniere section). */
body > .closing:last-child {
  margin: 8mm -${d.padX}mm -${d.padY}mm -${d.padX}mm;
  width: calc(100% + ${d.padX * 2}mm);
}
`;
}

// Header/footer Puppeteer unifie pour tous les PDF Buildy.
// - HEADER : "CLIENT · PROJET" a gauche (uppercase), "<Doc> · <version>" a droite (mono)
// - FOOTER : [logo Buildy] | "<Doc> · note" | "Page X / Y"
// Inter (400 / 600) embarquée en data URL pour les gabarits d'en-tête et de
// pied de page, que Chromium rend hors du document principal.
let _hfFontCss = null;
function headerFooterFontCss() {
  if (_hfFontCss != null) return _hfFontCss;
  const parts = [];
  for (const [weight, file] of [
    [400, '@fontsource/inter/files/inter-latin-400-normal.woff2'],
    [600, '@fontsource/inter/files/inter-latin-600-normal.woff2'],
  ]) {
    try {
      const b64 = fs.readFileSync(require.resolve(file)).toString('base64');
      parts.push(`@font-face{font-family:'Inter';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`);
    } catch { /* police absente : repli système */ }
  }
  _hfFontCss = parts.length ? `<style>${parts.join('')}</style>` : '';
  return _hfFontCss;
}

// Toujours utiliser cet helper, jamais de header/footer custom dans une route :
// l'objectif est d'avoir des en-tetes/pieds de page identiques sur tous les exports.
function buildHeaderFooter({
  clientName,
  projectName,
  docType,        // ex: "Analyse Fonctionnelle", "Synthèse", "Audit BACS", "Liste de points"
  version,        // ex: "af-v0.14"
  logoDataUrl,    // result of loadAssetDataUrl('logo-buildy.svg')
  footerNote,     // optionnel, defaut = "<docType> · document confidentiel"
  decreeVersionLabel, // optionnel — Lot 2 : ajoute la version R175 de référence dans le footer
  margin,         // optionnel, defaut adapte au portrait A4
  hidePagination, // optionnel — supprime le bloc « X / Y » a droite (cas catalogue offres)
}) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  // Pas de doublon « Audit BACS · … Audit BACS — Site » : un nom de projet
  // qui commence par le type de document (déjà affiché à droite) en est
  // débarrassé dans l'en-tête (relecture PDF 2026-09-24).
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shortProject = docType
    ? (String(projectName || '').replace(new RegExp(`^\\s*${reEsc(docType)}\\s*[—–:-]\\s*`, 'i'), '') || projectName)
    : projectName;
  const ctx = `${esc(clientName)} · ${esc(shortProject)}`;
  const docRight = `${esc(docType)} · ${esc(version)}`;
  // Lot 2 — Versioning juridique : pour les audits BACS livrés, on grave la
  // version du décret de référence dans le pied de page, en l'ajoutant au
  // libellé existant (footerNote ou défaut). Conserve la rétrocompat des
  // PDF AF/brochure qui passent un footerNote spécifique sans décret R175.
  let note = footerNote || `${docType} · document confidentiel`;
  if (decreeVersionLabel) note = `${note} · ${decreeVersionLabel}`;
  return {
    displayHeaderFooter: true,
    margin: margin || { top: '18mm', bottom: '16mm', left: '12mm', right: '12mm' },
    // Inter embarquée aussi dans l'en-tête et le pied de page (gabarits rendus
    // à part par Chromium) : sinon Helvetica / Menlo selon le poste.
    headerTemplate: `${headerFooterFontCss()}<div style="font-family:'Inter',sans-serif; font-size:7.5pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; justify-content:space-between; align-items:center; letter-spacing:0.02em;">
      <span style="text-transform:uppercase; letter-spacing:0.1em; font-size:6.5pt; color:#9ca3af;">${ctx}</span>
      <span style="font-variant-numeric:tabular-nums; font-size:7pt; color:#6b7280;">${docRight}</span>
    </div>`,
    footerTemplate: `${headerFooterFontCss()}<div style="font-family:'Inter',sans-serif; font-size:7.5pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; align-items:center; gap:4mm; border-top:0.4pt solid #e5e7eb; padding-top:2mm;">
      <img src="${logoDataUrl}" style="height:4mm; opacity:0.55;" />
      <span style="flex:1; color:#9ca3af; font-size:7pt;">${esc(note)}</span>
      ${hidePagination ? '' : `<span style="font-variant-numeric:tabular-nums; font-size:7pt; color:#4b5563; font-weight:600;">
        <span class="pageNumber"></span> <span style="color:#9ca3af; font-weight:400;">/</span> <span class="totalPages"></span>
      </span>`}
    </div>`,
  };
}

function renderHtml({ template, styles, data, pageFormat = 'A4', pageOrientation = 'portrait', fresh = false }) {
  const tpl = loadTemplate(template, { fresh });
  const css = loadStyles(styles);
  const fullCss = getEmbeddedFontsCss() + '\n' + css + '\n' + buildPreviewOverride({ pageFormat, pageOrientation });
  return typographyForTemplate(template, tpl({ ...data, styles: fullCss }));
}

// ── Rendu PDF d'un livre blanc « HTML brut » ─────────────────────────
// Rend un fichier HTML autonome EXACTEMENT tel quel (avec ses assets
// relatifs resolus via file://), sans template ni Handlebars. Garantit
// un PDF fidele au pixel au HTML d'origine. Le HTML cible peut definir
// `body.puppeteer-export` pour masquer ses elements d'edition (bouton
// export, badges de debordement). Pre-flight overflow : avorte si une
// `.page` deborde de plus de 3 mm (tolerance navigateur).
async function renderRawHtmlPdf(opts) {
  return _withTimeout(_renderRawHtmlPdfImpl(opts), RENDER_TIMEOUT_MS, `renderRawHtmlPdf(${opts.htmlPath})`);
}

async function _renderRawHtmlPdfImpl({ htmlPath, outputPath }) {
  const { page, release } = await _openRenderPage();
  try {
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.evaluate(() => document.body.classList.add('puppeteer-export'));
    await page.evaluate(() => (document.fonts && document.fonts.ready) || true);
    await new Promise((r) => setTimeout(r, 1500)); // settle fontes / kit FA

    // Pre-flight : aucune section ne doit deborder de > 3 mm (cf. la
    // procedure METHODE-FIX-DEBORDEMENT du livre blanc original).
    const overflows = await page.evaluate(() => {
      const PX_PER_MM = 96 / 25.4;
      const MAX = 297 * PX_PER_MM;
      const sel = 'section.page, section.cover, section.pivot, section.back';
      return [...document.querySelectorAll(sel)]
        .map((p, i) => ({ index: i + 1, overMm: Math.max(0, (p.scrollHeight - MAX) / PX_PER_MM) }))
        .filter((x) => x.overMm > 3);
    });
    if (overflows.length) {
      const list = overflows.map((o) => `page ${o.index} (+${o.overMm.toFixed(1)} mm)`).join(', ');
      throw new Error(`Debordement de pages : ${list}`);
    }

    await page.pdf({
      path: outputPath,
      width: '210mm',
      height: '297mm',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const stat = fs.statSync(outputPath);
    return { path: outputPath, sizeBytes: stat.size };
  } finally {
    await page.close().catch(() => { /* ignore */ });
    release();
  }
}

// Helper expose pour les modules qui injectent des pilules FA en HTML
// (cf. _export-data.js stripActionTags). Retourne une chaine SVG inline.
function renderFaIconSvg(name, color, size) {
  const def = lookupFaIcon(name);
  if (!def) return '';
  const [w, h, , , path] = def.icon;
  const d = Array.isArray(path) ? path[path.length - 1] : path;
  const px = size || '12';
  const fill = color || 'currentColor';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${px}" height="${px}" style="vertical-align:-1px;display:inline-block;flex-shrink:0;"><path fill="${fill}" d="${d}"/></svg>`;
}

module.exports = {
  renderPdf,
  renderHtml,
  renderRawHtmlPdf,
  buildHeaderFooter,
  loadAssetDataUrl,
  loadFileAsDataUrl,
  shutdown,
  renderFaIconSvg,
};
