'use strict';

module.exports = {
  slug: 'eclairage-interieur',
  name: 'Éclairage intérieur',
  category: 'eclairage',
  bacs_articles: 'R175-1 §4',
  bacs_justification: '<p>L\'article R175-1 inclut <strong>l\'éclairage intégré</strong> dans la définition des systèmes techniques de bâtiment (§4). À ce titre, l\'éclairage intérieur fait partie du périmètre du décret BACS lorsque le bâtiment dépasse les seuils d\'application.</p><p>Le décret impose que l\'éclairage soit <strong>interopérable</strong> avec les autres systèmes techniques (présence, occultation, climatisation), qu\'il puisse être <strong>arrêté manuellement</strong> et qu\'il soit <strong>géré de manière autonome</strong> (scénarios horaires, gradation, détection de présence).</p><p>L\'intégration de l\'éclairage intérieur dans la GTB Buildy permet de superviser les niveaux et les états par zone, et de transmettre les commandes d\'allumage et de gradation.</p>',
  preferred_protocols: 'KNX/IP,DALI,Modbus TCP',
  icon_kind: 'fa',
  icon_value: 'fa-lightbulb',
  icon_color: '#facc15',
  description_html: `
<p><strong>L\'éclairage intérieur intégré du bâtiment fait partie des systèmes techniques visés par le décret BACS (R175-1 §4).</strong></p>
<p>Un système d\'éclairage intérieur est composé de luminaires et d\'organes de gradation pilotés par un contrôleur. Le contrôleur assure les fonctions techniques de bas niveau : modulation de l\'intensité, allumage progressif, retour d\'état des luminaires. La solution Buildy supervise les états et niveaux d\'éclairage et porte l\'ensemble des logiques applicatives (programmations horaires, scénarios par usage, mise en cohérence avec la détection de présence et les apports solaires) en transmettant les commandes d\'allumage, d\'extinction et de gradation appropriées.</p>
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
