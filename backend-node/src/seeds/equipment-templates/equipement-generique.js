'use strict';

module.exports = {
  slug: 'equipement-generique',
  name: 'Équipement générique',
  category: 'autres',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'Modbus TCP,BACnet/IP,MQTT',
  icon_kind: 'fa',
  icon_value: 'fa-cube',
  icon_color: '#6b7280',
  description_html: `
<p>Cette catégorie permet de documenter tout équipement technique non couvert par un template dédié : groupe froid, surpresseur, sonde isolée, automate spécifique, etc.</p>

<p><strong>La régulation est assurée par l\'équipement lui-même</strong>, via la régulation native du fabricant ou via une régulation portée par l\'intégrateur du système concerné (chaufferiste, frigoriste, électricien, intégrateur process…) lors de la mise en service.</p>

<p>La solution Buildy supervise les états, mesures et alarmes typiques, et porte les logiques applicatives (programmations horaires, scénarios) en transmettant les commandes appropriées au cas par cas.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'etat.mode', label: 'Mode de fonctionnement', dataType: 'État', direction: 'read', position: 20, nature: 'Booléen' },
    { slug: 'mesure.principale', label: 'Mesure principale', dataType: 'Mesure', direction: 'read', position: 30, nature: 'Numérique' },
    { slug: 'consigne.effective', label: 'Consigne effective', dataType: 'Mesure', direction: 'read', position: 40, techName: 'Setpoint_Temp_R', nature: 'Numérique' },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 50, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 60, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 100, techName: 'On_Off_W', nature: 'Booléen' },
    { slug: 'consigne.principale', label: 'Consigne principale', dataType: 'Consigne', direction: 'write', position: 110, nature: 'Numérique' },
  ],
};
