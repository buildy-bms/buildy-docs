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
<p>Une prise de courant pilotée est un point d\'alimentation électrique commutable à distance par un contrôleur.</p>

<p><strong>La commutation est assurée par l\'équipement lui-même</strong>, via le contrôleur du fabricant qui assure la commutation physique de l\'alimentation et le retour d\'état.</p>

<p>La solution Buildy supervise l\'état et la consommation par prise ou par groupe, et porte l\'ensemble des logiques applicatives : programmations horaires, scénarios par usage, coupure des équipements en veille hors plages d\'occupation.</p>
`.trim(),
  points: [
    { slug: 'etat.alimentation', label: 'État alimentation', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'mesure.puissance_instantanee', label: 'Puissance instantanée', dataType: 'Mesure', direction: 'read', unit: 'W', position: 20, nature: 'Numérique' },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 30, nature: 'Numérique', techName: 'Active_Energy_Index_R' },
    { slug: 'alarme.surconsommation', label: 'Alarme surconsommation', dataType: 'Alarme', direction: 'read', position: 40, nature: 'Booléen', techName: 'System_Fault_R' },
    { slug: 'cmd.alimentation', label: 'Commande alimentation (ON/OFF)', dataType: 'Commande', direction: 'write', position: 100, techName: 'On_Off_W', nature: 'Booléen' },
  ],
};
