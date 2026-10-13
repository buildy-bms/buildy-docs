// Contenu des infobulles (directive v-tooltip, 2026-10-12, porté de Buildy Tools) : fonctions
// pures, testées (backend-node/test/tooltip-content.test.mjs). Imports relatifs uniquement.
// Deux formats, tous deux sur fond NAVY (choix de Kévin, identique à Buildy Tools) :
//   - ÉTIQUETTE : texte court (bouton à icône, raccourci, nom complet d'un texte coupé),
//     icône choisie d'après le premier mot ;
//   - CARTE : explication structurée (titre, texte, lignes « clé → valeur », encadré
//     « À faire », pied), liseré et icône de la couleur de l'état ou du métier (accent).
// Règles de rédaction : CLAUDE.md § « Infobulles (UI) ».

export const TONES = ['success', 'warning', 'error', 'info', 'neutral'];

// Les tons de pastille de l'application sont acceptés tels quels.
const TONE_ALIASES = {
  success: 'success',
  emerald: 'success',
  green: 'success',
  ok: 'success',
  warning: 'warning',
  amber: 'warning',
  orange: 'warning',
  yellow: 'warning',
  error: 'error',
  danger: 'error',
  red: 'error',
  rose: 'error',
  info: 'info',
  sky: 'info',
  blue: 'info',
  indigo: 'info',
  navy: 'info',
  primary: 'info',
  neutral: 'neutral',
  muted: 'neutral',
  off: 'neutral',
  gray: 'neutral',
  slate: 'neutral',
};

export function resolveTone(tone) {
  return TONE_ALIASES[tone] || 'info';
}

export const DEFAULT_ICONS = {
  success: 'circle-check',
  warning: 'triangle-exclamation',
  error: 'circle-exclamation',
  info: 'circle-info',
  neutral: 'circle-minus',
};

// Classes Tailwind écrites en entier (détectées par Tailwind). Couleurs d'état éclaircies
// (300/400) pour rester lisibles sur le navy (contrastes mesurés sur Buildy Tools).
export const TIP_TONES = {
  success: {
    bar: 'bg-emerald-400',
    chip: 'bg-emerald-400/15 text-emerald-300 ring-emerald-300/25',
    todo: 'bg-emerald-400/10 ring-emerald-300/25 text-emerald-100',
    rowIcon: 'text-emerald-300',
  },
  warning: {
    bar: 'bg-amber-400',
    chip: 'bg-amber-400/15 text-amber-300 ring-amber-300/25',
    todo: 'bg-amber-400/10 ring-amber-300/25 text-amber-100',
    rowIcon: 'text-amber-300',
  },
  error: {
    bar: 'bg-red-400',
    chip: 'bg-red-400/15 text-red-300 ring-red-300/25',
    todo: 'bg-red-400/10 ring-red-300/25 text-red-100',
    rowIcon: 'text-red-300',
  },
  info: {
    bar: 'bg-sky-400',
    chip: 'bg-sky-400/15 text-sky-300 ring-sky-300/25',
    todo: 'bg-sky-400/10 ring-sky-300/25 text-sky-100',
    rowIcon: 'text-sky-300',
  },
  neutral: {
    bar: 'bg-white/30',
    chip: 'bg-white/10 text-white/70 ring-white/15',
    todo: 'bg-white/5 ring-white/15 text-white/85',
    rowIcon: 'text-white/60',
  },
};

// Accents MÉTIER (Buildy Docs) : icône et couleur des catégories d'usage, des types de compteur
// et des phases de l'audit, reprises de SystemCategoryIcon / MeterTypePill / MeterUsagePill /
// audit-steps-ui, en teinte claire sur navy. Une carte `accent: 'heating'` prend la flamme
// rouge du chauffage ; une ligne `{ accent: 'electric' }` prend l'éclair ambre.
const RED = { bar: 'bg-red-400', chip: 'bg-red-400/15 text-red-300 ring-red-300/25', rowIcon: 'text-red-300' };
const CYAN = { bar: 'bg-cyan-400', chip: 'bg-cyan-400/15 text-cyan-300 ring-cyan-300/25', rowIcon: 'text-cyan-300' };
const TEAL = { bar: 'bg-teal-400', chip: 'bg-teal-400/15 text-teal-300 ring-teal-300/25', rowIcon: 'text-teal-300' };
const SKY = { bar: 'bg-sky-400', chip: 'bg-sky-400/15 text-sky-300 ring-sky-300/25', rowIcon: 'text-sky-300' };
const AMBER = { bar: 'bg-amber-400', chip: 'bg-amber-400/15 text-amber-300 ring-amber-300/25', rowIcon: 'text-amber-300' };
const EMERALD = { bar: 'bg-emerald-400', chip: 'bg-emerald-400/15 text-emerald-300 ring-emerald-300/25', rowIcon: 'text-emerald-300' };
const ORANGE = { bar: 'bg-orange-400', chip: 'bg-orange-400/15 text-orange-300 ring-orange-300/25', rowIcon: 'text-orange-300' };
const VIOLET = { bar: 'bg-violet-400', chip: 'bg-violet-400/15 text-violet-300 ring-violet-300/25', rowIcon: 'text-violet-300' };
const PINK = { bar: 'bg-pink-400', chip: 'bg-pink-400/15 text-pink-300 ring-pink-300/25', rowIcon: 'text-pink-300' };
const SLATE = { bar: 'bg-slate-300', chip: 'bg-white/10 text-slate-200 ring-white/20', rowIcon: 'text-slate-300' };
const BLUE = { bar: 'bg-blue-400', chip: 'bg-blue-400/15 text-blue-300 ring-blue-300/25', rowIcon: 'text-blue-300' };
const PURPLE = { bar: 'bg-purple-400', chip: 'bg-purple-400/15 text-purple-300 ring-purple-300/25', rowIcon: 'text-purple-300' };

export const ACCENTS = {
  // Catégories d'usage
  heating: { icon: 'fire', ...RED },
  cooling: { icon: 'snowflake', ...CYAN },
  ventilation: { icon: 'fan', ...TEAL },
  dhw: { icon: 'faucet', ...SKY },
  lighting: { icon: 'lightbulb', ...AMBER },
  lighting_indoor: { icon: 'lightbulb', ...AMBER },
  lighting_outdoor: { icon: 'tower-cell', ...AMBER },
  electricity_production: { icon: 'solar-panel', ...EMERALD },
  pv: { icon: 'solar-panel', ...EMERALD },
  // Types de compteur
  electric: { icon: 'bolt', ...AMBER },
  electric_production: { icon: 'solar-panel', ...EMERALD },
  gas: { icon: 'fire-flame-curved', ...ORANGE },
  water: { icon: 'droplet', ...SKY },
  thermal: { icon: 'temperature-half', ...VIOLET },
  other: { icon: 'gauge', ...SLATE },
  // Fonctions d'un équipement (pastilles de couleur de lib/audit-options.js ROLE_OPTIONS)
  role_production: { icon: 'bolt', ...RED },
  role_distribution: { icon: 'right-left', ...SKY },
  role_emission: { icon: 'temperature-half', ...BLUE },
  role_regulation: { icon: 'sliders', ...PURPLE },
  role_other: { icon: 'ellipsis', ...SLATE },
  // Phases de l'audit (lib/audit-steps-ui.js)
  site: { icon: 'building', ...SKY },
  equipment: { icon: 'cube', ...VIOLET },
  supervision: { icon: 'display', ...SLATE },
  dossier: { icon: 'folder-open', ...PINK },
};

export function resolveAccent(accent) {
  return (accent && ACCENTS[accent]) || null;
}

// Typographie française automatique : espaces insécables à l'intérieur des guillemets, devant
// « : ; ! ? » et entre un nombre et son unité — jamais de « à » seul en fin de ligne ni de
// « kW » orphelin.
const NBSP = ' ';
const UNITS = 'kWh|kW|MWh|W|%|€|m²|m³|m2|m3|°C|°|ans|an|mois|jours|jour|h|min|s|ms|px|Mo|Ko|Go';
const UNIT_RE = new RegExp(`(\\d) (${UNITS})(?=$|[^\\p{L}\\d])`, 'gu');
export function typo(text) {
  if (text == null) return text;
  return String(text)
    .replace(/(\p{L})'(?=\p{L})/gu, '$1’')
    .replace(/« +/g, `«${NBSP}`)
    .replace(/ +»/g, `${NBSP}»`)
    .replace(/ +([:;!?])(?=\s|$)/g, `${NBSP}$1`)
    .replace(UNIT_RE, `$1${NBSP}$2`);
}

/** « Décret BACS · article R175-3 » : pied discret des cartes qui expliquent une exigence. */
export function articleMeta(article) {
  if (!article) return '';
  return `Décret BACS · article ${String(article).replace(/^article\s+/i, '')}`;
}

/**
 * Texte → blocs : paragraphes, et listes pour les lignes qui commencent par « • » ou « - ».
 * @returns {Array<{type:'p', text:string} | {type:'list', items:string[]}>}
 */
export function parseText(text) {
  if (text == null || text === '') return [];
  const lines = (Array.isArray(text) ? text : String(text).split('\n')).map((l) => typo(String(l).trim())).filter(Boolean);
  const blocks = [];
  for (const line of lines) {
    const m = line.match(/^[•\-–]\s+(.*)$/);
    if (m) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'list') last.items.push(m[1]);
      else blocks.push({ type: 'list', items: [m[1]] });
    } else {
      blocks.push({ type: 'p', text: line });
    }
  }
  return blocks;
}

/** Libellé + valeur courts → sur la même ligne ; sinon la valeur passe en dessous (sans quoi
 *  le libellé se coupe en deux, coincé par la valeur). Seuil calé sur une carte de 540 px. */
export function rowLayout(row) {
  return String(row?.label ?? '').length + String(row?.value ?? '').length <= 52 ? 'inline' : 'stacked';
}

const KEY_NAMES = {
  mod: { mac: '⌘', other: 'Ctrl' },
  cmd: { mac: '⌘', other: 'Ctrl' },
  ctrl: { mac: '⌃', other: 'Ctrl' },
  shift: { mac: '⇧', other: 'Maj' },
  alt: { mac: '⌥', other: 'Alt' },
  enter: { mac: '↵', other: 'Entrée' },
  esc: { mac: 'Échap', other: 'Échap' },
  delete: { mac: 'Suppr', other: 'Suppr' },
  up: { mac: '↑', other: '↑' },
  down: { mac: '↓', other: '↓' },
  left: { mac: '←', other: '←' },
  right: { mac: '→', other: '→' },
};

/** ['Mod', 'K'] → ['⌘', 'K'] sur Mac, ['Ctrl', 'K'] ailleurs. */
export function formatKeys(keys, isMac) {
  if (!Array.isArray(keys)) return [];
  return keys.map((k) => {
    const n = KEY_NAMES[String(k).toLowerCase()];
    return n ? (isMac ? n.mac : n.other) : String(k).length === 1 ? String(k).toUpperCase() : String(k);
  });
}

/** Raccourci pour aria-keyshortcuts : ['Mod', 'B'] → « Meta+B » sur Mac, « Control+B » ailleurs. */
export function ariaKeys(keys, isMac) {
  if (!Array.isArray(keys) || !keys.length) return '';
  const map = { mod: isMac ? 'Meta' : 'Control', cmd: 'Meta', ctrl: 'Control', shift: 'Shift', alt: 'Alt', enter: 'Enter', esc: 'Escape', delete: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  return keys.map((k) => map[String(k).toLowerCase()] || String(k).toUpperCase()).join('+');
}

/** « 1 compteur », « 3 compteurs » ; 0 au singulier, comme en français. */
export function plural(n, one, many) {
  return `${n} ${Math.abs(n) > 1 ? many : one}`;
}

function cleanRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && (r.label || r.value != null))
    .map((r) => {
      const accent = resolveAccent(r.accent);
      return {
        icon: r.icon || accent?.icon || null,
        label: typo(r.label || ''),
        value: r.value == null ? '' : typo(String(r.value)),
        tone: r.tone ? resolveTone(r.tone) : null,
        iconClass: accent ? accent.rowIcon : r.tone ? TIP_TONES[resolveTone(r.tone)].rowIcon : null,
        layout: r.layout || rowLayout(r),
      };
    });
}

function cleanTodo(todo) {
  if (!todo) return null;
  if (typeof todo === 'string' || Array.isArray(todo)) todo = { items: todo };
  const items = (Array.isArray(todo.items) ? todo.items : todo.items ? [todo.items] : todo.text ? [todo.text] : [])
    .map((s) => typo(String(s).trim()))
    .filter(Boolean);
  if (!items.length) return null;
  return { title: todo.title || 'À faire', items };
}

/**
 * Valeur de v-tooltip → contenu normalisé, ou null (rien à afficher).
 *   'texte' | { label | text, keys, mono, icon, placement }      → étiquette
 *   { title, text, tone, accent, icon, rows, todo, meta, article, keys, wide, placement } → carte
 *   () => …                                                         → évaluée au survol
 */
export function normalizeTip(value) {
  if (typeof value === 'function') value = value();
  if (value == null || value === false || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number') {
    const label = typo(String(value).trim());
    return label ? { kind: 'label', label, keys: [], mono: false, placement: null, variant: null, icon: null } : null;
  }
  if (typeof value !== 'object') return null;
  if (!value.title) {
    const label = typo(String(value.label ?? value.text ?? '').trim());
    if (!label) return null;
    return {
      kind: 'label',
      label,
      keys: Array.isArray(value.keys) ? value.keys : [],
      mono: !!value.mono,
      placement: value.placement || null,
      variant: value.variant || null,
      icon: value.icon === undefined ? null : value.icon,
    };
  }
  const tone = resolveTone(value.tone);
  const accent = resolveAccent(value.accent);
  const meta = typo([value.meta ? String(value.meta) : '', articleMeta(value.article)].filter(Boolean).join(' · '));
  return {
    kind: 'card',
    title: typo(String(value.title)),
    tone,
    accent: accent ? value.accent : null,
    icon: value.icon === false ? null : value.icon || accent?.icon || DEFAULT_ICONS[tone],
    blocks: parseText(value.text),
    rows: cleanRows(value.rows),
    todo: cleanTodo(value.todo),
    keys: Array.isArray(value.keys) ? value.keys : [],
    meta,
    wide: !!value.wide,
    placement: value.placement || null,
  };
}

/** Texte lu à voix haute pour un bouton sans texte : l'étiquette, ou le titre d'une carte. */
export function tipAccessibleName(value) {
  const tip = normalizeTip(value);
  if (!tip) return '';
  return tip.kind === 'label' ? tip.label : tip.title;
}

// Style d'une ÉTIQUETTE selon l'élément survolé : ne change que l'icône par défaut.
//   'action' = ce que fait un élément cliquable (bouton, lien, case, curseur main) ;
//   'info'   = une information sur un élément non cliquable (date, état, valeur, nom complet
//              d'un texte coupé), ou la raison d'un bouton grisé (horloge pour une date, ⓘ sinon).
const ACTION_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'label']);
const ACTION_ROLES = new Set(['button', 'link', 'switch', 'checkbox', 'radio', 'menuitem', 'tab', 'option']);

/**
 * @param {{ tag?:string, role?:string|null, clickable?:boolean, disabled?:boolean, hasKeys?:boolean, explicit?:string|null }} a
 * @returns {'action'|'info'}
 */
export function labelVariant({ tag = '', role = null, clickable = false, disabled = false, hasKeys = false, explicit = null }) {
  if (explicit === 'action' || explicit === 'info') return explicit;
  if (disabled) return 'info';
  if (hasKeys) return 'action';
  if (ACTION_TAGS.has(String(tag).toLowerCase()) || ACTION_ROLES.has(role)) return 'action';
  return clickable ? 'action' : 'info';
}

// Icône d'une ÉTIQUETTE, choisie d'après son premier mot : aucune étiquette n'a à la déclarer.
// Ton : danger (action qui retire ou supprime), success (confirmation), info (date,
// information), default. Toutes les icônes sont enregistrées dans lib/tooltip-icons.js
// (test : backend-node/test/tooltip-content.test.mjs). Nouveau mot fréquent = l'ajouter ici.
export const VERB_ICONS = {
  // Retirer, supprimer (rouge)
  supprimer: ['trash', 'danger'], retirer: ['circle-minus', 'danger'], detacher: ['link-slash', 'danger'],
  vider: ['trash', 'danger'], bloquer: ['ban', 'danger'], couper: ['power-off', 'danger'], arreter: ['stop', 'danger'],
  // Confirmations (vert)
  valider: ['check', 'success'], approuver: ['check', 'success'], copie: ['check', 'success'],
  terminee: ['check', 'success'], enregistre: ['check', 'success'], telecharge: ['check', 'success'],
  deja: ['circle-check', 'success'], complet: ['circle-check', 'success'],
  // Actions courantes
  ajouter: ['plus'], creer: ['plus'], nouvelle: ['plus'], nouveau: ['plus'], inserer: ['plus'],
  copier: ['copy'], dupliquer: ['clone'], cloner: ['clone'],
  modifier: ['pen'], editer: ['pen'], completer: ['pen'], corriger: ['pen'], rediger: ['pen-nib'],
  renommer: ['i-cursor'], nommer: ['i-cursor'],
  effacer: ['eraser'], annuler: ['rotate-left'], retablir: ['rotate-left'], revenir: ['rotate-left'],
  rouvrir: ['rotate-left'], reintegrer: ['rotate-left'], restaurer: ['clock-rotate-left'], refaire: ['rotate-right'],
  enregistrer: ['floppy-disk'], sauvegarder: ['floppy-disk'],
  voir: ['eye'], afficher: ['eye'], apercu: ['eye'], visualiser: ['eye'], reveler: ['eye'], details: ['eye'], detail: ['eye'],
  masquer: ['eye-slash'], ignorer: ['eye-slash'], ecarter: ['ban'], "n'afficher": ['filter'], filtrer: ['filter'],
  trier: ['arrow-down-wide-short'], rechercher: ['magnifying-glass'],
  ouvrir: ['arrow-up-right-from-square'], fermer: ['xmark'], quitter: ['compress'],
  agrandir: ['expand'], plein: ['expand'], reduire: ['compress'],
  deplier: ['chevron-down'], replier: ['chevron-up'],
  telecharger: ['download'], exporter: ['file-export'], importer: ['file-import'], deposer: ['file-arrow-up'],
  imprimer: ['print'], rapport: ['file-pdf'], synthese: ['table-list'], dossier: ['folder-open'], zip: ['file-zipper'],
  partager: ['share-nodes'], envoyer: ['paper-plane'], publier: ['upload'], republier: ['upload'], livrer: ['truck'],
  generer: ['wand-magic-sparkles'], regenerer: ['wand-magic-sparkles'], reecrire: ['wand-magic-sparkles'], suggerer: ['wand-magic-sparkles'],
  recalculer: ['calculator'], calculer: ['calculator'], estimer: ['calculator'], cumul: ['calculator'],
  rafraichir: ['rotate'], actualiser: ['rotate'], recharger: ['rotate'], relire: ['rotate'], relancer: ['rotate-right'],
  synchroniser: ['arrows-rotate'], mettre: ['arrows-rotate'], convertir: ['arrows-rotate'],
  verifier: ['list-check'], tester: ['flask'],
  deplacer: ['arrows-up-down-left-right'], glisser: ['grip-vertical'], reordonner: ['grip-vertical'],
  remonter: ['arrow-up'], monter: ['arrow-up'], descendre: ['arrow-down'],
  indenter: ['indent'], desindenter: ['outdent'], sortir: ['outdent'],
  suivant: ['arrow-right'], precedent: ['arrow-left'], passer: ['arrow-right'], aller: ['arrow-right'],
  activer: ['toggle-on'], reactiver: ['toggle-on'], desactiver: ['toggle-off'], basculer: ['arrow-right-arrow-left'],
  verrouiller: ['lock'], deverrouiller: ['lock-open'],
  epingler: ['thumbtack'], desepingler: ['thumbtack'], marquer: ['check'], cocher: ['square-check'], decocher: ['square-minus'],
  selectionner: ['square-check'], choisir: ['hand-pointer'],
  affecter: ['link'], rattacher: ['link'], lier: ['link'], assigner: ['link'], inclure: ['paperclip'],
  positionner: ['location-dot'], localiser: ['location-dot'],
  photographier: ['camera'], prendre: ['camera'], photo: ['camera'], photos: ['images'],
  comprendre: ['circle-question'], aide: ['circle-question'], raccourcis: ['keyboard'],
  se: ['right-from-bracket'], signaler: ['flag'], fusionner: ['code-merge'], remplacer: ['right-left'], grouper: ['object-group'],
  // Mise en forme (barres d'outils de l'éditeur)
  gras: ['bold'], italique: ['italic'], souligne: ['underline'], barre: ['strikethrough'], surligner: ['highlighter'],
  citation: ['quote-left'], titre: ['heading'], 'sous-titre': ['heading'], liste: ['list-ul'], lien: ['link'],
  image: ['image'], tableau: ['table'], encadre: ['note-sticky'], encart: ['note-sticky'],
  // Noms en tête d'étiquette (« Historique », « Fichiers joints »…)
  historique: ['clock-rotate-left'], versions: ['clock-rotate-left'], version: ['clock-rotate-left'],
  activite: ['clock-rotate-left'], journal: ['book'], statistiques: ['chart-simple'], consommation: ['chart-column'],
  fichiers: ['paperclip'], fichier: ['file'], document: ['file-lines'], documents: ['file-lines'],
  note: ['note-sticky'], notes: ['note-sticky'], plus: ['ellipsis'], options: ['sliders'], parametres: ['gear'],
  reglages: ['gear'], configurer: ['gear'], identifiants: ['key'], cle: ['key'],
  zone: ['location-dot'], zones: ['location-dot'], compteur: ['gauge'], compteurs: ['gauge'], equipement: ['cube'],
  site: ['building'], audit: ['clipboard-check'], inspection: ['clipboard-check'], etape: ['list-ol'],
  section: ['file-lines'], sections: ['file-lines'], puissance: ['bolt'], facture: ['file-invoice'],
  date: ['calendar'], delai: ['hourglass-half'], valeur: ['hashtag'], nom: ['font'], type: ['tag'], mode: ['sliders'],
  plan: ['map'], carte: ['map'], adresse: ['location-dot'],
  informations: ['circle-info'], etat: ['circle-info'], actuellement: ['circle-info'],
  // Ajouts du contrôle emplacement par emplacement (13/10) : premiers mots encore sans icône.
  montrer: ['eye'], chercher: ['magnifying-glass'], decrire: ['pen'], ecrire: ['pen'], annoter: ['highlighter'],
  dessiner: ['pen'], inverser: ['right-left'], exclure: ['ban'], retour: ['arrow-left'],
  regulation: ['sliders'], communication: ['network-wired'], protocole: ['network-wired'],
  point: ['list-ul'], points: ['list-ul'], numerotation: ['list-ol'], analyse: ['file-lines'],
  defaut: ['triangle-exclamation', 'danger'], lecture: ['eye'], vrai: ['toggle-on'],
  niveau: ['layer-group'], niveaux: ['layer-group'], offre: ['tag'], usage: ['layer-group'], usages: ['layer-group'],
  gestionnaire: ['user-tie'], pdf: ['file-pdf'], publie: ['upload'], bloc: ['code'],
  centralisee: ['triangle-exclamation', 'danger'], identifiant: ['key'], mes: ['folder-open'],
  chauffage: ['fire'], refroidissement: ['snowflake'], climatisation: ['snowflake'], ventilation: ['fan'],
  eclairage: ['lightbulb'],
  // Passage final (13/10) : derniers premiers mots sans icône. Clé de deux mots lue en premier.
  'eau chaude': ['faucet'], eau: ['droplet'], promouvoir: ['upload'], proposer: ['wand-magic-sparkles'],
};

function fold(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,:;!?…«»()]+$/g, '');
}

/**
 * @param {string} label
 * @param {'action'|'info'} variant
 * @returns {{ icon: string, tone: 'danger'|'success'|'info'|'default' } | null}
 */
export function labelIcon(label, variant = 'action') {
  const words = String(label || '').trim().split(/\s+/);
  let i = 0;
  let w = fold(words[0]);
  // « Tout… » et les nombres (« 5 usages présents ») : l'icône vient du mot suivant.
  if (w === 'tout' || w === 'toutes' || w === 'tous' || /^\d+$/.test(w)) { i = 1; w = fold(words[1]); }
  // Les deux premiers mots d'abord (« Eau chaude… » ≠ « Eau »), puis le premier seul.
  const hit = VERB_ICONS[`${w} ${fold(words[i + 1])}`] || VERB_ICONS[w];
  if (hit) return { icon: hit[0], tone: hit[1] || 'default' };
  if (variant !== 'info') return null;
  // Information : une date (« … le 08/10 à 13:24 », « Dernière sauvegarde … ») prend une horloge.
  if (/\ble \d{2}\/\d{2}\b|^(lue|vu|derniere|dernier|pris|livre|depuis)\b/.test(fold(label))) return { icon: 'clock', tone: 'info' };
  return { icon: 'circle-info', tone: 'info' };
}

/** Aide d'un champ ({ title, text }) → carte d'information. */
export function tipFromHelp(help, extra = {}) {
  if (!help || !help.text) return null;
  return { title: help.title || 'Aide', text: help.text, tone: 'info', icon: 'circle-question', ...extra };
}

// Toutes les icônes que le système peut afficher (étiquettes, cartes, accents) : elles doivent
// être enregistrées par lib/tooltip-icons.js, sinon la bulle sort sans icône (test dédié).
export function tooltipIconNames() {
  const names = new Set(['clock', 'circle-info', 'circle-question', 'list-check', 'arrow-up-right-from-square']);
  for (const v of Object.values(VERB_ICONS)) names.add(v[0]);
  for (const v of Object.values(DEFAULT_ICONS)) names.add(v);
  for (const v of Object.values(ACCENTS)) names.add(v.icon);
  return names;
}
