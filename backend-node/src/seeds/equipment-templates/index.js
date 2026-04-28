'use strict';

/**
 * Index des templates équipement Buildy.
 *
 * Chaque template suit STRICTEMENT la structure CTA de référence (cta.js) :
 *   - slug, name, category
 *   - bacs_articles (si applicable, sinon null)
 *   - bacs_justification (texte court agnostique → encart contextualisé)
 *   - icon (fa)
 *   - preferred_protocols (CSV)
 *   - description_html : HTML Tiptap (bullets BACS si applicable + 2-4 phrases agnostiques)
 *   - points : Mesure/État/Alarme/Commande/Consigne uniquement, avec tech_name + nature
 *
 * Règles d'or :
 *   - Agnostique des marques/modèles
 *   - Pas de zones/locaux du bâtiment
 *   - Listes de points indicatives, pas exhaustives
 *   - "La régulation est assurée par le système terrain lui-même" pour la plupart
 */

module.exports = [
  require('./cta'),
  require('./chaudiere'),
  require('./aerotherme'),
  require('./destratificateur'),
  require('./drv'),
  require('./rooftop'),
  require('./ventilation-generique'),
  require('./ecs'),
  require('./eclairage-interieur'),
  require('./eclairage-exterieur'),
  require('./prises-pilotees'),
  require('./production-electricite'),
  require('./compteur-electrique'),
  require('./compteur-gaz'),
  require('./compteur-eau'),
  require('./compteur-calories'),
  require('./qai'),
  require('./volets'),
  require('./stores'),
  require('./process-industriel'),
  require('./equipement-generique'),
];
