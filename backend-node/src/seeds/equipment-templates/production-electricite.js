'use strict';

module.exports = {
  slug: 'production-electricite',
  name: 'Production d\'électricité sur site',
  category: 'electricite',
  bacs_articles: 'R175-1 §4',
  bacs_justification: '<p>L\'article R175-1 inclut explicitement la <strong>production d\'électricité sur site</strong> dans la définition des systèmes techniques de bâtiment (§4). Les installations photovoltaïques, cogénérations et micro-éoliennes entrent donc dans le périmètre du décret BACS.</p><p>Le décret impose que ces installations soient <strong>supervisées en continu</strong>, qu\'elles soient <strong>interopérables</strong> avec les autres systèmes techniques (notamment pour optimiser l\'autoconsommation) et qu\'elles puissent être <strong>arrêtées manuellement</strong>.</p><p>L\'intégration de la production électrique dans la GTB Buildy permet de remonter la puissance instantanée, l\'énergie produite, l\'énergie injectée et les défauts pour piloter l\'autoconsommation et détecter les pertes de production.</p>',
  preferred_protocols: 'Modbus TCP,Modbus RTU,SunSpec',
  icon_kind: 'fa',
  icon_value: 'fa-solar-panel',
  icon_color: '#eab308',
  description_html: `
<p><strong>La production d\'électricité sur site est un système technique de bâtiment au sens du décret BACS (R175-1 §4).</strong></p>
<p>Cette catégorie couvre les installations de production locale d\'électricité — onduleurs photovoltaïques, cogénérations, micro-éolien. <strong>La régulation de la production est assurée par l\'équipement lui-même</strong>, via le régulateur natif du fabricant (MPPT, gestion d\'injection, synchronisation réseau, sécurités). La solution Buildy lit la puissance instantanée, l\'énergie produite, l\'état de fonctionnement et les défauts pour permettre l\'analyse de production et l\'autoconsommation.</p>
`.trim(),
  points: [
    { slug: 'etat.production', label: 'État production', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'mesure.puissance_instantanee', label: 'Puissance instantanée produite', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 20 },
    { slug: 'energie.produite_jour', label: 'Énergie produite (jour)', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 30 },
    { slug: 'energie.produite_total', label: 'Énergie totale produite', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 40 },
    { slug: 'energie.injectee_reseau', label: 'Énergie injectée au réseau', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 50 },
    { slug: 'mesure.tension_dc', label: 'Tension DC', dataType: 'Mesure', direction: 'read', unit: 'V', position: 60 },
    { slug: 'mesure.courant_dc', label: 'Courant DC', dataType: 'Mesure', direction: 'read', unit: 'A', position: 70 },
    { slug: 'mesure.rendement', label: 'Rendement instantané', dataType: 'Mesure', direction: 'read', unit: '%', position: 80 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 90 },
    { slug: 'alarme.defaut_isolation', label: 'Défaut isolation', dataType: 'Alarme', direction: 'read', position: 100 },
    { slug: 'alarme.deconnexion_reseau', label: 'Déconnexion réseau', dataType: 'Alarme', direction: 'read', position: 110 },
  ],
};
