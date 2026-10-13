// Infobulles de la FAQ Buildy (Crisp) et des pages d'administration : prompts IA, journal des
// actions, paramètres BACS (2026-10-12). Contenus des cartes et des étiquettes v-tooltip, en
// français simple, tutoiement. Fonctions PURES, imports relatifs uniquement (testées par
// backend-node/test/faq-tips.test.mjs, qui applique aussi les règles de rédaction du lint).
// Règles : CLAUDE.md § « Infobulles (UI) ». Les faits viennent du code : lib/faq-sync.js
// (publication, récupération), routes/faq.js (score SEO, versions), routes/ai-prompts.js,
// composables/usePiiBlur.js, composables/useImageCompression.js.
import { decreePlain } from './decree-plain.js';

/** « 12 oct. 2026 à 10:15 » ; vide si la date manque ou n'est pas lisible. */
export function formatDateTime(value) {
  if (!value) return '';
  const s = String(value);
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}

const formatNumber = (n) => Number(n || 0).toLocaleString('fr-FR');

// ── FAQ Buildy : liste des articles ────────────────────────────────────────────────────────

/** En-tête de la colonne « SEO » : ce que mesure le score et ses trois paliers de couleur. */
export const SEO_COLUMN_TIP = {
  title: 'Score de référencement (SEO)',
  icon: 'magnifying-glass',
  text: 'Note sur 100 du référencement de l’article dans Google, recalculée à chaque enregistrement, à l’ouverture et à chaque récupération depuis Crisp.',
  rows: [
    { icon: 'circle-check', tone: 'success', label: 'Bon', value: '80 et plus' },
    { icon: 'triangle-exclamation', tone: 'warning', label: 'Moyen', value: 'de 60 à 79' },
    { icon: 'circle-exclamation', tone: 'error', label: 'À améliorer', value: 'moins de 60' },
  ],
};

/** Article pas encore noté (tiret de la colonne « SEO »). */
export const SEO_NO_SCORE_TIP = {
  title: 'Pas encore de score de référencement',
  tone: 'neutral',
  icon: 'magnifying-glass',
  text: 'Le score se calcule dès que l’article est ouvert ou enregistré.',
};

/** Pastille « 72/100 » d'un article de la liste. */
export function seoScoreTip(score) {
  if (score == null) return SEO_NO_SCORE_TIP;
  const good = score >= 80;
  const mid = !good && score >= 60;
  return {
    title: `Référencement (SEO) : ${score}/100`,
    tone: good ? 'success' : mid ? 'warning' : 'error',
    icon: 'magnifying-glass',
    text: good
      ? 'Bon référencement : l’article a tout pour bien ressortir dans Google.'
      : mid
        ? 'Référencement moyen : l’article peut mieux ressortir dans Google.'
        : 'Référencement faible : l’article ressortira peu dans Google.',
    todo: good ? null : 'Ouvre l’article : sa pastille SEO liste les points à améliorer.',
  };
}

/** En-tête de la colonne « Sync » : les quatre états possibles d'un article. */
export const SYNC_COLUMN_TIP = {
  title: 'Synchronisation avec Crisp',
  icon: 'arrows-rotate',
  text: 'Où en est chaque article par rapport à Crisp, qui publie la FAQ sur help.buildy.fr.',
  rows: [
    { icon: 'triangle-exclamation', tone: 'warning', label: 'À publier', value: 'modifié ici, pas encore envoyé' },
    { icon: 'circle-check', tone: 'success', label: 'Publié il y a…', value: 'dernier envoi vers Crisp' },
    { icon: 'download', label: 'Lu depuis Crisp', value: 'récupéré, pas modifié ici' },
    { icon: 'circle-minus', tone: 'neutral', label: 'Local uniquement', value: 'jamais envoyé sur Crisp' },
  ],
};

/** Pastilles « Publié » / « Brouillon » (statut Crisp : visible ou caché sur help.buildy.fr). */
export const ARTICLE_STATUS_TIPS = {
  published: {
    title: 'Statut « Publié »',
    tone: 'success',
    text: 'Une fois envoyé sur Crisp, l’article est visible par tous sur help.buildy.fr.',
  },
  draft: {
    title: 'Statut « Brouillon »',
    tone: 'neutral',
    text: 'Même envoyé sur Crisp, l’article reste caché sur help.buildy.fr.',
  },
};

/** Point orange d'un article et mention « À publier » (faq_articles.dirty). */
export const ARTICLE_DIRTY_TIP = {
  title: 'Modifications non publiées',
  tone: 'warning',
  text: 'L’article a changé ici depuis son dernier envoi : Crisp montre encore l’ancienne version, ou rien s’il n’a jamais été publié.',
  todo: 'Publie-le vers Crisp quand il est prêt.',
};

/** Cellule « Sync » d'un article : date exacte de l'envoi ou explication de l'état. */
export function syncCellTip(article) {
  if (!article) return null;
  if (article.dirty) return ARTICLE_DIRTY_TIP;
  if (article.pushed_at) {
    const when = formatDateTime(article.pushed_at);
    return when ? `Publié sur Crisp le ${when}` : 'Publié sur Crisp';
  }
  if (article.crisp_id) return 'Récupéré de Crisp, pas modifié depuis';
  return 'Jamais envoyé sur Crisp';
}

/** Point orange d'une catégorie (faq_categories.dirty). */
export const CATEGORY_DIRTY_TIP = {
  title: 'Modifications non publiées',
  tone: 'warning',
  text: 'La catégorie a été créée ou modifiée ici depuis son dernier envoi sur Crisp.',
  todo: 'Publie-la depuis son menu « … ».',
};

/** Bouton « Nouvelle catégorie » : où elle est créée, quand elle arrive sur Crisp. */
export const NEW_CATEGORY_TIP = {
  title: 'Nouvelle catégorie',
  icon: 'plus',
  text: 'Elle est d’abord créée ici. Elle arrive sur Crisp quand tu la publies, ou avec le premier article publié qu’elle contient.',
};

/** Bouton de récupération de la FAQ depuis Crisp. */
export const PULL_TIP = {
  title: 'Récupérer la FAQ depuis Crisp',
  icon: 'download',
  text: 'Récupère les catégories et les articles de Crisp. Un article modifié ici et pas encore publié n’est pas écrasé : il est signalé en conflit.',
};

/** Mention « (échec) » de la dernière récupération. */
export function pullFailedTip(error) {
  return {
    title: 'Dernière récupération en échec',
    tone: 'error',
    text: 'La dernière récupération depuis Crisp n’a pas abouti.',
    rows: error ? [{ label: 'Erreur', value: String(error) }] : null,
    todo: 'Teste la connexion, puis relance la récupération.',
  };
}

/** Bouton « Restaurer » de l'historique d'un article (routes/faq.js : titre, contenu, statut). */
export const FAQ_VERSION_RESTORE_TIP = {
  title: 'Restaurer cette version',
  icon: 'clock-rotate-left',
  text: 'Remet le titre, le contenu et le statut de cette version. L’état actuel est d’abord gardé dans l’historique.',
};

/** Pastille de statut d'une version (valeur brute draft / published). */
export function versionStatusLabel(status) {
  return status === 'published' ? 'Statut de cette version : publié' : 'Statut de cette version : brouillon';
}

/** Bouton « Suggestions IA » de la page FAQ (prompt faq.suggest_missing). */
export const SUGGEST_MISSING_TIP = {
  title: 'Articles qui manquent',
  icon: 'wand-magic-sparkles',
  text: 'L’IA compare ce que fait Buildy (la bibliothèque) aux articles existants et propose les sujets pas encore traités.',
};

/** Bouton « Générer depuis captures » de la page FAQ. */
export const GENERATE_FROM_CAPTURES_TIP = {
  title: 'Nouvel article depuis des captures',
  icon: 'wand-magic-sparkles',
  text: 'Écris ta question et ajoute si besoin jusqu’à 8 captures d’écran : l’IA rédige l’article, tu le relis avant de le créer.',
};

/** Case « Depuis biblio » des filtres. */
export const LIBRARY_FILTER_TIP = {
  title: 'Articles issus de la bibliothèque',
  icon: 'filter',
  text: 'N’affiche que les articles générés à partir d’une fonctionnalité de la bibliothèque.',
};

// ── Prompts IA (pages Prompts IA, Paramètres FAQ, Paramètres BACS) ─────────────────────────

export const NOTHING_TO_SAVE_LABEL = 'Aucune modification à enregistrer';

/** Bouton « Historique (n) » d'un prompt : grisé tant qu'aucune version n'a été gardée. */
export function promptHistoryTip(count, open = false) {
  if (!count) {
    return {
      title: 'Pas encore d’historique',
      tone: 'neutral',
      icon: 'clock-rotate-left',
      text: 'Aucune version précédente de ces consignes de l’IA n’a encore été gardée.',
    };
  }
  return open ? 'Masquer les versions précédentes' : 'Voir les versions précédentes';
}

/** Bouton « Restaurer défaut » d'un prompt. Le serveur supprime alors la version modifiée ET
 *  son historique (routes/ai-prompts.js → db.aiPrompts.delete) : la carte le dit. */
export function promptResetTip(isOverridden) {
  if (!isOverridden) return 'Consignes d’origine, rien à restaurer';
  return {
    title: 'Revenir aux consignes d’origine',
    tone: 'warning',
    icon: 'rotate-left',
    text: 'Remplace ta version des consignes de l’IA par celle fournie avec Buildy Docs.',
    todo: { title: 'Attention', items: ['L’historique de ces consignes est effacé en même temps.'] },
  };
}

/** Bouton « Restaurer » d'une ligne de l'historique d'un prompt. */
export const PROMPT_VERSION_RESTORE_TIP = {
  title: 'Restaurer cette version',
  icon: 'clock-rotate-left',
  text: 'Elle remplace les consignes actuelles, gardées dans l’historique.',
};

// ── Génération d'un article par l'IA (FaqGenerateModal) ────────────────────────────────────

/** Bandeau « Corpus complet » : ce que l'IA lit avant de rédiger. */
export const GENERATE_CORPUS_TIP = {
  title: 'Ce que l’IA connaît de Buildy',
  icon: 'book',
  text: 'Avant de rédiger, l’IA lit toute la bibliothèque Buildy (sections, équipements, fonctionnalités) et les articles FAQ existants.',
};

export const GENERATE_QUESTION_MISSING_LABEL = 'Écris d’abord la question à documenter';

/** Pastille « Annotée » d'une capture. */
export const ANNOTATED_CAPTURE_TIP = {
  title: 'Capture annotée',
  icon: 'pen',
  text: 'Tes repères (flèches, cadres, pastilles, textes, flous) sont dessinés sur l’image envoyée à l’IA.',
};

/** Case « Inclure ces captures dans l'article publié sur Crisp ». */
export const INCLUDE_CAPTURES_TIP = {
  title: 'Captures dans l’article',
  icon: 'images',
  text: 'Cochée : les captures sont mises en ligne et l’IA les place aux bons endroits de l’article. Décochée : elles servent seulement à le rédiger.',
};

/** Estimation « ~3000 tokens (≈ 0,008 €) » sous les captures. */
export const VISION_COST_TIP = {
  title: 'Coût estimé des captures',
  icon: 'calculator',
  text: 'Prix approximatif de la lecture des captures par l’IA, environ 1 500 « tokens » (morceaux de texte) par image. La rédaction de l’article s’y ajoute.',
};

/** Ligne « N tokens in · N tokens out » sous l'article généré. */
export function generationUsageTip(usage) {
  return {
    title: 'Volume traité par l’IA',
    icon: 'calculator',
    text: 'Compté en « tokens », des morceaux de mots : c’est ce qui fixe le coût de la génération.',
    rows: [
      { icon: 'file-import', label: 'Lus par l’IA', value: `${formatNumber(usage?.input_tokens)} tokens` },
      { icon: 'pen-nib', label: 'Écrits par l’IA', value: `${formatNumber(usage?.output_tokens)} tokens` },
    ],
  };
}

/** Bouton « Créer l'article » après la génération (statut brouillon, rien n'est publié). */
export const CREATE_DRAFT_TIP = {
  title: 'Créer l’article en brouillon',
  icon: 'plus',
  text: 'L’article s’ouvre dans l’éditeur. Rien n’est envoyé sur Crisp tant que tu ne le publies pas.',
};

export const BACK_TO_INPUTS_LABEL = 'Revenir à la question et aux captures';

// ── Annotation d'une capture (AnnotationEditor) ────────────────────────────────────────────

/** Outils de la barre de gauche, par clé (TOOLS de AnnotationEditor.vue). */
export const ANNOTATION_TOOL_TIPS = {
  select: 'Sélectionner, déplacer ou redimensionner',
  arrow: 'Dessiner une flèche',
  rect: 'Encadrer une zone',
  ellipse: 'Entourer une zone',
  pin: 'Poser une pastille numérotée',
  spotlight: 'Assombrir tout sauf une zone',
  blur: 'Flouter une zone à la main',
  text: 'Ajouter un texte',
};

const ANNOTATION_COLOR_NAMES = {
  '#ef4444': 'rouge',
  '#f97316': 'orange',
  '#eab308': 'jaune',
  '#22c55e': 'vert',
  '#6366f1': 'bleu',
  '#ffffff': 'blanc',
  '#111827': 'noir',
};

/** Pastille de couleur : « Dessiner en rouge ». */
export function annotationColorLabel(hex) {
  const name = ANNOTATION_COLOR_NAMES[String(hex || '').toLowerCase()];
  return name ? `Dessiner en ${name}` : 'Dessiner dans cette couleur';
}

export function undoTip(canUndo) {
  return canUndo ? 'Annuler la dernière action' : 'Rien à annuler pour l’instant';
}

export function redoTip(canRedo) {
  return canRedo ? 'Rétablir l’action annulée' : 'Rien à rétablir pour l’instant';
}

/** Bouton de floutage automatique : lecture du texte de la capture (usePiiBlur). */
export const PII_BLUR_TIP = {
  title: 'Flouter automatiquement les données sensibles',
  icon: 'eye-slash',
  text: 'Lit le texte de la capture et floute ce qui ne doit pas être montré.',
  rows: [
    { icon: 'building', label: 'Noms', value: 'sites et clients connus' },
    { icon: 'at', label: 'Coordonnées', value: 'e-mails, adresses IP du réseau local' },
    { icon: 'hashtag', label: 'Entreprise', value: 'n° SIRET et de TVA' },
  ],
  todo: 'Vérifie le résultat et ajoute un flou à la main si besoin.',
};

export const PII_RUNNING_LABEL = 'Recherche des données sensibles…';

// ── Journal des actions (AuditTrailView) ───────────────────────────────────────────────────

// Mêmes préfixes que ACTION_LABELS (AuditTrailView.vue), dans le même ordre.
const AUDIT_TYPE_TIPS = [
  ['auth.', { title: 'Connexion', icon: 'key', text: 'Connexion ou déconnexion d’un utilisateur.' }],
  ['af.', { title: 'Analyse fonctionnelle ou audit', icon: 'file-lines', text: 'Action sur le document lui-même : modification, partage, copie, restauration, suppression…' }],
  ['section.', { title: 'Section d’un document', icon: 'file-lines', text: 'Ajout, modification, déplacement ou suppression d’une section.' }],
  ['section_template.', { title: 'Section type', icon: 'book', text: 'Modèle de section de la bibliothèque, repris dans les documents.' }],
  ['template.', { title: 'Équipement de la bibliothèque', icon: 'cube', text: 'Fiche d’équipement de la bibliothèque et sa liste de points.' }],
  ['attachment.', { title: 'Capture', icon: 'image', text: 'Capture d’écran ou fichier joint à un document : envoi, déplacement, suppression.' }],
  ['export.', { title: 'Export PDF', icon: 'file-pdf', text: 'Création d’un PDF : analyse fonctionnelle, synthèse, brochure ou offres.' }],
  ['inspection.', { title: 'Inspection BACS', icon: 'clipboard-check', text: 'Inspection périodique de la GTB par un organisme extérieur.', article: 'R175-5-1' }],
  ['claude.', { title: 'Claude (IA)', icon: 'wand-magic-sparkles', text: 'Appel à l’IA pour rédiger ou proposer du contenu.' }],
  ['zone.', { title: 'Zone', icon: 'location-dot', text: 'Zone d’un site : création, modification, copie, suppression.' }],
];

const AUDIT_OTHER_TIP = {
  title: 'Autre action',
  icon: 'circle-info',
  text: 'Action d’un autre type : FAQ, sites, audits, documents du site, consignes de l’IA…',
};

/** Pastille « Type » d'une ligne du journal (Auth, AF, Section type…). */
export function auditTypeTip(code) {
  const c = String(code || '');
  const hit = AUDIT_TYPE_TIPS.find(([prefix]) => c.startsWith(prefix));
  return hit ? hit[1] : AUDIT_OTHER_TIP;
}

/** En-tête « AF concernée ». */
export const AUDIT_DOCUMENT_COLUMN_TIP = {
  title: 'Document concerné',
  icon: 'file-lines',
  text: 'Analyse fonctionnelle (AF) ou audit sur lequel porte l’action, sous la forme client · projet.',
};

// ── Paramètres BACS : check-list documentaire, textes du décret ────────────────────────────

/** En-tête « Clé technique » du catalogue de la check-list. */
export const CHECKLIST_KEY_COLUMN_TIP = {
  title: 'Clé technique',
  icon: 'key',
  text: 'Identifiant fixé à la création, tiré du libellé. Les check-lists des audits s’en servent pour retrouver l’élément.',
};

/** En-tête « Actif » du catalogue de la check-list. */
export const CHECKLIST_ACTIVE_COLUMN_TIP = {
  title: 'Élément actif',
  icon: 'toggle-on',
  text: 'Un élément actif est ajouté à la check-list des nouveaux audits. Désactivé, il n’y est plus proposé ; les audits existants le gardent.',
};

/** Code d'un article du décret (« R175-3 ») : son sens en clair, l'article en pied. */
export function decreeArticleTip(code) {
  const plain = decreePlain(code);
  if (!plain) return null;
  return { title: plain.title, tone: 'info', icon: 'book', text: plain.text, article: code };
}

// Icônes citées par ce module (enregistrées par lib/tooltip-icons.js, cf. test).
export const FAQ_TIP_ICONS = [
  'magnifying-glass', 'circle-check', 'triangle-exclamation', 'circle-exclamation', 'arrows-rotate', 'download',
  'circle-minus', 'plus', 'wand-magic-sparkles', 'filter', 'clock-rotate-left', 'rotate-left', 'book', 'pen',
  'images', 'calculator', 'file-import', 'pen-nib', 'eye-slash', 'building', 'at', 'hashtag', 'key', 'file-lines',
  'cube', 'image', 'file-pdf', 'clipboard-check', 'location-dot', 'circle-info', 'toggle-on',
];
