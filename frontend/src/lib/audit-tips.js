// Infobulles de l'audit BACS (2026-10-12) : contenus des cartes v-tooltip, en français simple
// (lecteurs qui ne connaissent pas le décret), tutoiement, article du décret en pied discret.
// Une seule source pour le bureau et le mobile. Fonctions PURES, imports relatifs uniquement
// (testées par backend-node/test/audit-tips.test.mjs, qui applique aussi les règles de
// rédaction du lint). Règles : CLAUDE.md § « Infobulles (UI) ».

// ── Étapes de l'audit (onglets) ────────────────────────────────────────────────────────────

function formatWhen(v) {
  if (!v) return '';
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Carte d'un onglet d'étape : objectif en clair, puis l'état (validée, prête, reste à faire).
 * @param {{ number:number, label:string, objective?:string, disabled?:boolean, disabledReason?:string,
 *   validated?:boolean, validated_at?:string, validated_by_name?:string, with_pending?:boolean,
 *   complete?:boolean, incompleteReasons?:string[] }} s
 * @param {string|null} phaseKey  site | equipment | supervision | dossier (couleur de la phase)
 */
export function stepTip(s, phaseKey = null) {
  const title = `${s.number}. ${s.label}`;
  if (s.disabled) {
    return { title, tone: 'neutral', icon: 'ban', text: s.disabledReason || 'Sans objet pour cet audit.', placement: 'bottom' };
  }
  const tip = { title, accent: phaseKey || undefined, text: s.objective || '', placement: 'bottom' };
  if (s.validated) {
    const when = formatWhen(s.validated_at);
    tip.tone = 'success';
    tip.rows = [{
      icon: 'circle-check',
      tone: 'success',
      label: 'Validée',
      value: [when, s.validated_by_name].filter(Boolean).join(' · ') || 'oui',
    }];
    if (s.with_pending) tip.todo = { title: 'Encore en attente', items: ['Des éléments restent à compléter : l’étape a été validée quand même.'] };
    return tip;
  }
  if (s.complete) {
    tip.tone = 'success';
    tip.todo = { title: 'Prête à valider', items: ['Tout est renseigné : tu peux valider l’étape.'] };
    return tip;
  }
  const reasons = s.incompleteReasons || [];
  if (reasons.length) {
    tip.tone = 'warning';
    tip.todo = { title: 'Reste à faire', items: reasons.map(capitalize) };
  }
  return tip;
}

function capitalize(t) {
  const s = String(t || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Phases de l'audit (lib/audit-steps-ui.js AUDIT_PHASES) : ce que chacune regroupe.
const PHASE_TEXT = {
  site: 'Le site : est-il concerné par le décret ? Puis son découpage en zones.',
  equipment: 'Ce qui chauffe, refroidit, ventile et éclaire, la régulation de la température et les compteurs.',
  supervision: 'La GTB : ce qu’elle sait faire, son entretien et ses inspections.',
  dossier: 'Les pièces du dossier, les accès, le plan d’actions et la note de synthèse.',
};

/** Pastille de phase (bandeau guide). @param {{ key:string, label:string }} phase */
export function phaseTip(phase) {
  if (!phase) return null;
  return { title: `Phase « ${phase.label} »`, accent: phase.key, text: PHASE_TEXT[phase.key] || '' };
}

export const NON_BLOCKING_STEP_TIP = {
  title: 'Étape non bloquante',
  tone: 'info',
  icon: 'circle-info',
  text: 'Tu peux la valider même s’il reste des éléments en attente, puis compléter plus tard : documents et photos arrivent souvent après la visite.',
};

export const REOPEN_STEP_TIP = {
  title: 'Rouvrir l’étape',
  tone: 'info',
  icon: 'rotate-left',
  text: 'Annule la validation pour pouvoir modifier l’étape. Une raison te sera demandée.',
  placement: 'bottom',
};

/** Bouton « Valider l'étape » d'une étape bloquante pas encore complète : ce qui manque. */
export function stepNotValidableTip(step) {
  if (!step || step.validated || step.complete || !step.blocking) return null;
  const reasons = step.incompleteReasons || [];
  return {
    title: 'Pas encore validable',
    tone: 'warning',
    text: 'Il manque des informations essentielles pour cette étape.',
    todo: reasons.length ? { title: 'Reste à faire', items: reasons.map(capitalize) } : null,
    placement: 'bottom',
  };
}

// ── Compteurs ──────────────────────────────────────────────────────────────────────────────

const USAGE_ACCENT = { heating: 'heating', cooling: 'cooling', ventilation: 'ventilation', dhw: 'dhw', lighting: 'lighting', pv: 'pv', other: 'other' };

/** Compteur requis absent (⚠ rouge) : ce qui manque et ce que fait le plan. */
export const METER_MISSING_TIP = {
  title: 'Compteur requis absent',
  tone: 'error',
  text: 'Ce compteur est attendu pour suivre la consommation de cet usage dans cette zone, mais il n’existe pas sur le site.',
  todo: 'Le plan de mise en conformité propose de l’installer.',
  article: 'R175-3',
};

/** Compteur requis dont la présence n'est pas encore vérifiée (« ? » ambre). */
export const METER_UNANSWERED_TIP = {
  title: 'Présence à vérifier',
  tone: 'warning',
  text: 'Personne n’a encore dit si ce compteur existe sur le site. Le rapport l’indiquera « à qualifier ».',
  todo: 'Réponds Oui ou Non dans la colonne Présent.',
};

/** Pastilles de synthèse (en-tête d'une énergie, chiffres clés de l'étape). */
export function metersMissingTip(n) {
  return {
    title: n > 1 ? `${n} compteurs requis absents` : 'Compteur requis absent',
    tone: 'error',
    text: 'Ces compteurs sont attendus mais n’existent pas sur le site. Chacun devient une action du plan de mise en conformité.',
    article: 'R175-3',
  };
}
export function metersUnansweredTip(n) {
  return {
    title: n > 1 ? `${n} présences à vérifier` : 'Présence à vérifier',
    tone: 'warning',
    text: 'Compteurs attendus dont on ne sait pas encore s’ils existent sur le site. Le rapport les indiquera « à qualifier ».',
    todo: 'Réponds Oui ou Non dans la colonne Présent.',
  };
}
export function metersPresentTip(n) {
  return { title: n > 1 ? `${n} compteurs présents` : `${n} compteur présent`, tone: 'success', text: 'Compteurs dont la présence sur le site a été vérifiée.' };
}
export function metersCommunicatingTip(n) {
  return {
    title: n > 1 ? `${n} compteurs communicants` : `${n} compteur communicant`,
    tone: 'info',
    icon: 'tower-broadcast',
    text: 'Compteurs capables d’envoyer leurs relevés à distance, par exemple à la GTB.',
  };
}

/** Onglet d'une énergie dans l'étape Compteurs. */
// Nom d'un groupe de compteurs par énergie, accordé (« compteurs électriques », « de gaz »).
const ENERGY_METER_NAMES = {
  electric: ['compteur électrique', 'Compteurs électriques'],
  gas: ['compteur de gaz', 'Compteurs de gaz'],
  thermal: ['compteur thermique', 'Compteurs thermiques'],
  electric_production: ['compteur de production électrique', 'Compteurs de production électrique'],
  water: ['compteur d’eau', 'Compteurs d’eau'],
};

export function energyTabTip({ value, label, total, present, missing, unanswered }) {
  const [one, many] = ENERGY_METER_NAMES[value] || [`compteur ${String(label).toLowerCase()}`, `Compteurs ${String(label).toLowerCase()}`];
  if (!total) {
    return { label: `Aucun ${one} : ouvrir pour en ajouter un` };
  }
  const rows = [{ icon: 'gauge', label: 'Compteurs', value: total }, { icon: 'circle-check', tone: 'success', label: 'Présents', value: present }];
  if (missing) rows.push({ icon: 'triangle-exclamation', tone: 'error', label: 'Requis absents', value: missing });
  if (unanswered) rows.push({ icon: 'circle-question', tone: 'warning', label: 'Présences à vérifier', value: unanswered });
  return {
    title: many,
    tone: missing ? 'error' : unanswered ? 'warning' : 'info',
    accent: value === 'electric_production' ? 'electric_production' : value,
    icon: 'gauge',
    rows,
  };
}

/** Aide des colonnes du tableau des compteurs (en-têtes). */
export const METER_COLUMN_TIPS = {
  usage: {
    title: 'Usage mesuré',
    text: 'Ce que mesure le compteur dans la zone : chauffage, froid, ventilation, eau chaude sanitaire, éclairage… La ligne en dessous cite les équipements concernés.',
  },
  zone: { title: 'Zone', text: 'Zone dont le compteur mesure la consommation. « Compteur général » : tout le bâtiment.' },
  required: {
    title: 'Compteur requis',
    text: 'Déduit des systèmes et équipements saisis : un compteur par énergie pour le bâtiment, puis, dans chaque zone, un par usage relié à la GTB.',
    rows: [
      { label: 'Commun', value: 'un seul compteur pour des zones regroupées' },
      { label: 'Non requis', value: 'usage dispensé' },
    ],
    article: 'R175-3',
  },
  present: { title: 'Présent sur le site', text: 'Le compteur existe-t-il ? Sans réponse, le rapport l’indique « à qualifier ».' },
  location: { title: 'Localisation', text: 'Local où le compteur est installé : tableau électrique, chaufferie, local technique…' },
  communicating: { title: 'Communicant', text: 'Le compteur peut-il envoyer ses relevés à distance ? Sinon, un relevé à la main reste nécessaire.' },
  protocols: { title: 'Protocoles', text: 'Langage utilisé par le compteur pour transmettre ses relevés : Modbus, M-Bus, BACnet, impulsions…' },
  wired: { title: 'Câblé à la GTB', text: 'Le compteur est-il raccordé à la GTB, qui lit ses relevés automatiquement ?' },
  outOfService: {
    title: 'Hors service',
    tone: 'warning',
    text: 'Un compteur en panne ne mesure plus rien. S’il est requis, le plan d’action propose de le réparer ou de le remplacer.',
  },
};

/** Libellés des interrupteurs Oui / Non d'une ligne de compteur (questions). */
export const METER_TOGGLE_TIPS = {
  required: 'Compteur requis ?',
  present: 'Compteur présent sur le site ?',
  communicating: 'Compteur communicant ?',
  wired: 'Câblé à la GTB ?',
  outOfService: 'Compteur hors service ?',
};

/** « Requis » calculé (audit BACS) : pourquoi la case n'est pas modifiable. */
export const REQUIRED_LOCKED_CARD = {
  title: 'Calculé automatiquement',
  tone: 'neutral',
  icon: 'calculator',
  text: 'Déduit des systèmes et équipements saisis. Pour le changer, corrige l’étape Systèmes.',
  article: 'R175-3',
};

/** Sans objet tant que le compteur n'est pas présent (tirets des colonnes). */
export const METER_NOT_PRESENT_LABEL = 'Sans objet : compteur absent du site';
/** Énergie sans aucun compteur (liste des énergies, iPhone) : ligne grisée. */
export const NO_METER_ENERGY_TIP = {
  title: 'Aucun compteur',
  tone: 'neutral',
  icon: 'gauge',
  text: 'Aucun compteur de cette énergie n’est saisi pour ce site.',
  todo: 'Pour en ajouter un, touche « Ajouter un compteur » sous la liste.',
};
export const PROTOCOLS_DISABLED_LABEL = 'Réponds d’abord Oui à « Communicant »';

/** Calorimètre / frigorimètre : compteurs d'énergie thermique. */
export function thermalMeterTip(name, usage) {
  if (name === 'Frigorimètre') {
    return { title: 'Frigorimètre', accent: 'cooling', text: 'Compteur qui mesure le froid fourni par un réseau d’eau glacée (climatisation).' };
  }
  if (name === 'Calorimètre') {
    return {
      title: 'Calorimètre',
      accent: usage === 'dhw' ? 'dhw' : 'heating',
      text: 'Compteur qui mesure la chaleur fournie par un réseau d’eau chaude (chauffage, eau chaude sanitaire).',
    };
  }
  return null;
}

/** Pastille d'usage d'un compteur : nom complet des abréviations seulement. */
// Nom complet d'une abréviation = étiquette ; explication = carte (une étiquette longue passait
// sur deux lignes sur iPhone).
export const METER_USAGE_PILL_TIPS = {
  dhw: 'Eau chaude sanitaire',
  pv: { title: 'Production photovoltaïque', accent: 'pv', text: 'Électricité produite sur le site par des panneaux solaires.' },
  other: { title: 'Compteur général', accent: 'other', text: 'Il mesure toute la consommation de cette énergie sur le site.' },
  cooling: 'Refroidissement (climatisation)',
};

/** Pastille de type de compteur : explication des types moins évidents. */
export const METER_TYPE_PILL_TIPS = {
  electric_production: { title: 'Production d’électricité', accent: 'electric_production', text: 'Électricité produite sur le site, par exemple par des panneaux solaires.' },
  thermal: { title: 'Énergie thermique', accent: 'thermal', text: 'Chaleur ou froid fournis par un réseau d’eau, mesurés par un calorimètre ou un frigorimètre.' },
};

/** Ordre figé quand les compteurs sont regroupés (poignée de glisser-déposer). */
export function meterDragTip(dragEnabled) {
  if (dragEnabled) return 'Glisser pour changer l’ordre';
  return {
    title: 'Ordre figé',
    tone: 'neutral',
    icon: 'grip-vertical',
    text: 'Le glisser-déposer marche seulement sans regroupement.',
    todo: 'Choisis « Grouper : Aucun » au-dessus du tableau.',
  };
}

/** Accent métier d'un usage de compteur (couleur des cartes). */
export function meterUsageAccent(usage) {
  return USAGE_ACCENT[usage] || null;
}

// Icônes citées par ce module (enregistrées par lib/tooltip-icons.js, cf. test).
export const AUDIT_TIP_ICONS = ['ban', 'circle-check', 'gauge', 'triangle-exclamation', 'circle-question', 'calculator', 'grip-vertical', 'tower-broadcast'];
