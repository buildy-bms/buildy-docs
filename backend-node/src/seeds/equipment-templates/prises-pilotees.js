'use strict';

module.exports = {
  slug: 'prises-pilotees',
  name: 'Prises de courant pilotées',
  category: 'electricite',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'KNX/IP,Modbus TCP,Zigbee',
  icon_kind: 'fa',
  icon_value: 'fa-plug',
  icon_color: '#a855f7',
  description_html: `
<p>Les prises de courant pilotées sont commandées à distance pour couper l\'alimentation des équipements en veille (bureautique, équipements non essentiels) hors plages d\'occupation. La logique de pilotage repose sur des programmations horaires ou des scénarios. La solution Buildy supervise l\'état et la consommation par prise ou par groupe de prises, et peut transmettre des commandes d\'activation depuis l\'application Hyperveez.</p>
`.trim(),
  points: [
    { slug: 'etat.alimentation', label: 'État alimentation', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'mesure.puissance_instantanee', label: 'Puissance instantanée', dataType: 'Mesure', direction: 'read', unit: 'W', position: 20 },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 30 },
    { slug: 'alarme.surconsommation', label: 'Alarme surconsommation', dataType: 'Alarme', direction: 'read', position: 40 },
    { slug: 'cmd.alimentation', label: 'Commande alimentation (ON/OFF)', dataType: 'Commande', direction: 'write', position: 100 },
  ],
};
