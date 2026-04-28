'use strict';

module.exports = {
  slug: 'compteur-gaz',
  name: 'Compteur gaz',
  category: 'comptage',
  bacs_articles: 'R175-3',
  bacs_justification: 'Le comptage énergétique du gaz fait partie des fonctions exigées par le décret BACS (R175-3) pour le suivi continu des consommations.',
  preferred_protocols: 'M-Bus IP,M-Bus filaire,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-fire-flame-simple',
  icon_color: '#fb923c',
  description_html: `
<p><strong>Le comptage énergétique du gaz est une exigence du décret BACS (R175-3).</strong></p>
<p>Un compteur gaz mesure le volume consommé et restitue, le cas échéant, l\'énergie correspondante via un coefficient PCS. La métrologie est portée par le compteur. La solution Buildy lit l\'index, le débit instantané et alimente les tableaux de bord énergétiques et la détection de dérives.</p>
`.trim(),
  points: [
    { slug: 'volume.total', label: 'Volume total consommé (index)', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 10 },
    { slug: 'volume.partiel', label: 'Volume partiel (index réinitialisable)', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 20 },
    { slug: 'energie.totale', label: 'Énergie totale consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 30 },
    { slug: 'mesure.debit_instantane', label: 'Débit instantané', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 40 },
    { slug: 'mesure.pression', label: 'Pression', dataType: 'Mesure', direction: 'read', unit: 'mbar', position: 50 },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 60 },
  ],
};
