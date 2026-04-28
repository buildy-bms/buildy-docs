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
<p>Une prise de courant pilotée est un point d\'alimentation électrique commutable à distance par un contrôleur. Le contrôleur assure la commutation physique de l\'alimentation et le retour d\'état. La solution Buildy supervise l\'état et la consommation par prise ou par groupe, et porte l\'ensemble des logiques applicatives (programmations horaires, scénarios, coupure des équipements en veille hors plages d\'occupation) en transmettant les commandes d\'activation et de coupure appropriées.</p>
`.trim(),
  points: [
    { slug: 'etat.alimentation', label: 'État alimentation', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'mesure.puissance_instantanee', label: 'Puissance instantanée', dataType: 'Mesure', direction: 'read', unit: 'W', position: 20 },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 30 },
    { slug: 'alarme.surconsommation', label: 'Alarme surconsommation', dataType: 'Alarme', direction: 'read', position: 40 },
    { slug: 'cmd.alimentation', label: 'Commande alimentation (ON/OFF)', dataType: 'Commande', direction: 'write', position: 100 },
  ],
};
