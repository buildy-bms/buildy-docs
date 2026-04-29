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
<p>Un compteur d\'eau mesure le volume d\'eau consommé sur le bâtiment ou par usage (sanitaires, ECS, arrosage, process).</p>

<p>La <strong>métrologie est portée par le compteur lui-même</strong>.</p>

<p>La solution Buildy lit l\'index et le débit instantané pour alimenter les tableaux de bord et détecter les fuites éventuelles (consommation continue hors plages d\'occupation).</p>
`.trim(),
  points: [
    // Index obligatoire, autres mesures optionnelles.
    { slug: 'volume.total', label: 'Volume total consommé (index)', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 10, techName: 'Volume_Index_R', nature: 'Numérique' },
    { slug: 'volume.partiel', label: 'Volume partiel (index réinitialisable)', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 20, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.debit_instantane', label: 'Débit instantané', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 30, isOptional: true, nature: 'Numérique' },
    { slug: 'alarme.fuite_potentielle', label: 'Alarme fuite potentielle (consommation continue)', dataType: 'Alarme', direction: 'read', position: 40, isOptional: true, nature: 'Booléen' },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 50, isOptional: true, techName: 'System_Fault_R', nature: 'Booléen' },
  ],
};
