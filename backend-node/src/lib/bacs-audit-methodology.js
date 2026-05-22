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
    body: `Seuls les systèmes techniques mentionnés au 4° de l'article R175-1 sont audités : chauffage, refroidissement, ventilation, eau chaude sanitaire, éclairage intégré au bâti, production électrique sur site, systèmes d'automatisation et de contrôle. Les systèmes hors périmètre (occultations, prises pilotées, sécurité incendie, etc.) sont mentionnés à titre indicatif mais hors évaluation de conformité.`,
  },
  {
    title: 'Seuil de puissance applicable',
    body: `La puissance considérée pour déterminer l'applicabilité du décret est la puissance nominale utile cumulée des systèmes de chauffage et de climatisation, conformément à R175-2 §I. Les seuils sont 290 kW (échéance 1er janvier 2025) et 70 kW (échéance 1er janvier 2030, report acté par le décret publié au Journal officiel le 26 décembre 2025), avec exemption en deçà de 70 kW.`,
  },
  {
    title: 'Définition de zone fonctionnelle',
    body: `Conformément à R175-1 §6, une zone fonctionnelle est un espace au sein duquel les usages sont homogènes (ex : open-space tertiaire, atelier, local technique, parking). Buildy s'appuie sur le découpage zonal existant du site lorsqu'il en existe un ; sinon, le découpage est proposé en accord avec le propriétaire ou son représentant.`,
  },
  {
    title: 'Suivi continu des données (R175-3 §1)',
    body: `La conformité à l'exigence de suivi requiert que les données soient collectées par zone fonctionnelle, à pas horaire, et conservées à l'échelle mensuelle pendant 5 ans minimum. Tout système ne respectant pas cette durée de conservation est considéré comme non conforme dans le présent audit.`,
  },
  {
    title: 'Interopérabilité (R175-3 §3)',
    body: `Un système est considéré comme interopérable s'il supporte au moins un protocole standard ouvert (BACnet/IP, BACnet MS/TP, Modbus TCP, Modbus RTU, KNX, M-Bus, MQTT) avec les autres systèmes techniques du bâtiment. Les passerelles propriétaires fermées ne satisfont pas cette exigence.`,
  },
  {
    title: 'Régulation thermique automatique (R175-6)',
    body: `Buildy vérifie l'existence d'une régulation automatique de la température par pièce ou par zone. La conformité est appréciée à l'installation du générateur ou à son remplacement. Les appareils indépendants de chauffage au bois bénéficient de l'exemption explicite mentionnée à l'article et ne déclenchent pas d'action corrective.`,
  },
  {
    title: 'Vérifications périodiques (R175-4)',
    body: `Buildy vérifie l'existence de consignes écrites encadrant la maintenance du BACS. L'absence de telles consignes constitue une non-conformité. La modélisation détaillée de l'historique de maintenance n'est pas dans le périmètre de l'audit.`,
  },
  {
    title: 'Formation de l\'exploitant (R175-5)',
    body: `Buildy demande au propriétaire ou à son représentant si l'exploitant a reçu une formation au paramétrage du BACS. Lorsque la solution BACS déployée est Buildy, cette exigence est nativement couverte par le support utilisateur intégré dans l'application (assistance contextuelle, documentation embarquée, support continu). Ce mode de formation continue répond à l'esprit du R175-5, qui n'impose pas de modalité spécifique. La preuve documentaire est consignée pour les solutions tierces.`,
  },
  {
    title: 'Date butoir applicable',
    body: `Buildy calcule la date butoir réglementaire en fonction de la puissance nominale utile cumulée et de la date du permis de construire selon R175-2 : > 290 kW échéance 1er janvier 2025 (immédiate pour les bâtiments neufs livrés après cette date), entre 70 et 290 kW échéance 1er janvier 2030 (échéance repoussée de 2027 à 2030 par le décret publié au Journal officiel le 26 décembre 2025) ou date de renouvellement du système. Cette date est rappelée en première page du rapport.`,
  },
  {
    title: 'Arrêt manuel et fonctionnement autonome (R175-3 §4)',
    body: `Pour chaque système technique, Buildy vérifie deux capacités distinctes : la possibilité d'un arrêt manuel par l'exploitant, et la reprise autonome du système après une coupure ou un redémarrage de la GTB sans intervention humaine. Un système est considéré conforme à cette exigence lorsque ces deux comportements sont effectivement constatés ; l'un manquant suffit à déclencher une action corrective.`,
  },
  {
    title: 'Fourniture des données à un service tiers (R175-3 dernier alinéa)',
    body: `Le dernier alinéa de R175-3 impose que le BACS puisse mettre les données collectées à disposition d'un service interopérable choisi par le propriétaire. Buildy considère cette exigence satisfaite lorsque le système expose une interface de fourniture de données ouverte et documentée. L'absence d'un tel moyen d'export est signalée comme non-conformité du dernier alinéa, distincte de l'interopérabilité entre systèmes (R175-3 §3).`,
  },
  {
    title: 'Absence de système d\'automatisation et de contrôle',
    body: `Lorsque le bâtiment ne dispose d'aucun système d'automatisation et de contrôle (GTB), l'ensemble des exigences fonctionnelles de R175-3, R175-4 et R175-5 est mécaniquement non satisfait. Le rapport le signale par un constat synthétique en lieu et place du détail technique, et le plan de mise en conformité porte alors en priorité l'installation d'une GTB. L'inspection périodique R175-5-1 ne s'applique pas en l'absence de système à inspecter.`,
  },
  {
    title: 'Comptage et sous-comptage énergétique',
    body: `Buildy relève les compteurs et sous-compteurs présents et les rattache à un usage (chauffage, refroidissement, ECS, éclairage, production). Le comptage relève de la responsabilité du propriétaire et n'entre pas dans le périmètre de conformité BACS au sens strict ; il est documenté à titre d'inventaire pour éclairer le suivi des consommations et l'établissement du plan d'actions.`,
  },
  {
    title: 'Sévérité des actions et verdict global',
    body: `Chaque écart constaté donne lieu à une action corrective hiérarchisée par sévérité (majeure, modérée, mineure) selon son impact sur la conformité réglementaire. Le verdict global de conformité du bâtiment est dérivé de l'axe le plus défavorable : il ne peut être « conforme » qu'en l'absence d'action majeure ou modérée ouverte. Les actions écartées par le propriétaire sont conservées pour traçabilité mais exclues du plan retenu.`,
  },
  {
    title: 'Inspection périodique distincte de l\'audit (R175-5-1)',
    body: `Le présent audit est un relevé de site réalisé par Buildy ; il ne se substitue pas à l'inspection périodique réglementaire prévue à R175-5-1, laquelle doit être conduite par un organisme tiers indépendant. Lorsque le bâtiment dispose d'une GTB, le rapport rappelle l'échéance d'inspection ; il ne constitue en aucun cas le rapport d'inspection lui-même.`,
  },
  {
    title: 'Usages et zones hors périmètre du décret',
    body: `Certaines zones (locaux techniques, circulations) et certains usages ajoutés manuellement par l'auditeur ne relèvent pas du décret BACS. Ils figurent dans l'inventaire du rapport pour donner une vue complète du site, mais sont exclus du calcul de conformité R175 et ne génèrent pas d'action corrective réglementaire.`,
  },
];
