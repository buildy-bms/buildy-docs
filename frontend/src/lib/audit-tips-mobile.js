// Infobulles propres à l'audit sur mobile (PWA iPhone / iPad, 2026-10-12) : barre du haut
// (hors ligne, envoi des modifications en attente), pastilles et noms complets des onglets du
// bas, et les rares cartes dont le geste diffère au doigt (« touche » plutôt que « clique »).
// Tous les autres contenus sont partagés avec le bureau (audit-tips.js, audit-tips-site.js,
// audit-tips-systems.js, audit-tips-shell.js). Français simple, tutoiement, article du décret
// en pied discret. Fonctions PURES, imports relatifs uniquement (testées par
// backend-node/test/audit-tips-mobile.test.mjs). Règles : CLAUDE.md § « Infobulles (UI) ».

import { plural } from './tooltip-content.js';
import { metersMissingTip } from './audit-tips.js';
import { SEVERITY_TIPS } from './audit-tips-shell.js';
import { POWER_SOURCE_TIPS, THERMAL_COLUMN_TIPS } from './audit-tips-site.js';

// ── Barre du haut : connexion et envoi des modifications ──────────────────────────────────
// File d'attente hors ligne : lib/offline-queue.js (modifications gardées sur l'appareil puis
// rejouées une par une au retour du réseau ; photos et fichiers jamais mis en attente).

/** Pastille rouge « hors ligne » (signal barré) de la barre du haut. */
export function offlineTip(pending = 0) {
  const n = Number(pending) || 0;
  return {
    title: 'Hors ligne',
    tone: 'warning',
    icon: 'wifi',
    text: 'Tes modifications restent sur l’appareil et partiront dès le retour du réseau.',
    rows: [
      { icon: 'clock', label: 'En attente d’envoi', value: n ? plural(n, 'modification', 'modifications') : 'aucune modification' },
      { icon: 'camera', label: 'Photos et fichiers', value: 'à ajouter une fois reconnecté' },
    ],
    placement: 'bottom',
  };
}

/** Pastille orange « ⇪ N » : modifications faites hors ligne, en train de partir. */
export function pendingSyncTip(pending = 0) {
  const n = Number(pending) || 0;
  return {
    title: 'Synchronisation en cours',
    tone: 'info',
    icon: 'arrows-rotate',
    text: n > 1
      ? `${n} modifications faites hors ligne partent vers le serveur, une par une.`
      : 'La modification faite hors ligne part vers le serveur.',
    placement: 'bottom',
  };
}

// ── Barre d'onglets du bas ────────────────────────────────────────────────────────────────

/** Nom complet des onglets au libellé abrégé (étiquette au survol, iPad et souris). */
export const TAB_FULL_LABELS = {
  meters: 'Compteurs',
  docs: 'Documents et photos du dossier',
  plan: 'Plan d’actions',
};

/**
 * Pastille d'un onglet (rouge : action requise, orange : à compléter), calculée par
 * MobileAuditDetailView (tabDot). Null = pas de pastille.
 * @param {'zones'|'systems'|'meters'|'bms'|'plan'|string} tab
 * @param {{ tone: 'red'|'amber', count?: number } | null} dot
 */
export function tabBadgeTip(tab, dot) {
  if (!dot) return null;
  const n = Number(dot.count) || 0;
  if (tab === 'zones') {
    return {
      title: 'Aucune zone',
      tone: 'error',
      icon: 'location-dot',
      text: 'Les systèmes et les compteurs se décrivent zone par zone.',
      todo: 'Ajoute au moins une zone.',
    };
  }
  if (tab === 'systems') {
    return {
      title: plural(n, 'usage sans réponse', 'usages sans réponse'),
      tone: 'warning',
      icon: 'circle-question',
      text: 'Pour ces usages, ni « Présent » ni « Absent » n’a encore été choisi.',
      todo: 'Ouvre chaque zone et réponds pour chacun de ses usages.',
    };
  }
  if (tab === 'meters') return metersMissingTip(n);
  if (tab === 'bms') {
    return {
      title: 'GTB à décrire',
      tone: 'warning',
      icon: 'display',
      text: 'Indique s’il y a une GTB sur le site ; s’il y en a une, renseigne la solution en place.',
    };
  }
  if (tab === 'plan') {
    const blocking = dot.tone === 'red';
    return {
      ...SEVERITY_TIPS[blocking ? 'blocking' : 'major'],
      title: blocking
        ? plural(n, 'action bloquante ouverte', 'actions bloquantes ouvertes')
        : plural(n, 'action majeure ouverte', 'actions majeures ouvertes'),
    };
  }
  return null;
}

// ── Onglet Site ───────────────────────────────────────────────────────────────────────────

/** « Valeur saisie à la main » sous la puissance : au doigt, le recalcul est le bouton ⟳. */
export const POWER_MANUAL_MOBILE_TIP = {
  ...POWER_SOURCE_TIPS.manual_override,
  todo: 'Touche ⟳ à côté du champ pour revenir au calcul automatique.',
};

// ── Onglet Systèmes ───────────────────────────────────────────────────────────────────────

/** Chiffre du haut de l'onglet : somme brute (routes/bacs-audit.js, power-summary). */
export const SYSTEMS_POWER_SUM_TIP = {
  title: 'Somme des puissances saisies',
  tone: 'info',
  icon: 'calculator',
  text: 'Additionne toutes les puissances de chauffage et de climatisation saisies, radiateurs et autres émetteurs compris. Le verdict du décret retient une autre valeur.',
  rows: [{ icon: 'bolt', label: 'Puissance retenue', value: 'la plus forte des deux, sans les radiateurs ni les autres émetteurs' }],
  todo: 'Consulte le verdict dans l’onglet Site.',
  article: 'R175-2',
};

/** « Échelle de la régulation » de la fiche Régulation (chauffage ou froid) : même texte que
 *  la colonne « Granularité » du bureau, qui distingue chauffage et froid. */
export const THERMAL_SCALE_TIP = {
  ...THERMAL_COLUMN_TIPS.granularity,
  title: 'Échelle de la régulation',
};

/** Bouton « Ajouter » grisé de l'ajout d'un usage personnalisé. */
export const ADD_USAGE_DISABLED_TIP = {
  title: 'Usage à choisir',
  tone: 'neutral',
  icon: 'plus',
  text: 'Il faut une catégorie ou un nom pour ajouter l’usage à la zone.',
  todo: 'Choisis une catégorie dans la liste, ou saisis un nom.',
};

// Icônes citées par ce module, y compris celles des cartes reprises du bureau (enregistrées
// par lib/tooltip-icons.js, cf. test).
export const AUDIT_MOBILE_TIP_ICONS = [
  'wifi', 'clock', 'camera', 'arrows-rotate', 'location-dot', 'circle-question', 'display', 'calculator', 'bolt', 'plus',
  'circle-exclamation', 'triangle-exclamation', 'pen', 'temperature-half',
];
