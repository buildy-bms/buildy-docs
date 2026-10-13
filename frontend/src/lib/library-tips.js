// Infobulles de la bibliothèque (2026-10-12) : sections types, fonctionnalités, modèles
// d'équipement, catégories, éditeurs et modales associées. Contenus des bulles v-tooltip en
// français simple (lecteurs qui ne connaissent pas le décret), tutoiement, article du décret
// en pied discret. Fonctions PURES, imports relatifs uniquement (testées par
// backend-node/test/library-tips.test.mjs, qui applique les règles de rédaction du lint).
// Règles : CLAUDE.md § « Infobulles (UI) ».

import { plural } from './tooltip-content.js';
import { decreePlain, normalizeArticle } from './decree-plain.js';

// ── Dates ──────────────────────────────────────────────────────────────────────────────────

// Horodatages SQLite (CURRENT_TIMESTAMP, datetime('now')) : « 2026-10-12 08:15:00 », en UTC.
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 12 oct. 2026 » (vide si la date est absente ou illisible). */
export function formatDay(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** « 12 oct. 2026 à 10:15 ». */
export function formatWhen(v) {
  const d = toDate(v);
  if (!d) return '';
  return `${formatDay(d)} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

// ── Statut de validation du contenu (pastille grise / orange / verte) ─────────────────────

/**
 * @param {'empty'|'draft'|'validated'} status
 * @param {{ validatedAt?: string|null, validatedBy?: string|null }} [who]
 */
export function validationTip(status, { validatedAt = null, validatedBy = null } = {}) {
  if (status === 'validated') {
    const rows = [];
    const day = formatDay(validatedAt);
    if (day) rows.push({ icon: 'calendar', label: 'Validé le', value: day });
    if (validatedBy) rows.push({ icon: 'user', label: 'Par', value: validatedBy });
    return {
      title: 'Contenu validé',
      tone: 'success',
      text: 'Relu et approuvé. Toute modification du texte le repasse en brouillon.',
      rows,
    };
  }
  if (status === 'draft') {
    return {
      title: 'Brouillon à valider',
      tone: 'warning',
      text: 'Le texte est rédigé, mais personne ne l’a encore validé.',
      todo: 'Relis-le, puis valide-le.',
    };
  }
  return {
    title: 'Contenu vide',
    tone: 'neutral',
    text: 'Aucun texte n’est encore rédigé.',
    todo: 'Rédige le texte, puis valide-le.',
  };
}

/** Filtre « À traiter » des listes de la bibliothèque. */
export const PENDING_FILTER_TIP = 'Voir les éléments vides ou en brouillon';

// ── Captures d'écran ───────────────────────────────────────────────────────────────────────

export const PHOTOS_COLUMN_TIP = {
  title: 'Captures d’écran',
  icon: 'camera',
  text: 'Images jointes à cet élément de la bibliothèque, reprises dans les analyses fonctionnelles qui l’utilisent.',
  todo: 'Pour en ajouter, glisse une image sur la ligne ou ouvre la galerie.',
};

/** Bouton appareil photo d'une ligne (n = nombre de captures). */
export function photosTip(n) {
  if (n > 1) return { label: `Gérer les ${n} captures`, icon: 'camera' };
  if (n === 1) return { label: 'Gérer la capture', icon: 'camera' };
  return { label: 'Ajouter des captures', icon: 'camera' };
}

/** Bouton « pleine largeur » d'une capture (PDF de la brochure). */
export function fullWidthTip(isFull) {
  return isFull
    ? { label: 'Revenir à la mise en page automatique', icon: 'arrows-left-right-to-line' }
    : { label: 'Mettre en pleine largeur (brochure)', icon: 'arrows-left-right-to-line' };
}

// ── Utilisation dans les AF ────────────────────────────────────────────────────────────────

/** En-tête « AFs » des listes de sections types et de fonctionnalités. */
export function afColumnTip(noun = 'section') {
  return {
    title: 'Utilisation dans les AF',
    icon: 'bookmark',
    text: `Nombre d’analyses fonctionnelles (AF) actives qui contiennent cette ${noun}. « ↻ » : celles qui n’ont pas encore sa dernière version.`,
  };
}

/**
 * Compteur d'AF d'une section type ou d'une fonctionnalité.
 * @param {{ count?: number, outdated?: number, noun?: string }} u  noun : 'section' | 'fonctionnalité'
 */
export function sectionUsageTip({ count = 0, outdated = 0, noun = 'section' } = {}) {
  if (!count) {
    return {
      title: 'Inutilisée',
      tone: 'neutral',
      icon: 'circle-minus',
      text: `Aucune analyse fonctionnelle active ne contient cette ${noun}.`,
      todo: 'Si elle ne sert plus, tu peux la supprimer.',
    };
  }
  const rows = [{ icon: 'bookmark', label: 'AF actives', value: count }];
  if (outdated) rows.push({ icon: 'rotate', tone: 'warning', label: 'Mise à jour en attente', value: outdated });
  return {
    title: `Utilisée dans ${count} AF`,
    tone: outdated ? 'warning' : 'info',
    icon: 'bookmark',
    text: outdated
      ? `${plural(outdated, 'analyse fonctionnelle (AF) garde', 'analyses fonctionnelles (AF) gardent')} une ancienne version : la mise à jour est proposée à l’ouverture.`
      : `Toutes ces analyses fonctionnelles (AF) ont la dernière version de cette ${noun}.`,
    rows,
  };
}

/** Compteur « Documents » d'un modèle d'équipement (sections d'AF actives qui l'utilisent). */
export function equipmentUsageTip(n) {
  if (!n) {
    return { title: 'Inutilisé', tone: 'neutral', icon: 'circle-minus', text: 'Aucune analyse fonctionnelle active n’utilise ce modèle.' };
  }
  return {
    title: `Utilisé dans ${plural(n, 'section d’AF', 'sections d’AF')}`,
    tone: 'info',
    icon: 'bookmark',
    text: 'Les analyses fonctionnelles (AF) actives qui l’utilisent sont listées en bas de sa fiche.',
  };
}

/** Bouton corbeille d'un modèle d'équipement : grisé tant qu'une AF l'utilise. */
export function equipmentDeleteTip(n) {
  if (!n) return 'Supprimer ce modèle d’équipement';
  return {
    title: 'Suppression impossible',
    tone: 'warning',
    icon: 'lock',
    text: `Ce modèle sert encore dans ${plural(n, 'section', 'sections')} d’analyse fonctionnelle.`,
    todo: 'Retire-le d’abord de ces analyses : elles sont listées en bas de sa fiche.',
  };
}

// ── Versions des modèles d'équipement ──────────────────────────────────────────────────────

const VERSION_TEXT =
  'Elle augmente à chaque changement de description, de protocoles ou de points. Les analyses fonctionnelles existantes gardent la leur jusqu’à leur mise à jour.';

/** Pastille « v4 » d'un modèle d'équipement. */
export function versionTip(n) {
  return { title: `Version ${n || 1} du modèle`, icon: 'clock-rotate-left', tone: 'info', text: VERSION_TEXT };
}

/** Section d'une AF qui utilise le modèle : à jour ou en retard. */
export function afSectionVersionTip(version, current) {
  const v = version || 0;
  if (v >= (current || 0)) return `Section à jour : version ${v} du modèle`;
  return {
    title: 'Mise à jour en attente',
    tone: 'warning',
    icon: 'rotate',
    text: `Cette section utilise la version ${v} du modèle ; la version ${current} est disponible.`,
    todo: 'Ouvre l’analyse fonctionnelle : la mise à jour y est proposée.',
  };
}

/** Pastille « N en retard » d'une AF. */
export function afOutdatedTip(n) {
  return {
    title: plural(n, 'section en retard', 'sections en retard'),
    tone: 'warning',
    icon: 'rotate',
    text: 'Elles utilisent une ancienne version du modèle.',
    todo: 'Ouvre l’analyse fonctionnelle : la mise à jour y est proposée.',
  };
}

export const AF_UP_TO_DATE_TIP = 'Toutes les sections sont à jour';

/** En-têtes du tableau des modèles d'équipement. */
export const EQUIPMENT_COLUMN_TIPS = {
  energy: {
    title: 'Énergie par défaut',
    icon: 'bolt',
    text: 'Énergie pré-remplie sur l’équipement créé depuis ce modèle.',
  },
  roles: {
    title: 'Fonctions par défaut',
    icon: 'sliders',
    text: 'Rôles pré-remplis sur l’équipement créé depuis ce modèle : production, distribution, émission, régulation…',
  },
  points: {
    title: 'Points',
    icon: 'list-check',
    text: 'Nombre de données que la GTB lit (mesures, états) ou écrit (commandes, consignes) pour ce modèle.',
  },
  documents: {
    title: 'Utilisation dans les AF',
    icon: 'bookmark',
    text: 'Nombre de sections d’analyses fonctionnelles (AF) actives qui utilisent ce modèle.',
  },
  protocols: {
    title: 'Protocoles exigés',
    icon: 'network-wired',
    text: 'Langages de communication attendus pour cet équipement, repris dans l’analyse fonctionnelle : Modbus, BACnet, KNX…',
  },
  version: { title: 'Version du modèle', icon: 'clock-rotate-left', text: VERSION_TEXT },
  changelog: { title: 'Journal des modifications', icon: 'clock-rotate-left', text: 'Ce qui a changé dans cette version du modèle.' },
  sync: {
    title: 'Synchronisation',
    icon: 'arrows-rotate',
    text: 'Sections de cette analyse fonctionnelle qui n’ont pas encore la dernière version du modèle.',
  },
};

export const EQUIPMENT_SLUG_LABEL = 'Identifiant technique du modèle';

// ── Ordre (glisser-déposer) ────────────────────────────────────────────────────────────────

const DRAG_BLOCKERS = {
  search: { text: 'Le glisser-déposer est désactivé pendant une recherche.', todo: 'Efface la recherche pour changer l’ordre.' },
  filter: { text: 'Le glisser-déposer marche seulement sur la liste complète.', todo: 'Efface la recherche et choisis « Tous ».' },
  sort: { text: 'Le glisser-déposer marche seulement dans l’ordre d’origine, sans filtre ni tri de colonne.', todo: null },
};

/**
 * Poignée de glisser-déposer.
 * @param {boolean} enabled
 * @param {'search'|'filter'|'sort'} [blocker]  ce qui fige l'ordre
 */
export function dragTip(enabled, blocker = 'filter') {
  if (enabled) return 'Glisser pour changer l’ordre';
  const b = DRAG_BLOCKERS[blocker] || DRAG_BLOCKERS.filter;
  return { title: 'Ordre figé', tone: 'neutral', icon: 'grip-vertical', text: b.text, todo: b.todo };
}

// ── Régénération avec Claude ───────────────────────────────────────────────────────────────

const REGEN_EMPTY = {
  sections: 'Aucune section type n’a encore de texte',
  functionalities: 'Aucune fonctionnalité n’a encore de texte',
  equipment: 'Aucun modèle n’a encore de description ni de justification BACS',
};

/**
 * Bouton « Régénérer avec Claude » d'une liste.
 * @param {number} count  textes que Claude peut reformuler
 * @param {'sections'|'functionalities'|'equipment'} what
 */
export function regenerateTip(count, what = 'sections') {
  if (count > 1) return { label: `Reformuler jusqu’à ${count} textes avec Claude`, icon: 'wand-magic-sparkles' };
  if (count === 1) return { label: 'Reformuler le texte rédigé avec Claude', icon: 'wand-magic-sparkles' };
  return {
    title: 'Rien à régénérer',
    tone: 'neutral',
    icon: 'wand-magic-sparkles',
    text: `${REGEN_EMPTY[what] || REGEN_EMPTY.sections} : Claude reformule seulement un texte existant.`,
    todo: 'Rédige d’abord au moins un contenu.',
  };
}

/** Options « corpus » de la modale de régénération (library-context.js côté serveur). */
export const CORPUS_TIPS = {
  include: {
    title: 'Inclure le corpus existant',
    icon: 'book',
    text: 'Claude relit aussi d’autres textes de la bibliothèque pour rester cohérent avec eux. Plus il en lit, plus le coût augmente.',
  },
  neighbors: {
    title: 'Voisins',
    icon: 'book',
    text: 'Claude lit les textes proches : même section parente, ou même catégorie pour un modèle d’équipement.',
  },
  summary: {
    title: 'Résumé complet',
    icon: 'book',
    text: 'Claude lit toute la bibliothèque en version courte : le titre et une phrase par élément.',
  },
  full: {
    title: 'Corpus complet',
    icon: 'book',
    text: 'Claude lit les textes entiers de la bibliothèque, des plus récents aux plus anciens, dans la limite d’environ 30 000 caractères.',
  },
};

/** État d'un élément pendant la régénération. */
export function regenerateStatusTip(status, message = '') {
  if (status === 'running') return 'Reformulation en cours…';
  if (status === 'ok') return 'Reformulé et enregistré';
  if (status === 'fail') return { title: 'Échec de la régénération', tone: 'error', text: message || 'Erreur inconnue.' };
  return null;
}

// ── Types de document (AF, brochure, audit) ────────────────────────────────────────────────

const DOCUMENT_KIND_TIPS = {
  af: {
    title: 'Analyse fonctionnelle (AF)',
    icon: 'file-lines',
    text: 'Document livré avec le chantier, qui décrit le fonctionnement de la GTB. L’inspection périodique de la GTB l’examine.',
    article: 'R175-5-1',
  },
  brochure: {
    title: 'Brochure commerciale',
    icon: 'book',
    text: 'Document commercial assemblé à partir de la bibliothèque de fonctionnalités.',
  },
  bacs_audit: {
    title: 'Audit BACS',
    icon: 'clipboard-check',
    text: 'Rapport d’audit de conformité au décret BACS.',
  },
};

/**
 * Carte d'un type de document (pastille ou bouton à cocher).
 * @param {string} kind  af | brochure | bacs_audit
 * @param {{ label?: string, description?: string }} [fallback]  entrée du catalogue serveur
 */
export function documentKindTip(kind, fallback = {}) {
  const tip = DOCUMENT_KIND_TIPS[kind];
  if (tip) return { ...tip };
  const title = fallback?.label || (kind ? String(kind) : '');
  return title ? { title, icon: 'file-lines', text: fallback?.description || '' } : null;
}

export const DOCUMENTS_COLUMN_TIP = {
  title: 'Documents',
  icon: 'file-lines',
  text: 'Documents où la section apparaît : analyse fonctionnelle (AF), brochure commerciale, audit BACS.',
};

export const NO_DOCUMENT_TIP = {
  title: 'Dans aucun document',
  tone: 'warning',
  text: 'Sans type de document, cette section n’apparaît nulle part.',
  todo: 'Ouvre la section et coche au moins un document.',
};

/** Barre de sélection des sections types : bouton « Modifier les tags… ». */
export const BULK_KINDS_TIP = {
  title: 'Types de document',
  icon: 'file-lines',
  text: 'Ajoute, retire ou remplace les types de document des sections cochées : analyse fonctionnelle, brochure, audit BACS.',
};

export const CASCADE_KINDS_TIP = {
  title: 'Propager aux sous-sections',
  icon: 'file-lines',
  text: 'Applique aussi ces types de document à toutes les sous-sections de cette section.',
};

// ── Décret BACS ────────────────────────────────────────────────────────────────────────────

/** « R175-1 1°, 2° ; R175-3 4° ; R175-5-1 » → [{ code: 'R175-1', points: ['1°', '2°'] }, …] */
export function parseBacsReference(reference) {
  const out = [];
  if (!reference) return out;
  let last = null;
  for (const raw of normalizeArticle(reference).split(/[;,]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/R175-\d+(?:-\d+)?/);
    const code = m ? m[0] : last?.code;
    if (!code) continue;
    let entry = out.find((e) => e.code === code);
    if (!entry) {
      entry = { code, points: [] };
      out.push(entry);
    }
    for (const p of part.replace(code, '').matchAll(/(\d+)°/g)) {
      if (!entry.points.includes(`${p[1]}°`)) entry.points.push(`${p[1]}°`);
    }
    last = entry;
  }
  return out;
}

/** Pastille d'articles du décret (« R175-3 1°, 2° ; R175-6 ») : ce qu'ils veulent dire, en clair. */
export function bacsReferenceTip(reference) {
  const titles = [];
  for (const r of parseBacsReference(reference)) {
    const keys = r.points.length ? r.points.map((p) => `${r.code} ${p}`) : [r.code];
    for (const k of keys) {
      const plain = decreePlain(k);
      if (plain && !titles.includes(plain.title)) titles.push(plain.title);
    }
  }
  if (!titles.length) return null;
  return {
    title: 'Articles du décret en clair',
    icon: 'scale-balanced',
    tone: 'info',
    text: titles.map((t) => `• ${t}`),
    article: normalizeArticle(reference),
  };
}

/** Une ligne du sélecteur d'articles : l'article en clair (titre officiel en pied). */
export function bacsArticleTip(code, officialTitle = '') {
  const plain = decreePlain(code);
  if (!plain) return officialTitle ? { title: officialTitle, icon: 'scale-balanced', tone: 'info', article: code } : null;
  return {
    title: plain.title,
    icon: 'scale-balanced',
    tone: 'info',
    text: plain.text,
    meta: officialTitle ? `« ${officialTitle} »` : '',
    article: code,
  };
}

export const BACS_POINTS_TIP = {
  title: 'Points précis de l’article',
  icon: 'scale-balanced',
  text: 'Numéros des points visés dans l’article, séparés par des virgules. Laisse vide pour viser tout l’article.',
};

/** En-tête « BACS » des listes de sections types et de fonctionnalités. */
export function bacsColumnTip(noun = 'section') {
  const verb = noun === 'fonctionnalité' ? 'couverts par cette fonctionnalité' : 'auxquels répond cette section';
  return {
    title: 'Décret BACS',
    icon: 'scale-balanced',
    text: `Articles du décret BACS ${verb}. Ouvre une pastille pour lire l’extrait du décret.`,
  };
}

export const GRANULARITY_HELP = {
  title: 'Échelle de la régulation',
  icon: 'temperature-half',
  text: 'Par pièce, par zone ou centralisée : la finesse du réglage automatique de la température. Pour le chauffage, une régulation seulement centralisée ne suffit pas.',
  article: 'R175-6',
};

// ── Catégories de systèmes ─────────────────────────────────────────────────────────────────

export const CATEGORY_COLUMN_TIPS = {
  key: {
    title: 'Clé interne',
    icon: 'key',
    text: 'Identifiant technique de la catégorie. Les modèles d’équipement, les audits et les analyses fonctionnelles s’y rattachent par cette clé.',
  },
  bacs: {
    title: 'Articles du décret',
    icon: 'scale-balanced',
    text: 'Articles du décret BACS qui s’appliquent à la catégorie. Tous ses modèles d’équipement en héritent.',
  },
  candidates: {
    title: 'Modèles candidats',
    icon: 'cube',
    text: 'Modèles d’équipement qui peuvent relever de cette catégorie : un équipement créé depuis l’un d’eux peut la choisir comme catégorie d’usage.',
  },
};

export const CATEGORY_KEY_HELP = {
  title: 'Clé interne',
  icon: 'key',
  text: 'Identifiant technique de la catégorie : lettres, chiffres et « _ » seulement. La changer met à jour tous les éléments qui l’utilisent.',
};

export const EQUIPMENT_SLUG_HELP = {
  title: 'Identifiant technique',
  icon: 'key',
  text: 'Code court et stable du modèle, par exemple « pac-air-eau ». Laisse vide à la création : il est déduit du nom.',
};

// ── Icône et couleur (éditeurs) ────────────────────────────────────────────────────────────

/** Case de la grille d'icônes (nom FontAwesome, en anglais : c'est le mot de recherche). */
export function iconChoiceLabel(name) {
  return `Choisir l’icône « ${name} »`;
}

const COLOR_NAMES = {
  '#3b82f6': 'bleu',
  '#1e40af': 'bleu nuit',
  '#0ea5e9': 'bleu ciel',
  '#06b6d4': 'cyan',
  '#6366f1': 'indigo',
  '#10b981': 'émeraude',
  '#22c55e': 'vert',
  '#16a34a': 'vert foncé',
  '#facc15': 'jaune',
  '#eab308': 'jaune or',
  '#f97316': 'orange',
  '#ea580c': 'orange foncé',
  '#ef4444': 'rouge',
  '#dc2626': 'rouge foncé',
  '#a855f7': 'violet',
  '#ec4899': 'rose',
  '#475569': 'gris ardoise foncé',
  '#64748b': 'gris ardoise',
  '#6b7280': 'gris',
};

/** Pastille de couleur prédéfinie : « Choisir la couleur bleu ciel ». */
export function colorLabel(hex) {
  const name = COLOR_NAMES[String(hex || '').toLowerCase()];
  return name ? `Choisir la couleur ${name}` : 'Choisir cette couleur';
}

export const CUSTOM_COLOR_LABEL = 'Choisir une couleur personnalisée';

// ── Protocoles ─────────────────────────────────────────────────────────────────────────────

/** Pastille « +2 » : protocoles masqués faute de place. */
export function moreProtocolsTip(list) {
  const hidden = (Array.isArray(list) ? list : []).filter(Boolean);
  if (!hidden.length) return null;
  return {
    title: plural(hidden.length, 'autre protocole exigé', 'autres protocoles exigés'),
    icon: 'network-wired',
    tone: 'neutral',
    text: hidden.map((p) => `• ${p}`),
  };
}

// ── Données lues / écrites d'un modèle (points) ────────────────────────────────────────────

export const POINT_COLUMN_TIPS = {
  slug: {
    title: 'Identifiant',
    icon: 'key',
    text: 'Code unique du point dans ce modèle. Il sert à reconnaître le point lors d’un import depuis un autre modèle.',
  },
  techName: {
    title: 'Nom technique',
    icon: 'tag',
    text: 'Nom du point dans la GTB, par exemple T_AIR_NEUF.',
  },
  type: {
    title: 'Type de donnée',
    icon: 'tag',
    text: 'Ce que représente le point.',
    rows: [
      { label: 'Mesure', value: 'grandeur mesurée (température, débit…)' },
      { label: 'État', value: 'marche, arrêt, position…' },
      { label: 'Alarme', value: 'défaut signalé par l’équipement' },
      { label: 'Commande', value: 'ordre envoyé à l’équipement' },
      { label: 'Consigne', value: 'valeur à atteindre' },
    ],
  },
  nature: {
    title: 'Nature de la valeur',
    icon: 'hashtag',
    text: 'Format de la valeur échangée.',
    rows: [
      { label: 'Booléen', value: 'deux états, 0 ou 1' },
      { label: 'Numérique', value: 'un nombre' },
      { label: 'Enum', value: 'une valeur choisie dans une liste fermée' },
      { label: 'Chaîne de caractères', value: 'du texte' },
    ],
  },
  optional: {
    title: 'Point facultatif',
    icon: 'circle-question',
    text: 'Donnée facultative : décochée par défaut dans l’analyse fonctionnelle, à activer selon ce que fournit l’équipement.',
  },
};

export const POINTS_IMPORT_TIP = {
  title: 'Importer des points',
  icon: 'file-import',
  text: 'Copie les données lues et écrites d’un autre modèle d’équipement. Les points déjà présents ici ne sont jamais écrasés.',
};

/** Case « tout cocher » des points (une seule sélection pour les lectures et les écritures). */
export function pointsSelectAllTip(allChecked) {
  return allChecked ? 'Décocher tous les points' : 'Cocher tous les points, lus et écrits';
}

// ── Types de régulation suggérés ───────────────────────────────────────────────────────────

export const REGULATION_RESET_LABEL = 'Remplacer par les suggestions par défaut';

export const REGULATION_CLEAR_TIP = {
  title: 'Vider la liste',
  tone: 'neutral',
  icon: 'eraser',
  text: 'Le modèle n’aura plus de liste à lui : l’audit proposera les suggestions par défaut de la catégorie d’usage du système.',
};

export const REGULATION_ID_COLUMN_TIP = {
  title: 'Identifiant technique',
  icon: 'key',
  text: 'Code enregistré dans l’audit pour ce choix. Il se remplit tout seul à partir du libellé et doit rester unique dans la liste.',
};

// ── Fonctionnalités : offres, FAQ, publication ─────────────────────────────────────────────

const OFFER_LEVELS = { avail_e: 'Essentials', avail_s: 'Smart', avail_p: 'Premium', E: 'Essentials', S: 'Smart', P: 'Premium' };

/** En-tête de colonne d'une offre (Essentials, Smart, Premium). */
export function offerColumnTip(level) {
  const name = OFFER_LEVELS[level] || level;
  return {
    title: `Offre ${name}`,
    icon: 'table-list',
    text: `Ce que contient l’offre ${name} : fonctionnalité incluse, en option payante, ou « — » si elle en est absente.`,
  };
}

/**
 * Disponibilité d'une fonctionnalité dans une offre (cellule ou bouton de choix).
 * @param {'included'|'paid_option'|null} value
 * @param {string} level  avail_e | avail_s | avail_p | E | S | P
 */
export function availTip(value, level) {
  const name = OFFER_LEVELS[level] || level || '';
  if (value === 'included') return { label: `Incluse dans l’offre ${name}`, icon: 'circle-check' };
  if (value === 'paid_option') return { label: `En option payante dans l’offre ${name}`, icon: 'euro-sign' };
  return { label: `Absente de l’offre ${name}`, icon: 'ban' };
}

export const OFFERS_PREVIEW_TIP = {
  title: 'Aperçu du tableau des offres',
  icon: 'eye',
  text: 'Chaque fonctionnalité face aux trois offres Essentials, Smart et Premium, telle qu’elle apparaîtra dans le PDF.',
};

export const OFFERS_PDF_TIP = {
  title: 'Tableau des offres en PDF',
  icon: 'download',
  text: 'Télécharge le PDF, recréé à l’instant à partir de la bibliothèque.',
};

export const BROCHURE_PDF_TIP = {
  title: 'Brochure détaillée en PDF',
  icon: 'download',
  text: 'Télécharge le PDF qui décrit chaque fonctionnalité en détail, en complément du tableau des offres.',
};

/**
 * Bouton « Publier » / « Mettre à jour » d'un PDF en ligne.
 * @param {'catalog'|'brochure'} what
 * @param {{ published_at?: string }|null} info  publication en cours, ou null
 */
export function publishTip(what, info = null) {
  const doc = what === 'brochure' ? 'la brochure' : 'le tableau des offres';
  const tip = {
    title: info ? `Republier ${doc}` : `Publier ${doc}`,
    icon: 'upload',
    tone: 'info',
    text: 'Met le PDF en ligne sur buildy.fr, toujours à la même adresse : la nouvelle version remplace l’ancienne.',
  };
  const when = info ? formatWhen(info.published_at) : '';
  if (when) tip.rows = [{ icon: 'calendar', label: 'Dernière publication', value: when }];
  return tip;
}

export const FAQ_COLUMN_TIP = {
  title: 'Article de FAQ',
  icon: 'circle-question',
  text: 'Article public de la FAQ Buildy (help.buildy.fr) tiré de cette fonctionnalité.',
  rows: [
    { icon: 'wand-magic-sparkles', label: 'Générer', value: 'pas encore d’article' },
    { icon: 'circle-check', tone: 'success', label: 'À jour', value: 'suit la dernière version' },
    { icon: 'triangle-exclamation', tone: 'warning', label: 'À revoir', value: 'la fonctionnalité a changé depuis l’article' },
    { icon: 'lock', label: 'Confidentiel', value: 'publication interdite' },
  ],
};

function faqArticleRows(article) {
  const rows = [];
  if (article?.status) {
    const published = article.status === 'published';
    rows.push({ icon: published ? 'circle-check' : 'pen', tone: published ? 'success' : null, label: 'Article', value: published ? 'publié' : 'brouillon' });
  }
  const day = formatDay(article?.source_synced_at);
  if (day) rows.push({ icon: 'calendar', label: 'Généré le', value: day });
  return rows;
}

/**
 * Badge « FAQ » d'une fonctionnalité.
 * @param {'locked'|'none'|'diverged'|'synced'} kind
 * @param {{ status?: string, source_synced_at?: string }|null} article
 */
export function faqStatusTip(kind, article = null) {
  if (kind === 'locked') {
    return {
      title: 'Publication interdite',
      tone: 'neutral',
      icon: 'lock',
      text: 'Cette fonctionnalité est confidentielle : aucun article de FAQ ne peut en être tiré.',
      todo: 'Pour l’autoriser, coche « Autoriser la publication d’un article FAQ » dans sa fiche.',
    };
  }
  if (kind === 'none') return 'Générer un article de FAQ avec l’IA';
  if (kind === 'diverged') {
    return {
      title: 'Article à mettre à jour',
      tone: 'warning',
      text: 'La fonctionnalité a changé depuis la génération de son article de FAQ.',
      rows: faqArticleRows(article),
      todo: 'Ouvre l’article pour le régénérer.',
    };
  }
  return {
    title: 'Article à jour',
    tone: 'success',
    text: 'L’article de FAQ suit la dernière version de cette fonctionnalité. Ouvre-le pour le relire.',
    rows: faqArticleRows(article),
  };
}

// ── Statistiques de téléchargement (lien traçable) ─────────────────────────────────────────

export const CLICKS_TIPS = {
  refresh: {
    title: 'Actualiser maintenant',
    icon: 'rotate',
    text: 'Les statistiques se mettent à jour seules chaque jour. Ce bouton va chercher tout de suite les dernières visites.',
  },
  total: {
    title: 'Clics au total',
    icon: 'chart-simple',
    text: 'Chaque ouverture du lien compte, même répétée par la même personne.',
  },
  uniques: {
    title: 'Visiteurs uniques',
    icon: 'user',
    text: 'Estimation du nombre de personnes, d’après leur adresse IP anonymisée : des postes d’un même réseau peuvent compter pour un seul visiteur.',
  },
  byDay: {
    title: 'Activité récente',
    icon: 'chart-column',
    text: 'Clics par jour, sur les 30 derniers jours où le lien a servi.',
  },
  referers: {
    title: 'Provenances',
    icon: 'link',
    text: 'Site d’où venait le visiteur. « (accès direct) » : aucune page d’origine connue, par exemple un lien ouvert depuis un e-mail.',
  },
};

// ── Éditeurs (section type, fonctionnalité, modèle) ────────────────────────────────────────

export const SECTION_ICON_TIP = {
  title: 'Icône de la fonctionnalité',
  icon: 'image',
  text: 'Affichée dans la liste, la brochure et le tableau des offres.',
};

export const TEXT_HISTORY_TIP = {
  title: 'Historique du texte',
  icon: 'clock-rotate-left',
  text: 'Versions précédentes du contenu, gardées à chaque modification. Tu peux en restaurer une.',
};

/** Bouton ✨ du champ titre / nom : proposer un meilleur intitulé avec Claude. */
export function suggestTitleTip({ busy = false, empty = false, noun = 'titre' } = {}) {
  if (busy) return `Claude cherche un meilleur ${noun}…`;
  if (empty) return `Saisis d’abord un ${noun}`;
  return `Proposer un meilleur ${noun} avec Claude`;
}

/** Bouton « Valider le contenu / la description » grisé : pourquoi. */
export function validateBlockedTip({ canValidate = true, busy = false, what = 'contenu' } = {}) {
  if (!canValidate) {
    return {
      title: 'Rien à valider',
      tone: 'neutral',
      text: what === 'description' ? 'La description fonctionnelle est vide.' : 'Le contenu est vide.',
      todo: what === 'description' ? 'Rédige-la, puis valide-la.' : 'Rédige-le, puis valide-le.',
    };
  }
  return busy ? 'Enregistrement en cours…' : null;
}

/** Bouton « Enregistrer » grisé (champ obligatoire vide), ou étiquette quand il est actif. */
export function saveTip({ missing = null, busy = false, label = null } = {}) {
  if (busy) return null;
  if (missing) return `Saisis d’abord ${missing}`;
  return label;
}

// Icônes citées par ce module (enregistrées par lib/tooltip-icons.js, cf. scripts/gen-tooltip-icons.mjs).
export const LIBRARY_TIP_ICONS = [
  'calendar', 'user', 'camera', 'arrows-left-right-to-line', 'bookmark', 'circle-minus', 'rotate', 'lock',
  'clock-rotate-left', 'bolt', 'sliders', 'list-check', 'network-wired', 'arrows-rotate', 'grip-vertical',
  'wand-magic-sparkles', 'book', 'file-lines', 'clipboard-check', 'scale-balanced', 'temperature-half', 'key',
  'cube', 'tag', 'hashtag', 'circle-question', 'file-import', 'eraser', 'table-list', 'circle-check',
  'euro-sign', 'ban', 'eye', 'download', 'upload', 'pen', 'triangle-exclamation', 'chart-simple',
  'chart-column', 'link', 'image',
];
