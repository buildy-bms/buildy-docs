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
<p>Une production d\'eau chaude sanitaire (ballon électrique, thermodynamique, gaz ou ECS instantanée) assure la disponibilité de l\'eau chaude pour les usages sanitaires du bâtiment.</p>

<p><strong>La régulation de l\'ECS est assurée par l\'équipement lui-même</strong>, via le régulateur natif du fabricant pour les solutions compactes, ou via une régulation portée par l\'intégrateur de chauffage/sanitaire (chaufferiste, plombier-chauffagiste) pour les installations de production centralisées (cascade, bouclage, gestion des températures par usage). Cette régulation pilote le maintien en température, les cycles anti-légionellose et la sécurité.</p>

<p>La solution Buildy supervise la température de l\'eau, l\'état de fonctionnement et les éventuels défauts, et peut transmettre une consigne de température et déclencher les cycles anti-légionellose à distance.</p>
`.trim(),
  points: [
    { slug: 'etat.production', label: 'État de production en cours', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'temp.ballon', label: 'Température ballon', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20, nature: 'Numérique' },
    { slug: 'temp.boucle_retour', label: 'Température boucle de retour', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30, nature: 'Numérique' },
    { slug: 'consigne.effective', label: 'Consigne effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40, techName: 'Setpoint_Temp_R', nature: 'Numérique' },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 50, nature: 'Numérique' },
    { slug: 'volume.tire', label: 'Volume d\'eau tiré', dataType: 'Mesure', direction: 'read', unit: 'L', position: 60, nature: 'Numérique' },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 70, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.surchauffe', label: 'Alarme surchauffe', dataType: 'Alarme', direction: 'read', position: 80, nature: 'Booléen' },
    { slug: 'alarme.legionellose_echec', label: 'Échec cycle anti-légionellose', dataType: 'Alarme', direction: 'read', position: 90, nature: 'Booléen' },
    { slug: 'cmd.declencher_legionellose', label: 'Déclencher cycle anti-légionellose', dataType: 'Commande', direction: 'write', position: 100, nature: 'Booléen' },
    { slug: 'consigne.temperature', label: 'Consigne température', dataType: 'Consigne', direction: 'write', unit: '°C', position: 110, techName: 'Setpoint_Temp_W', nature: 'Numérique' },
  ],
};
