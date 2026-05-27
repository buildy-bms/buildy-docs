// Seed des modèles d'équipement complémentaires (top 20 + onduleur PV)
// pour servir de base à Kévin (validation manuelle ensuite via la biblio).
//
// Usage local :   node backend-node/scripts/seed-extra-equipment-templates.mjs
// Usage prod  :   ssh hosteur → cd /opt/buildy-docs && node backend-node/scripts/seed-extra-equipment-templates.mjs
//
// Idempotent : INSERT OR IGNORE par slug. N'écrase JAMAIS un modèle existant
// (règle d'or seeder, cf. CLAUDE.md). Pour réinsérer, supprimer le row + le
// slug du tombstone (`deleted_equipment_template_slugs`).
//
// Conventions rédactionnelles (cf. feedback_af_template_rules) :
// - `description_html` : analyse fonctionnelle, AGNOSTIQUE (pas de marques,
//   pas de protocoles → vont dans preferred_protocols, pas de références
//   à des locaux/zones du bâtiment). Précise que la régulation est portée
//   par l'équipement lui-même et que Buildy supervise sans réguler.
// - `bacs_justification` : statut BACS séparé (article applicable + ce que
//   l'auditeur doit vérifier). AUCUNE référence BACS dans description_html.

const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.BUILDY_DOCS_DB || path.resolve(__dirname, '..', '..', 'data', 'buildy_af.db');
const db = new Database(DB_PATH);

// Phrase canonique réutilisée : positionnement Buildy = supervision sans
// régulation. La régulation reste l'affaire de l'équipement (ou de son
// intégrateur lors de la mise en service).
const BUILDY_POSITIONING = '<p><strong>La régulation de l\'équipement est assurée par l\'équipement lui-même</strong>, soit via la régulation native du fabricant, soit via une régulation portée par l\'intégrateur lors de la mise en service. La solution Buildy supervise les états et les mesures, et porte l\'ensemble des logiques applicatives (programmations horaires, scénarios par usage, mise en cohérence des consignes) en transmettant les commandes appropriées.</p>';

const TEMPLATES = [
  // ─── CHAUFFAGE ────────────────────────────────────────────────────
  {
    slug: 'radiateur-eau-chaude',
    name: 'Radiateur à eau chaude',
    category: 'chauffage',
    icon_value: 'fa-temperature-arrow-up',
    icon_color: '#dc2626',
    default_energy_source: 'district_heating',
    default_device_role: ['emission'],
    preferred_protocols: 'KNX/IP,KNX TP,Modbus TCP,BACnet/IP,Zigbee',
    bacs_articles: 'R175-1 1°',
    description_html: '<p>Émetteur de chaleur alimenté par un circuit hydraulique en eau chaude basse ou haute température. Diffuse la chaleur par rayonnement et convection naturelle. La régulation locale s\'effectue via une tête thermostatique manuelle ou électronique, parfois communicante pour permettre un pilotage par pièce.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1°</strong> (chauffage). Côté décret, l\'émetteur lui-même n\'a pas à être communicant&nbsp;: c\'est la tête thermostatique (ou la vanne de zone en amont) qui doit permettre l\'<strong>arrêt manuel local</strong> (§3) et la <strong>reprise autonome</strong> après coupure (§4). Vérifier que chaque local équipé bénéficie d\'une consigne réglable indépendamment.</p>',
  },
  {
    slug: 'radiateur-electrique-fil-pilote',
    name: 'Radiateur électrique avec fil-pilote',
    category: 'chauffage',
    icon_value: 'fa-bolt-lightning',
    icon_color: '#dc2626',
    default_energy_source: 'electric',
    default_device_role: ['production', 'emission', 'regulation'],
    preferred_protocols: 'KNX/IP,KNX TP,Modbus TCP,Modbus RTU,Zigbee,CPL',
    bacs_articles: 'R175-1 1°',
    description_html: '<p>Radiateur électrique (rayonnant, à inertie ou panneau) doté d\'un 5e fil dit « pilote » qui transmet des ordres codés Confort / Éco / Hors-gel / Arrêt depuis un gestionnaire d\'énergie ou un module radio. Les ordres reçus modulent la consigne du thermostat intégré sans modifier le câblage de puissance.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1°</strong> (chauffage). L\'existence du fil pilote rend l\'émetteur conformable au décret&nbsp;: la commande des ordres Confort/Éco/Arrêt depuis la GTB satisfait l\'<strong>arrêt manuel</strong> (§3) et la programmation par zone. La <strong>reprise autonome</strong> (§4) est garantie si le gestionnaire d\'ordres redémarre seul après coupure secteur.</p>',
  },
  {
    slug: 'radiateur-electrique-sans-fil-pilote',
    name: 'Radiateur électrique sans fil-pilote',
    category: 'chauffage',
    icon_value: 'fa-plug-circle-xmark',
    icon_color: '#dc2626',
    default_energy_source: 'electric',
    default_device_role: ['production', 'emission'],
    preferred_protocols: 'KNX/IP,Modbus TCP,Zigbee',
    bacs_articles: 'R175-1 1°',
    description_html: '<p>Radiateur électrique sans 5e fil&nbsp;: la régulation est intégrée au radiateur (thermostat mécanique ou électronique) et ne se commande pas à distance via ordres codés. Le pilotage centralisé n\'est possible qu\'en intercalant un contacteur d\'asservissement en amont sur la phase d\'alimentation, ou en remplaçant l\'émetteur par un modèle communicant.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1°</strong> (chauffage). Sans fil pilote, la mise en conformité au décret nécessite&nbsp;: (a) ajouter un <strong>contacteur d\'asservissement</strong> en amont, ou (b) remplacer par un modèle avec fil pilote ou pilotage radio. L\'arrêt manuel local (§3) reste assuré par l\'interrupteur ou la consigne mécanique. À chiffrer dans le plan d\'action.</p>',
    bacs_contraindications: '<p>Sans contacteur d\'asservissement ou remplacement, l\'équipement <strong>ne peut pas être piloté par la GTB</strong> et constitue une non-conformité au décret R175-3 §3 (arrêt centralisé impossible).</p>',
  },
  {
    slug: 'convecteur-electrique',
    name: 'Convecteur électrique',
    category: 'chauffage',
    icon_value: 'fa-wind',
    icon_color: '#dc2626',
    default_energy_source: 'electric',
    default_device_role: ['production', 'emission'],
    preferred_protocols: 'KNX/IP,Modbus TCP',
    bacs_articles: 'R175-1 1°',
    description_html: '<p>Émetteur électrique qui diffuse la chaleur par convection forcée d\'une résistance traversée par l\'air. Plus réactif qu\'un radiateur à inertie mais moins confortable sur la durée (assèchement de l\'air, stratification). Souvent utilisé en chauffage d\'appoint, le pilotage centralisé se fait via fil pilote ou contacteur amont, comme pour les autres émetteurs électriques.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1°</strong> (chauffage). Conformité identique au radiateur électrique&nbsp;: vérifier la présence d\'un fil pilote ou d\'un contacteur d\'asservissement pour permettre l\'arrêt centralisé (§3) et la programmation (§4).</p>',
  },
  {
    slug: 'plancher-chauffant-eau',
    name: 'Plancher chauffant à eau (PCBT)',
    category: 'chauffage',
    icon_value: 'fa-square',
    icon_color: '#dc2626',
    default_energy_source: 'district_heating',
    default_device_role: ['distribution', 'emission'],
    preferred_protocols: 'Modbus TCP,BACnet/IP,KNX/IP',
    bacs_articles: 'R175-1 1°',
    description_html: '<p>Réseau hydraulique noyé dans la dalle qui diffuse une chaleur douce et homogène par rayonnement. Alimenté en basse température (typiquement 35-45&nbsp;°C), il s\'accorde bien avec une pompe à chaleur ou une chaudière à condensation. La régulation se fait au niveau du collecteur, avec des vannes thermo-électriques ou motorisées commandées par les thermostats de chaque zone desservie.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1°</strong> (chauffage). La régulation est centralisée via le collecteur motorisé&nbsp;: l\'arrêt centralisé (§3) et la reprise autonome (§4) sont possibles par fermeture des vannes de zone. Inertie élevée du plancher&nbsp;: anticiper le démarrage / l\'arrêt par rapport à l\'occupation.</p>',
  },
  {
    slug: 'plancher-chauffant-electrique',
    name: 'Plancher chauffant électrique',
    category: 'chauffage',
    icon_value: 'fa-square',
    icon_color: '#ef4444',
    default_energy_source: 'electric',
    default_device_role: ['production', 'emission'],
    preferred_protocols: 'KNX/IP,Modbus TCP,Zigbee',
    bacs_articles: 'R175-1 1°',
    description_html: '<p>Câble chauffant noyé dans la dalle ou la chape, piloté par un thermostat de sol avec sonde déportée. Inertie élevée, fonctionnement quasi-continu à basse puissance. La régulation locale est intégrée au thermostat, le pilotage centralisé passe par fil pilote ou contacteur d\'asservissement amont. La limite de température de surface (28&nbsp;°C en zone occupée) est appliquée par le thermostat lui-même.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1°</strong> (chauffage). Pilotage GTB identique aux radiateurs électriques (fil pilote ou contacteur). Anticiper l\'inertie&nbsp;: la consigne doit être abaissée plusieurs heures avant l\'inoccupation pour rester efficace énergétiquement.</p>',
  },

  // ─── THERMIQUE MIXTE ──────────────────────────────────────────────
  {
    slug: 'ventilo-convecteur',
    name: 'Ventilo-convecteur (FCU)',
    category: 'thermique_mixte',
    icon_value: 'fa-fan',
    icon_color: '#0ea5e9',
    default_energy_source: 'district_heating',
    default_device_role: ['emission', 'regulation'],
    preferred_protocols: 'Modbus RTU,Modbus TCP,BACnet MS/TP,BACnet/IP,KNX/IP',
    bacs_articles: 'R175-1 1°, 2°',
    description_html: '<p>Émetteur terminal universel en tertiaire&nbsp;: batterie d\'échange (eau chaude et/ou eau glacée) couplée à un ventilateur. Architecture <strong>2 tubes</strong> (chaud OU froid selon la saison) ou <strong>4 tubes</strong> (chaud ET froid simultanés). Vanne 3 voies par batterie, ventilateur à 3 vitesses ou modulant. Régulation locale par thermostat associé au ventilo-convecteur, avec consigne propre à chaque unité.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1°</strong> (chauffage) et <strong>R175-1 2°</strong> (refroidissement). Régulation par zone par construction&nbsp;: chaque unité a sa consigne propre, l\'arrêt centralisé (§3) et la reprise autonome (§4) sont natifs si le bus de communication est raccordé à la GTB.</p>',
  },
  {
    slug: 'cassette-plafonniere',
    name: 'Cassette plafonnière',
    category: 'thermique_mixte',
    icon_value: 'fa-table-cells-large',
    icon_color: '#0ea5e9',
    default_energy_source: 'heat_pump',
    default_device_role: ['emission'],
    preferred_protocols: 'BACnet/IP,Modbus TCP,Modbus RTU',
    bacs_articles: 'R175-1 1°, 2°',
    description_html: '<p>Unité intérieure de climatisation encastrée dans un faux-plafond, soufflant à 360° (4 voies) ou à 1 voie. Raccordée soit à un système à détente directe (DRV), soit à un réseau hydraulique d\'eau chaude/glacée selon la technologie. La régulation locale (modes auto/froid/chaud/déshumidification, vitesse de ventilateur) est intégrée à l\'unité ou portée par la régulation du système parent.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1° et 2°</strong>. Pilotage GTB possible via la passerelle de communication du système parent (DRV) ou via une vanne 3 voies pour un raccordement hydraulique. Arrêt centralisé (§3) et reprise autonome (§4) garantis par la commande de zone.</p>',
  },
  {
    slug: 'split-mono-multi',
    name: 'Split / Multi-split',
    category: 'thermique_mixte',
    icon_value: 'fa-snowflake',
    icon_color: '#0ea5e9',
    default_energy_source: 'heat_pump',
    default_device_role: ['production', 'emission'],
    preferred_protocols: 'BACnet/IP,Modbus TCP',
    bacs_articles: 'R175-1 1°, 2°',
    description_html: '<p>Climatiseur compact&nbsp;: 1 unité extérieure raccordée à 1 (mono-split) ou plusieurs (multi-split, 2 à 5 max) unités intérieures murales ou plafonnières. Réversible par défaut. La régulation native est portée par l\'unité extérieure et les télécommandes des unités intérieures. L\'intégration à une GTB nécessite l\'ajout d\'une passerelle de communication tierce qui traduit le protocole propriétaire du fabricant en standard ouvert.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 1° et 2°</strong>. Sans passerelle, les splits ne sont pas conformes au décret&nbsp;: l\'arrêt centralisé (§3) et la programmation (§4) restent uniquement locaux. À chiffrer dans le plan d\'action.</p>',
    bacs_contraindications: '<p>Sans passerelle, l\'équipement <strong>n\'est pas pilotable depuis la GTB</strong>. La conformité au décret R175-3 §3 et §4 nécessite obligatoirement l\'ajout de cette interface.</p>',
  },
  {
    slug: 'groupe-eau-glacee',
    name: 'Groupe d\'eau glacée (chiller)',
    category: 'thermique_mixte',
    icon_value: 'fa-temperature-snow',
    icon_color: '#0891b2',
    default_energy_source: 'electric',
    default_device_role: ['production'],
    preferred_protocols: 'BACnet/IP,Modbus TCP,BACnet MS/TP',
    bacs_articles: 'R175-1 2°',
    description_html: '<p>Production centralisée d\'eau glacée (5-12&nbsp;°C) pour alimenter un réseau de ventilo-convecteurs, CTA ou poutres froides. Architectures&nbsp;: à compression (la plus courante), à absorption (réseau de chaleur), ou hybride. La régulation native intègre la variation de capacité des compresseurs, le free-cooling lorsque les conditions extérieures le permettent, et le séquencement entre plusieurs machines.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 2°</strong> (refroidissement). Système central&nbsp;: la régulation est inhérente à la machine elle-même. Vérifier que la carte de communication est bien raccordée à la GTB pour piloter la consigne et lire l\'état de marche / défaut.</p>',
  },

  // ─── VENTILATION ──────────────────────────────────────────────────
  {
    slug: 'vmc-double-flux',
    name: 'VMC double flux',
    category: 'ventilation',
    icon_value: 'fa-arrows-left-right',
    icon_color: '#64748b',
    default_energy_source: 'electric',
    default_device_role: ['distribution', 'regulation', 'emission'],
    preferred_protocols: 'Modbus TCP,BACnet/IP,Modbus RTU',
    bacs_articles: 'R175-1 3°',
    description_html: '<p>Ventilation mécanique avec deux ventilateurs distincts (insufflation et extraction) couplés à un échangeur de récupération de chaleur (rotatif, à plaques, à caloduc). L\'air entrant est préchauffé l\'hiver par l\'air sortant, divisant fortement les pertes par renouvellement d\'air. La régulation native modère le débit selon les sondes embarquées (CO2, présence, horloge interne), gère le bypass d\'été pour le free-cooling nocturne et pilote les moteurs à vitesse variable.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 3°</strong> (ventilation). La régulation de débit est centrale dans la conformité&nbsp;: assure l\'arrêt centralisé (§3), la programmation horaire (§4) et la reprise autonome après coupure. Vérifier le raccordement GTB de la centrale et la cohérence du débit avec l\'occupation réelle.</p>',
  },
  {
    slug: 'vmc-simple-flux',
    name: 'VMC simple flux',
    category: 'ventilation',
    icon_value: 'fa-arrow-right',
    icon_color: '#64748b',
    default_energy_source: 'electric',
    default_device_role: ['distribution', 'emission'],
    preferred_protocols: 'Modbus TCP,KNX/IP',
    bacs_articles: 'R175-1 3°',
    description_html: '<p>Ventilation mécanique à un seul ventilateur (extraction seule, l\'air neuf entre par les entrées d\'air des menuiseries). Solution éprouvée et peu coûteuse, mais moins performante énergétiquement que la double flux. Variantes&nbsp;: autoréglable (débit constant) ou hygroréglable (débit ajusté selon l\'humidité ambiante). La régulation est intégrée à la centrale, le pilotage centralisé se limite généralement à un signal marche/arrêt ou de vitesse.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 3°</strong> (ventilation). Arrêt centralisé (§3) et programmation (§4) possibles via contacteur amont ou variation de vitesse pilotée. La version hygroréglable répond mieux au critère §4 d\'adaptation à la demande.</p>',
  },
  {
    slug: 'extracteur-air',
    name: 'Extracteur d\'air',
    category: 'ventilation',
    icon_value: 'fa-fan',
    icon_color: '#64748b',
    default_energy_source: 'electric',
    default_device_role: ['emission'],
    preferred_protocols: 'KNX/IP,Modbus TCP',
    bacs_articles: 'R175-1 3°',
    description_html: '<p>Ventilateur d\'extraction ponctuel pour évacuer l\'air vicié des usages spécifiques (sanitaires, cuisines, locaux poubelles, parkings). Faible puissance unitaire mais cumul significatif sur un site tertiaire. La régulation locale est portée par un interrupteur, une horloge embarquée, un détecteur de présence ou une sonde dédiée (CO, humidité, fumée). Pilotage centralisé usuel via contacteur amont commandé par la GTB.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 3°</strong>. Régulation typiquement par détection de présence ou hygrométrie&nbsp;: l\'arrêt automatique hors usage répond directement aux §3 et §4. Vérifier que le pilotage horloge / présence est bien centralisé et non purement local.</p>',
  },

  // ─── ECS ──────────────────────────────────────────────────────────
  {
    slug: 'ballon-ecs-electrique',
    name: 'Ballon ECS électrique (cumulus)',
    category: 'ecs',
    icon_value: 'fa-faucet',
    icon_color: '#0891b2',
    default_energy_source: 'electric',
    default_device_role: ['production'],
    preferred_protocols: 'KNX/IP,Modbus TCP,Zigbee',
    bacs_articles: 'R175-1 4°',
    description_html: '<p>Ballon de stockage d\'eau chaude sanitaire chauffé par une résistance électrique immergée. Capacités usuelles de 50&nbsp;L à plus de 1500&nbsp;L selon l\'usage. La régulation est portée par le thermostat interne du ballon&nbsp;: consigne de stockage à 60&nbsp;°C minimum (sécurité sanitaire — légionellose). Le pilotage centralisé se fait via un contacteur amont, généralement asservi à un signal heures creuses / heures pleines ou à une horloge d\'occupation.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 4°</strong> (ECS). Pilotage par contacteur amont&nbsp;: l\'arrêt centralisé hors heures d\'occupation (§3, §4) est immédiat. Attention&nbsp;: la consigne 60&nbsp;°C est obligatoire en stockage pour la sécurité sanitaire (arrêté 30 nov. 2005), un mode « vacances » ne doit pas descendre en dessous.</p>',
  },
  {
    slug: 'chauffe-eau-thermodynamique',
    name: 'Chauffe-eau thermodynamique (PAC ECS)',
    category: 'ecs',
    icon_value: 'fa-temperature-arrow-down',
    icon_color: '#0891b2',
    default_energy_source: 'heat_pump',
    default_device_role: ['production'],
    preferred_protocols: 'Modbus TCP,BACnet/IP',
    bacs_articles: 'R175-1 4°',
    description_html: '<p>Ballon ECS couplé à une mini-pompe à chaleur air/eau qui capte les calories de l\'air ambiant ou extérieur pour chauffer l\'eau. Le COP typique (2,5 à 3,5) divise par 2 à 3 la consommation par rapport à un cumulus électrique. La régulation native gère les modes éco / boost / vacances, l\'enclenchement de l\'appoint électrique en cas de demande forte, et la priorité PAC vs résistance selon la température de la source.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 4°</strong> (ECS). Régulation avancée native&nbsp;: programmation horaire, modes éco/boost, arrêt automatique répondent aux §3 et §4. Vérifier la communication avec la GTB et la cohérence des programmes avec le profil d\'occupation.</p>',
  },
  {
    slug: 'boucle-ecs',
    name: 'Boucle ECS + circulateur',
    category: 'ecs',
    icon_value: 'fa-arrows-rotate',
    icon_color: '#0891b2',
    default_energy_source: 'electric',
    default_device_role: ['distribution'],
    preferred_protocols: 'Modbus TCP,BACnet/IP',
    bacs_articles: 'R175-1 4°',
    description_html: '<p>Réseau bouclé qui maintient l\'eau chaude en circulation entre la production et les points de puisage les plus éloignés. Évite les temps de purge en arrivée au robinet et limite les risques de stagnation. Composé d\'un circulateur (souvent à vitesse variable), d\'une sonde de retour et de vannes d\'équilibrage. La régulation native du circulateur maintient une consigne de retour réglable, en respectant la limite réglementaire (&gt;&nbsp;50&nbsp;°C en circulation).</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 4°</strong>. <strong>L\'arrêt total de la boucle ECS est interdit</strong> (arrêté 30 nov. 2005, risque légionellose). La GTB peut moduler la vitesse du circulateur la nuit mais sans interruption complète. Vérifier la consigne de retour et les enregistrements de température (traçabilité 1 an minimum).</p>',
    bacs_contraindications: '<p>La <strong>coupure complète de la boucle ECS</strong> est <strong>interdite</strong> par l\'arrêté du 30 novembre 2005 (risque de prolifération de légionelles). Seule une variation de vitesse modérée est permise. Un ordre GTB de type « arrêt sur inoccupation » configuré sur le circulateur ECS doit être identifié comme non-conformité sanitaire.</p>',
  },

  // ─── ÉCLAIRAGE ────────────────────────────────────────────────────
  {
    slug: 'detecteur-presence',
    name: 'Détecteur de présence',
    category: 'eclairage',
    icon_value: 'fa-user',
    icon_color: '#f59e0b',
    default_energy_source: 'electric',
    default_device_role: ['regulation'],
    preferred_protocols: 'KNX/IP,KNX TP,DALI,Modbus TCP,Zigbee',
    bacs_articles: 'R175-1 4°',
    description_html: '<p>Capteur infrarouge passif ou hyperfréquence qui détecte la présence d\'occupants dans une zone et pilote automatiquement l\'allumage des luminaires. L\'extinction est temporisée après absence. Souvent combiné à une cellule de luminosité pour ne déclencher l\'éclairage que si l\'éclairement naturel est insuffisant. La logique de commande est embarquée dans le détecteur (seuils et temporisations paramétrables).</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 4°</strong> (éclairage). La détection de présence est une <strong>fonction de régulation automatique au sens du décret</strong>&nbsp;: arrêt automatique hors usage (§3, §4). Vérifier le temps de temporisation et la cohérence avec l\'activité réelle.</p>',
  },
  {
    slug: 'detecteur-luminosite',
    name: 'Détecteur de luminosité',
    category: 'eclairage',
    icon_value: 'fa-sun',
    icon_color: '#f59e0b',
    default_energy_source: 'electric',
    default_device_role: ['regulation'],
    preferred_protocols: 'KNX/IP,DALI,Modbus TCP,Zigbee',
    bacs_articles: 'R175-1 4°',
    description_html: '<p>Sonde photométrique qui mesure l\'éclairement naturel ambiant et pilote la gradation des luminaires pour maintenir un éclairement total constant. La lumière artificielle s\'efface progressivement au profit de la lumière naturelle. La logique de gradation est embarquée dans le détecteur ou dans le contrôleur DALI associé.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 4°</strong>. La gradation automatique selon la luminosité est une <strong>fonction de régulation</strong> directement valorisée par le décret (§4). Vérifier que la consigne d\'éclairement reste pertinente vis-à-vis du seuil normatif applicable à l\'activité.</p>',
  },

  // ─── QAI ──────────────────────────────────────────────────────────
  {
    slug: 'sonde-co2',
    name: 'Sonde CO₂',
    category: 'qai',
    icon_value: 'fa-leaf',
    icon_color: '#10b981',
    default_energy_source: null,
    default_device_role: ['regulation'],
    preferred_protocols: 'Modbus TCP,Modbus RTU,KNX/IP,BACnet/IP,LoRaWAN',
    bacs_articles: 'R175-1 3°',
    description_html: '<p>Capteur de dioxyde de carbone (CO₂) qui mesure la qualité de l\'air intérieur et permet d\'adapter le débit de ventilation à l\'occupation réelle (ventilation à la demande). Seuils usuels&nbsp;: en dessous de 800&nbsp;ppm air sain, entre 800 et 1200&nbsp;ppm tolérable, au-delà de 1500&nbsp;ppm inconfortable. La technologie NDIR (infrarouge non dispersif) est la référence&nbsp;: précision ±50&nbsp;ppm, durée de vie de l\'ordre de 10 ans.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 3°</strong> (ventilation). La régulation du débit d\'air par sonde CO₂ adapte la ventilation à l\'occupation réelle&nbsp;: fonction valorisée par §4 (adaptation à la demande). Vérifier le couplage avec la centrale de ventilation et les seuils paramétrés.</p>',
  },

  // ─── OCCULTATION ──────────────────────────────────────────────────
  {
    slug: 'bso',
    name: 'Brise-soleil orientable (BSO)',
    category: 'occultation',
    icon_value: 'fa-blinds',
    icon_color: '#64748b',
    default_energy_source: 'electric',
    default_device_role: ['regulation'],
    preferred_protocols: 'KNX/IP,KNX TP,Modbus TCP,Somfy IO',
    bacs_articles: 'R175-1 2°',
    description_html: '<p>Store extérieur à lames orientables monté en façade pour gérer les apports solaires&nbsp;: les lames se replient ou s\'inclinent selon la position du soleil. Réduit la charge thermique d\'été et améliore le confort visuel. La régulation native est portée par l\'automate du système (horloge solaire calculant l\'azimut et l\'élévation, sonde d\'ensoleillement, anémomètre pour la mise en sécurité au-delà du vent maximal admissible).</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 2°</strong> (la protection solaire réduit la charge de refroidissement). Le pilotage automatique solaire/vent est une <strong>fonction de régulation au sens du décret</strong>&nbsp;: §3 (arrêt manuel forcé local possible) et §4 (adaptation automatique). Vérifier la priorité utilisateur en cas de souhait manuel.</p>',
  },

  // ─── COMPTAGE ─────────────────────────────────────────────────────
  {
    slug: 'compteur-fioul',
    name: 'Compteur fioul',
    category: 'comptage',
    icon_value: 'fa-droplet',
    icon_color: '#92400e',
    default_energy_source: 'oil',
    default_device_role: ['autre'],
    preferred_protocols: 'M-Bus filaire,Modbus RTU,LoRaWAN',
    bacs_articles: 'R175-3 1°',
    description_html: '<p>Compteur volumétrique installé en sortie de cuve, mesurant la consommation de fioul en litres ou en kWh équivalents (PCI du fioul ≈ 9,9&nbsp;kWh/L). Index relevé manuellement ou transmis automatiquement par bus. Souvent associé à une jauge de niveau pour suivre le stock restant et anticiper les livraisons. La conversion volume → énergie est portée par la régulation du compteur ou par la GTB en aval.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-3 1°</strong> (sous-comptage par énergie). Le décret BACS impose la mesure et l\'analyse continue des consommations par usage et par énergie&nbsp;: un compteur fioul communicant raccordé à la GTB satisfait cette exigence. La fréquence d\'acquisition doit permettre une analyse mensuelle minimum.</p>',
  },
  {
    slug: 'sous-compteur-electrique',
    name: 'Sous-compteur électrique (TGBT/TD)',
    category: 'comptage',
    icon_value: 'fa-bolt',
    icon_color: '#eab308',
    default_energy_source: 'electric',
    default_device_role: ['autre'],
    preferred_protocols: 'Modbus RTU,Modbus TCP,M-Bus IP,BACnet/IP',
    bacs_articles: 'R175-3 1°',
    description_html: '<p>Compteur d\'énergie active triphasé installé en tableau divisionnaire pour mesurer la consommation d\'un sous-ensemble du bâtiment (un usage, un étage, un poste précis). Boîtier modulaire DIN, transformateurs de courant déportés sur les phases mesurées (calibre adapté au courant nominal). Précision typique classe 1 ou 0,5S selon le calibre. La régulation native gère l\'acquisition des index, le calcul des puissances et l\'intégration sur la période.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-3 1°</strong>. Pour respecter le décret, chaque usage (chauffage, climatisation, éclairage, autres) doit être sous-compté&nbsp;: le sous-comptage en tableau divisionnaire est la solution standard. Vérifier la cohérence des transformateurs de courant (calibre, sens) et la stabilité du bus de communication.</p>',
  },

  // ─── PV ───────────────────────────────────────────────────────────
  {
    slug: 'onduleur-pv',
    name: 'Onduleur photovoltaïque',
    category: 'pv',
    icon_value: 'fa-bolt-lightning',
    icon_color: '#facc15',
    default_energy_source: 'solar',
    default_device_role: ['production'],
    preferred_protocols: 'Modbus TCP,SunSpec,Modbus RTU',
    bacs_articles: 'R175-1 4°',
    description_html: '<p>Convertisseur DC→AC qui transforme le courant continu produit par les panneaux PV en courant alternatif injectable sur le réseau électrique ou auto-consommable sur site. Topologies usuelles&nbsp;: string (un onduleur par chaîne de panneaux), multi-string (plusieurs entrées MPPT) ou micro-onduleurs (un par panneau). La régulation native pilote le suivi du point de puissance maximal (MPPT), gère les protections (îlotage, surtension, anti-injection si nécessaire) et expose les indicateurs de production en temps réel.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 4°</strong> (production d\'électricité photovoltaïque sur site). La supervision par la GTB de la production en temps réel et l\'analyse des écarts (production réelle vs théorique) sont des fonctions valorisées par le décret. Vérifier le raccordement de communication et la cohérence des données avec le compteur de production réglementaire.</p>',
  },
  {
    slug: 'batterie-stationnaire',
    name: 'Batterie stationnaire',
    category: 'pv',
    icon_value: 'fa-bolt',
    icon_color: '#facc15',
    default_energy_source: 'electric',
    default_device_role: ['production'],
    preferred_protocols: 'Modbus TCP,SunSpec,CAN',
    bacs_articles: 'R175-1 4°',
    description_html: '<p>Système de stockage électrochimique (Lithium-ion en standard) couplé à un onduleur hybride pour stocker un surplus de production photovoltaïque ou décaler la consommation aux heures creuses. Capacités tertiaire usuelles de quelques kWh à plusieurs centaines de kWh. La régulation native est portée par le BMS (Battery Management System) intégré&nbsp;: gestion thermique des cellules, équilibrage, calcul de l\'état de charge, protection contre les surcharges et décharges profondes.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Concerné par <strong>R175-1 4°</strong> (composant du système de production électrique). Le pilotage GTB du cycle de charge/décharge est une <strong>fonction de régulation avancée</strong>&nbsp;: §4 (adaptation à la demande). Vérifier la stratégie configurée et la cohérence avec le tarif d\'achat / vente de l\'électricité.</p>',
  },

  // ─── AUTRES ───────────────────────────────────────────────────────
  {
    slug: 'passerelle-mb-bn',
    name: 'Passerelle Modbus / BACnet',
    category: 'autres',
    icon_value: 'fa-network-wired',
    icon_color: '#6366f1',
    default_energy_source: null,
    default_device_role: ['autre'],
    preferred_protocols: 'Modbus TCP,BACnet/IP,Modbus RTU,BACnet MS/TP,KNX/IP,M-Bus filaire',
    bacs_articles: 'R175-3',
    description_html: '<p>Boîtier d\'interopérabilité qui traduit un protocole de communication en un autre&nbsp;: typiquement RS-485 vers Ethernet, ou interface propriétaire vers un standard ouvert. Configuration par mappage des adresses (registres source ↔ objets cible). La passerelle ne réalise aucune logique métier&nbsp;: elle relaie les données telles que la régulation amont les expose, et transmet les commandes telles que la GTB les émet.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>La passerelle elle-même n\'est pas un équipement BACS au sens strict, mais elle est <strong>indispensable</strong> pour rendre conformes les équipements aval (chaudières, DRV, splits…) qui ne parlent pas en standard ouvert. Coût à chiffrer dans le plan d\'action.</p>',
  },
  {
    slug: 'onduleur-asi',
    name: 'Onduleur / alimentation secourue (ASI)',
    category: 'autres',
    icon_value: 'fa-battery-three-quarters',
    icon_color: '#6366f1',
    default_energy_source: 'electric',
    default_device_role: ['autre'],
    preferred_protocols: 'Modbus TCP,Modbus RTU,SNMP',
    bacs_articles: null,
    description_html: '<p>Alimentation sans interruption qui sécurise l\'alimentation électrique des équipements critiques (GTB, serveurs, automates) en cas de micro-coupure ou de panne. Batterie interne pour une autonomie typique de quelques minutes à plusieurs heures selon la puissance protégée. La régulation native gère la commutation onduleur ↔ secteur, la surveillance batterie et l\'arrêt propre des équipements connectés en cas d\'autonomie épuisée.</p>' + BUILDY_POSITIONING,
    bacs_justification: '<p>Hors périmètre direct du décret BACS&nbsp;: l\'onduleur sécurise la <em>continuité</em> de la GTB mais n\'est pas un système technique au sens du décret. À mentionner dans la qualification du système global de supervision.</p>',
  },
];

// ─── Insertion idempotente (INSERT OR IGNORE) ───────────────────────
const stmt = db.prepare(`
  INSERT OR IGNORE INTO equipment_templates (
    slug, name, category,
    icon_kind, icon_value, icon_color,
    default_energy_source, default_device_role,
    preferred_protocols, bacs_articles,
    description_html, bacs_justification, bacs_contraindications,
    current_version, position
  ) VALUES (
    @slug, @name, @category,
    'fa', @icon_value, @icon_color,
    @default_energy_source, @default_device_role,
    @preferred_protocols, @bacs_articles,
    @description_html, @bacs_justification, @bacs_contraindications,
    1, 0
  )
`);

let inserted = 0;
let skipped = 0;
for (const t of TEMPLATES) {
  const row = {
    slug: t.slug,
    name: t.name,
    category: t.category,
    icon_value: t.icon_value,
    icon_color: t.icon_color,
    default_energy_source: t.default_energy_source ?? null,
    default_device_role: JSON.stringify(t.default_device_role ?? []),
    preferred_protocols: t.preferred_protocols ?? null,
    bacs_articles: t.bacs_articles ?? null,
    description_html: t.description_html ?? null,
    bacs_justification: t.bacs_justification ?? null,
    bacs_contraindications: t.bacs_contraindications ?? null,
  };
  const r = stmt.run(row);
  if (r.changes > 0) {
    inserted++;
    console.log(`✓ ${t.category.padEnd(18)} | ${t.slug}`);
  } else {
    skipped++;
    console.log(`· ${t.category.padEnd(18)} | ${t.slug} (déjà présent, ignoré)`);
  }
}

console.log(`\nTerminé : ${inserted} créé(s), ${skipped} déjà présent(s). Total: ${TEMPLATES.length}`);
db.close();
