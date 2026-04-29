'use strict';

module.exports = {
  slug: 'ventilation-generique',
  name: 'Système de ventilation (autre que CTA)',
  category: 'ventilation',
  bacs_articles: 'R175-1 §3',
  bacs_justification: '<p>L\'article R175-1 définit un <strong>système de ventilation</strong> comme la combinaison des composantes nécessaires pour assurer le renouvellement de l\'air intérieur. Tout équipement remplissant cette fonction (VMC, ventilateurs d\'extraction, tourelles utilisées en confort) entre dans cette définition.</p><p>Le décret impose que ces systèmes soient <strong>interopérables</strong>, qu\'ils puissent être <strong>arrêtés manuellement</strong> et qu\'ils soient <strong>gérés de manière autonome</strong> par le système BACS (programmation horaire, supervision continue, alarmes).</p><p>L\'intégration de ces ventilations dans la solution Buildy permet de remonter leur état et leurs débits, et de transmettre les commandes de marche/vitesse appropriées.</p>',
  preferred_protocols: 'Modbus TCP,KNX/IP',
  icon_kind: 'fa',
  icon_value: 'fa-wind',
  icon_color: '#3b82f6',
  description_html: `
<p>Cette catégorie couvre les systèmes de ventilation simple ou double flux qui ne sont pas portés par une CTA (ventilateurs d\'extraction, VMC double flux compactes, tourelles de désenfumage utilisées en confort, etc.).</p>

<p>Tout système de ventilation est <strong>concerné par le décret BACS</strong> (R175-1 §3).</p>

<p><strong>La régulation de ces ventilations est assurée par l\'équipement lui-même</strong>, via le régulateur intégré fourni par le fabricant ou via une régulation portée par l\'intégrateur ventilation lors de la mise en service.</p>

<p>La solution Buildy supervise les états et alarmes, et peut transmettre des commandes de marche/arrêt et de vitesse.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.niveau', label: 'Niveau ventilation effectif (1, 2, 3...)', dataType: 'État', direction: 'read', position: 15, nature: 'Enum' },
    { slug: 'mesure.vitesse', label: 'Vitesse ventilation effective', dataType: 'Mesure', direction: 'read', unit: '%', position: 20, isOptional: true },
    { slug: 'mesure.debit_souffle', label: 'Débit soufflé', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 30, isOptional: true },
    { slug: 'mesure.debit_extrait', label: 'Débit extrait', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 40, isOptional: true },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 50 },
    { slug: 'alarme.encrassement_filtre', label: 'Encrassement filtre', dataType: 'Alarme', direction: 'read', position: 60, isOptional: true },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'cmd.niveau', label: 'Commande niveau ventilation (discret)', dataType: 'Commande', direction: 'write', position: 110, nature: 'Enum' },
    { slug: 'cmd.vitesse', label: 'Commande vitesse ventilation (continue)', dataType: 'Commande', direction: 'write', unit: '%', position: 120, isOptional: true },
  ],
};
