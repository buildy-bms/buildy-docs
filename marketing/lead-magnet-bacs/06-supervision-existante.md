# Chapitre 6 — Évaluer la supervision existante

<!-- ⚠️ Note de production interne — À SUPPRIMER avant mise en page.
Posture cabinet de conseil. Source : table bacs_audit_bms
+ bacs_audit_gtb_observations + 8 sujets de notes libres. Le terme "GTB"
reste utilisé en l'occurrence (terme générique du marché, pas une mention
de l'outil interne Buildy). -->

---

## Page 1 — Le constat majoritaire : pas de supervision, ou partielle

Sur la majorité des bâtiments tertiaires que nous auditons, **il n'y a pas de supervision GTB en place** — ou il y en a une, mais partielle, ancienne, hors service, ou rachetée par un nouvel exploitant qui n'en a plus le mode d'emploi.

C'est un point important à comprendre avant de plonger dans cette étape : le décret BACS n'oblige pas à *avoir* une GTB nominative. Il oblige à *remplir certaines fonctions* — suivi continu, interopérabilité, détection de dérives, mise à disposition des données. Que ces fonctions soient assurées par une GTB historique de marque connue, par une supervision développée sur mesure, ou par une combinaison de deux outils, le décret reste neutre tant que les fonctions sont effectivement tenues.

L'étape 6 sert donc à deux choses, selon la situation rencontrée :

- **Si une supervision existe** : évaluer méthodiquement sa couverture des exigences R175-3, R175-4 et R175-5, sujet par sujet.
- **Si aucune supervision n'est en place** : documenter précisément ce qui manque, pour pouvoir le chiffrer à l'étape 9.

Dans les deux cas, le travail produit une cartographie nette de la situation, qui sert de base au plan d'action.

---

## Page 2 — Identifier la supervision en place

Avant d'évaluer, il faut identifier précisément. La supervision est rarement un objet unique et bien étiqueté ; c'est souvent un agrégat de plusieurs systèmes installés à différentes époques. L'auditeur consigne :

- **La solution principale** — nom commercial, marque, version si possible. Plus rarement, l'absence pure et simple.
- **La localisation physique** des serveurs et automates principaux. Important pour l'accessibilité en cas d'intervention et pour les questions de cybersécurité.
- **Les modèles d'équipements actifs** — automates programmables, passerelles, gateways protocolaires. Ces références conditionnent la pérennité (matériels en fin de vie commerciale, support constructeur arrêté, etc.).
- **Les protocoles supportés** — c'est ce qui détermine la capacité de la supervision à dialoguer avec les équipements terrain (étape 3) et les compteurs (étape 4).
- **L'état général** — en service, hors service, partiellement opérationnel.

Cette identification factuelle évite les jugements hâtifs. Une « vieille GTB qu'on dit obsolète » peut très bien être largement conforme aux exigences R175-3 — l'évaluation se fait sur les fonctions, pas sur l'année du matériel.

---

## Page 3 — Les domaines réellement pilotés

Le R175-1 §4 liste les domaines de gestion technique concernés par le décret. Toutes les installations ne pilotent pas tous ces domaines. L'auditeur examine, pour chaque domaine — chauffage, refroidissement, ventilation, eau chaude sanitaire, éclairage — si la supervision en place le couvre effectivement, et avec quelle profondeur.

Trois cas typiques :

- **Domaine couvert et opérationnel** — la supervision pilote, monitor, journalise. Conformité possible (à examiner sur les exigences R175-3 §1 et §2 ci-dessous).
- **Domaine couvert sur le papier, défaillant sur le terrain** — la supervision est censée gérer le domaine, mais soit les équipements sont déconnectés (cas évoqué à l'étape 3 avec la liaison rompue), soit les fonctionnalités ne sont plus utilisées (paramètres obsolètes, alarmes désactivées). C'est une non-conformité partielle qui appelle des actions de remise à niveau, généralement moins coûteuses qu'un déploiement complet.
- **Domaine non couvert** — la supervision ignore le domaine. Soit parce qu'il n'a jamais été intégré, soit parce que l'extension n'a pas suivi un changement d'usage du bâtiment. Action d'extension à chiffrer.

---

## Page 4 — L'évaluation R175-3 §1 et §2

Deux exigences fonctionnelles centrales du décret, à examiner avec précision.

### R175-3 §1 — Suivi continu des consommations

L'auditeur vérifie trois choses :

- **La continuité du suivi** : la supervision enregistre-t-elle effectivement les consommations à un pas suffisant (horaire au minimum) ? Vérification sur la console, pas sur la documentation.
- **Le format d'archivage** : les données sont-elles stockées dans une base structurée et exportable, ou dans un format propriétaire qui empêcherait toute migration ?
- **La rétention cinq ans** : l'auditeur vérifie qu'on peut effectivement consulter une courbe de consommation d'il y a quatre ou cinq ans sur la console — pas seulement que la supervision *prétend* conserver cinq ans. Le test concret se fait en demandant à voir une courbe de chauffage de l'hiver précédent, par exemple.

### R175-3 §2 — Détection des pertes d'efficacité

Cette exigence est souvent la plus mal couverte. Elle suppose que la supervision a été configurée avec des **règles d'alerte sur les dérives** — écart anormal de consommation à conditions équivalentes, baisse de COP d'une PAC, surconsommation hors plage horaire. L'auditeur examine la liste des alertes effectivement actives, et si possible un historique des alertes déclenchées dans l'année écoulée. Une supervision sans alerte active depuis 24 mois est, en pratique, non conforme à cette exigence — quel que soit le matériel installé.

---

## Page 5 — La mise à disposition des données et la maintenance

### Mise à disposition des données

Le décret R175-3 prévoit que les données soient mises à disposition de **deux types d'acteurs distincts** : le gestionnaire du bâtiment (asset manager, property manager, propriétaire) et les exploitants des systèmes techniques (bureau d'études, intégrateur, mainteneur). L'auditeur examine les procédures effectives :

- Les données sont-elles accessibles au gestionnaire (rapport mensuel, accès portail, export CSV) ?
- Les données sont-elles transmises aux exploitants (procédure documentée, fréquence, format) ?
- Existe-t-il une trace écrite de ces procédures, ou tout repose-t-il sur des habitudes orales ?

Une supervision techniquement excellente peut être non conforme R175-3 si les procédures de mise à disposition n'existent pas formellement.

### R175-4 — Vérifications périodiques

L'auditeur examine le **carnet d'entretien** de la supervision — existe-t-il, est-il à jour, qui le remplit ? Trois éléments factuels sont consignés : l'existence de procédures écrites, la périodicité effective des interventions, le responsable identifié (interne ou prestataire). Une supervision sans aucun document de maintenance formalisé n'est pas conforme R175-4, indépendamment de la qualité technique de l'installation.

### R175-5 — Formation de l'exploitant

L'auditeur cherche **l'attestation de formation** — quand l'exploitant en place a-t-il été formé à l'utilisation de la supervision, par quel organisme, sur quels sujets ? La formation initiale du livreur de l'installation suffit rarement à dix ans d'écart, après changements d'équipe. C'est l'une des non-conformités les plus fréquentes — et l'une des plus simples à corriger.

---

## Page 6 — Notes libres par sujet

Au-delà des exigences strictes du décret, l'auditeur consigne des **observations libres par sujet**, qui complètent l'analyse réglementaire. Huit sujets sont systématiquement examinés :

- L'analyse fonctionnelle existante de la supervision.
- Les usages réellement pilotés (cohérence avec l'analyse de la page 3).
- Les équipements intégrés à la supervision.
- Les compteurs intégrés à la supervision.
- Les capacités effectives R175-3 (suivi, détection).
- La mise à disposition des données.
- Les vérifications périodiques.
- La formation de l'exploitant.

Pour chaque sujet, l'auditeur écrit librement ce qu'il constate, ce qui pose problème, et ce que Buildy peut éventuellement améliorer. Ces observations enrichissent le rapport au-delà de la stricte évaluation R175. Elles sont reprises dans la synthèse de l'étape 10 et alimentent le dialogue avec le propriétaire.

---

## Page 7 — Ce que produit cette étape

À l'issue de l'étape 6, le dossier d'audit comporte :

- L'identification précise de la supervision en place (ou de son absence).
- L'évaluation des cinq domaines pilotables (chauffage, refroidissement, ventilation, ECS, éclairage).
- L'évaluation des exigences R175-3 §1 et §2 (suivi continu, détection de dérives).
- L'évaluation des procédures de mise à disposition des données.
- L'évaluation R175-4 (vérifications périodiques) et R175-5 (formation).
- Les notes libres par sujet, qui complètent l'analyse réglementaire.

Cette analyse alimente l'étape 9 (plan d'action), où chaque non-conformité génère une action chiffrée. Elle alimente aussi la synthèse de l'étape 10, où elle est mise en perspective au regard de l'usage et des objectifs du gestionnaire.

---

*[Pied de page] Chapitre 6 / 11 — Supervision existante*
