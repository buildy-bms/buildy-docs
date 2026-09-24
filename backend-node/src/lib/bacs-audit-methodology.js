'use strict';

/**
 * Methodologie et hypotheses retenues par Buildy pour realiser l'audit BACS.
 *
 * Inclus en Annexe B de chaque rapport PDF d'audit. Ces points couvrent
 * le perimetre BACS retenu, le seuil de puissance, la definition de zone,
 * l'interoperabilite, le calcul de la date butoir, etc.
 *
 * Note : les commentaires de code restent ASCII-safe. Les valeurs (titres
 * et bodies) sont en francais accentue car affichees dans le PDF livre.
 *
 * Cf plan section "Methodologie Buildy — hypotheses retenues" pour les
 * details. Apres migration 65, ces valeurs sont seedees dans la table
 * pdf_boilerplate ; elles servent maintenant de fallback si la table est
 * vide. Editer le contenu via la page admin "Textes standards PDF".
 */

module.exports = [
  {
    title: 'Périmètre BACS retenu',
    body: `Seuls les systèmes techniques mentionnés au 4° de l'article R175-1 sont audités : chauffage, refroidissement, ventilation, eau chaude sanitaire, éclairage intégré, production d'électricité sur site, systèmes d'automatisation et de contrôle. La conformité aux exigences de l'article R175-3 est appréciée sur les systèmes à relier à la GTB selon le II de l'article R175-2 : dans un bâtiment existant, les systèmes de chauffage ou de climatisation dont la puissance cumulée dépasse le seuil, et les autres systèmes seulement si leur connexion est réalisable avec un temps de retour sur investissement inférieur à dix ans. Buildy ne calcule pas ce temps de retour : les écarts relevés sur ces autres systèmes sont présentés comme des recommandations (actions mineures assorties d'une « condition d'application »). Tant que la puissance d'un équipement de chauffage ou de climatisation n'est pas relevée, le système correspondant est traité comme relié d'office, avec la mention « portée à confirmer ». Le périmètre de la GTB en place ne réduit pas celui du décret : un usage qu'elle ne traite pas est considéré comme non relié. Un équipement que l'auditeur déclare non concerné par l'intégration à la GTB (par exemple une unité extérieure pilotée par des unités intérieures raccordées) est signalé comme tel et n'est pas évalué. Les systèmes hors périmètre (occultations, prises pilotées, sécurité incendie, etc.) sont mentionnés à titre indicatif, hors évaluation de conformité.`,
  },
  {
    title: 'Seuil de puissance applicable',
    body: `La puissance retenue pour l'assujettissement est la puissance nominale utile des systèmes de chauffage, d'une part, et des systèmes de climatisation, d'autre part, ventilation combinée comprise. Les puissances de chaud et de froid ne s'additionnent pas : le seuil s'apprécie séparément pour chacune (FAQ BACS n° 11). Le décret vise les bâtiments dont l'une de ces puissances dépasse 290 kW ou 70 kW, selon le calendrier de l'article R175-2 ; un bâtiment dont ces puissances ne dépassent pas 70 kW n'est pas assujetti (R175-2 I).`,
  },
  {
    title: 'Définition de zone fonctionnelle',
    body: `Le décret définit la zone fonctionnelle comme « toute zone dans laquelle les usages sont homogènes » (R175-1 6°). Elle se définit par l'activité et l'amplitude d'utilisation, pas par pièce : par exemple, une zone de bureaux et une zone de restauration forment au moins deux zones (FAQ ministérielle n° 25, non opposable). Buildy s'appuie sur le découpage zonal existant du site lorsqu'il en existe un ; sinon, le découpage est proposé en accord avec le propriétaire ou son représentant. En principe, les circulations, sanitaires, vestiaires et locaux techniques sont rattachés à la zone qu'ils desservent ; ils ne forment une zone distincte que lorsque le découpage existant du site ou un comptage dédié le justifie.`,
  },
  {
    title: 'Suivi continu des données (R175-3 1°)',
    body: `La GTB suit, enregistre et analyse en continu, par zone fonctionnelle et à un pas de temps horaire, les données de production et de consommation énergétique des systèmes techniques, ajuste ces systèmes en conséquence et conserve les données à l'échelle mensuelle pendant cinq ans (R175-3 1°). Un logiciel de simple supervision, sans commande ni ajustement des systèmes, ne répond pas à cette exigence (FAQ BACS n° 13). Une conservation de moins de cinq ans est considérée comme non conforme ; une conservation assurée par des exports réguliers, sous la responsabilité du propriétaire, est admise sous réserve.`,
  },
  {
    title: 'Interopérabilité (R175-3 3°)',
    body: `La GTB doit pouvoir communiquer avec les systèmes techniques qui lui sont reliés. Le guide d'application du ministère (version 2, janvier 2026) retient l'interopérabilité technique : protocoles normalisés (le guide cite BACnet, LonWorks et KNX ; Buildy retient aussi Modbus, M-Bus…) ou interfaces de programmation (API), le cas échéant au moyen de passerelles. Buildy vérifie, pour chaque système, que chaque générateur communique avec la GTB, directement ou par l'automate ou le régulateur qui le pilote (guide PROFEEL) ; un système sans générateur propre (émetteurs alimentés par une production partagée, éclairage, ventilation…) est relié lorsqu'un de ses équipements communique avec elle. Hors les systèmes dont le raccordement n'est exigé que sous condition de temps de retour sur investissement (voir « Périmètre BACS retenu ») et les équipements déclarés non concernés, un équipement non relié n'est admis que s'il relève de la règle des 5 % (FAQ ministérielle n° 16, non opposable). Les émetteurs à régulation locale autonome (robinets thermostatiques, par exemple) ne sont pas visés. Buildy recommande les protocoles ouverts, sans en faire une condition de conformité.`,
  },
  {
    title: 'Régulation automatique du chauffage (R175-6)',
    body: `Buildy vérifie l'existence d'une régulation automatique de la température par pièce ou, si cela est justifié, par zone chauffée (L. 175-2 ; R175-6). L'obligation porte sur le chauffage seulement. Elle s'applique aux bâtiments dont le permis de construire a été déposé à partir du 22 juillet 2021 (R175-6 II 1°) et, dans les autres bâtiments, dès lors que des travaux d'installation ou de remplacement du générateur de chaleur sont engagés à compter d'un an après la publication du décret du 20 juillet 2020 (R175-6 II 2°) ; dans ce dernier cas, elle ne s'applique pas si le propriétaire produit une étude établissant qu'elle n'est pas réalisable avec un temps de retour sur investissement inférieur à six ans. Les appareils indépendants de chauffage au bois en sont exemptés (R175-6 II).`,
  },
  {
    title: 'Vérifications périodiques (R175-4)',
    body: `La GTB fait l'objet de vérifications périodiques par un prestataire externe ou un personnel interne compétent, encadrées par des consignes écrites données au gestionnaire : périodicité des interventions, points à contrôler, réparation rapide ou remplacement des éléments défaillants (R175-4). Buildy vérifie l'existence d'un contrat de maintenance ou de ces consignes. Leur absence est signalée comme une réserve : une obligation que le propriétaire doit respecter, mise en évidence en tête du rapport, qui ne remet pas en cause la conformité de l'installation elle-même. L'historique détaillé des interventions n'est pas dans le périmètre de l'audit.`,
  },
  {
    title: 'Formation de l\'exploitant (R175-5)',
    body: `Buildy demande au propriétaire ou à son représentant si l'exploitant a été formé au fonctionnement de la GTB, notamment à son paramétrage, et consigne la preuve (date, intervenant, contenu, feuille d'émargement). L'article R175-5 n'impose pas de modalité de formation ; il rend le propriétaire responsable de sa réalisation, quelle que soit la solution déployée. L'assistance intégrée à une solution de supervision ne remplace pas cette formation.`,
  },
  {
    title: 'Date butoir applicable',
    body: `Buildy détermine l'échéance applicable selon la puissance et la date de dépôt du permis de construire (R175-2 II). Bâtiment neuf de plus de 290 kW (permis déposé à partir du 22 juillet 2021) ou de plus de 70 kW (permis déposé à partir du 9 avril 2024) : dès la construction. Bâtiment existant de plus de 290 kW : au plus tard le 1er janvier 2025. Bâtiment existant de plus de 70 kW : lors du renouvellement du système de chauffage ou de climatisation, et au plus tard le 1er janvier 2030 (échéance reportée par le décret n° 2025-1343 du 26 décembre 2025). Cette échéance est rappelée en première page du rapport.`,
  },
  {
    title: 'Arrêt manuel et gestion autonome (R175-3 4°)',
    body: `Selon le guide d'application du ministère, la GTB doit permettre d'arrêter manuellement sa supervision sans que les systèmes techniques reliés cessent de fonctionner normalement (R175-3 4°). Buildy vérifie, pour chaque système technique relié, qu'il peut être arrêté et remis en marche manuellement depuis la GTB, et qu'il continue de fonctionner de manière autonome lorsque la GTB est arrêtée ou déconnectée ; l'absence de l'une de ces capacités donne lieu à une action corrective.`,
  },
  {
    title: 'Mise à disposition des données (R175-3, dernier alinéa)',
    body: `Les données produites et archivées par la GTB appartiennent à son propriétaire, qui les met à disposition du gestionnaire du bâtiment, à sa demande, et transmet à chaque exploitant d'un système technique relié les données qui le concernent (R175-3, dernier alinéa). Buildy vérifie que ces deux circuits existent (accès, canal, format) ; à défaut, un écart est signalé, distinct de l'interopérabilité (R175-3 3°). La mise à disposition des données à un service tiers n'est pas une exigence du décret.`,
  },
  {
    title: 'Absence de système d\'automatisation et de contrôle',
    body: `Lorsque le bâtiment ne dispose d'aucun système d'automatisation et de contrôle (GTB), les exigences fonctionnelles des articles R175-3, R175-4 et R175-5 ne peuvent pas être satisfaites. Le rapport le signale par un constat synthétique, et le plan de mise en conformité porte en priorité l'installation d'une GTB (R175-2). L'inspection périodique R175-5-1 ne s'applique pas en l'absence de système à inspecter.`,
  },
  {
    title: 'Comptage et sous-comptage énergétique',
    body: `Buildy relève les compteurs et sous-compteurs présents et les rattache à un usage (chauffage, refroidissement, ventilation, eau chaude sanitaire, éclairage, production). Le suivi des consommations et des productions par zone fonctionnelle, au pas horaire, est une exigence du décret (R175-3 1° ; FAQ BACS n° 27) ; le décret ne fixe pas de nombre minimal de compteurs (FAQ BACS n° 26). Buildy établit un plan de comptage pour y répondre : les compteurs manquants de ce plan sont pris en compte dans l'évaluation de conformité.`,
  },
  {
    title: 'Sévérité des actions et verdict global',
    body: `Chaque écart constaté donne lieu à une action corrective hiérarchisée par sévérité : bloquante (écart qui empêche à lui seul la conformité, par exemple l'absence de GTB ou d'un compteur requis), majeure (exigence du décret non satisfaite, à traiter pour atteindre la conformité), mineure (recommandation, ou système dont le raccordement n'est exigé que sous condition de temps de retour sur investissement). Certaines obligations du propriétaire sont présentées comme des réserves : la maintenance de la GTB (R175-4), l'inspection périodique de la GTB lorsqu'aucune n'est tracée (R175-5-1) et, pour une supervision Buildy de niveau Essentials, l'export régulier des données de consommation. Le verdict global est « non conforme » dès qu'une action bloquante reste ouverte, « partiellement conforme » lorsqu'il reste des actions majeures sans action bloquante, et « conforme » en l'absence d'action bloquante ou majeure ouverte ; s'il ne reste que des réserves, il est « conforme sous réserves ». Sans action bloquante ni majeure, mais avec une exigence encore à qualifier, la conformité est « non déterminée ». La règle des 5 % (FAQ ministérielle n° 16, non opposable) dispense de raccordement les systèmes dont les consommations d'énergie effectives et induites représentent moins de 5 % de la consommation totale du bâtiment : ils ne donnent lieu à aucune action. Les actions écartées par le propriétaire sont conservées pour traçabilité mais exclues du plan retenu.`,
  },
  {
    title: 'Inspection périodique distincte de l\'audit (R175-5-1)',
    body: `Le présent audit est un relevé de site réalisé par Buildy. Il ne remplace pas l'inspection périodique de la GTB, organisée à l'initiative de son propriétaire. La FAQ ministérielle n° 30 (non opposable) indique qu'il « peut être pertinent » de confier l'inspection à un tiers indépendant des fabricants et installateurs ; le décret ne l'impose pas (R175-5-1). Lorsque le bâtiment dispose d'une GTB, le rapport rappelle l'échéance d'inspection ; il ne constitue pas un rapport d'inspection.`,
  },
  {
    title: 'Usages et zones hors périmètre du décret',
    body: `Certains usages ajoutés par l'auditeur (process, par exemple) ne relèvent pas du décret BACS : ils figurent dans l'inventaire sans entrer dans l'évaluation de conformité. Les locaux techniques ne forment pas une zone fonctionnelle, mais les équipements qu'ils abritent restent dans le champ du décret.`,
  },
];
