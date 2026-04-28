'use strict';

module.exports = {
  slug: 'volets',
  name: 'Volets motorisés',
  category: 'occultation',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'KNX/IP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-blinds',
  icon_color: '#64748b',
  description_html: `
<p>Les volets motorisés contribuent à la gestion solaire passive et au confort thermique en pilotant l\'ensoleillement entrant. Leur motorisation assure les fonctions techniques de bas niveau : déplacement, retour de position, sécurité (vent, fin de course). La solution Buildy supervise leur position et porte l\'ensemble des logiques applicatives (programmations horaires, scénarios solaires, mise en cohérence avec la climatisation et l\'éclairage) en transmettant les commandes d\'ouverture, de fermeture et de positionnement appropriées.</p>
`.trim(),
  points: [
    { slug: 'mesure.position', label: 'Position effective', dataType: 'Mesure', direction: 'read', unit: '%', position: 10 },
    { slug: 'etat.deplacement', label: 'État en cours de déplacement', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'alarme.defaut_moteur', label: 'Défaut moteur', dataType: 'Alarme', direction: 'read', position: 30 },
    { slug: 'cmd.ouverture', label: 'Commande ouverture', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'cmd.fermeture', label: 'Commande fermeture', dataType: 'Commande', direction: 'write', position: 110 },
    { slug: 'cmd.stop', label: 'Commande stop', dataType: 'Commande', direction: 'write', position: 120 },
    { slug: 'cmd.position', label: 'Commande position cible', dataType: 'Commande', direction: 'write', unit: '%', position: 130 },
  ],
};
