'use strict';

module.exports = {
  slug: 'chaudiere',
  name: 'Chaudière / générateur de chaleur',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1',
  bacs_justification: '<p>L\'article R175-1 définit un <strong>système de chauffage</strong> comme la combinaison des composantes nécessaires pour assurer l\'augmentation contrôlée de la température de l\'air intérieur. Une chaudière (et plus largement tout générateur de chaleur) entre directement dans cette définition.</p><p>Le décret impose que la chaudière soit <strong>interopérable</strong> avec les autres systèmes techniques, qu\'elle puisse être <strong>arrêtée manuellement</strong> et qu\'elle soit <strong>gérée de manière autonome</strong> au sein du système BACS, avec un suivi continu de ses paramètres et la remontée des alarmes.</p><p>L\'intégration de la chaudière dans la solution Buildy permet de répondre à ces obligations en remontant les températures, pressions, puissances et défauts, et en exposant les commandes de marche/arrêt et les consignes de température.</p>',
  preferred_protocols: 'Modbus TCP,BACnet/IP,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-fire',
  icon_color: '#ef4444',
  description_html: `
<p>Une chaudière assure la production de chaleur pour le bâtiment, qu\'elle soit alimentée par combustion (gaz, fioul, biomasse), par effet Joule, par pompe à chaleur ou par échange avec un réseau de chaleur.</p>

<p>À ce titre, une chaudière (ou tout générateur de chaleur) est <strong>concernée par le décret BACS au titre du système de chauffage</strong> (R175-1 §1).</p>

<p><strong>La régulation de la chaudière est assurée par l\'équipement lui-même</strong> : régulateur natif du fabricant pour les générateurs simples, ou régulation de chaufferie portée par l\'intégrateur de chauffage (chaufferiste) pour les installations multi-générateurs (cascades, séquences, courbes de chauffe, gestion ECS). Cette régulation pilote en autonomie l\'allumage, la modulation de puissance et la sécurité.</p>

<p>La solution Buildy intervient en aval, en interconnectant la chaudière aux autres systèmes du bâtiment. Elle supervise les températures, pressions, puissances et défauts, et transmet les commandes de marche/arrêt et les consignes de température nécessaires.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'etat.mode', label: 'Mode de fonctionnement (été/hiver/auto)', dataType: 'État', direction: 'read', position: 20, nature: 'Enum' },
    { slug: 'temp.depart_chauffage', label: 'Température départ chauffage', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30, techName: 'Supply_Water_Temp_R', nature: 'Numérique' },
    { slug: 'temp.retour_chauffage', label: 'Température retour chauffage', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40, nature: 'Numérique', techName: 'Return_Water_Temp_R' },
    { slug: 'temp.fumees', label: 'Température fumées', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50, nature: 'Numérique' },
    { slug: 'pression.circuit', label: 'Pression circuit', dataType: 'Mesure', direction: 'read', unit: 'bar', position: 60, nature: 'Numérique', techName: 'Pressure_R' },
    { slug: 'puissance.instantanee', label: 'Puissance instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 70, nature: 'Numérique' },
    { slug: 'consigne.depart_effective', label: 'Consigne départ effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 80, nature: 'Numérique', techName: 'Setpoint_Temp_R' },
    { slug: 'compteur.heures_fonctionnement', label: 'Compteur d\'heures de fonctionnement', dataType: 'Mesure', direction: 'read', unit: 'h', position: 90, nature: 'Numérique' },
    { slug: 'compteur.demarrages', label: 'Nombre de démarrages', dataType: 'Mesure', direction: 'read', position: 100, nature: 'Numérique' },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 110, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.defaut_bruleur', label: 'Défaut brûleur / allumage', dataType: 'Alarme', direction: 'read', position: 120, nature: 'Booléen', techName: 'System_Fault_R' },
    { slug: 'alarme.surchauffe', label: 'Alarme surchauffe', dataType: 'Alarme', direction: 'read', position: 130, nature: 'Booléen', techName: 'System_Fault_R' },
    { slug: 'alarme.manque_eau', label: 'Alarme manque d\'eau / pression basse', dataType: 'Alarme', direction: 'read', position: 140, techName: 'Water_Lack_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication régulateur', dataType: 'Alarme', direction: 'read', position: 150, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 200, techName: 'On_Off_W', nature: 'Booléen' },
    { slug: 'cmd.mode', label: 'Commande mode (été/hiver/auto)', dataType: 'Commande', direction: 'write', position: 210, nature: 'Enum' },
    { slug: 'consigne.depart', label: 'Consigne température départ', dataType: 'Consigne', direction: 'write', unit: '°C', position: 220, techName: 'Setpoint_Temp_W', nature: 'Numérique' },
    { slug: 'consigne.confort_reduit', label: 'Consigne confort/réduit', dataType: 'Consigne', direction: 'write', position: 230, nature: 'Numérique', techName: 'Setpoint_Temp_W' },
  ],
};
