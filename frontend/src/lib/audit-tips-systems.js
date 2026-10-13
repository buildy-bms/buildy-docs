// Infobulles de l'audit BACS — étapes Systèmes et GTB (2026-10-12) : contenus des cartes
// v-tooltip des systèmes (ligne zone × usage), des équipements, du tableau de présence, de la
// GTB et de ses composants matériels. Français simple pour un lecteur qui ne connaît pas le
// décret BACS, tutoiement, article du décret en pied discret (`article`).
// Une seule source pour le bureau (SystemsSection, SystemDeviceList, DeviceEditModal,
// SystemDevicesTable, SystemsPresenceMatrix, BmsSection, BmsComponentsTable…) et le mobile
// (MobileSystemsTab, MobileBmsTab). Fonctions PURES, imports relatifs uniquement (testées par
// backend-node/test/audit-tips-systems.test.mjs). Règles : CLAUDE.md § « Infobulles (UI) ».
// Règles métier relues dans backend-node/src/lib/ (bacs-audit-power.js, bacs-gtb-scope.js,
// bacs-liability.js, buildy-cloud-preset.js, bacs-audit-action-generator.js) : rien n'est inventé.

import { plural } from './tooltip-content.js';

function capitalize(t) {
  const s = String(t || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** 12.5 → « 12,5 » (virgule décimale, espace des milliers). */
function fmtKw(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

// ── Catégories d'usage ─────────────────────────────────────────────────────────────────────

/** Nom complet des catégories d'usage (en-têtes abrégés, filtres, tableau de présence). */
export const CATEGORY_FULL_LABELS = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'Eau chaude sanitaire',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
};

const CATEGORY_ACCENT = {
  heating: 'heating',
  cooling: 'cooling',
  ventilation: 'ventilation',
  dhw: 'dhw',
  lighting_indoor: 'lighting_indoor',
  lighting_outdoor: 'lighting_outdoor',
  electricity_production: 'electricity_production',
};

/** Accent métier (couleur + icône de la carte) d'une catégorie d'usage, ou null. */
export function categoryAccent(category) {
  return CATEGORY_ACCENT[category] || null;
}

// ── Zones ──────────────────────────────────────────────────────────────────────────────────

/** Pastille « hors décret BACS » / « tech. » d'une zone technique. */
export const TECHNICAL_ZONE_TIP = {
  title: 'Zone technique',
  tone: 'neutral',
  icon: 'screwdriver-wrench',
  text: 'Le local lui-même (chaufferie, tableau électrique…) n’est pas une zone visée par le décret BACS. Ni système ni compteur n’y est ajouté d’office.',
};

/**
 * Onglet d'une zone (étape Systèmes) : nature, usages présents, puis ce qui reste à reprendre.
 * @param {{ name:string, nature?:string|null, technical?:boolean, active:number, total:number,
 *   incomplete?:number, noDevice?:number, unanswered?:number }} z
 */
export function zoneTabTip(z) {
  const rows = [];
  if (z.nature) rows.push({ icon: 'tag', label: 'Nature', value: z.nature });
  if (z.technical) rows.push({ icon: 'screwdriver-wrench', label: 'Zone technique', value: 'hors décret BACS' });
  rows.push({ icon: 'circle-check', tone: 'success', label: 'Usages présents', value: `${z.active} sur ${z.total}` });
  const items = [];
  if (z.incomplete) items.push(`Complète ${plural(z.incomplete, 'équipement incomplet', 'équipements incomplets')}`);
  if (z.noDevice) {
    items.push(z.noDevice > 1
      ? `Ajoute des équipements aux ${z.noDevice} usages présents qui n’en ont pas`
      : 'Ajoute un équipement à l’usage présent qui n’en a pas');
  }
  if (z.unanswered) items.push(`Réponds « Présent » ou « Non concerné » pour ${plural(z.unanswered, 'usage', 'usages')}`);
  return {
    title: z.name || 'Zone sans nom',
    tone: items.length ? 'warning' : 'success',
    icon: 'location-dot',
    rows,
    todo: items.length ? { title: 'Reste à faire', items } : null,
  };
}

/** « 2 actifs / 5 » (en-tête de zone hors mode étape). */
export function zoneActiveCountLabel(active, total) {
  return `${plural(active, 'usage présent', 'usages présents')} sur ${total}`;
}

/**
 * Premier onglet de l'étape Systèmes, « Synthèse des systèmes » : le tableau de présence de
 * toutes les zones, et ce qui reste à reprendre, toutes zones confondues.
 * @param {{ zones:number, incomplete?:number, noDevice?:number, unanswered?:number }} s
 */
export function systemsSynthesisTabTip({ zones = 0, incomplete = 0, noDevice = 0, unanswered = 0 } = {}) {
  const items = [];
  if (incomplete) items.push(`Complète ${plural(incomplete, 'équipement incomplet', 'équipements incomplets')}`);
  if (noDevice) {
    items.push(noDevice > 1
      ? `Ajoute des équipements aux ${noDevice} usages présents qui n’en ont pas`
      : 'Ajoute un équipement à l’usage présent qui n’en a pas');
  }
  if (unanswered) items.push(`Réponds « Présent » ou « Non concerné » pour ${plural(unanswered, 'usage', 'usages')}`);
  return {
    title: 'Synthèse des systèmes',
    tone: items.length ? 'warning' : 'success',
    icon: 'table-cells-large',
    text: 'Toutes les zones et leurs usages sur un seul tableau : présent ou non concerné, nombre d’équipements, points à reprendre.',
    rows: [{ icon: 'location-dot', label: 'Zones', value: zones }],
    todo: items.length ? { title: 'Reste à faire', items } : null,
  };
}

// ── Puissances (en-tête de l'étape Systèmes) ───────────────────────────────────────────────

export const POWER_SUMMARY_TIPS = {
  heat: {
    title: 'Puissance de chauffage',
    accent: 'heating',
    text: 'Total des puissances de chauffage des appareils de production (chaudières, pompes à chaleur…), sans les appareils de secours ni ceux hors service.',
    article: 'R175-2',
  },
  cool: {
    title: 'Puissance de refroidissement',
    accent: 'cooling',
    text: 'Total des puissances de froid des appareils de production (groupes froids, climatiseurs…), sans les appareils de secours ni ceux hors service.',
    article: 'R175-2',
  },
  retained: {
    title: 'Puissance retenue',
    tone: 'info',
    icon: 'calculator',
    text: 'La plus forte des deux : le chaud et le froid ne s’additionnent pas. Au-delà de 70 kW, le bâtiment tertiaire est concerné par le décret.',
    rows: [{ icon: 'pen', label: 'Saisie à la main', value: 'prioritaire si elle existe (étape Identification)' }],
    article: 'R175-2',
  },
  total: {
    title: 'Chauffage et climatisation',
    tone: 'info',
    icon: 'calculator',
    text: 'Puissance de chauffage et de climatisation du site. Au-delà de 70 kW, le bâtiment tertiaire est concerné par le décret.',
    article: 'R175-2',
  },
};

/** « ⚠ écart X % » : la valeur saisie à la main s'écarte du cumul des équipements. */
export function powerDiscrepancyTip({ pct, manualKw, autoKw }) {
  return {
    title: `Écart de ${pct} % sur la puissance`,
    tone: 'warning',
    text: 'La puissance saisie à la main (étape Identification) ne correspond pas au cumul calculé à partir des équipements.',
    rows: [
      { icon: 'pen', label: 'Saisie à la main', value: `${fmtKw(manualKw)} kW` },
      { icon: 'calculator', label: 'Cumul des équipements', value: `${fmtKw(autoKw)} kW` },
    ],
    todo: 'Vérifie les puissances des équipements ou la valeur saisie.',
    article: 'R175-2',
  };
}

/** « ⚠ N sans puissance » : présomption d'assujettissement tant que les puissances manquent. */
export function missingPowerTip(n) {
  return {
    title: n > 1 ? `${n} équipements sans puissance` : 'Un équipement sans puissance',
    tone: 'warning',
    text: n > 1
      ? 'Leur puissance manque et le cumul reste sous 70 kW : par prudence, le bâtiment est présumé concerné par le décret.'
      : 'Sa puissance manque et le cumul reste sous 70 kW : par prudence, le bâtiment est présumé concerné par le décret.',
    todo: n > 1 ? 'Complète leur puissance pour affiner le verdict.' : 'Complète sa puissance pour affiner le verdict.',
    article: 'R175-2',
  };
}

// ── Systèmes (ligne zone × usage) ──────────────────────────────────────────────────────────

/** Interrupteur « Présent / Non concerné » d'un système. */
export const SYSTEM_PRESENCE_TOGGLE_TIP = 'Cet usage existe-t-il dans la zone ?';

/** Badge « ⚠ Aucun équipement » : usage présent sans équipement saisi. */
export const SYSTEM_NO_DEVICE_TIP = {
  title: 'Aucun équipement saisi',
  tone: 'warning',
  text: 'Cet usage est présent, mais aucun équipement n’est décrit : le rapport, le plan d’actions et le calcul de puissance ne peuvent pas en tenir compte.',
  todo: 'Ajoute au moins un équipement : chaudière, climatisation à débit de réfrigérant variable (DRV)…',
};

/** Boutons grisés d'un usage déclaré non concerné (ou sans réponse). */
export const SYSTEM_NOT_PRESENT_TIPS = {
  settings: {
    title: 'Usage non présent',
    tone: 'neutral',
    icon: 'gear',
    text: 'Les paramètres (poste négligeable, parties responsables) ne concernent qu’un usage présent dans la zone.',
    todo: 'Réponds d’abord « Présent » pour cet usage.',
  },
  notes: {
    title: 'Usage non présent',
    tone: 'neutral',
    icon: 'note-sticky',
    text: 'Les notes se prennent sur un usage présent dans la zone.',
    todo: 'Réponds d’abord « Présent » pour cet usage.',
  },
};

/** Pastille grisée d'un usage non concerné (mode étape). */
export function notConcernedChipTip(label, hasNote = false) {
  return {
    title: label || 'Usage',
    tone: 'neutral',
    icon: 'ban',
    text: 'Usage déclaré non concerné dans cette zone : rien n’est attendu pour lui.',
    rows: hasNote ? [{ icon: 'note-sticky', label: 'Note', value: 'visible avec « Afficher en détail »' }] : [],
    todo: 'S’il existe en fait, repasse-le en « Présent » d’un clic.',
  };
}

/** Bouton « Afficher en détail » des usages non concernés. */
export const NOT_CONCERNED_EXPAND_TIP = {
  title: 'Afficher en lignes complètes',
  tone: 'info',
  icon: 'eye',
  text: 'Les usages non concernés reprennent leur ligne : tu peux les renommer, les dupliquer, les supprimer ou changer leur ordre.',
};

/** Résumé des équipements d'un système (en-tête de carte, mode étape). */
export function systemDevicesSummaryTip({ own = 0, shared = 0, kw = 0, summary = '' }) {
  const rows = [{ icon: 'cube', label: 'Équipements du système', value: own }];
  if (shared) rows.push({ icon: 'share-nodes', tone: 'success', label: 'Partagés depuis un autre système', value: shared });
  if (kw > 0) rows.push({ icon: 'bolt', label: 'Puissance de ses équipements', value: `${fmtKw(kw)} kW` });
  // Le résumé affiché (souvent coupé dans l'en-tête de la carte) est repris tel quel en tête.
  const title = plural(own + shared, 'équipement', 'équipements');
  return {
    title,
    tone: 'info',
    icon: 'cube',
    text: [
      summary && summary !== title ? summary : '',
      shared ? 'La puissance ne compte que les équipements du système : un équipement partagé compte dans son système d’origine.' : '',
    ].filter(Boolean).join('\n'),
    rows,
  };
}

/** Bouclage de l'eau chaude sanitaire (question). */
export const DHW_LOOP_TIP = {
  title: 'Bouclage de l’eau chaude',
  accent: 'dhw',
  text: 'Une boucle fait circuler l’eau chaude en permanence dans les canalisations, pour qu’elle arrive chaude au robinet.',
};

/** Bouclage de l'eau chaude sans réponse : à compléter (bloque la validation de l'étape). */
export const DHW_LOOP_MISSING_TIP = {
  title: 'Bouclage à renseigner',
  tone: 'warning',
  icon: 'faucet',
  text: 'Sans réponse, le rapport ne peut pas dire si l’eau chaude doit rester chaude en permanence.',
  todo: { title: 'À faire', items: ['Choisis « Bouclée », « Non bouclée » ou « Inconnu ».'] },
};

/** Eau chaude bouclée : point de vigilance sanitaire (backend : ecs_looped_legionella). */
export const DHW_LOOP_LEGIONELLA_TIP = {
  title: 'Risque de légionelle',
  tone: 'warning',
  icon: 'triangle-exclamation',
  text: 'En occupation, et dans les 24 heures avant, l’eau doit rester aux températures fixées par l’arrêté du 30 novembre 2005.',
  rows: [{ label: 'Arrêt possible', value: 'seulement pendant une inoccupation de plusieurs semaines, puis remise en service sanitaire' }],
};

/** « Poste négligeable (< 5 %) » : règle des 5 % de la FAQ ministérielle. */
export const NEGLIGIBLE_TIP = {
  title: 'Poste négligeable',
  tone: 'info',
  icon: 'circle-info',
  text: 'Un usage qui pèse moins de 5 % de la consommation totale peut être dispensé de raccordement à la GTB, avec une justification écrite.',
  rows: [{ label: 'Part calculée sur', value: 'tous les équipements de cet usage, dans tout le bâtiment' }],
  meta: 'FAQ BACS du ministère, n° 16',
};

/** Paramètres du système : partie assujettie calculée (⚖️). */
export const LIABILITY_TIP = {
  title: 'Partie assujettie',
  tone: 'info',
  icon: 'scale-balanced',
  text: 'Qui doit mettre ce système en conformité. Calculé d’après la structure juridique du site et ses parties prenantes.',
  article: 'R175-2',
};

/** Case « installé par ce preneur » (travaux preneurs : cas C de bacs-liability). */
export const TENANT_WORKS_TIP = {
  title: 'Installé par le preneur',
  tone: 'info',
  icon: 'key',
  text: 'Coche si ce preneur (locataire) a installé ce système lui-même : il en est alors propriétaire et devient responsable de sa mise en conformité.',
  article: 'R175-2',
};

/** Pastille « hérité de la zone » (parties rattachées automatiquement). */
export const PARTY_INHERITED_TIP = {
  title: 'Hérité de la zone',
  tone: 'success',
  icon: 'link',
  text: 'Toutes les parties prenantes du site sont rattachées automatiquement à ce système, par sa zone.',
  todo: 'Pour en retirer une, ouvre la carte « Identification » du site.',
};

/** Bouton « Ajouter » grisé de la fenêtre « Ajouter un système ». */
export function createSystemDisabledTip({ hasCategory, hasName }) {
  if (hasCategory && hasName) return null;
  const items = [];
  if (!hasCategory) items.push('Choisis une catégorie');
  if (!hasName) items.push('Donne un nom au système');
  return { title: 'Pas encore prêt', tone: 'neutral', icon: 'plus', text: 'Il faut une catégorie et un nom pour créer le système.', todo: { title: 'À faire', items } };
}

// ── Équipements : liste, colonnes, pastilles ───────────────────────────────────────────────

/** En-têtes de colonnes des équipements (liste du mode étape, tableau, bibliothèque). */
export const DEVICE_COLUMN_TIPS = {
  name: {
    title: 'Équipement',
    icon: 'cube',
    text: 'Nom, puis marque, référence, localisation et âge. « └─ » signale un équipement en aval de la production : distribution, émission ou régulation.',
  },
  roles: {
    title: 'Fonctions',
    icon: 'sliders',
    text: 'Rôle de l’équipement : produire, transporter, restituer ou piloter l’énergie.',
    rows: [
      { label: 'Prod.', value: 'production', icon: 'circle', accent: 'role_production' },
      { label: 'Distrib.', value: 'distribution', icon: 'circle', accent: 'role_distribution' },
      { label: 'Émis.', value: 'émission', icon: 'circle', accent: 'role_emission' },
      { label: 'Régul.', value: 'régulation', icon: 'circle', accent: 'role_regulation' },
    ],
  },
  power: {
    title: 'Puissance',
    icon: 'bolt',
    text: 'Puissance nominale d’un équipement de production, fois la quantité. Celle du chauffage et de la climatisation décide si le décret s’applique.',
    article: 'R175-2',
  },
  energy: {
    title: 'Énergie',
    icon: 'fire-flame-curved',
    text: 'Énergie consommée sur place par un équipement de production : gaz, électricité, réseau de chaleur, bois…',
  },
  communication: {
    title: 'Communication',
    icon: 'tower-broadcast',
    text: 'Langage utilisé pour échanger avec la GTB (Modbus, BACnet, KNX…), puis la liaison câblée vers la GTB.',
    article: 'R175-3',
  },
  regulation: {
    title: 'Régulation',
    icon: 'sliders',
    text: 'Intégrée à l’équipement ou déportée sur un régulateur séparé, puis le type de régulation.',
  },
  status: {
    title: 'État de la fiche',
    icon: 'list-check',
    text: 'Complète quand toutes les réponses utiles au rapport sont données. Tant qu’un équipement est incomplet, l’étape Systèmes ne peut pas être validée.',
  },
  quantity: {
    title: 'Quantité',
    icon: 'clone',
    text: 'Nombre d’unités identiques : la puissance compte autant de fois dans le cumul.',
    article: 'R175-2',
  },
};

/** Fonctions d'un équipement (pastilles de rôle). Textes repris de l'aide de DeviceEditModal. */
export const ROLE_TIPS = {
  production: {
    title: 'Production',
    accent: 'role_production',
    icon: 'bolt',
    text: 'Transforme une énergie (gaz, électricité, soleil, bois…) en chaleur, froid ou lumière, sur place. Son énergie et sa puissance sont à renseigner.',
    rows: [{ label: 'Exemples', value: 'chaudière, pompe à chaleur, groupe d’eau glacée' }],
  },
  distribution: {
    title: 'Distribution',
    accent: 'role_distribution',
    icon: 'right-left',
    text: 'Transporte l’eau chaude, l’eau glacée ou l’air de l’équipement de production jusqu’aux pièces.',
    rows: [{ label: 'Exemples', value: 'circuit d’eau chaude, gaines de soufflage, bouclage d’eau chaude sanitaire' }],
  },
  emission: {
    title: 'Émission',
    accent: 'role_emission',
    icon: 'temperature-half',
    text: 'Restitue dans la pièce la chaleur ou le froid produits ailleurs. Sa puissance et son énergie sont portées par l’équipement de production.',
    rows: [{ label: 'Exemples', value: 'radiateur à eau chaude, ventilo-convecteur, unité intérieure de climatisation, bouche d’air' }],
  },
  regulation: {
    title: 'Régulation',
    accent: 'role_regulation',
    icon: 'sliders',
    text: 'Pilote les autres équipements : température, présence, horaires…',
    rows: [{ label: 'Exemples', value: 'thermostat, détecteur de présence, sonde, régulateur de chaufferie' }],
  },
  autre: {
    title: 'Autre fonction',
    tone: 'neutral',
    icon: 'ellipsis',
    text: 'Fonction hors des quatre rôles habituels : production, distribution, émission, régulation.',
  },
};

/** Carte d'une fonction d'équipement ; une fonction saisie librement garde son nom. */
export function roleTip(role) {
  if (!role) return null;
  const key = String(role).toLowerCase();
  return ROLE_TIPS[key] || { title: String(role), tone: 'neutral', icon: 'tag', text: 'Fonction saisie librement.' };
}

/** « à préciser » dans la colonne Fonctions. */
export const DEVICE_ROLE_MISSING_TIP = {
  title: 'Fonction à préciser',
  tone: 'warning',
  icon: 'sliders',
  text: 'Indique si l’équipement produit, transporte, restitue ou pilote l’énergie.',
  todo: 'Ouvre sa fiche pour choisir sa ou ses fonctions.',
};

/** Étiquette d'une ligne d'équipement (liste en lecture, mode étape). */
export const DEVICE_ROW_LABEL = 'Ouvrir la fiche de l’équipement';

export const DEVICE_COMPLETE_TIP = {
  title: 'Équipement complet',
  tone: 'success',
  text: 'Toutes les réponses utiles au rapport sont renseignées.',
};

export const DEVICE_FORCED_TIP = {
  title: 'Validation forcée',
  tone: 'warning',
  icon: 'circle-check',
  text: 'Validé à la main, car certaines informations resteront inconnues : il compte comme complet pour l’étape Systèmes.',
};

/**
 * État de la fiche d'un équipement (colonne État, pastilles de la fiche, liste « à compléter »).
 * @param {string[]} missing  libellés de deviceMissingFields (lib/audit-options.js)
 * @param {{ forced?: boolean }} [opts]
 */
export function deviceStatusTip(missing = [], { forced = false } = {}) {
  const list = (missing || []).filter(Boolean).map(capitalize);
  if (forced) {
    if (!list.length) return DEVICE_FORCED_TIP;
    return { ...DEVICE_FORCED_TIP, todo: { title: 'Encore non renseigné', items: list } };
  }
  if (!list.length) return DEVICE_COMPLETE_TIP;
  return {
    title: plural(list.length, 'information à compléter', 'informations à compléter'),
    tone: 'warning',
    icon: 'list-check',
    text: 'Tant que la fiche est incomplète, l’étape Systèmes ne peut pas être validée.',
    todo: { title: 'À renseigner', items: list },
  };
}

/** Case « Forcer la validation » de la fiche équipement. */
export const FORCE_VALIDATION_TIP = {
  title: 'Forcer la validation',
  tone: 'warning',
  icon: 'circle-check',
  text: 'Quand une information restera inconnue, coche cette case : l’équipement compte alors comme complet, et l’étape Systèmes peut être validée.',
};

/** Bouclier « secours » : puissance exclue du cumul (FAQ BACS n° 8). */
export const DEVICE_BACKUP_TIP = {
  title: 'Équipement de secours',
  tone: 'warning',
  icon: 'shield-halved',
  text: 'Normalement à l’arrêt, il ne démarre qu’en cas de panne de l’équipement principal. Sa puissance ne compte pas dans le cumul.',
  meta: 'FAQ BACS du ministère, n° 8',
};

/** Pastille « Hors service ». */
export const DEVICE_OUT_OF_SERVICE_TIP = {
  title: 'Hors service',
  tone: 'error',
  icon: 'power-off',
  text: 'Équipement hors d’usage : il n’entre ni dans le plan de mise en conformité, ni dans le cumul des puissances.',
};

/** Badge « × N » : unités identiques. */
export function deviceQuantityTip(n) {
  return {
    title: `${n} unités identiques`,
    tone: 'info',
    icon: 'clone',
    text: 'Le même équipement est installé en plusieurs exemplaires : sa puissance compte autant de fois dans le cumul.',
  };
}

/** Pastille « partagé » : équipement d'un autre système affiché ici aussi. */
export function deviceSharedTip(originZone) {
  return {
    title: 'Équipement partagé',
    tone: 'success',
    icon: 'share-nodes',
    text: 'Il est rattaché à un autre système et dessert aussi celui-ci. Sa fiche est commune aux deux.',
    rows: originZone ? [{ icon: 'location-dot', label: 'Zone d’origine', value: originZone }] : [],
  };
}

/** Pastille « +N » : équipement présent aussi dans d'autres systèmes. */
export function deviceAlsoInTip(n) {
  return {
    title: n > 1 ? `Aussi dans ${n} autres systèmes` : 'Aussi dans un autre système',
    tone: 'success',
    icon: 'share-nodes',
    text: 'Cet équipement dessert aussi d’autres systèmes : il y apparaît sur fond vert.',
  };
}

/** Cellule Puissance : sans objet, inconnue ou vide. */
export function devicePowerCellTip(state) {
  if (state === 'not_applicable') {
    return {
      title: 'Puissance sans objet',
      tone: 'neutral',
      icon: 'bolt',
      text: 'Elle est portée par l’équipement de production : la compter ici la compterait deux fois.',
    };
  }
  if (state === 'unknown') return 'Puissance déclarée inconnue';
  if (state === 'empty') return 'Puissance pas encore renseignée';
  return null;
}

/** Cellule Énergie : sans objet ou vide. */
export function deviceEnergyCellTip(state) {
  if (state === 'not_applicable') {
    return {
      title: 'Énergie sans objet',
      tone: 'neutral',
      icon: 'fire-flame-curved',
      text: 'Seul un équipement de production consomme une énergie : elle se renseigne sur lui.',
    };
  }
  if (state === 'empty') return 'Énergie pas encore renseignée';
  return null;
}

/** Protocoles d'un équipement communicant (puce + « +N »). */
export function deviceProtocolsTip(list) {
  const arr = (list || []).filter(Boolean);
  if (!arr.length) return null;
  if (arr.length === 1) return `Protocole : ${arr[0]}`;
  return { title: 'Protocoles de communication', tone: 'success', icon: 'tower-broadcast', text: arr.join(', ') };
}

export const DEVICE_COMM_TIPS = {
  missing: {
    title: 'Protocole à préciser',
    tone: 'warning',
    icon: 'tower-broadcast',
    text: 'L’équipement communique, mais aucun protocole n’est choisi.',
    todo: 'Choisis au moins un protocole dans sa fiche.',
  },
  no: {
    title: 'Non communicant',
    tone: 'neutral',
    icon: 'ban',
    text: 'Sans interface de communication, l’équipement ne peut être ni piloté ni suivi à distance par la GTB.',
  },
  unknown: 'Communication pas encore renseignée',
};

/** « Câblé à la GTB » / « Non câblé à la GTB ». */
export const DEVICE_WIRED_TIPS = {
  yes: { title: 'Câblé à la GTB', tone: 'success', icon: 'link', text: 'Une liaison câblée relie l’équipement à la GTB.' },
  no: { title: 'Non câblé à la GTB', tone: 'neutral', icon: 'link-slash', text: 'Aucune liaison câblée ne relie l’équipement à la GTB.' },
};

/** Colonne Régulation : intégrée, déportée, aucune ou à préciser. */
export const DEVICE_REGULATION_TIPS = {
  integrated: {
    title: 'Régulation intégrée',
    tone: 'info',
    icon: 'sliders',
    text: 'L’équipement se règle lui-même : thermostat embarqué, régulation d’origine de la pompe à chaleur, électronique de la chaudière…',
  },
  remote: {
    title: 'Régulation déportée',
    tone: 'info',
    icon: 'sliders',
    text: 'Un régulateur séparé pilote l’équipement : régulateur de chaufferie, GTB, sonde déportée…',
  },
  none: { title: 'Sans régulation', tone: 'neutral', icon: 'ban', text: 'Rien ne règle l’équipement automatiquement : ni thermostat, ni régulateur.' },
  unknown: {
    title: 'Régulation présente',
    tone: 'info',
    icon: 'sliders',
    text: 'Intégrée à l’équipement ou déportée sur un régulateur séparé : à préciser dans sa fiche.',
  },
};

/** @param {{ none?: boolean, label?: string }} info  regulationInfo() de SystemDeviceList */
export function deviceRegulationTip(info) {
  if (!info) return null;
  if (info.none) return DEVICE_REGULATION_TIPS.none;
  if (info.label === 'Intégrée') return DEVICE_REGULATION_TIPS.integrated;
  if (info.label === 'Déportée') return DEVICE_REGULATION_TIPS.remote;
  return DEVICE_REGULATION_TIPS.unknown;
}

// ── Fiche équipement : puissance, énergie, périmètre GTB, protocoles ───────────────────────

/** « — non applicable » (puissance) : émetteur ou distributeur sans fonction Production. */
export const POWER_NOT_APPLICABLE_TIP = {
  title: 'Puissance non applicable',
  tone: 'neutral',
  icon: 'bolt',
  text: 'Elle est déjà comptée sur l’équipement de production (unité extérieure, groupe d’eau glacée, chaudière, sous-station) : la saisir ici la compterait deux fois.',
  todo: 'Pour l’activer, ajoute la fonction « Production » à l’équipement.',
  article: 'R175-2',
};

/** « — non applicable » (énergie) : seul un équipement de production a une énergie. */
export const ENERGY_NOT_APPLICABLE_TIP = {
  title: 'Énergie non applicable',
  tone: 'neutral',
  icon: 'fire-flame-curved',
  text: 'L’énergie se renseigne sur un équipement de production. Exemple : une ventilation qui consomme de l’électricité est « Production + Émission ».',
  todo: 'Pour l’activer, ajoute la fonction « Production » à l’équipement.',
};

/** Puissance d'un usage hors chauffage et climatisation : pour information. */
export const POWER_INFO_ONLY_TIP = {
  title: 'Puissance pour information',
  tone: 'neutral',
  icon: 'bolt',
  text: 'Seules les puissances de chauffage et de climatisation disent si le bâtiment est concerné par le décret (plus de 70 kW).',
  article: 'R175-2',
};

/**
 * Champ Puissance d'un équipement (tableau des équipements).
 * @param {{ category:string, unknown?:boolean }} p
 */
export function devicePowerFieldTip({ category, unknown = false }) {
  if (unknown) {
    return {
      title: 'Puissance inconnue',
      tone: 'neutral',
      icon: 'bolt',
      text: 'Déclarée inconnue : aucune indication n’est disponible sur le terrain.',
      todo: 'Pour la saisir, ouvre la fiche de l’équipement (bouton « Modifier »).',
    };
  }
  if (category === 'heating' || category === 'cooling') {
    const heat = category === 'heating';
    return {
      title: heat ? 'Puissance de chauffage' : 'Puissance de froid',
      accent: category,
      text: 'Puissance nominale : elle compte dans le cumul qui dit si le bâtiment est concerné par le décret (plus de 70 kW).',
      article: 'R175-2',
    };
  }
  if (category === 'ventilation' || category === 'dhw') {
    return {
      title: 'Puissance nominale',
      accent: category,
      text: 'Elle ne compte dans le cumul que si elle sert au chauffage ou au refroidissement (batterie chaude ou froide, par exemple).',
      article: 'R175-2',
    };
  }
  return POWER_INFO_ONLY_TIP;
}

/** Aide du « Type de calcul de puissance » (guide PROFEEL, backend bacs-audit-power.js). */
export const POWER_CALC_TIP = {
  title: 'Type de calcul de puissance',
  tone: 'info',
  icon: 'calculator',
  text: 'Comment la puissance de l’équipement entre dans le cumul. Laissé vide, il est déduit de l’usage et de l’énergie.',
  rows: [
    { label: 'Pompe à chaleur, climatisation', value: 'la plus forte des puissances chaud et froid' },
    { label: 'Chaudières', value: 'somme des puissances nominales' },
    { label: 'Effet Joule', value: 'chauffage électrique direct : somme des puissances' },
    { label: 'Sous-station de réseau de chaleur', value: 'puissance de l’échangeur' },
    { label: 'Hors cumul', value: 'appareils de secours, procédés industriels, poêle à bois…' },
  ],
  article: 'R175-2',
};

/** « Échelle de la régulation » : par pièce, par zone ou centralisée. */
export const GRANULARITY_TIP = {
  title: 'Échelle de la régulation',
  tone: 'info',
  icon: 'temperature-half',
  text: 'Pour le chauffage, la température doit être réglée automatiquement pièce par pièce, ou par zone quand c’est justifié. Une régulation centralisée ne suffit pas.',
  article: 'R175-6',
};

/** Options du périmètre GTB d'un équipement (gtb_scope_override : null / true / false). */
export const GTB_SCOPE_OPTION_TIPS = {
  default: {
    title: 'Selon l’usage',
    tone: 'info',
    icon: 'display',
    text: 'Suit les usages cochés dans « Usages traités par la GTB » (étape GTB). Un usage que la GTB ne traite pas reste à raccorder.',
  },
  yes: {
    title: 'Concerné par la GTB',
    tone: 'info',
    icon: 'link',
    text: 'L’équipement fait partie de la GTB, même si son usage n’est pas coché dans « Usages traités par la GTB ».',
  },
  no: {
    title: 'Pas à raccorder',
    tone: 'neutral',
    icon: 'link-slash',
    text: 'Pour un émetteur passif (radiateur, bouche d’air…) ou une unité extérieure pilotée par des unités intérieures raccordées. Non évalué, le rapport l’indique.',
  },
};

/** Bloc « Protocoles de communication » grisé de la fiche équipement. */
export function deviceProtocolsLockedTip(isCommunicating) {
  if (isCommunicating === true) return null;
  if (isCommunicating === false) {
    return {
      title: 'Équipement non communicant',
      tone: 'neutral',
      icon: 'ban',
      text: 'Pas de protocole à choisir : tu as répondu Non à « L’équipement est-il communicant ? ».',
    };
  }
  return {
    title: 'Protocoles pas encore disponibles',
    tone: 'neutral',
    icon: 'tower-broadcast',
    text: 'Les protocoles se choisissent pour un équipement qui communique.',
    todo: 'Réponds d’abord Oui à « L’équipement est-il communicant ? ».',
  };
}

/** Boutons grisés de la saisie manuelle d'un équipement (champs obligatoires manquants). */
export function addDeviceDisabledTip(missing = []) {
  const items = (missing || []).filter(Boolean).map(capitalize);
  if (!items.length) return null;
  return {
    title: 'Champs obligatoires manquants',
    tone: 'neutral',
    icon: 'list-check',
    text: 'L’équipement peut être ajouté dès que ces champs sont remplis.',
    todo: { title: 'À renseigner', items },
  };
}

/** Bibliothèque : modèle déjà ajouté à ce système (bouton « Déjà ajouté » grisé). */
export const TEMPLATE_ALREADY_ADDED_TIP = {
  title: 'Modèle déjà ajouté',
  tone: 'neutral',
  icon: 'circle-check',
  text: 'Un modèle de la bibliothèque ne s’ajoute qu’une fois par système.',
  todo: 'Pour plusieurs unités identiques, renseigne la quantité dans la fiche de l’équipement.',
};

// ── Tableau de présence des usages (zones × usages) ────────────────────────────────────────

/** Interrupteur ✓ / ✗ d'une case. */
export const PRESENCE_TOGGLE_TIP = 'Choisir présent (✓) ou non concerné (✗)';

/** Bouton du nom de zone. */
export const PRESENCE_ZONE_LABEL = 'Afficher le détail de cette zone';

/** Colonne « Autres » : usages hors décret saisis à la main. */
export const PRESENCE_OTHER_COLUMN_TIP = {
  title: 'Autres usages',
  tone: 'neutral',
  icon: 'ellipsis',
  text: 'Usages hors décret BACS ajoutés à la main : bornes de recharge, procédés…',
};

/** Légende du tableau (masquée sous 1280 px : ouverte par un ⓘ). */
export const PRESENCE_LEGEND_TIP = {
  title: 'Lire le tableau',
  tone: 'info',
  icon: 'table-cells-large',
  text: 'Le nombre compte les équipements de l’usage ; un clic ouvre cet usage dans la liste.',
  rows: [
    { icon: 'check', tone: 'success', label: '✓', value: 'usage présent' },
    { icon: 'xmark', label: '✗', value: 'non concerné' },
    { icon: 'triangle-exclamation', tone: 'warning', label: 'Point orange', value: 'à reprendre' },
    { icon: 'plus', label: '+', value: 'usage absent : un clic l’ajoute' },
  ],
};

/** « N sans réponse » (en-tête du tableau). */
export function presenceUnansweredTip(n) {
  return {
    title: n > 1 ? `${n} usages sans réponse` : 'Un usage sans réponse',
    tone: 'warning',
    icon: 'circle-question',
    text: 'Ni « Présent » ni « Non concerné » n’a été choisi.',
    todo: 'Réponds avec ✓ ou ✗ dans le tableau.',
  };
}

/** « N à reprendre » (en-tête du tableau). */
export function presenceToFixTip(n) {
  return {
    title: n > 1 ? `${n} cases à reprendre` : 'Une case à reprendre',
    tone: 'warning',
    icon: 'triangle-exclamation',
    text: 'Usage présent sans équipement, ou équipement incomplet : repère le point orange.',
  };
}

/**
 * Case d'un usage dans une zone : réponse, équipements, ce qui reste à reprendre.
 * @param {{ zone:string, usage:string, category?:string, kind:'single'|'multi', state?:boolean|null,
 *   systems?:number, count?:number, withoutDevice?:number, incomplete?:number, unanswered?:number }} c
 */
export function presenceCellTip(c) {
  const rows = [];
  if (c.kind === 'single') {
    rows.push(c.state === true
      ? { icon: 'check', tone: 'success', label: 'Réponse', value: 'présent' }
      : c.state === false
        ? { icon: 'xmark', label: 'Réponse', value: 'non concerné' }
        : { icon: 'circle-question', tone: 'warning', label: 'Réponse', value: 'à donner' });
  } else if ((c.systems || 0) > 1) {
    rows.push({ icon: 'layer-group', label: 'Systèmes', value: c.systems });
  }
  if (c.count) rows.push({ icon: 'cube', label: 'Équipements', value: c.count });
  if (c.withoutDevice) rows.push({ icon: 'triangle-exclamation', tone: 'warning', label: 'Systèmes sans équipement', value: c.withoutDevice });
  if (c.incomplete) rows.push({ icon: 'list-check', tone: 'warning', label: 'Équipements incomplets', value: c.incomplete });
  const items = [];
  if (c.kind === 'single' && c.state == null) items.push('Réponds avec ✓ ou ✗');
  if ((c.systems || 0) > 1 && c.unanswered) items.push('Plusieurs systèmes : indique « Présent » ou « Non concerné » dans la liste de la zone');
  if (c.withoutDevice) items.push('Ajoute au moins un équipement');
  if (c.incomplete) items.push('Complète les fiches incomplètes');
  const accent = categoryAccent(c.category);
  return {
    title: `${c.zone} · ${c.usage}`,
    accent: accent || undefined,
    tone: items.length ? 'warning' : 'neutral',
    icon: accent ? undefined : 'ellipsis',
    rows,
    todo: items.length ? { title: 'Reste à faire', items } : null,
    meta: 'Un clic ouvre cet usage dans la liste',
  };
}

/** Case « + » : usage absent de la zone, un clic ouvre « Ajouter un système ». */
export function presenceAddTip({ zone, usage, technical = false }) {
  // Zone technique : hors décret, rien n'est exigé (pas d'« À faire », qui laisserait croire
  // à une obligation).
  if (technical) {
    return {
      title: 'Usage absent de la zone',
      tone: 'neutral',
      icon: 'plus',
      text: `Pas d’usage « ${usage} » dans « ${zone} ». Zone technique, hors décret BACS : rien n’est exigé.`,
      rows: [{ icon: 'plus', label: 'S’il existe quand même', value: 'ajoute-le avec « + »' }],
    };
  }
  return {
    title: 'Usage absent de la zone',
    tone: 'neutral',
    icon: 'plus',
    text: `Pas d’usage « ${usage} » dans « ${zone} ».`,
    todo: 'S’il existe, ajoute-le d’un clic sur « + ».',
  };
}

// ── GTB : offre Buildy Cloud, colonnes « Intégré » / « Opérationnel » ──────────────────────

// Contenu des niveaux d'offre, d'après backend-node/src/lib/buildy-cloud-preset.js (réserves,
// maintenance, transmission) et le tableau des offres Buildy 2026 (durées d'historique).
const BMS_LEVEL_TIPS = {
  essentials: {
    title: 'Buildy Cloud Essentials',
    tone: 'info',
    icon: 'display',
    text: 'Conforme au décret, sous réserves ajoutées au plan d’actions.',
    rows: [
      { icon: 'clock-rotate-left', label: 'Historique mensuel', value: '12 mois' },
      { icon: 'triangle-exclamation', label: 'Dérives', value: 'console d’alarmes multi-sites' },
      { icon: 'screwdriver-wrench', label: 'Maintenance de la GTB', value: 'non incluse' },
      { icon: 'eye', label: 'Accès aux données', value: 'portail Hyperveez et exports CSV' },
    ],
    todo: {
      title: 'Réserves',
      items: ['Exporter régulièrement les données pour les garder 5 ans', 'Organiser la maintenance de la GTB, si aucune n’est en place'],
    },
  },
  smart: {
    title: 'Buildy Cloud Smart',
    tone: 'success',
    icon: 'display',
    text: 'Conforme au décret, sans réserve liée au niveau d’offre.',
    rows: [
      { icon: 'clock-rotate-left', label: 'Historique mensuel', value: '5 ans' },
      { icon: 'triangle-exclamation', label: 'Dérives', value: 'seuils, notifications, tableaux de bord mensuels et annuels' },
      { icon: 'screwdriver-wrench', label: 'Maintenance de la GTB', value: 'incluse, par Buildy' },
      { icon: 'eye', label: 'Accès aux données', value: 'portail Hyperveez et exports CSV' },
    ],
  },
  premium: {
    title: 'Buildy Cloud Premium',
    tone: 'success',
    icon: 'display',
    text: 'Conforme au décret, sans réserve liée au niveau d’offre.',
    rows: [
      { icon: 'clock-rotate-left', label: 'Historique mensuel', value: '10 ans' },
      { icon: 'triangle-exclamation', label: 'Dérives', value: 'seuils, notifications, tableaux de bord mensuels et annuels' },
      { icon: 'screwdriver-wrench', label: 'Maintenance de la GTB', value: 'incluse, par Buildy' },
      { icon: 'paper-plane', label: 'Envoi aux exploitants', value: 'automatique, par l’API Buildy Connect (sur devis)' },
    ],
  },
};

/** Bouton d'un niveau d'offre Buildy Cloud (Essentials / Smart / Premium). */
export function bmsLevelTip(level) {
  const tip = BMS_LEVEL_TIPS[level];
  if (!tip) return null;
  return { ...tip, meta: 'Un clic pré-remplit la carte GTB pour ce niveau · formation de l’exploitant à attester' };
}

/** Réponse verrouillée : elle découle du niveau d'offre Buildy choisi. */
export const BMS_LEVEL_LOCK_TIP = {
  title: 'Fixé par l’offre Buildy',
  tone: 'neutral',
  icon: 'lock',
  text: 'Cette réponse découle du niveau d’offre Buildy Cloud choisi plus haut.',
  todo: 'Pour la modifier, réponds Non à « La GTB en place est-elle une supervision Buildy ? ».',
};

/** En-têtes des tableaux « Équipements / Compteurs intégrés à la GTB ». */
export const BMS_COLUMN_TIPS = {
  integratedDevice: {
    title: 'Intégré à la GTB',
    tone: 'info',
    icon: 'display',
    text: 'L’équipement est raccordé à la GTB, qui reçoit ses données.',
  },
  operationalDevice: {
    title: 'Opérationnel',
    tone: 'success',
    icon: 'circle-check',
    text: 'Vérifié sur place : la GTB voit l’équipement et ses valeurs remontent correctement.',
    rows: [{ icon: 'triangle-exclamation', tone: 'warning', label: 'Non', value: 'le plan propose de rétablir la liaison' }],
  },
  integratedMeter: {
    title: 'Intégré à la GTB',
    tone: 'info',
    icon: 'gauge',
    text: 'Le compteur est raccordé à la GTB, qui relève ses index.',
  },
  operationalMeter: {
    title: 'Opérationnel',
    tone: 'success',
    icon: 'circle-check',
    text: 'Vérifié sur place : la GTB relève bien le compteur et ses index remontent.',
    rows: [{ icon: 'triangle-exclamation', tone: 'warning', label: 'Non', value: 'le plan propose de rétablir la liaison' }],
  },
};

/** Interrupteur « Intégré » (question). */
export const BMS_INTEGRATED_TOGGLE_TIP = 'Intégré à la GTB ?';

/** Pastilles d'état reprises des étapes Systèmes et Compteurs. */
export const BMS_STATUS_TIPS = {
  deviceOutOfService: {
    title: 'Équipement hors service',
    tone: 'error',
    icon: 'power-off',
    text: 'Déclaré hors service à l’étape Systèmes : il peut avoir été intégré, mais il ne peut pas être opérationnel dans la GTB.',
  },
  meterOutOfService: {
    title: 'Compteur hors service',
    tone: 'error',
    icon: 'power-off',
    text: 'Déclaré hors service à l’étape Compteurs : il peut avoir été intégré, mais il ne peut pas être opérationnel dans la GTB.',
  },
  meterNotCommunicating: {
    title: 'Compteur non communicant',
    tone: 'neutral',
    icon: 'ban',
    text: 'Déclaré non communicant à l’étape Compteurs : il ne peut pas être intégré à la GTB.',
  },
};

/** Interrupteur « Intégré » d'un compteur : grisé tant qu'il n'est pas communicant. */
export function bmsMeterIntegratedTip(communicating) {
  if (communicating == null) {
    return {
      title: 'Communication à renseigner',
      tone: 'warning',
      icon: 'tower-broadcast',
      text: 'Un compteur ne peut être intégré à la GTB que s’il communique.',
      todo: 'Indique d’abord à l’étape Compteurs s’il est communicant.',
    };
  }
  if (communicating === false || communicating === 0) return BMS_STATUS_TIPS.meterNotCommunicating;
  return 'Compteur intégré à la GTB ?';
}

/**
 * Interrupteur « Opérationnel » : raison du grisé, ou la question à vérifier sur place.
 * @param {{ kind?: 'device'|'meter', integrated:any, outOfService:any, wired:any }} p
 */
export function bmsOperationalTip({ kind = 'device', integrated, outOfService, wired }) {
  const meter = kind === 'meter';
  if (!integrated) {
    return {
      title: 'Pas encore intégré',
      tone: 'neutral',
      icon: 'display',
      text: meter ? 'Le bon fonctionnement se vérifie sur un compteur intégré à la GTB.' : 'Le bon fonctionnement se vérifie sur un équipement intégré à la GTB.',
      todo: 'Réponds d’abord Oui à « Intégré ».',
    };
  }
  if (outOfService) return meter ? BMS_STATUS_TIPS.meterOutOfService : BMS_STATUS_TIPS.deviceOutOfService;
  if (wired == null) {
    return {
      title: 'Câblage à renseigner',
      tone: 'warning',
      icon: 'link',
      text: meter ? 'On ne sait pas encore si ce compteur est câblé à la GTB.' : 'On ne sait pas encore si cet équipement est câblé à la GTB.',
      todo: meter ? 'Réponds à « Câblé » à l’étape Compteurs.' : 'Réponds à la question de la liaison câblée dans sa fiche (étape Systèmes).',
    };
  }
  if (!wired) {
    return {
      title: meter ? 'Compteur non câblé' : 'Équipement non câblé',
      tone: 'neutral',
      icon: 'link-slash',
      text: 'Sans liaison câblée vers la GTB, il ne peut pas y être opérationnel.',
      todo: meter ? 'Si c’est une erreur, corrige « Câblé » à l’étape Compteurs.' : 'Si c’est une erreur, corrige la liaison câblée dans sa fiche (étape Systèmes).',
    };
  }
  return {
    title: 'Opérationnel dans la GTB ?',
    tone: 'info',
    icon: 'circle-check',
    text: meter
      ? 'Réponds Oui après avoir vérifié sur place que la GTB relève bien le compteur et que ses index remontent.'
      : 'Réponds Oui après avoir vérifié sur place que la GTB voit l’équipement et que ses valeurs remontent.',
  };
}

/** Note « vérifié système par système » du bloc des capacités de la GTB. */
export const BMS_SYSTEM_LEVEL_CHECKS_TIP = {
  title: 'Vérifié équipement par équipement',
  tone: 'info',
  icon: 'list-check',
  text: 'Le dialogue avec les équipements, l’arrêt à la main et le fonctionnement sans la GTB se vérifient équipement par équipement, à l’étape Systèmes.',
  article: 'R175-3',
};

/** Cartes « usages traités par la GTB » (bouton à cocher). */
export function bmsUsageToggleLabel(active) {
  return active ? 'Décocher : usage non traité par la GTB' : 'Cocher : usage traité par la GTB';
}

// ── Composants matériels de la GTB ─────────────────────────────────────────────────────────

/** Boutons « + Passerelle / Automate / Contrôleur / Autre ». */
export const BMS_COMPONENT_ADD_TIPS = {
  gateway: {
    title: 'Ajouter une passerelle',
    tone: 'info',
    icon: 'plus',
    text: 'Boîtier qui traduit les langages des équipements pour la GTB, par exemple un Niagara JACE.',
  },
  plc: {
    title: 'Ajouter un automate',
    tone: 'info',
    icon: 'plus',
    text: 'Automate programmable qui pilote des équipements, par exemple un Schneider M340.',
  },
  controller: {
    title: 'Ajouter un contrôleur',
    tone: 'info',
    icon: 'plus',
    text: 'Régulateur qui pilote un équipement ou une zone, par exemple un contrôleur Distech.',
  },
  other: {
    title: 'Ajouter un autre composant',
    tone: 'info',
    icon: 'plus',
    text: 'Module d’entrées et sorties, routeur, commutateur réseau, serveur de supervision… Choisis ensuite son type dans la liste.',
  },
};

/** En-têtes techniques du tableau des composants. */
export const BMS_COMPONENT_COLUMN_TIPS = {
  address: {
    title: 'Adresse',
    tone: 'info',
    icon: 'location-dot',
    text: 'Adresse IP du composant sur le réseau (ex. 192.168.1.10), ou son adresse sur le bus.',
  },
  protocols: {
    title: 'Protocoles exposés',
    tone: 'info',
    icon: 'tower-broadcast',
    text: 'Langages que le composant met à disposition pour partager ses données : BACnet, Modbus, MQTT…',
  },
  firmware: {
    title: 'Micrologiciel',
    tone: 'info',
    icon: 'tag',
    text: 'Version du logiciel embarqué dans le composant, relevée sur son interface ou son étiquette.',
  },
};
