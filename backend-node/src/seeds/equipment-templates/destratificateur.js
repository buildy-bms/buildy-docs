'use strict';

module.exports = {
  slug: 'destratificateur',
  name: 'Destratificateur',
  category: 'chauffage',
  bacs_articles: 'R175-1 §1',
  bacs_justification: '<p>L\'article R175-1 définit un <strong>système de chauffage</strong> comme la combinaison des composantes nécessaires pour assurer l\'augmentation contrôlée de la température de l\'air intérieur. Un destratificateur participe à cette fonction en homogénéisant la température et en limitant les pertes liées à la stratification thermique.</p><p>À ce titre, il fait partie du périmètre BACS et doit pouvoir être <strong>supervisé, arrêté manuellement et géré de manière autonome</strong> en cohérence avec les autres systèmes thermiques.</p><p>L\'intégration du destratificateur dans la GTB Buildy permet de remonter son état et son écart de température mesuré, et d\'ajuster sa consigne de déclenchement.</p>',
  preferred_protocols: 'Modbus TCP,KNX/IP',
  icon_kind: 'fa',
  icon_value: 'fa-fan',
  icon_color: '#fb923c',
  description_html: `
<p><strong>Un destratificateur est concerné par le décret BACS au titre du système de chauffage (R175-1 §1) lorsqu\'il contribue à la performance globale du chauffage.</strong></p>
<p>Un destratificateur brasse l\'air en hauteur pour homogénéiser la température et limiter les pertes liées à la stratification thermique, en particulier dans les volumes hauts. <strong>La régulation du destratificateur (déclenchement sur écart de température haut/bas) est assurée par l\'équipement lui-même</strong>, via son régulateur intégré ou via une régulation portée par l\'intégrateur. La solution Buildy supervise son état et peut transmettre une commande marche/arrêt et une consigne d\'écart de déclenchement.</p>
`.trim(),
  points: [
    { slug: 'etat.marche_arret', label: 'État marche/arrêt', dataType: 'État', direction: 'read', position: 10 },
    { slug: 'temp.haute', label: 'Température air en hauteur', dataType: 'Mesure', direction: 'read', unit: '°C', position: 20 },
    { slug: 'temp.basse', label: 'Température air en partie basse', dataType: 'Mesure', direction: 'read', unit: '°C', position: 30 },
    { slug: 'mesure.ecart', label: 'Écart de température mesuré', dataType: 'Mesure', direction: 'read', unit: '°C', position: 40 },
    { slug: 'alarme.defaut_general', label: 'Défaut général', dataType: 'Alarme', direction: 'read', position: 50 },
    { slug: 'cmd.marche_arret', label: 'Commande marche/arrêt', dataType: 'Commande', direction: 'write', position: 100 },
    { slug: 'consigne.ecart_declenchement', label: 'Consigne écart de déclenchement', dataType: 'Consigne', direction: 'write', unit: '°C', position: 110 },
  ],
};
