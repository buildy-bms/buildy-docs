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
<p>Les volets motorisés contribuent à la gestion solaire passive et au confort thermique en pilotant l\'ensoleillement entrant.</p>

<p><strong>La motorisation et la régulation des volets sont assurées par l\'équipement lui-même</strong>, via le moteur fourni par le fabricant ou via une configuration portée par l\'intégrateur du lot menuiserie/électricien lors de la mise en service. La motorisation assure les fonctions techniques de bas niveau : déplacement, retour de position, sécurité (vent, fin de course).</p>

<p>La solution Buildy supervise leur position et porte l\'ensemble des logiques applicatives transverses : programmations horaires, scénarios solaires, mise en cohérence avec la climatisation et l\'éclairage.</p>
`.trim(),
  points: [
    { slug: 'mesure.position', label: 'Position effective', dataType: 'Mesure', direction: 'read', unit: '%', position: 10, techName: 'Position_R', nature: 'Numérique' },
    { slug: 'etat.deplacement', label: 'État en cours de déplacement', dataType: 'État', direction: 'read', position: 20, nature: 'Booléen', techName: 'Up_Down_R' },
    { slug: 'alarme.defaut_moteur', label: 'Défaut moteur', dataType: 'Alarme', direction: 'read', position: 30, nature: 'Booléen', techName: 'System_Fault_R' },
    { slug: 'cmd.ouverture', label: 'Commande ouverture', dataType: 'Commande', direction: 'write', position: 100, techName: 'Auto_Open_W', nature: 'Booléen' },
    { slug: 'cmd.fermeture', label: 'Commande fermeture', dataType: 'Commande', direction: 'write', position: 110, nature: 'Booléen', techName: 'Up_Down_W' },
    { slug: 'cmd.stop', label: 'Commande stop', dataType: 'Commande', direction: 'write', position: 120, nature: 'Booléen', techName: 'Stop_W' },
    { slug: 'cmd.position', label: 'Commande position cible', dataType: 'Commande', direction: 'write', unit: '%', position: 130, techName: 'Position_W', nature: 'Numérique' },
  ],
};
