'use strict';

/**
 * Plan type d'une Analyse Fonctionnelle Buildy.
 *
 * Source : page Notion "Analyse Fonctionnelle Solution Buildy [PLAN]"
 * https://www.notion.so/buildy/34f6af1b001d81dc96b9d18af6c4e6c5
 *
 * Cette structure est appliquee a chaque nouvelle AF par lib/af-seeder.js.
 *
 * Conventions :
 *   - kind = 'standard' | 'equipment' | 'synthesis' | 'hyperveez_page'
 *   - service_level (chaîne 'E' | 'S' | 'P' | 'E/S/P' | 'S/P' | etc.) calcule
 *     a partir des `features` via service-levels.js
 *   - bacs_articles : texte libre type 'R175-3 §1'
 *   - equipment_template_slug : pour les sections kind='equipment', le slug du
 *     template a cloner depuis la bibliotheque (s'il existe)
 *   - hyperveez_page_slug : pour les sections kind='hyperveez_page', le slug
 *     du catalogue hyperveez-pages.js
 *   - body_placeholder : texte affiche en placeholder Tiptap quand body_html
 *     est vide ('A rediger — Points a couvrir : ...')
 */

const PLAN_AF = [
  // ═══════════ Chapitre 1 — Preambule ═══════════
  {
    number: '1', title: 'Préambule', kind: 'standard',
    children: [
      {
        number: '1.1', title: 'Objet du document', kind: 'standard',
        body_placeholder: `À rédiger — Points à couvrir :
• Nature du document : analyse fonctionnelle de la solution de supervision Buildy déployée sur le site
• Rôle réglementaire : ce document constitue l'analyse fonctionnelle examinée lors de l'inspection périodique obligatoire (Article R175-5-1 du CCH)
• Il est remis au propriétaire à l'issue du chantier et doit être conservé 10 ans`,
        bacs_articles: 'R175-5-1',
      },
      {
        number: '1.2', title: 'Rôle de Buildy dans l\'écosystème GTB', kind: 'standard',
        body_placeholder: `À rédiger — Points à couvrir :
• Buildy est un éditeur et intégrateur de solutions logicielles de supervision et d'hypervision du bâtiment
• La solution Buildy permet de superviser, piloter et analyser les systèmes techniques au travers d'Hyperveez et Gojee
• Buildy lit et écrit des points sur les équipements terrain (mesures, états, consignes, commandes, programmations horaires)
• Buildy n'assure aucune fonction de régulation : la régulation est réalisée par les équipements terrain
• La solution s'appuie sur une infrastructure matérielle dont la maintenance est assurée dans le cadre d'un contrat Smart ou Premium`,
      },
      {
        number: '1.3', title: 'Conformité au décret BACS', kind: 'standard',
        body_placeholder: `À rédiger — Points à couvrir :
• Décret n°2023-259 du 7 avril 2023 (Articles R175-1 à R175-6)
• Les 4 exigences fonctionnelles de l'Article R175-3 auxquelles répond la solution Buildy
• Tableau de correspondance R175-3 ↔ Fonctions Buildy (à intégrer)`,
        bacs_articles: 'R175-3',
      },
      {
        number: '1.4', title: 'Niveaux de service', kind: 'standard',
        body_placeholder: `À rédiger — Points à couvrir :
• Trois niveaux : Licence Essentials, Contrat Smart, Contrat Premium
• Chaque fonctionnalité est étiquetée Essentials, Smart ou Premium dans le document
• Tableau synthétique des grandes fonctionnalités par niveau (auto-généré depuis service-levels.js)`,
      },
    ],
  },

  // ═══════════ Chapitre 2 — Périmètre des équipements ═══════════
  {
    number: '2', title: 'Périmètre des équipements supervisés', kind: 'standard',
    body_placeholder: `Introduction du chapitre — la solution Buildy est agnostique des marques, fabricants et protocoles. Les équipements ci-dessous représentent les catégories typiquement intégrées. Le périmètre exact est défini dans le bon de commande.`,
    children: [
      {
        number: '2.1', title: 'Chauffage & Climatisation', kind: 'standard',
        bacs_articles: 'R175-1 §1, §2',
        body_placeholder: 'Introduction de section : présenter le regroupement chauffage/climatisation et expliquer que ces systèmes assurent le traitement thermique du bâtiment, avec leur propre logique de régulation embarquée.',
        children: [
          { number: '2.1.1', title: 'Chaudières / générateurs de chaleur', kind: 'equipment', equipment_template_slug: 'chaudiere', generic_note: 1 },
          { number: '2.1.2', title: 'Aérothermes', kind: 'equipment', equipment_template_slug: 'aerotherme', generic_note: 1 },
          { number: '2.1.3', title: 'Destratificateurs', kind: 'equipment', equipment_template_slug: 'destratificateur', generic_note: 1 },
          { number: '2.1.4', title: 'Systèmes DRV / VRV / VRF', kind: 'equipment', equipment_template_slug: 'drv', generic_note: 1 },
          { number: '2.1.5', title: 'Rooftops', kind: 'equipment', equipment_template_slug: 'rooftop', generic_note: 1 },
        ],
      },
      {
        number: '2.2', title: 'Ventilation', kind: 'standard',
        bacs_articles: 'R175-1 §3',
        body_placeholder: 'Introduction de section : présenter la ventilation comme l\'ensemble des systèmes assurant le renouvellement de l\'air intérieur.',
        children: [
          { number: '2.2.1', title: 'Centrale de traitement d\'air (CTA)', kind: 'equipment', equipment_template_slug: 'cta', generic_note: 1 },
          { number: '2.2.2', title: 'Autres systèmes de ventilation', kind: 'equipment', equipment_template_slug: 'ventilation-generique', generic_note: 1 },
        ],
      },
      {
        number: '2.3', title: 'Production d\'eau chaude sanitaire', kind: 'equipment',
        bacs_articles: 'R175-1 §4',
        equipment_template_slug: 'ecs', generic_note: 1,
      },
      {
        number: '2.4', title: 'Éclairage et prises de courant pilotées', kind: 'standard',
        bacs_articles: 'R175-1 §4 (éclairage)',
        body_placeholder: 'Introduction : éclairage seul concerné par le décret BACS.',
        children: [
          { number: '2.4.1', title: 'Éclairage intérieur', kind: 'equipment', equipment_template_slug: 'eclairage-interieur', generic_note: 1 },
          { number: '2.4.2', title: 'Éclairage extérieur', kind: 'equipment', equipment_template_slug: 'eclairage-exterieur', generic_note: 1 },
          { number: '2.4.3', title: 'Prises de courant pilotées', kind: 'equipment', equipment_template_slug: 'prises-pilotees', generic_note: 1 },
        ],
      },
      {
        number: '2.5', title: 'Production d\'électricité sur site', kind: 'equipment',
        bacs_articles: 'R175-1 §4',
        equipment_template_slug: 'production-electricite', generic_note: 1,
      },
      {
        number: '2.6', title: 'Comptage énergétique et fluidique', kind: 'standard',
        body_placeholder: 'Introduction : compteurs électricité, gaz, eau, calories. Hors périmètre BACS direct mais contribue à l\'exigence R175-3 §1.',
        children: [
          { number: '2.6.1', title: 'Compteurs électriques', kind: 'equipment', equipment_template_slug: 'compteur-electrique', generic_note: 1 },
          { number: '2.6.2', title: 'Compteurs gaz', kind: 'equipment', equipment_template_slug: 'compteur-gaz', generic_note: 1 },
          { number: '2.6.3', title: 'Compteurs eau', kind: 'equipment', equipment_template_slug: 'compteur-eau', generic_note: 1 },
          { number: '2.6.4', title: 'Compteurs calories', kind: 'equipment', equipment_template_slug: 'compteur-calories', generic_note: 1 },
        ],
      },
      { number: '2.7', title: 'Qualité de l\'air intérieur', kind: 'equipment', equipment_template_slug: 'qai', generic_note: 1 },
      {
        number: '2.8', title: 'Occultation', kind: 'standard',
        body_placeholder: 'Introduction : volets et stores motorisés.',
        children: [
          { number: '2.8.1', title: 'Volets', kind: 'equipment', equipment_template_slug: 'volets', generic_note: 1 },
          { number: '2.8.2', title: 'Stores', kind: 'equipment', equipment_template_slug: 'stores', generic_note: 1 },
        ],
      },
      { number: '2.9', title: 'Équipements de process industriel', kind: 'equipment', equipment_template_slug: 'process-industriel', generic_note: 1 },
      { number: '2.10', title: 'Équipements génériques', kind: 'equipment', equipment_template_slug: 'equipement-generique', generic_note: 1,
        body_placeholder: 'Tout équipement pour lequel Buildy remonte typiquement un état de fonctionnement ou un défaut de synthèse.',
      },
    ],
  },

  // ═══════════ Chapitre 3 — Monitoring ═══════════
  {
    number: '3', title: 'Fonctions de monitoring', kind: 'standard',
    bacs_articles: 'R175-3 §1, §2',
    children: [
      { number: '3.1', title: 'Acquisition des mesures en temps réel', kind: 'standard',
        features: ['hyperveez_acces'],
        body_placeholder: 'Lecture cyclique des points des équipements terrain. Types : mesures analogiques, états TOR, comptages, codes d\'erreur.',
      },
      { number: '3.2', title: 'Historisation des données', kind: 'standard',
        features: ['retention_horaires', 'retention_journalieres', 'retention_mensuelles'],
        body_placeholder: 'Données brutes, horaires, journalières, mensuelles. Durées variables selon niveau de service. R175-3 §1 satisfait à partir de Smart (5 ans mensuelles, exact en S, large en P).',
        bacs_articles: 'R175-3 §1',
      },
      { number: '3.3', title: 'Surveillance de la disponibilité des communications', kind: 'standard',
        features: ['surveillance_communication'],
        body_placeholder: 'Détection automatique des pertes de communication entre la passerelle et les équipements terrain ou le cloud. 24h/24, 365j/an.',
      },
    ],
  },

  // ═══════════ Chapitre 4 — Contrôle & commande ═══════════
  {
    number: '4', title: 'Fonctions de contrôle et de commande', kind: 'standard',
    bacs_articles: 'R175-3 §4',
    children: [
      { number: '4.1', title: 'Commandes manuelles depuis Hyperveez', kind: 'standard',
        features: ['pilotage_equipements_cloud'],
        body_placeholder: 'Écriture de points sur les équipements : marche/arrêt, modes, consignes. Retours d\'état confirmant l\'exécution. La régulation reste au système terrain.',
      },
      { number: '4.2', title: 'Programmations horaires', kind: 'standard',
        features: ['programmations_horaires'],
        body_placeholder: 'Définition des plages horaires depuis Hyperveez. Envoyées aux équipements terrain qui les exécutent en autonomie. Conformité R175-3 §4.',
      },
      { number: '4.3', title: 'Commandes générales virtuelles', kind: 'standard',
        body_placeholder: 'Équipements virtuels regroupant tout ou partie des équipements d\'un même type. Une commande adressée au virtuel est propagée à l\'ensemble. Création par Buildy sur demande (incluse en Smart et Premium, payante en Essentials). Utilisables dès le niveau Essentials une fois créées.',
      },
    ],
  },

  // ═══════════ Chapitre 5 — Alarmes ═══════════
  {
    number: '5', title: 'Fonctions de gestion des alarmes', kind: 'standard',
    bacs_articles: 'R175-3 §2',
    children: [
      { number: '5.1', title: 'Détection et qualification des alarmes', kind: 'standard',
        features: ['console_alarmes_multisite'],
        body_placeholder: 'Détection des dépassements de seuils, défauts d\'équipements, pertes de communication. Qualification : criticité, horodatage, équipement source. Acquittement depuis Hyperveez.',
      },
      { number: '5.2', title: 'Notifications', kind: 'standard',
        features: ['notifications_push'],
        body_placeholder: `Points à couvrir :
• Notifications push smartphone via Gojee
• Emails de synthèse : regroupement par période de 4h, envoyés de 8h à 20h
• Contenu email : date d'apparition, dernier changement d'état, équipement, description, statut, acquitteur
• Pas de mécanisme d'escalade`,
      },
      { number: '5.3', title: 'Historique des alarmes', kind: 'standard',
        features: ['console_alarmes_multisite'],
        body_placeholder: 'Journal horodaté des événements d\'alarme. Consultable depuis Hyperveez dès la licence Essentials.',
      },
    ],
  },

  // ═══════════ Chapitre 6 — Reporting ═══════════
  {
    number: '6', title: 'Fonctions de reporting et d\'analyse', kind: 'standard',
    bacs_articles: 'R175-3 §1, §2',
    children: [
      { number: '6.1', title: 'Tableaux de bord métiers', kind: 'standard',
        features: ['dashboard_cvc', 'dashboard_qai'],
        body_placeholder: 'Vues organisées par domaine technique (CVC, Éclairage, Prises, Défauts techniques...). Chaque vue regroupe données temps réel, historiques, anomalies et programmations horaires.',
      },
      { number: '6.2', title: 'Tableaux de bord de consommations énergétiques', kind: 'standard',
        features: ['dashboards_consommations'],
        body_placeholder: 'Visualisation des consommations par équipement et période. Granularités : journalière, hebdomadaire, mensuelle, annuelle.',
      },
      { number: '6.3', title: 'Détection des dérives et des fuites', kind: 'standard',
        features: ['hyperveez_acces', 'console_alarmes_multisite', 'notifications_push'],
        body_placeholder: `Points à couvrir :
• Configuration de seuils haut/bas par compteur dans Hyperveez
• Trois contextes par compteur : occupation, inoccupation, global
• Périodes définies par programmations horaires hebdomadaires
• Pour chaque seuil : valeur + message d'alerte personnalisé
• Statistiques historiques (moyenne, médiane, min, max) pour aider à calibrer
• Franchissement → alarme (cf. 5.1) + notification (Smart et Premium)`,
      },
      { number: '6.4', title: 'Tableau de bord qualité de l\'air intérieur', kind: 'standard',
        features: ['dashboard_qai'],
        body_placeholder: 'Visualisation des indicateurs QAI (CO2, température, humidité, etc.). Historisation et alertes.',
      },
    ],
  },

  // ═══════════ Chapitre 7 — Traçabilité ═══════════
  {
    number: '7', title: 'Traçabilité interne', kind: 'standard',
    body_placeholder: `Points à couvrir :
• Buildy maintient en interne un journal horodaté des événements système : connexions, déconnexions, commandes émises, modifications de configuration
• Mobilisable dans le cadre des inspections périodiques (R175-5-1) ou d'audits
• Géré par Buildy, non accessible au client dans les applications`,
    bacs_articles: 'R175-5-1',
  },

  // ═══════════ Chapitre 8 — API Buildy Connect ═══════════
  {
    number: '8', title: 'API Buildy Connect — Ouverture vers des systèmes tiers', kind: 'standard',
    features: ['api_cloud'],
    body_placeholder: `Points à couvrir :
• API REST permettant à des systèmes tiers autorisés d'interagir avec les équipements
• Correspond à la fonctionnalité "GTB Flex-Ready" du tableau des offres
• Droits d'accès gérés exclusivement par Buildy (périmètre, lecture seule ou lecture/écriture)
• Un connecteur API REST par système tiers, indépendamment du nombre de sites
• Disponible uniquement en licence Premium`,
  },

  // ═══════════ Chapitre 9 — Support ═══════════
  {
    number: '9', title: 'Support et assistance utilisateur', kind: 'standard',
    features: ['crisp_chat_support', 'support_standard'],
    body_placeholder: `Points à couvrir :
• Module de chat intégré dans Hyperveez et Gojee (Crisp) — Smart et Premium
• Contact email : support@buildy.fr
• Inclus en Smart et Premium, payant en Essentials
• Pas de SLA défini`,
  },

  // ═══════════ Chapitre 10 — Hyperveez ═══════════
  {
    number: '10', title: 'Application Hyperveez', kind: 'standard',
    children: [
      { number: '10.1', title: 'Description générale', kind: 'standard',
        features: ['hyperveez_acces'],
        body_placeholder: 'Application web accessible depuis tout navigateur. Interface principale de supervision et de pilotage pour les exploitants et gestionnaires.',
      },
      { number: '10.2', title: 'Pages et fonctionnalités disponibles', kind: 'standard',
        body_placeholder: 'Section auto-seedée depuis le catalogue Hyperveez (hyperveez-pages.js). Une sous-section par page de l\'UI réelle.',
        children: [], // peuplé dynamiquement par seedAfStructure depuis HYPERVEEZ_PAGES
      },
    ],
  },

  // ═══════════ Chapitre 11 — Gojee ═══════════
  {
    number: '11', title: 'Application Gojee', kind: 'standard',
    features: ['gojee_mobile'],
    children: [
      { number: '11.1', title: 'Description générale', kind: 'standard',
        features: ['gojee_mobile'],
        body_placeholder: 'Application mobile Android et iOS, destinée aux utilisateurs du bâtiment et exploitants en mobilité.',
      },
      { number: '11.2', title: 'Fonctionnalités disponibles', kind: 'standard',
        body_placeholder: `Tableau à intégrer (à confirmer fonctionnalité par fonctionnalité) :
• Supervision temps réel — Smart et Premium
• Notifications push d'alarmes — Smart et Premium
• Support intégré chat — Smart et Premium
• Accès par QR Code sécurisé — Premium uniquement
• Déclarations manuelles d'anomalies — Premium uniquement`,
      },
    ],
  },

  // ═══════════ Chapitre 12 — Synthèse ═══════════
  {
    number: '12', title: 'Tableau de synthèse', kind: 'synthesis',
    body_placeholder: 'Tableau matriciel auto-généré à l\'export depuis le contenu des chapitres précédents. Ajustable manuellement avant export final. Colonnes : Catégorie d\'équipement | Décret BACS | Monitoring | Contrôle & Commande | Alarmes | Reporting & Analyse | Niveau min.',
  },
];

module.exports = { PLAN_AF };
