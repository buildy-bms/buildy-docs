# La méthode interne d'audit BACS de Buildy

> Brouillon de production du lead magnet PDF (24-32 pages).
> Source unique : module d'audit BACS de Buildy + texte du décret R175.
> Ne rien inventer, ne rien ajouter. Tout chiffre commercial doit être validé par Kévin.

---

## Métadonnées

- **Titre PDF** : « La méthode interne d'audit BACS de Buildy »
- **Sous-titre** : *« La checklist qu'on utilise sur tous nos chantiers — livrée telle quelle, gratuitement. »* (chiffres remplacés par "tous nos chantiers" tant que le nombre exact n'est pas validé)
- **Tonalité** : vouvoiement, sobre, factuel — documentation technique partagée publiquement
- **Format** : PDF A4 vertical, 24-32 pages
- **Auteur affiché** : Kévin BROCARD, fondateur Buildy
- **Source rédactionnelle** : article FAQ Crisp publié + code du module audit BACS

---

## Préambule (2-3 pages)

### Page de couverture
- Titre + sous-titre + visuel sobre (rack GTB ou armoire électrique, photo réelle, filtre bleu navy `#1b2842`)
- Logo Buildy discret en bas

### « Ce que vous tenez entre les mains »
- C'est la documentation interne de la méthode utilisée pour structurer un audit BACS Buildy.
- 10 étapes, dans cet ordre, sans sauter.
- Le PDF reproduit la structure exacte du module logiciel utilisé en interne par les auditeurs.

### Le décret R175 en une page
- 6 articles : R175-1 (périmètre), R175-2 (assujettissement + seuils + dispense TRI), R175-3 (capacités de supervision : suivi, interopérabilité, arrêt manuel, mise à disposition), R175-4 (vérifications périodiques), R175-5 (formation), R175-6 (régulation thermique).
- Seuils 70 kW / 290 kW.
- Échéances 2025 / 2027.
- Distinction explicite avec l'inspection officielle R175-5-1 (réalisée par tiers indépendant).
- *Source : annexe A des PDF d'audit Buildy = texte intégral seedé dans `bacs-articles.js`.*

---

## Partie 1 — Préparer (2 chapitres, 4-5 pages)

### Chapitre 1 — Identification & cadrage R175-2 (2 p)
- Calcul de la puissance nominale cumulée chauffage + climatisation.
- Cas du raccordement à un réseau de chaleur urbain : on retient la puissance de la sous-station.
- Date du permis de construire et date de travaux générateur (déclencheurs R175-6).
- Statut d'assujettissement : immédiat / 2025 / 2027 / non assujetti.
- Dispense de calcul TRI assumée par Buildy (R175-2 : responsabilité du propriétaire).
- *Sources code : `afs.bacs_*` + `_compliance-summary.js:73-95`.*

### Chapitre 2 — Découper le bâtiment en zones fonctionnelles (2-3 p)
- Une zone = un nom + une nature + une surface (optionnelle) + des notes.
- 17 natures de zone seedées : Bureau partagé, Bureau privé, Open-space, Espace commercial, Salle de réunion, Atelier, Tableau électrique, Local technique, Salle de classe, Espace loisirs, Foyer, Couloir, Extérieur, Local compteurs, Espace partagé, Cellule logistique, Stock.
- La nature de zone déclenche automatiquement la matrice des systèmes attendus (R175-1 §6 + seed `bacs_requirements_by_zone_nature`).
- Photos par zone via la table `site_documents`.
- *Sources code : `zones` + `_labels.js:113-131` + `bacs_requirements_by_zone_nature`.*

---

## Partie 2 — Cartographier le bâtiment (3 chapitres, 8-10 pages)

### Chapitre 3 — Inventaire des systèmes techniques + équipements (3-4 p)
**→ Chapitre pilote rédigé en détail (cf. `03-inventaire-systemes-equipements.md`).**

- 7 catégories de systèmes possibles, 8 sources d'énergie, 11 protocoles de communication, 5 rôles d'équipement.
- R175-3 §3 (interopérabilité) et §4 (arrêt manuel + autonome) évalués au niveau de chaque équipement.
- Partage multi-zones d'un équipement (mig 99 — utile pour compteurs partagés).

### Chapitre 4 — Plan de comptage R175-3 §1 (3 p)
- Matrice usage × zone : 6 usages (Chauffage, Refroidissement, ECS, Production PV, Éclairage, Général) × N zones.
- Pour chaque ligne : compteur requis, présent, communicant, type (5 valeurs : Électrique, Électrique de production, Gaz, Eau, Thermique), protocole, intégré GTB, hors-service, filaire ou sans-fil, photos.
- Logique de génération d'actions : compteur requis absent = **bloquant**, présent non communicant = majeur.
- *Sources code : `bacs_audit_meters` + générateur d'actions.*

### Chapitre 5 — Régulation thermique R175-6 (2-3 p)
- Par zone : régulation automatique présente, type (4 valeurs : Par pièce, Par zone, Centrale uniquement, Aucune), type de générateur (6 valeurs : Gaz, Effet Joule, Pompe à chaleur, Appareil bois exempté, Réseau de chaleur, Autre), âge.
- Niveaux Production / Distribution / Émission (mig 54), avec équipement contrôleur lié.
- Position des capteurs, type de thermostat, présence de robinets thermostatiques.
- Date des travaux générateur déclenche l'applicabilité R175-6.
- *Sources code : `bacs_audit_thermal_regulation` + `_labels.js:83-97`.*

---

## Partie 3 — La GTB (1 chapitre, 4-5 pages)

### Chapitre 6 — Évaluer la GTB existante (4-5 p)
- Identité de la solution : nom, marque, localisation serveur, modèle, hors-service ou pas, protocoles supportés.
- 5 domaines pilotés : chauffage, refroidissement, ventilation, ECS, éclairage.
- **R175-3 §1** : suivi continu pas horaire, conservation 5 ans, format d'archivage, rétention vérifiée.
- **R175-3 §2** : détection des pertes d'efficacité, règles d'anomalies.
- **Mise à disposition des données** : au gestionnaire / aux exploitants, fréquence, format.
- **R175-4** : procédures de maintenance, périodicité, responsable.
- **R175-5** : exploitant formé, date, sujets, prestataire.
- 8 sujets de notes libres (mig 109) : analyse fonctionnelle, usages, équipements, compteurs, R175-3 capacités, R175-3 mise à dispo, R175-4, R175-5.
- *Sources code : `bacs_audit_bms` + `bacs_audit_gtb_observations` + `gtb_topics_catalog`.*

---

## Partie 4 — Documenter & justifier (2 chapitres, 2-3 pages)

### Chapitre 7 — Check-list documentaire (1-2 p)
- 10 items à collecter (catalogue `bacs_checklist_catalog`, mig 100) :
  1. Plans d'étages / niveaux
  2. Schémas électriques (TGBT, divisionnaires)
  3. Synoptique d'architecture GTB
  4. Plan d'adressage IP
  5. Analyse fonctionnelle GTB existante
  6. Coordonnées locataires / occupants
  7. Schémas hydrauliques / fluides
  8. Carnet d'entretien / contrats
  9. Accès locaux techniques (badges, codes)
  10. Photos générales du site (façades, toiture)
- Pour chaque : statut (en attente / disponible / non disponible), raison si non disponible, notes, fichiers rattachés.
- *Sources code : `bacs_checklist_catalog` + `bacs_audit_checklist`.*

### Chapitre 8 — Credentials & inspections R175-5-1 (1 p)
- Credentials techniques du site : URLs, identifiants, partage sécurisé.
- Inspections R175-5-1 (saisies, jamais réalisées par Buildy) : date, organisme, anomalies, recommandations, prochaine échéance, conservation 10 ans.
- **Distinction explicite** : Buildy ne réalise pas l'inspection R175-5-1 (faite par un tiers indépendant). L'audit Buildy n'a pas la même nature.
- *Sources code : `bacs_audit_inspections` + table credentials.*

---

## Partie 5 — Du diagnostic au rapport (2 chapitres, 4-5 pages)

### Chapitre 9 — Le plan d'action auto-généré (3 p)
**Logique exacte de génération depuis `bacs-audit-action-generator.js` :**

| Source | Condition | Sévérité | Article R175 |
|---|---|---|---|
| Équipement | protocole = absent / non communicant | Majeur | R175-3 §3 |
| Équipement | pas d'arrêt manuel | Majeur | R175-3 §4 |
| Équipement | pas de fonctionnement autonome | Majeur | R175-3 §4 |
| Équipement / compteur | liaison GTB cassée | Majeur | — |
| Compteur | requis mais absent | **Bloquant** | R175-3 §1 |
| Compteur | présent mais non communicant | Majeur | R175-3 §1 |
| GTB | absente ou non couvre R175-3 §1 | **Bloquant** | R175-3 §1 |
| GTB | non couvre R175-3 §2 | Majeur | R175-3 §2 |
| GTB | pas de procédures maintenance | Majeur | R175-4 |
| GTB | exploitant non formé | Mineur | R175-5 |
| Régulation | manquante quand R175-6 applicable | Selon contexte | R175-6 |
| Régulation | générateur bois exempté | (aucune action) | R175-6 |

- 3 sévérités : **Bloquant** / **Majeur** / **Mineur**.
- 5 statuts : Ouvert / Devisé / En cours / Fait / Décliné.
- Idempotence sur la clé `(source_table, source_id, source_subtype)`.
- Notes commerciales et solutions alternatives ajoutables sans casser la régénération.
- *Sources code : `bacs_audit_action_items` + `bacs-audit-action-generator.js:65-250`.*

### Chapitre 10 — Synthèse & livraison (2 p)
- **Tableau de bord R175** (8 lignes) calculé automatiquement :
  1. R175-2 — Assujettissement (info)
  2. R175-3 §1 — Suivi continu
  3. R175-3 §3 — Interopérabilité
  4. R175-3 §4 — Arrêt manuel + autonome
  5. R175-3 — Mise à disposition des données
  6. R175-4 — Vérifications périodiques
  7. R175-5 — Formation
  8. R175-6 — Régulation thermique (applicable ou N/A)
- **Verdict global** déduit des actions :
  - `bloquant > 0` → **Non conforme**
  - sinon `majeur > 0` → **Partiellement conforme**
  - sinon → **Conforme**
- Note de synthèse rédigée à la main ou pré-générée par Claude (lit l'intégralité de l'audit, y compris notes par sujet GTB).
- **4 annexes obligatoires** :
  - **A** — Texte intégral du décret R175 (R175-1 à R175-6)
  - **B** — Méthodologie Buildy (9 points d'hypothèses)
  - **C** — Justification de chaque préconisation (BACS-001, BACS-002…) avec article et source
  - **D** — Disclaimers légaux (7 clauses : non-substitution à l'inspection officielle, approche fonctionnelle non ISO 52120-1, distinction avec CEE BAT-TH-116, TRI = responsabilité propriétaire, etc.)
- *Sources code : `_compliance-summary.js`, `_export-data.js`, `bacs-audit-methodology.js`, `bacs-audit-disclaimers.js`.*

---

## Partie 6 — Pièges à éviter après l'audit (ajout 2026-05-12, 5-6 p)

### Chapitre 11 — Les pièges à éviter après l'audit
*Conseils post-livraison du rapport, validés par Kévin. Mots-clés SEO :* `intégrateur GTB`, *solution clé en main, hypervision.*

- **Piège 1** : ne consulter qu'un seul intégrateur GTB → recommander d'en consulter trois, comparer leurs devis action par action grâce aux identifiants BACS-XXX du plan.
- **Piège 2** : confondre fourniture de matériel et solution clé en main → exiger l'inclusion explicite des prestations annexes (électrique, plomberie, génie civil, reprise documentaire).
- **Piège 3** : sous-estimer l'expérience utilisateur du logiciel de supervision → 3 critères de sélection (simplicité, accès distant, ouverture des données + pérennité de l'éditeur).
- **Piège 4** : supervision isolée vs intégrée à une hypervision → pour un parc immobilier, choisir l'hypervision d'abord, les supervisions ensuite. Buildy Hyperveez mentionné comme option, pas en exclusivité.
- *Source : pas de code module, pur conseil métier validé par Kévin.*

---

## Conclusion (1-2 pages)

### « Récapitulatif de ce que vous venez de parcourir »
Liste sobre, uniquement chiffres remontés du module :

- 10 étapes de validation à mener dans l'ordre.
- 7 catégories de systèmes techniques à inventorier par zone.
- Pour chaque équipement : 8 sources d'énergie possibles, 11 protocoles de communication, 5 rôles dans la chaîne thermique.
- Une matrice de comptage à compléter pour 6 usages × N zones.
- 17 natures de zone fonctionnelle disponibles dans le module.
- 8 sujets GTB à documenter en notes libres.
- 10 documents à collecter sur site.
- Une logique de génération d'actions correctives (3 sévérités, 5 statuts, sources tracées).
- 8 lignes au tableau de bord R175.
- 4 annexes obligatoires dans le rapport.
- 10 ans de conservation légale.

> *Si vous gérez 1 ou 2 bâtiments et que vous avez le temps : faites-le. Vous avez maintenant la méthode.*
> *Si vous gérez plusieurs bâtiments ou que vous voulez aller vite : appelez-nous.*

### Pivot Buildy (1 page, design distinct)

> **« Vous préférez nous laisser faire ? »**
>
> [Paragraphe à rédiger par Kévin avec uniquement des faits qu'il valide.]
>
> [Bouton] *Je veux un devis* → ou QR code.

### 4ᵉ de couverture
- QR code Calendly direct
- Signature personnelle Kévin
- *« Une question sur ce manuel ? Écris-moi : [email — à confirmer]. »*

---

## Marqueurs `[À COMPLÉTER PAR KÉVIN]` — état final 2026-05-12

| Élément | Statut | Valeur retenue |
|---|---|---|
| Email de contact direct (4ᵉ de couverture + pivot) | ✓ Validé | `contact@buildy.fr` |
| URL Calendly / QR code | ✓ Supprimé | Remplacé par l'email + URL site |
| Paragraphe pivot Buildy | ✓ Validé | Tarif forfaitaire 4 000-5 000 € HT, tous types de bâtiments tertiaires, alignement strict R175, pas de promesse de délai |
| Photo de couverture | ✓ Validé — pas d'image | Composition typographique pure, fond navy uniforme, façon Stripe Atlas |
| Logo signature Kévin | ✓ Validé | Texte simple : « Kévin BROCARD — Fondateur, Buildy » |
| Date publication | ✓ Validé | Mai 2026 |
| Volume d'audits dans le sous-titre | ✓ Validé | Formulation vague : « sur tous nos chantiers » |
| URL landing page | ✓ Validé | `buildy.fr/audit-bacs` |
