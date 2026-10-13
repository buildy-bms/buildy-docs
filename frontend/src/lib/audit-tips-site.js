// Infobulles de l'audit BACS, lot « site, zones, régulation, dossier, plan d'actions »
// (2026-10-12) : identification et assujettissement du bâtiment, parties prenantes, zones,
// régulation de la température pièce par pièce, check-list, documents, accès, inspections,
// plan de mise en conformité, note de synthèse. Français simple (lecteurs qui ne connaissent
// pas le décret), tutoiement, article du décret en pied discret (`article`).
// Une seule source pour le bureau et le mobile. Fonctions PURES, imports relatifs uniquement
// (testées par backend-node/test/audit-tips-site.test.mjs). Règles : CLAUDE.md § « Infobulles
// (UI) ». Les règles métier citées viennent du serveur (lib/bacs-audit-power.js,
// lib/bacs-liability.js, lib/bacs-audit-action-generator.js) : ne rien inventer ici.

import { decreePlain, normalizeArticle } from './decree-plain.js';
import { plural } from './tooltip-content.js';

// ── Formats ────────────────────────────────────────────────────────────────────────────────

function parseDate(v) {
  if (!v) return null;
  const s = String(v);
  const day = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 2026-10-12 » → « 12 octobre 2026 » ; '' si vide ou illisible. */
export function longDate(v) {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** Date et heure → « 12 oct. 2026 à 10:15 » ; '' si vide ou illisible. */
export function longDateTime(v) {
  const d = parseDate(v);
  if (!d) return '';
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} à ${time}`;
}

/** 12.5 → « 12,5 kW ». */
export function fmtKw(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return `${String(v).replace('.', ',')} kW`;
}

function euros(n, digits) {
  return `${(Number(n) || 0).toFixed(digits).replace('.', ',')} €`;
}

// ── Étape Identification : le bâtiment est-il concerné ? ─────────────────────────────────

/** ⓘ du libellé « Puissance de chauffage et de climatisation ». */
export const POWER_LABEL_HELP = {
  title: 'Puissance prise en compte',
  icon: 'bolt',
  tone: 'info',
  text: 'La puissance nominale utile, inscrite sur la plaque des équipements. Chauffage et climatisation ne s’additionnent pas : on retient le plus puissant des deux.',
  article: 'R175-2',
};

/** Bouton « Auto-calculer ». */
export const POWER_AUTO_TIP = {
  title: 'Calculer depuis les équipements',
  icon: 'calculator',
  tone: 'info',
  text: 'Reprend la puissance des équipements saisis et repasse en calcul automatique.',
  rows: [
    { icon: 'circle-check', tone: 'success', label: 'Comptés', value: 'équipements qui produisent la chaleur ou le froid' },
    { icon: 'ban', tone: 'neutral', label: 'Non comptés', value: 'radiateurs et autres émetteurs, appareils de secours ou hors service' },
  ],
  article: 'R175-2',
};

/** Origine de la puissance affichée (texte visible + carte). */
export const POWER_SOURCE_LABELS = {
  auto: 'calcul automatique',
  manual_override: 'saisie à la main',
};
export const POWER_SOURCE_TIPS = {
  auto: {
    title: 'Calcul automatique',
    icon: 'calculator',
    tone: 'success',
    text: 'La puissance suit les équipements saisis : elle est recalculée à chaque modification.',
  },
  manual_override: {
    title: 'Valeur saisie à la main',
    icon: 'pen',
    tone: 'warning',
    text: 'Tu as remplacé le calcul : la valeur ne suit plus les équipements saisis.',
    todo: 'Clique « Auto-calculer » pour revenir au calcul automatique.',
  },
};

/** Ligne « Puissance retenue » sous le détail du calcul. */
export const RETAINED_POWER_TIP = {
  title: 'Puissance retenue',
  icon: 'bolt',
  tone: 'info',
  text: 'Chauffage et climatisation ne s’additionnent pas : on retient le plus puissant des deux. Les radiateurs et autres émetteurs, déjà comptés à la production, sont exclus.',
  article: 'R175-2',
};

/** Ligne d'un équipement dans le détail du calcul de puissance. */
export function powerDeviceTip(d) {
  if (!d) return null;
  const heating = d.system_category === 'heating';
  const qty = Number(d.quantity) || 1;
  const kw = Number(d.power_kw) || 0;
  const rows = [];
  if (d.zone_name) rows.push({ icon: 'location-dot', label: 'Zone', value: d.zone_name });
  rows.push({ icon: 'bolt', label: 'Puissance', value: qty > 1 ? `${qty} × ${fmtKw(kw)} = ${fmtKw(kw * qty)}` : fmtKw(kw) });
  const counted = d.in_scope !== false;
  return {
    title: d.name || d.brand || 'Équipement sans nom',
    accent: heating ? 'heating' : 'cooling',
    text: counted
      ? `Compté dans la puissance de ${heating ? 'chauffage' : 'climatisation'}.`
      : `Non compté : ${d.exclusion_reason_label || 'exclu du calcul'}.`,
    rows,
  };
}

/** Pastille de couleur d'un équipement du détail (chauffage / climatisation). */
export function powerCategoryLabel(category) {
  return category === 'heating' ? { label: 'Chauffage', icon: 'fire' } : { label: 'Climatisation', icon: 'snowflake' };
}

/** Champ « Date du permis de construire » : la règle des deux seuils. */
export const PERMIT_DATE_TIP = {
  title: 'Date du permis de construire',
  icon: 'calendar',
  tone: 'info',
  text: 'Avec la puissance, elle fixe l’échéance de la GTB. À 70 kW ou moins, le bâtiment n’est pas concerné.',
  rows: [
    { icon: 'bolt', label: 'Plus de 290 kW', value: 'dès la livraison si permis déposé après le 21 juillet 2021, sinon au plus tard le 1er janvier 2025' },
    { icon: 'bolt', label: 'Plus de 70 kW', value: 'dès la livraison si permis déposé après le 8 avril 2024, sinon au plus tard le 1er janvier 2030' },
  ],
  article: 'R175-2',
};

const APPLICABILITY_TIPS = {
  subject_immediate: {
    title: 'Concerné dès la construction',
    tone: 'error',
    icon: 'triangle-exclamation',
    text: 'Bâtiment neuf : la GTB est exigée dès la livraison, avec tous les équipements techniques reliés.',
    rows: [
      { label: 'Plus de 290 kW', value: 'permis déposé après le 21 juillet 2021' },
      { label: 'Plus de 70 kW', value: 'permis déposé après le 8 avril 2024' },
    ],
    article: 'R175-2',
  },
  subject_2025: {
    title: 'Concerné depuis le 1er janvier 2025',
    tone: 'warning',
    icon: 'triangle-exclamation',
    text: 'Bâtiment existant de plus de 290 kW : la GTB devait être en place au plus tard le 1er janvier 2025.',
    article: 'R175-2',
  },
  subject_2030: {
    title: 'Concerné d’ici 2030',
    tone: 'warning',
    icon: 'hourglass-half',
    text: 'Bâtiment existant de plus de 70 kW : la GTB est exigée au remplacement du chauffage ou de la climatisation, au plus tard le 1er janvier 2030.',
    article: 'R175-2',
  },
  not_subject: {
    title: 'Non concerné par le décret',
    tone: 'success',
    icon: 'circle-check',
    text: 'La puissance retenue ne dépasse pas 70 kW : les obligations de GTB ne s’appliquent pas. La régulation pièce par pièce reste vérifiée.',
    article: 'R175-2',
  },
};

const PRESUMED_TIP = {
  title: 'Concerné par précaution',
  tone: 'warning',
  icon: 'circle-question',
  text: 'Des équipements n’ont pas de puissance : tant qu’elles manquent, le bâtiment est présumé concerné, au plus tard le 1er janvier 2030.',
  todo: 'Complète la puissance des équipements de chauffage et de climatisation.',
  article: 'R175-2',
};

/** Encadré du verdict d'assujettissement : ce que veut dire chaque verdict. */
export function applicabilityTip(status, { presumed = false } = {}) {
  if (status === 'subject_2030' && presumed) return PRESUMED_TIP;
  return APPLICABILITY_TIPS[status] || null;
}

/** Pastille « Régulation pièce par pièce obligatoire / non exigée » (travaux sur générateur). */
export function thermalTriggerTip({ applies, permitDate, worksDate }) {
  const rows = [
    { icon: 'calendar', label: 'Permis de construire', value: longDate(permitDate) || 'non renseigné' },
    { icon: 'fire', label: 'Travaux sur le générateur', value: longDate(worksDate) || 'non renseignés' },
  ];
  return applies
    ? {
        title: 'Régulation pièce par pièce obligatoire',
        tone: 'warning',
        icon: 'temperature-half',
        text: 'Le permis de construire ou des travaux sur le générateur de chaleur datent d’après le 21 juillet 2021.',
        rows,
        article: 'R175-6',
      }
    : {
        title: 'Régulation pièce par pièce non exigée',
        tone: 'success',
        icon: 'temperature-half',
        text: 'Ni le permis de construire ni les travaux sur le générateur de chaleur ne datent d’après le 21 juillet 2021.',
        rows,
        article: 'R175-6',
      };
}

/** ⓘ du champ « Puissance de la station d'échange ». */
export const SUBSTATION_TIP = {
  title: 'Station d’échange',
  icon: 'arrow-right-arrow-left',
  tone: 'info',
  text: 'Elle relie le bâtiment au réseau urbain de chaleur ou de froid. Sa puissance est retenue à la place de celle des équipements qu’elle alimente.',
  rows: [{ icon: 'cube', label: 'Équipement ajouté', value: 'une sous-station, dans le premier système de chauffage' }],
  article: 'R175-2',
};

// ── Structure juridique et parties prenantes ─────────────────────────────────────────────

/** ⓘ de « Structure de propriété ou d'occupation » (calcul serveur : lib/bacs-liability.js). */
export const OWNERSHIP_HELP_TIP = {
  title: 'Qui doit appliquer le décret ?',
  icon: 'scale-balanced',
  tone: 'info',
  text: 'La structure indique qui doit mettre chaque système en conformité :',
  rows: [
    { label: 'Propriétaire unique occupant', value: 'le propriétaire, pour tous les systèmes' },
    { label: 'Copropriété', value: 'le syndicat, sauf pour le système propre à un copropriétaire' },
    { label: 'Propriétaire bailleur et preneurs', value: 'le bailleur, sauf pour un système installé par un locataire' },
    { label: 'Preneurs indépendants', value: 'chaque locataire, pour les systèmes de ses zones' },
  ],
  article: 'R175-2',
};

/** Encadré « Suggestion » de partie prenante. */
export const PARTY_SUGGESTION_TIP = {
  title: 'Partie prenante suggérée',
  icon: 'user-group',
  tone: 'info',
  text: 'Proposée d’après la structure choisie : crée-la en un clic, ou ajoute la tienne.',
};

/** ⓘ de « Parties prenantes rattachées à cette zone ». */
export const ZONE_PARTIES_HELP_TIP = {
  title: 'Parties prenantes de la zone',
  icon: 'user-group',
  tone: 'info',
  text: 'À la première ouverture, la zone reprend toutes les parties du site. Décoche celles qui n’y sont pas, par exemple le locataire d’une autre zone.',
};

// ── Zones ──────────────────────────────────────────────────────────────────────────────────

/** En-têtes du tableau des zones. */
export const ZONE_COLUMN_TIPS = {
  nature: {
    title: 'Nature',
    icon: 'tag',
    tone: 'info',
    text: 'Ce qu’on fait dans la zone : bureaux, restauration, atelier, local technique…',
  },
  occupancy: {
    title: 'Régime d’activité',
    icon: 'clock',
    tone: 'info',
    text: 'Quand la zone est occupée : 24 h/24, heures de bureau, rythme scolaire… Des horaires différents justifient souvent deux zones.',
  },
  comfort: {
    title: 'Contrainte de confort',
    icon: 'temperature-half',
    tone: 'info',
    text: 'Exigence particulière de la zone, par exemple une température minimale imposée ou une qualité d’air renforcée. Facultatif.',
  },
  kind: {
    title: 'Type de zone',
    icon: 'location-dot',
    tone: 'info',
    text: 'Seules les zones fonctionnelles reçoivent des systèmes et des compteurs.',
    rows: [
      { label: 'Fonctionnelle', value: 'concernée par le décret' },
      { label: 'Technique', value: 'simple inventaire, hors décret' },
    ],
  },
};

/** Boutons Fonctionnelle / Technique d'une zone. */
export const ZONE_KIND_TIPS = {
  functional: {
    title: 'Zone fonctionnelle',
    accent: 'site',
    text: 'Locaux aux usages homogènes (bureaux, restauration…) concernés par le décret : on y décrit les systèmes et les compteurs.',
    article: 'R175-1 6°',
  },
  technical: {
    title: 'Zone technique',
    tone: 'neutral',
    icon: 'screwdriver-wrench',
    text: 'Local technique, tableau électrique général, local compteurs… Hors décret : simple inventaire, sans systèmes ni compteurs.',
  },
};

/** Pastille lettre (A, B, C…) d'une zone géolocalisée. */
export function zoneLegendTip(initial) {
  return {
    title: `Repère ${initial} sur la carte`,
    icon: 'map-location-dot',
    tone: 'info',
    text: 'Même lettre et même couleur que le repère de cette zone sur la vue satellite.',
  };
}

/** Champ « Contrainte de confort » d'une zone : sa valeur complète, ou l'explication. */
export function comfortConstraintTip(value) {
  const v = String(value || '').trim();
  if (!v) return ZONE_COLUMN_TIPS.comfort;
  return { title: 'Contrainte de confort', icon: 'temperature-half', tone: 'info', text: v };
}

/** « Règle des 5 % » dans l'aide « Comprendre la zone fonctionnelle ». */
export const FIVE_PERCENT_TIP = {
  title: 'Règle des 5 %',
  icon: 'percent',
  tone: 'info',
  text: 'Un usage qui pèse moins de 5 % de la consommation totale du bâtiment n’a pas à être relié à la GTB : il ne justifie pas une zone à part.',
  meta: 'FAQ du ministère, question 16',
};

// ── Régulation de la température pièce par pièce ─────────────────────────────────────────

/** En-tête « Système » du tableau de régulation. */
export const THERMAL_SYSTEM_HEADER_TIP = {
  title: 'Système',
  icon: 'layer-group',
  tone: 'info',
  text: 'Un usage, chauffage ou refroidissement, dans une zone, avec ses équipements. Une ligne par système présent à l’étape Systèmes.',
};

/** En-têtes Production / Distribution / Émission. */
export const THERMAL_LEVEL_TIPS = {
  production: {
    title: 'Production',
    icon: 'industry',
    tone: 'info',
    text: 'L’équipement qui produit la chaleur ou le froid : chaudière, pompe à chaleur, groupe d’eau glacée, sous-station de réseau urbain…',
  },
  distribution: {
    title: 'Distribution',
    icon: 'route',
    tone: 'info',
    text: 'Ce qui amène la chaleur ou le froid jusqu’aux locaux : circuits d’eau chaude ou glacée, réseaux d’air, pompes et vannes.',
  },
  emission: {
    title: 'Émission',
    icon: 'temperature-half',
    tone: 'info',
    text: 'Ce qui diffuse la chaleur ou le froid dans la pièce : radiateurs, plancher chauffant, ventilo-convecteurs… C’est là que se règle chaque pièce.',
    article: 'R175-6',
  },
};

/** Sous-en-têtes Équipement / Type de régulation / Granularité / Note. */
export const THERMAL_COLUMN_TIPS = {
  equipment: {
    title: 'Équipement',
    icon: 'cube',
    tone: 'info',
    text: 'L’équipement concerné (production, distribution ou émission), choisi parmi ceux du système. Tu peux en sélectionner plusieurs.',
  },
  type: {
    title: 'Type de régulation',
    icon: 'sliders',
    tone: 'info',
    text: 'Comment cet équipement est réglé : selon la température extérieure (loi d’eau), vanne 3 voies, thermostat d’ambiance… Enregistré dans sa fiche.',
  },
  granularity: {
    title: 'Finesse du réglage',
    icon: 'temperature-half',
    tone: 'info',
    text: 'Pièce par pièce, par zone, ou un réglage unique pour tout le circuit (centralisée). Pour le chauffage, le décret veut pièce par pièce ou par zone.',
    article: 'R175-6',
  },
  note: {
    title: 'Note',
    icon: 'note-sticky',
    tone: 'info',
    text: 'Une remarque sur ce réglage, reprise dans le rapport : par exemple une sonde d’ambiance à déplacer.',
  },
};

/** Sélecteur de granularité en rouge (non conforme) : pourquoi. Null quand il est conforme. */
export function granularityTip({ key, label, category, hasEmitter = true }) {
  if (key === 'per_room' || key === 'per_zone') return null;
  if (!hasEmitter) {
    return {
      title: 'Émetteur à choisir',
      tone: 'warning',
      icon: 'temperature-half',
      text: 'Sans équipement d’émission, la régulation est considérée comme centralisée.',
      todo: 'Choisis d’abord l’équipement d’émission de ce système.',
    };
  }
  const central = key === 'central_only';
  const title = central ? 'Régulation centralisée' : 'Granularité non reconnue';
  const what = central
    ? 'La température n’est réglée qu’au départ, pas pièce par pièce ni par zone.'
    : `« ${label || key} » n’est pas reconnue comme une régulation pièce par pièce ou par zone.`;
  if (category === 'cooling') {
    return { title, tone: 'warning', icon: 'snowflake', text: `${what} Pour le froid, le décret ne l’exige pas : aucune action n’est créée.` };
  }
  return {
    title,
    tone: 'error',
    icon: 'temperature-half',
    text: `${what} Pour le chauffage, cela ne répond pas au décret.`,
    todo: 'Si les émetteurs se règlent pièce par pièce ou par zone, choisis « Par pièce » ou « Par zone ».',
    article: 'R175-6',
  };
}

/** Nom d'un système (lien vers l'étape Systèmes). */
export function thermalSystemLinkTip(name) {
  return {
    title: name || 'Système',
    icon: 'arrow-right',
    tone: 'info',
    text: 'Ouvre ce système à l’étape Systèmes pour voir ou modifier ses équipements.',
  };
}

/** Pastille « Exempté — bois ». */
export const WOOD_EXEMPT_TIP = {
  title: 'Dispensé : chauffage au bois',
  tone: 'success',
  icon: 'tree',
  text: 'L’équipement de production fonctionne au bois. Les appareils indépendants de chauffage au bois n’ont pas à être régulés pièce par pièce.',
  todo: 'Vérifie qu’il s’agit d’un poêle ou d’un insert : une chaudière bois collective reste concernée.',
  article: 'R175-6',
};

/** Bouton « Pré-remplir depuis les équipements ». */
export const PREFILL_TIP = {
  title: 'Pré-remplir la régulation',
  icon: 'wand-magic-sparkles',
  tone: 'info',
  text: 'Remplit les cases encore vides (production, distribution, émission, régulateurs) avec les équipements de l’étape Systèmes.',
  rows: [{ icon: 'lock', label: 'Cases déjà remplies', value: 'inchangées' }],
};

/** Sélecteur d'équipement d'un niveau encore vide (ambre « à compléter »). */
export const THERMAL_DEVICE_MISSING_TIP = {
  title: 'Équipement à choisir',
  tone: 'warning',
  icon: 'cube',
  text: 'Aucun équipement n’est choisi pour ce réglage.',
  todo: 'Choisis-le dans la liste : elle reprend les équipements du système.',
};

/** Sélecteur de type de régulation encore vide (ambre « à compléter »). */
export const THERMAL_TYPE_MISSING_TIP = {
  title: 'Type de régulation à préciser',
  tone: 'warning',
  icon: 'sliders',
  text: 'Indique comment ce niveau est réglé : thermostat, loi d’eau, vanne… Le choix est enregistré sur l’équipement.',
};

const LEVEL_ON = { production: 'la production', distribution: 'la distribution', emission: 'l’émission' };

/** Bouton de note d'un niveau : aperçu de la note, ou invitation à en écrire une. */
export function thermalNoteTip(level, text) {
  const on = LEVEL_ON[level] || 'ce niveau';
  const t = String(text || '').trim();
  if (!t) return `Ajouter une note sur ${on}`;
  return { title: `Note sur ${on}`, icon: 'note-sticky', tone: 'info', text: t.length > 160 ? `${t.slice(0, 157)}…` : t };
}

/** Pastille bleue : régulation intégrée à l'équipement (cas par défaut). */
export const INTEGRATED_REGULATION_TIP = {
  title: 'Régulation intégrée',
  icon: 'temperature-half',
  tone: 'info',
  text: 'L’équipement porte sa propre régulation. C’est le cas par défaut.',
  todo: 'Si un régulateur séparé le pilote, choisis « Déportée » dans la fiche de l’équipement.',
};

/** Pastille violette : régulation déportée, avec les infos du régulateur. */
export function deportedRegulationTip({ brand, reference, location } = {}) {
  const rows = [];
  if (brand) rows.push({ icon: 'tag', label: 'Marque', value: brand });
  if (reference) rows.push({ icon: 'hashtag', label: 'Référence', value: reference });
  if (location) rows.push({ icon: 'location-dot', label: 'Emplacement', value: location });
  return {
    title: 'Régulation déportée',
    accent: 'thermal',
    icon: 'sliders',
    text: 'Un régulateur séparé pilote cet équipement.',
    rows,
    todo: rows.length ? null : 'Complète la marque, la référence et l’emplacement du régulateur dans la fiche de l’équipement.',
  };
}

// ── Check-list documentaire ──────────────────────────────────────────────────────────────

const COVERAGE_KINDS = {
  zones: { title: 'Photos des zones', icon: 'location-dot', one: 'zone', many: 'zones' },
  systems: { title: 'Photos des systèmes', icon: 'layer-group', one: 'système', many: 'systèmes' },
  meters: { title: 'Photos des compteurs', icon: 'gauge', one: 'compteur', many: 'compteurs' },
  bms: { title: 'Photos de la GTB', icon: 'display', one: 'GTB', many: 'GTB' },
};

/** Tuile de couverture photo (zones, systèmes, compteurs, GTB). */
export function coverageTileTip(kind, cov) {
  const k = COVERAGE_KINDS[kind];
  if (!k) return null;
  const total = Number(cov?.total) || 0;
  const covered = Number(cov?.covered) || 0;
  if (!total) {
    return { title: k.title, icon: k.icon, tone: 'neutral', text: kind === 'bms' ? 'Aucune GTB déclarée pour l’instant.' : 'Rien à photographier pour l’instant.' };
  }
  if (kind === 'bms') {
    return covered
      ? { title: k.title, icon: k.icon, tone: 'success', text: 'La GTB a au moins une photo ou un fichier joint.' }
      : { title: k.title, icon: k.icon, tone: 'warning', text: 'La GTB n’a pas encore de photo.', todo: 'Ouvre l’étape GTB pour en ajouter une.' };
  }
  const rows = [{ icon: 'images', label: 'Avec photo', value: `${covered} sur ${total}` }];
  if (covered >= total) {
    return { title: k.title, icon: k.icon, tone: 'success', text: 'Tout est photographié : au moins une photo ou un fichier par élément.', rows };
  }
  return {
    title: k.title,
    icon: k.icon,
    tone: 'warning',
    text: `${plural(total - covered, `${k.one} sans photo`, `${k.many} sans photo`)}.`,
    rows,
    todo: 'Ouvre la liste : elle mène directement à chaque élément sans photo.',
  };
}

/** Boutons d'état d'une pièce du dossier. */
export const CHECKLIST_STATUS_TIPS = {
  pending: {
    title: 'À collecter',
    icon: 'circle-exclamation',
    tone: 'warning',
    text: 'Pièce attendue mais pas encore reçue : elle compte comme manquante dans la progression.',
  },
  available: {
    title: 'Collecté',
    icon: 'circle-check',
    tone: 'success',
    text: 'La pièce est rassemblée : dépose ses fichiers ci-dessous. Déposer un fichier choisit cet état tout seul.',
  },
  not_available: {
    title: 'Non disponible',
    icon: 'ban',
    tone: 'neutral',
    text: 'La pièce n’existe pas ou le client ne peut pas la fournir. Elle compte comme traitée : indique pourquoi.',
  },
};

/** Appareil photo grisé (audit sans site). */
export const PHOTOS_NEED_SITE_TIP = {
  title: 'Photos indisponibles',
  icon: 'camera',
  tone: 'neutral',
  text: 'Les photos sont rangées dans le site, or l’audit n’est rattaché à aucun site.',
  todo: 'Rattache d’abord l’audit à un site.',
};

// ── Inspections périodiques ──────────────────────────────────────────────────────────────

/** Pastille d'état d'une inspection (rouge, ambre, vert). */
export function inspectionStatusTip(tone, dueIso) {
  const due = longDate(dueIso);
  const rows = due ? [{ icon: 'calendar', label: 'Prochaine inspection', value: `le ${due}` }] : [];
  if (tone === 'red') {
    return {
      title: 'Inspection en retard',
      tone: 'error',
      icon: 'calendar-xmark',
      text: 'La date prévue pour la prochaine inspection est passée.',
      rows,
      todo: 'Signale-le au propriétaire : c’est à lui de la faire réaliser.',
      article: 'R175-5-1',
    };
  }
  if (tone === 'amber') {
    return {
      title: 'Inspection à prévoir',
      tone: 'warning',
      icon: 'hourglass-half',
      text: 'La prochaine inspection est due dans moins de 6 mois.',
      rows,
      todo: 'Préviens le propriétaire pour qu’il la programme.',
      article: 'R175-5-1',
    };
  }
  if (tone === 'emerald') {
    return { title: 'Inspection à jour', tone: 'success', icon: 'calendar-check', text: 'La prochaine inspection est due dans plus de 6 mois.', rows, article: 'R175-5-1' };
  }
  return null;
}

/** « → date » dans la ligne d'une inspection. */
export function nextInspectionLabel(dueIso) {
  const due = longDate(dueIso);
  return due ? { label: `Prochaine inspection le ${due}`, icon: 'calendar' } : null;
}

export const NEXT_INSPECTION_TIP = {
  title: 'Prochaine inspection',
  icon: 'calendar',
  tone: 'info',
  text: 'Au plus tard 5 ans après la précédente. Elle se remplit toute seule quand tu saisis la date de l’inspection.',
  article: 'R175-5-1',
};

export const REPORT_RETENTION_TIP = {
  title: 'Conservation du rapport',
  icon: 'box-archive',
  tone: 'info',
  text: 'Le rapport d’inspection se garde 10 ans. La date se remplit toute seule quand tu saisis celle de l’inspection.',
  article: 'R175-5-1',
};

export const PLUS_5_YEARS_TIP = {
  title: 'Ajouter 5 ans',
  icon: 'calendar-plus',
  tone: 'info',
  text: 'Prochaine échéance : 5 ans après la date de l’inspection, ou après aujourd’hui si elle manque. L’inspection revient au moins tous les 5 ans.',
  article: 'R175-5-1',
};

export const PLUS_10_YEARS_TIP = {
  title: 'Ajouter 10 ans',
  icon: 'calendar-plus',
  tone: 'info',
  text: 'Fin de conservation : 10 ans après la date de l’inspection, ou après aujourd’hui si elle manque. Le rapport se garde 10 ans.',
  article: 'R175-5-1',
};

// ── Plan de mise en conformité ───────────────────────────────────────────────────────────

/** Niveaux d'action : même sens que la légende « Lecture du plan » du rapport. */
export const LEVEL_TIPS = {
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
    text: 'Exigence du décret non respectée, à traiter pour atteindre la conformité.',
  },
  minor: {
    title: 'Action mineure',
    tone: 'warning',
    icon: 'circle-info',
    text: 'Recommandation, ou raccordement à la GTB exigé seulement s’il se rembourse en moins de 10 ans.',
  },
  reserve: {
    title: 'Réserve',
    tone: 'info',
    icon: 'clipboard-check',
    text: 'Obligation du propriétaire à tenir dans la durée : entretien, inspection périodique, export des données. Sans effet sur la conformité de l’installation.',
  },
  info: {
    title: 'Information hors plan',
    tone: 'neutral',
    icon: 'circle-info',
    text: 'Exemption ou point de vigilance : sans numéro et sans effet sur la conformité, comme dans le rapport.',
  },
};

/** Pastille de niveau d'une action. */
export function levelTip(it) {
  if (!it) return null;
  if (it.is_reserve) return LEVEL_TIPS.reserve;
  if (it.is_info) return LEVEL_TIPS.info;
  return LEVEL_TIPS[it.severity] || null;
}

const LEVEL_COUNT_NAMES = {
  blocking: ['action bloquante', 'actions bloquantes'],
  major: ['action majeure', 'actions majeures'],
  minor: ['action mineure', 'actions mineures'],
  reserve: ['réserve', 'réserves'],
  info: ['information hors plan', 'informations hors plan'],
};

/** Pastille de décompte (« 3 bloquantes ») : la définition du niveau. */
export function levelCountTip(level, n) {
  const base = LEVEL_TIPS[level];
  const names = LEVEL_COUNT_NAMES[level];
  if (!base || !names) return null;
  return { ...base, title: plural(n, names[0], names[1]) };
}

export const REGENERATE_PLAN_TIP = {
  title: 'Régénérer le plan',
  icon: 'rotate',
  tone: 'info',
  text: 'Recalcule les actions à partir des données saisies dans l’audit.',
  rows: [
    { icon: 'lock', tone: 'success', label: 'Conservés', value: 'préconisations, annotations commerciales, actions ajoutées à la main' },
    { icon: 'circle-check', tone: 'success', label: 'Écart corrigé', value: 'action marquée terminée' },
  ],
};

export const COMMERCIAL_VIEW_TIP = {
  title: 'Vue commerciale',
  icon: 'table-list',
  tone: 'info',
  text: 'Toutes les actions dans un tableau : suivi de leur état (chiffrée, en cours, terminée…), ajout à la main et export en tableur.',
};

/** Numéro d'action (« BACS-001 »). */
export function actionNumberTip(num) {
  if (!num) return null;
  return {
    title: `Action ${num}`,
    icon: 'hashtag',
    tone: 'neutral',
    text: 'Le même numéro figure dans le rapport PDF, la vue commerciale et l’application mobile.',
  };
}

/** Code d'article d'une action : l'exigence en clair, le code en pied. */
export function articleTip(code) {
  const key = normalizeArticle(code);
  if (!key) return null;
  const base = key.match(/^R\s?175-\d+(?:-\d+)?/)?.[0] || '';
  const plain = decreePlain(key) || (base ? decreePlain(base) : null);
  if (!plain) {
    return { title: 'Exigence du décret', icon: 'scale-balanced', tone: 'info', text: 'Article du décret BACS auquel se rattache cette action.', article: key };
  }
  return { title: plain.title, icon: 'scale-balanced', tone: 'info', text: plain.text, article: key };
}

/** Bouton « Préconiser » / « Préconisations ». */
export function preconisationTip({ has, open }) {
  if (has) return 'Modifier les préconisations Buildy';
  if (open) {
    return {
      title: 'Préconisation à rédiger',
      tone: 'error',
      icon: 'pen-nib',
      text: 'Cette action ouverte n’a pas encore de préconisation : la solution que Buildy propose au client.',
      todo: 'Rédige-la : elle s’imprime sous l’action dans le rapport.',
    };
  }
  return 'Rédiger une préconisation Buildy';
}

// ── Note de synthèse ─────────────────────────────────────────────────────────────────────

export const STALE_SYNTHESIS_TIP = {
  title: 'Note périmée',
  tone: 'warning',
  icon: 'triangle-exclamation',
  text: 'Le plan d’actions a changé depuis la date de la note : elle ne sera pas imprimée dans le rapport.',
  todo: 'Régénère-la avec Claude, ou relis-la puis confirme qu’elle est à jour.',
};

export const CONFIRM_SYNTHESIS_TIP = {
  title: 'Confirmer la note',
  tone: 'success',
  icon: 'circle-check',
  text: 'Donne à la note la date du jour : elle redevient à jour et sera de nouveau imprimée dans le rapport.',
};

/** Bouton « Rédiger avec Claude » : ce que fait Claude et ce que ça coûte. */
export function claudeUsageTip(u) {
  if (!u) return { label: 'Coût de Claude : chargement…', icon: 'wand-magic-sparkles' };
  const rows = [
    { icon: 'coins', label: 'Coût moyen par demande', value: `≈ ${euros(u.avg_cost_eur, 3)}` },
    { icon: 'clock', label: 'Sur 30 jours', value: `${euros(u.cost_eur, 2)} pour ${plural(Number(u.requests) || 0, 'demande', 'demandes')}` },
  ];
  if (u.month_cost_eur != null) rows.push({ icon: 'calendar', label: 'Mois en cours', value: euros(u.month_cost_eur, 2) });
  if (u.monthly_budget_eur && u.remaining_eur != null) {
    rows.push({ icon: 'wallet', label: 'Budget mensuel', value: `${euros(u.remaining_eur, 2)} restants sur ${euros(u.monthly_budget_eur, 2)}` });
  }
  return {
    title: 'Rédiger avec Claude',
    icon: 'wand-magic-sparkles',
    tone: 'info',
    text: 'Claude lit tout l’audit et rédige la note, sans inventer de données. Relis-la avant de livrer.',
    rows,
  };
}

// ── Documents et accès du site ───────────────────────────────────────────────────────────

function coordText(v, pos, neg) {
  return `${Math.abs(Number(v)).toFixed(5).replace('.', ',')}° ${Number(v) >= 0 ? pos : neg}`;
}

/** Informations d'une photo (date de prise de vue, appareil, position). */
export function exifTip(d) {
  if (!d) return null;
  const rows = [];
  if (d.taken_at) rows.push({ icon: 'clock', label: 'Prise le', value: longDateTime(d.taken_at) });
  const camera = [d.camera_make, d.camera_model].filter(Boolean).join(' ');
  if (camera) rows.push({ icon: 'camera', label: 'Appareil', value: camera });
  if (d.gps_latitude != null && d.gps_longitude != null) {
    rows.push({ icon: 'location-dot', label: 'Position', value: `${coordText(d.gps_latitude, 'N', 'S')}, ${coordText(d.gps_longitude, 'E', 'O')}` });
  }
  if (!rows.length) return null;
  return { title: 'Informations de la photo', icon: 'camera', tone: 'info', rows };
}

/** Pastille « Rattaché à » d'un document. */
export function attachmentTip(att) {
  if (!att) return null;
  if (att.kind === 'Site') {
    return {
      title: 'Document du site',
      icon: 'building',
      tone: 'info',
      text: 'Document de l’ensemble du site, sans élément précis : zone, système, équipement, compteur ou GTB.',
    };
  }
  return att.label ? `${att.kind} : ${att.label}` : att.kind || null;
}

export const DOC_ATTACHED_COLUMN_TIP = {
  title: 'Rattaché à',
  icon: 'link',
  tone: 'info',
  text: 'Élément de l’audit auquel le document est lié : zone, système, équipement, compteur, GTB, pièce du dossier ou action. « Site » : tout le site.',
};

export const DOC_REPORT_COLUMN_TIP = {
  title: 'Joint au rapport',
  icon: 'paperclip',
  tone: 'info',
  text: 'Les documents cochés sont ajoutés au rapport PDF, dans l’annexe « Documents joints ». Les photos rattachées figurent déjà dans leur chapitre.',
};

/** Type d'un accès (pastille WEB, SSH, VPN…). */
export const CREDENTIAL_TYPE_TIPS = {
  web: { label: 'Interface web, dans un navigateur', icon: 'globe' },
  ssh: { label: 'SSH : ligne de commande à distance', icon: 'terminal' },
  vpn: { label: 'VPN : accès au réseau du site', icon: 'shield-halved' },
  snmp: { label: 'SNMP : supervision du réseau', icon: 'network-wired' },
  rdp: { label: 'RDP : bureau Windows à distance', icon: 'desktop' },
  autre: { label: 'Autre type d’accès', icon: 'key' },
};

// ── Consommations de référence ───────────────────────────────────────────────────────────

export const TENANT_COLUMN_TIP = {
  title: 'Locataire',
  icon: 'user-tie',
  tone: 'info',
  text: 'Locataire à qui revient cette facture. La liste reprend les parties prenantes de type « Preneur à bail ».',
};

export const ATTACH_INVOICE_TIP = {
  title: 'Joindre la facture',
  icon: 'paperclip',
  tone: 'info',
  text: 'Choisis un PDF ou une image, ou dépose le fichier directement sur la ligne du mois.',
};

export const ENERGY_IMPORT_TIP = {
  title: 'Importer des mois',
  icon: 'file-import',
  tone: 'info',
  text: 'Colle des lignes copiées depuis Excel ou un fichier CSV : année, mois, quantité et coût.',
};

export const CSV_TEMPLATE_TIP = {
  title: 'Modèle de tableur',
  icon: 'file-csv',
  tone: 'info',
  text: 'Fichier à envoyer au client : une ligne par mois avec l’année, le mois, la quantité et le coût. Colle ensuite ses lignes avec « Importer ».',
};

// Icônes citées par ce module (enregistrées par lib/tooltip-icons.js, cf. test).
export const AUDIT_SITE_TIP_ICONS = [
  'arrow-right', 'arrow-right-arrow-left', 'ban', 'bolt', 'box-archive', 'building', 'calculator', 'calendar',
  'calendar-check', 'calendar-plus', 'calendar-xmark', 'camera', 'circle-check', 'circle-exclamation',
  'circle-info', 'circle-question', 'clipboard-check', 'clock', 'coins', 'cube', 'desktop', 'display',
  'file-csv', 'file-import', 'fire', 'gauge', 'globe', 'hashtag', 'hourglass-half', 'images', 'industry',
  'key', 'layer-group', 'link', 'location-dot', 'lock', 'map-location-dot', 'network-wired', 'note-sticky',
  'paperclip', 'pen', 'pen-nib', 'percent', 'rotate', 'route', 'scale-balanced', 'screwdriver-wrench',
  'shield-halved', 'sliders', 'snowflake', 'table-list', 'tag', 'temperature-half', 'terminal', 'tree',
  'triangle-exclamation', 'user-group', 'user-tie', 'wallet', 'wand-magic-sparkles',
];
