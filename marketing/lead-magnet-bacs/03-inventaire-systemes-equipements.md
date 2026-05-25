# Chapitre 3 — Inventaire des systèmes techniques et des équipements

<!-- ⚠️ Note de production interne — À SUPPRIMER avant mise en page Figma/Canva.
Chapitre pilote du lead magnet. Posture : méthode de cabinet de conseil,
l'outil interne Buildy n'est jamais évoqué. Aucune mention de case à cocher,
de champ, de saisie, de matrice automatique. Source factuelle uniquement. -->

---

## Page 1 — Pourquoi cette étape conditionne tout le reste

C'est ici que se fait le gros du travail d'un audit BACS. Avant de regarder la supervision en place, avant de chiffrer un plan d'action, il faut savoir exactement **ce qu'il y a dans le bâtiment**. Sans cet inventaire, le décret R175-3 ne s'applique sur rien.

Pour chaque zone fonctionnelle découpée à l'étape 2, l'auditeur procède en trois temps :

1. Recenser les **systèmes techniques** présents par catégorie réglementaire (chauffage, refroidissement, etc.).
2. Pour chaque système, identifier les **équipements concrets** qui le composent (chaudière, pompe à chaleur, centrale de traitement d'air…).
3. Pour chaque équipement, qualifier sa **conformité au décret** — interopérabilité, possibilité d'arrêt manuel, fonctionnement autonome.

À la fin de l'étape, chaque exigence du R175-3 §3 (interopérabilité) et §4 (arrêt + autonomie) est documentée équipement par équipement. C'est cette granularité qui permet, plus tard, d'élaborer un plan d'action *chiffrable*. Sans elle, vous saurez qu'il y a un problème de conformité, mais vous ne pourrez pas estimer combien il coûtera à corriger.

> **Rappel R175-1 §4** — Les domaines de gestion technique concernés par le décret sont strictement délimités. La méthode d'audit Buildy s'aligne sur cette liste, sans y ajouter d'éléments hors périmètre (sécurité incendie, contrôle d'accès, etc.).

---

## Page 2 — Les sept catégories de systèmes techniques

L'auditeur examine systématiquement chaque zone à la lumière de **sept catégories** de gestion technique : chauffage, refroidissement, ventilation, eau chaude sanitaire, éclairage intérieur, éclairage extérieur, production photovoltaïque. Pour chacune, il détermine si la zone est concernée — et, si oui, dans quelle mesure.

Trois statuts sont possibles : système **présent** (et opérationnel), **absent** (la zone n'en dispose pas), ou **non concerné** (l'absence est justifiée par la nature de la zone — par exemple, un local technique sans éclairage permanent).

Le travail ne s'arrête pas à ce constat. Pour chaque catégorie présente, l'auditeur documente également le degré d'intégration à la supervision existante du bâtiment, et consigne ses observations terrain (typologie, état apparent, contraintes d'accès, anomalies remarquées).

**La nature de la zone (saisie à l'étape 2) oriente l'analyse** : un open-space appelle naturellement chauffage, refroidissement, ventilation et éclairage ; un parking appelle éclairage et éventuellement ventilation ; un local technique a souvent un périmètre réduit. Cette grille d'attendus, construite à partir d'une lecture méthodique du décret, évite à l'auditeur d'oublier des systèmes attendus — et l'aide à justifier les absences.

---

## Page 3 — Le détail des équipements

Lister la catégorie ne suffit pas. Pour que le décret puisse être évalué, il faut descendre à **l'équipement concret**. Pour chaque catégorie marquée présente, l'auditeur recense un ou plusieurs équipements et établit pour chacun une fiche détaillée.

Cette fiche couvre quatre familles d'informations :

- **Identification** : marque, modèle, référence, identifiant interne stable pour le suivi.
- **Caractéristiques techniques** : puissance nominale, source d'énergie, rôle dans la chaîne thermique (production, distribution, émission, régulation).
- **Connectivité et supervision** : protocole de communication, mode de raccordement, niveau d'intégration à la supervision existante.
- **État et conformité réglementaire** : équipement en service ou pas, possibilité d'arrêt manuel, fonctionnement autonome en cas de défaut de la supervision.

Les valeurs autorisées pour chacune de ces dimensions sont volontairement étendues : la méthode couvre l'intégralité du parc tertiaire français — du gaz à la biomasse, de Modbus aux protocoles IP modernes, des installations centralisées aux équipements autonomes. Cette exhaustivité est le prix à payer pour qu'un même livrable soit opposable quel que soit le bâtiment audité.

> **Cas particulier — équipement multi-zones.** Une centrale de traitement d'air alimentant trois plateaux de bureaux, ou un compteur électrique principal couvrant l'ensemble du bâtiment : ces équipements partagés sont identifiés une seule fois et rattachés à toutes les zones qu'ils desservent. C'est un point de vigilance important — un mauvais rattachement génère soit des doublons dans le plan d'action, soit, pire, des oublis.

---

## Page 4 — Comment se déduit la conformité R175-3

Une fois l'inventaire complet, la conformité R175-3 §3 et §4 s'apprécie **équipement par équipement**.

### R175-3 §3 — Interopérabilité

L'équipement est conforme s'il s'intègre à un système d'information du bâtiment via un protocole de communication standard. Il est non conforme s'il fonctionne en îlot, sans liaison avec une supervision (équipement strictement autonome, ou communicant uniquement avec sa propre télécommande propriétaire).

### R175-3 §4 — Arrêt manuel et fonctionnement autonome

Deux exigences distinctes, à apprécier séparément :

- **Arrêt manuel possible** : l'utilisateur peut-il arrêter manuellement l'équipement, sans passer par la supervision (interrupteur physique, bouton sur l'interface locale, vanne d'isolement…) ?
- **Fonctionnement autonome** : en cas de défaut de la supervision ou d'arrêt manuel, l'équipement assure-t-il une fonction minimale de sécurité (hors gel, ventilation de secours, éclairage de sécurité…) ?

Si l'une des deux exigences n'est pas tenue, l'équipement entre dans le plan d'action de l'étape 9, avec une sévérité majeure.

### Liaison de supervision rompue

Cas fréquent : un équipement est intégré à la supervision sur le papier, mais sur le terrain, plus aucune valeur ne remonte (sonde déconnectée, switch en panne, configuration perdue après remplacement de matériel actif…). La méthode trace ces écarts à part, parce qu'ils relèvent d'une action corrective spécifique — rétablir la liaison existante — distincte d'une absence d'intégration.

---

## Page 5 — Combien d'équipements pour un bâtiment typique

Le volume d'équipements à inventorier dépend strictement de la taille et de la nature du bâtiment, pas d'une moyenne théorique. Quelques ordres de grandeur :

- **Un commerce de centre-ville** : une zone, deux ou trois systèmes, trois à cinq équipements.
- **Un plateau de bureaux** : trois à cinq zones, cinq systèmes, dix à quinze équipements.
- **Un siège social de 30 000 m²** : trente à soixante zones, six à sept systèmes, plus d'une centaine d'équipements répartis par étage et par catégorie.

Pour chaque équipement, l'auditeur produit la fiche décrite en page 3, prend une à trois photos, et évalue la conformité R175-3 §3 et §4. C'est cette densité qui fait que **l'étape 3 représente à elle seule entre 30 % et 50 % du temps total de l'audit terrain**.

---

## Page 6 — Pièges classiques

Cette page liste les écarts les plus fréquents entre le déclaratif et la réalité — détectables uniquement parce que l'auditeur descend systématiquement au niveau de l'équipement.

- **Équipement déclaré « communicant » mais non vu de la supervision** → liaison rompue, à tracer comme telle, génère une action corrective spécifique.
- **Pompe à chaleur ou DRV remplacés récemment** sans mise à jour de l'analyse fonctionnelle → la supervision voit encore l'ancien équipement, l'écart doit être documenté.
- **Sous-compteur installé mais jamais raccordé** → présent physiquement, non communicant — déclenche l'action « raccorder le compteur » à l'étape suivante.
- **Centrale de traitement d'air alimentant plusieurs zones** → bien identifier le partage pour ne pas dédoubler les actions correctives.
- **Équipement « hors service » qui disparaît du dossier** → il doit rester tracé dans l'inventaire et apparaître dans le rapport avec mention explicite. Important pour la traçabilité, et utile au gestionnaire pour planifier le remplacement.

> **Référence R175** — Les exigences évaluées dans cette étape sont les articles R175-1 §4 (périmètre), R175-3 §3 (interopérabilité) et R175-3 §4 (arrêt manuel + autonomie). Le texte intégral de ces articles se trouve dans l'annexe A du rapport d'audit.

---

## Fin du chapitre

À l'issue de l'étape 3, le dossier d'audit comporte :

- Une cartographie complète des systèmes techniques par zone fonctionnelle.
- Une fiche détaillée par équipement, avec marque, modèle, puissance, source d'énergie, protocole de communication, rôle dans la chaîne thermique.
- Pour chaque équipement, l'évaluation des R175-3 §3 et §4.
- Les photos terrain associées à chaque équipement.

Ces données alimentent ensuite :

- L'étape 4 (plan de comptage) — qui doit être cohérente avec les puissances et énergies déclarées ici.
- L'étape 5 (régulation thermique) — qui s'appuie sur les équipements de chauffage/refroidissement de cette étape.
- L'étape 6 (supervision existante) — qui évalue dans quelle mesure cet inventaire est effectivement piloté.
- L'étape 9 (plan d'action) — qui transforme les écarts détectés ici en actions correctives chiffrées.

**Sans cette étape proprement faite, les six suivantes sont fausses.**

---

*[Pied de page] Chapitre 3 / 11 — Inventaire des systèmes techniques*
