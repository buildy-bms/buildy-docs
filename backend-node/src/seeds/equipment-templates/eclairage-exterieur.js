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
<p>L\'éclairage extérieur (parking, voirie, façade, signalétique) est piloté en fonction de l\'horloge astronomique, de la luminosité crépusculaire ou de scénarios horaires. La logique de déclenchement est portée par le contrôleur dédié. La solution Buildy supervise les états et la consommation par circuit, et peut transmettre des commandes d\'allumage, d\'extinction et de gradation depuis l\'application Hyperveez.</p>
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
