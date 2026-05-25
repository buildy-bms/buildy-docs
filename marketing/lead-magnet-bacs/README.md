# Lead magnet PDF — La méthode interne d'audit BACS de Buildy

Brouillons de production du lead magnet LinkedIn, en markdown, à mettre en page
ensuite dans Figma ou Canva Pro (template magazine).

**Plan de référence** : `~/.claude/plans/dans-les-audits-bacs-cheeky-hollerith.md`
sections §1 à §14.

**Source rédactionnelle** :
- Article FAQ Crisp publié « Comment se passe un audit BACS avec Buildy ? »
- Code du module audit BACS de Buildy Docs (tables `bacs_audit_*`,
  `_compliance-summary.js`, `bacs-audit-action-generator.js`, `_labels.js`)

**Règle absolue** : rien d'inventé, rien d'ajouté. Tout chiffre commercial doit
être validé par Kévin avant publication.

## Statut des chapitres

| # | Chapitre | Fichier | Statut |
|---|---|---|---|
| 00 | Table des matières + métadonnées | `00-table-des-matieres.md` | ✓ Rédigé |
| 00b | Préambule (couverture + intro + décret en 1 page) | `00-preambule.md` | ✓ Rédigé |
| 01 | Cadrage R175-2 (assujettissement) | `01-cadrage-r175-2.md` | ✓ Rédigé |
| 02 | Zones fonctionnelles | `02-zones-fonctionnelles.md` | ✓ Rédigé |
| 03 | Inventaire systèmes + équipements (pilote) | `03-inventaire-systemes-equipements.md` | ✓ Rédigé |
| 04 | Plan de comptage R175-3 §1 | `04-plan-de-comptage.md` | ✓ Rédigé |
| 05 | Régulation thermique R175-6 | `05-regulation-thermique.md` | ✓ Rédigé |
| 06 | Supervision existante (R175-3, R175-4, R175-5) | `06-supervision-existante.md` | ✓ Rédigé |
| 07 | Check-list documentaire | `07-checklist-documentaire.md` | ✓ Rédigé |
| 08 | Inspections R175-5-1 + accès techniques | `08-inspections-r175-5-1.md` | ✓ Rédigé |
| 09 | Plan d'action de mise en conformité | `09-plan-action.md` | ✓ Rédigé |
| 10 | Synthèse & livraison | `10-synthese-livraison.md` | ✓ Rédigé |
| 11 | Pièges à éviter après l'audit | `10b-pieges-a-eviter.md` | ✓ Rédigé |
| — | Conclusion + pivot Buildy + 4ᵉ couverture | `11-conclusion.md` | ✓ Rédigé |

## Prochaines étapes

1. **Relecture éditoriale** — vérifier l'enchaînement des chapitres, la
   cohérence du vocabulaire (posture cabinet de conseil partout, jamais
   d'« outil » / « module »), corriger les coquilles éventuelles.
2. **Compléter les `[À COMPLÉTER PAR KÉVIN]`** :
   - Email de contact direct (préambule + conclusion).
   - URL landing page (`buildy.fr/audit-bacs` ou autre).
   - URL Calendly du QR code (4ᵉ couverture).
   - Paragraphe pivot Buildy n°2 (`11-conclusion.md` page 2), 3-4 lignes
     avec uniquement des faits validés.
   - Photo de couverture (chantier réel, pas stock photo).
3. **Mise en page via Claude.ai** (Claude Design). Voir
   `99-prompt-claude-design.md` pour le mode d'emploi : le fichier
   `_consolide-pour-claude-design.md` regroupe tout le contenu sans les
   notes internes, prêt à coller dans Claude après le prompt système
   ciselé.
4. **Landing page** dédiée (§8 du plan) + **séquence email** J0-J14
   (§10 du plan).
5. **Publication LinkedIn** : post de lancement + carrousel teaser
   (§9 du plan).
6. **Bouclage** : MAJ de l'article FAQ #16 avec CTA « Télécharger le
   manuel complet » qui pointe vers la landing page.

## Ce qu'il n'y a PAS dans ces brouillons

- Pas d'anecdotes terrain (« sur un audit à Lyon en mai… »).
- Pas de chiffres commerciaux non validés (« 100+ chantiers », « 8 000 € », « 18 mois »).
- Pas de comparatifs concurrents.
- Pas d'image (à ajouter en mise en page).

## Règle de divulgation (validée 2026-05-12)

**Donner assez pour rendre la méthode crédible, garder assez pour que la
reproduction reste du travail.**

Concrètement :

- ✅ **Dire combien** : « sept catégories de systèmes », « jusqu'à plus
  d'une centaine d'équipements pour un siège social ». Le comptage produit
  l'effet « ça en fait beaucoup » sans donner la matrice à copier.
- ✅ **Dire la logique métier** : *« compteur requis mais absent =
  action bloquante »*. Le décret est public, la conséquence métier aussi
  — c'est la valeur pédagogique du document.
- ✅ **Citer les libellés FR génériques** quand ils sont déjà publics
  (Modbus, BACnet, KNX…), mais en illustration, jamais en énumération
  exhaustive.
- ❌ **Pas de tableaux exhaustifs** avec valeurs ET codes internes.
- ❌ **Pas de listes complètes** des protocoles ni des natures de zone.
  Mentionner le nombre, donner 2-3 exemples, point.
- ❌ **Pas de structure DB** ni de noms de tables.

## Règle de posture (validée 2026-05-12) — la plus importante

**Le PDF présente une méthode de cabinet de conseil. L'outil logiciel
interne Buildy n'est jamais évoqué.**

Le lecteur doit comprendre que Buildy applique une méthode rigoureuse
construite sur 100+ chantiers, pas qu'il a développé un SaaS qu'il suffirait
d'imiter. Tout vocabulaire qui révèle l'existence de l'outil est interdit
dans le contenu publié :

| ❌ Interdit | ✅ Reformuler en |
|---|---|
| « cocher la case », « champ », « formulaire », « saisie » | « consigner », « documenter », « renseigner », « identifier » |
| « le module », « l'outil », « le logiciel », « l'application » | « la méthode », « notre démarche », « le dossier d'audit » |
| « génération automatique », « calcul auto » | « élaboration », « synthèse construite à partir des constats » |
| « pré-rempli », « matrice automatique » | « grille d'attendus », « principe d'analyse » |
| « cliquer », « sélectionner » | (à éviter complètement, parler du résultat pas de l'action) |
| « stepper », « écran », « interface » | (idem) |
| « bouton Régénérer » | « la mise à jour du plan d'action » |
| « validé / invalidé par l'utilisateur » | « validé par l'auditeur » |

L'auditeur Buildy *examine, documente, qualifie, évalue, consigne, trace*.
Il n'utilise jamais d'outil dans le PDF. C'est cette posture qui justifie
le tarif d'une prestation et empêche un lecteur de se dire « si je trouve
le bon SaaS, je peux le faire moi-même ».

Quand un client achète l'audit et qu'on déploie l'outil interne pour le
réaliser, c'est un bonus — pas une promesse marketing.

À appliquer aux 9 chapitres restants.
