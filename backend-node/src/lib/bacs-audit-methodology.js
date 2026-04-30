'use strict';

/**
 * Methodologie et hypotheses retenues par Buildy pour realiser l'audit BACS.
 *
 * Inclus en Annexe B de chaque rapport PDF d'audit. Ces 9 points couvrent
 * le perimetre BACS retenu, le seuil de puissance, la definition de zone,
 * l'interoperabilite, le calcul de la date butoir, etc.
 *
 * Cf plan section "Methodologie Buildy — hypotheses retenues" pour les
 * details. Modifications a tracer dans le commit (impacte tous les
 * rapports futurs ; pas les anciens — le PDF est fige par git tag a la
 * livraison).
 */

module.exports = [
  {
    title: 'Perimetre BACS retenu',
    body: `Seuls les systemes techniques mentionnes au 4° de l'article R175-1 sont audites : chauffage, refroidissement, ventilation, eau chaude sanitaire, eclairage integre au bati, production electrique sur site, systemes d'automatisation et de controle. Les systemes hors perimetre (occultations, prises pilotees, securite incendie, etc.) sont mentionnes a titre indicatif mais hors evaluation de conformite.`,
  },
  {
    title: 'Seuil de puissance applicable',
    body: `La puissance consideree pour determiner l'applicabilite du decret est la puissance nominale utile cumulee des systemes de chauffage et de climatisation, conformement a R175-2 §I. Les seuils sont 290 kW (echeance 1er janvier 2025) et 70 kW (echeance 1er janvier 2027), avec exemption en deca de 70 kW.`,
  },
  {
    title: 'Definition de zone fonctionnelle',
    body: `Conformement a R175-1 §6, une zone fonctionnelle est un espace au sein duquel les usages sont homogenes (ex : open-space tertiaire, atelier, local technique, parking). Buildy s'appuie sur le decoupage zonal existant du site lorsqu'il en existe un ; sinon, le decoupage est propose en accord avec le proprietaire ou son representant.`,
  },
  {
    title: 'Suivi continu des donnees (R175-3 §1)',
    body: `La conformite a l'exigence de suivi requiert que les donnees soient collectees par zone fonctionnelle, a pas horaire, et conservees a l'echelle mensuelle pendant 5 ans minimum. Tout systeme ne respectant pas cette duree de conservation est considere comme non conforme dans le present audit.`,
  },
  {
    title: 'Interoperabilite (R175-3 §3)',
    body: `Un systeme est considere comme interoperable s'il supporte au moins un protocole standard ouvert (BACnet/IP, BACnet MS/TP, Modbus TCP, Modbus RTU, KNX, M-Bus, MQTT) avec les autres systemes techniques du batiment. Les passerelles proprietaires fermees ne satisfont pas cette exigence.`,
  },
  {
    title: 'Regulation thermique automatique (R175-6)',
    body: `Buildy verifie l'existence d'une regulation automatique de la temperature par piece ou par zone. La conformite est appreciee a l'installation du generateur ou a son remplacement. Les appareils independants de chauffage au bois beneficient de l'exemption explicite mentionnee a l'article et ne declenchent pas d'action corrective.`,
  },
  {
    title: 'Verifications periodiques (R175-4)',
    body: `Buildy verifie l'existence de consignes ecrites encadrant la maintenance du BACS. L'absence de telles consignes constitue une non-conformite. La modelisation detaillee de l'historique de maintenance n'est pas dans le perimetre de l'audit.`,
  },
  {
    title: 'Formation de l\'exploitant (R175-5)',
    body: `Buildy demande au proprietaire ou a son representant si l'exploitant a recu une formation au parametrage du BACS. Lorsque la solution BACS deployee est Buildy, cette exigence est nativement couverte par le support utilisateur integre dans l'application (assistance contextuelle, documentation embarquee, support continu). Ce mode de formation continue repond a l'esprit du R175-5, qui n'impose pas de modalite specifique. La preuve documentaire est consignee pour les solutions tierces.`,
  },
  {
    title: 'Date butoir applicable',
    body: `Buildy calcule la date butoir reglementaire en fonction de la puissance nominale utile cumulee et de la date du permis de construire selon R175-2 : > 290 kW echeance 1er janvier 2025 (immediate pour les batiments neufs livres apres cette date), > 70 kW echeance 1er janvier 2027 ou date de renouvellement du systeme. Cette date est rappelee en premiere page du rapport.`,
  },
];
