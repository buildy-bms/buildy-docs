# Chapitre 9 — Le plan d'action de mise en conformité

<!-- ⚠️ Note de production interne — À SUPPRIMER avant mise en page.
Posture cabinet de conseil — pas de "génération automatique" ni de "module
qui calcule". L'auditeur "élabore", "construit", "consolide". Source :
table bacs_audit_action_items + bacs-audit-action-generator.js (logique
métier, présentée comme la méthode Buildy). -->

---

## Page 1 — De l'inventaire au plan d'action

Les huit étapes précédentes ont produit, sans hiérarchisation, **la liste exhaustive des écarts** entre la situation observée et les exigences du décret R175. À l'étape 9, l'auditeur transforme cette liste en **plan d'action chiffrable et opposable**.

Le passage est important. Sans hiérarchisation, le propriétaire reçoit une masse d'informations dans laquelle il ne peut pas prioriser. Avec un plan d'action structuré, il dispose d'une feuille de route lisible, qu'il peut remettre tel quel à un intégrateur GTB pour chiffrage, ou utiliser pour arbitrer en interne quelles actions traiter en premier.

La méthode Buildy applique des règles de hiérarchisation **identiques pour tous les bâtiments**. Cette uniformité est essentielle : elle permet à un propriétaire qui possède plusieurs sites de comparer les rapports entre eux et d'organiser un budget pluriannuel cohérent.

---

## Page 2 — Trois niveaux de sévérité

Chaque action corrective est classée selon trois sévérités, qui correspondent à trois niveaux de risque pour le propriétaire :

### Bloquante

L'action concerne une exigence du décret qui n'est **structurellement pas tenue**. Sans cette correction, le bâtiment ne peut pas être déclaré conforme, même partiellement. Exemples typiques :

- Un compteur réglementairement requis est physiquement absent.
- La supervision n'assure aucun suivi continu des consommations (R175-3 §1).
- Aucune supervision n'est en place sur un bâtiment soumis à l'obligation.

Les actions bloquantes doivent être traitées en priorité. Le rapport recommande de les engager avant l'échéance applicable au bâtiment (1ᵉʳ janvier 2025 ou 2027 selon la puissance).

### Majeure

L'action concerne une exigence **partiellement tenue**, ou tenue **sur le papier mais pas sur le terrain**. La conformité n'est pas atteinte, mais l'écart est réparable sans refonte profonde. Exemples typiques :

- Un compteur est présent mais non communicant.
- Un équipement est intégré à la supervision sur le papier, mais sa liaison est cassée.
- L'exploitant n'a pas été formé.
- Les procédures de maintenance R175-4 ne sont pas formalisées.

### Mineure

L'action concerne une amélioration **utile mais non critique** au regard du décret. Le bâtiment peut être déclaré conforme sans la traiter, mais le rapport la signale parce qu'elle apporte une valeur opérationnelle réelle (économie d'énergie, fiabilité accrue, simplification de l'exploitation).

---

## Page 3 — Pour chaque action, ce que le rapport contient

Chaque action du plan est détaillée selon une trame fixe, identique pour toutes :

- **Un identifiant stable** (BACS-001, BACS-002, etc.) qui permet de la référencer sans ambiguïté dans les échanges avec les intégrateurs.
- **Un titre court** qui dit ce qu'il faut faire, sans technicité inutile.
- **Une description** qui contextualise — d'où vient le constat, sur quelle zone ou quel équipement, quelle observation l'a révélé.
- **L'article R175 concerné**, cité explicitement. Cela donne à chaque action sa base légale et permet au propriétaire de répondre à un contrôle.
- **La sévérité** (bloquante, majeure, mineure).
- **La zone et l'équipement source**, pour que l'intégrateur sache où intervenir.
- **Une estimation d'effort** (faible, moyen, élevé) que l'auditeur Buildy renseigne en fonction de l'expérience accumulée. Cette estimation **n'est pas un chiffrage** — c'est une indication de magnitude pour aider à la priorisation budgétaire.
- **Des solutions alternatives**, quand l'action peut être traitée de plusieurs manières (raccorder un compteur existant *vs* le remplacer ; étendre la supervision en place *vs* la remplacer entièrement). Le propriétaire conserve ainsi sa marge d'arbitrage.
- **Un statut de traitement** (ouverte, devisée, en cours, terminée, écartée) qui permet de suivre l'avancement dans le temps, audit après audit.

---

## Page 4 — Comment se construit le plan, écart par écart

L'auditeur ne « décide » pas arbitrairement de la sévérité. Elle découle de la nature de l'écart constaté, selon une grille systématique :

| Origine de l'écart | Action générée | Sévérité | Article |
|---|---|---|---|
| Équipement isolé du système d'information | Rendre l'équipement communicant | Majeure | R175-3 §3 |
| Équipement sans arrêt manuel | Permettre l'arrêt manuel | Majeure | R175-3 §4 |
| Équipement sans fonctionnement autonome | Activer le mode autonome | Majeure | R175-3 §4 |
| Liaison de supervision rompue | Rétablir la liaison | Majeure | R175-3 |
| Compteur requis absent | Installer le compteur | **Bloquante** | R175-3 §1 |
| Compteur présent non communicant | Raccorder le compteur | Majeure | R175-3 §1 |
| Aucune supervision en place | Déployer une supervision | **Bloquante** | R175-3 |
| Supervision sans détection de dérives | Configurer les alertes | Majeure | R175-3 §2 |
| Procédures de maintenance non formalisées | Établir les procédures | Majeure | R175-4 |
| Exploitant non formé | Programmer la formation | Mineure | R175-5 |
| Régulation thermique manquante (R175-6 applicable) | Selon contexte | Bloquante ou Majeure | R175-6 |

Cette grille rend le plan **reproductible** d'un audit à l'autre — deux auditeurs Buildy intervenant sur le même bâtiment produisent un plan d'action identique. C'est une garantie de fiabilité pour le propriétaire.

> **Cas des équipements hors service** — Un équipement déclaré hors service ne génère pas d'action corrective tant qu'aucun équipement ne le remplace. Il reste tracé dans l'inventaire et dans le rapport, pour mémoire et pour la planification de remplacement.

> **Cas des exemptions** — Un générateur à biomasse exempté du R175-6, par exemple, ne génère aucune action. L'exemption est tracée explicitement dans le rapport pour qu'elle soit défendable face à un contrôle.

---

## Page 5 — Annotations commerciales et solutions alternatives

Le plan d'action n'est pas seulement un constat technique. Il intègre également **des annotations commerciales** que l'auditeur ajoute pour préparer le travail des intégrateurs et de l'équipe commerciale du propriétaire :

- **Notes contextuelles** — particularités d'accès, contraintes d'exploitation, périodes d'arrêt prévues, relation avec le mainteneur en place.
- **Solutions alternatives** — quand plusieurs approches sont envisageables, l'auditeur les pose à plat. Cela évite que l'intégrateur reçoive une demande étroite et chiffre une seule solution alors qu'une autre serait moins coûteuse ou plus pérenne.
- **Effort estimé** — magnitude qualitative (faible, moyen, élevé), pour aider à la priorisation budgétaire avant chiffrage précis.

Ces annotations distinguent un audit Buildy d'une simple liste de constats : elles rendent le plan exploitable directement, sans phase intermédiaire d'analyse.

---

## Page 6 — Ce que produit cette étape

À l'issue de l'étape 9, le dossier d'audit comporte :

- Le plan d'action complet, hiérarchisé par sévérité (bloquantes, majeures, mineures).
- Pour chaque action, sa fiche complète (identifiant, titre, description, article R175, zone, source, effort, alternatives, notes).
- La traçabilité de chaque action vers l'écart constaté qui l'a générée — un intégrateur peut remonter de l'action à l'observation terrain qui l'a justifiée.
- Une vue d'ensemble lisible par un décideur non technique, qui pourra arbitrer les priorités.

Ce plan d'action constitue **la valeur métier centrale** de l'audit. C'est sur cette base que le propriétaire engage les travaux, sollicite les intégrateurs, et arbitre son budget de mise en conformité.

---

*[Pied de page] Chapitre 9 / 11 — Plan d'action de mise en conformité*
