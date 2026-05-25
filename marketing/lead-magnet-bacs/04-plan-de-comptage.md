# Chapitre 4 — Plan de comptage et suivi énergétique

<!-- ⚠️ Note de production interne — À SUPPRIMER avant mise en page.
Posture cabinet de conseil. Source : table bacs_audit_meters
+ METER_TYPE_LABEL + METER_USAGE_LABEL + générateur d'actions. -->

---

## Page 1 — Pourquoi le comptage est le point le plus structurant

Le R175-3 §1 impose un suivi continu des consommations à pas horaire, conservées sur cinq ans. C'est l'exigence la plus simple à formuler du décret — et la plus fréquemment incomplète sur les bâtiments tertiaires existants.

Il y a deux raisons à cela. D'abord, le comptage a longtemps été pensé pour la facturation, pas pour le pilotage : un compteur général en pied d'immeuble suffisait à l'exploitant pour répartir une facture, mais ne permet pas de détecter une dérive zone par zone. Ensuite, la sous-comptage a été ajouté progressivement, par lots, sans logique d'ensemble — on trouve des sous-compteurs installés mais jamais raccordés à la supervision, ou raccordés mais avec un protocole obsolète.

L'étape 4 consiste à confronter méthodiquement **l'exigence du décret** (un compteur par usage et par zone, communicant et conservant cinq ans d'historique) à **la réalité physique** du bâtiment. Chaque écart entre les deux génère, à l'étape 9, une action corrective chiffrable.

---

## Page 2 — La matrice usage × zone

L'auditeur construit une matrice à deux dimensions : **les usages réglementaires en colonnes** (chauffage, refroidissement, eau chaude sanitaire, éclairage, production photovoltaïque, et un usage *général* pour le hors-périmètre), et **les zones fonctionnelles en lignes** (telles que découpées à l'étape 2).

Pour chaque case, deux questions :

1. **Un compteur est-il requis ?** La réponse découle de la nature de la zone et des systèmes présents. Une zone qui n'a pas de chauffage n'appelle pas de compteur de chauffage. Une zone qui a du chauffage et qui dépasse une certaine puissance en appelle un.
2. **Un compteur est-il physiquement présent ?** Réponse par observation directe sur le terrain.

Ces deux questions construisent la grille de conformité du comptage. La matrice complète, pour un bâtiment moyen, peut compter plusieurs dizaines de cases — chacune devant être examinée, justifiée, et photographiée si un compteur est présent.

> **Compteurs partagés** — Un compteur peut couvrir plusieurs zones (compteur principal d'éclairage extérieur, par exemple). L'auditeur identifie ces compteurs partagés une seule fois, en les rattachant à toutes les zones qu'ils desservent. Cela évite les doublons dans le plan d'action et reflète la réalité du parc compteur.

---

## Page 3 — Pour chaque compteur, ce que l'auditeur consigne

Pour chaque compteur identifié — qu'il soit présent, manquant ou hors service — le dossier comporte :

- **Type de compteur** : électrique, gaz, eau, thermique, électrique de production photovoltaïque.
- **Usage couvert** : chauffage, refroidissement, ECS, éclairage, production PV, ou général.
- **Zone(s) desservie(s)** : selon le découpage de l'étape 2.
- **Présence physique constatée** sur le terrain (observation directe, photo).
- **Communication effective** : le compteur remonte-t-il réellement ses données vers une supervision, à un pas suffisant ?
- **Mode de raccordement** : filaire ou sans-fil, protocole utilisé.
- **Intégration à la supervision existante** : le compteur est-il vu de la GTB, et la liaison est-elle opérationnelle ?
- **État** : en service, hors service, ou installé mais non raccordé.
- **Notes terrain** et photos associées.

Cette consignation systématique permet à l'étape suivante (la génération du plan d'action) de qualifier précisément la nature de chaque action requise — installer un compteur manquant, raccorder un compteur existant, remplacer un compteur défaillant, ou mettre à niveau le protocole d'un compteur trop ancien.

---

## Page 4 — Comment se déduit la conformité R175-3 §1

À partir de la matrice complète, le dossier produit automatiquement la liste des actions correctives à mener pour atteindre la conformité. Trois cas se distinguent :

- **Compteur requis mais physiquement absent** → action **bloquante**. Sans ce compteur, l'exigence R175-3 §1 ne peut pas être tenue. Le rapport identifie l'usage et la zone concernés, et propose une typologie de compteur à installer.
- **Compteur présent mais non communicant** → action **majeure**. L'équipement existe physiquement mais ne remonte pas ses données vers la supervision. La conformité R175-3 §1 (suivi continu) n'est pas tenue tant que la liaison n'est pas établie.
- **Compteur présent et communicant, mais avec une rétention insuffisante** → action **majeure** également, à traiter dans l'étape 6 (évaluation de la supervision), car c'est la supervision qui porte la conservation cinq ans, pas le compteur lui-même.

Les compteurs hors service sont tracés pour mémoire, mais ne génèrent pas d'action corrective tant qu'aucun compteur ne les remplace.

---

## Page 5 — Pièges classiques

- **Sous-compteur installé mais jamais raccordé**. Cas le plus fréquent. Il faut vérifier physiquement le câblage et le protocole, pas se fier au déclaratif de l'exploitant.
- **Compteur communicant en local, pas vers la supervision**. Beaucoup de compteurs modernes ont un afficheur local qui suggère qu'ils remontent leurs données — alors qu'ils ne remontent rien à la supervision. Vérifier sur la console GTB, pas sur le compteur.
- **Compteur partagé entre zones, déclaré sur une seule**. Risque de doublonner les actions correctives. L'auditeur identifie le partage explicitement.
- **Compteur existant mais avec un protocole obsolète** (ex. boucle d'impulsions sans téléreport). Le compteur est physiquement présent, mais incapable de remonter à pas horaire. C'est une action majeure de mise à niveau.
- **Confondre comptage et sous-facturation**. Le décret R175-3 §1 vise le pilotage énergétique, pas la facturation aux occupants. Un bâtiment peut être conforme à la sous-facturation (loi Élan) sans être conforme R175-3 §1.

> **Référence R175** — L'exigence évaluée ici est l'article R175-3 §1 (suivi continu, pas horaire, conservation cinq ans). Le texte intégral figure dans l'annexe A du rapport d'audit.

---

## Page 6 — Ce que produit cette étape

À l'issue de l'étape 4, le dossier d'audit comporte :

- La matrice complète usage × zone, renseignée case par case.
- Pour chaque compteur identifié, sa fiche détaillée (type, usage, zone, état, communication).
- Les photos terrain associées à chaque compteur présent.
- La liste préliminaire des actions correctives liées au comptage, classées par sévérité.

Cette liste alimente directement l'étape 9 (plan d'action), où chaque manque sera chiffré. Elle alimente aussi l'étape 6 (supervision existante), où l'on évaluera la capacité de la supervision à exploiter les compteurs présents — conservation cinq ans, restitution graphique, alertes sur dérives.

---

*[Pied de page] Chapitre 4 / 11 — Plan de comptage*
