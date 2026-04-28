'use strict';

module.exports = {
  slug: 'compteur-eau',
  name: 'Compteur eau',
  category: 'comptage',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'M-Bus IP,M-Bus filaire,Modbus RTU,LoRaWAN',
  icon_kind: 'fa',
  icon_value: 'fa-droplet',
  icon_color: '#0ea5e9',
  description_html: `
<p>Un compteur d\'eau mesure le volume d\'eau consommé sur le bâtiment ou par usage (sanitaires, ECS, arrosage, process). La métrologie est portée par le compteur. La solution Buildy lit l\'index et le débit instantané pour alimenter les tableaux de bord et détecter les fuites éventuelles (consommation continue hors plages d\'occupation).</p>
`.trim(),
  points: [
    { slug: 'volume.total', label: 'Volume total consommé (index)', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 10 },
    { slug: 'volume.partiel', label: 'Volume partiel (index réinitialisable)', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 20 },
    { slug: 'mesure.debit_instantane', label: 'Débit instantané', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 30 },
    { slug: 'alarme.fuite_potentielle', label: 'Alarme fuite potentielle (consommation continue)', dataType: 'Alarme', direction: 'read', position: 40 },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 50 },
  ],
};
