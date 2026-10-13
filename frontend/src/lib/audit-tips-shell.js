// Infobulles du cadre de l'audit (2026-10-12) : en-tête et barre d'outils de la fiche d'audit,
// pied d'étape et badge de validation, plan d'actions (vue commerciale), historique, boutons
// Photos et Notes vocales, partage, coût de Claude. Français simple, tutoiement, article du
// décret en pied discret. Fonctions PURES, imports relatifs uniquement (testées par
// backend-node/test/audit-tips-shell.test.mjs). Règles : CLAUDE.md § « Infobulles (UI) ».

import { plural } from './tooltip-content.js';
import { stepNotValidableTip } from './audit-tips.js';
import { decreePlain } from './decree-plain.js';

// ── Dates ──────────────────────────────────────────────────────────────────────────────────

/**
 * Date de la base (« 2026-10-12 08:15:00 » : CURRENT_TIMESTAMP de SQLite, en UTC sans fuseau)
 * ou ISO (« 2026-10-12T08:15:00.000Z ») → Date ; null si illisible.
 */
export function parseDbDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  const noZone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const d = new Date(noZone ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 12 oct. 2026 à 10:15 » (heure locale) ; '' si la date est illisible. */
export function formatDateTime(value) {
  const d = parseDbDate(value);
  if (!d) return '';
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}

// ── En-tête de l'audit ─────────────────────────────────────────────────────────────────────

/** « il y a 5 min » (dernière modification de l'audit) : date complète. */
export function modifiedTip(updatedAt) {
  const when = formatDateTime(updatedAt);
  return when ? { label: `Modifié le ${when}`, icon: 'clock' } : null;
}

/** Icône du type d'audit, devant le titre. */
export const AUDIT_KIND_TIPS = {
  bacs: {
    title: 'Audit BACS',
    icon: 'fire',
    tone: 'warning',
    text: 'Vérifie le bâtiment au regard du décret BACS et aboutit à un plan de mise en conformité.',
    placement: 'bottom',
  },
  site: {
    title: 'Audit GTB classique',
    icon: 'building',
    tone: 'success',
    text: 'Les exigences du décret BACS sont désactivées : l’audit se concentre sur l’inventaire technique utile au chiffrage.',
    placement: 'bottom',
  },
};

/** Titre de l'audit (champ modifiable de l'en-tête) : étiquette d'action, ou titre complet en carte
 *  quand l'écran est trop étroit pour l'afficher en entier. */
export function auditTitleTip(name, truncated = false) {
  const full = String(name || '').trim();
  if (!truncated || !full) return 'Renommer cet audit';
  return { title: 'Titre de l’audit', icon: 'pen', rows: [{ label: 'En entier', value: full }], text: 'Tu peux le modifier directement dans l’en-tête.', placement: 'bottom' };
}

/** « ✓ Livré le … » : ce que la livraison a figé. */
export function deliveredTip(deliveredAt) {
  const when = formatDateTime(deliveredAt);
  return {
    title: when ? `Audit livré le ${when}` : 'Audit livré',
    tone: 'success',
    icon: 'truck',
    text: 'La livraison a créé le rapport PDF définitif et figé une version de l’audit, avec une empreinte qui prouve que le PDF n’a pas été modifié.',
    todo: 'Modifie l’audit si besoin, puis livre-le de nouveau : une nouvelle version sera créée.',
    placement: 'bottom',
  };
}

// ── Niveaux du plan d'actions ──────────────────────────────────────────────────────────────

const SEVERITY_WORDS = {
  blocking: ['bloquante', 'bloquantes'],
  major: ['majeure', 'majeures'],
  minor: ['mineure', 'mineures'],
};

/** Niveaux d'une action : même définition que la légende « Lecture du plan » du PDF. */
export const SEVERITY_TIPS = {
  blocking: {
    title: 'Action bloquante',
    tone: 'error',
    icon: 'circle-exclamation',
    text: 'Écart qui empêche à lui seul la conformité, par exemple l’absence de GTB ou d’un compteur requis.',
  },
  major: {
    title: 'Action majeure',
    tone: 'warning',
    icon: 'triangle-exclamation',
    text: 'Exigence du décret non satisfaite, à traiter pour atteindre la conformité.',
  },
  minor: {
    title: 'Action mineure',
    tone: 'info',
    icon: 'circle-info',
    text: 'Recommandation, ou raccordement à la GTB exigé seulement s’il se rembourse en moins de 10 ans.',
  },
};

/** Pastille de l'en-tête (« 3 bloquantes ») : actions encore ouvertes de ce niveau. */
export function openActionsTip(severity, n) {
  const base = SEVERITY_TIPS[severity];
  const words = SEVERITY_WORDS[severity];
  if (!base) return null;
  return {
    ...base,
    title: n ? plural(n, `action ${words[0]} ouverte`, `actions ${words[1]} ouvertes`) : `Aucune action ${words[0]} ouverte`,
    todo: n ? `Traite-${n > 1 ? 'les' : 'la'} dans l’étape « Plan d’actions ».` : null,
    placement: 'bottom',
  };
}

// ── Indicateur d'enregistrement ────────────────────────────────────────────────────────────

/**
 * Indicateur « Sauvegarde… / Erreur de sauvegarde / Enregistré » de la barre d'outils.
 * @param {'saving'|'error'|'saved'|'idle'} state
 * @param {{ inflight?: number, errorDetail?: string|null, lastSavedAt?: Date|null }} [info]
 */
export function saveStatusTip(state, { inflight = 0, errorDetail = null, lastSavedAt = null } = {}) {
  if (state === 'saving') {
    return {
      title: 'Enregistrement en cours',
      tone: 'info',
      icon: 'floppy-disk',
      text: inflight > 1 ? `${inflight} modifications partent vers le serveur.` : 'Ta modification part vers le serveur.',
      todo: 'Attends la fin avant de fermer la page.',
      placement: 'bottom',
    };
  }
  if (state === 'error') {
    return {
      title: 'Échec de l’enregistrement',
      tone: 'error',
      text: errorDetail || 'La dernière modification n’a pas été enregistrée.',
      todo: ['Vérifie ta connexion, puis refais la modification.', 'Masque ce message d’un clic.'],
      placement: 'bottom',
    };
  }
  if (state === 'saved') {
    const d = parseDbDate(lastSavedAt);
    return {
      title: 'Tout est enregistré',
      tone: 'success',
      icon: 'circle-check',
      rows: d ? [{ icon: 'clock', label: 'Dernier enregistrement', value: `à ${d.toLocaleTimeString('fr-FR')}` }] : [],
      placement: 'bottom',
    };
  }
  return null;
}

// ── Barre d'outils de l'audit ──────────────────────────────────────────────────────────────

export const PREVIEW_TIP = {
  title: 'Aperçu du rapport',
  icon: 'eye',
  tone: 'info',
  text: 'Affiche le rapport à l’écran en quelques secondes, sans créer le PDF : pratique pour relire.',
  placement: 'bottom',
};

const busyTip = (title, text, placement = 'bottom') => ({ title, tone: 'neutral', icon: 'hourglass-half', text, placement });

/** Bouton « Rapport » (grisé pendant la création du PDF). */
export function reportTip(busy) {
  if (busy) return busyTip('Rapport en cours de création', 'Le PDF se télécharge dès qu’il est prêt.');
  return {
    title: 'Rapport d’audit (PDF)',
    icon: 'file-pdf',
    tone: 'info',
    text: 'Crée et télécharge le rapport complet, au format A4.',
    placement: 'bottom',
  };
}

/** Bouton « Synthèse » : tableaux A3 pour l'intégrateur. */
export function tablesTip(busy) {
  if (busy) return busyTip('Tableaux en cours de création', 'Le PDF se télécharge dès qu’il est prêt.');
  return {
    title: 'Tableaux de synthèse (PDF)',
    icon: 'table-list',
    tone: 'info',
    text: 'Crée les grands tableaux au format A3 paysage, destinés à l’intégrateur pour chiffrer les travaux.',
    placement: 'bottom',
  };
}

export const PRECHECK_TIP = {
  title: 'Vérifier avant de livrer',
  icon: 'list-check',
  tone: 'info',
  text: 'Repère les incohérences de l’audit et montre où les corriger. Tant qu’il reste un point bloquant, la livraison est refusée.',
  placement: 'bottom',
};

/** Bouton « Livrer » : ce que fait la livraison (et la date de la précédente). */
export function deliverTip(busy, deliveredAt = null) {
  if (busy) {
    return busyTip('Livraison en cours', 'Vérification, création du rapport définitif puis enregistrement de la version figée : patiente quelques instants.');
  }
  const when = formatDateTime(deliveredAt);
  return {
    title: 'Livrer l’audit',
    icon: 'truck',
    tone: 'success',
    text: 'Vérifie l’audit, crée le rapport PDF définitif et enregistre une version figée, avec une empreinte qui prouve que le PDF n’a pas été modifié.',
    rows: when
      ? [
          { icon: 'clock', label: 'Déjà livré le', value: when },
          { icon: 'clock-rotate-left', label: 'Nouvelle livraison', value: 'nouvelle version, historique conservé' },
        ]
      : [],
    placement: 'bottom',
  };
}

export const BULK_PHOTOS_TIP = {
  title: 'Importer des photos en masse',
  icon: 'images',
  tone: 'info',
  text: 'Envoie d’un coup toutes les photos de la visite, classées par date de prise de vue, puis rattache chacune à une zone, un système ou un compteur.',
  placement: 'left',
};

export const TRANSCRIPT_TIP = {
  title: 'Transcription Plaud Pro',
  icon: 'wand-magic-sparkles',
  tone: 'info',
  text: 'Importe la transcription d’une dictée faite pendant la visite : Claude propose de pré-remplir l’audit, tu valides chaque proposition.',
  placement: 'left',
};

/** Menu « Plus » → « Dossier complet (ZIP) ». */
export function dossierTip(busy) {
  if (busy) return busyTip('Préparation du dossier', 'Le fichier ZIP se télécharge dès qu’il est prêt.', 'left');
  return {
    title: 'Dossier complet (ZIP)',
    icon: 'file-zipper',
    tone: 'info',
    text: 'Un seul fichier ZIP avec le rapport PDF, les tableaux de synthèse et les documents du site cochés « Inclure dans le rapport ».',
    placement: 'left',
  };
}

// ── Étapes : pied, badge de validation, ancien stepper ─────────────────────────────────────

/** « Passer à … » du pied d'étape : avancer sans valider. */
export function skipStepTip(next) {
  if (!next) return null;
  return {
    title: 'Passer sans valider',
    tone: 'neutral',
    icon: 'arrow-right',
    text: `Ouvre « ${next.label} » sans valider cette étape. Tu pourras la valider plus tard.`,
  };
}

/** « Valider et continuer » / « Valider l'étape » du pied d'étape. */
export function validateAndContinueTip(step, next) {
  const blocked = stepNotValidableTip(step);
  if (blocked) return { ...blocked, placement: 'top' };
  const pending = step && !step.complete;
  return {
    title: next ? 'Valider et continuer' : 'Valider l’étape',
    tone: 'success',
    icon: 'check',
    text: next ? `Valide cette étape, puis ouvre « ${next.label} ».` : 'Valide cette dernière étape de l’audit.',
    rows: pending ? [{ icon: 'triangle-exclamation', tone: 'warning', label: 'Éléments en attente', value: 'confirmation demandée' }] : [],
  };
}

/** Badge « Valider » / « Étape validée » d'un en-tête de section (hors mode étape). */
export function validateBadgeTip(step) {
  if (!step) return null;
  if (step.validated) {
    const when = formatDateTime(step.validated_at);
    const rows = [];
    if (when) rows.push({ icon: 'clock', label: 'Validée le', value: when });
    if (step.validated_by_name) rows.push({ icon: 'user', label: 'Par', value: step.validated_by_name });
    return {
      title: 'Étape validée',
      tone: 'success',
      icon: 'circle-check',
      text: 'Un clic annule la validation, pour pouvoir modifier l’étape. Une raison facultative te sera demandée.',
      rows,
    };
  }
  if (step.complete) return 'Valider cette étape';
  return (
    stepNotValidableTip(step) || {
      title: 'Valider cette étape',
      tone: 'info',
      icon: 'check',
      text: 'Des éléments restent en attente : tu peux la valider quand même et compléter plus tard.',
    }
  );
}

/** Pastille d'un stepper d'étapes (ancienne navigation verticale ou horizontale). */
export function stepperStepTip(step, index, placement = 'top') {
  if (!step) return null;
  const state = step.validated ? 'validée' : step.complete ? 'prête à valider' : 'à compléter';
  return {
    title: `${index + 1}. ${step.label}`,
    tone: step.validated ? 'success' : step.complete ? 'warning' : 'neutral',
    icon: step.validated ? 'circle-check' : 'list-ol',
    text: step.description || '',
    rows: [{ label: 'État', value: state }],
    placement,
  };
}

// ── Plan d'actions (vue commerciale) ───────────────────────────────────────────────────────

/** En-têtes de colonnes du tableau du plan d'actions. */
export const ACTION_COLUMN_TIPS = {
  number: {
    title: 'Numéro de l’action',
    text: 'Le même que dans le rapport PDF et l’export CSV. Les actions terminées, non retenues ou d’information n’en ont pas.',
  },
  severity: {
    title: 'Sévérité',
    text: 'Gravité de l’écart pour la conformité.',
    rows: [
      { icon: 'circle-exclamation', tone: 'error', label: 'Bloquante', value: 'empêche à elle seule la conformité' },
      { icon: 'triangle-exclamation', tone: 'warning', label: 'Majeure', value: 'exigence non satisfaite' },
      { icon: 'circle-info', tone: 'info', label: 'Mineure', value: 'recommandation' },
    ],
  },
  article: {
    title: 'Article du décret',
    text: 'Exigence du décret BACS à laquelle répond l’action. Survole un article pour le lire en clair.',
  },
  effort: {
    title: 'Effort estimé',
    text: 'Ton estimation de l’ampleur des travaux : faible, moyen ou élevé. Elle figure dans le rapport PDF et l’export CSV.',
  },
  status: {
    title: 'Statut',
    text: 'Suivi de l’action. Une action « Terminée » ou « Non retenue » sort du plan du rapport.',
  },
};

/** Tuile de décompte par niveau (toutes les actions, quel que soit leur statut). */
export function severityCountTip(severity) {
  const base = SEVERITY_TIPS[severity];
  if (!base) return null;
  return {
    ...base,
    title: `Actions ${SEVERITY_WORDS[severity][1]}`,
    rows: [{ icon: 'calculator', label: 'Total', value: 'tous statuts confondus' }],
    placement: 'bottom',
  };
}

/** Tuile « Ouvertes » : le statut « Ouverte » seul (les pastilles de l'audit comptent aussi
 *  les actions chiffrées et en cours). */
export const OPEN_COUNT_TIP = {
  title: 'Actions au statut « Ouverte »',
  tone: 'info',
  icon: 'circle-info',
  text: 'Actions ni chiffrées, ni commencées, ni terminées.',
  placement: 'bottom',
};

export const DONE_COUNT_TIP = {
  title: 'Actions terminées',
  tone: 'success',
  icon: 'circle-check',
  text: 'Travaux réalisés, ou écart disparu lors d’une régénération du plan.',
  placement: 'bottom',
};

export const MANUAL_ACTION_TIP = {
  title: 'Action ajoutée à la main',
  tone: 'neutral',
  icon: 'pen',
  text: 'Elle ne vient pas du calcul automatique : la régénération du plan ne la touche pas, et tu peux la supprimer.',
};

/** Code d'article (« R175-3 1° ») : l'exigence en clair, l'article en pied. */
export function decreeArticleTip(article) {
  if (!article) return null;
  const plain = decreePlain(article);
  return {
    title: plain ? plain.title : 'Article du décret BACS',
    tone: 'info',
    icon: 'book',
    text: plain ? plain.text : 'Exigence du décret à laquelle répond cette action.',
    article,
  };
}

export const REGENERATE_PLAN_TIP = {
  title: 'Régénérer le plan',
  icon: 'wand-magic-sparkles',
  tone: 'info',
  text: 'Recalcule les actions à partir des données de l’audit.',
  rows: [
    { icon: 'plus', label: 'Nouvel écart', value: 'action ajoutée' },
    { icon: 'circle-check', tone: 'success', label: 'Écart corrigé', value: 'action passée en « Terminée »' },
    { icon: 'lock', label: 'Conservés', value: 'actions ajoutées à la main, efforts, statuts « Chiffrée », « En cours » et « Non retenue »' },
  ],
  placement: 'bottom',
};

export const EXPORT_CSV_TIP = {
  title: 'Exporter le plan en CSV',
  icon: 'file-export',
  tone: 'info',
  text: 'Un fichier à ouvrir dans Excel : toutes les actions, sans tenir compte des filtres, numérotées comme dans le rapport PDF.',
  placement: 'bottom',
};

// ── Historique de l'audit (journal) ────────────────────────────────────────────────────────

/** Explication des événements dont le libellé ne suffit pas (les autres : pas de bulle). */
export const AUDIT_TRAIL_TIPS = {
  'document.delivered': {
    title: 'Audit livré',
    tone: 'success',
    icon: 'truck',
    text: 'Le rapport PDF définitif a été créé et une version figée de l’audit a été enregistrée.',
  },
  'bacs_audit.deliver.forced': {
    title: 'Livraison forcée',
    tone: 'warning',
    text: 'L’audit a été livré malgré des incohérences bloquantes, ou alors que la vérification automatique était en panne. Les détails indiquent ce qui bloquait.',
  },
  'bacs_audit.step.invalidate': {
    title: 'Validation annulée',
    tone: 'warning',
    icon: 'rotate-left',
    text: 'Une étape validée a été rouverte pour être modifiée. La raison donnée, s’il y en a une, figure dans les détails.',
  },
  'credential.revealed': {
    title: 'Mot de passe affiché',
    tone: 'warning',
    icon: 'key',
    text: 'Un mot de passe d’accès du site a été affiché en clair. C’est noté ici pour en garder la trace.',
  },
  'bacs.precheck.auto_fix': {
    title: 'Correction automatique',
    tone: 'info',
    icon: 'wand-magic-sparkles',
    text: 'Une incohérence signalée par la vérification avant livraison a été corrigée en un clic.',
  },
  'bacs.suggestion.apply': {
    title: 'Suggestion appliquée',
    tone: 'info',
    icon: 'wand-magic-sparkles',
    text: 'Une valeur proposée par Claude à partir d’une dictée Plaud Pro a été écrite dans l’audit.',
  },
};

/** Carte d'explication d'un événement du journal, ou null. */
export function auditTrailTip(action) {
  return AUDIT_TRAIL_TIPS[action] || null;
}

/** Date complète d'une ligne d'activité (affichée « il y a 5 min »). */
export function activityDateTip(value) {
  const when = formatDateTime(value);
  return when ? { label: `Le ${when}`, icon: 'clock' } : null;
}

// ── Photos et notes vocales ────────────────────────────────────────────────────────────────

export const PHOTOS_OFFLINE_TIP = {
  title: 'Photos indisponibles hors ligne',
  tone: 'warning',
  icon: 'wifi',
  text: 'L’envoi et l’affichage des photos demandent une connexion.',
  todo: 'Reconnecte-toi pour ajouter ou consulter les photos.',
};

/** Bouton appareil photo : galerie de l'élément, glisser-déposer. */
export function photoButtonTip(label, count) {
  return {
    title: label ? `Photos · ${label}` : 'Photos',
    tone: count ? 'success' : 'info',
    icon: 'camera',
    text: 'Ouvre la galerie. Tu peux aussi glisser-déposer des images sur ce bouton pour les ajouter.',
    rows: [{ icon: 'images', label: 'Photos enregistrées', value: count ? String(count) : 'aucune' }],
  };
}

// « 48,85660° N » (même écriture que les documents du site, lib/audit-tips-site.js).
const coord = (v, pos, neg) => `${Math.abs(Number(v)).toFixed(5).replace('.', ',')}° ${Number(v) >= 0 ? pos : neg}`;

/** Vignette de la galerie : date, appareil et position de la prise de vue (ou null). */
export function photoInfoTip(photo) {
  if (!photo) return null;
  const rows = [];
  const when = formatDateTime(photo.taken_at);
  if (when) rows.push({ icon: 'clock', label: 'Prise le', value: when });
  const camera = [photo.camera_make, photo.camera_model].filter(Boolean).join(' ');
  if (camera) rows.push({ icon: 'camera', label: 'Appareil', value: camera });
  if (photo.gps_latitude != null && photo.gps_longitude != null) {
    rows.push({ icon: 'location-dot', label: 'Position', value: `${coord(photo.gps_latitude, 'N', 'S')}, ${coord(photo.gps_longitude, 'E', 'O')}` });
  }
  if (!rows.length) return null;
  return { title: photo.title || photo.original_name || 'Photo', tone: 'info', icon: 'image', rows };
}

/** Date affichée sous une photo importée en masse : prise de vue, sinon envoi. */
export function photoDateText(photo) {
  if (!photo) return '';
  const taken = formatDateTime(photo.taken_at);
  if (taken) return `Prise le ${taken}`;
  const sent = formatDateTime(photo.uploaded_at);
  return sent ? `Envoyée le ${sent}` : '';
}

export const VOICE_OFFLINE_TIP = {
  title: 'Notes vocales indisponibles hors ligne',
  tone: 'warning',
  icon: 'wifi',
  text: 'L’enregistrement et l’écoute des notes vocales demandent une connexion.',
  todo: 'Reconnecte-toi pour enregistrer ou écouter une note.',
};

/** Bouton micro : notes vocales de l'élément. */
export function voiceButtonTip(label, count) {
  return {
    title: label ? `Notes vocales · ${label}` : 'Notes vocales',
    tone: count ? 'success' : 'info',
    icon: 'microphone',
    text: 'Enregistre une observation à la voix, puis fais-la transcrire par écrit si besoin.',
    rows: [{ icon: 'microphone', label: 'Notes enregistrées', value: count ? String(count) : 'aucune' }],
  };
}

// ── Assistant de transcription (Plaud Pro) ─────────────────────────────────────────────────

/** Type d'élément visé par une suggestion de Claude. */
export const SUGGESTION_TARGET_LABELS = {
  zone: 'Zone',
  system: 'Système',
  device: 'Équipement',
  meter: 'Compteur',
  thermal: 'Régulation',
  unknown: 'Élément à préciser',
};

/** Champ visé par une suggestion (les autres restent affichés tels quels). */
export const SUGGESTION_FIELD_LABELS = {
  notes: 'Notes',
  brand: 'Marque',
  model_reference: 'Référence',
  power_kw: 'Puissance (kW)',
  name: 'Nom',
  communication: 'Communication',
};

/** Confiance d'une suggestion (0 à 1). Sous 60 %, Claude hésite sur l'élément visé. */
export function confidenceTip(confidence) {
  if (confidence == null) return null;
  const low = confidence < 0.6;
  return {
    title: `Confiance de Claude : ${Math.round(confidence * 100)} %`,
    tone: low ? 'warning' : 'info',
    icon: 'wand-magic-sparkles',
    text: 'Probabilité, selon Claude, que la suggestion soit juste. Sous 60 %, il n’est pas sûr de l’élément concerné.',
    todo: low ? 'Relis la citation avant d’appliquer.' : null,
  };
}

// ── Partage ────────────────────────────────────────────────────────────────────────────────

export const SHARE_OWNER_TIP = {
  title: 'Propriétaire',
  tone: 'success',
  icon: 'user',
  text: 'La personne qui a créé le document. Son accès ne peut pas être retiré et elle seule gère les partages.',
};

// ── Coût de Claude ─────────────────────────────────────────────────────────────────────────

const euros = (v, digits) => `${Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;

/** Coût des demandes à Claude (GET /api/claude/usage) : faits « clé → valeur », virgule décimale. */
export function claudeUsageTip(usage) {
  if (!usage) return { title: 'Coût de Claude', tone: 'neutral', icon: 'coins', text: 'Chargement du coût des demandes…' };
  const rows = [
    { icon: 'calculator', label: 'Coût moyen d’une demande', value: `≈ ${euros(usage.avg_cost_eur, 3)}` },
    { icon: 'clock-rotate-left', label: '30 derniers jours', value: `${euros(usage.cost_eur, 2)} · ${plural(usage.requests || 0, 'demande', 'demandes')}` },
  ];
  if (usage.month_cost_eur != null) rows.push({ icon: 'calendar', label: 'Mois en cours', value: euros(usage.month_cost_eur, 2) });
  if (usage.monthly_budget_eur && usage.remaining_eur != null) {
    rows.push({ icon: 'wallet', label: 'Budget du mois', value: `${euros(usage.remaining_eur, 2)} restants sur ${euros(usage.monthly_budget_eur, 2)}` });
  }
  return {
    title: 'Coût de Claude',
    tone: 'info',
    icon: 'coins',
    text: 'Le coût d’une demande dépend de la longueur des textes lus et rédigés par Claude.',
    rows,
  };
}

// Icônes citées par ce module (enregistrées par lib/tooltip-icons.js après régénération).
export const AUDIT_SHELL_TIP_ICONS = [
  'clock', 'fire', 'building', 'truck', 'circle-exclamation', 'triangle-exclamation', 'circle-info', 'floppy-disk',
  'circle-check', 'eye', 'hourglass-half', 'file-pdf', 'table-list', 'list-check', 'clock-rotate-left', 'images',
  'wand-magic-sparkles', 'file-zipper', 'arrow-right', 'check', 'user', 'list-ol', 'calculator', 'pen', 'book',
  'plus', 'lock', 'file-export', 'rotate-left', 'key', 'wifi', 'camera', 'location-dot', 'image', 'microphone',
  'coins', 'calendar', 'wallet',
];
