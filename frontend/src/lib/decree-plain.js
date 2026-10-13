// Le décret BACS « en clair » (2026-10-12) : une phrase simple par article ou alinéa, pour les
// lecteurs qui ne connaissent pas le décret. Affichée en tête de la fiche ⓘ du décret
// (components/R175Tooltip.vue) et reprise par les infobulles de l'audit (lib/audit-tips.js).
// Le texte officiel reste la seule source opposable (bacs_knowledge, useDecreeRefs) ; ces
// phrases n'en sont qu'une lecture. Fonctions pures, imports relatifs (testées côté backend).

export const DECREE_PLAIN = {
  'R175-1': {
    title: 'Les définitions du décret',
    text: 'Le décret liste les équipements concernés (chauffage, froid, ventilation, eau chaude, éclairage, électricité produite, GTB) et définit la zone fonctionnelle.',
  },
  'R175-1 4°': {
    title: 'Les équipements concernés',
    text: 'Tous les équipements techniques sont visés : chauffage, froid, ventilation, eau chaude sanitaire, éclairage intégré, électricité produite sur place et GTB.',
  },
  'R175-1 6°': {
    title: 'La zone fonctionnelle',
    text: 'Une zone fonctionnelle regroupe des locaux aux usages homogènes (mêmes activités, mêmes horaires), par exemple des bureaux ou un restaurant d’entreprise.',
  },
  'R175-2': {
    title: 'Le bâtiment est-il concerné ?',
    text: 'Un bâtiment tertiaire est concerné si son chauffage ou sa climatisation dépasse 70 kW. La date limite dépend de la puissance et de la date du permis de construire.',
  },
  'R175-3': {
    title: 'Ce que doit faire la GTB',
    text: 'La GTB suit les consommations, repère les dérives, dialogue avec les équipements, et permet de les arrêter à la main ou de les laisser fonctionner seuls.',
  },
  'R175-3 1°': {
    title: 'Suivre les consommations',
    text: 'La GTB mesure en continu ce que consomme chaque usage, heure par heure et zone par zone, et garde l’historique mois par mois pendant 5 ans.',
  },
  'R175-3 2°': {
    title: 'Repérer les dérives',
    text: 'La GTB compare les consommations à une référence, repère les pertes d’efficacité et prévient l’exploitant des améliorations possibles.',
  },
  'R175-3 3°': {
    title: 'Dialoguer avec les équipements',
    text: 'La GTB doit pouvoir échanger des données avec chaque équipement, quelle que soit sa marque, grâce à un langage de communication ouvert.',
  },
  'R175-3 4°': {
    title: 'Arrêt manuel et fonctionnement autonome',
    text: 'On doit pouvoir arrêter chaque équipement à la main depuis la GTB, et il doit continuer à fonctionner normalement si la GTB s’arrête.',
  },
  // Dernier alinéa de R175-3 (« Les données produites et archivées sont accessibles au
  // propriétaire… ») : codes « R175-3 dernier alinéa » (plan d'actions) et « alinéa final » (AF).
  'R175-3 alinéa final': {
    title: 'Les données appartiennent au propriétaire',
    text: 'Les données de la GTB sont à son propriétaire. Il les donne au gestionnaire du bâtiment qui les demande, et à chaque exploitant celles qui le concernent.',
  },
  'R175-4': {
    title: 'Vérifier la GTB régulièrement',
    text: 'La GTB est vérifiée régulièrement, selon des consignes écrites qui fixent la fréquence, les points à contrôler et les réparations à prévoir.',
  },
  'R175-5': {
    title: 'Former l’exploitant',
    text: 'La personne qui exploite la GTB doit être formée à son fonctionnement et à son réglage.',
  },
  'R175-5-1': {
    title: 'L’inspection périodique',
    text: 'Un organisme extérieur inspecte la GTB régulièrement et remet un rapport, à garder 10 ans.',
  },
  'R175-6': {
    title: 'Réguler la température pièce par pièce',
    text: 'Chaque pièce, ou chaque zone quand c’est justifié, doit avoir une régulation automatique de sa température.',
  },
};

/** « R175-1 §4 » → « R175-1 4° » ; espaces normalisés. */
export function normalizeArticle(article) {
  if (!article) return '';
  return String(article)
    .replace(/§\s*(\d+)/g, (_, n) => `${n}°`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Explication simple d'un article ou d'un alinéa ; à défaut, celle de l'article parent.
 *  « dernier alinéa » (plan d'actions) = « alinéa final » (AF). */
export function decreePlain(article) {
  const key = normalizeArticle(article);
  if (!key) return null;
  if (DECREE_PLAIN[key]) return DECREE_PLAIN[key];
  const alias = key.replace(/dernier alinéa/i, 'alinéa final');
  if (DECREE_PLAIN[alias]) return DECREE_PLAIN[alias];
  const parent = key.replace(/\s+\d+°.*$/, '');
  return DECREE_PLAIN[parent] || null;
}
