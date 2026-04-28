'use strict';

module.exports = {
  slug: 'aerotherme',
  name: 'Aérotherme',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1',
  bacs_justification: '<p>L\'article R175-1 définit un <strong>système de chauffage</strong> comme la combinaison des composantes nécessaires pour assurer l\'augmentation contrôlée de la température de l\'air intérieur. Un aérotherme, en tant qu\'émetteur de chaleur soufflée, entre dans cette définition.</p><p>Le décret impose que ces systèmes soient <strong>interopérables</strong> avec les autres équipements du bâtiment, qu\'ils puissent être <strong>arrêtés manuellement</strong> et que leur fonctionnement soit <strong>géré de manière autonome</strong> (programmation, supervision, alarmes).</p><p>L\'intégration de l\'aérotherme dans la GTB Buildy permet de superviser sa marche, sa consigne effective et ses défauts, et de transmettre les commandes nécessaires.</p>',
  preferred_protocols: 'Modbus TCP,KNX/IP',
  icon_kind: 'fa',
  icon_value: 'fa-temperature-arrow-up',
  icon_color: '#f97316',
  description_html: `
<p><strong>Un aérotherme est concerné par le décret BACS au titre du système de chauffage (R175-1 §1).</strong></p>
<p>Un aérotherme est un émetteur de chaleur soufflée, alimenté en eau chaude ou en énergie électrique, équipé d\'un ventilateur intégré. La régulation de température et de vitesse de soufflage est assurée localement par le thermostat ou le régulateur dédié. La solution Buildy supervise l\'aérotherme en lisant son état, sa consigne effective et ses éventuels défauts, et peut transmettre une commande marche/arrêt et une consigne de température.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.vitesse_ventilation', label: 'Vitesse de ventilation effective', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'temp.ambiance', label: 'Température d\'ambiance mesurée', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30 },
    { slug: 'consigne.effective', label: 'Consigne de température effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 50 },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 60 },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'cmd.vitesse_ventilation', label: 'Commande vitesse de ventilation', dataType: 'Commande', direction: 'write', position: 110 },
    { slug: 'consigne.temperature', label: 'Consigne de température', dataType: 'Consigne', direction: 'write', unit: '°C', position: 120 },
  ],
};
