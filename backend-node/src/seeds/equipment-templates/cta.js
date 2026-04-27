'use strict';

/**
 * Template equipement de reference : Centrale de traitement d'air (CTA).
 *
 * Source : exemple complet valide dans la page Notion
 * "Analyse Fonctionnelle Solution Buildy [PLAN]" — section 2.2.1
 *
 * Sert d'exemple de reference pour les autres templates equipement, qui sont
 * crees vides et completes au fil des projets puis promus dans la bibliotheque.
 */

module.exports = {
  slug: 'cta',
  name: 'Centrale de traitement d\'air (CTA)',
  category: 'ventilation',
  bacs_articles: 'R175-1 §1, §2, §3',
  icon_kind: 'fa',
  icon_value: 'fa-fan',
  icon_color: '#3b82f6',
  description_html: `
<p><strong>Une CTA est concernée par une ou plusieurs des définitions suivantes selon sa configuration :</strong></p>
<ul>
<li>Système de ventilation (R175-1 §3) — dans tous les cas</li>
<li>Système de chauffage (R175-1 §1) — si la CTA intègre une batterie de chauffe</li>
<li>Système de climatisation (R175-1 §2) — si la CTA intègre une batterie de froid</li>
</ul>
<p>Une centrale de traitement d'air assure le renouvellement, le filtrage et le conditionnement de l'air insufflé dans le bâtiment. Elle dispose de son propre système de régulation embarqué, qui gère de façon autonome l'ensemble de sa logique de fonctionnement. La solution Buildy supervise la CTA en lisant ses états et mesures, et en lui transmettant des commandes et consignes depuis l'application Hyperveez.</p>
<p><em>Les données listées ci-dessous sont indicatives et représentatives des points couramment intégrés. La liste de points contractuelle, définie en avant-projet, fait seule foi pour chaque déploiement.</em></p>
`.trim(),
  points: [
    // ── Donnees lues ──
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.mode_fonctionnement', label: 'Mode de fonctionnement (manuel / automatique)', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'temp.air_neuf', label: 'Température air neuf', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30 },
    { slug: 'temp.air_soufflage', label: 'Température air soufflage', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'temp.air_reprise', label: 'Température air reprise', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50 },
    { slug: 'temp.air_rejet', label: 'Température air rejet', dataType: 'Mesure', direction: 'read', unit: '°C', position: 60 },
    { slug: 'debit.soufflage', label: 'Débit soufflage', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 70 },
    { slug: 'debit.reprise', label: 'Débit reprise', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 80 },
    { slug: 'consigne.soufflage_effective', label: 'Consigne de température de soufflage effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 90 },
    { slug: 'etat.filtre_soufflage_encrasse', label: 'État encrassement filtre soufflage', dataType: 'État', direction: 'read', position: 100 },
    { slug: 'etat.filtre_reprise_encrasse', label: 'État encrassement filtre reprise', dataType: 'État', direction: 'read', position: 110 },
    { slug: 'etat.post_ventilation_active', label: 'État post-ventilation active', dataType: 'État', direction: 'read', position: 120 },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication avec l\'automate CTA', dataType: 'Alarme', direction: 'read', position: 130 },
    { slug: 'alarme.manque_debit_air', label: 'Alarme manque de débit d\'air', dataType: 'Alarme', direction: 'read', position: 140 },
    { slug: 'alarme.batterie_postchauffage', label: 'Alarme batterie de postchauffage', dataType: 'Alarme', direction: 'read', position: 150 },
    { slug: 'alarme.incendie', label: 'Alarme incendie', dataType: 'Alarme', direction: 'read', position: 160 },
    { slug: 'alarme.defaut_echangeur', label: 'Défaut échangeur', dataType: 'Alarme', direction: 'read', position: 170 },
    { slug: 'alarme.defaut_sonde_qai', label: 'Défaut sonde qualité d\'air', dataType: 'Alarme', direction: 'read', position: 180 },

    // ── Donnees ecrites ──
    { slug: 'commande.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 10 },
    { slug: 'commande.mode_auto_manuel', label: 'Mode auto/manuel', dataType: 'Commande', direction: 'write', position: 20 },
    { slug: 'commande.mode_chauffage_clim', label: 'Mode chauffage/climatisation', dataType: 'Commande', direction: 'write', position: 30 },
    { slug: 'consigne.soufflage', label: 'Consigne de température de soufflage', dataType: 'Consigne', direction: 'write', unit: '°C', position: 40 },
  ],
};
