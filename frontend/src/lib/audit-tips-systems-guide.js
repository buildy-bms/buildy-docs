// Étape Systèmes, mise en page guidée : textes affichés (lignes « reste à faire », pastilles des
// onglets, guide des usages, carte « à vérifier » de la fiche) et infobulles (étiquettes et cartes
// v-tooltip). Règles de rédaction de CLAUDE.md BD § « Infobulles » : tutoiement, sans jargon ni
// article du décret dans le texte, phrases ≤ 160 caractères. Testé dans
// backend-node/test/audit-tips-systems-guide.test.mjs.
import { plural } from './tooltip-content.js';
import { ENERGY_OPTIONS, ROLE_OPTIONS, GRANULARITY_LABELS_FR, regulationTypesForCategory } from './audit-options.js';

function capitalize(t) {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// Phrases affichées dans la page (pas des bulles).
export const GUIDE_TEXTS = {
  addNote: 'Chaque modèle ajouté s’ouvre dans la fiche, à droite, pour compléter marque, référence et puissance.',
  createSystemIntro: 'Choisis l’usage. Deux systèmes du même usage peuvent coexister, par exemple deux chaudières indépendantes.',
};

// ─── Choix de la mise en page ─────────────────────────────────────────────────
export const LAYOUT_OPTIONS = [
  { value: 'classic', label: 'Actuelle' },
  { value: 'guided', label: 'Nouvelle' },
];
export const LAYOUT_TOGGLE_TIP = {
  title: 'Mise en page de l’étape',
  icon: 'table-columns',
  text: 'Tes réponses restent les mêmes dans les deux : seul l’affichage change.',
  rows: [
    { icon: 'table-list', label: 'Actuelle', value: 'les usages en cartes, la fiche à droite' },
    { icon: 'list-check', label: 'Nouvelle', value: 'le reste à faire en tête, puis un parcours point par point' },
  ],
};

// ─── Pastilles des onglets (zones et synthèse) ────────────────────────────────
/** Pastilles d'un onglet : à compléter (nombre), à vérifier (« ! N »), sans réponse (« ? N »). */
export function guideBadges({ toComplete = 0, toCheck = 0, unanswered = 0 } = {}) {
  const out = [];
  if (toComplete) out.push({ text: String(toComplete), tone: 'amber', label: `${toComplete} à compléter` });
  if (toCheck) out.push({ text: `! ${toCheck}`, tone: 'rose', label: `${toCheck} à vérifier` });
  if (unanswered) out.push({ text: `? ${unanswered}`, tone: 'dashed', label: plural(unanswered, 'usage sans réponse', 'usages sans réponse') });
  return out;
}

function todoItems({ incomplete = 0, empty = 0, loops = 0, toCheck = 0, unanswered = 0 }) {
  const items = [];
  if (incomplete) items.push(`Complète ${plural(incomplete, 'équipement incomplet', 'équipements incomplets')}`);
  if (loops) items.push('Indique si l’eau chaude est bouclée');
  if (empty) {
    items.push(empty > 1
      ? `Ajoute des équipements aux ${empty} usages présents qui n’en ont pas`
      : 'Ajoute un équipement à l’usage présent qui n’en a pas');
  }
  if (toCheck) items.push(`Vérifie ${plural(toCheck, 'point douteux ou contradictoire', 'points douteux ou contradictoires')}`);
  if (unanswered) items.push(`Réponds « Présent » ou « Non concerné » pour ${plural(unanswered, 'usage', 'usages')}`);
  return items;
}

/**
 * Onglet d'une zone (mise en page guidée).
 * @param {{ name, nature?, technical?, present, total, done, incomplete, empty, toCheck, unanswered }} z
 */
export function zoneGuideTabTip(z) {
  const rows = [];
  if (z.nature) rows.push({ icon: 'tag', label: 'Nature', value: z.nature });
  if (z.technical) rows.push({ icon: 'screwdriver-wrench', label: 'Zone technique', value: 'hors décret BACS' });
  rows.push({ icon: 'circle-check', tone: 'success', label: 'Usages terminés', value: `${z.done} sur ${z.present} présents` });
  const items = todoItems(z);
  return {
    title: z.name || 'Zone sans nom',
    tone: z.toCheck ? 'error' : (items.length ? 'warning' : 'success'),
    icon: 'location-dot',
    text: items.length ? '' : 'Tout est renseigné dans cette zone.',
    rows,
    todo: items.length ? { title: 'Reste à faire', items } : null,
  };
}

/** Onglet « Synthèse des systèmes » (mise en page guidée) : toutes zones confondues. */
export function synthesisGuideTabTip(t) {
  const items = todoItems(t);
  return {
    title: 'Synthèse des systèmes',
    tone: t.toCheck ? 'error' : (items.length ? 'warning' : 'success'),
    icon: 'table-cells-large',
    text: 'Toutes les zones et leurs usages sur un seul tableau, avec ce qu’il reste à faire dans chacune.',
    rows: [{ icon: 'location-dot', label: 'Zones', value: t.zones }],
    todo: items.length ? { title: 'Reste à faire', items } : null,
  };
}

// ─── Guide des usages (colonne de gauche) ─────────────────────────────────────
/** « 2 usages terminés sur 4 présents ». */
export function progressLabel(done, present) {
  if (!present) return 'Aucun usage présent pour l’instant';
  return `${plural(done, 'usage terminé', 'usages terminés')} sur ${present} ${present > 1 ? 'présents' : 'présent'}`;
}

/**
 * État d'un usage en quelques mots, en morceaux colorés : [{ text, tone }].
 * tone ∈ 'amber' (à compléter) | 'rose' (à vérifier) | 'slate' (sans réponse) | 'green' (complet).
 */
export function systemStatusParts(x) {
  if (x.status === 'unanswered') return [{ text: 'Sans réponse', tone: 'slate' }];
  if (x.status === 'not_concerned') return [{ text: 'Non concerné', tone: 'slate' }];
  const parts = [];
  if (x.empty) parts.push({ text: 'Sans équipement', tone: 'amber' });
  else if (x.incomplete) parts.push({ text: `${x.incomplete} à compléter`, tone: 'amber' });
  if (x.loopMissing) parts.push({ text: 'bouclage à renseigner', tone: 'amber' });
  if (x.toCheck) parts.push({ text: `${x.toCheck} à vérifier`, tone: 'rose' });
  return parts.length ? parts : [{ text: 'Complet', tone: 'green' }];
}

/** Carte d'un usage dans le guide : état, équipements, ce qu'il reste à faire. */
export function railItemTip(x, label) {
  const count = x.devices.length + x.shared.length;
  const rows = [];
  if (x.present) rows.push({ icon: 'cube', label: 'Équipements', value: count });
  if (x.incomplete) rows.push({ icon: 'pen', tone: 'warning', label: 'À compléter', value: x.incomplete });
  if (x.toCheck) rows.push({ icon: 'triangle-exclamation', tone: 'error', label: 'À vérifier', value: x.toCheck });
  const items = [];
  if (x.status === 'unanswered') items.push('Réponds « Présent » ou « Non concerné » sur sa ligne');
  if (x.empty) items.push('Ajoute son premier équipement');
  if (x.incomplete) items.push(`Complète ${plural(x.incomplete, 'sa fiche incomplète', 'ses fiches incomplètes')}`);
  if (x.loopMissing) items.push('Indique si l’eau chaude est bouclée (Bouclée, Non bouclée ou Inconnu)');
  if (x.toCheck) items.push(`Vérifie ${plural(x.toCheck, 'son point douteux', 'ses points douteux')}`);
  const tone = x.toCheck ? 'error' : (items.length ? 'warning' : 'success');
  return {
    title: label,
    tone,
    icon: 'layer-group',
    text: items.length ? '' : 'Usage complet : tout est renseigné.',
    rows,
    todo: items.length ? { title: 'Reste à faire', items } : null,
    meta: 'Un clic n’affiche que cet usage.',
  };
}

// ─── Filtre par usage (guide de la zone) ──────────────────────────────────────
export const ALL_USAGES_LABEL = 'Tous les usages';
/** État de toute la zone, en morceaux colorés (même forme que systemStatusParts). */
export function zoneStatusParts(z) {
  const parts = [];
  if (z.toComplete) parts.push({ text: `${z.toComplete} à compléter`, tone: 'amber' });
  if (z.toCheck) parts.push({ text: `${z.toCheck} à vérifier`, tone: 'rose' });
  if (z.unanswered) parts.push({ text: `${z.unanswered} sans réponse`, tone: 'slate' });
  return parts.length ? parts : [{ text: 'Complet', tone: 'green' }];
}
export function allUsagesTip(z) {
  return {
    title: ALL_USAGES_LABEL,
    tone: 'info',
    icon: 'layer-group',
    text: 'Affiche tous les usages de la zone, avec leurs équipements.',
    rows: [{ icon: 'layer-group', label: 'Usages présents', value: z.present }],
  };
}
/** Ligne au-dessus de la liste quand un seul usage est affiché. */
export function usageFilterText(label) {
  return `Seulement l’usage « ${label} ».`;
}
export const SHOW_ALL_USAGES_LABEL = 'Afficher tous les usages';

/** Bouton « Reprendre les N points, un par un ». */
export function resumeLabel(n) {
  return n > 1 ? `Reprendre les ${n} points, un par un` : 'Reprendre le point restant';
}
export const RESUME_TIP = {
  title: 'Parcours point par point',
  icon: 'route',
  text: 'Ouvre le premier point à reprendre. Dans la fiche, « Suivant à reprendre » passe au point d’après, zone après zone.',
};
export const GUIDE_DONE_TEXT = 'Tout est renseigné dans cette zone.';

// ─── Lignes « reste à faire » en tête de la zone ──────────────────────────────
function listLabels(labels, max = 5) {
  const shown = labels.slice(0, max);
  return shown.join(', ') + (labels.length > max ? '…' : '');
}

/** « 21 réponses manquent sur 5 équipements : liaison câblée à la GTB, secours… » */
export function missingLineText({ answers, devices, labels }) {
  if (!answers) return '';
  const head = answers > 1 ? `${answers} réponses manquent` : '1 réponse manque';
  return `${head} sur ${plural(devices, 'équipement', 'équipements')} : ${listLabels(labels)}.`;
}
export const MISSING_DETAIL_TIP = 'Voir chaque équipement et ce qui lui manque';
export const MISSING_HIDE_TIP = 'Masquer le détail';

/** Usages présents sans aucun équipement. */
export function emptySystemsLineText(names) {
  if (!names.length) return '';
  return names.length > 1
    ? `${names.length} usages présents sans équipement : ${listLabels(names)}. Ajoute leur premier équipement.`
    : `${names[0]} est présent, mais sans équipement. Ajoute son premier équipement.`;
}

/** Usages sans réponse. */
export function unansweredLineText(names) {
  if (!names.length) return '';
  return names.length > 1
    ? `${names.length} usages sans réponse : ${listLabels(names)}. Réponds « Présent » ou « Non concerné » sur leur ligne.`
    : `${names[0]} : sans réponse. Réponds « Présent » ou « Non concerné » sur sa ligne.`;
}
export const GO_TO_SYSTEM_TIP = 'Aller à cet usage dans la liste';
export const OPEN_DEVICE_TIP = 'Ouvrir la fiche de cet équipement';

// ─── Points « à vérifier » (règles du pré-contrôle de livraison) ──────────────
// short : dans les lignes et les pastilles ; line : conséquence en une phrase courte ;
// title, text, todo : carte de la fiche ; fix : libellé du bouton de correction automatique.
const CHECKS = {
  'POWER-MISSING': {
    short: 'puissance manquante',
    line: 'Sans elle, le cumul des puissances du site est incomplet.',
    title: 'Puissance manquante',
    text: 'Cet équipement produit de la chaleur ou du froid, mais sa puissance n’est pas saisie : le cumul du site ne le compte pas.',
    todo: ['Relève la puissance nominale sur la plaque signalétique, en kW.', 'Introuvable sur place ? Coche « Puissance déclarée inconnue » dans la fiche.'],
  },
  'DEV-001': {
    short: 'énergie saisie sans fonction Production',
    line: 'Seul un équipement qui produit a sa propre énergie.',
    title: 'Énergie sans fonction Production',
    text: 'Un émetteur (radiateur, unité intérieure…) reçoit la chaleur ou le froid d’un autre équipement : il n’a pas d’énergie propre.',
    todo: ['Si c’est bien un générateur, coche la fonction « Production ».', 'Sinon, retire l’énergie choisie.'],
  },
  'DEV-003': {
    short: 'régulation désignée pour un autre équipement',
    line: 'Une ancienne saisie le désigne comme régulateur d’un autre équipement.',
    title: 'Régulation intégrée réutilisée ailleurs',
    text: 'Sa régulation est intégrée : elle ne pilote que lui. Une ancienne saisie la désigne pourtant comme régulateur d’un autre équipement.',
    todo: ['Corrige d’un clic : Buildy retire cette ancienne référence, sans toucher au reste de la fiche.'],
    fix: 'Retirer l’ancienne référence',
  },
  'DEV-004': {
    short: 'puissance inhabituelle',
    line: 'C’est souvent une confusion avec la consommation.',
    title: 'Puissance inhabituelle',
    text: 'La puissance saisie sort des valeurs habituelles pour cet usage. C’est souvent une confusion avec la consommation.',
    todo: ['Vérifie la puissance nominale, en kW, sur la plaque signalétique.'],
  },
  'DEV-005': {
    short: 'âge inhabituel',
    line: 'Plus de 60 ans : très rare pour un équipement en service.',
    title: 'Âge inhabituel',
    text: 'Plus de 60 ans, c’est très rare pour un équipement encore en service.',
    todo: ['Vérifie son âge, ou son année de mise en service.'],
  },
  'DEV-006': {
    short: 'fonction Production manquante',
    line: 'Sans elle, son énergie et sa puissance ne comptent pas.',
    title: 'Fonction Production manquante',
    text: 'Pour ce type d’équipement, la bibliothèque coche « Production ». Sans elle, son énergie et sa puissance ne comptent pas.',
    todo: ['Aligne ses fonctions sur le modèle de la bibliothèque, d’un clic.'],
    fix: 'Aligner sur le modèle',
  },
  'DEV-007': {
    short: 'générateur exclu de la GTB',
    line: 'Son raccordement à la GTB n’est pas évalué.',
    title: 'Générateur exclu de la GTB',
    text: 'Le décret demande que les générateurs communiquent avec la GTB. L’exclure n’est justifié que si un équipement raccordé le pilote.',
    todo: ['Sinon, remets « Selon l’usage » dans la fiche.'],
  },
  'DEV-008': {
    short: 'intégré à la GTB, sans communication',
    line: 'Le rapport ne peut pas conclure sur son raccordement.',
    title: 'Intégré à la GTB, sans communication',
    text: 'Ces deux réponses se contredisent : le rapport ne peut pas conclure sur son raccordement à la GTB.',
    todo: ['S’il communique, choisis le protocole, la passerelle ou les contacts pilotés.', 'Sinon, corrige la réponse « Intégré à la GTB ».'],
  },
  'THERMAL-002': {
    short: 'réglage de température contradictoire',
    line: 'L’échelle saisie contredit le type de régulation.',
    title: 'Réglage contradictoire',
    text: 'L’échelle choisie ne correspond pas au type de régulation saisi, qui règle la température par pièce ou par zone.',
    todo: ['Corrige l’échelle de la régulation, ou son type, dans la fiche.'],
  },
  'SYS-001': {
    short: 'présent et non concerné à la fois',
    line: 'Choisis l’une des deux réponses.',
    title: 'Présent et non concerné',
    text: 'Les deux réponses se contredisent : un usage est soit présent, soit non concerné.',
    todo: ['Choisis « Présent » ou « Non concerné » sur sa ligne.'],
  },
  'SYS-003': {
    short: 'règle des 5 % appliquée en partie',
    line: 'La part de 5 % se mesure sur tout le bâtiment.',
    title: 'Règle des 5 % en partie',
    text: 'La part de 5 % se mesure sur tout le bâtiment, pour une même fonction : exempter une zone et pas une autre se contredit.',
    todo: ['Exempte toutes les installations de cette fonction, ou aucune (paramètres du système).'],
  },
};
const CHECK_FALLBACK = {
  short: 'point à vérifier',
  line: 'Ce point mérite un coup d’œil avant la livraison.',
  title: 'Point à vérifier',
  text: 'Ce point mérite un coup d’œil avant la livraison.',
  todo: [],
};
export const CHECK_CODES = Object.keys(CHECKS);
export function checkText(code) {
  return CHECKS[code] || CHECK_FALLBACK;
}

/** « + 2 autres points à vérifier » (au-delà des lignes affichées en tête de zone). */
export function moreChecksLabel(n) {
  return `+ ${n} ${n > 1 ? 'autres points' : 'autre point'} à vérifier`;
}

/** Ligne en tête de zone : « À vérifier : Mono Split, puissance manquante. » + conséquence. */
export function checkLine(finding, name) {
  const c = checkText(finding.code);
  return { lead: `À vérifier : ${name}, ${c.short}.`, text: c.line };
}

const ENERGY = Object.fromEntries(ENERGY_OPTIONS.map(o => [o.value, o.label]));
const ROLE = Object.fromEntries(ROLE_OPTIONS.map(o => [o.value, o.label]));
function yesNo(v) {
  if (v === true || v === 1) return 'Oui';
  if (v === false || v === 0) return 'Non';
  return 'Sans réponse';
}

/** Valeurs saisies qui posent question, pour la carte de la fiche : [{ label, value }]. */
export function checkRows(code, device = {}, category = null) {
  const roles = Array.isArray(device.device_role) ? device.device_role : (device.device_role ? [device.device_role] : []);
  switch (code) {
    case 'DEV-001':
      return [
        { label: 'Fonctions', value: roles.map(r => ROLE[r] || r).join(', ') || 'aucune' },
        { label: 'Énergie', value: ENERGY[device.energy_source] || device.energy_source || '—' },
      ];
    case 'DEV-004':
      return [{ label: 'Puissance saisie', value: `${Number(device.power_kw || 0).toLocaleString('fr-FR')} kW` }];
    case 'DEV-005':
      return [{ label: 'Âge saisi', value: `${device.age_years} ans` }];
    case 'DEV-008':
      return [
        { label: 'Intégré à la GTB', value: yesNo(device.managed_by_bms) },
        { label: 'Communication', value: 'aucune' },
      ];
    case 'THERMAL-002': {
      const type = regulationTypesForCategory('emission', category || 'heating')
        .find(o => o.value === device.regulation_type_emission)?.label || device.regulation_type_emission;
      return [
        { label: 'Échelle saisie', value: (GRANULARITY_LABELS_FR[device.regulation_granularity] || 'Aucune').replace(/\s*\(.*\)$/, '') },
        { label: 'Type de régulation', value: type || '—' },
      ];
    }
    default:
      return [];
  }
}

/** Carte « à vérifier » d'un point (fiche, pastilles) : explication, valeurs, quoi faire. */
// ─── Puissances manquantes (pastille de l'en-tête, mise en page guidée) ───────
export function missingPowersLabel(n) {
  return plural(n, 'puissance manquante', 'puissances manquantes');
}
export function missingPowersTip(n, presumed = false) {
  return {
    title: missingPowersLabel(n),
    tone: 'warning',
    icon: 'bolt',
    text: presumed
      ? 'Sans elles, le cumul reste sous 70 kW : le bâtiment est présumé concerné tant qu’elles manquent.'
      : 'Sans elles, le cumul des puissances du site est incomplet.',
    todo: { title: 'À faire', items: ['Un clic ouvre la première fiche concernée.'] },
  };
}

// ─── Fiche en rubriques (mise en page guidée) ─────────────────────────────────
/** Titres courts des rubriques de la fiche (lib/audit-options.js DEVICE_SECTIONS). */
export const RUBRIC_TITLES = {
  identification: 'Identification',
  functions: 'Fonctions',
  regulation: 'Régulation',
  communication: 'Communication et GTB',
  metering: 'Suivi des consommations',
  state: 'État',
};
/** Rubrique de la fiche où se corrige un point « à vérifier » (null : dans une autre étape). */
export const CHECK_RUBRIC = {
  'POWER-MISSING': 'identification', 'DEV-004': 'identification', 'DEV-005': 'identification',
  'DEV-001': 'functions', 'DEV-006': 'functions', 'DEV-003': 'regulation', 'THERMAL-002': 'regulation',
  'DEV-007': 'communication', 'DEV-008': null,
};
/** Bouton d'un encadré « à vérifier » : où corriger. */
export function checkGoLabel(code) {
  if (code === 'DEV-008') return 'Corriger dans l’étape GTB';
  const rubric = CHECK_RUBRIC[code] || 'identification';
  return `Corriger dans « ${RUBRIC_TITLES[rubric]} »`;
}
export const CHECK_GO_TIPS = {
  rubric: 'Ouvrir la rubrique à corriger',
  bms: {
    title: 'Corriger dans l’étape GTB',
    icon: 'arrow-right',
    tone: 'info',
    text: 'La réponse « Intégré à la GTB » se donne à l’étape GTB, dans le bloc des équipements intégrés.',
  },
};
/** En-tête d'une rubrique de la fiche : la déplier ou la replier. */
export function rubricHeaderTip(title, { open = false } = {}) {
  return open ? 'Replier cette rubrique' : 'Déplier cette rubrique';
}
/** Bouton qui affiche toutes les rubriques, ou seulement celles où il reste à faire. */
export const RUBRICS_ALL_TIPS = {
  all: {
    title: 'Toute la fiche',
    icon: 'eye',
    tone: 'info',
    text: 'Toutes les rubriques restent dépliées, comme dans la mise en page actuelle.',
  },
  todo: {
    title: 'Le reste à faire d’abord',
    icon: 'filter',
    tone: 'info',
    text: 'Seules les rubriques où il manque une réponse, ou un point à vérifier, s’ouvrent. Les autres montrent leur résumé.',
  },
};

/** Puissance exigée et vide (production de chauffage ou de froid) : « à compléter ». */
export const POWER_REQUIRED_TIP = {
  title: 'Puissance à renseigner',
  tone: 'warning',
  icon: 'bolt',
  text: 'Cette production de chaleur ou de froid compte dans le seuil des 70 kW : sa puissance est exigée.',
  todo: {
    title: 'À faire',
    items: ['Relève la puissance nominale sur la plaque signalétique, en kW.', 'Introuvable sur place ? Coche « Puissance déclarée inconnue » dans la fiche.'],
  },
};

export function checkCardTip(finding, device = null, category = null) {
  const c = checkText(finding.code);
  return {
    title: c.title,
    tone: 'error',
    icon: 'triangle-exclamation',
    text: c.text,
    rows: device ? checkRows(finding.code, device, category) : [],
    todo: c.todo.length ? { title: 'À faire', items: c.todo } : null,
  };
}

/** Bouton de correction automatique (codes qui en ont une). */
export function checkFixLabel(code) {
  return checkText(code).fix || null;
}
export const CHECK_FIX_TIP = {
  title: 'Correction automatique',
  icon: 'wand-magic-sparkles',
  text: 'Buildy corrige seulement ce point, sans toucher au reste de la fiche.',
};

// ─── Filtre des équipements ───────────────────────────────────────────────────
export const GUIDE_FILTER_TIPS = {
  all: 'Afficher tous les équipements',
  todo: {
    title: 'À compléter',
    tone: 'warning',
    icon: 'pen',
    text: 'Une information manque : énergie, communication, une réponse Oui ou Non… Le filtre ne montre que ces équipements.',
  },
  check: {
    title: 'À vérifier',
    tone: 'error',
    icon: 'triangle-exclamation',
    text: 'C’est renseigné, mais douteux ou contradictoire : puissance absente, réponses qui se contredisent… Le filtre ne montre que ces équipements.',
  },
};
/** « 3 équipements masqués par le filtre ». */
export function hiddenByFilterText(n) {
  return `${plural(n, 'équipement masqué', 'équipements masqués')} par le filtre`;
}
export const SHOW_ALL_LABEL = 'Tout afficher';

// ─── Colonne « État » de la liste (mise en page guidée) ───────────────────────
/** Carte de l'état d'un équipement quand il a des points à vérifier. */
export function deviceChecksTip(checks = [], missingCount = 0) {
  const rows = missingCount ? [{ icon: 'pen', tone: 'warning', label: 'À compléter', value: plural(missingCount, 'information', 'informations') }] : [];
  return {
    title: plural(checks.length, 'point à vérifier', 'points à vérifier'),
    tone: 'error',
    icon: 'triangle-exclamation',
    text: 'C’est renseigné, mais douteux ou contradictoire. Ouvre la fiche pour voir quoi corriger.',
    rows,
    todo: { title: 'À vérifier', items: checks.map(f => capitalize(checkText(f.code).short)) },
  };
}
export const DEVICE_DONE_LABEL = 'Équipement complet';

// ─── Fiche (mise en page guidée) ──────────────────────────────────────────────
/** Ligne « À compléter » de la fiche : libellés courts de ce qui manque. */
export function panelMissingText(labels) {
  if (!labels.length) return '';
  return `À compléter : ${listLabels(labels, 6)}.`;
}
/** Bouton « Suivant à reprendre : … ». */
export function nextStopLabel(name) {
  return `Suivant à reprendre : ${name}`;
}
export const NEXT_STOP_TIP = {
  title: 'Point suivant',
  icon: 'route',
  text: 'Ouvre le prochain point à reprendre, dans l’ordre de l’écran, zone après zone.',
};
/** Carte du bouton « Suivant à reprendre » : son libellé complet (souvent coupé), puis l'explication. */
export function nextStopTip(name) {
  return { ...NEXT_STOP_TIP, text: `${nextStopLabel(name)}.\n${NEXT_STOP_TIP.text}` };
}
export const ALL_DONE_TEXT = 'Plus rien à reprendre dans l’étape.';
/** Raison d'un point « usage » dans le parcours (libellé du bouton suivant). */
export function stopReasonLabel(reason) {
  if (reason === 'unanswered') return 'sans réponse';
  if (reason === 'empty') return 'sans équipement';
  if (reason === 'check') return 'à vérifier';
  if (reason === 'loop') return 'bouclage à renseigner';
  return 'à compléter';
}

// ─── Synthèse des systèmes (mise en page guidée) ──────────────────────────────
/** Pastilles de totaux : [{ value, label, tone, tip }]. */
export function synthesisTotals({ incompleteDevices = 0, emptySystems = 0, toCheck = 0, unanswered = 0 }) {
  const out = [];
  const toComplete = incompleteDevices + emptySystems;
  if (toComplete) {
    out.push({
      value: toComplete,
      label: 'à compléter',
      tone: 'amber',
      tip: {
        title: 'À compléter',
        tone: 'warning',
        icon: 'pen',
        text: 'Une information manque : fiche d’équipement incomplète, ou usage présent sans équipement.',
        rows: [
          ...(incompleteDevices ? [{ label: 'Équipements incomplets', value: incompleteDevices }] : []),
          ...(emptySystems ? [{ label: 'Usages sans équipement', value: emptySystems }] : []),
        ],
      },
    });
  }
  if (toCheck) {
    out.push({
      value: toCheck,
      label: 'à vérifier',
      tone: 'rose',
      tip: { ...GUIDE_FILTER_TIPS.check, text: 'Renseigné, mais douteux ou contradictoire : puissance absente, réponses qui se contredisent… À reprendre avant la livraison.' },
    });
  }
  if (unanswered) {
    out.push({
      value: unanswered,
      label: unanswered > 1 ? 'usages sans réponse' : 'usage sans réponse',
      tone: 'dashed',
      tip: {
        title: 'Sans réponse',
        icon: 'circle-question',
        text: 'Ni « Présent » ni « Non concerné » : réponds d’un clic dans le tableau, case par case.',
      },
    });
  }
  return out;
}
export const RESUME_ALL_LABEL = 'Reprendre le parcours';
export const RESUME_ALL_TIP = {
  title: 'Reprendre le parcours',
  icon: 'route',
  text: 'Ouvre le premier point à reprendre, zone après zone. Dans la fiche, « Suivant à reprendre » passe au point d’après.',
};
export const TODO_COLUMN_TIP = {
  title: 'Reste à faire',
  icon: 'list-check',
  text: 'Ce qu’il reste à faire dans la zone : à compléter, à vérifier, sans réponse. Un clic ouvre la zone.',
};
/** Texte de la colonne « Reste à faire » d'une zone : [{ text, tone }]. */
export function zoneTodoParts(z) {
  const parts = [];
  if (z.toComplete) parts.push({ text: `${z.toComplete} à compléter`, tone: 'amber' });
  if (z.toCheck) parts.push({ text: `${z.toCheck} à vérifier`, tone: 'rose' });
  if (z.unanswered) parts.push({ text: `${z.unanswered} sans réponse`, tone: 'slate' });
  if (parts.length) return parts;
  // Zone sans usage présent (local technique…) : rien à faire, ce qui n'est pas « complet ».
  return z.present ? [{ text: 'Complet', tone: 'green' }] : [{ text: 'Rien à faire', tone: 'slate' }];
}
export const CHECK_CELL_TIP = 'Point à vérifier dans cet usage';

// ─── Ajouter un équipement (fenêtre de la mise en page guidée) ────────────────
const USAGE_OF = {
  heating: 'du chauffage',
  cooling: 'du refroidissement',
  ventilation: 'de la ventilation',
  dhw: 'de l’eau chaude sanitaire',
  lighting_indoor: 'de l’éclairage intérieur',
  lighting_outdoor: 'de l’éclairage extérieur',
  electricity_production: 'de la production photovoltaïque',
};
/** « Modèles du refroidissement » (bouton de portée de la recherche). */
export function usageModelsLabel(category) {
  return `Modèles ${USAGE_OF[category] || 'de cet usage'}`;
}
export const ALL_LIBRARY_LABEL = 'Toute la bibliothèque';
export const ADD_SCOPE_TIPS = {
  usage: 'Montrer les modèles prévus pour cet usage',
  all: 'Chercher dans toute la bibliothèque',
};
export const ADD_SEARCH_PLACEHOLDER = 'Rechercher un modèle par son nom…';
export const ADD_FREE_ENTRY_LABEL = 'Pas dans la bibliothèque ? Saisie libre';
export const ADD_FREE_ENTRY_TIP = 'Décrire l’équipement champ par champ';
export const ADD_BACK_LABEL = 'Retour à la bibliothèque';
export const ADD_TEMPLATE_TIP = 'Ajouter ce modèle et ouvrir sa fiche';
export const ADD_NO_MATCH = 'Aucun modèle ne correspond.';
/** Recherche vide dans l'usage, mais des modèles ailleurs : « Voir 3 modèles dans toute la bibliothèque ». */
export function elsewhereLabel(n) {
  return `Voir ${plural(n, 'modèle', 'modèles')} dans toute la bibliothèque`;
}

// ─── Ajouter un système (tuiles) ──────────────────────────────────────────────
/** Sous-titre d'une tuile : ce qui existe déjà dans la zone. */
export function usageTileStatus({ count = 0, notConcerned = false, other = false }) {
  if (other) return 'Hors décret BACS';
  if (notConcerned && !count) return 'Non concerné';
  if (!count) return 'Aucun';
  return `Déjà ${plural(count, 'système', 'systèmes')}`;
}
export const CREATE_SYSTEM_NAME_HINT = 'Ce nom est repris à l’étape Régulation et dans le rapport.';
export const OTHER_USAGES_TITLE = 'Autres usages, hors décret BACS';

// ─── Déplacer ou partager (recherche) ─────────────────────────────────────────
export const MOVE_SEARCH_PLACEHOLDER = 'Chercher une zone ou un usage…';
/** Case « même usage seulement ». */
export function sameUsageLabel(usageLabel) {
  return `Seulement : ${usageLabel.toLowerCase()}`;
}
export const SAME_USAGE_TIP = {
  title: 'Même catégorie d’usage',
  icon: 'filter',
  tone: 'info',
  text: 'Ne montre que les usages de cette catégorie, dans toutes les zones.',
};
export const MOVE_NO_MATCH = 'Aucun usage ne correspond à la recherche.';

// ─── Fenêtre unique « Déplacer ou partager » (maquette piste D) ───────────────
export const MOVE_SHARE_TABS = [
  { key: 'share', label: 'Partager avec d’autres usages' },
  { key: 'move', label: 'Déplacer' },
];
/** Phrase sous les onglets : ce que fait l'onglet choisi. */
export function moveShareIntro(kind, { zone = '', usage = '' } = {}) {
  if (kind === 'move') return `Choisis l’usage où ranger cet équipement : il quitte ${usage ? `« ${usage} »` : 'son usage actuel'}${zone ? ` de ${zone}` : ''}.`;
  return `Coche les usages que cet équipement dessert aussi. Il reste saisi une seule fois${zone ? `, dans ${zone}` : ''}.`;
}
/** Pied de la fenêtre : où l'équipement sert, et l'enregistrement immédiat. */
export function moveShareFooter(kind, zonesCount) {
  if (kind === 'move') return 'Le déplacement est enregistré aussitôt.';
  return `Dessert ${plural(zonesCount, 'zone', 'zones')} en tout. Chaque case cochée est enregistrée aussitôt.`;
}
