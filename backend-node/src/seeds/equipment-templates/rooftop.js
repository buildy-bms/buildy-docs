'use strict';

module.exports = {
  slug: 'rooftop',
  name: 'Rooftop',
  category: 'climatisation',
  bacs_articles: 'R175-1 §1, §2, §3',
  bacs_justification: '<p>Un rooftop combine dans un seul équipement compact les <strong>trois fonctions définies par l\'article R175-1</strong> : ventilation (§3), chauffage (§1) et climatisation (§2). Il est donc pleinement concerné par le décret BACS, à plusieurs titres.</p><p>Le décret impose que cet équipement soit <strong>interopérable</strong> avec les autres systèmes techniques du bâtiment, qu\'il puisse être <strong>arrêté manuellement</strong> et qu\'il soit <strong>géré de manière autonome</strong> via le système BACS, avec un suivi continu et la remontée des alarmes.</p><p>L\'intégration du rooftop dans la solution Buildy permet de superviser les températures, les puissances frigorifique et calorifique, l\'encrassement des filtres et tous les défauts, et de transmettre les commandes et consignes nécessaires.</p>',
  preferred_protocols: 'BACnet/IP,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-building',
  icon_color: '#0ea5e9',
  description_html: `
<p>Un rooftop est une centrale autonome installée en toiture qui assure le renouvellement d\'air, le chauffage et la climatisation.</p>

<p>À ce titre, il est <strong>concerné par le décret BACS au titre de la ventilation</strong> (R175-1 §3), <strong>du chauffage</strong> (§1) <strong>et de la climatisation</strong> (§2).</p>

<p><strong>La régulation du rooftop est assurée par l\'équipement lui-même</strong>, via l\'automate intégré fourni par le fabricant qui pilote la séquence chaud/froid, la modulation, le mode économique, le free cooling et les sécurités.</p>

<p>La solution Buildy supervise les températures, les états des composants frigorifiques et de chauffe, les alarmes et les compteurs. Elle porte les logiques applicatives transverses (programmations horaires, scénarios par usage) en transmettant les commandes et consignes appropriées.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10, techName: 'On_Off_R', nature: 'Booléen' },
    { slug: 'etat.mode', label: 'Mode de fonctionnement (chaud/froid/vent/free cooling)', dataType: 'État', direction: 'read', position: 20, techName: 'HVAC_Control_Mode_R', nature: 'Enum' },
    { slug: 'temp.exterieure', label: 'Température extérieure (air neuf)', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30, techName: 'Outside_Air_Temp_R', nature: 'Numérique' },
    { slug: 'temp.air_soufflage', label: 'Température air soufflage', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40, techName: 'Supply_Air_Temp_R', nature: 'Numérique' },
    { slug: 'temp.air_reprise', label: 'Température air reprise', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50, techName: 'Return_Air_Temp_R', nature: 'Numérique' },
    { slug: 'temp.ambiante', label: 'Température ambiante mesurée', dataType: 'Mesure', direction: 'read', unit: '°C', position: 55, isOptional: true, techName: 'Ambient_Temp_R', nature: 'Numérique' },
    { slug: 'debit.soufflage', label: 'Débit air soufflé', dataType: 'Mesure', direction: 'read', unit: 'm³/h', position: 58, isOptional: true, techName: 'Supply_Air_Flow_R', nature: 'Numérique' },
    { slug: 'puissance.frigo', label: 'Puissance frigorifique', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 60, isOptional: true, nature: 'Numérique' },
    { slug: 'puissance.chauffe', label: 'Puissance de chauffe', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 70, isOptional: true, nature: 'Numérique' },
    { slug: 'consigne.chauffage_effective', label: 'Consigne chauffage effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 75, techName: 'Setpoint_Heat_Temp_R', nature: 'Numérique' },
    { slug: 'consigne.climatisation_effective', label: 'Consigne climatisation effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 80, techName: 'Setpoint_Cool_Temp_R', nature: 'Numérique' },
    { slug: 'etat.encrassement_filtre', label: 'Encrassement filtre', dataType: 'État', direction: 'read', position: 90, techName: 'Filter_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 100, techName: 'System_Fault_R', nature: 'Booléen' },
    { slug: 'alarme.compresseur', label: 'Défaut compresseur', dataType: 'Alarme', direction: 'read', position: 110, isOptional: true, nature: 'Booléen', techName: 'System_Fault_R' },
    { slug: 'alarme.batterie_chauffe', label: 'Défaut batterie de chauffage', dataType: 'Alarme', direction: 'read', position: 120, isOptional: true, nature: 'Booléen', techName: 'System_Fault_R' },
    { slug: 'alarme.communication', label: 'Défaut communication', dataType: 'Alarme', direction: 'read', position: 130, nature: 'Booléen', techName: 'System_Fault_R' },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 200, techName: 'On_Off_W', nature: 'Booléen' },
    { slug: 'cmd.mode', label: 'Commande mode (chaud/froid/auto)', dataType: 'Commande', direction: 'write', position: 210, isOptional: true, techName: 'HVAC_Control_Mode_W', nature: 'Enum' },
    { slug: 'consigne.chauffage', label: 'Consigne chauffage', dataType: 'Consigne', direction: 'write', unit: '°C', position: 220, techName: 'Setpoint_Heat_Temp_W', nature: 'Numérique' },
    { slug: 'consigne.climatisation', label: 'Consigne climatisation', dataType: 'Consigne', direction: 'write', unit: '°C', position: 225, techName: 'Setpoint_Cool_Temp_W', nature: 'Numérique' },
    { slug: 'consigne.confort_reduit', label: 'Consigne confort/réduit', dataType: 'Consigne', direction: 'write', position: 230, isOptional: true, nature: 'Numérique', techName: 'Setpoint_Temp_W' },
  ],
};
