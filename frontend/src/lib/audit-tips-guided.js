// Textes de la mise en page des étapes de l'audit autres que Systèmes (Systèmes :
// lib/audit-tips-systems-guide.js). Règles de rédaction : CLAUDE.md BD § « Infobulles » —
// tutoiement, en clair, sans article du décret dans le texte. Imports relatifs (testable sous Node).
import { plural } from './tooltip-content.js';

// ─── Bandeau de l'étape ─────────────────────────────────────────────────────────
export const STEP_NOTES_TITLE = 'Encore à renseigner';
export const STEP_NOTES_HINT = 'ne bloque pas la validation';
export const STEP_READY_WITH_NOTES = 'Rien ne bloque : tu peux valider l’étape.';

// ─── Rubriques repliables (étapes GTB, Identification…) ───────────────────────
export const STEP_RUBRICS_LABELS = { todo: 'Le reste à faire', all: 'Toute l’étape' };
export const STEP_RUBRICS_TIPS = {
  todo: {
    title: 'Le reste à faire d’abord',
    icon: 'filter',
    tone: 'info',
    text: 'Seules les rubriques où il manque une réponse s’ouvrent. Les autres montrent leur résumé.',
  },
  all: {
    title: 'Toute l’étape',
    icon: 'eye',
    tone: 'info',
    text: 'Toutes les rubriques restent dépliées.',
  },
};

/** Progression du guide de gauche : « 8 rubriques complètes sur 12 ». */
export function rubricsProgressLabel(done, total) {
  return `${done} rubrique${done > 1 ? 's' : ''} complète${done > 1 ? 's' : ''} sur ${total}`;
}

/** Bouton du guide : « Reprendre les 3 rubriques, une par une ». */
export function rubricsResumeLabel(n) {
  return n > 1 ? `Reprendre les ${n} rubriques, une par une` : 'Reprendre la rubrique restante';
}
export const RUBRICS_RESUME_TIP = {
  title: 'Rubrique suivante',
  icon: 'route',
  text: 'Ouvre la prochaine rubrique où il manque une réponse : d’abord les points à compléter, puis les questions sans réponse.',
};
export const RUBRICS_DONE_TEXT = 'Toutes les rubriques sont renseignées.';

// ─── Étape Zones ───────────────────────────────────────────────────────────────
export const ZONES_GROUPS = {
  functional: { label: 'Zones fonctionnelles', note: '' },
  technical: { label: 'Locaux techniques', note: 'hors décret, simple inventaire' },
};
// Étape Documents : groupes par rattachement (lib/documents-guide.js).
export const DOCS_GROUPS = {
  site: { label: 'Documents du site', note: 'plans, schémas, fiches techniques et manuels de l’ensemble du site' },
  checklist: { label: 'Pièces de la check-list', note: '' },
  gtb: { label: 'GTB', note: '' },
  elements: { label: 'Zones, systèmes, équipements et compteurs', note: 'les photos figurent déjà dans leur chapitre du rapport' },
  other: { label: 'Actions et inspection', note: '' },
};
export const DOCS_SITE_WIDE = 'Ensemble du site';
export function docsReportCount(n) {
  return n ? `${plural(n, 'joint', 'joints')} au rapport` : '';
}
export function docsSummaryLine(total, inReport) {
  return `${plural(total, 'document', 'documents')} · ${inReport ? plural(inReport, 'joint au rapport', 'joints au rapport') : 'aucun joint au rapport'}`;
}
export const DOCS_REPORT_TIP = {
  title: 'Documents joints au rapport',
  icon: 'paperclip',
  text: 'Coche « Inclure » pour joindre un document à l’annexe « Documents joints » du rapport PDF. Les photos rattachées à une zone, un système, un équipement, un compteur ou la GTB figurent déjà dans leur chapitre.',
};
// Étape Inspections : réponse « Non » alors que des inspections restent enregistrées.
export function inspectionsContradictionNote(n) {
  return n > 1
    ? `Tu as répondu Non, mais ${n} inspections sont enregistrées : supprime celles qui sont vides, ou réponds Oui.`
    : 'Tu as répondu Non, mais une inspection est enregistrée : supprime-la si elle est vide, ou réponds Oui.';
}
export function inspectionsUndatedNote(n) {
  return `${plural(n, 'inspection sans date', 'inspections sans date')} : indique la date ou supprime-la`;
}
// Étape Synthèse : Claude rédige à partir de l'audit tel qu'il est.
export function synthesisPendingStepsNote(labels) {
  if (!labels?.length) return '';
  return `${plural(labels.length, 'étape pas encore validée', 'étapes pas encore validées')} (${labels.join(', ')}) : la note reprend l’audit tel qu’il est`;
}
export const ZONES_DONE_TEXT = 'Chaque zone est renseignée.';
export const ZONES_GO_FIRST_TIP = 'Amène à l’écran la première zone à compléter.';
export const ZONE_TECH_NA_TIP = 'Sans objet pour un local technique';
/** Carte de la pastille d'une zone à compléter. */
export function zoneMissingTip(missing) {
  return { title: 'Zone à compléter', icon: 'list-check', tone: 'warning', text: `Manque : ${missing.join(', ')}.` };
}
/** Ligne « Reste à faire » du bandeau de l'étape. */
export function zonesNote(n) {
  return `${plural(n, 'zone à compléter', 'zones à compléter')} : nature, régime d’activité ou surface manquants`;
}

// ─── Étape Check-list ──────────────────────────────────────────────────────────
export const CHECKLIST_PHOTOS_TITLE = 'Photos du site';
export const CHECKLIST_PHOTOS_HINT = 'une photo de chaque zone, système, compteur et de la GTB';
export const CHECKLIST_ITEMS_TITLE = 'Pièces du dossier';
export const CHECKLIST_ITEM_STATUS = {
  pending: { label: 'À collecter', cls: 'bg-amber-100/70 text-amber-900' },
  available: { label: 'Collecté', cls: 'bg-emerald-50 text-emerald-700' },
  not_available: { label: 'Non disponible', cls: 'bg-slate-100 text-slate-600' },
};
/** « 0 collectée · 10 à collecter · 0 non disponible » (zéros omis sauf s'il n'y a rien). */
export function checklistItemsSummary({ available = 0, pending = 0, notAvailable = 0 } = {}) {
  const parts = [];
  if (available) parts.push(`${available} collectée${available > 1 ? 's' : ''}`);
  if (pending) parts.push(`${pending} à collecter`);
  if (notAvailable) parts.push(`${notAvailable} non disponible${notAvailable > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'aucune pièce';
}

// ─── Étape Plan d'actions ──────────────────────────────────────────────────────
export const PLAN_FILTERS = [
  { value: 'all', label: 'Toutes les actions', tone: 'navy',
    tip: { title: 'Toutes les actions', icon: 'list', text: 'Affiche toutes les actions du plan.' } },
  { value: 'nopreco', label: 'Sans préconisation', tone: 'amber',
    tip: { title: 'Sans préconisation', icon: 'filter', text: 'Seules les actions retenues qui n’ont pas encore de préconisation rédigée.' } },
];
/** Ligne du bandeau de l'étape. */
export function planNoPrecoNote(n) {
  return `${plural(n, 'action', 'actions')} sans préconisation`;
}

// ─── Étape Identification ──────────────────────────────────────────────────────
export const IDENT_VERDICT_QUESTION = 'Le bâtiment est-il concerné par le décret ?';
export const IDENT_VERDICT_PENDING = 'Verdict en attente : renseigne la puissance et la date du permis de construire.';
export const IDENT_RETAINED_POWER = 'Puissance retenue';
export const IDENT_PERMIT = 'Permis de construire';

export const IDENT_OWNERSHIP_REASON = 'la structure de propriété du site n’est pas indiquée (parties prenantes)';

// ─── Étape GTB ─────────────────────────────────────────────────────────────────
export const BMS_GUIDE_TITLE = 'Rubriques de la GTB';
/**
 * Lignes « Reste à faire » : les questions sans réponse, par rubrique (trois rubriques au plus,
 * au-delà une seule ligne qui les nomme).
 */
export function bmsUnansweredReasons(rubrics) {
  const list = (rubrics || []).filter(r => r.unanswered?.length);
  if (!list.length) return [];
  if (list.length <= 3) return list.map(r => `« ${r.title} » : ${r.unanswered.join(', ')}`);
  const n = list.reduce((sum, r) => sum + r.unanswered.length, 0);
  return [`${plural(n, 'question sans réponse', 'questions sans réponse')} dans ${list.length} rubriques : ${list.map(r => r.title).join(', ')}`];
}
export const BMS_OUT_OF_SERVICE_NOTE = 'GTB hors service : le plan d’actions ignore ce qu’elle sait faire.';

// ─── Étape Compteurs ───────────────────────────────────────────────────────────
/** « 11 compteurs attendus sans réponse à « Présent ? » : réponds Oui ou Non pour chacun. » */
export function metersTodoLine(n) {
  return `${plural(n, 'compteur attendu', 'compteurs attendus')} sans réponse à « Présent ? » : réponds Oui ou Non${n > 1 ? ' pour chacun' : ''}.`;
}
/** Ligne du bandeau de l'étape : « 11 compteurs attendus sans réponse à « Présent ? » ». */
export function metersTodoNote(n) {
  return `${plural(n, 'compteur attendu', 'compteurs attendus')} sans réponse à « Présent ? »`;
}
/** « 2 compteurs requis absents : ils figurent au plan d’actions. » */
export function metersMissingLine(n) {
  return n > 1
    ? `${n} compteurs requis absents : ils figurent au plan d’actions.`
    : '1 compteur requis absent : il figure au plan d’actions.';
}
export const METERS_DONE_TEXT = 'Chaque compteur attendu a sa réponse.';
export const METERS_FILTER_EMPTY = 'Aucun compteur de cette énergie avec ce filtre.';
export const METERS_GO_FIRST_LABEL = 'Aller au premier';
export const METERS_GO_FIRST_TIP = 'Ouvre l’énergie du premier compteur sans réponse et l’amène à l’écran.';
export const METER_FILTERS = [
  { value: 'all', label: 'Tous les compteurs', tone: 'navy',
    tip: { title: 'Tous les compteurs', icon: 'list', text: 'Affiche tous les compteurs de l’énergie.' } },
  { value: 'todo', label: 'À compléter', tone: 'amber',
    tip: { title: 'À compléter', icon: 'filter', text: 'Seuls les compteurs dont la présence n’a pas encore de réponse.' } },
  { value: 'missing', label: 'Requis manquants', tone: 'red',
    tip: { title: 'Requis manquants', icon: 'filter', text: 'Seuls les compteurs requis notés absents : ils entrent au plan d’actions.' } },
];
// ─── Étape Régulation ──────────────────────────────────────────────────────────
/**
 * Encadré « à compléter » : systèmes sans émetteur (`todo`) et systèmes dont l'équipement de
 * production ou le type de régulation manque (`open`).
 */
export function thermalTodoLine(todo, open = 0) {
  if (todo && open) {
    return `${plural(todo, 'système', 'systèmes')} sans émetteur et ${open} à préciser (équipement de production ou type de régulation).`;
  }
  if (open) return `${plural(open, 'système', 'systèmes')} à préciser : équipement de production ou type de régulation.`;
  return todo > 1
    ? `${todo} systèmes sans émetteur : indique le radiateur, le ventilo-convecteur… de chacun.`
    : '1 système sans émetteur : indique son radiateur, son ventilo-convecteur…';
}
/** « 2 chauffages régulés de façon centralisée : non conformes, ils figurent au plan d’actions. » */
export function thermalKoLine(n) {
  return n > 1
    ? `${n} chauffages sans régulation par pièce ou par zone : ils figurent au plan d’actions.`
    : '1 chauffage sans régulation par pièce ou par zone : il figure au plan d’actions.';
}
/** Ligne « Reste à faire » : systèmes dont la régulation reste à préciser. */
export function thermalOpenNote(n) {
  return `${plural(n, 'système', 'systèmes')} à préciser : équipement de production ou type de régulation`;
}
export const THERMAL_DONE_TEXT = 'Chaque système est renseigné.';
export const THERMAL_GO_FIRST_TIP = 'Amène à l’écran le premier système à compléter.';
export const THERMAL_FILTERS = [
  { value: 'all', label: 'Tous les systèmes', tone: 'navy',
    tip: { title: 'Tous les systèmes', icon: 'list', text: 'Affiche tous les systèmes de chauffage et de froid.' } },
  { value: 'todo', label: 'À compléter', tone: 'amber',
    tip: { title: 'À compléter', icon: 'filter', text: 'Seuls les systèmes à compléter : émetteur, équipement de production ou type de régulation.' } },
  { value: 'ko', label: 'Non conformes', tone: 'red',
    tip: { title: 'Non conformes', icon: 'filter', text: 'Seuls les chauffages sans régulation par pièce ou par zone.' } },
];
/** Infobulle d'un filtre de l'étape Régulation sans système concerné. */
export function thermalFilterEmptyTip(value) {
  return value === 'todo' ? 'Chaque système est renseigné' : 'Aucun chauffage non conforme';
}

/** Infobulle d'un filtre sans compteur concerné. */
export function meterFilterEmptyTip(value) {
  return value === 'todo' ? 'Chaque compteur a sa réponse' : 'Aucun compteur requis ne manque';
}
