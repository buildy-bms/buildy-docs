# Chapitre 8 — Inspections périodiques R175-5-1 et accès techniques

<!-- ⚠️ Note de production interne — À SUPPRIMER avant mise en page.
Posture cabinet de conseil. Source : table bacs_audit_inspections + table credentials.
Insister sur la distinction audit Buildy / inspection officielle. -->

---

## Page 1 — Audit Buildy n'est pas inspection R175-5-1

Le décret BACS impose deux démarches distinctes au propriétaire :

- **L'audit fonctionnel de la gestion technique du bâtiment**, qui peut être interne ou externalisé. C'est la prestation que Buildy réalise.
- **L'inspection périodique R175-5-1**, qui doit être réalisée par un **organisme tiers indépendant** — ni le propriétaire, ni l'exploitant, ni l'intégrateur GTB. Cette inspection est obligatoire à intervalles réguliers, son rapport doit être conservé pendant dix ans, et il peut être exigé en cas de contrôle.

**Ces deux démarches ne se substituent pas l'une à l'autre.** Un audit Buildy aide à préparer une inspection R175-5-1 (en garantissant que le bâtiment est en état d'être inspecté), mais il ne la remplace pas. À l'inverse, une inspection R175-5-1 ne dispense pas d'un audit fonctionnel approfondi — elle vérifie la conformité, elle ne construit pas le plan d'action.

L'étape 8 sert donc à **tracer les inspections officielles déjà réalisées** par des tiers, pour les intégrer au dossier sans les confondre avec l'audit Buildy.

---

## Page 2 — Tracer les inspections officielles existantes

Pour chaque inspection R175-5-1 déjà réalisée sur le bâtiment, le dossier consigne :

- **La date** de l'inspection.
- **L'organisme** ayant réalisé l'inspection (raison sociale, numéro d'agrément éventuel).
- **Les anomalies constatées** par l'inspecteur.
- **Les recommandations** émises.
- **La date de la prochaine inspection due** selon la périodicité réglementaire applicable au bâtiment.
- **La référence du rapport** (numéro, archivage), avec la date jusqu'à laquelle il doit être conservé (dix ans après émission).

Si aucune inspection R175-5-1 n'a encore été réalisée sur le bâtiment, le dossier le consigne explicitement et précise la date à laquelle la première inspection est due. C'est une information critique pour le propriétaire : un bâtiment assujetti depuis trois ans sans inspection officielle est en situation irrégulière, indépendamment de la qualité technique de son installation.

---

## Page 3 — Les accès techniques nécessaires à l'exploitation

Au-delà des inspections, le dossier trace également les **accès techniques** indispensables à l'exploitation continue du bâtiment :

- **Identifiants de la supervision** — qui détient les comptes administrateurs, où sont conservés les mots de passe, comment ils sont renouvelés.
- **Accès distants** — VPN, plateformes web de pilotage, applications mobiles, et leurs dépendances (certificats, clés API).
- **Contacts opérationnels** — exploitant en titre, mainteneur des équipements terrain, intégrateur de la supervision, support du fournisseur. Un bâtiment dont le mainteneur a quitté l'entreprise il y a deux ans, et dont personne ne sait à qui s'adresser pour un dépannage, est un risque opérationnel majeur — souvent invisible jusqu'à la première panne.

L'auditeur ne consigne pas les mots de passe en clair dans le rapport (question de cybersécurité). Il consigne **qui détient quoi**, et signale les lacunes (compte unique partagé entre cinq personnes, mot de passe inchangé depuis le déploiement initial, certificat expiré, etc.).

---

## Page 4 — Ce que produit cette étape

À l'issue de l'étape 8, le dossier d'audit comporte :

- L'historique des inspections R175-5-1 déjà réalisées, avec leurs constats et recommandations.
- L'identification claire de la prochaine inspection due et de l'organisme à contacter.
- La cartographie des accès techniques au bâtiment (sans exposer les credentials eux-mêmes).
- Les contacts opérationnels indispensables à l'exploitation continue.
- L'identification des lacunes éventuelles (absence d'inspection, contacts orphelins, accès partagés).

Cette traçabilité protège le propriétaire en cas de contrôle préfectoral, et lui donne la visibilité nécessaire pour piloter la maintenance dans la durée.

---

*[Pied de page] Chapitre 8 / 11 — Inspections R175-5-1 et accès techniques*
