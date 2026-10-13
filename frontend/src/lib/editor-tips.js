// Infobulles de l'éditeur d'AF (2026-10-12) : arbre des sections, éditeur de texte (Tiptap),
// tableaux (points, instances, zones), captures, enregistrement automatique. Contenus des
// étiquettes et cartes v-tooltip en français simple, tutoiement. Fonctions PURES, imports
// relatifs uniquement (testées par backend-node/test/editor-tips.test.mjs, qui applique les
// règles de rédaction du lint). Règles : CLAUDE.md § « Infobulles (UI) ».

import { plural, formatKeys } from './tooltip-content.js';
import { normalizeArticle } from './decree-plain.js';

// ── Dates lisibles ─────────────────────────────────────────────────────────────────────────

/** Date SQL (UTC sans fuseau) ou ISO → Date, ou null. */
function parseWhen(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasZone ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « le 12 oct. 2026 à 10:15 » (vide si la date est illisible). */
export function formatWhen(v) {
  const d = parseWhen(v);
  if (!d) return '';
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `le ${day} à ${time}`;
}

/** Signature « il y a 5 min » d'une section : date complète au survol. */
export function updatedAtTip(iso) {
  const when = formatWhen(iso);
  return when ? { label: `Modifiée ${when}`, icon: 'clock' } : null;
}

// ── Arbre des sections ─────────────────────────────────────────────────────────────────────

/** Icône du type de section (première icône de chaque ligne). */
export const SECTION_KIND_TIPS = {
  standard: { label: 'Section de texte', icon: 'file-lines' },
  equipment: { label: 'Section équipement', icon: 'cube' },
  hyperveez_page: { label: 'Page de l’interface Hyperveez', icon: 'display' },
  synthesis: { label: 'Tableau de synthèse', icon: 'table' },
  zones: { label: 'Section des zones fonctionnelles', icon: 'location-dot' },
};

export function sectionKindTip(kind) {
  return SECTION_KIND_TIPS[kind] || SECTION_KIND_TIPS.standard;
}

/** Icône colorée d'un nœud qui regroupe les équipements d'une catégorie d'usage. */
export function categoryNodeTip(label) {
  return { label: label ? `Catégorie d’usage « ${label} »` : 'Catégorie d’usage', icon: 'tag' };
}

export const LIBRARY_EQUIPMENT_ICON_TIP = { label: 'Équipement issu de la bibliothèque', icon: 'cube' };
export const LIBRARY_SECTION_ICON_TIP = { label: 'Section issue de la bibliothèque', icon: 'book' };

/** Pastille ✓ à gauche de chaque ligne : section vérifiée ou non. */
export const SECTION_VERIFIED_TIP = {
  title: 'Section vérifiée',
  tone: 'success',
  icon: 'circle-check',
  text: 'Son contenu a été relu et marqué comme vérifié.',
};

export const SECTION_UNVERIFIED_TIP = {
  title: 'Section à vérifier',
  tone: 'neutral',
  icon: 'circle-check',
  text: 'Son contenu n’a pas encore été relu et marqué comme vérifié.',
  todo: 'Une fois la section relue, clique sur « À vérifier » dans son en-tête pour la marquer vérifiée.',
};

const LEVELS = [
  ['e', 'Essentiel'],
  ['s', 'Smart'],
  ['p', 'Premium'],
];
const AVAIL_ROWS = {
  included: { value: 'Incluse', icon: 'circle-check', tone: 'success' },
  paid_option: { value: 'Option payante', icon: 'euro-sign', tone: 'warning' },
};
const AVAIL_NONE = { value: 'Non disponible', icon: 'circle-minus', tone: 'neutral' };

/**
 * Pastille € d'une fonctionnalité proposée en option payante à au moins un niveau d'offre.
 * @param {{ e?: string|null, s?: string|null, p?: string|null }} avail  disponibilité par niveau
 *   ('included' | 'paid_option' | null), lue sur le modèle de la bibliothèque
 */
export function paidOptionTip(avail = {}) {
  const all = LEVELS.every(([k]) => avail[k] === 'paid_option');
  if (all) {
    return {
      title: 'Option payante à tous les niveaux',
      tone: 'warning',
      icon: 'euro-sign',
      text: 'Toujours facturée à part, quel que soit le niveau d’offre, comme l’option Sérénité.',
    };
  }
  return {
    title: 'Option payante',
    tone: 'warning',
    icon: 'euro-sign',
    text: 'Facturée en plus du contrat de base, selon le niveau d’offre choisi.',
    rows: LEVELS.map(([k, label]) => ({ label, ...(AVAIL_ROWS[avail[k]] || AVAIL_NONE) })),
  };
}

// Choix du maître d'ouvrage (exclusifs : exigée / écartée / option payante ajoutée).
export const DEMAND_TIP = {
  title: 'Marquer comme exigée',
  tone: 'success',
  icon: 'circle-check',
  text: 'Le maître d’ouvrage exige cette fonction : elle sera à inclure dans l’avenant au contrat.',
};
export const UNDEMAND_LABEL = 'Annuler l’exigence du maître d’ouvrage';
export const DEMANDED_BADGE_TIP = {
  title: 'Exigée par le maître d’ouvrage',
  tone: 'success',
  icon: 'circle-check',
  text: 'Cette fonction est à inclure dans l’avenant au contrat.',
};

export const OPT_OUT_TIP = {
  title: 'Écarter cette fonctionnalité',
  tone: 'warning',
  icon: 'ban',
  text: 'Le maître d’ouvrage ne la retient pas : elle ne sera pas livrée, mais reste visible dans le PDF avec un encart.',
};
export const OPT_IN_LABEL = 'Réactiver cette fonctionnalité';
export const OPTED_OUT_BADGE_TIP = {
  title: 'Écartée par le maître d’ouvrage',
  tone: 'warning',
  icon: 'ban',
  text: 'Elle ne sera pas livrée, mais reste visible dans le PDF avec un encart qui le signale.',
};

export const ADD_PAID_OPTION_TIP = {
  title: 'Ajouter en option payante',
  tone: 'success',
  icon: 'euro-sign',
  text: 'L’ajoute au contrat par un avenant, sans changer de niveau d’offre.',
};
export const REMOVE_PAID_OPTION_LABEL = 'Retirer cette option du contrat';
export const PAID_OPTION_ADDED_TIP = {
  title: 'Option payante ajoutée',
  tone: 'success',
  icon: 'euro-sign',
  text: 'Ajoutée au contrat par un avenant, sans changer de niveau d’offre.',
};

/** Sections exclues des exports (œil barré). */
export const EXCLUDED_BADGE_TIP = {
  title: 'Exclue des exports',
  tone: 'neutral',
  icon: 'eye-slash',
  text: 'Elle n’apparaît ni dans le PDF de l’analyse fonctionnelle ni dans la liste de points, et sort de la numérotation.',
};

/** Pastille « AF » : section créée dans ce document, sans modèle dans la bibliothèque. */
export const AD_HOC_SECTION_TIP = {
  title: 'Propre à cette analyse fonctionnelle',
  tone: 'info',
  icon: 'file-lines',
  text: 'Créée dans ce document, cette section n’a pas d’équivalent dans la bibliothèque.',
};

export const PROMOTE_SECTION_TIP = {
  title: 'Ajouter à la bibliothèque',
  tone: 'info',
  icon: 'upload',
  text: 'Crée une section type partagée à partir de celle-ci : son contenu actuel sert de base.',
};

/** Boutons de déplacement au survol d'une ligne (pas de raccourci : ↑ / ↓ changent de section). */
export const MOVE_TIPS = {
  up: 'Remonter cette section',
  down: 'Descendre cette section',
  outdent: { label: 'Sortir de la section parente', icon: 'outdent' },
  indent: { label: 'Imbriquer dans la section précédente', icon: 'indent' },
};

/** Corbeille d'une ligne : la touche Suppr supprime la section sélectionnée. */
export function deleteSectionTip(hasChildren, selected) {
  return {
    label: hasChildren ? 'Supprimer avec ses sous-sections' : 'Supprimer cette section',
    keys: selected ? ['Delete'] : [],
  };
}

/** Filtre « sections à vérifier » (en tête de l'arbre). */
export function unverifiedFilterTip(active, count) {
  if (active) return 'Afficher toutes les sections';
  return {
    title: 'Afficher les sections à vérifier',
    tone: count ? 'warning' : 'success',
    icon: 'filter',
    text: 'Masque les sections déjà vérifiées, sauf celles qui ont une sous-section à vérifier : la liste reste lisible.',
    rows: [{ icon: 'circle-check', label: 'À vérifier', value: count ? plural(count, 'section', 'sections') : 'aucune' }],
  };
}

/** Suppression en lot (mode sélection) : grisée tant que rien n'est coché. */
export function batchDeleteTip(count) {
  if (!count) return 'Coche d’abord les sections à supprimer';
  return `Supprimer ${plural(count, 'section cochée', 'sections cochées')}`;
}

// ── Éditeur de texte (barre d'outils Tiptap : raccourcis réellement actifs) ────────────────

export const EDITOR_TOOLBAR_TIPS = {
  h2: { label: 'Titre de niveau 2', keys: ['Mod', 'Alt', '2'] },
  h3: { label: 'Titre de niveau 3', keys: ['Mod', 'Alt', '3'] },
  bold: { label: 'Gras', keys: ['Mod', 'B'] },
  italic: { label: 'Italique', keys: ['Mod', 'I'] },
  underline: { label: 'Souligné', keys: ['Mod', 'U'] },
  bulletList: { label: 'Liste à puces', keys: ['Mod', 'Shift', '8'] },
  orderedList: { label: 'Liste numérotée', keys: ['Mod', 'Shift', '7'] },
  blockquote: { label: 'Citation', keys: ['Mod', 'Shift', 'B'] },
};

/** Bouton lien (sans raccourci) : insérer, ou modifier le lien sous le curseur. */
export function linkButtonTip(active) {
  return { label: active ? 'Modifier ce lien' : 'Insérer un lien', icon: 'link' };
}

/** Menu des options de Claude (bibliothèque) : grisé pendant la rédaction. */
export function claudeOptionsTip(busy) {
  if (busy) return 'Claude écrit : attends la fin';
  return { label: 'Régler ce que Claude lit avant d’écrire', icon: 'sliders' };
}

const CORPUS_STRATEGIES = {
  neighbors: 'Voisins (entrées proches)',
  summary: 'Résumé complet',
  full: 'Corpus complet',
};

/** Pastille « corpus » du bouton Claude : la bibliothèque existante est lue avant d'écrire. */
export function corpusPillTip(strategy) {
  return {
    title: 'Corpus existant inclus',
    tone: 'info',
    icon: 'book',
    text: 'Claude lit aussi les fonctionnalités et équipements déjà rédigés, pour garder le même vocabulaire et le même niveau de détail.',
    rows: [{ label: 'Stratégie', value: CORPUS_STRATEGIES[strategy] || CORPUS_STRATEGIES.neighbors }],
  };
}

// ── Enregistrement automatique (en-tête de section) ─────────────────────────────────────────

/** Message d'erreur réseau brut (souvent en anglais) → détail lisible. */
export function saveErrorDetail(err) {
  if (!err) return '';
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  const status = err.response?.status;
  if (status) return `Réponse du serveur : erreur ${status}`;
  const message = String(err.message || '');
  if (err.code === 'ECONNABORTED' || /timeout/i.test(message)) return 'Le serveur ne répond pas à temps';
  if (err.code === 'ERR_NETWORK' || /network/i.test(message)) return 'Pas de connexion au serveur';
  return message;
}

/**
 * Carte « Échec de l'enregistrement » (badge rouge de l'en-tête de section).
 * @param {{ error?: object|null, attempt?: number, lastSaved?: string|null, isMac?: boolean }} o
 *   lastSaved = heure du dernier enregistrement réussi (déjà formatée, ex. « 10:15:32 »)
 */
export function autosaveErrorTip({ error = null, attempt = 0, lastSaved = null, isMac = false } = {}) {
  const detail = saveErrorDetail(error);
  const keys = formatKeys(['Mod', 'S'], isMac).join(isMac ? '' : '+'); // « ⌘S » ou « Ctrl+S »
  return {
    title: 'Échec de l’enregistrement',
    tone: 'error',
    text: 'Tes dernières modifications ne sont pas encore enregistrées sur le serveur.',
    rows: [
      lastSaved ? { icon: 'clock', label: 'Dernier enregistrement réussi', value: lastSaved } : null,
      attempt > 0 ? { icon: 'rotate', label: 'Nouveaux essais automatiques', value: attempt } : null,
      detail ? { icon: 'circle-exclamation', tone: 'error', label: 'Détail', value: detail } : null,
    ].filter(Boolean),
    todo: `Vérifie ta connexion, puis relance l’enregistrement avec ${keys}.`,
  };
}

export const AUTOSAVE_RETRY_TIP = {
  title: 'Nouvel essai d’enregistrement',
  tone: 'warning',
  icon: 'rotate',
  text: 'L’essai précédent a échoué : l’enregistrement est relancé automatiquement.',
};

/** « Enregistré il y a 5 s » : heure exacte au survol. */
export function savedAtTip(time) {
  return time ? `Enregistré à ${time}` : null;
}

// ── Description fonctionnelle d'un équipement ──────────────────────────────────────────────

export const DESCRIPTION_CUSTOM_TIP = {
  title: 'Description personnalisée',
  tone: 'info',
  icon: 'pen',
  text: 'Dans ce document, ce texte remplace la description du modèle. La bibliothèque n’est pas modifiée.',
};

export const DESCRIPTION_INHERITED_TIP = {
  title: 'Description de la bibliothèque',
  tone: 'neutral',
  icon: 'book',
  text: 'Texte du modèle d’équipement, commun à toutes les analyses fonctionnelles.',
  todo: '« Modifier dans cette AF » crée une version propre à ce document.',
};

/** Badge « Modèle mis à jour » : le modèle a changé depuis sa reprise dans ce document. */
export function templateDriftTip(localVersion, currentVersion) {
  return {
    title: 'Modèle mis à jour',
    tone: 'warning',
    text: 'Le modèle d’équipement a changé dans la bibliothèque depuis sa reprise dans ce document.',
    rows: [
      { label: 'Version reprise', value: `v${localVersion}` },
      { label: 'Dernière version', value: `v${currentVersion}` },
    ],
    todo: '« Acquitter la version » masque cette alerte sans changer le texte.',
  };
}

export const RESET_DESCRIPTION_LABEL = 'Remplacer ce texte par celui du modèle';
export const ACK_VERSION_LABEL = 'Masquer l’alerte sans changer le texte';
export const OPEN_EQUIPMENT_MODEL_LABEL = 'Ouvrir le modèle dans la bibliothèque';

/** Bouton « 📎 modèle » de l'en-tête d'une section (nom coupé dans le bouton) : le nom complet
 *  en ligne, quelle que soit sa longueur (une étiquette « Ouvrir « nom long » … » passait sur
 *  deux lignes). */
export function openTemplateTip(name) {
  const n = String(name || '').trim();
  return {
    title: 'Modèle de la bibliothèque',
    icon: 'book',
    text: 'Ouvre ce modèle dans la bibliothèque.',
    rows: n ? [{ icon: 'tag', label: 'Nom', value: n }] : [],
  };
}

// ── Captures ───────────────────────────────────────────────────────────────────────────────

/** Badge « Modèle » d'une capture héritée de la bibliothèque. */
export function inheritedCaptureTip(source) {
  const from = source === 'section_template' ? 'du modèle de fonctionnalité' : 'du modèle d’équipement';
  return {
    title: 'Capture héritée du modèle',
    tone: 'info',
    icon: 'paperclip',
    text: `Elle vient ${from}, dans la bibliothèque. Ici, tu ne peux ni la déplacer, ni la supprimer, ni changer sa légende.`,
  };
}

// ── Table de points d'un équipement (légende reprise de la liste de points PDF) ────────────

export const POINT_COLUMN_TIPS = {
  techName: {
    title: 'Nom technique',
    text: 'Identifiant du point dans la GTB ou dans l’équipement, par exemple T_AIR_NEUF.',
  },
  type: { title: 'Type de donnée', text: 'Rôle du point : mesure, état, alarme, commande ou consigne.' },
  nature: { title: 'Nature de la valeur', text: 'Forme de la valeur : vrai ou faux, nombre, choix dans une liste fermée ou texte libre.' },
  // Même lecture que la légende du PDF « liste de points » (templates/pdf/points-list.hbs) et
  // que la fenêtre des points d'une AF (lib/af-tips.js).
  optional: {
    title: 'Point optionnel',
    text: 'Il peut manquer selon le modèle, la version du logiciel ou la configuration de l’équipement.',
  },
};

export const POINT_TYPE_TIPS = {
  Mesure: { title: 'Mesure', tone: 'info', icon: 'gauge', text: 'Valeur physique mesurée : température, débit, puissance…' },
  'État': { title: 'État', tone: 'neutral', icon: 'toggle-on', text: 'État de l’équipement : marche ou arrêt, mode actif…' },
  Alarme: { title: 'Alarme', tone: 'error', icon: 'bell', text: 'Signal d’un défaut ou d’une anomalie détectée (oui ou non).' },
  Commande: { title: 'Commande', tone: 'success', icon: 'hand-pointer', text: 'Action ponctuelle envoyée à l’équipement.' },
  Consigne: {
    title: 'Consigne',
    tone: 'warning',
    icon: 'sliders',
    text: 'Réglage transmis à l’équipement, par exemple une température à atteindre.',
  },
};

export const POINT_NATURE_TIPS = {
  'Booléen': { title: 'Booléen', tone: 'success', icon: 'toggle-on', text: 'Deux valeurs possibles : vrai ou faux.' },
  'Numérique': { title: 'Numérique', tone: 'info', icon: 'hashtag', text: 'Valeur chiffrée, avec son unité.' },
  Enum: {
    title: 'Liste de valeurs',
    tone: 'warning',
    icon: 'list-ul',
    text: 'Une valeur choisie dans une liste fermée, par exemple été, hiver ou arrêt.',
  },
  'Chaîne de caractères': { title: 'Chaîne de caractères', tone: 'neutral', icon: 'font', text: 'Texte libre : code d’erreur, libellé…' },
};

/** Badges « Ajouté localement » / « Modifié localement ». */
export const POINT_SOURCE_TIPS = {
  'local-add': {
    title: 'Point ajouté localement',
    tone: 'success',
    icon: 'plus',
    text: 'Ajouté dans ce document : il n’existe pas dans le modèle d’équipement de la bibliothèque.',
  },
  'local-edit': {
    title: 'Point modifié localement',
    tone: 'warning',
    icon: 'pen',
    text: 'Modifié dans ce document : le modèle de la bibliothèque, lui, ne change pas.',
    todo: 'La flèche de retour, au bout de la ligne, rétablit la valeur du modèle.',
  },
};

/** Case « optionnel » d'un point (un point ajouté localement ne se règle qu'à l'ajout). */
export function pointOptionalToggleTip(point) {
  if (point?.source === 'local-add') {
    return {
      title: 'Réglé à l’ajout du point',
      tone: 'neutral',
      icon: 'lock',
      text: 'Ce point a été ajouté dans ce document : son caractère optionnel ne se change pas ici.',
      todo: 'Retire le point, puis ajoute-le de nouveau avec le bon réglage.',
    };
  }
  return point?.is_optional ? 'Marquer ce point obligatoire' : 'Marquer ce point optionnel';
}

export const RESTORE_POINT_LABEL = 'Restaurer la valeur du modèle';

// ── Instances, zones, catégories ───────────────────────────────────────────────────────────

/** Instance sans catégorie d'usage choisie : celles du modèle s'appliquent. */
export const NO_CATEGORY_CHOSEN_TIP = {
  title: 'Aucune catégorie choisie',
  tone: 'warning',
  icon: 'tag',
  text: 'Toutes les catégories d’usage prévues par le modèle d’équipement sont retenues par défaut.',
  todo: 'Modifie cet équipement pour cocher seulement ce qu’il fait réellement.',
};

/**
 * Catégorie d'usage visée par le décret (pastille « BACS » ou ⚖️).
 * @param {string|null} article  ex. « R175-1 §1, §2 » (catalogue des catégories)
 */
export function bacsCategoryTip(article) {
  return {
    title: 'Concernée par le décret BACS',
    tone: 'info',
    icon: 'scale-balanced',
    text: 'Les équipements de cette catégorie font partie des systèmes techniques que couvre le décret BACS.',
    article: article ? normalizeArticle(article) : null,
  };
}

/** En-tête triable : prochain tri au clic (croissant → décroissant → aucun). */
export function sortTip(column, active, dir) {
  if (!active) return `Trier par ${column}`;
  return dir === 'asc' ? 'Trier par ordre décroissant' : 'Annuler le tri';
}

/** Case « tout cocher » d'un tableau (lignes visibles après filtre), ex. « toutes les zones ». */
export function checkAllTip(allChecked, rows) {
  return `${allChecked ? 'Décocher' : 'Cocher'} ${rows}`;
}

export const ZONE_NAME_REQUIRED_LABEL = 'Saisis d’abord le nom de la zone';
export const INSTANCE_REFERENCE_REQUIRED_LABEL = 'Saisis d’abord la référence';

// ── Mise à jour depuis la bibliothèque (fenêtre de synchronisation) ────────────────────────

/** Bouton « Mettre à jour » grisé : pourquoi. */
export function librarySyncDisabledTip({ loading = false, submitting = false, hasTemplate = true, anyChecked = false } = {}) {
  if (loading || submitting) return null;
  if (!hasTemplate) return 'Aucun modèle de bibliothèque à reprendre';
  if (!anyChecked) return 'Coche au moins un élément à récupérer';
  return null;
}

/** Fenêtre « Insérer un lien » : formats acceptés. */
export const LINK_FORMATS_TIP = {
  title: 'Formats acceptés',
  tone: 'info',
  icon: 'link',
  text: 'Laisse le champ vide pour retirer le lien.',
  rows: [
    { label: 'Adresse web', value: 'https://…' },
    { label: 'E-mail', value: 'mailto:…' },
    { label: 'Téléphone', value: 'tel:…' },
    { label: 'Renvoi dans la page', value: '#…' },
    { label: 'Autre page de l’application', value: '/…' },
  ],
};

// Icônes citées par ce module (enregistrées par lib/tooltip-icons.js, cf. scripts/gen-tooltip-icons.mjs).
export const EDITOR_TIP_ICONS = [
  'clock', 'file-lines', 'cube', 'display', 'table', 'location-dot', 'tag', 'book', 'circle-check', 'euro-sign',
  'circle-minus', 'ban', 'eye-slash', 'upload', 'outdent', 'indent', 'filter', 'link', 'sliders', 'rotate',
  'circle-exclamation', 'pen', 'paperclip', 'gauge', 'toggle-on', 'bell', 'hand-pointer', 'hashtag', 'list-ul',
  'font', 'plus', 'lock', 'scale-balanced',
];
