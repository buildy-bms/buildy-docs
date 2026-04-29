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
  bacs_justification: '<p>L\'article R175-1 définit un <strong>système de ventilation</strong> comme la combinaison des composantes nécessaires pour assurer le renouvellement de l\'air intérieur. Une CTA entre dans cette définition, et selon sa configuration peut aussi répondre aux définitions de système de chauffage (§1) et de climatisation (§2).</p><p>Le décret impose que ces systèmes soient <strong>interopérables</strong> avec les autres systèmes techniques du bâtiment, qu\'ils puissent être <strong>arrêtés manuellement</strong> et qu\'ils soient <strong>gérés de manière autonome</strong> par le système BACS (suivi continu, alarmes, programmation horaire).</p><p>L\'intégration de la CTA dans la solution Buildy permet de répondre à ces obligations en supervisant les températures, les débits, les états des composants et en exposant les commandes nécessaires au pilotage à distance.</p>',
  preferred_protocols: 'Modbus TCP,BACnet/IP',
  icon_kind: 'fa',
  icon_value: 'fa-fan',
  icon_color: '#3b82f6',
  description_html: `
<p>Une centrale de traitement d'air assure le renouvellement, le filtrage et le conditionnement de l'air insufflé dans le bâtiment.</p>

<p>Selon sa configuration, une CTA peut être concernée par une ou plusieurs définitions du décret BACS :</p>
<ul>
<li>Système de ventilation (R175-1 §3) — dans tous les cas</li>
<li>Système de chauffage (R175-1 §1) — si la CTA intègre une batterie de chauffe</li>
<li>Système de climatisation (R175-1 §2) — si la CTA intègre une batterie de froid</li>
</ul>

<p><strong>La régulation de la CTA est assurée par l'équipement lui-même</strong>, via la régulation embarquée fournie par le fabricant ou via une régulation portée par l'intégrateur du lot CVC (frigoriste, intégrateur ventilation) lors de la mise en service. Cette régulation gère en autonomie la logique de fonctionnement bas niveau : séquences chaud/froid, modulation, sécurités.</p>

<p>La solution Buildy intervient en aval, en interconnectant la CTA aux autres systèmes du bâtiment. Elle supervise les états et mesures, transmet les commandes et consignes nécessaires, et porte les logiques applicatives transverses (programmations horaires, scénarios par usage, mise en cohérence multi-systèmes).</p>
`.trim(),
  points: [
    // ── Donnees lues ──
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.mode_fonctionnement', label: 'Mode de fonctionnement (manuel / automatique)', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'temp.air_neuf', label: 'Température air neuf', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30 },
    { slug: 'temp.air_soufflage', label: 'Température air soufflage', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'temp.air_reprise', label: 'Température air reprise', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50 },
    { slug: 'temp.air_rejet', label: 'Température air rejet', dataType: 'Mesure', direction: 'read', unit: '°C', position: 60, isOptional: true },
    { slug: 'debit.soufflage', label: 'Débit soufflage', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 70 },
    { slug: 'debit.reprise', label: 'Débit reprise', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 80, isOptional: true },
    { slug: 'consigne.soufflage_effective', label: 'Consigne de température de soufflage effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 90 },
    { slug: 'mesure.co2', label: 'Concentration CO2', dataType: 'Mesure', direction: 'read', unit: 'ppm', position: 95, isOptional: true },
    { slug: 'etat.filtre_soufflage_encrasse', label: 'État encrassement filtre soufflage', dataType: 'État', direction: 'read', position: 100 },
    { slug: 'etat.filtre_reprise_encrasse', label: 'État encrassement filtre reprise', dataType: 'État', direction: 'read', position: 110, isOptional: true },
    { slug: 'etat.post_ventilation_active', label: 'État post-ventilation active', dataType: 'État', direction: 'read', position: 120, isOptional: true },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication avec l\'automate CTA', dataType: 'Alarme', direction: 'read', position: 130 },
    { slug: 'alarme.manque_debit_air', label: 'Alarme manque de débit d\'air', dataType: 'Alarme', direction: 'read', position: 140, isOptional: true },
    { slug: 'alarme.batterie_postchauffage', label: 'Alarme batterie de postchauffage', dataType: 'Alarme', direction: 'read', position: 150, isOptional: true },
    { slug: 'alarme.antigel', label: 'Alarme antigel batterie', dataType: 'Alarme', direction: 'read', position: 155, isOptional: true },
    { slug: 'alarme.incendie', label: 'Alarme incendie', dataType: 'Alarme', direction: 'read', position: 160, isOptional: true },
    { slug: 'alarme.defaut_echangeur', label: 'Défaut échangeur', dataType: 'Alarme', direction: 'read', position: 170, isOptional: true },
    { slug: 'alarme.defaut_sonde_qai', label: 'Défaut sonde qualité d\'air', dataType: 'Alarme', direction: 'read', position: 180, isOptional: true },
    { slug: 'alarme.code_erreur', label: 'Code erreur constructeur', dataType: 'Alarme', direction: 'read', position: 190, isOptional: true },

    // ── Donnees ecrites ──
    // On garde les slugs commande.* historiques pour ne pas creer de doublons
    // en prod : le seeder n'updatera pas les slugs existants, donc renommer
    // creerait deux points (l'ancien commande.X reste, le nouveau cmd.X est
    // ajoute). L'harmonisation eventuelle sera faite via une migration ciblee.
    { slug: 'commande.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 10 },
    { slug: 'commande.mode_auto_manuel', label: 'Mode auto/manuel', dataType: 'Commande', direction: 'write', position: 20, isOptional: true },
    { slug: 'commande.mode_chauffage_clim', label: 'Mode chauffage/climatisation', dataType: 'Commande', direction: 'write', position: 30, isOptional: true },
    { slug: 'consigne.soufflage', label: 'Consigne de température de soufflage', dataType: 'Consigne', direction: 'write', unit: '°C', position: 40 },
  ],
};
