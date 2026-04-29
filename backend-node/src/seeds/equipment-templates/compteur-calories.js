'use strict';

module.exports = {
  slug: 'compteur-calories',
  name: 'Compteur calories',
  category: 'comptage',
  bacs_articles: null,
  bacs_justification: '<p>L\'article R175-3 du décret BACS exige un <strong>suivi continu de la consommation énergétique par usage</strong>. Le comptage thermique (calories pour le chauffage, frigories pour la climatisation) permet de mesurer précisément l\'énergie effectivement délivrée à un sous-réseau, indépendamment de la source d\'énergie primaire.</p><p>Cette mesure est indispensable pour répondre à l\'exigence d\'analyse comparative entre la consommation prévisionnelle et la consommation réelle, et pour détecter les dérives.</p><p>L\'intégration des compteurs de calories dans la solution Buildy permet de remonter en continu l\'énergie thermique délivrée par sous-réseau et d\'alimenter les tableaux de bord énergétiques exigés par le décret.</p>',
  preferred_protocols: 'M-Bus IP,M-Bus filaire,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-temperature-half',
  icon_color: '#f97316',
  description_html: `
<p>Un compteur de calories mesure l\'énergie thermique délivrée à un sous-réseau (chauffage, climatisation, ECS) à partir des températures aller/retour et du débit.</p>

<p>Le comptage thermique (calories ou frigories) est une <strong>exigence du décret BACS</strong> (R175-3) pour le suivi des consommations thermiques.</p>

<p>La <strong>métrologie est portée par le compteur lui-même</strong>.</p>

<p>La solution Buildy lit l\'index, la puissance et le débit pour alimenter les tableaux de bord par poste de consommation.</p>
`.trim(),
  points: [
    // Index thermique obligatoire ; reste optionnel pour les sites qui veulent
    // le detail de l'echange thermique.
    { slug: 'energie.totale', label: 'Énergie thermique totale (index)', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 10, techName: 'Thermal_Energy_Index_R', nature: 'Numérique' },
    { slug: 'mesure.puissance', label: 'Puissance instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 20, isOptional: true, nature: 'Numérique' },
    { slug: 'mesure.debit', label: 'Débit instantané', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 30, isOptional: true, nature: 'Numérique' },
    { slug: 'temp.depart', label: 'Température départ', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40, isOptional: true, techName: 'Supply_Water_Temp_R', nature: 'Numérique' },
    { slug: 'temp.retour', label: 'Température retour', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50, isOptional: true, techName: 'Return_Water_Temp_R', nature: 'Numérique' },
    { slug: 'temp.delta', label: 'Écart de température (Δt)', dataType: 'Mesure', direction: 'read', unit: 'K', position: 60, isOptional: true, nature: 'Numérique' },
    { slug: 'volume.total', label: 'Volume total circulé', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 70, isOptional: true, techName: 'Volume_Index_R', nature: 'Numérique' },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 80, isOptional: true, techName: 'System_Fault_R', nature: 'Booléen' },
  ],
};
