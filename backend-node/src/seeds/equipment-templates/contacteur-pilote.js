'use strict';

module.exports = {
  slug: 'contacteur-pilote',
  name: 'Contacteur piloté',
  category: 'electricite',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'KNX/IP,Modbus TCP,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-power-off',
  icon_color: '#475569',
  description_html: `
<p>Un contacteur piloté est un organe de coupure / mise en service à distance d'un circuit électrique de puissance (gros circuits, départs spécifiques, équipements industriels).</p>

<p>Il diffère de la prise pilotée par sa puissance commutable et son intégration dans l'armoire électrique.</p>

<p><strong>La fonction est portée par le contacteur lui-même</strong> ; la solution Buildy expose la commande et l'état pour les scénarios horaires et la cohérence multi-systèmes (asservissement à la présence, à l'occupation, à un autre système).</p>
`.trim(),
  points: [
    { slug: 'etat.alimentation', label: 'État alimentation', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'cmd.alimentation', label: 'Commande alimentation', dataType: 'Commande', direction: 'write', position: 100, techName: 'On_Off_W', nature: 'Booléen' },
  ],
};
