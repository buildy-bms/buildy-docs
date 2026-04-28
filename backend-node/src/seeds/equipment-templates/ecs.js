'use strict';

module.exports = {
  slug: 'ecs',
  name: 'Production d\'eau chaude sanitaire',
  category: 'ecs',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'Modbus TCP,Modbus RTU,M-Bus IP',
  icon_kind: 'fa',
  icon_value: 'fa-droplet',
  icon_color: '#0ea5e9',
  description_html: `
<p>Une production d\'eau chaude sanitaire (ballon électrique, thermodynamique, gaz, ou ECS instantanée) assure la disponibilité de l\'eau chaude pour les usages sanitaires du bâtiment. Elle dispose de son propre régulateur qui pilote le maintien en température, les cycles anti-légionellose et la sécurité. La solution Buildy supervise la température de l\'eau, l\'état de fonctionnement et les éventuels défauts, et peut transmettre une consigne de température et déclencher les cycles anti-légionellose depuis l\'application Hyperveez.</p>
`.trim(),
  points: [
    { slug: 'etat.production', label: 'État de production en cours', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'temp.ballon', label: 'Température ballon', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20 },
    { slug: 'temp.boucle_retour', label: 'Température boucle de retour', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30 },
    { slug: 'consigne.effective', label: 'Consigne effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 50 },
    { slug: 'volume.tire', label: 'Volume d\'eau tiré', dataType: 'Mesure', direction: 'read', unit: 'L', position: 60 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 70 },
    { slug: 'alarme.surchauffe', label: 'Alarme surchauffe', dataType: 'Alarme', direction: 'read', position: 80 },
    { slug: 'alarme.legionellose_echec', label: 'Échec cycle anti-légionellose', dataType: 'Alarme', direction: 'read', position: 90 },
    { slug: 'cmd.declencher_legionellose', label: 'Déclencher cycle anti-légionellose', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'consigne.temperature', label: 'Consigne température', dataType: 'Consigne', direction: 'write', unit: '°C', position: 110 },
  ],
};
