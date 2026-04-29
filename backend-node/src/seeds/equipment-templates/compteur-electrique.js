'use strict';

module.exports = {
  slug: 'compteur-electrique',
  name: 'Compteur électrique',
  category: 'comptage',
  bacs_articles: null,
  bacs_justification: '<p>L\'article R175-3 du décret BACS exige que le système d\'automatisation et de contrôle assure un <strong>suivi continu, un enregistrement et une analyse de la consommation énergétique</strong> du bâtiment, par usage et par source d\'énergie.</p><p>Le comptage électrique est l\'instrument indispensable à cette obligation : il fournit les index, puissances et consommations qui alimentent les tableaux de bord énergétiques et la détection de dérives exigés par le décret.</p><p>L\'intégration des compteurs électriques dans la solution Buildy permet de remonter en continu les paramètres électriques pour répondre à cette exigence et alerter en cas d\'écart par rapport aux profils de consommation attendus.</p>',
  preferred_protocols: 'Modbus TCP,Modbus RTU,M-Bus IP',
  icon_kind: 'fa',
  icon_value: 'fa-bolt',
  icon_color: '#facc15',
  description_html: `
<p>Un compteur électrique mesure la consommation et restitue les paramètres électriques : puissance, énergie, courant, tension, facteur de puissance.</p>

<p>Le comptage énergétique est une <strong>exigence du décret BACS</strong> (R175-3) pour le suivi continu de la consommation.</p>

<p>La <strong>logique métrologique est portée par le compteur lui-même</strong>.</p>

<p>La solution Buildy lit l\'index, la puissance instantanée et les paramètres électriques pour alimenter les tableaux de bord énergétiques et la détection de dérives.</p>
`.trim(),
  points: [
    // Seul l'index est obligatoire (consigne Buildy : "chez nous on regarde l'index").
    // Le reste reste disponible mais marque optionnel : decoche par defaut, activable
    // a l'instance pour les sites tertiaires qui ont besoin du detail electrique.
    { slug: 'energie.active_total', label: 'Énergie active totale (index)', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 10, techName: 'Active_Energy_Index_R', nature: 'Numérique' },
    { slug: 'energie.active_partielle', label: 'Énergie active partielle (index réinitialisable)', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 20, isOptional: true, nature: 'Numérique' },
    { slug: 'puissance.active', label: 'Puissance active instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 30, isOptional: true, nature: 'Numérique' },
    { slug: 'puissance.reactive', label: 'Puissance réactive instantanée', dataType: 'Mesure', direction: 'read', unit: 'kVAR', position: 40, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.tension_l1', label: 'Tension phase 1', dataType: 'Mesure', direction: 'read', unit: 'V', position: 50, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.tension_l2', label: 'Tension phase 2', dataType: 'Mesure', direction: 'read', unit: 'V', position: 60, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.tension_l3', label: 'Tension phase 3', dataType: 'Mesure', direction: 'read', unit: 'V', position: 70, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.courant_l1', label: 'Courant phase 1', dataType: 'Mesure', direction: 'read', unit: 'A', position: 80, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.courant_l2', label: 'Courant phase 2', dataType: 'Mesure', direction: 'read', unit: 'A', position: 90, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.courant_l3', label: 'Courant phase 3', dataType: 'Mesure', direction: 'read', unit: 'A', position: 100, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.frequence', label: 'Fréquence', dataType: 'Mesure', direction: 'read', unit: 'Hz', position: 110, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.cos_phi', label: 'Facteur de puissance', dataType: 'Mesure', direction: 'read', position: 120, isOptional: true, nature: 'Numérique' },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 130, isOptional: true, techName: 'System_Fault_R', nature: 'Booléen' },
  ],
};
