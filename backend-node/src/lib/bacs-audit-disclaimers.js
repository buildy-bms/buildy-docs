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
 * Cf plan section "Disclaimers obligatoires". Toute modification doit etre
 * relue par un juriste avant deploiement.
 */

module.exports = [
  `Le present rapport constitue un audit de conformite prealable au decret n° 2023-259 du 7 avril 2023 (BACS), realise a des fins informatives et commerciales. Il ne se substitue pas a l'inspection periodique reglementaire prevue a l'article R175-5-1, qui doit etre realisee a l'initiative du proprietaire par un tiers competent.`,
  `L'evaluation est conduite selon une approche fonctionnelle, basee sur les 4 exigences de l'article R175-3, independamment de la norme NF EN ISO 52120-1 dont l'application est volontaire en France.`,
  `La conformite au decret BACS est distincte de l'eligibilite aux Certificats d'Economies d'Energie (CEE) : la fiche BAT-TH-116 exige un systeme certifie classe A ou B selon ISO 52120-1, ce qui n'est pas requis par le decret. Si le proprietaire souhaite beneficier des CEE, une certification supplementaire est necessaire.`,
  `Le calcul du temps de retour sur investissement (clause de dispense de l'article R175-2, TRI > 10 ans) n'est en aucun cas realise par Buildy. Ce calcul releve exclusivement de la responsabilite du proprietaire, qui s'appuie sur les devis qu'il aura recus pour la mise en conformite et sur ses propres hypotheses de reduction des couts energetiques. Buildy mentionne l'existence de cette clause a titre informatif uniquement et n'emet aucun avis sur son applicabilite ni sur le resultat eventuel du calcul.`,
  `Le present audit est base sur l'etat des textes en vigueur a la date d'etablissement du rapport. Toute evolution reglementaire ulterieure peut modifier les conclusions.`,
  `Les recommandations sont formulees a titre indicatif et non contraignant. Le proprietaire reste seul juge des suites a donner et des moyens de mise en conformite retenus.`,
  `Buildy ne saurait etre tenu responsable d'eventuels manquements resultant d'informations partielles ou erronees fournies lors de l'audit, ni d'evolutions ulterieures de l'etat du batiment.`,
];
