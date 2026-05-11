# Audit SEO complet de la FAQ Buildy — mai 2026

> **Périmètre** : 41 articles publiés sur help.buildy.fr (36 publiés + 5 brouillons), répartis sur 4 catégories Crisp.
> **Mode d'analyse** : expert SEO + connaissance GTB / décret BACS. Référentiel : `CLAUDE.md` § « Stratégie SEO (audit concurrentiel mai 2026) » + whitelist `faq_settings.seo_keywords_json` (41 mots-clés actifs).
> **Date** : 11 mai 2026, après cleanup des prompts IA (v0.1.36).

---

## Executive summary — les 10 actions prioritaires

| # | Action | Impact SEO | Effort | Priorité |
|---|---|---|---|---|
| 1 | **Supprimer ou compléter les 5 brouillons** ([2], [9], [10], [11], [12]) — soit ils dupliquent un article existant (à fusionner), soit ils sont des placeholders vides. Ils tirent le score moyen vers le bas et publiables tels quels ils nuiraient. | 🔴 Élevé | 1 h | **P0** |
| 2 | **Corriger le titre [45]** « Comment connecter Buildy à un opérateur de flexibilité ? » alors que le contenu parle de **Buildy Connect** (API REST GMAO/ERP/reporting). Soit le titre est faux, soit le contenu est faux — incohérence flagrante côté SEO et UX. | 🔴 Élevé | 5 min | **P0** |
| 3 | **Créer 3 articles « gaps stratégiques » NIVEAU 1-2** : `intégrateur GTB`, `BAT-TH-116 / prime CEE GTB`, `Buildy Edge` (passerelle terrain). Ces mots-clés ont du volume Google et 0 article aujourd'hui — opportunité maximale. | 🔴 Élevé | 3 × 30 min IA + review | **P0** |
| 4 | **Tagger 11 articles avec `bacs_articles`** qui parlent du décret R175 mais ne sont pas tagués. Le maillage interne automatique vers l'article [14] (texte officiel) ne se déclenche pas → liens internes perdus + signal SEO fort dilué. | 🟠 Moyen | 30 min | **P1** |
| 5 | **Réorganiser les catégories Crisp** : créer **"Décret BACS & conformité"** (regrouper [1, 5, 14, 16, 17, 18]), garder "Commercial" pour CGV/tarification, garder "Fonctionnalités transverses" mais retirer les articles "décret". Améliore la lisibilité help.buildy.fr et la cohérence des breadcrumbs. | 🟠 Moyen | 20 min | **P1** |
| 6 | **Corriger les 5 articles sans description** (4 brouillons + une fois publiés). Une meta-description absente = score SEO ratée + snippet Google par défaut (peu engageant). Couvert par la suppression/fusion du point 1 + une passe baguette description. | 🟠 Moyen | 15 min | **P1** |
| 7 | **Article [23]** : ajouter le point d'interrogation final (« Comment Buildy surveille vos communications GTB 24h/24 ? »). Trivial mais le score actuel du check `title-question-form` rate. | 🟢 Faible | 1 min | **P2** |
| 8 | **Article [7] CGV** : décoder les entités HTML (`&#39;` → `'`), nettoyer le formatage. Le contenu importé d'un PDF légal est illisible et tire le score SEO à 70. | 🟠 Moyen | 30 min | **P2** |
| 9 | **Densifier le maillage interne** sur les articles peu connectés ([22, 25, 33, 41, 44]) : 1 lien sortant seulement. Cibler chacun avec 2-3 liens vers articles cousins pour densifier le mesh SEO. | 🟢 Faible | 30 min | **P2** |
| 10 | **Créer 4 articles persona-driven** (long-tail SEO) : "Quel logiciel GTB pour un asset manager ?", "Gestion technique multi-sites pour foncière", "Property manager : à quoi sert une supervision GTB ?", "GTB bâtiment tertiaire pour gestionnaire de parc immobilier". Capte les recherches personae qui ne sont aujourd'hui que des `<strong>` dans des articles techniques. | 🟠 Moyen | 4 × 30 min IA + review | **P2** |

**Score moyen actuel** : 80/100 (publiés seulement, brouillons exclus).
**Score moyen cible post-actions** : 90/100, plus une augmentation du volume organique attendu sur 6-12 mois grâce aux articles "gaps".

---

## Section A — Diagnostic par article

### Articles à supprimer ou fusionner (5 brouillons)

#### [2] Comment créer une programmation horaire ?
- Status : draft — content `Blablabla` (1 mot).
- Verdict : **DOUBLON** avec [30] « Comment programmer les horaires de vos équipements dans Hyperveez ? » qui couvre déjà parfaitement le sujet (784 mots, score 95).
- **Action** : Supprimer définitivement. Si tu veux capter la requête courte "créer programmation horaire", garde [30] et ajoute "programmation horaire" en `<strong>` dans son 1er paragraphe + en URL slug.

#### [9] Comment acquitter une anomalie ?
- Status : draft — content vide.
- Verdict : **DOUBLON** avec [21] « Comment Buildy détecte les alarmes GTB ? » (couvre l'acquittement). [28] « Centraliser les alarmes parc multi-sites » couvre aussi le sujet (3 actions : acquitter / clôturer / annoter).
- **Action** : Supprimer. Renforcer le SEO de [21] et [28] sur "acquitter une alarme/anomalie".

#### [10] Comment configurer les seuils de dérive de consommation ?
- Status : draft — content vide.
- Verdict : **DOUBLON** avec [35] « Comment Buildy détecte-t-il les dérives de consommation ? » (915 mots, score 90, couvre la calibration des seuils).
- **Action** : Supprimer. Si la requête "configurer seuils dérive" mérite capture, ajouter un H3 dédié dans [35].

#### [11] Comment passer du mode climatisation à chauffage et inversement ?
- Status : draft — 152 mots, contenu très procédural ("Eteindre toutes les UI Passer le fonctionnement…").
- Verdict : **MISMATCH PERSONA**. C'est un guide opérationnel ultra-technique destiné à un exploitant terrain, pas à la persona inbound (asset/property manager). De plus, il n'utilise aucun mot-clé Buildy stratégique.
- **Action** : Supprimer OU pivot complet vers un article "Comment basculer son parc immobilier du mode chauffage en climatisation au printemps ?" reformulé pour property/asset manager (1 mois avant la saison, vérifications, alerte, lien vers [30] programmation horaire). Recommandation : **supprimer** (faible volume de recherche, persona mismatch).

#### [12] Comment réinitialiser mon mot de passe depuis Gojee ?
- Status : draft — content vide.
- Verdict : **DOUBLON PARTIEL** avec [6] « Comment réinitialiser mon mot de passe oublié sur Hyperveez ? » (258 mots, score 99). La procédure côté Gojee suit probablement le même flow Web (lien "Mot de passe oublié" → e-mail).
- **Action** : Soit supprimer et ajouter une mention dans [6] ("La même procédure s'applique depuis Gojee : lien « Mot de passe oublié » sur l'écran de connexion."). Soit générer un article court dédié si tu veux capter "mot de passe Gojee" en search distinct.

---

### Articles à retoucher (réécriture ciblée)

#### [45] Comment connecter Buildy à un opérateur de flexibilité ?
- Score SEO : 100 (alors que le titre ne matche pas le contenu !)
- **Issue majeure** : le titre dit « opérateur de flexibilité » (effacement des consommations, gestion réseau électrique), le **contenu parle de Buildy Connect** (API REST pour GMAO/ERP/reporting). Le H1 sur help.buildy.fr ne décrit pas ce que l'utilisateur trouve dans l'article.
- **Action** : choisir l'un des 2 scénarios :
  - **Scénario A** (si l'article doit parler de Buildy Connect — recommandé) :
    - Titre : **« Comment connecter Buildy à votre GMAO ou ERP ? »** (54 chars, en question, GMAO/ERP concrets, Buildy en nom propre)
    - Description : "Connectez Buildy à votre GMAO, ERP ou outil de reporting grâce à Buildy Connect, l'API REST disponible au niveau Premium." (~130 chars)
  - **Scénario B** (si tu veux un article dédié "opérateur de flexibilité") :
    - Renommer cet article en "Comment connecter Buildy à votre GMAO ou ERP ?" + créer un NOUVEL article « Buildy pilote-t-il l'effacement énergétique avec votre opérateur de flexibilité ? »

#### [23] Comment Buildy surveille vos communications GTB 24h/24
- Score SEO : 90 — titre proche du parfait mais **manque le point d'interrogation final**.
- **Action** : ajouter le `?` → « Comment Buildy surveille vos communications GTB 24h/24 ? » (54 chars, OK).

#### [7] CGV Buildy : conditions générales de vente et services
- Score SEO : 70 — contenu importé d'un PDF légal avec **entités HTML cassées** (`&#39;` partout au lieu de `'`).
- **Action** : décoder les entités HTML dans le content_html. Une passe regex global `&#39;` → `'`, `&quot;` → `"`, `&amp;` → `&` règle le sujet. À faire avant le prochain push Crisp.

#### [5] Décret BACS : votre bâtiment tertiaire est-il concerné ?
- Description : 119 chars (juste sous le minimum 120 du scoring).
- **Action** : ré-écrire la description pour atteindre 130-155 chars. Proposition : « Vérifiez si votre bâtiment tertiaire est concerné par le décret BACS : seuils, échéances 2025-2027 et obligations de supervision GTB. » (138 chars).

#### [44] À quoi sert l'option Sérénité de Buildy ?
- Score SEO : 85 — 1 lien interne sortant seulement.
- **Action** : ajouter 2-3 liens internes vers les articles couvrant les fonctionnalités déléguées : [23] communications 24h/24, [25] mises à jour, [26] maintenance, [42] support.

#### [33] À quoi servent les plans interactifs 2D/3D dans Hyperveez ?
- Score SEO : 90 — 1 lien interne sortant seulement.
- **Action** : ajouter 2-3 liens vers [27] vue cartographique parc, [29] piloter à distance, [37] QAI temps réel.

#### [22], [25], [41] — articles à 1 lien interne sortant
- **Action** : passe rapide pour ajouter 2 liens chacun vers articles cousins.

---

### Articles à conserver tels quels (35 articles)

Tous les autres articles publiés ont un score SEO ≥ 85 et une structure SEO solide (H2 descriptifs, strongs sur termes métier, callouts, description renseignée, FAQs subsidiaires fréquentes). Pas de retouche prioritaire.

**Articles particulièrement réussis** (référence pour la suite) : [1], [14], [17], [18], [37], [38], [41], [42], [45 si retitré].

---

## Section B — Articles à créer (gaps stratégiques)

Mots-clés prioritaires de la stratégie SEO **non couverts** par un article dédié aujourd'hui. Ordonnés par impact (volume × conversion × faible compétition).

| # | Sujet & angle | Titre proposé | Niveau | Persona ciblée | H2 squelette | Impact |
|---|---|---|---|---|---|---|
| 1 | **Intégrateur GTB** — qualité d'intent maximale (appels d'offres BET) | « Comment choisir son intégrateur GTB pour un parc immobilier ? » | 1 | asset manager, foncière | (a) Le rôle de l'intégrateur GTB ; (b) Buildy + intégrateur : qui fait quoi ; (c) Critères de choix ; (d) Buildy fonctionne avec votre intégrateur préféré | 🔴 Élevé |
| 2 | **BAT-TH-116 / prime CEE GTB** — point d'entrée funnel financement | « Comment obtenir la prime CEE BAT-TH-116 pour votre GTB ? » | 2 | property manager, MOA, MOE | (a) Qu'est-ce que la BAT-TH-116 ; (b) Conditions d'éligibilité ; (c) Comment Buildy accompagne le dossier ; (d) Cumul avec le décret BACS | 🔴 Élevé |
| 3 | **Buildy Edge** (passerelle terrain) — produit-clé non documenté | « À quoi sert Buildy Edge, la passerelle GTB terrain ? » | — | exploitant, property manager | (a) Le rôle de Buildy Edge ; (b) Protocoles standards supportés ; (c) Installation et maintenance ; (d) Lien avec Hyperveez et Gojee | 🟠 Moyen |
| 4 | **Logiciel GTB** — mot-clé NIVEAU 1 jamais titré explicitement | « Quel logiciel GTB pour superviser un parc immobilier multi-sites ? » | 1 | asset manager, property manager | (a) Les critères d'un bon logiciel GTB ; (b) Centralisation multi-sites ; (c) Conformité réglementaire intégrée ; (d) Pourquoi Buildy | 🔴 Élevé |
| 5 | **Mise en conformité** — funnel | « Comment mettre son parc en conformité avec le décret BACS ? » | 2 | property manager, asset manager | (a) Les obligations légales ; (b) L'audit BACS comme point de départ ; (c) Calendrier de mise en conformité 2025-2027 ; (d) Le rôle de Buildy | 🟠 Moyen |
| 6 | **Asset manager** — persona dédiée | « Asset manager : à quoi sert une supervision GTB pour votre portefeuille ? » | — | asset manager | (a) Le quotidien d'un asset manager face à la GTB ; (b) Vue consolidée multi-sites ; (c) Reporting ESG et BREEAM ; (d) ROI et économies d'énergie | 🟠 Moyen |
| 7 | **Property manager** — persona dédiée | « Property manager : comment piloter la GTB d'un bâtiment tertiaire ? » | — | property manager | (a) Les responsabilités du property manager côté GTB ; (b) Mobilité avec Gojee ; (c) Alertes et astreinte ; (d) Conformité BACS au quotidien | 🟠 Moyen |
| 8 | **Foncière** — persona haute valeur | « Comment une foncière gère-t-elle la supervision GTB de son parc immobilier ? » | — | foncière, asset manager | (a) Les enjeux GTB pour une foncière ; (b) Multi-sites centralisé ; (c) Reporting financier et énergétique ; (d) Conformité réglementaire à l'échelle | 🟢 Faible |
| 9 | **Décret tertiaire** — différenciation décret BACS vs DEET | « Décret tertiaire vs décret BACS : quelles différences pour votre bâtiment ? » | 3 | property manager, MOA | (a) Le décret tertiaire (DEET) en bref ; (b) Le décret BACS en bref ; (c) Comment les deux se cumulent ; (d) Buildy couvre les deux | 🟠 Moyen |
| 10 | **GTB bâtiment tertiaire** — long-tail | « Pourquoi installer une GTB dans un bâtiment tertiaire en 2026 ? » | 3 | MOA, property manager | (a) Le cadre réglementaire 2025-2027 ; (b) Les économies attendues ; (c) Les fonctions incontournables ; (d) Choisir Buildy | 🟢 Faible |
| 11 | **Économies d'énergie** — long-tail | « Combien d'économies d'énergie attendre d'une GTB tertiaire ? » | — | asset manager, MOA | (a) Les leviers d'économies ; (b) Cas d'usage réels ; (c) Le rôle de la détection des dérives ; (d) Méthodologie de mesure | 🟢 Faible |
| 12 | **Smart building** — top of funnel (notoriété) | « Smart building tertiaire : par où commencer ? » | 3 | MOA, MOE | (a) Le concept smart building ; (b) Les briques essentielles ; (c) GTB comme socle ; (d) Pourquoi Buildy | 🟢 Faible |

**Recommandation de séquence** : démarrer par les 3 premiers (P0 dans l'executive summary) en utilisant le bouton « Générer depuis une question » avec des instructions précises (anti-hallucination + persona) puis review humaine.

---

## Section C — Architecture & catégories

### État actuel

4 catégories Crisp :
- **App Mobile Gojee** (5 articles) — cohérente, focus mobilité.
- **Commercial** (7 articles) — **mélange hétéroclite** : audit BACS, décret BACS, BREEAM, CGV, ISO 52120.
- **Fonctionnalités transverses** (13 articles) — fonctions IT/produit non-Hyperveez (alarmes, comm, support, MAJ, Connect, Sérénité, gestion utilisateurs).
- **Hyperveez** (16 articles) — interface web, focus produit.

### Recommandation : 5 catégories

Créer une nouvelle catégorie dédiée :

- **🆕 Décret BACS & conformité** (6 articles) — déplacer :
  - [1] Audit BACS : Buildy peut-il auditer vos bâtiments tertiaires ?
  - [5] Décret BACS : votre bâtiment tertiaire est-il concerné ?
  - [14] Décret BACS : texte officiel des obligations
  - [16] Décret BACS : la certification ISO 52120 est-elle obligatoire ?
  - [17] Supervision GTB compatible BREEAM : comment y répondre ?
  - [18] Comment se déroule l'audit BACS de Buildy en 10 étapes ?
  - + nouveaux articles futurs : BAT-TH-116, mise en conformité, décret tertiaire vs BACS.

- **Commercial** (1 article restant + futurs) — uniquement CGV/tarification/options de service. À étoffer plus tard avec "Combien coûte un logiciel GTB ?", "Tarification Buildy", etc.

- **Fonctionnalités transverses** (13 articles, inchangé)

- **Hyperveez** (16 articles, inchangé)

- **App Mobile Gojee** (5 articles, inchangé)

### Bénéfice SEO

- Breadcrumb plus net sur help.buildy.fr (« Catégorie : Décret BACS » > article, vs « Catégorie : Commercial » > article décret — incohérent aujourd'hui).
- Page catégorie dédiée → URL `/category/decret-bacs-et-conformite/` indexable Google, capture du mot-clé « décret BACS » au niveau catégorie.
- Maillage interne renforcé entre articles d'une même catégorie via le sidebar « Articles en rapport » de Crisp.

---

## Section D — Maillage interne & tagging BACS

### Tagging `bacs_articles` à compléter (11 articles)

Articles qui parlent du décret R175-* dans leur contenu mais n'ont pas le champ `bacs_articles` rempli → le maillage automatique vers [14] « Décret BACS : texte officiel » ne se déclenche pas. Cibler :

| Article | Tag suggéré | Justification |
|---|---|---|
| [22] Synthèse e-mail des alarmes GTB | `R175-3 1°` | Suivi continu des défauts |
| [23] Surveillance communications 24h/24 | `R175-3 1°` | Suivi continu de la disponibilité GTB |
| [24] Traçabilité actions utilisateurs | `R175-4` | Conservation des journaux |
| [29] Piloter à distance depuis Hyperveez | `R175-3 2°` | Pilotage automatisé |
| [30] Programmation horaire Hyperveez | `R175-3 2°` | Programmation des installations |
| [31] Visualiser équipements temps réel | `R175-3 1°` | Suivi continu |
| [32] Visualiser/exporter données GTB | `R175-3 1°` | Conservation et accès aux données |
| [34] Tableaux de bord consommations | `R175-3 1°` | Suivi des consommations |
| [36] Supervision par domaine CVC/QAI | `R175-3` | Suivi multi-systèmes techniques |
| [37] QAI temps réel | `R175-3 1°` | Suivi qualité air intérieur |
| [39] Alertes GTB sur mobile | `R175-3 2°` | Détection et information exploitant |
| [45] Buildy Connect (après retitre) | `R175-3 alinéa final` | Accessibilité données au propriétaire |

Une fois taggués, à la prochaine régénération (ou push manuel), l'IA insérera automatiquement le lien interne vers [14] depuis ces articles.

### Liens internes à ajouter (articles peu connectés)

Articles publiés avec 1 lien interne sortant seulement → renforcer le maillage :

| Source | Liens à ajouter vers |
|---|---|
| [22] e-mails d'alarmes | [21] détection alarmes, [28] centralisation multi-sites, [39] alertes mobile |
| [25] mises à jour | [26] maintenance, [42] support, [23] communications 24h/24 |
| [33] plans 2D/3D | [27] vue parc, [29] piloter, [37] QAI |
| [41] comptes utilisateurs | [42] support, [24] traçabilité actions |
| [44] option Sérénité | [23] communications 24h/24, [25] mises à jour, [26] maintenance, [42] support |
| [45] Buildy Connect (après retitre) | [1] audit BACS, [14] texte officiel décret, [37] QAI temps réel |

---

## Section E — Recommandations transverses

### Sur la production de contenu

- **Boucle SEO IA déjà excellente** depuis le cleanup v0.1.36. Les nouveaux articles partent à ≥ 80/100 directement avec titre en question + description + mots-clés adaptés.
- **Le scoring SEO automatique reflète bien la qualité réelle** — articles à 90+ sont objectivement bons, articles < 70 ont des vrais problèmes (placeholders ou CGV avec entités HTML cassées).
- **Le pattern "À quoi sert X" / "Comment Buildy Y" fonctionne** — il génère des titres en question naturels qui matchent l'intent search.

### Sur la stratégie éditoriale

- **Le contenu publié défend efficacement le positionnement Buildy** (asset/property manager, multi-sites, conformité). Pas de dérive vers le jargon intégrateur GTB.
- **Le décret BACS est bien couvert** sur l'angle "qui est concerné" + "audit" + "texte officiel". Reste à couvrir la **mise en conformité concrète** (calendrier 2025-2027, étapes, financement BAT-TH-116).
- **Manque les angles "long-tail persona"** (asset manager / property manager / foncière comme sujet principal). Aujourd'hui ces termes sont diffusés en `<strong>` dans des articles techniques — bon pour la couverture lexicale mais pas pour capturer une recherche dédiée.

### Sur l'architecture Crisp

- **5 catégories est un sweet spot** (Crisp affiche bien jusqu'à 6-7 sur la home). Ajouter "Décret BACS & conformité" est la priorité ; "Intégrations / API" pourrait venir plus tard quand Buildy Connect aura 2-3 articles cousins.
- **Les descriptions des catégories Crisp** (champ `categories.description`) sont déjà bien remplies — bon signal SEO Google sur les pages catégorie.

---

## Annexe — Tableau de bord 41 articles

| ID | Titre | Cat. | Statut | Score SEO | Verdict | Action |
|---|---|---|---|---|---|---|
| 1 | Audit BACS : Buildy peut-il auditer vos bâtiments tertiaires ? | Commercial | ✓ | 100 | 🟢 Référence | Déplacer cat. Décret BACS |
| 2 | Comment créer une programmation horaire ? | Hyperveez | ✗ | 40 | 🔴 Doublon | Supprimer (cf. [30]) |
| 3 | Gojee ne répond plus — comment vider le cache sur Android ? | Gojee | ✓ | 97 | 🟢 OK |  |
| 5 | Décret BACS : votre bâtiment tertiaire est-il concerné ? | Commercial | ✓ | 90 | 🟠 Desc courte | Étoffer desc + cat. Décret BACS |
| 6 | Comment réinitialiser mon mot de passe oublié sur Hyperveez ? | Hyperveez | ✓ | 99 | 🟢 OK | Mention Gojee à ajouter |
| 7 | CGV Buildy : conditions générales de vente et services | Commercial | ✓ | 70 | 🟠 Entités HTML | Decoder `&#39;` → `'` |
| 9 | Comment acquitter une anomalie ? | Hyperveez | ✗ | 30 | 🔴 Doublon | Supprimer (cf. [21], [28]) |
| 10 | Comment configurer les seuils de dérive de consommation ? | Hyperveez | ✗ | 40 | 🔴 Doublon | Supprimer (cf. [35]) |
| 11 | Comment passer du mode climatisation à chauffage et inversement ? | Hyperveez | ✗ | 61 | 🔴 Persona mismatch | Supprimer ou pivot |
| 12 | Comment réinitialiser mon mot de passe depuis Gojee ? | Gojee | ✗ | 40 | 🔴 Doublon partiel | Supprimer (cf. [6]) ou compléter |
| 14 | Décret BACS : texte officiel des obligations | Commercial | ✓ | 100 | 🟢 Référence | Déplacer cat. Décret BACS |
| 16 | Décret BACS : la certification ISO 52120 est-elle obligatoire ? | Commercial | ✓ | 95 | 🟢 OK | Déplacer cat. Décret BACS |
| 17 | Supervision GTB compatible BREEAM : comment y répondre ? | Commercial | ✓ | 100 | 🟢 Référence | Déplacer cat. Décret BACS |
| 18 | Comment se déroule l'audit BACS de Buildy en 10 étapes ? | Commercial | ✓ | 95 | 🟢 OK | Déplacer cat. Décret BACS |
| 19 | Comment Buildy supervise vos équipements en temps réel ? | Transverses | ✓ | 95 | 🟢 OK |  |
| 20 | Combien de temps Buildy conserve-t-il l'historique GTB ? | Transverses | ✓ | 90 | 🟢 OK |  |
| 21 | Comment Buildy détecte les alarmes GTB ? | Transverses | ✓ | 90 | 🟢 OK |  |
| 22 | Comment Buildy regroupe et envoie les e-mails d'alarmes GTB ? | Transverses | ✓ | 90 | 🟠 Maillage faible | Tag R175-3 + 3 liens |
| 23 | Comment Buildy surveille vos communications GTB 24h/24 | Transverses | ✓ | 90 | 🟠 Titre sans ? | Ajouter `?` + tag R175 |
| 24 | Comment Buildy trace-t-il chaque action des utilisateurs ? | Transverses | ✓ | 90 | 🟢 OK | Tag R175-4 |
| 25 | Comment Buildy se met-il à jour sans intervention de votre part ? | Transverses | ✓ | 90 | 🟠 Maillage faible | 3 liens à ajouter |
| 26 | Que couvre la maintenance logicielle Buildy ? | Transverses | ✓ | 90 | 🟢 OK |  |
| 27 | Comment voir l'état de tout votre parc immobilier sur Hyperveez ? | Hyperveez | ✓ | 90 | 🟢 OK |  |
| 28 | Comment centraliser les alarmes GTB de son parc multi-sites ? | Hyperveez | ✓ | 85 | 🟢 OK |  |
| 29 | Comment piloter mes équipements à distance depuis Hyperveez ? | Hyperveez | ✓ | 95 | 🟢 OK | Tag R175-3 2° |
| 30 | Comment programmer les horaires de vos équipements dans Hyperveez ? | Hyperveez | ✓ | 95 | 🟢 Référence | Tag R175-3 2° |
| 31 | Comment visualiser mes équipements en temps réel sur Hyperveez ? | Hyperveez | ✓ | 90 | 🟢 OK | Tag R175-3 1° |
| 32 | Comment visualiser et exporter ses données GTB dans Hyperveez ? | Hyperveez | ✓ | 85 | 🟢 OK | Tag R175-3 1° |
| 33 | À quoi servent les plans interactifs 2D/3D dans Hyperveez ? | Hyperveez | ✓ | 90 | 🟠 Maillage faible | 3 liens à ajouter |
| 34 | Comment suivre mes consommations énergétiques sur des tableaux de bords ? | Hyperveez | ✓ | 80 | 🟢 OK | Tag R175-3 |
| 35 | Comment Buildy détecte-t-il les dérives de consommation ? | Hyperveez | ✓ | 90 | 🟢 Référence |  |
| 36 | Comment Hyperveez organise-t-il la supervision par domaine CVC, QAI ? | Hyperveez | ✓ | 85 | 🟢 OK | Tag R175-3 |
| 37 | Comment Hyperveez supervise la qualité de l'air en temps réel ? | Hyperveez | ✓ | 100 | 🟢 Référence | Tag R175-3 1° |
| 38 | À quoi sert Gojee, l'app mobile GTB de Buildy ? | Gojee | ✓ | 100 | 🟢 Référence |  |
| 39 | Comment suivre les alertes GTB en temps réel sur mobile ? | Gojee | ✓ | 90 | 🟢 OK | Tag R175-3 2° |
| 40 | Comment suivre ses consommations d'énergie sur mon smartphone ? | Gojee | ✓ | 90 | 🟢 OK |  |
| 41 | Comment gérer les comptes utilisateurs sur Buildy ? | Transverses | ✓ | 100 | 🟠 Maillage faible | 2 liens à ajouter |
| 42 | Comment contacter le support Buildy (chat ou e-mail) ? | Transverses | ✓ | 100 | 🟢 Référence |  |
| 43 | Comment gérer la connectivité à Internet de votre GTB sans risque ? | Transverses | ✓ | 85 | 🟢 OK |  |
| 44 | À quoi sert l'option Sérénité de Buildy ? | Transverses | ✓ | 85 | 🟠 Maillage faible | 4 liens à ajouter |
| 45 | Comment connecter Buildy à un opérateur de flexibilité ? | Transverses | ✓ | 100 | 🔴 Titre/contenu mismatch | Retitrer en "GMAO/ERP" + tag R175-3 |

---

## Suite : plan d'action

Une fois ce rapport validé, je peux enchaîner sur ces sous-projets (à séquencer selon priorité Kévin) :

1. **P0 — Cleanup brouillons** : supprimer 4 articles, fusionner 1 (15 min).
2. **P0 — Fix article [45]** : retitre + redescription + push Crisp (15 min).
3. **P0 — Création 3 articles gaps NIVEAU 1-2** (intégrateur GTB, BAT-TH-116, Buildy Edge) via baguette IA + instructions précises + review (3 × 30 min).
4. **P1 — Tagging bacs_articles** : 11 articles à tagger (script SSH 30 min).
5. **P1 — Réorganisation catégories** : créer "Décret BACS & conformité", déplacer 6 articles (20 min).
6. **P2 — Retouches diverses** : titre [23], décodage HTML [7], maillage interne [22, 25, 33, 41, 44] (1 h).
7. **P2 — Création 4 articles persona** (asset manager, property manager, foncière, décret tertiaire) (4 × 30 min).
