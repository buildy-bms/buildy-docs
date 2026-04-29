'use strict';

module.exports = {
  slug: 'pompe-a-chaleur',
  name: 'Pompe à chaleur',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1, §2',
  bacs_justification: '<p>Une pompe à chaleur produit de la chaleur (R175-1 §1) et, lorsqu\'elle est réversible, du froid (§2) à partir d\'une source extérieure (air, eau, sol). Elle constitue un système technique de bâtiment au sens du décret BACS.</p><p>Le décret impose <strong>l\'interopérabilité</strong> avec les autres systèmes techniques, la <strong>capacité d\'arrêt manuel</strong> et la <strong>gestion autonome</strong> via le système BACS, avec suivi continu des températures, des modes de fonctionnement et des défauts.</p><p>L\'intégration de la pompe à chaleur dans la solution Buildy permet de superviser les températures de la boucle d\'eau, le mode chaud/froid, la consigne effective et les défauts machine, et de transmettre les commandes principales.</p>',
  preferred_protocols: 'Modbus TCP,BACnet/IP,Modbus RTU',
  icon_kind: 'fa',
  icon_value: 'fa-temperature-arrow-down',
  icon_color: '#0ea5e9',
  description_html: `
<p>Une pompe à chaleur (PAC) extrait de la chaleur d'une source extérieure (air, eau, sol) pour la restituer dans une boucle d'eau alimentant le chauffage et, lorsqu'elle est réversible, la climatisation.</p>

<p>À ce titre, elle est <strong>concernée par le décret BACS au titre des systèmes de chauffage</strong> (R175-1 §1) <strong>et de climatisation</strong> (§2) si elle est réversible.</p>

<p><strong>La régulation de la PAC est assurée par l'équipement lui-même</strong>, via le régulateur natif du fabricant qui pilote la modulation de puissance, le dégivrage, le basculement chaud/froid et les sécurités de la boucle frigorifique.</p>

<p>La solution Buildy supervise les températures, le mode et les défauts, et transmet les commandes de marche/arrêt et de consigne.</p>
`.trim(),
  points: [
    // ── Donnees lues ──
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'temp.depart_eau', label: 'Température eau de départ', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20 },
    { slug: 'temp.retour_eau', label: 'Température eau de retour', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30, isOptional: true },
    { slug: 'temp.exterieure', label: 'Température extérieure (source)', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'consigne.temperature_effective', label: 'Consigne température effective', dataType: 'Mesure', direction: 'read', unit: '°C', position: 50 },
    { slug: 'etat.mode_chaud_froid', label: 'Mode chaud/froid', dataType: 'État', direction: 'read', position: 60 },
    { slug: 'puissance.thermique', label: 'Puissance thermique instantanée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 70, isOptional: true },
    { slug: 'mesure.cop', label: 'COP instantané', dataType: 'Mesure', direction: 'read', position: 80, isOptional: true },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 90 },
    { slug: 'alarme.defaut_compresseur', label: 'Défaut compresseur', dataType: 'Alarme', direction: 'read', position: 100, isOptional: true },
    { slug: 'alarme.defaut_circuit_eau', label: 'Défaut circuit d\'eau (manque, gel)', dataType: 'Alarme', direction: 'read', position: 110, isOptional: true },

    // ── Donnees ecrites ──
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 200 },
    { slug: 'cmd.mode_chaud_froid', label: 'Commande mode chaud/froid', dataType: 'Commande', direction: 'write', position: 210 },
    { slug: 'consigne.temperature', label: 'Consigne température', dataType: 'Consigne', direction: 'write', unit: '°C', position: 220 },
  ],
};
