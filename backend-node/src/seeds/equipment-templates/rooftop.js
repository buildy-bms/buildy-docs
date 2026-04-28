'use strict';

module.exports = {
  slug: 'rooftop',
  name: 'Rooftop',
  category: 'climatisation',
  bacs_articles: 'R175-1 §1, §2, §3',
  bacs_justification: '<p>Un rooftop combine dans un seul équipement compact les <strong>trois fonctions définies par l\'article R175-1</strong> : ventilation (§3), chauffage (§1) et climatisation (§2). Il est donc pleinement concerné par le décret BACS, à plusieurs titres.</p><p>Le décret impose que cet équipement soit <strong>interopérable</strong> avec les autres systèmes techniques du bâtiment, qu\'il puisse être <strong>arrêté manuellement</strong> et qu\'il soit <strong>géré de manière autonome</strong> via le système BACS, avec un suivi continu et la remontée des alarmes.</p><p>L\'intégration du rooftop dans la GTB Buildy permet de superviser les températures, les puissances frigorifique et calorifique, l\'encrassement des filtres et tous les défauts, et de transmettre les commandes et consignes nécessaires.</p>',
  preferred_protocols: 'BACnet/IP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-building',
  icon_color: '#0ea5e9',
  description_html: `
<p><strong>Un rooftop est concerné par le décret BACS au titre de la ventilation (R175-1 §3), du chauffage (§1) et de la climatisation (§2).</strong></p>
<p>Un rooftop est une centrale autonome installée en toiture qui assure le renouvellement d\'air, le chauffage et la climatisation d\'un local ou d\'une zone. Sa régulation est portée par son automate intégré (séquence chaud/froid, mode économique, free cooling). La solution Buildy supervise les températures, les états des composants frigorifiques et de chauffe, les alarmes et les compteurs, et peut transmettre des commandes et consignes depuis l\'application Hyperveez.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.mode', label: 'Mode de fonctionnement (chaud/froid/vent/free cooling)', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'temp.air_neuf', label: 'Température air neuf', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30 },
    { slug: 'temp.air_soufflage', label: 'Température air soufflage', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'temp.air_reprise', label: 'Température air reprise', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50 },
    { slug: 'puissance.frigo', label: 'Puissance frigorifique', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 60 },
    { slug: 'puissance.chauffe', label: 'Puissance de chauffe', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 70 },
    { slug: 'consigne.soufflage_effective', label: 'Consigne soufflage effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 80 },
    { slug: 'etat.encrassement_filtre', label: 'Encrassement filtre', dataType: 'État', direction: 'read', position: 90 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 100 },
    { slug: 'alarme.compresseur', label: 'Défaut compresseur', dataType: 'Alarme', direction: 'read', position: 110 },
    { slug: 'alarme.batterie_chauffe', label: 'Défaut batterie de chauffage', dataType: 'Alarme', direction: 'read', position: 120 },
    { slug: 'alarme.communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 130 },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 200 },
    { slug: 'cmd.mode', label: 'Commande mode (chaud/froid/auto)', dataType: 'Commande', direction: 'write', position: 210 },
    { slug: 'consigne.soufflage', label: 'Consigne température soufflage', dataType: 'Consigne', direction: 'write', unit: '°C', position: 220 },
    { slug: 'consigne.confort_reduit', label: 'Consigne confort/réduit', dataType: 'Consigne', direction: 'write', position: 230 },
  ],
};
