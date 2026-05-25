# Chapitre 11 — Les pièges à éviter après l'audit

<!-- ⚠️ Note de production interne — À SUPPRIMER avant mise en page.
Posture cabinet de conseil. Chapitre nouveau, intercalé entre le 10 et la
conclusion. Mots-clés SEO : "intégrateur GTB", "solution clé en main",
"hypervision". Pas de mention d'outil interne Buildy. -->

---

## Page 1 — L'audit n'est qu'un point de départ

Le rapport d'audit que vous tenez n'est pas une fin en soi. C'est le **cahier des charges** à partir duquel les intégrateurs GTB vont vous proposer leurs solutions, et à partir duquel vous allez engager des travaux qui se chiffrent en milliers, voire dizaines de milliers d'euros.

Sur cette dernière étape — du rapport reçu à la mise en conformité effective — quatre pièges reviennent systématiquement. Ils ne concernent pas la méthode d'audit, mais ce que le propriétaire ou le gestionnaire fait du rapport une fois livré. Les éviter, c'est gagner du temps, du budget, et garantir la pérennité de l'installation.

---

## Page 2 — Piège n°1 : ne consulter qu'un seul intégrateur GTB

Le réflexe classique consiste à transmettre le rapport à l'intégrateur en place — celui qui maintient déjà l'installation, celui que le mainteneur connaît, celui qui a fait le devis initial. Réflexe naturel, mais souvent coûteux : sans mise en concurrence, le prix proposé n'est pas comparable, les solutions alternatives n'apparaissent pas, et la marge de négociation disparaît.

**La bonne pratique est de consulter au moins trois intégrateurs GTB distincts.** Le rapport d'audit Buildy a été conçu pour rendre cette consultation simple : chaque action du plan porte un identifiant stable (BACS-001, BACS-002…), une description normée, l'article R175 source, et la sévérité associée. Les trois intégrateurs reçoivent exactement la même liste, et leurs devis peuvent être comparés **action par action**, sans ambiguïté sur ce qui est couvert ou non.

> **Méthode pratique** : transmettez le rapport tel quel, sans le résumer ni le reformuler. Demandez aux intégrateurs de chiffrer **action par action en reprenant les identifiants**. Vous obtiendrez des devis qui se comparent ligne à ligne — ce qui n'est presque jamais le cas quand chaque intégrateur structure son devis selon son propre découpage.

---

## Page 3 — Piège n°2 : confondre fourniture de matériel et solution clé en main

Un intégrateur GTB peut chiffrer ses prestations à plusieurs niveaux d'engagement. Du moins-disant au plus complet :

- **Fourniture seule** — il livre les capteurs, les automates, la passerelle, et c'est tout.
- **Fourniture et paramétrage** — il livre et configure les équipements, mais ne touche pas à ce qu'il y a autour.
- **Solution clé en main** — il livre, paramètre, **et prend en charge tout ce qui est nécessaire à la mise en service réelle** : installation électrique (tirage de câbles, raccordements, modifications de tableaux), plomberie (vannes motorisées, sondes immergées, perçages), génie civil (saignées, percements, rebouchages), reprise de la documentation existante.

**Beaucoup de devis sont chiffrés au premier ou au deuxième niveau, sans le dire explicitement.** Le propriétaire pense recevoir une solution complète ; il découvre, après signature, que l'électricien doit intervenir pour câbler les capteurs, que le plombier doit poser les sondes immergées, que les percements ne sont pas inclus. Le budget final dérape de 30 à 50 %.

**Ce qu'il faut exiger dans la consultation** : la mention explicite du niveau d'engagement, et la liste des prestations annexes (électricité, plomberie, génie civil, reprise documentaire) avec leur prise en charge — *inclus*, *à charge du propriétaire*, ou *à chiffrer séparément*. Un intégrateur sérieux acceptera de répondre. Un intégrateur qui esquive la question est un signal.

---

## Page 4 — Piège n°3 : sous-estimer l'expérience d'utilisation de la supervision

L'intégrateur livre rarement la supervision logicielle elle-même. Il intègre une solution existante — la sienne, celle d'un éditeur partenaire, ou une solution sélectionnée par le propriétaire. Cette solution logicielle est ce que l'exploitant utilisera au quotidien pendant les dix prochaines années.

**Trois questions à poser systématiquement avant de retenir une solution de supervision GTB :**

- **Est-elle utilisable par un exploitant non spécialiste ?** Demandez une démonstration sur un cas réel, pas une vidéo commerciale. Demandez à l'exploitant pressenti de manipuler la solution lui-même. Si la prise en main demande une formation lourde, la conformité R175-5 (formation de l'exploitant) sera plus coûteuse, et l'usage réel se dégradera dans le temps.
- **Est-elle accessible à distance et en mobilité ?** Une supervision uniquement accessible depuis un poste fixe en local technique est, en pratique, sous-utilisée. Vérifiez la disponibilité d'un accès web sécurisé et d'une application mobile pour les déplacements terrain.
- **Est-elle ouverte ?** Vérifiez que les données peuvent être exportées (au minimum en CSV, idéalement via une API). Une supervision propriétaire qui retient vos données vous lie à son éditeur pour toute la durée de vie de l'installation.

> **Critère parfois oublié** : la pérennité de l'éditeur. Une solution logicielle excellente mais éditée par une petite structure rachetée ou liquidée trois ans après l'installation est un risque opérationnel. Privilégier les éditeurs établis, ou ceux qui s'appuient sur des standards ouverts.

---

## Page 5 — Piège n°4 : supervision isolée plutôt qu'intégrée à une hypervision

La supervision GTB d'un bâtiment est utile pour ce bâtiment. **L'hypervision** est la couche au-dessus, qui consolide les données de tous les bâtiments d'un parc immobilier dans une vue unique : tableaux de bord agrégés, comparaisons inter-sites, alertes consolidées, reporting réglementaire centralisé.

Pour un asset manager ou un property manager qui gère plus d'un site, **disposer d'une hypervision change la nature de l'exploitation** : on ne pilote plus bâtiment par bâtiment, on pilote un parc.

**Avant de retenir une supervision GTB pour un bâtiment, posez la question de l'hypervision :**

- La supervision proposée par l'intégrateur est-elle **compatible** avec une hypervision tierce ?
- Quels protocoles d'échange supporte-t-elle pour exposer ses données à une couche supérieure ?
- Si vous gérez un parc immobilier, le choix d'une supervision incompatible avec votre hypervision crée des silos qui seront coûteux à briser plus tard.

> **Le bon réflexe pour un parc immobilier** : choisir d'abord l'hypervision qui consolidera votre parc dans la durée, puis sélectionner pour chaque bâtiment des supervisions GTB compatibles avec elle. L'ordre inverse — supervisions par bâtiment d'abord, hypervision après — multiplie par trois ou quatre le coût d'intégration final. Buildy propose Hyperveez comme couche d'hypervision pour les parcs immobiliers multi-sites — d'autres éditeurs occupent ce marché, le critère essentiel est la compatibilité avec les supervisions de chaque bâtiment.

---

## Page 6 — Ce que ce chapitre vous apporte

À l'issue de la lecture de ces pièges, vous savez :

- Pourquoi consulter trois intégrateurs GTB minimum, et comment leurs devis se comparent action par action grâce aux identifiants normalisés du plan d'action.
- Comment distinguer une solution clé en main d'une fourniture partielle, et quelles prestations annexes (électricité, plomberie, génie civil) doivent être explicitement chiffrées.
- Quels critères appliquer à la solution logicielle de supervision : simplicité d'usage, accès distant, ouverture des données, pérennité de l'éditeur.
- Pourquoi penser hypervision dès le départ quand vous gérez plus d'un bâtiment.

C'est cette dernière étape — du rapport reçu à la mise en service effective — qui détermine la qualité réelle de la mise en conformité. Un bon rapport mal exploité produit une installation moyenne. Un rapport rigoureux confronté à trois intégrateurs sérieux, comparés sur la même grille, produit une installation à la hauteur du budget engagé.

---

*[Pied de page] Chapitre 11 / 11 — Pièges à éviter après l'audit*
