'use strict';

/**
 * Mentions legales et disclaimers obligatoires de chaque rapport d'audit
 * BACS produit par Buildy.
 *
 * Inclus en Annexe D du PDF. Vise a proteger Buildy de toute responsabilite
 * liee a (1) la non-substitution a l'inspection officielle R175-5-1, (2)
 * l'approche fonctionnelle vs la norme ISO 52120-1, (3) la distinction
 * decret BACS / CEE, (4) le calcul de TRI qui n'est pas du ressort de
 * Buildy, (5) l'evolution reglementaire, (6) le caractere indicatif des
 * recommandations, (7) la fiabilite des informations fournies par le
 * proprietaire.
 *
 * Note : commentaires en ASCII-safe, valeurs en francais accentue (PDF livre).
 *
 * Cf plan section "Disclaimers obligatoires". Toute modification doit etre
 * relue par un juriste avant deploiement. Apres migration 65, ces valeurs
 * sont seedees dans pdf_boilerplate ; ce fichier sert de fallback. Editer
 * via la page admin "Textes standards PDF".
 */

module.exports = [
  `Le présent rapport est un audit de conformité aux articles R175-1 à R175-6 du code de la construction et de l'habitation (décret BACS), réalisé par Buildy à des fins d'information et de préparation d'un devis. Il ne remplace pas l'inspection périodique prévue à l'article R175-5-1, organisée à l'initiative du propriétaire de la GTB.`,
  `L'évaluation est conduite selon une approche fonctionnelle, basée sur les 4 exigences de l'article R175-3, indépendamment de la norme NF EN ISO 52120-1 dont l'application est volontaire en France.`,
  `La conformité au décret BACS est distincte de l'éligibilité aux certificats d'économies d'énergie (CEE). La fiche d'opération standardisée BAT-TH-116 exige une GTB de classe A ou B au sens de la norme NF EN ISO 52120-1, ce que le décret n'impose pas (FAQ BACS n° 19). Les conditions d'éligibilité aux CEE évoluent et sont à vérifier à la date d'engagement des travaux.`,
  `Buildy ne calcule pas le temps de retour sur investissement ouvrant droit aux dispenses du décret (dix ans pour la GTB, R175-2 ; six ans pour la régulation par pièce, R175-6). Ce calcul relève du propriétaire ; pour la GTB, il suit la méthode fixée par l'arrêté du 7 avril 2023 : au moins deux devis réels, gain énergétique de 15 % ou issu d'un audit énergétique, aides financières déduites (R175-2 III). Buildy mentionne ces dispenses à titre d'information et n'émet aucun avis sur leur application ni sur le résultat du calcul.`,
  `Le présent audit est basé sur l'état des textes en vigueur à la date d'établissement du rapport. Toute évolution réglementaire ultérieure peut modifier les conclusions.`,
  `Les recommandations sont formulées à titre indicatif et non contraignant. Le propriétaire reste seul juge des suites à donner et des moyens de mise en conformité retenus.`,
  `Buildy ne saurait être tenu responsable d'éventuels manquements résultant d'informations partielles ou erronées fournies lors de l'audit, ni d'évolutions ultérieures de l'état du bâtiment.`,
];
