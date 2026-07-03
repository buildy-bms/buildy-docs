# Audit de conformité réglementaire BACS — moteur Buildy Docs (2026-07-03)

> Rapport d'audit multi-agents avec vérification adversariale. 145 findings confirmés, 16 réfutés, 169 points conformes. Tests sur audit prod #56 (CLR Saint Herblain) + fixture Atlas Sud. Aucun fichier de code modifié.

## Rapport d'audit de conformité réglementaire — moteur d'audit BACS de Buildy Docs

Périmètre : chaîne saisie → calcul → restitution (PDF / UI / dump Claude) → MCP, confrontée au décret R175-1 à R175-6 (n°2023-259), à la FAQ ministérielle, au guide d'application V2 et à PROFEEL v1.1. Base : 145 findings confirmés (dont doublons de racine), 16 réfutés, 169 points conformes vérifiés, avec tests numériques sur l'audit prod #56 (Rexel/CLR Saint Herblain) et la fixture Atlas Sud.

---

## 1. Tableau de conformité article par article

### R175-1 — Définitions

| Exigence normative | Implémentation | Verdict |
|---|---|---|
| 4° Familles de systèmes techniques (chauffage, clim, ventilation, ECS, éclairage intégré, production d'électricité sur site) | `_shared.js:5`, `seeds/bacs-requirements.js:22-54` | **Partiel** — catégories exhaustives, mais production d'électricité non pilotable côté GTB (BmsSection.vue:129, colonnes inexistantes) ; « éclairage intégré » étendu à tort à l'éclairage extérieur hors bâti (`_export-data.js:291`) ; label « Production photovoltaïque » exclut cogénération/éolien (`_labels.js:18`) |
| 6° Zone fonctionnelle (usages homogènes, FAQ-25/26) | `zones.js:22`, `lib/bacs-functional-zones.js:36` | **OK** |
| 7° Interopérable = capacité à communiquer/interagir | `lib/bacs-audit-action-generator.js:299-342` (générateur, correct) | **Trou** — le verdict PDF par système lit `meets_r175_3_p3` sur une colonne device inexistante (`_export-data.js:323`) ; « Conforme » structurellement inatteignable en prod |
| 8°a-d Générateur de chaleur (combustion, effet Joule, thermodynamique, chaleur fatale) | `lib/seeder.js:1005-1014`, `bacs-audit-power.js:82-90` | **Partiel** — bois/biomasse (combustion, 8°a) exclus à tort du cumul (`power.js:80`) |

### R175-2 — Assujettissement

| Exigence normative | Implémentation | Verdict |
|---|---|---|
| I — Seuil « supérieure à 70 kW » (strict), chaud et froid non sommés | `bacs-audit-power.js:200` (max chaud/froid, correct) | **Partiel** — seuils traités en larges (`>=` au lieu de `>`, `power.js:318,324`) ; CTA à batterie électrique exclue (FAQ-09, `power.js:89`) |
| I al.3 — Réseau urbain : puissance = station d'échange | `bacs-audit-power.js:72-78`, `lib/bacs-district-heating.js` | **Partiel** — correct au PDF, mais card 04 UI / MCP sans join du slug → sous-station inférée `out_of_scope` (`bacs-audit.js:1759`) |
| II 1° >290 kW, PC > 21/07/2021 → immédiat | `computeBacsApplicabilityFromPower` `power.js:316` / `afs.js:75` | **Trou** — date pivot 08/04/2024 appliquée au >290 (au lieu du 21/07/2021), cas 1° jamais rendu |
| II 2° >290 kW existant → 01/01/2025 | idem | **Partiel** — atteint mais label `subject_immediate` juridiquement inversé (`_labels.js:101`) |
| II 3° >70 kW, PC > 08/04/2024 → immédiat + TOUS systèmes reliés | idem | **Trou** — bâtiment neuf 70-290 kW toujours classé 2030 |
| II 4° >70 kW existant → renouvellement CVC, au plus tard 01/01/2030 | `power.js:330` | **Trou** — déclencheur renouvellement non modélisé ; échéance toujours 2030 |
| Périmètre de raccordement différencié (1°/3° tous systèmes ; 2° >290 + TRI<10 ans) | `_compliance-summary.js:199` | **Trou** — obligation de raccordement uniforme, sous-cas non porté |
| Clause de dispense TRI ≥ 10 ans | saisie `afs.js:418`, existence signalée UI/PDF | **Trou** — `bacs_roi_study_status` restitué nulle part |
| Cumul toutes énergies même usage (FAQ-12), secours exclus (FAQ-08), 5 % (FAQ-16) | `power.js:57,169-204` ; `_export-data.js:307` | **Partiel** — corps correct ; 5 % sans garde d'agrégation FAQ-16 ; mixte/prorata FAQ-06 et extension FAQ-29 non modélisés |
| Report 2027→2030 (JO 26/12/2025) | `power.js:320,330`, `_labels.js:103`, `bacs-articles.js:63` | **Partiel** côté Docs OK, mais `bacs_knowledge` (DB opposable) et explainers MCP encore à 2027 |

### R175-3 — Fonctions du BACS

| Exigence normative | Implémentation | Verdict |
|---|---|---|
| 1° Suivent, enregistrent, analysent en continu, pas horaire, par zone, **et ajustent les systèmes en conséquence** ; conservation 5 ans | `action-generator.js:477,529` ; `_meter-coverage.js` | **Trou** — pas horaire non modélisé ; clause « ajustent » (commande automatique, FAQ-13) jamais évaluée → GTB de pure supervision jugée conforme ; `present_actual NOT NULL DEFAULT 0` fabrique de fausses absences |
| 2° Valeurs de référence + détection + information de l'exploitant | `BmsSection.vue:640`, `action-generator.js:486` | **Trou** — 3 sous-exigences collapsées en un booléen ; `bacs-energy-reference.js` sans effet sur le verdict |
| 3° Interopérabilité | `action-generator.js:299-342` (correct) | **Partiel** — générateur correct ; verdict PDF par système et compteurs MCP/dump lisent colonne morte ; 3 définitions divergentes de l'interopérabilité |
| 4° Arrêt manuel + gestion autonome d'« un ou plusieurs » systèmes | `action-generator.js:351-352` (niveau système, correct) | **Partiel** — générateur correct ; verdict PDF par système évalue tous les devices (émetteurs passifs inclus) ; « arrêt manuel » lu comme interrupteur local et non arrêt via GTB (GUIDE-1.2 E) |
| Dernier alinéa — accès propriétaire, mise à disposition gestionnaire, transmission exploitants | `action-generator.js:507-548` (correct) | **Partiel** — actions correctes, mais l'evidence dashboard lit `meets_r175_3_p2` (détection) sous le libellé « mise à disposition » ; `gestionnaire_exploitant_access='no'` ne génère rien |

### R175-4 — Vérifications périodiques

| Exigence normative | Implémentation | Verdict |
|---|---|---|
| Consignes écrites (périodicité, points à contrôler, réparation/remplacement) ; prestataire/personnel compétent | `action-generator.js:497-505` | **Partiel** — action générée sur absence explicite ; sous-contenus (points, réparation, compétence) non saisissables ; verdict « Conforme » possible sans réponse (Communay résiduel) ; rendus truthy PDF |
| Al.3 (2023) — exemption R224 des systèmes reliés | texte en annexe A `bacs-articles.js:90` | **Trou** — avantage/obligation invisible hors annexe ; tooltip incomplet |

### R175-5 — Formation de l'exploitant

| Exigence normative | Implémentation | Verdict |
|---|---|---|
| Exploitant formé au fonctionnement, notamment au paramétrage | `action-generator.js:561-568` | **Partiel** — action générée sur « Non », mais skip `isBuildySolution` → conforme malgré `operator_trained=0` ; `null` → axe conforme ; sujets/date/organisme jamais scorés |

### R175-5-1 — Inspection périodique

| Exigence normative | Implémentation | Verdict |
|---|---|---|
| Inspection à l'initiative du propriétaire, tous les 5 ans, 1re ≤ 01/01/2025 | `action-generator.js:649-668` | **Trou** — `inspection_not_applicable=1` → « Conforme » (audit #56) ; périodicité 5 ans / échéance 2025 absentes du plan d'action ; retard non signalé |
| 4 sous-obligations 1°-4° ; rapport sous 1 mois ; conservation 10 ans | `inspections.js:13`, `database.js:2186` | **Trou** — seuls date/inspecteur/rapport/anomalies/reco saisis ; délai 1 mois non tracé ; evidence toujours « Aucune déclarée » (objet vs array) |
| Nature de l'inspecteur : « la personne ayant effectué l'inspection » (tiers recommandé, non imposé) | 6-7 sorties | **Trou** — « tiers indépendant » présenté comme obligation ; dump Claude qualifie l'audit Buildy d'inspection R175-5-1 |

### R175-6 — Régulation automatique de la chaleur

| Exigence normative | Implémentation | Verdict |
|---|---|---|
| Régulation automatique par pièce ou par zone chauffée | `action-generator.js:616` | **Trou** — conforme à n'importe quel niveau (loi d'eau production, `central_only`) ; granularité terminale jamais exigée par le verdict |
| II — Exemption « appareil indépendant de chauffage au bois » | `action-generator.js:606`, `_export-data.js:710` | **Trou** — appliquée à tout générateur bois (chaudière collective exemptée à tort) |
| II 1°/2° — Déclencheurs PC>21/07/2021 / travaux générateur | `_export-data.js:1112-1133` | **Partiel** — double déclencheur OK, mais dates nulles collapsées en « non soumis » ; borne travaux `>` au lieu de `>=` ; déclencheur non rattaché au générateur remplacé |
| Champ d'application : chaleur uniquement | `action-generator.js:630` | **Trou** — étendu au refroidissement (« par zone refroidie ») |
| II 2° — Dispense TRI ≥ 10 ans | branche non applicable PDF | **Trou** — non rappelée dans l'action de mise en conformité |

---

## 2. Findings confirmés par gravité juridique

### 2.1 Affirmations fausses (un audit livré affirme une conformité ou un chiffre faux)

**A. Colonne morte `meets_r175_3_p3` sur les devices → verdict R175-3 par système faussé (racine unique, ≥5 findings).**
Citation : *« Sont interopérables avec les différents systèmes techniques du bâtiment »* (R175-3 3°). La table `bacs_audit_system_devices` n'a pas de colonne `meets_r175_3_p3` (elle n'existe qu'au niveau système, inutilisée depuis la mig 42). `_export-data.js:323` : `const failIop = active.filter(d => isFalse(d.meets_r175_3_p3))` → toujours vide ; `undefined == null` → tout device « pending ». Exposition (audit #56 vérifié) : sys#10804 (Aérotherme, `is_communicating=1/wired=1/managed=1/p4=1/p4a=1`, intégralement qualifié) livré « Conformité non statuée — les 4 critères n'ont pas été qualifiés » (affirmation fausse) ; le verdict « Conforme au décret BACS » (`:368`) est inatteignable — 0 compliant / 12 pending. Le motif « protocole propriétaire fermé (§3°) » ne peut jamais apparaître. Même colonne morte comptée par le MCP (`buildy-audit-read.mjs:479-480, 610-611`) et le dump Claude (`lifecycle.js:346`) → « interopérabilité non répondue sur N systèmes » servi à Claude Desktop, faux. Seule la fixture (qui seede ce champ fictif) masque le bug. **Fix** : dériver §3 des champs réels (protocole actif + `wired`/`managed_by_bms`), comme le générateur (`action-generator.js:299-309`) ; retirer `meets_r175_3_p3` du filtre `pending` ; aligner la fixture sur le schéma prod.

**B. Bois/biomasse exclu du cumul R175-2 et exempté R175-6 (racine unique, ≥6 findings).**
Citation : générateur = production de chaleur par *« Combustion de combustibles »* (R175-1 8°a) ; l'exemption R175-6 II vise le seul *« appareil indépendant de chauffage au bois »*. `power.js:80` : `if (energy === 'wood' || energy === 'biomass') return 'out_of_scope'` → chaufferie biomasse collective 400 kW → cumul 0 → PDF « Non assujetti (<70 kW) », alors que le bâtiment est assujetti depuis 2025. `action-generator.js:606` / `_export-data.js:710` : `generator_exempt_wood: generatorEnergy === 'wood'` → chaudière bois centrale + radiateurs sans régulation par pièce livrée « exemptée R175-6 » et sans action. Incohérences internes : même chaudière en `'biomass'` non exemptée ; poêle à granulés en `'biomass'` non exempté ; tooltip et annexe A disent correctement « appareils indépendants ». **Fix** : router `wood`/`biomass` en catégorie heating vers `boiler_sum` ; réserver l'exemption au critère « appareil indépendant » (`generator_type='wood_appliance'`, déjà dans `GENERATOR_TYPES`) ; corriger les libellés `POWER_CALC_TYPE_LABEL.out_of_scope` et `_compliance-summary.js:301,307` (« R175-6 §3 » inexistant).

**C. Sous-cas d'assujettissement R175-2 II mal câblés (racine unique, ≥6 findings).**
Citation : II 1° *« >290 kW … PC déposé après le 21 juillet 2021 »* (immédiat) ; II 3° *« >70 kW … après le 8 avril 2024 »* (immédiat). `power.js:316-331` et copie `afs.js:75-93` : la date 08/04/2024 est testée sur le palier >290 (au lieu de 21/07/2021) et l'immédiateté n'est jamais propagée aux 70-290 kW neufs. Bâtiment neuf 150 kW PC mars 2025 → PDF « assujetti 01/01/2030 » : 4 ans de délai accordés à tort, obligation de relier TOUS les systèmes (propre aux 1°/3°) invisible. Symétriquement, un 400 kW PC 2022 classé 2°. Seuils `>=` : 290,0 kW → régime 2025 (au lieu de 2030), 70,0 kW → assujetti (hors champ). Label `subject_immediate` (`_labels.js:101` / `_compliance-summary.js:93`) : « Bâtiment > 290 kW **déjà existant** » alors que le statut n'est attribué qu'aux neufs — la fixture Atlas Sud (PC 2017) porte même ce statut impossible. **Fix** : refondre le calculateur unique (fusionner les 2 copies) — seuils stricts, `>290 & PC>2021-07-21 → immediate` (1°), `>70 & PC>2024-04-08 → immediate` (3°), sinon 2025/2030 ; corriger le label et re-seeder la fixture en `subject_2025`.

**D. Statut d'assujettissement effacé par la divergence `manual_override` — audit #56 livré « non statué » sous 949 kW / PC 1998.**
Citation : II 2° *« >290 kW, au plus tard le 1er janvier 2025 »*. Vérifié : `powerSummary.effectiveKw=949`, PC 1998, mais `bacs_applicability_status=null`. `power.js:218` teste `source === 'manual'` alors que le CHECK DB vaut `'manual_override'` ; `recomputeAndPersistAuditPower` calcule l'applicabilité sur `bacs_total_power_kw=null`. Le PDF imprime « Puissance retenue : 949 kW », « Permis : 01/01/1998 », puis « Statut d'assujettissement non renseigné » et le caveat « puissance ou date de permis non renseignées » — contradiction interne, obligation en vigueur depuis 01/01/2025 invisible. **Fix** : aligner les deux fonctions sur `'manual_override'` et retomber sur `auto.retainedKw` quand la colonne est null ; défense à l'export via `computeBacsApplicabilityFromPower(effectiveKw, …)` en fallback. (Livraison standard bloquée par IDENT-002 ; exposition = PDF Aperçu/Rapport ou `?force=1`.)

**E. Explainers MCP + `bacs_knowledge` figés sur l'échéance abrogée 2027 (racine unique, 3 findings).**
Citation DECRET-HISTORIQUE : *« au plus tard le 1er janvier 2030 (échéance repoussée de 2027 à 2030 … JO du 26 décembre 2025) »*. `_bacs-explainers.mjs:686` teste `subject_2027` (statut inexistant côté Docs) → tout `subject_2030` tombe dans le fallback « Statut à qualifier » et `rule_summary` affirme 2027. `bacs_knowledge` (seule source marquée « opposable ») répond encore « 1er janvier 2027 » (`ingest.mjs` non rejoué). **Fix** : renommer la branche en `subject_2030` (« report JO 26/12/2025 ») ; rejouer `node scripts/bacs-knowledge/ingest.mjs` (dev+prod) ; ajouter un garde-fou de cohérence `decree-articles.json ↔ table`.

**F. FAQ-11 non appliquée : PAC réversible comptée sur une seule face (racine unique, 3 findings).**
Citation FAQ-11 : *« la puissance en chaud du système est cumulée avec les autres puissances en chaud … la puissance en froid … avec les autres puissances en froid »* (exemple ministériel : PAC 10/8 + chaudière 25 → chaud 35, froid 8). `power.js:141` : `if (pHeat >= pCool) return { heat: pHeat, cool: 0 }`. Exposition démontrée (fixture Atlas Sud : chaud affiché 362,4 kW vs 418,4 FAQ-11 ; cas limite PAC 42/45 + chaudière 30 → retenue 45 → « non assujetti » alors que chaud FAQ-11 = 72 ≥ 70). **Fix** : pour thermodynamic_max hors catégorie cooling, retourner `{ heat: pHeat, cool: pCool }` ; la non-cumulation reste garantie par `retainedKw = max(heat, cool)` au niveau site. (Audit #56 non affecté : ses thermo sont en cat cooling.)

**G. « Conforme » par simple absence d'action alors que la question est non répondue (Communay au niveau verdict, racine unique, ≥6 axes).**
Citation R175-3 2° (exigence positive à constater) + doctrine ternaire interne. `_compliance-summary.js:413` : le fall-through `verdictFromActions()` conclut `compliant` dès que le bucket est vide. Le générateur ne crée d'action que sur `=== 0` explicite → `meets_r175_3_p2=null`, `has_maintenance_procedures=null` (R175-4), `operator_trained=null` (R175-5) donnent un axe « Conforme » alors que l'evidence dit « Non renseigné ». Le gating `unknown` n'existe que pour `bms.present==null`, pas pour les ternaires d'axe. **Fix** : avant le fall-through, court-circuiter chaque axe à champ ternaire unique non répondu vers `v='unknown'` + `contextSummary` neutralisé (r175_3_2, r175_4, r175_5) ; pour 3°/4°, `unknown` si aucun device pertinent n'a de réponse.

**H. `inspection_not_applicable=1` → axe R175-5-1 « Conforme » affirmant qu'une inspection est réalisée (audit #56).**
Citation : *« les systèmes … sont soumis à inspection périodique »* (R175-5-1) ; FAQ-30 : obligatoire tous les 5 ans depuis le 01/01/2025. Audit #56 : `inspections=null`, `inspection_not_applicable=1` (motif « contrat de maintenance ») → générateur saute l'action, `buildComplianceSummary` ne lit jamais le flag → `verdictFromActions(0,0)=compliant` + résumé « Une inspection indépendante du BACS est réalisée et son rapport conservé 10 ans ». Un contrat de maintenance relève de R175-4 et n'exonère pas de R175-5-1. **Fix** : passer le flag à `buildComplianceSummary` → verdict `'na'` (jamais `compliant`) avec le motif saisi ; restreindre les motifs NA à des cas juridiquement fondés.

**I. Le dump Claude qualifie l'audit Buildy d'« Inspection periodique R175-5-1 » (racine unique, 2 findings).**
Citation : l'inspection est un acte distinct à l'initiative du propriétaire, rapport conservé 10 ans ; disclaimer Buildy `methodology.js:78` : *« il ne constitue en aucun cas le rapport d'inspection lui-même »*. `lifecycle.js:315-319` : `report_type: 'Inspection periodique R175-5-1', retention_years: 10`. Contredit le system prompt (`claude.js:531-532`) et l'annexe D du même PDF ; si le dump l'emporte, la synthèse livrée affirme au client que son obligation d'inspection est remplie — exposition juridique directe. **Fix** : `report_type: 'Audit de conformité préalable — distinct de l'inspection R175-5-1'` ; supprimer `retention_years:10` ; répéter la distinction dans le user prompt.

**J. Chapitre 7 du PDF : régime juridique de l'inspection faux.**
`bacs-audit.hbs:1762` : *« R175-5-1 impose une inspection périodique des systèmes de chauffage et de climatisation dont la puissance … dépasse les seuils fixés au code de l'environnement »* — confond l'inspection du BACS (R175-5-1, code de la construction) avec l'inspection thermique R224-* (code de l'environnement) dont les systèmes reliés à un BACS sont précisément **exemptés** depuis 2023. **Fix** : réécrire « inspection périodique du BACS des bâtiments assujettis à R175-2, à l'initiative du propriétaire ».

**K. « Tiers indépendant » présenté comme obligation du décret (6-7 sorties).**
Citation R175-5-1 : *« la personne ayant effectué l'inspection »* (aucun tiers) ; FAQ-30 : *« il PEUT ÊTRE PERTINENT de faire réaliser cette inspection par un tiers indépendant »* (recommandation). `action-generator.js:657,667`, `_compliance-summary.js:38,273`, `bacs-audit.hbs:1762`, `methodology.js:78`, `lifecycle.js:689`. **Fix** : libellé unique « inspection à l'initiative du propriétaire ; le ministère recommande de la confier à un tiers indépendant (FAQ-30) », centralisé.

**L. R175-5 « nativement couverte par le support Buildy » — exploitant non formé jugé conforme.**
`action-generator.js:561` : `if (bms.operator_trained === 0 && !isBuildySolution(bms))` → sur site Buildy, `operator_trained=0` ne génère rien et le PDF imprime « L'exigence R175-5 est nativement couverte par le support intégré » (`hbs:1539`). Une assistance embarquée n'est pas une formation et ne produit aucune feuille d'émargement (FAQ-30). **Fix** : générer l'action `training` dès `operator_trained===0` y compris Buildy ; reformuler le callout en « formation à documenter (date, participants, émargement) ».

**M. Prompt MCP consultant : double mischaracterisation d'articles.**
`buildy-audit-knowledge.mjs:259` : *« R175-4 et R175-5-1 pour l'inspection, R175-5 pour la sanction »*. R175-4 = vérifications/maintenance, R175-5 = formation, aucune sanction dans le décret (DECRET-ISO-52120). **Fix** : corriger le mapping et ajouter « le décret ne prévoit aucune sanction directe ».

**N. Régulation R175-6 conforme à tout niveau ; extension au froid (racine unique, ≥4 findings).**
Citation : *« régulation de la température par pièce ou par zone chauffée »* (R175-6 II 2°). `action-generator.js:616` accepte `prod_reg_type`/`dist_reg_type`/flag/`central_only` legacy → une loi d'eau seule → axe « Conforme » ; contredit la propre doctrine MCP (`buildy-audit-read.mjs:142`, « central_only NON CONFORME »). `action-generator.js:630` : « R175-6 exige … par zone **refroidie** » — obligation sur le froid inexistante dans cet article (relève du décret 2023-444). **Fix** : exiger `granularityKey ∈ {per_room, per_zone}` au niveau émission ; pour cat cooling, ne pas citer R175-6 (base : décret 07/06/2023).

**O. R175-6 : dates nulles collapsées en « non soumis » (2 findings) + evidence >100 %.**
`bacs-audit.hbs:1154` / `_export-data.js:1123` : PC et travaux non renseignés → `applies:false` motif « antérieurs ou égaux au 21/07/2021 » → PDF « votre bâtiment n'est donc pas soumis ». Vérifié audit #56 (works date null). `_compliance-summary.js:301` : `complete = withEmission + woodExempt` → couverture 150 % possible + « R175-6 §3 » inexistant. **Fix** : 3e état `applies:'unknown'` (« À qualifier ») ; `complete` = union (`||`), label « Exemption R175-6 II ».

**P. Evidence « Mise à disposition des données » lit `meets_r175_3_p2` (détection) — racine unique, ~4 findings.**
Citation R175-3 dernier alinéa. `_compliance-summary.js:238` : `key:'bms_meets_p2', label:'Mise à disposition des données'` alimenté par `meets_r175_3_p2`. Vérifié fixture Atlas Sud : `data_provision_to_operators=0` mais l'evidence imprime « Mise à disposition : Oui ». **Fix** : remplacer par `data_provision_to_manager` et `data_provision_to_operators` (ternaires). Corriger AVANT de rendre `evidence.kpis` dans le PDF, sinon le défaut passe latent → affirmation fausse.

**Q. `gestionnaire_exploitant_access='no'` ne génère ni action ni verdict (audit #56).**
`action-generator.js:540` teste `data_owner_access` mais jamais `gestionnaire_exploitant_access`. Audit #56 : l'auditeur a répondu « no » → 0 action → axe « Conforme ». **Fix** : action majeure R175-3 dernier alinéa sur `'no'` et `'partial'`.

**R. `present_actual NOT NULL DEFAULT 0` : tout compteur requis naît « absent constaté » (racine unique, ≥3 findings).**
`database.js:1252`. Le resync génère chaque compteur requis à 0 ; si l'onglet Compteurs n'est pas repassé, `recapStats.metersMissing` (`_export-data.js:1239`) et evR175_3_1 impriment « N compteurs requis mais absents » et l'axe passe non conforme — absence jamais vérifiée. La tuile PDF « à installer » compte aussi les `null`. **Fix** : rendre `present_actual`/`communicating` NULLABLE (writable_schema) ; resync insère `null` ; `metersMissing` en `isFalse()` strict + `metersPresenceUnanswered` distinct.

**S. Rendus truthy PDF sur champs ternaires (racine unique, plusieurs cartes).**
`bacs-audit-tables.hbs:99`, `bacs-audit.hbs:1475,1518,1437` : `{{#if bms.has_maintenance_procedures}}✓{{else}}✗{{/if}}` → `null` rendu « ✗ » rouge (constat de non-conformité jamais effectué). Les helpers `triSym`/`triCls` (`pdf.js:263-264`) existent et sont utilisés ailleurs. **Fix** : substituer les `#if` truthy par les helpers tri-état + classe `.check-na`/`.kv-na`.

**T. Cohérences internes diverses (affirmations fausses).** Bandeau « L'essentiel » : branche `else` affirme « site conforme au décret BACS » quand `verdict='unknown'` (`hbs:176`). MCP `advisor.mjs:115` compte les compteurs HS comme présents (6) contre `read`/PDF (5) — deux chiffres dans la même conversation (vérifié Atlas Sud). Annexe B méthodologie : « immédiate pour les bâtiments neufs livrés après [01/01/2025] » (`methodology.js:54`) contredit l'annexe A du même PDF (21/07/2021). Annexe A annoncée « texte intégral » alors que le seed a perdu l'obligation de RELIER les systèmes (`bacs-audit.hbs:1934`). Sous-station RCU sans join du slug → cumul amputé card 04/MCP (`bacs-audit.js:1759`). Batterie électrique de CTA (FAQ-09) silencieusement `out_of_scope` (`power.js:89`) → 100 kW disparus. Evidence R175-2 cite « §1 a)/b) » inexistants (`_compliance-summary.js:140`). Dump thermal legacy `regulation_type=null` post-mig 180 → synthèse contredit le chap. 5 (`lifecycle.js:411`).

### 2.2 Exigences du décret non modélisées (obligation sans chaîne saisie→verdict→action→restitution)

- **Clause « ajustent les systèmes en conséquence » (R175-3 1°, FAQ-13)** : cœur fonctionnel du décret réduit au comptage. Une GTB de pure supervision (journalisation sans pilotage) obtient « Conforme ». Aucun champ `active_command_capable`. **Le plus grave de cette catégorie.** Fix : question dédiée + action **bloquante** si `=== 0`.
- **Pas de temps horaire (R175-3 1°)** : aucun champ `recording_time_step` ; question desktop P1 omet « pas horaire » et « production ». Une GTB au pas journalier peut être conforme.
- **3 sous-exigences du 2°** (valeurs de référence / détection / information) collapsées ; `bacs-energy-reference.js` sans effet.
- **Production d'électricité sur site absente du volet GTB** : `manages_electricity_production` inexistant (`BmsSection.vue:129` référence des colonnes fantômes) ; devices/compteurs PV jamais « intégrés GTB ».
- **Renouvellement CVC (R175-2 II 4°)** : échéance toujours 2030, jamais l'échéance anticipée au renouvellement.
- **Dispense TRI (R175-2/R175-6)** : `bacs_roi_study_status` saisi, restitué nulle part.
- **Périmètre différencié 1°/3° vs 2°/4°** : raccordement uniforme, sur-affirme l'obligation pour l'existant.
- **Extension / ensemble immobilier (FAQ-29), mixte / prorata tertiaire (FAQ-06)** : cumul document-level sans agrégation cross-bâtiment ni part tertiaire.
- **R175-4** : périodicité/points/réparation/compétence non scorés.
- **Exemption R224 (R175-4 al.3)** : avantage client majeur invisible hors annexe.
- **R175-5-1** : 4 sous-obligations non structurées ; échéance 01/01/2025 et périodicité 5 ans absentes du plan ; délai de remise 1 mois non tracé ; shape mismatch objet/array (« Aucune déclarée » même avec inspection saisie, `+ inspector_name` colonne inexistante) ; `audit_inspection_add` n'accepte pas `next_inspection_due_date`.
- **R175-6** : déclencheur travaux non rattaché au générateur remplacé (action sur toute la chaufferie) ; dump Claude aveugle (legacy seul).
- **`assistActionAlternatives` non importé (`lifecycle.js:245`)** : `generate-alternatives` → `ReferenceError` → 500 systématique, « autres solutions envisageables » (R175-5-1 4°) morte silencieusement. **Quick win.**

### 2.3 Nuances FAQ/PROFEEL non reflétées

Catalogue de Lectures Buildy divergent du code réel : `LB-R175-6-GRANULARITE` affirme que le décret « ne précise pas la granularité » (faux) ; `LB-R175-2-CUMUL` dit « on retient la somme … conforme FAQ » (contraire à FAQ-11) ; `LB-R175-3-P4-PAR-EQUIPEMENT` décrit une doctrine que le code n'applique plus. Tooltips R175-2 (« cumulée chauffage + climatisation », date 8 avril sur >290) contraires à FAQ-11 et au propre calcul. Règle des 5 % sans garde d'agrégation FAQ-16 ; label « exempté du décret » et « R175-2 §5 » sur-qualifiés. Voie API Linky/Gazpar (PROFEEL-3.1.1) non modélisée → action « raccorder » là où PROFEEL prescrit une API. Présomption classe C ISO (PROFEEL-1.1) : `compliance_mode`/`bacs_iso52120_functions` morts. « Arrêt manuel » lu comme interrupteur local (vs GUIDE-1.2 E). Éclairage extérieur hors bâti soumis d'office (GUIDE-2.2 note 10). `bacs_knowledge` non injecté dans le prompt de synthèse (Claude cite de mémoire). Liste de points TA/TS/TM/TC/TR (PROFEEL-4) absente. Mutualisation inter-propriétaires (FAQ-05 §3) non détectée (aggravée par le singleton `bacs_audit_bms`). Redondance `meets_r175_3_p1` vs `data_storage_5y_compliant` sans garde. Divergences de décompte compteurs/régulation UI vs PDF vs MCP (advisor, MetersSection, ThermalSection).

---

## 3. Plan de remédiation ordonné

### Lot 1 — Quick wins (bugs de cohérence 1-ligne, S) — **avant toute release**
- **`lifecycle.js:11`** : importer `assistActionAlternatives` (fonction morte → 500). *S, 1 fichier.*
- **`_bacs-explainers.mjs:686`** : `subject_2027` → `subject_2030` (report JO 26/12/2025). *S.*
- **Rejouer `scripts/bacs-knowledge/ingest.mjs`** (dev+prod) : purge le « 2027 » de la source opposable. *S.*
- **`power.js:218` / `293-306`** : aligner `manual_override` (statut #56 effacé) + fallback auto quand null. *S/M.*
- **`advisor.mjs:115`** : `present` avec `!out_of_service` (aligner sur `read.mjs`). *S.*
- **`bacs-audit.hbs:176`** : branche `unknown` explicite (« GTB non qualifiée »). *S.*
- **`bacs-audit.hbs:679`** : `is_looped "no_loop"` → `"not_looped"`. *S.*
- **`_compliance-summary.js:140,301,307`** : références « §1 a)/b) », « R175-6 §3 » inexistantes. *S.*
- **`bacs-audit.js:1759` + `afs.js:434`** : `LEFT JOIN equipment_templates` (sous-station RCU). *S.*
- **Seuils stricts `>` / helpers truthy PDF** : `power.js:318,324` + `afs.js:77,86` ; `hbs:1475,1518,1437` + `tables.hbs:99`. *S/M.*

### Lot 2 — Cohérence verdict & evidence (M) — **cible affirmations fausses résiduelles**
- **Colonne morte `meets_r175_3_p3`** : réécrire `computeSystemCompliance` sur les champs réels + retirer du filtre `pending` + purger des payloads MCP (`buildy-audit-read.mjs:479-482,610-613`) et du dump (`lifecycle.js:346`). Aligner la fixture. *M, ~5 fichiers.*
- **Gating ternaire au niveau verdict d'axe** (`_compliance-summary.js:413`) : `unknown` sur r175_3_2/3/4, r175_4, r175_5 quand le champ pivot est `null` ; neutraliser les `contextSummary` affirmatifs. *M.*
- **`inspection_not_applicable` → `'na'`** (jamais `compliant`) + motif. *M.*
- **Evidence « mise à disposition »** : `data_provision_to_manager`/`_to_operators` (`_compliance-summary.js:238`). Générateur : brancher `gestionnaire_exploitant_access`. *S/M.*
- **`skip isBuildySolution`** retiré (R175-5) ; callout PDF reformulé. *S.*
- **`present_actual`/`communicating` NULLABLE** + `metersMissing` strict + tuile « à qualifier ». *M (migration).*
- **Dump Claude R175-5-1** : `report_type` corrigé, `retention_years` retiré ; frame + prompt alignés. *S.*
- **PDF chap. 7 + prompt MCP** : régime R175-5-1 corrigé, « tiers » en recommandation FAQ-30, mapping d'articles. *S/M.*

### Lot 3 — Lots moyens fonctionnels (M/L)
- **Décomposition R175-2 II 1°/3°/4°** : refondre le calculateur unique (fusionner `power.js` + `afs.js`), porter le sous-cas sur le document, différencier le périmètre de raccordement, modéliser le renouvellement CVC. *L.*
- **PAC réversible FAQ-11** (`power.js:141`) + CTA batterie FAQ-09 (`power.js:89`). *M.*
- **Exemption bois → « appareil indépendant »** partout (`action-generator.js:606`, `_export-data.js:710`, `_compliance-summary.js:301`, UI) + routage `wood/biomass` vers `boiler_sum`. *M.*
- **Granularité R175-6 par pièce/zone** : prédicat unique partagé (`lib/bacs-thermal-compliance.js`) consommé par générateur, `_export-data`, evR175_6, UI ; sortir le froid de l'axe. *M/L.*
- **R175-6 dates** : 3e état `unknown` ; borne travaux `>=` ; rattachement au générateur remplacé ; validation Zod format ISO (`afs.js:39`). *M.*
- **R175-5-1 complet** : shape objet/array, 4 sous-obligations, échéance 2025/périodicité 5 ans/délai 1 mois dans le plan, `audit_inspection_add` enrichi. *M/L.*
- **Sous-exigences R175-3 1° (commande automatique, pas horaire) et 2° (valeurs référence/détection/information)** : nouveaux champs + actions. *M/L.*
- **Production d'électricité GTB, R175-4 sous-contenus, dispense TRI restituée, exemption R224 restituée**. *M chacun.*

### Lot 4 — Chantiers (L)
- **Injection `bacs_knowledge` dans les prompts de synthèse et alternatives** (`claude.js:634,675`) — la spec détaillée figure dans le finding « bacs_knowledge non injecté » (bloc system cacheable, hiérarchie décret > FAQ/guide > PROFEEL, interdiction TRI étendue). *L.*
- **Feature « lien décret » / annexe A générée depuis `bacs_knowledge`** (source unique versionnée) au lieu du duplicata `seeds/bacs-articles.js` — spec dans le finding « Annexe A texte intégral tronqué ». *L.*
- **Alignement du catalogue de Lectures Buildy** sur le code réel (bump `CATALOG_VERSION`) + tooltips servis depuis l'API. *M/L.*
- **Extension du script `verify-audit-coherence.mjs`** (advisor, UI via `frontend/src/lib/ternary.js`, dataset `present_actual=null`) + garde-fou statique anti-truthy. *M.*
- **Périmètre multi-propriétaires (FAQ-05 §3, singleton `bacs_audit_bms`)**, extension/mixte (FAQ-29/06), liste de points PROFEEL, présomption classe C ISO. *L.*

---

## 4. Couverture : vérifié et jugé conforme

**R175-1** — Familles de systèmes exhaustives (`_shared.js:5`, `bacs-requirements.js:22-54`) ; zone fonctionnelle par usages homogènes et regroupement si comptage non séparable (`zones.js:22`, `bacs-functional-zones.js:36`) ; texte intégral fidèle des définitions 7°/8°a-d en annexe (`bacs-articles.js:31-48`) ; mapping énergies→processus (`seeder.js:1005`).

**R175-2** — `retainedKw = max(cumul chaud, cumul froid)`, pas d'addition inter-côtés (`power.js:200`, FAQ-11/PROFEEL-2) ; secours exclus (`power.js:57`, FAQ-08) ; ECS autonome hors cumul (`power.js:90`, FAQ-10) ; réseau urbain = station d'échange, aval hors cumul (`power.js:72-78`, `bacs-district-heating.js`) ; sommation multi-générateurs même usage (FAQ-12) ; production centralisée multi-bâtiments à puissance pleine + cas F (`power.js:110-156`, `bacs-liability.js:129`) ; règle protectrice « puissances incomplètes → présomption d'assujettissement » (`power.js:189-194,240`) ; attribution de l'assujetti par système, 6 cas A-F dont sous-station gestionnaire de réseau exclu (`bacs-liability.js:65-213`) ; règle des 5 % avec justification obligatoire, verdict exempt tracé, exclusion du comptage (`bacs-audit.js:246`, `_export-data.js:307`, `seeder.js:1077`) ; report 2027→2030 répercuté code/DB/livrables (mig 169, `_labels.js:103`, `bacs-articles.js:63`) ; double seuil et caveat quand statut indéterminé (`_compliance-summary.js:106`) ; TRI signalé mais jamais calculé par Buildy.

**R175-3** — Conservation 5 ans : chaîne saisie→action bloquante→axe (`action-generator.js:477,529`) ; mise à disposition gestionnaire + exploitants = 2 actions distinctes correctement routées (`action-generator.js:507-526`) ; accès propriétaire (`:540-548`) ; zones fonctionnelles comme granularité du comptage (`seeder.js:997`) ; compteurs zonaux (zone×usage×énergie) + généraux par énergie (`seeder.js:1144`) ; compteur non communicant = obstacle au pas horaire (`action-generator.js:435`) ; interopérabilité au niveau système « au moins un device pertinent » avec émetteurs passifs exclus (`action-generator.js:276-342`, PROFEEL confirme) ; gating ternaire anti-Communay sur les conclusions négatives (`:317,356`) ; contre-indications d'arrêt cataloguées PROFEEL (`:89-118`) ; ECS bouclée = arrêt interdit sur base arrêté 30/11/2005 (`:241-251`) ; absence de GTB → axes non conformes, GTB non qualifiée → `unknown` (`_compliance-summary.js:404-411`) ; plan de comptage PDF en états ternaires stricts (`_meter-coverage.js:31-40`) ; matrice de couverture « à qualifier » vs « manquant » ; texte intégral fidèle en annexe (`bacs-articles.js:69-81`) ; axes r175_3_1 et r175_3_data distincts (`:50-55`).

**R175-4** — Action sur absence constatée de consignes (`action-generator.js:497`) ; axe distinct, verdict impossible sans BACS (`_compliance-summary.js:34,387`) ; saisie UI desktop+mobile complète ; énoncé et modalités restitués au PDF ; dump ternaire strict ; checklist terrain ; scanner de complétude MCP ; exemption R224 seedée verbatim en annexe.

**R175-5 / R175-5-1** — Texte intégral fidèle (4 sous-obligations, délai 1 mois, conservation 10 ans, échéance 2025) `bacs-articles.js:94-108` ; axes distincts, regex R175-5-1 avant R175-5 (`_compliance-summary.js:57-60`) ; frontière audit≠inspection dans méthodologie/checklist/disclaimers (`methodology.js:77`, `disclaimers.js:24`) ; action formation sur exploitant non formé (hors Buildy) ; actions « aucune inspection » et « échéance dépassée » ; GTB présente non conforme ne dispense pas (`noGtb` strict `present===0`) ; pré-remplissage +5/+10 ans UI ; outils MCP inspections positionnés comme trace tierce distincte ; R175-5-1 1° et 4° partiellement reflétés au dump.

**R175-6** — Assujetti = propriétaire des émetteurs (texte fidèle annexe) ; exemption bois correctement **énoncée** « appareils indépendants » dans les textes (tooltip, annexe) ; double déclencheur PC>21/07/2021 OU travaux (`_export-data.js:1112`) ; dispense TRI rattachée au bon alinéa (2°) sans calcul ; cas « ni PC récent ni travaux » = axe `na` motivé ; granularité dérivée du type d'émission + saisie explicite prioritaire ; vannes thermostatiques mécaniques conformes sans exigence de communication ; axe séparé, idempotence par `source_thermal_id`.

**Transverse** — Le PDF restitue le dashboard sans le réinterpréter (`hbs:316-341`) ; garde « compliant interdit si GTB non qualifiée » à la source unique (`_compliance-summary.js:357`) ; MCP traduit fidèlement `unknown`/`na` (`_bacs-explainers.mjs:658`) ; cohérence PDF↔MCP `audit_get` sur compteurs présents/gap ; doctrine ternaire respectée dans le dump et le system prompt ; versioning juridique en footer PDF ; gate `verify-audit-coherence` (partielle) ; TRI exclu des sorties IA ; audit #56 aux restitutions convergentes sur les axes non touchés par les findings.

### Findings écartés (réfutés, transparence)
1. Protocole « autre » comme voie d'interop — lecture réglementaire sur-interprétée, mécanisme code exact (PROFEEL réserve l'exclusion à la GTB).
2. Identification `heat_pump` instable — périmé, mig 195 a corrigé le template vers `electric`.
3. Chaleur fatale non modélisable — réfuté : `energy='autre'` en heating tombe sur `boiler_sum`, pas `out_of_scope`.
4. Chaufferie gaz #56 sans action de raccordement — faits reproductibles mais base normative sur-interprétée (protocole « autre » = voie valide).
5. Tooltip R175-3 3° paraphrase inexacte — entrée `'R175-3 3°'` = code mort (aucun usage frontend).
6. Conservation 10 ans non exposée MCP — faux : `retained_until_date` présent dans `audit_inspection_add` (`workflow.mjs:337`).
7. Motif « protocole propriétaire fermé » PROFEEL — code mort (`failIop` sur colonne inexistante).
8. Descriptions d'actions sans citation/rang — inversé : FAQ-16 dit explicitement « exempté de raccordement ».
9-11. `meters_summary.absent` / matrice UI / « X communicants » collapse Communay — inatteignables : `present_actual`/`communicating` sont `NOT NULL DEFAULT 0` (pas de `null` possible).
12. Evidence « Couverture R175-6 » contredit son axe — `evidence.kpis` non consommé par aucun livrable à ce jour.
13. Fixture `buildComplianceSummary` sans blocs evidence — sans portée réglementaire (atelier de design uniquement).
14. Evidence R175-5-1/R175-4 objet vs Array — défaut réel mais non exposé (PDF/MCP ne rendent pas evidence).
15. Dispense TRI consommée nulle part — colonnes bien mortes, mais le finding sur-interprétait l'impact attendu sur le verdict.
16. Dump Claude aveugle aux exclusions juridiques — réfuté : `action_items_open` porte les exclusions (ECS bouclée, secours) en clair.

---

# Annexe — Spécification feature « lien vivant vers le décret »

Spécification complète, fondée sur la lecture du code réel (fichiers et lignes vérifiés).

# Spécification — « Lien vivant vers le décret BACS » (UI + PDF)

## 0. État des lieux vérifié (le problème à résorber)

Le texte du décret existe aujourd'hui en **4 copies divergentes** :

| Copie | Emplacement | Format | Granularité | Consommateurs |
|---|---|---|---|---|
| A | `backend-node/src/seeds/bacs-articles.js` (136 l., `BACS_ARTICLES` + `BACS_INTRO_HTML`) | HTML riche | article | Annexe A PDF (`_export-data.js:1087`, `_bacs-annex.hbs`), `/api/bacs-articles` (`routes/bacs-articles.js:16`), `BacsBadge.vue`/`BacsContextBox.vue` (via `getBacsArticles()`) |
| B | table `bacs_knowledge` source `decree` (9 lignes, `body_text` seul — **`body_html` est NULL sur les 9 lignes décret**, vérifié en DB) | texte brut | article | endpoints `/api/bacs-knowledge/*`, MCP FM `buildy-audit-knowledge` |
| C | `frontend/src/components/R175Tooltip.vue:62-107` (`ARTICLE_SUMMARIES`, 11 clés dont 5 au niveau alinéa) | HTML en dur front | alinéa | 8 sections d'audit desktop |
| D | libellés d'axes `_compliance-summary.js:22-40` + `r175_article` des action items (générateur, notation legacy `§3`) | codes texte | alinéa | dashboard PDF, action cards, `CompliancePlanSection.vue:189` |

Divergence concrète déjà présente : le report d'échéance 2027→2030 (JO 26/12/2025) est dans A et C mais la ligne `R175-2` de B porte `version_label = "Modifié par décret n°2023-259…"` sans mention du report. C mélange en outre texte opposable et « Interprétation Buildy » dans le même bloc — juridiquement dangereux (un auditeur peut citer la lecture Buildy comme si c'était le décret).

**Décision d'architecture** : `bacs_knowledge` (source `decree`, authority `opposable`) devient l'unique source de vérité du texte officiel, y compris pour le PDF. Les lectures Buildy (internal) restent dans le code, dans un module dédié, jamais mélangées au texte opposable.

Point d'attention : le schéma réel de `bacs_knowledge` (migration `database.js:7159-7174`) n'a **pas** de colonne `effective_from` (contrairement à ce que suppose l'énoncé) — elle est à créer (Lot 1).

---

## Lot 1 — Backend : source unique et endpoint alinéa (taille M, ~1 jour)

### 1a. Migration `bacs_knowledge`
- `ALTER TABLE bacs_knowledge ADD COLUMN effective_from TEXT;` (date d'effet de la version citée, ex. `2025-12-26` pour R175-2 post-report). Pas de refonte CHECK nécessaire (simple ADD COLUMN).

### 1b. Enrichir l'ingestion décret
- `backend-node/scripts/bacs-knowledge/decree-articles.json` : ajouter par article `body_html` (reprendre le `full_html` de `seeds/bacs-articles.js`, qui est la version la plus riche et la plus à jour) + `effective_from`.
- `scripts/bacs-knowledge/ingest.mjs` : porter `body_html` et `effective_from` dans l'INSERT. Mettre à jour le `version_label` de R175-2 pour mentionner le report 2030 (JO 26/12/2025).
- Réingestion idempotente existante (DELETE par source) : rien d'autre à toucher.

### 1c. Nouveau module de mapping alinéa → article
Nouveau fichier `backend-node/src/lib/bacs-decree-refs.js` (identifiants en anglais) :

```js
// Canonical ref keys — notation "N°" only ("§N" normalized on input).
const DECREE_REFS = {
  'R175-1':      { article: 'R175-1' },
  'R175-1 4°':   { article: 'R175-1', li: 4 },
  'R175-1 6°':   { article: 'R175-1', li: 6 },
  'R175-2':      { article: 'R175-2' },
  'R175-3':      { article: 'R175-3' },
  'R175-3 1°':   { article: 'R175-3', li: 1 },
  'R175-3 2°':   { article: 'R175-3', li: 2 },
  'R175-3 3°':   { article: 'R175-3', li: 3 },
  'R175-3 4°':   { article: 'R175-3', li: 4 },
  'R175-3 D.A.': { article: 'R175-3', anchor: 'data_access' }, // dernier <p> (mise à dispo des données)
  'R175-4':      { article: 'R175-4' },
  'R175-5':      { article: 'R175-5' },
  'R175-5-1':    { article: 'R175-5-1' },
  'R175-6':      { article: 'R175-6' },
};
function normalizeRef(s) { /* "R175-3 §3" -> "R175-3 3°", trim, etc. */ }
function extractAlineaHtml(fullHtml, refEntry) { /* portage serveur (cheerio, déjà en dépendance) du filterArticleHtml de BacsBadge.vue:72 : ne garde que le <li value=N> visé + le <p> d'intro */ }
```
- Les « Lectures Buildy » (actuels blocs `<em>Interprétation Buildy</em>` de `R175Tooltip.vue`) migrent ici dans `BUILDY_NOTES = { 'R175-3 1°': '<html…>' }`, servis avec `authority: 'internal'` explicite, jamais concaténés au texte officiel.
- La liste canonique couvre exactement les clés utilisées par le code réel : axes `_compliance-summary.js`, `r175_article` du générateur, ancres UI recensées (§ Lot 3).

### 1d. Endpoint bundle
Dans `routes/bacs-knowledge.js`, ajouter :
- `GET /api/bacs-knowledge/decree-refs` → **une seule réponse** contenant toutes les refs résolues :
```json
{ "decree_version": { "label": "Décret n°2023-259 du 7 avril 2023, échéance 70 kW reportée au 1er janvier 2030 (JO 26/12/2025)", "generated_from": "bacs_knowledge" },
  "refs": { "R175-3 1°": {
    "article_code": "R175-3", "article_title": "…",
    "official_html": "<p>…</p><ol><li value=1>…</li></ol>",
    "buildy_note_html": "…", "buildy_note_authority": "internal",
    "source_url": "https://www.legifrance.gouv.fr/…", "version_label": "…", "effective_from": "…"
  }, "...": {} } }
```
- Cache HTTP `Cache-Control: private, max-age=3600` (le décret ne change qu'à la réingestion) — répond à la contrainte historique du commentaire `R175Tooltip.vue:14` (« éviter un endpoint à chaque survol ») : 1 fetch par session, pas par survol.
- `GET /api/bacs-knowledge/decree-ref/:ref` (ref URL-encodée, normalisée `§`→`°`) pour le MCP et les cas unitaires.

### 1e. `/api/bacs-articles` devient une vue sur `bacs_knowledge`
`routes/bacs-articles.js` : remplacer le require du seed par `SELECT … FROM bacs_knowledge WHERE source='decree' AND kind='article' ORDER BY position` (garder le shape `{intro_html, articles:[{code,title,summary,full_html}]}` pour ne pas casser `BacsBadge`/`BacsContextBox` ; `summary` = premier alinéa de `body_text` ou champ dédié dans le JSON d'ingestion). `BACS_INTRO_HTML` migre en entrée `DECRET-INTRO` de `bacs_knowledge` ou reste constant dans la route.

---

## Lot 2 — PDF : extrait officiel + version du décret (taille M, ~1 jour)

### 2a. Annexe A depuis la source unique
- `_export-data.js:1087` : remplacer `bacsArticlesData.BACS_ARTICLES` par la lecture DB (`bacs_knowledge` décret, `body_html`). Ajouter par article `version_label`, `effective_from`, `source_url`.
- `templates/pdf/_bacs-annex.hbs` : sous chaque titre d'article, ligne de traçabilité — `<p class="bacs-article-version">{{version_label}} · Texte consulté sur Légifrance : <a href="{{source_url}}">{{source_url}}</a></p>`. Le lien est cliquable dans le PDF (Puppeteer préserve les `<a href>`) et l'URL est imprimée en toutes lettres (lisible sur papier). En tête d'annexe : encart « Version du décret citée » avec la mention du report 2030. Style : bordure pleine + fond teinté gris/navy, **aucune box-shadow** (charte `feedback_pdf_no_box_shadow_safari`).
- Supprimer ensuite `seeds/bacs-articles.js` (ou le réduire à un re-export deprecated le temps du Lot 5) — vérifier les autres requires listés : `export.js:44`, `_preview-fixture.js`, `af.hbs` (l'annexe AF utilise le même partial).

### 2b. Extrait d'alinéa sous chaque axe du dashboard R175
- `_compliance-summary.js` : chaque axe porte déjà son `code` alinéa (l.22-40). Dans `_export-data.js`, enrichir chaque axe avec `official_excerpt_html` via `extractAlineaHtml()` du Lot 1c (troncature ~350 caractères + « … voir annexe A »).
- `bacs-audit.hbs` (pages dashboard) : sous le verdict de chaque axe, bloc citation `<div class="axis-decree-quote">` — filet vertical navy 2px à gauche, texte gris italique, code alinéa en exposant. Ton neutre (le PDF est lu par le client final).
- Vérifier le rendu via l'atelier fixtures : `/api/bacs-audit/__preview-fixture` (hot reload .hbs/.css, pas de pm2 restart).

### 2c. Action cards : référence normalisée + renvoi annexe
- `_action-group.hbs:19` et `bacs-audit.hbs:1896` : le `r175_article` affiché passe par un helper Handlebars `normalizeDecreeRef` (enregistré dans `lib/pdf.js` à côté des helpers existants) → plus jamais de `§3` imprimé. Ajouter à côté du code : `(annexe A)`. Pas d'extrait par carte (30+ items × extrait = pages gonflées) : le renvoi annexe + l'extrait par axe du 2b couvrent le besoin.
- `bacs-audit-tables.hbs:414` (col R175 du A3) : même helper.

---

## Lot 3 — UI : composable de cache + refonte `R175Tooltip` (taille L, ~2 jours)

### 3a. Composable `frontend/src/composables/useDecreeRefs.js`
Pattern SWR déjà en vigueur dans le projet (cf. cache structure AF) :
- Cache module-level (Map partagée entre toutes les instances de tooltip) + `localStorage` clé `decree-refs-v1` (TTL 7 jours).
- `const { getRef, decreeVersion, ready } = useDecreeRefs()` : hydrate immédiatement depuis localStorage, fetch `GET /api/bacs-knowledge/decree-refs` en arrière-plan **une fois par session** (promesse partagée, pas de fetch par survol), écrase le cache.
- `getRef('R175-3 §1')` normalise puis résout ; retourne `null` si inconnu (le composant affiche alors le fallback actuel « consulte l'annexe A »).

### 3b. Refonte `R175Tooltip.vue`
- **Supprimer `ARTICLE_SUMMARIES`** (l.62-107) ; brancher sur `useDecreeRefs()`.
- Contenu du popover en 3 blocs distincts :
  1. **Texte officiel** — `official_html`, étiquette « Décret — opposable » (pilule navy), + `version_label`.
  2. **Lecture Buildy** — `buildy_note_html` si présent, étiquette « Méthodologie Buildy » (pilule grise), visuellement séparé (fond gris clair).
  3. Pied : lien `Voir sur Légifrance ↗` (`target="_blank" rel="noopener"`, Cmd-cliquable — c'est un `<a>` natif, conforme mémoire liens).
- **Accessibilité tactile** (charte 44px) : le déclencheur actuel est une icône 16px `tabindex="-1"` hover-only — non conforme. Refonte : `<button>` focusable, `aria-expanded`, zone de tap étendue `min-w-11 min-h-11` quand `useViewport().isCoarsePointer` (padding invisible autour de l'icône, layout inchangé en desktop souris), ouverture au **clic/tap** en pointer coarse (le hover reste en desktop), fermeture Escape + tap extérieur. Pas de dropdown natif concerné.
- Garder `Teleport to="body"` + le positionnement existant (l.29-44), inchangé.

### 3c. Brancher les consommateurs existants (aucune nouvelle ancre à inventer, elles existent)
Points d'ancrage vérifiés, tous conservés tels quels (le composant refondu suffit) :
`IdentificationSection.vue:83` (R175-2), `ZonesSection.vue:253` (R175-1 6°), `MetersSection.vue:162` (R175-3 1°), `SystemsSection.vue:408-409` (R175-1 4°, R175-3), `BmsSection.vue:298-300` (R175-3/4/5), `ThermalSection.vue:445` (R175-6), `InspectionsSection.vue:147` (R175-5-1), `SystemSettingsModal.vue:203` (slot custom), `BacsAuditDetailView.vue`.
- **Nouvelle ancre** : `CompliancePlanSection.vue:189` — le code `it.r175_article` (aujourd'hui texte mort gris) devient `<R175Tooltip :article="it.r175_article">` avec le code en libellé du déclencheur : chaque action du plan montre l'alinéa exact qui la fonde.
- `BacsBadge.vue` / `BacsContextBox.vue` : continuent de fonctionner via `/api/bacs-articles` (devenu vue DB au Lot 1e) — migration vers `useDecreeRefs()` en option au Lot 5 pour supprimer le double fetch ; y ajouter dès ce lot le lien Légifrance + `version_label` dans la modale de `BacsBadge`.

---

## Lot 4 — Normalisation des notations + MCP (taille S, ~0,5 jour)

- `lib/bacs-audit-action-generator.js` (l.192-439) : remplacer les 10+ occurrences `'R175-3 §3'` par la notation canonique `'R175-3 3°'` (le `source_url`/tooltip lookup devient direct, sans normalisation).
- Migration données : `UPDATE bacs_audit_action_items SET r175_article = <normalisé> WHERE r175_article LIKE '%§%'` (les items auto sont regénérés, mais les items livrés/figés doivent aussi être propres). Conserver `normalizeRef()` en défense partout (front + PDF helper).
- **Parité MCP** : dans `edge-fleet-manager/backend-node/src/mcp/tools/buildy-audit-knowledge.mjs`, ajouter l'outil `bacs_decree_ref_lookup({ ref })` → proxy de `GET /api/bacs-knowledge/decree-ref/:ref`. Payload pédagogique (mémoire tools) : texte officiel + authority + note Buildy séparée + URL Légifrance. Regénérer les compteurs via `node edge-fleet-manager/scripts/mcp-stats.mjs` avant release FM.

---

## Lot 5 — Finitions et dette (taille S/M, ~0,5-1 jour)

- Retirer définitivement `seeds/bacs-articles.js` une fois `export.js:44`, `_preview-fixture.js` et `af.hbs` migrés sur la lecture DB.
- Migrer `BacsBadge`/`BacsContextBox` sur `useDecreeRefs()` et supprimer `getBacsArticles()` + la route `/api/bacs-articles` (après vérification de l'onglet « Textes PDF & Articles R175 » de `/admin/bacs-parameters` qui la consomme aussi).
- Mobile (PWA audit) : les onglets `MobileSystemsTab`/`MobileBmsTab`/`MobileMetersTab` n'ont aujourd'hui **aucune** ancre décret — ajouter un déclencheur 44px par question R175 ouvrant un `MobileSheet` (composant existant) avec le même contenu 3 blocs. C'est le seul vrai « nouveau » périmètre UI ; il peut vivre en lot indépendant.
- Dump Claude (`lifecycle.js` l.312-438) : injecter `decree_version.label` dans le contexte pour que la synthèse cite la bonne version (report 2030).

## Ordre et dépendances

`Lot 1` (fondation, sans impact visible) → `Lot 2` (PDF) et `Lot 3` (UI) en parallèle → `Lot 4` → `Lot 5`. Chaque lot est livrable seul ; tests de non-régression : `verify-audit-coherence.mjs` après Lot 4 (touche `r175_article`), fixtures `__preview-fixture` + ouverture du PDF dans Safari après Lot 2, et vérification qu'aucun fetch réseau n'est déclenché au survol répété (Network tab) après Lot 3.

Risque principal identifié : l'extraction d'alinéa (`extractAlineaHtml`) dépend de la structure `<ol><li>` du `body_html` décret — la figer par un test unitaire backend (snapshot des 14 refs canoniques) pour qu'une réingestion qui casserait la structure échoue en CI plutôt qu'en silence dans le PDF.