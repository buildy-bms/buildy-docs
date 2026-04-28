'use strict';

module.exports = {
  slug: 'process-industriel',
  name: 'Équipement de process industriel',
  category: 'process',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'OPC-UA,Modbus TCP,BACnet/IP',
  icon_kind: 'fa',
  icon_value: 'fa-industry',
  icon_color: '#475569',
  description_html: `
<p>Cette catégorie couvre les équipements de process spécifiques au métier du site : compresseurs, lignes de production, fours, machines spéciales.</p>

<p><strong>La régulation et la sécurité du process sont assurées par l\'équipement lui-même</strong>, via l\'automate process dédié — généralement porté par l\'intégrateur process selon les exigences métier du site.</p>

<p>La solution Buildy supervise les états, les compteurs de production et les défauts pour permettre l\'analyse énergétique et la corrélation avec les autres systèmes du bâtiment, <strong>sans intervenir sur le pilotage du process</strong>.</p>
`.trim(),
  points: [
    { slug: 'etat.fonctionnement', label: 'État de fonctionnement', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'etat.mode', label: 'Mode (production/maintenance/arrêt)', dataType: 'État', direction: 'read', position: 20 },
    { slug: 'mesure.puissance_electrique', label: 'Puissance électrique consommée', dataType: 'Mesure', direction: 'read', unit: 'kW', position: 30 },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 40 },
    { slug: 'compteur.production', label: 'Compteur de production', dataType: 'Mesure', direction: 'read', position: 50 },
    { slug: 'compteur.heures_fonctionnement', label: 'Heures de fonctionnement', dataType: 'Mesure', direction: 'read', unit: 'h', position: 60 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 70 },
    { slug: 'alarme.arret_urgence', label: 'Arrêt d\'urgence', dataType: 'Alarme', direction: 'read', position: 80 },
  ],
};
