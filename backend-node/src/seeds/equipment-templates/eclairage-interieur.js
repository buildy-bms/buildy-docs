'use strict';

module.exports = {
  slug: 'eclairage-interieur',
  name: 'Éclairage intérieur',
  category: 'eclairage',
  bacs_articles: 'R175-1 §4',
  bacs_justification: 'L\'éclairage intégré du bâtiment fait partie des systèmes techniques visés par le décret BACS (R175-1 §4). Le pilotage automatisé contribue aux exigences de performance énergétique.',
  preferred_protocols: 'KNX/IP,DALI,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-lightbulb',
  icon_color: '#facc15',
  description_html: `
<p><strong>L\'éclairage intérieur intégré du bâtiment fait partie des systèmes techniques visés par le décret BACS (R175-1 §4).</strong></p>
<p>Le pilotage de l\'éclairage intérieur peut s\'appuyer sur des détecteurs de présence, des sondes de luminosité, des programmations horaires ou des scénarios. La régulation en temps réel (gradation, allumage progressif, scénarios) est portée par le contrôleur d\'éclairage. La solution Buildy supervise les états et niveaux par circuit ou par luminaire, et peut transmettre des commandes d\'allumage, d\'extinction et de gradation depuis l\'application Hyperveez.</p>
`.trim(),
  points: [
    { slug: 'etat.allume', label: 'État allumé / éteint', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'mesure.niveau_gradation', label: 'Niveau de gradation effectif', dataType: 'Mesure', direction: 'read', unit: '%', position: 20 },
    { slug: 'mesure.luminosite_ambiante', label: 'Luminosité ambiante mesurée', dataType: 'Mesure', direction: 'read', unit: 'lux', position: 30 },
    { slug: 'etat.detection_presence', label: 'Détection de présence', dataType: 'État', direction: 'read', position: 40 },
    { slug: 'energie.consommee', label: 'Énergie consommée', dataType: 'Mesure', direction: 'read', unit: 'kWh', position: 50 },
    { slug: 'alarme.defaut_luminaire', label: 'Défaut luminaire', dataType: 'Alarme', direction: 'read', position: 60 },
    { slug: 'cmd.allumage', label: 'Commande allumage / extinction', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'cmd.gradation', label: 'Commande niveau de gradation', dataType: 'Commande', direction: 'write', unit: '%', position: 110 },
    { slug: 'cmd.scenario', label: 'Commande scénario', dataType: 'Commande', direction: 'write', position: 120 },
  ],
};
