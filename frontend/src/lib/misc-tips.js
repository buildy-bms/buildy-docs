// Infobulles hors audit (2026-10-12) : sites, accueil, connexion, livres blancs, brochures,
// configuration des offres, rapports de maintenance. Contenus des cartes v-tooltip en français
// simple, tutoiement. Fonctions PURES, imports relatifs uniquement (testées par
// backend-node/test/misc-tips.test.mjs ; les constantes aussi par tooltip-copy-modules.test.mjs).
// Règles : CLAUDE.md § « Infobulles (UI) ».

// ── Dates ──────────────────────────────────────────────────────────────────────────────────

/** « 12 oct. 2026 à 10:15 » depuis une date SQL (« 2026-10-12 10:15:00 ») ou ISO ; '' sinon. */
export function formatDateTime(v) {
  if (!v) return '';
  const s = String(v);
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}

/** Étiquette datée avec horloge (« Modifié le 12 oct. 2026 à 10:15 ») ; null sans date. */
export function dateLabel(prefix, v) {
  const when = formatDateTime(v);
  return when ? { label: `${prefix} ${when}`, icon: 'clock' } : null;
}

// ── Sites ──────────────────────────────────────────────────────────────────────────────────

/** En-tête « Synchro FM » de la liste des sites. */
export const SITE_SYNC_COLUMN_TIP = {
  title: 'Synchronisation Fleet Manager',
  icon: 'arrows-rotate',
  text: 'Dernier échange de ce site avec Fleet Manager, l’outil qui gère les passerelles Buildy. Nom, client, adresse et notes sont partagés dans les deux sens.',
};

/** Pastille de synchronisation d'un site avec Fleet Manager (liste des sites). */
export function siteSyncTip(site) {
  if (!site) return null;
  if (!site.synced_at) {
    return {
      title: 'Jamais synchronisé',
      tone: 'warning',
      icon: 'arrows-rotate',
      text: 'Ce site n’a encore jamais été partagé avec Fleet Manager. L’envoi est automatique à chaque modification, avec de nouveaux essais en cas d’échec.',
    };
  }
  return {
    title: 'Synchronisé avec Fleet Manager',
    tone: 'success',
    icon: 'arrows-rotate',
    rows: [{ icon: 'clock', label: 'Dernier échange', value: formatDateTime(site.synced_at) || '—' }],
  };
}

/** Identifiant court affiché sous le nom d'un site : l'identifiant complet, partagé avec FM. */
export function siteIdTip(uuid) {
  if (!uuid) return null;
  return {
    title: 'Identifiant du site',
    tone: 'neutral',
    icon: 'hashtag',
    text: 'Le même dans Fleet Manager : c’est lui qui relie les deux fiches du site.',
    rows: [{ label: 'Identifiant complet', value: uuid }],
  };
}

/** Pastille du type de zone (Fonctionnelle / Technique). */
export const ZONE_KIND_TIPS = {
  functional: {
    title: 'Zone fonctionnelle',
    tone: 'info',
    icon: 'location-dot',
    text: 'Ensemble de locaux aux usages homogènes (mêmes activités, mêmes horaires) : c’est l’unité de suivi de l’énergie, pas une pièce.',
    article: 'R175-1 6°',
  },
  technical: {
    title: 'Zone technique',
    tone: 'neutral',
    icon: 'screwdriver-wrench',
    text: 'Local technique, tableau électrique général, local compteurs… Hors décret BACS : aucun système ni compteur n’y est créé automatiquement.',
  },
};

/** Pastille du type d'un document (AF, audit BACS, audit GTB) ; null si le nom suffit. */
export function docKindTip(kind) {
  if (kind === 'af') return 'Analyse fonctionnelle';
  if (kind === 'bacs_audit') return 'Audit de conformité au décret BACS';
  if (kind === 'site_audit') {
    return {
      title: 'Audit GTB',
      tone: 'info',
      icon: 'clipboard-check',
      text: 'Audit classique, hors décret BACS : l’inventaire technique du site pour chiffrer une GTB.',
    };
  }
  return null;
}

/** Vignette d'une photo du site : nom, dates, appareil, position. */
export function sitePhotoTip(p) {
  if (!p) return null;
  const rows = [];
  const name = p.title || p.original_name;
  if (name) rows.push({ icon: 'image', label: 'Nom', value: name });
  const taken = formatDateTime(p.taken_at);
  if (taken) rows.push({ icon: 'clock', label: 'Prise le', value: taken });
  const added = formatDateTime(p.uploaded_at);
  if (added) rows.push({ icon: 'upload', label: 'Ajoutée le', value: added });
  const device = [p.camera_make, p.camera_model].filter(Boolean).join(' ');
  if (device) rows.push({ icon: 'camera', label: 'Appareil', value: device });
  if (p.gps_latitude != null) rows.push({ icon: 'location-dot', label: 'Position GPS', value: 'enregistrée' });
  return { title: 'Photo du site', tone: 'info', icon: 'camera', rows };
}

// ── Connexion et accueil mobile ────────────────────────────────────────────────────────────

/** Bouton « Se connecter avec Buildy ID ». */
export const BUILDY_ID_TIP = {
  title: 'Buildy ID',
  tone: 'info',
  icon: 'key',
  text: 'Ton compte Buildy, le même que pour Fleet Manager et Buildy Tools. Connexion par clé d’accès : aucun mot de passe à retenir.',
};

/** Pastille « hors ligne » de l'accueil mobile. */
export const OFFLINE_TIP = {
  title: 'Hors ligne',
  tone: 'warning',
  icon: 'wifi',
  text: 'Pas de connexion pour l’instant. Dans un audit, tes modifications restent sur l’appareil et partent au retour du réseau.',
};

/** Pastille de l'utilisateur connecté (initiales) ; null sans nom ni adresse. */
export function accountTip(user) {
  if (!user) return null;
  const rows = [];
  if (user.display_name) rows.push({ label: 'Nom', value: user.display_name });
  if (user.email) rows.push({ label: 'Adresse e-mail', value: user.email });
  if (!rows.length) return null;
  return { title: 'Ton compte', tone: 'info', icon: 'circle-user', rows };
}

// ── Livres blancs ──────────────────────────────────────────────────────────────────────────

/** ⓘ du bloc « Lien traçable & statistiques ». */
export const WP_TRACKER_TIP = {
  title: 'Lien traçable',
  tone: 'info',
  icon: 'link',
  text: 'Partage ce lien : chaque ouverture est comptée, puis le PDF s’affiche. Les chiffres se mettent à jour chaque jour, ou tout de suite avec « Rafraîchir ».',
};

/** Chiffre « visiteurs uniques ». */
export const WP_UNIQUES_TIP = {
  title: 'Visiteurs uniques',
  tone: 'info',
  icon: 'users',
  text: 'Estimation du nombre de personnes : les clics venant d’un même réseau comptent pour un seul visiteur.',
};

/** En-tête « Provenances ». */
export const WP_REFERERS_TIP = {
  title: 'Provenances',
  tone: 'info',
  icon: 'globe',
  text: 'Site web d’où vient chaque clic. « Accès direct » : aucune page d’origine connue (lien collé, e-mail, document…).',
};

/** En-tête « Compagnons » de la liste des livres blancs. */
export const WP_COMPANIONS_TIP = {
  title: 'Documents compagnons',
  tone: 'info',
  icon: 'file-lines',
  text: 'Documents d’une page rattachés à ce livre blanc.',
};

/** Audience cible d'un livre blanc : sens des intitulés métier (rien pour « Exploitant »). */
export const WP_AUDIENCE_TIPS = {
  property_manager: 'Gestionnaire d’immeubles',
  asset_manager: 'Gestionnaire du patrimoine immobilier',
  moa_moe: {
    title: 'MOA / MOE / BE',
    tone: 'info',
    icon: 'users',
    rows: [
      { label: 'MOA', value: 'maîtrise d’ouvrage, le client du projet' },
      { label: 'MOE', value: 'maîtrise d’œuvre, qui conçoit les travaux' },
      { label: 'BE', value: 'bureau d’études' },
    ],
  },
};

// ── Brochures et offres ────────────────────────────────────────────────────────────────────

/** Repère [E] / [S] / [P] / [ESP] d'un élément du catalogue de brochure. */
export const SERVICE_LEVEL_TIPS = {
  E: 'Niveau d’offre Essentiel',
  S: 'Niveau d’offre Smart',
  P: 'Niveau d’offre Premium',
  ESP: 'Tous les niveaux d’offre',
};

/** Repère d'un élément de brochure dont le titre ou le contenu a été modifié pour ce client. */
export const BROCHURE_OVERRIDE_TIP = {
  title: 'Personnalisé pour ce client',
  tone: 'info',
  icon: 'pen',
  text: 'Titre ou contenu modifié pour cette brochure seulement : la bibliothèque, et donc les autres brochures, ne changent pas.',
};

/** En-tête « Tagline » (configuration du PDF des offres). */
export const OFFERING_TAGLINE_TIP = {
  title: 'Accroche du niveau',
  tone: 'info',
  icon: 'quote-left',
  text: 'Courte phrase affichée sous le nom du niveau, en tête de sa colonne dans le tableau du PDF.',
};

/** En-tête « Mise en avant » (configuration du PDF des offres). */
export const OFFERING_HIGHLIGHT_TIP = {
  title: 'Offre vedette',
  tone: 'info',
  icon: 'star',
  text: 'Niveau présenté comme l’offre vedette du tableau du PDF : bordure verte, pastille et fond crème. Un seul niveau à la fois.',
};

/** Textes de la page de garde du PDF des offres (« Promesse en cover », « Sous-titre cover »). */
export const OFFERINGS_COVER_TIP = {
  title: 'Page de garde',
  tone: 'info',
  icon: 'book',
  text: 'Texte de la page de garde du PDF des offres, affiché sous le titre « Offres Buildy ».',
};

/** Textes « CTA — … » du PDF des offres. */
export const OFFERINGS_CTA_TIP = {
  title: 'Appel à l’action',
  tone: 'info',
  icon: 'paper-plane',
  text: '« CTA » désigne ici l’appel à l’action : le bloc en bas du tableau des offres qui invite le lecteur à prendre contact.',
};

// ── Rapports de maintenance ────────────────────────────────────────────────────────────────

/** Pastille de statut d'un rapport annuel de maintenance (brouillon / publié). */
export function maintenanceStatusTip(status) {
  if (status === 'published') {
    return { title: 'Rapport publié', tone: 'success', text: 'Rapport marqué comme terminé. Il reste modifiable.' };
  }
  if (status === 'draft') {
    return {
      title: 'Brouillon',
      tone: 'neutral',
      icon: 'pen',
      text: 'Rapport en cours de rédaction.',
      todo: 'Une fois le rapport terminé, clique sur « Marquer publié ».',
    };
  }
  return null;
}

/** Mention « Sur la cover : « … » » d'un rapport de maintenance. */
export const MAINTENANCE_PERIOD_TIP = {
  title: 'Période en page de garde',
  tone: 'info',
  icon: 'calendar',
  text: 'Texte écrit sur la page de garde du PDF, déduit des dates de début et de fin enregistrées.',
};

// Icônes citées par ce module (enregistrées par lib/tooltip-icons.js, cf. test).
export const MISC_TIP_ICONS = [
  'clock', 'arrows-rotate', 'hashtag', 'location-dot', 'screwdriver-wrench', 'clipboard-check', 'image',
  'upload', 'camera', 'key', 'wifi', 'circle-user', 'link', 'users', 'globe', 'file-lines', 'pen',
  'quote-left', 'star', 'book', 'paper-plane', 'calendar',
];
