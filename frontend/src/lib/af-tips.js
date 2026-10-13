// Infobulles des analyses fonctionnelles (AF) et de la liste des documents (2026-10-12) :
// contenus des cartes v-tooltip, en français simple (lecteurs qui ne connaissent ni le décret
// BACS ni le jargon GTB), tutoiement, article du décret en pied discret. Fonctions PURES,
// imports relatifs uniquement (testées par backend-node/test/af-tips.test.mjs, qui applique
// aussi les règles de rédaction du lint). Règles : CLAUDE.md § « Infobulles (UI) ».
//
// Sources (rien n'est inventé) : cycle de vie et transitions (routes/afs.js), niveau requis
// (routes/afs.js required-level + lib/service-level-resolver.js), offres (docs/offres-buildy-
// 2026-ia.pdf + lib/buildy-offer.js), légende de la liste de points (templates/pdf/points-list.hbs),
// textes déjà présents dans les écrans (CycleBandeau, TemplatePropagationBanner…).

import { plural } from './tooltip-content.js';
import { decreePlain, normalizeArticle } from './decree-plain.js';

// ── Cycle de vie d'une AF (StatusBadge, CycleBandeau) ─────────────────────────────────────

export const AF_PHASES = ['redaction', 'validee', 'commissioning', 'commissioned', 'livree'];

export const AF_PHASE_LABELS = {
  redaction: 'Rédaction en cours',
  validee: 'Validée',
  commissioning: 'Commissionnement en cours',
  commissioned: 'Commissionnée',
  livree: 'Projet livré',
};

const STATUS_CARDS = {
  redaction: {
    title: 'Rédaction en cours',
    tone: 'neutral',
    icon: 'pen',
    text: 'L’analyse fonctionnelle est en cours d’écriture : toutes les sections restent modifiables.',
  },
  validee: {
    title: 'Analyse validée',
    tone: 'info',
    icon: 'circle-check',
    text: 'Une version datée a été figée, avec son PDF. Tu peux encore modifier l’analyse : chaque changement est tracé.',
  },
  commissioning: {
    title: 'Mise en service en cours',
    tone: 'info',
    icon: 'screwdriver-wrench',
    text: 'Phase de commissionnement : la GTB et ses équipements sont réglés et testés sur le chantier.',
  },
  commissioned: {
    title: 'Mise en service terminée',
    tone: 'info',
    icon: 'list-check',
    text: 'Commissionnement fait : la GTB fonctionne. Il reste à livrer le dossier des ouvrages exécutés (DOE).',
  },
  livree: {
    title: 'Projet livré',
    tone: 'success',
    icon: 'truck',
    text: 'Le dossier des ouvrages exécutés (DOE) est livré, avec le PDF final de l’analyse et le texte du décret BACS en annexe.',
  },
  // Rapports de maintenance et livres blancs (mêmes pastilles)
  draft: {
    title: 'Brouillon',
    tone: 'neutral',
    icon: 'pen',
    text: 'Document en cours d’écriture, pas encore marqué publié.',
  },
  published: {
    title: 'Publié',
    tone: 'success',
    icon: 'circle-check',
    text: 'Document terminé et marqué publié.',
  },
};

/** Pastille de statut (StatusBadge) : ce que veut dire la phase, et la suivante. Les audits
 *  BACS et les autres documents n'ont que « rédaction » et « livré » : texte générique. */
export function docStatusTip(status, kind = 'af') {
  const card = STATUS_CARDS[status];
  if (!card) return null;
  const i = AF_PHASES.indexOf(status);
  if (i < 0) return { ...card };
  if ((kind || 'af') !== 'af') {
    if (status === 'redaction') {
      return { title: 'Rédaction en cours', tone: 'neutral', icon: 'pen', text: 'Le document est en cours de rédaction : tout reste modifiable.' };
    }
    if (status === 'livree') {
      return {
        title: 'Document livré',
        tone: 'success',
        icon: 'truck',
        text: kind === 'bacs_audit' ? 'Le rapport d’audit a été livré : son PDF final est figé et daté.' : 'La version finale a été livrée, avec son PDF.',
      };
    }
    return { ...card };
  }
  const rows = [{ label: 'Phase', value: `${i + 1} sur ${AF_PHASES.length}` }];
  const next = AF_PHASES[i + 1];
  if (next) rows.push({ label: 'Phase suivante', value: AF_PHASE_LABELS[next] });
  return { ...card, rows };
}

const PHASE_ADVANCE_TEXT = {
  validee: 'Fige une version datée de l’analyse, avec son PDF. Le maître d’ouvrage s’engage à commander le contrat de services.',
  commissioning: 'Mise en service sur le chantier : simple changement de phase, aucune version n’est figée.',
  commissioned: 'Mise en service terminée : simple changement de phase, aucune version n’est figée.',
  livree: 'Génère le PDF final, avec le texte du décret BACS en annexe, et fige la version livrée du dossier des ouvrages exécutés (DOE).',
};

/** Bouton « Faire avancer la phase » : la phase suivante et ce qu'elle déclenche. */
export function phaseAdvanceTip(current, next) {
  if (!next || !AF_PHASE_LABELS[next]) return null;
  return {
    title: `Passer à « ${AF_PHASE_LABELS[next]} »`,
    tone: 'info',
    icon: 'arrow-right',
    text: PHASE_ADVANCE_TEXT[next] || '',
    rows: AF_PHASE_LABELS[current] ? [{ label: 'Phase actuelle', value: AF_PHASE_LABELS[current] }] : [],
  };
}

// ── Offres Buildy (ServiceLevelBadge, choix du niveau) ─────────────────────────────────────
// docs/offres-buildy-2026-ia.pdf (licence Essentials, services annuels Smart / Premium) et
// lib/buildy-offer.js (réserves du décret BACS en Essentials).

const LEVEL_CARDS = {
  E: {
    title: 'Offre Essentiel',
    tone: 'neutral',
    icon: 'layer-group',
    text: 'Le socle de la supervision Buildy : tous les sites sur un même écran, alarmes, pilotage et programmations horaires à distance.',
    rows: [
      { label: 'Formule', value: 'licence' },
      { label: 'Historique mensuel gardé', value: '12 mois' },
      { label: 'Maintenance de la GTB', value: 'non incluse' },
    ],
    todo: {
      title: 'Pour respecter le décret BACS',
      items: [
        'Exporte les données de consommation pour les garder 5 ans',
        'Prévois la maintenance de la GTB : contrat ou équipe interne compétente',
      ],
    },
    meta: 'Offres Buildy 2026',
  },
  S: {
    title: 'Offre Smart',
    tone: 'info',
    icon: 'layer-group',
    text: 'Tout l’Essentiel, avec la maintenance de la GTB, la sauvegarde des données, l’application mobile et les tableaux de bord de consommation.',
    rows: [
      { label: 'Formule', value: 'services annuels' },
      { label: 'Historique mensuel gardé', value: '5 ans' },
      { label: 'Maintenance de la GTB', value: 'incluse' },
    ],
    meta: 'Offres Buildy 2026',
  },
  P: {
    title: 'Offre Premium',
    tone: 'info',
    icon: 'layer-group',
    text: 'Toute l’offre Smart, avec la connectivité 4G, les plans 2D/3D et le signalement d’anomalies par les utilisateurs.',
    rows: [
      { label: 'Formule', value: 'services annuels' },
      { label: 'Historique mensuel gardé', value: '10 ans' },
      { label: 'Maintenance de la GTB', value: 'incluse' },
    ],
    meta: 'Offres Buildy 2026',
  },
};

const LEVEL_NAMES = { E: 'Essentiel', S: 'Smart', P: 'Premium' };

/** Pastille d'offre : 'E' | 'S' | 'P', ou combinaison ('S/P', 'E/S/P'). */
export function serviceLevelTip(level) {
  const v = String(level || '').toUpperCase().replace(/\s+/g, '');
  if (!v) return null;
  if (LEVEL_CARDS[v]) return LEVEL_CARDS[v];
  const parts = v.split('/').filter((p) => LEVEL_NAMES[p]);
  if (!parts.length) return null;
  if (parts.length === 1) return LEVEL_CARDS[parts[0]];
  const names = parts.map((p) => LEVEL_NAMES[p]);
  const list = names.length === 3 ? 'les trois offres' : `les offres ${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
  return {
    title: names.length === 3 ? 'Toutes les offres' : `Offres ${names.join(' et ')}`,
    tone: 'info',
    icon: 'layer-group',
    text: `Disponible dans ${list}.`,
    meta: 'Offres Buildy 2026',
  };
}

/** Pastille « contrat à définir » (CycleBandeau) et encart sans contrat. */
export const CONTRACT_UNDEFINED_TIP = {
  title: 'Contrat à définir',
  tone: 'warning',
  icon: 'layer-group',
  text: 'Aucune offre n’est encore choisie pour ce projet. Elle se décide au bon de commande, au plus tard avant la livraison du dossier des ouvrages exécutés (DOE).',
  todo: 'Choisis l’offre visée dans « Plus » › « Paramètres de l’AF ».',
};

/** Encart « Niveau requis » (RequiredServiceLevelPanel). */
export const REQUIRED_LEVEL_TIP = {
  title: 'Niveau d’offre requis',
  tone: 'info',
  icon: 'layer-group',
  text: 'L’offre la plus basse qui couvre toutes les fonctionnalités gardées dans l’analyse. Il est recalculé à chaque modification.',
  rows: [{ label: 'Ne comptent pas', value: 'options payantes, fonctionnalités écartées, sections exclues des exports' }],
};

/** Niveau requis au-dessus du contrat. */
export function contractShortfallTip(contractName, requiredName) {
  const rows = [];
  if (contractName) rows.push({ label: 'Offre du contrat', value: contractName });
  if (requiredName) rows.push({ label: 'Offre requise', value: requiredName, icon: 'triangle-exclamation', tone: 'error' });
  return {
    title: 'Le contrat ne suffit pas',
    tone: 'error',
    icon: 'triangle-exclamation',
    text: 'Des fonctionnalités gardées dans l’analyse demandent une offre plus haute que celle du contrat.',
    rows,
    todo: 'Monte l’offre du contrat, ou écarte les fonctionnalités qui l’exigent.',
  };
}

/** Niveau requis couvert par le contrat. */
export function contractOkTip(contractName) {
  return {
    title: 'Le contrat suffit',
    tone: 'success',
    icon: 'circle-check',
    text: `L’offre ${contractName || 'du contrat'} couvre toutes les fonctionnalités gardées dans l’analyse.`,
  };
}

/** « +N autres » sections qui justifient le niveau requis : leurs titres. */
export function moreJustificationsTip(titles) {
  const list = (titles || []).filter(Boolean);
  if (!list.length) return null;
  return {
    title: `${plural(list.length, 'autre section', 'autres sections')} au même niveau`,
    tone: 'neutral',
    icon: 'file-lines',
    // Titres de l'AF cités tels quels (écrits pour le client, parfois au vouvoiement) : entre
    // guillemets, pour qu'on les lise comme des noms et non comme le texte de l'application.
    text: list.map((t) => `• « ${t} »`).join('\n'),
  };
}

// ── Bandeau de l'AF (CycleBandeau) ─────────────────────────────────────────────────────────

export const RENAME_PROJECT_TIP = {
  title: 'Renommer le projet',
  tone: 'info',
  icon: 'i-cursor',
  text: 'Modifie le nom directement ici.',
  rows: [
    { label: 'Enregistrer', value: 'Entrée' },
    { label: 'Annuler', value: 'Échap' },
  ],
};

export const AF_EXPORT_TIP = {
  title: 'Exporter l’analyse fonctionnelle',
  tone: 'info',
  icon: 'file-pdf',
  text: 'Le document complet : chapitres, captures et niveau d’offre requis en page de garde.',
  rows: [{ label: 'Format', value: 'PDF A4 portrait' }],
};

export const POINTS_EXPORT_TIP = {
  title: 'Exporter la liste de points',
  tone: 'info',
  icon: 'file-pdf',
  text: 'La liste contractuelle des points (mesures, alarmes, commandes…), équipement par équipement, classée par catégorie.',
  rows: [{ label: 'Format', value: 'PDF A4 paysage' }],
};

export const SYNTHESIS_EXPORT_TIP = {
  title: 'Exporter le tableau de synthèse',
  tone: 'info',
  icon: 'file-pdf',
  text: 'La vue d’ensemble : un système par ligne, avec ses points (mesures, commandes…), ses équipements installés et les fonctions Hyperveez.',
  rows: [{ label: 'Format', value: 'PDF A4 paysage' }],
};

/** Bouton « Générer le PDF » grisé : le motif manque. */
export const EXPORT_MOTIF_TIP = {
  title: 'Motif requis',
  tone: 'warning',
  icon: 'pen',
  text: 'Chaque export est gardé dans l’historique avec son motif, repris en page de garde du PDF.',
  todo: 'Renseigne le motif de cette version.',
};

/** Liste de ce qui manque pour activer un bouton grisé (ou null si rien ne manque). */
export function missingInfoTip(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  return {
    title: 'Informations manquantes',
    tone: 'warning',
    icon: 'pen',
    text: 'Le bouton s’active quand tout est rempli.',
    todo: list,
  };
}

/** Passage de phase grisé (validation, livraison). */
export function transitionBlockedTip({ motifMissing = false, agreementMissing = false } = {}) {
  return missingInfoTip([
    agreementMissing && 'Coche l’engagement de commande du contrat de services',
    motifMissing && 'Renseigne le motif',
  ]);
}

/** Création ou clonage d'un document, paramètres de l'AF : champs obligatoires. */
export function docFormBlockedTip({ clientMissing = false, projectMissing = false, siteMissing = false, kind = 'af' } = {}) {
  return missingInfoTip([
    siteMissing &&
      (kind === 'maintenance_report'
        ? 'Choisis le site : un rapport de maintenance y est toujours rattaché'
        : 'Choisis le site : un audit BACS y est toujours rattaché'),
    clientMissing && 'Renseigne le client',
    projectMissing && 'Renseigne le projet',
  ]);
}

/** Ajout d'une section grisé. */
export function addSectionBlockedTip({ titleMissing = false, templateMissing = false } = {}) {
  return missingInfoTip([titleMissing && 'Renseigne le titre de la section', templateMissing && 'Choisis l’équipement dans la liste']);
}

// ── Détail de l'AF (AfDetailView) ──────────────────────────────────────────────────────────

/** Compteur « ✓ n / t » au-dessus de l'arbre : sections relues. */
export function verificationProgressTip({ verified = 0, total = 0 } = {}) {
  const done = total > 0 && verified >= total;
  return {
    title: 'Relecture des sections',
    tone: done ? 'success' : 'info',
    icon: 'circle-check',
    text: 'Sections marquées « Vérifiée » dans l’éditeur, parmi celles incluses dans l’export.',
    rows: [
      { label: 'Vérifiées', value: verified, icon: 'circle-check', tone: 'success' },
      { label: 'Incluses dans l’export', value: total, icon: 'file-lines' },
    ],
    todo: done ? null : 'Relis chaque section, puis marque-la « Vérifiée ».',
  };
}

/** Ligne « n texte · n équip. · … » sous le titre de l'arbre. */
export function sectionKindsTip(counts = {}) {
  return {
    title: 'Types de sections',
    tone: 'neutral',
    icon: 'file-lines',
    rows: [
      { label: 'Texte', value: counts.standard || 0, icon: 'file-lines' },
      { label: 'Équipement', value: counts.equipment || 0, icon: 'cube' },
      { label: 'Page Hyperveez', value: counts.hyperveez_page || 0, icon: 'display' },
      { label: 'Tableau de synthèse', value: counts.synthesis || 0, icon: 'table' },
    ],
  };
}

export const PROJECTION_TIP = {
  title: 'Mode projection',
  tone: 'info',
  icon: 'expand',
  text: 'Affiche la section en plein écran, pour un vidéoprojecteur en réunion.',
  rows: [
    { label: 'Section précédente ou suivante', value: '← →' },
    { label: 'Quitter', value: 'Échap' },
  ],
};

// Boutons du maître d'ouvrage (barre d'actions de la section). État « non » : la carte dit ce
// que fait le bouton ; état « oui » : l'étiquette dit comment revenir en arrière.
export const DEMAND_TIP = {
  title: 'Marquer comme exigée',
  tone: 'success',
  icon: 'circle-check',
  text: 'Le maître d’ouvrage veut cette fonctionnalité incluse au contrat (avenant). Elle compte alors dans l’offre requise.',
};
export const UNDEMAND_LABEL = 'Annuler l’exigence du maître d’ouvrage';

export const OPT_OUT_TIP = {
  title: 'Marquer comme écartée',
  tone: 'warning',
  icon: 'ban',
  text: 'Le maître d’ouvrage renonce à cette fonctionnalité : elle ne compte plus dans l’offre requise, et le PDF la signale dans un encart.',
};
export const OPT_IN_LABEL = 'Réactiver cette fonctionnalité';

export const PAID_OPTION_TIP = {
  title: 'Ajouter en option payante',
  tone: 'info',
  icon: 'euro-sign',
  text: 'La fonctionnalité entre au contrat comme option payante, sans changer d’offre.',
};
export const REMOVE_PAID_OPTION_LABEL = 'Retirer l’option payante du contrat';

export const EXCLUDE_SECTION_TIP = {
  title: 'Exclure des exports',
  tone: 'neutral',
  icon: 'eye-slash',
  text: 'La section n’apparaîtra plus dans les PDF ni dans les listes. Utile pour une section interne ou en cours de rédaction.',
};
export const INCLUDE_SECTION_LABEL = 'Réintégrer la section dans les exports';

export const DELETE_SECTION_TIP = {
  title: 'Supprimer la section',
  tone: 'error',
  icon: 'trash',
  text: 'Supprime aussi ses sous-sections, avec leurs équipements installés et leurs captures. Action définitive.',
};

// ── Liste des documents (AfsListView) ──────────────────────────────────────────────────────

const DOC_KIND_CARDS = {
  af: {
    title: 'Analyse fonctionnelle',
    tone: 'info',
    icon: 'file-lines',
    text: 'Décrit la GTB du bâtiment : équipements, points et fonctions. Livrable de chantier, remis dans le dossier des ouvrages exécutés (DOE).',
  },
  bacs_audit: {
    title: 'Audit BACS',
    tone: 'info',
    icon: 'clipboard-check',
    text: 'Relevé du site, rapport de conformité au décret BACS et plan d’actions pour s’y mettre en conformité.',
  },
  maintenance_report: {
    title: 'Rapport de maintenance',
    tone: 'info',
    icon: 'screwdriver-wrench',
    text: 'Bilan annuel des actions de maintenance du site : signalements, réponses de Buildy et résultats.',
  },
  brochure: {
    title: 'Brochure commerciale',
    tone: 'info',
    icon: 'book',
    text: 'Document commercial composé à partir de la bibliothèque de fonctionnalités.',
  },
};

/** Pastille de type de document. */
export function docKindTip(kind) {
  return DOC_KIND_CARDS[kind || 'af'] || null;
}

export const CONTRACT_COLUMN_TIP = {
  title: 'Offre du contrat',
  tone: 'info',
  icon: 'layer-group',
  text: 'L’offre Buildy visée pour le projet : Essentiel, Smart ou Premium. Un tiret tant qu’elle n’est pas choisie.',
};

export const PROGRESS_COLUMN_TIP = {
  title: 'Avancement de l’audit',
  tone: 'info',
  icon: 'list-check',
  text: 'Étapes validées de l’audit BACS, sur le nombre d’étapes. Sans GTB sur le site, l’inspection périodique ne compte pas.',
};

/** Barre d'avancement d'un audit BACS dans la liste. */
export function bacsProgressTip({ count = 0, total = 0 } = {}) {
  const done = total > 0 && count >= total;
  return {
    title: 'Avancement de l’audit',
    tone: done ? 'success' : 'info',
    icon: 'list-check',
    text: done ? 'Toutes les étapes de l’audit sont validées.' : `${plural(count, 'étape validée', 'étapes validées')} sur ${total}.`,
  };
}

export const NO_CONTRACT_LABEL = 'Offre pas encore choisie';

export const DEV_FIXTURE_TIP = {
  title: 'Audit BACS de démonstration',
  tone: 'info',
  icon: 'flask',
  text: 'Crée un site et un audit BACS entièrement remplis, pour tester l’outil. Bouton visible seulement en développement.',
};

// ── Versions (AfVersionsView) ──────────────────────────────────────────────────────────────

/** Repère posé sur une version (af-v0.3, lp-v0.2, synth-v0.1, ou posé à la main). */
export function versionTagTip(tag) {
  const t = String(tag || '');
  if (/^af-v/i.test(t)) {
    return { title: 'Export de l’analyse', tone: 'info', icon: 'file-pdf', text: 'Version enregistrée à la génération du PDF de l’analyse fonctionnelle.' };
  }
  if (/^lp-v/i.test(t)) {
    return { title: 'Export de la liste de points', tone: 'info', icon: 'file-pdf', text: 'Version enregistrée à la génération du PDF de la liste de points.' };
  }
  if (/^synth-v/i.test(t)) {
    return { title: 'Export de la synthèse', tone: 'info', icon: 'file-pdf', text: 'Version enregistrée à la génération du tableau de synthèse.' };
  }
  return { title: 'Version marquée', tone: 'neutral', icon: 'tag', text: 'Repère posé à la main avec « Marquer comme version ».' };
}

export const LATEST_VERSION_TIP = {
  title: 'Dernière version',
  tone: 'success',
  icon: 'clock-rotate-left',
  text: 'La plus récente des versions. Une version s’enregistre à chaque export PDF, ou avec « Marquer comme version ».',
};

export const VERSION_ID_LABEL = 'Identifiant de cette version';
export const VERSION_COMPARE_LABEL = 'Cocher pour comparer deux versions';

export const RESTORE_VERSION_TIP = {
  title: 'Restaurer cette version',
  tone: 'warning',
  icon: 'clock-rotate-left',
  text: 'Les sections reprennent leur contenu de cette version. Une nouvelle version garde la trace de la restauration.',
};

// ── Mises à jour de la bibliothèque (TemplatePropagationBanner) ────────────────────────────

const NEW_ITEM_TEXT = 'Ajoutée à la bibliothèque depuis la création de l’analyse, elle n’y figure pas encore.';
const PROPAGATION_SOURCE_CARDS = {
  equipment: {
    title: 'Équipement mis à jour',
    tone: 'info',
    icon: 'cube',
    text: 'Sa fiche a changé dans la bibliothèque (points, description). La section affiche déjà la nouvelle version.',
  },
  section_template: {
    title: 'Section mise à jour',
    tone: 'info',
    icon: 'file-lines',
    text: 'Le texte de référence de cette section a changé dans la bibliothèque.',
  },
  functionality: {
    title: 'Fonctionnalité mise à jour',
    tone: 'info',
    icon: 'file-lines',
    text: 'Le texte de référence de cette fonctionnalité a changé dans la bibliothèque.',
  },
  new_section: { title: 'Nouvelle section', tone: 'success', icon: 'plus', text: NEW_ITEM_TEXT },
  new_functionality: { title: 'Nouvelle fonctionnalité', tone: 'success', icon: 'plus', text: NEW_ITEM_TEXT },
};

const isNewItem = (source) => source === 'new_section' || source === 'new_functionality';

/** Pastille de type d'une mise à jour (Équipement, Section, Nouvelle section…). */
export function propagationSourceTip(source) {
  return PROPAGATION_SOURCE_CARDS[source || 'equipment'] || null;
}

/** « v1 ⇄ v3 » : version suivie par l'analyse et version de la bibliothèque. */
export function templateVersionTip(from, to) {
  return {
    title: 'Versions du modèle',
    tone: 'neutral',
    icon: 'arrow-right-arrow-left',
    rows: [
      { label: 'Suivie par cette analyse', value: `v${from || 0}` },
      { label: 'Dans la bibliothèque', value: `v${to ?? '?'}` },
    ],
  };
}

/** Bouton « Appliquer » / « Ajouter à l'AF ». */
export function propagationApplyTip(item = {}) {
  if (isNewItem(item.source)) return 'Ajouter cet élément à l’analyse';
  if (!item.source || item.source === 'equipment') {
    return {
      title: 'Appliquer la mise à jour',
      tone: 'info',
      icon: 'check',
      text: 'La section affiche déjà la nouvelle version de l’équipement : appliquer sert seulement à en prendre acte.',
    };
  }
  if (item.body_changed) {
    return {
      title: 'Appliquer la mise à jour',
      tone: 'warning',
      icon: 'triangle-exclamation',
      text: 'Le texte de ta section est remplacé par le nouveau texte de la bibliothèque : tes modifications locales seront perdues.',
    };
  }
  return {
    title: 'Appliquer la mise à jour',
    tone: 'info',
    icon: 'check',
    text: 'Seul le numéro de version change : le contenu de ta section reste le même.',
  };
}

/** Bouton « Ignorer » / « Garder ma version ». */
export function propagationDismissTip(source) {
  if (isNewItem(source)) {
    return {
      title: 'Ignorer pour l’instant',
      tone: 'neutral',
      icon: 'eye-slash',
      text: 'L’élément sort de cette liste, mais il reviendra au prochain chargement de l’analyse.',
    };
  }
  return 'Marquer comme lu sans changer ta section';
}

// ── Tableaux des instances et des points (AfInstancesModal, AfPointsModal) ─────────────────
// Définitions reprises de la légende de la liste de points PDF (templates/pdf/points-list.hbs).

export const INSTANCE_COLUMN_TIPS = {
  reference: { title: 'Repère', tone: 'info', text: 'Nom ou code qui identifie l’équipement sur le site.' },
  qty: { title: 'Quantité', tone: 'info', text: 'Nombre d’équipements identiques décrits par cette ligne.' },
};

export const SECTION_EXCLUDED_TIP = {
  title: 'Section exclue des exports',
  tone: 'neutral',
  icon: 'eye-slash',
  text: 'Elle n’apparaît ni dans les PDF ni dans les listes.',
};

export const QTY_TOTAL_LABEL = 'Quantité totale sur le projet';

const KPI_META = 'Un clic filtre la liste, un second clic la rétablit.';
export const POINT_KPI_TIPS = {
  all: 'Afficher tous les points',
  required: { title: 'Points obligatoires', tone: 'success', icon: 'circle-check', text: 'Points attendus par défaut sur ce type d’équipement.', meta: KPI_META },
  optional: {
    title: 'Points optionnels',
    tone: 'neutral',
    icon: 'circle-minus',
    text: 'Points qui peuvent manquer selon le modèle, la version du logiciel ou la configuration de l’équipement.',
    meta: KPI_META,
  },
  read: { title: 'Points en lecture', tone: 'info', icon: 'eye', text: 'Buildy lit la donnée mise à disposition par l’équipement.', meta: KPI_META },
  write: { title: 'Points en écriture', tone: 'info', icon: 'pen', text: 'Buildy écrit la valeur sur l’équipement.', meta: KPI_META },
};

export const POINT_COLUMN_TIPS = {
  instance_reference: { title: 'Instance', tone: 'info', text: 'L’équipement installé sur le site : son repère, puis sa localisation.' },
  tech_name: { title: 'Repère technique', tone: 'info', text: 'Nom technique court du point, par exemple T_AIR_NEUF.' },
  data_type: {
    title: 'Type de point',
    tone: 'info',
    text: [
      '• Mesure : valeur physique mesurée (température, débit…)',
      '• État : marche ou arrêt, mode actif…',
      '• Alarme : défaut ou anomalie détectée',
      '• Commande : action ponctuelle envoyée à l’équipement',
      '• Consigne : réglage transmis à l’équipement',
    ].join('\n'),
  },
  direction: {
    title: 'Sens',
    tone: 'info',
    rows: [
      { label: 'R : lecture', value: 'Buildy lit la donnée' },
      { label: 'W : écriture', value: 'Buildy écrit la valeur' },
    ],
  },
  nature: {
    title: 'Nature de la donnée',
    tone: 'info',
    rows: [
      { label: 'Booléen', value: 'vrai ou faux' },
      { label: 'Numérique', value: 'nombre, avec une unité' },
      { label: 'Enum', value: 'choix dans une liste fermée' },
      { label: 'Chaîne de caractères', value: 'texte libre' },
    ],
  },
  is_optional: {
    title: 'Point optionnel',
    tone: 'info',
    text: 'Il peut manquer selon le modèle, la version du logiciel ou la configuration de l’équipement.',
  },
};

export const POINT_TYPE_LABELS = {
  Mesure: 'Grandeur mesurée : température, débit…',
  'État': 'Marche ou arrêt, mode actif…',
  Alarme: 'Défaut ou anomalie détectée',
  Commande: 'Action ponctuelle sur l’équipement',
  Consigne: 'Réglage transmis à l’équipement',
};

export const POINT_NATURE_LABELS = {
  'Booléen': 'Vrai ou faux',
  'Numérique': 'Nombre, avec une unité',
  Enum: 'Choix dans une liste fermée',
  'Chaîne de caractères': 'Texte libre : code erreur, libellé…',
};

export function pointDirectionLabel(direction) {
  return direction === 'read' ? 'Lecture : Buildy lit la donnée' : 'Écriture : Buildy écrit la valeur';
}

export function pointOptionalLabel(isOptional) {
  return isOptional ? 'Point optionnel' : 'Point attendu par défaut';
}

// ── Choix d'un modèle d'équipement et des sections à exporter ──────────────────────────────

export const TEMPLATE_POINTS_COLUMN_TIP = {
  title: 'Points',
  tone: 'info',
  icon: 'list-ul',
  text: 'Nombre de points de données prévus par ce modèle d’équipement : mesures, états, alarmes, commandes, consignes.',
};

export function templatePointsLabel(n) {
  return plural(Number(n) || 0, 'point de données', 'points de données');
}

export const TEMPLATE_SELECTED_LABEL = 'Équipement choisi';

export const SECTION_KIND_LABELS = {
  standard: 'Section de texte',
  equipment: 'Section équipement',
  hyperveez_page: 'Page Hyperveez',
  synthesis: 'Tableau de synthèse',
  zones: 'Zones fonctionnelles',
};

/** Case à cocher d'une section dans le choix des sections à exporter. */
export function sectionPickLabel(state, hasChildren = false) {
  if (state === 'on') return hasChildren ? 'Décocher la section et ses sous-sections' : 'Décocher cette section';
  return hasChildren ? 'Cocher la section et ses sous-sections' : 'Cocher cette section';
}

// ── Décret BACS (BacsBadge, BacsContextBox) ────────────────────────────────────────────────

/** « R175-1 1°, 2° ; R175-3 3° » → ['R175-1 1°', 'R175-1 2°', 'R175-3 3°']. */
export function decreeRefKeys(reference) {
  const ref = normalizeArticle(reference);
  const out = [];
  let code = null;
  for (const part of ref.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/R175-\d+(?:-\d+)?/);
    if (m) code = m[0];
    if (!code) continue;
    const paras = [...part.replace(/R175-\d+(?:-\d+)?/, '').matchAll(/(\d+)°/g)].map((x) => x[1]);
    if (paras.length) paras.forEach((n) => out.push(`${code} ${n}°`));
    else if (m) out.push(code);
  }
  return [...new Set(out)];
}

// Définitions de l'article R175-1 (texte du décret, seeds/bacs-articles.js) : 1° système de
// chauffage, 2° de climatisation, 3° de ventilation — les références les plus fréquentes des
// équipements de la bibliothèque.
const R175_1_SYSTEMS = { 1: 'le chauffage', 2: 'la climatisation', 3: 'la ventilation' };

function joinFr(list) {
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}` : list[0] || '';
}

/** Pastille violette du décret : ce que demande le décret, en clair ; article en pied. */
export function bacsReferenceTip(reference, context = 'section') {
  const ref = normalizeArticle(reference);
  if (!ref) return null;
  let text = '';
  if (/\sà\s/.test(ref)) {
    text = 'Tout le décret BACS : bâtiments concernés, rôle de la GTB, vérifications, formation et régulation de la température.';
  } else {
    const systems = [];
    const plains = [];
    for (const key of decreeRefKeys(ref)) {
      const m = key.match(/^R175-1 ([123])°$/);
      if (m) {
        if (!systems.includes(R175_1_SYSTEMS[m[1]])) systems.push(R175_1_SYSTEMS[m[1]]);
        continue;
      }
      const p = decreePlain(key);
      if (p && !plains.some((x) => x.title === p.title)) plains.push(p);
    }
    if (systems.length) {
      plains.unshift({
        title: `Systèmes visés : ${joinFr(systems)}`,
        text: `Le décret compte ${joinFr(systems)} parmi les systèmes techniques qu’il vise.`,
      });
    }
    if (plains.length === 1) text = plains[0].text;
    else if (plains.length) text = plains.map((p) => `• ${p.title}`).join('\n');
  }
  return {
    title: context === 'equipment' ? 'Équipement concerné par le décret' : 'Exigence du décret BACS',
    tone: 'info',
    icon: 'scale-balanced',
    text,
    meta: 'Un clic ouvre l’extrait officiel',
    article: ref,
  };
}

/** Bouton « Préciser le lien » / « Éditer » de l'encart du décret : dans une analyse (texte du
 *  projet) ou dans la bibliothèque (texte de l'équipement, repris par les analyses). */
export function bacsJustifyTip(hasOwnText = false, inLibrary = false) {
  return {
    title: hasOwnText ? 'Modifier le lien avec le décret' : 'Préciser le lien avec le décret',
    tone: 'info',
    icon: 'pen',
    text: inLibrary
      ? 'Explique pourquoi le décret s’applique à cet équipement. Ton texte remplace le résumé automatique dans les analyses qui n’ont pas le leur.'
      : 'Explique pourquoi le décret s’applique ici. Ton texte remplace, pour ce projet, celui de la bibliothèque ou le résumé automatique.',
  };
}

// Icônes citées par ce module (scripts/gen-tooltip-icons.mjs les enregistre ; cf. test).
export const AF_TIP_ICONS = [
  'pen', 'circle-check', 'screwdriver-wrench', 'list-check', 'truck', 'arrow-right', 'layer-group', 'triangle-exclamation',
  'file-lines', 'i-cursor', 'file-pdf', 'cube', 'display', 'table', 'expand', 'ban', 'euro-sign', 'eye-slash', 'trash',
  'clipboard-check', 'book', 'flask', 'tag', 'clock-rotate-left', 'plus', 'arrow-right-arrow-left', 'check', 'circle-minus',
  'eye', 'list-ul', 'scale-balanced',
];
