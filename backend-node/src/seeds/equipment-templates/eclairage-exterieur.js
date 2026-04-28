'use strict';

module.exports = {
  slug: 'eclairage-exterieur',
  name: 'Éclairage extérieur',
  category: 'eclairage',
  bacs_articles: null,
  bacs_justification: null,
  preferred_protocols: 'KNX/IP,DALI,Modbus TCP,LoRaWAN',
  icon_kind: 'fa',
  icon_value: 'fa-lightbulb',
  icon_color: '#eab308',
  description_html: `
<p>Un système d\'éclairage extérieur est composé de luminaires et de circuits commandés par un contrôleur dédié. Le contrôleur assure les fonctions techniques de bas niveau : commutation des circuits, modulation de l\'intensité, retour d\'état. La solution Buildy supervise les états et la consommation par circuit, et porte l\'ensemble des logiques applicatives de déclenchement (calendrier, horloge astronomique, mesure crépusculaire, scénarios) en transmettant les commandes d\'allumage, d\'extinction et de gradation appropriées.</p>
`.trim(),
  points: [
    { slug: 'etat.allume', label: 'État allumé / éteint', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'mesure.niveau_gradation', label: 'Niveau de gradation effectif', dataType: 'Mesure', direction: 'read', unit: '%', position: 20 },
    { slug: 'mesure.luminosite_crepusculaire', label: 'Mesure crépusculaire', dataType: 'Mesure', direction: 'read', unit: 'lux', position: 30 },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 40 },
    { slug: 'alarme.defaut_circuit', label: 'Défaut circuit / disjonction', dataType: 'Alarme', direction: 'read', position: 50 },
    { slug: 'cmd.allumage', label: 'Commande allumage / extinction', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'cmd.gradation', label: 'Commande gradation', dataType: 'Commande', direction: 'write', unit: '%', position: 110 },
  ],
};
