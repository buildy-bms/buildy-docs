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
  `Le présent rapport constitue un audit de conformité préalable au décret n° 2023-259 du 7 avril 2023 (BACS), réalisé à des fins informatives et commerciales. Il ne se substitue pas à l'inspection périodique réglementaire prévue à l'article R175-5-1, qui doit être réalisée à l'initiative du propriétaire par un tiers compétent.`,
  `L'évaluation est conduite selon une approche fonctionnelle, basée sur les 4 exigences de l'article R175-3, indépendamment de la norme NF EN ISO 52120-1 dont l'application est volontaire en France.`,
  `La conformité au décret BACS est distincte de l'éligibilité aux Certificats d'Économies d'Énergie (CEE) : la fiche BAT-TH-116 exige un système certifié classe A ou B selon ISO 52120-1, ce qui n'est pas requis par le décret. Si le propriétaire souhaite bénéficier des CEE, une certification supplémentaire est nécessaire.`,
  `Le calcul du temps de retour sur investissement (clause de dispense de l'article R175-2, TRI > 10 ans) n'est en aucun cas réalisé par Buildy. Ce calcul relève exclusivement de la responsabilité du propriétaire, qui s'appuie sur les devis qu'il aura reçus pour la mise en conformité et sur ses propres hypothèses de réduction des coûts énergétiques. Buildy mentionne l'existence de cette clause à titre informatif uniquement et n'émet aucun avis sur son applicabilité ni sur le résultat éventuel du calcul.`,
  `Le présent audit est basé sur l'état des textes en vigueur à la date d'établissement du rapport. Toute évolution réglementaire ultérieure peut modifier les conclusions.`,
  `Les recommandations sont formulées à titre indicatif et non contraignant. Le propriétaire reste seul juge des suites à donner et des moyens de mise en conformité retenus.`,
  `Buildy ne saurait être tenu responsable d'éventuels manquements résultant d'informations partielles ou erronées fournies lors de l'audit, ni d'évolutions ultérieures de l'état du bâtiment.`,
];
