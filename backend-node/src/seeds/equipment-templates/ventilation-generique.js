'use strict';

module.exports = {
  slug: 'ventilation-generique',
  name: 'Système de ventilation (autre que CTA)',
  category: 'ventilation',
  bacs_articles: 'R175-1 §3',
  bacs_justification: 'Tout système assurant le renouvellement de l\'air intérieur entre dans la définition du système de ventilation au sens du décret BACS (R175-1 §3).',
  preferred_protocols: 'Modbus TCP,KNX/IP',
  icon_kind: 'fa',
  icon_value: 'fa-wind',
  icon_color: '#3b82f6',
  description_html: `
<p><strong>Tout système de ventilation est concerné par le décret BACS (R175-1 §3).</strong></p>
<p>Cette catégorie couvre les systèmes de ventilation simple ou double flux qui ne sont pas portés par une CTA (ventilateurs d\'extraction, VMC double flux compactes, tourelles de désenfumage utilisées en confort, etc.). La régulation des vitesses de soufflage et d\'extraction est portée par le régulateur intégré. La solution Buildy supervise les états et alarmes, et peut transmettre des commandes de marche/arrêt et de vitesse.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.vitesse', label: 'Vitesse de fonctionnement effective', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'mesure.debit_souffle', label: 'Débit soufflé', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 30 },
    { slug: 'mesure.debit_extrait', label: 'Débit extrait', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 40 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 50 },
    { slug: 'alarme.encrassement_filtre', label: 'Encrassement filtre', dataType: 'Alarme', direction: 'read', position: 60 },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'cmd.vitesse', label: 'Commande vitesse de fonctionnement', dataType: 'Commande', direction: 'write', position: 110 },
  ],
};
