'use strict';

module.exports = {
  slug: 'thermostat',
  name: 'Thermostat',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1, §2',
  bacs_justification: '<p>Un thermostat est l\'organe de pilotage local d\'un système de chauffage et/ou de climatisation. Il fait partie intégrante des systèmes techniques de bâtiment au sens de l\'article R175-1 du décret BACS.</p><p>Le décret impose <strong>l\'interopérabilité</strong> avec les autres systèmes techniques (notamment pour les scénarios horaires et la cohérence multi-zones), la <strong>capacité d\'arrêt manuel</strong> et la <strong>gestion autonome</strong> via le système BACS.</p><p>L\'intégration des thermostats dans la solution Buildy permet de superviser la température mesurée, la consigne effective et le mode, et de transmettre les commandes correspondantes par zone.</p>',
  preferred_protocols: 'KNX/IP,Modbus TCP,Zigbee,BACnet/IP',
  icon_kind: 'fa',
  icon_value: 'fa-thermometer',
  icon_color: '#dc2626',
  description_html: `
<p>Un thermostat est l'organe local de pilotage de la température d'une zone : il mesure la température ambiante, accepte une consigne (manuelle ou télécommandée) et pilote l'organe de chauffe ou de climatisation associé.</p>

<p>Selon sa configuration, il peut être <strong>concerné par le décret BACS au titre des systèmes de chauffage</strong> (R175-1 §1) <strong>et de climatisation</strong> (§2).</p>

<p><strong>La régulation est portée par le thermostat lui-même</strong>, via sa logique embarquée (PI, PID, hystérésis) qui ouvre/ferme l'organe terminal en fonction de l'écart consigne/mesure.</p>

<p>La solution Buildy supervise la température mesurée, la consigne effective et le mode, et peut transmettre les commandes (consigne, marche/arrêt, mode HVAC).</p>
`.trim(),
  points: [
    // ── Donnees lues ──
    { slug: 'mesure.temperature', label: 'Température mesurée', dataType: 'Mesure', direction: 'read', unit: '°C', position: 10 },
    { slug: 'consigne.temperature_effective', label: 'Consigne température effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20 },
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 30 },
    { slug: 'etat.mode_chaud_froid', label: 'Mode chaud/froid', dataType: 'État', direction: 'read', position: 40, isOptional: true },
    { slug: 'etat.mode_hvac', label: 'Mode HVAC (auto/éco/confort/...)', dataType: 'État', direction: 'read', position: 50, nature: 'Enum', isOptional: true },
    { slug: 'alarme.defaut', label: 'Défaut thermostat', dataType: 'Alarme', direction: 'read', position: 60, isOptional: true },

    // ── Donnees ecrites ──
    { slug: 'consigne.temperature', label: 'Consigne température', dataType: 'Consigne', direction: 'write', unit: '°C', position: 200 },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 210 },
    { slug: 'cmd.mode_chaud_froid', label: 'Commande mode chaud/froid', dataType: 'Commande', direction: 'write', position: 220, isOptional: true },
    { slug: 'cmd.mode_hvac', label: 'Commande mode HVAC', dataType: 'Commande', direction: 'write', position: 230, nature: 'Enum', isOptional: true },
  ],
};
