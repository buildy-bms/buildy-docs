'use strict';

module.exports = {
  slug: 'stores',
  name: 'Stores motorisés',
  category: 'occultation',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'KNX/IP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-blinds-raised',
  icon_color: '#64748b',
  description_html: `
<p>Les stores motorisés (intérieurs ou extérieurs) limitent les apports solaires directs et l\'éblouissement. Leur logique repose sur des scénarios horaires, des sondes solaires ou des ordres manuels. La régulation du déplacement et de l\'inclinaison des lames est portée par le moteur. La solution Buildy supervise position et inclinaison, et peut transmettre les commandes correspondantes.</p>
`.trim(),
  points: [
    { slug: 'mesure.position', label: 'Position effective', dataType: 'Mesure', direction: 'read', unit: '%', position: 10 },
    { slug: 'mesure.inclinaison_lames', label: 'Inclinaison des lames', dataType: 'Mesure', direction: 'read', unit: '°', position: 20 },
    { slug: 'etat.deplacement', label: 'État en cours de déplacement', dataType: 'État', direction: 'read', position: 30 },
    { slug: 'alarme.defaut_moteur', label: 'Défaut moteur', dataType: 'Alarme', direction: 'read', position: 40 },
    { slug: 'cmd.ouverture', label: 'Commande ouverture', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'cmd.fermeture', label: 'Commande fermeture', dataType: 'Commande', direction: 'write', position: 110 },
    { slug: 'cmd.stop', label: 'Commande stop', dataType: 'Commande', direction: 'write', position: 120 },
    { slug: 'cmd.position', label: 'Commande position cible', dataType: 'Commande', direction: 'write', unit: '%', position: 130 },
    { slug: 'cmd.inclinaison_lames', label: 'Commande inclinaison des lames', dataType: 'Commande', direction: 'write', unit: '°', position: 140 },
  ],
};
