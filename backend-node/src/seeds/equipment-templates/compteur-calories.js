'use strict';

module.exports = {
  slug: 'compteur-calories',
  name: 'Compteur calories',
  category: 'comptage',
  bacs_articles: 'R175-3',
  bacs_justification: '<p>L\'article R175-3 du décret BACS exige un <strong>suivi continu de la consommation énergétique par usage</strong>. Le comptage thermique (calories pour le chauffage, frigories pour la climatisation) permet de mesurer précisément l\'énergie effectivement délivrée à un sous-réseau, indépendamment de la source d\'énergie primaire.</p><p>Cette mesure est indispensable pour répondre à l\'exigence d\'analyse comparative entre la consommation prévisionnelle et la consommation réelle, et pour détecter les dérives.</p><p>L\'intégration des compteurs de calories dans la GTB Buildy permet de remonter en continu l\'énergie thermique délivrée par sous-réseau et d\'alimenter les tableaux de bord énergétiques exigés par le décret.</p>',
  preferred_protocols: 'M-Bus IP,M-Bus filaire,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-temperature-half',
  icon_color: '#f97316',
  description_html: `
<p><strong>Le comptage de calories (ou frigories) est une exigence du décret BACS (R175-3) pour le suivi des consommations thermiques.</strong></p>
<p>Un compteur de calories mesure l\'énergie thermique délivrée à un sous-réseau (chauffage, climatisation, ECS) à partir des températures aller/retour et du débit. La métrologie est portée par le compteur. La solution Buildy lit l\'index, la puissance et le débit pour alimenter les tableaux de bord par poste de consommation.</p>
`.trim(),
  points: [
    { slug: 'energie.totale', label: 'Énergie thermique totale (index)', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 10 },
    { slug: 'mesure.puissance', label: 'Puissance instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 20 },
    { slug: 'mesure.debit', label: 'Débit instantané', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 30 },
    { slug: 'temp.depart', label: 'Température départ', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'temp.retour', label: 'Température retour', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50 },
    { slug: 'temp.delta', label: 'Écart de température (Δt)', dataType: 'Mesure', direction: 'read', unit: 'K', position: 60 },
    { slug: 'volume.total', label: 'Volume total circulé', dataType: 'Mesure', direction: 'read', unit: 'm³', position: 70 },
    { slug: 'alarme.defaut_communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 80 },
  ],
};
