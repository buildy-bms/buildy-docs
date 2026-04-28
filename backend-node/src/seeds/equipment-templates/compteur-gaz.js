'use strict';

module.exports = {
  slug: 'compteur-gaz',
  name: 'Compteur gaz',
  category: 'comptage',
  bacs_articles: null,
  bacs_justification: '<p>L\'article R175-3 du décret BACS exige un <strong>suivi continu et l\'analyse de la consommation énergétique</strong> du bâtiment, par source d\'énergie. Le gaz, lorsqu\'il alimente les systèmes de chauffage ou la production d\'ECS, doit donc être compté en continu.</p><p>Le compteur gaz fournit les index, débits instantanés et énergie consommée que la solution Buildy expose pour produire les tableaux de bord énergétiques et détecter les anomalies de consommation.</p><p>L\'intégration du compteur gaz dans la solution Buildy permet de remonter ces données en continu et de corréler la consommation gaz avec le fonctionnement des générateurs de chaleur.</p>',
  preferred_protocols: 'M-Bus IP,M-Bus filaire,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-fire-flame-simple',
  icon_color: '#fb923c',
  description_html: `
<p>Un compteur gaz mesure le volume consommé et restitue, le cas échéant, l\'énergie correspondante via un coefficient PCS.</p>

<p>Le comptage énergétique du gaz est une <strong>exigence du décret BACS</strong> (R175-3).</p>

<p>La <strong>métrologie est portée par le compteur lui-même</strong>.</p>

<p>La solution Buildy lit l\'index et le débit instantané pour alimenter les tableaux de bord énergétiques et la détection de dérives.</p>
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
