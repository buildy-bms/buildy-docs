# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Le projet n'a pas de versions taggées formelles ; chaque entrée correspond à un lot fonctionnel ou un sprint d'améliorations cohérent.

## [Non publié] — Sprint Produit & Restitution

Sprint d'amélioration en cours. Plan complet dans [`docs/improvements-sprint.md`](docs/improvements-sprint.md). 10 lots planifiés, ~10-12 jours de travail.

### Lot B1 — Aperçu HTML/PDF avant export ✅

**Audit BACS** :
- Nouveau composant frontend [`PdfPreviewModal.vue`](frontend/src/components/PdfPreviewModal.vue) — modal plein écran avec iframe sandboxée, bouton « Télécharger le PDF »
- Nouvelle fonction [`renderHtml()`](backend-node/src/lib/pdf.js) dans `lib/pdf.js` — rend un template Handlebars en HTML autonome (CSS embed + fonts data URL) sans Puppeteer
- Extraction de la construction des données dans [`backend-node/src/routes/bacs-audit/_export-data.js`](backend-node/src/routes/bacs-audit/_export-data.js) (réutilisée par export PDF + preview)
- Endpoint `GET /api/bacs-audit/:documentId/preview`
- Bouton « Aperçu » dans `BacsAuditDetailView`

**AF + Liste de points** :
- Nouveau module [`backend-node/src/routes/_export-builders.js`](backend-node/src/routes/_export-builders.js) — extraction de la construction de données (AF tree + tocFlat + serviceLevel ; points-list rows + categories + totals)
- Refactor de `routes/export.js` qui importe ces helpers (POST AF / POST points-list / GET points-list.xlsx fonctionnent comme avant)
- Endpoint `GET /api/afs/:afId/exports/af/preview?includeBacsAnnex=0|1`
- Endpoint `GET /api/afs/:afId/exports/points-list/preview`
- Bouton « Aperçu » ajouté dans la modale d'export du `CycleBandeau`

**Hors périmètre B1** : preview synthesis (Lot 32) — rendu très spécifique, peu utilisé hors export PDF final, gardé en édition future si besoin.

### Lot A1 — Polish AfDetailView ✅

- **Pinia store [`useAfStore`](frontend/src/stores/af.js)** — centralise `af`, `sections`, `selectedSection`, `selectedId`, `loading`, `requiredLevelKey` + getters dérivés (`liveSectionNumbering`, `orderedSections`, `breadcrumbTrail`, `sectionsCountByKind`, `verificationProgress`) + actions (`loadAf`, `selectSection`, `patchSection`, `createNewSection`, `removeSection`, `applySectionUpdate`). Pattern aligné sur `useAuditStore`.
- **`AfDetailView.vue` migré** — toutes les refs locales d'état déplacées dans le store, fonctions internes simplifiées en wrappers d'actions store. Rétrocompatible (sous-composants reçoivent les mêmes props/events).
- **Indicateur de progression de vérification** dans le header de la sidebar arbre — compteur "✓ N/M" (sections `fact_check_status='verified'` sur sections incluses dans l'export) + barre de progression émeraude. Utilise le mécanisme existant (bouton "Vérifiée" déjà présent dans `SectionEditor`).
- **Hors périmètre A1** :
  - Scroll-spy : non pertinent (1 section affichée à la fois, pas de longueur de page).
  - Layout 2 colonnes : déjà en place via `isCompact` + drawer < 1280px.
  - StepValidateBadge dédié : non nécessaire — la colonne `fact_check_status` existante couvre déjà le besoin "marquer une section comme finie".
  - Extraction `AfMetadataPanel/AfEquipmentPanel/...` : déjà fait depuis longtemps (7 sous-composants extraits dans `frontend/src/components/editor/`).

### Lot B2 — Charts dans les PDFs ✅ (1ère vague — audit BACS)

- Nouvelle dépendance `chartjs-node-canvas` + `chart.js` côté backend.
- Nouveau module [`backend-node/src/lib/pdf-charts.js`](backend-node/src/lib/pdf-charts.js) : helpers `donutSeverity`, `radarCompliance`, `barUsagePower`, `barAfCoverage`. Sortie PNG inline data URL.
- **PDF audit BACS** :
  - Donut sévérité (Bloquantes / Majeures / Mineures) dans la synthèse de conformité
  - Radar 7 axes R175 (R175-3 §1/§2/§3/§4 + R175-4 + R175-5 + R175-6) avec score 0-100 par axe (pénalisations : -40 par bloquante, -20 par majeure, -10 par mineure)
  - Bar horizontal puissance par usage GTB (chauffage / clim / vent / ECS / éclairage) dans le ch.1 Identification
- Charts calculés dans `_export-data.js` — réutilisés par export PDF + preview HTML (`<img src="data:image/png;base64,...">` fonctionne dans les 2 cas).

⚠️ Déploiement : nécessite `npm install` backend (canvas natif → cairo/pango sur le VPS).

À venir : charts AF (matrice couverture niveau service via `barAfCoverage`).

### Lot B4 — Boilerplate admin ✅

- **Migration 65** : table `pdf_boilerplate(id, kind, position, title, body_html, is_active, ...)` avec `kind ∈ 'methodology'|'disclaimer'`. Seed automatique depuis `lib/bacs-audit-methodology.js` et `lib/bacs-audit-disclaimers.js` à l'application de la migration (données existantes préservées).
- **Module DB** `pdfBoilerplate` (list / getById / create / update / remove) dans [`backend-node/src/database.js`](backend-node/src/database.js).
- **Routes admin** [`backend-node/src/routes/pdf-boilerplate.js`](backend-node/src/routes/pdf-boilerplate.js) : `GET/POST/PATCH/DELETE /api/pdf-boilerplate?kind=...`.
- **`_export-data.js`** lit la DB en priorité, fallback sur les fichiers `.js` statiques si la table est vide. Le PDF utilise donc toujours la version courante éditée par l'admin.
- **Vue admin** [`frontend/src/views/BoilerplateAdminView.vue`](frontend/src/views/BoilerplateAdminView.vue) avec :
  - 2 sections (Méthodologie B / Disclaimers D)
  - Édition Tiptap inline avec autosave debounced
  - Boutons : ↑↓ (réordonner), 👁 (désactiver), 🗑 (supprimer), + (ajouter)
- Lien dans la sidebar `Système → Boilerplate PDF`.

### À venir
- **Lot A2** — Brochure backend (DB + routes + lib + variante catalogue d'offres)
- **Lot A3** — Brochure UI (composition par drag, 2 variantes Brochure / Catalogue)
- **Lot A4** — Liaison cross-document AF / BACS / Brochure

### Lot 0 — Documentation foundations *(en cours)*

- README racine avec présentation, install, structure, déploiement, sources de vérité
- CHANGELOG.md (ce fichier)
- `docs/improvements-sprint.md` — suivi détaillé des 9 lots Produit/Restitution

---

## Antérieur

Avant la mise en place de ce changelog, les modifications étaient tracées uniquement dans l'historique git.

Quelques jalons récents notables (cf. `git log` pour l'exhaustif) :

- **Refonte UI fiche audit BACS** — 7 lots de polish (couleurs sémantiques, SectionHeader partagé, scroll-spy, accordéon, densité, responsive). Toutes les sous-sections audit alignées sur un pattern uniforme.
- **Migration Pinia BACS** — `useAuditStore` centralise l'état de la fiche audit, extraction en 11 sous-composants, `BacsAuditDetailView` réduit de 2732 → 1269 lignes.
- **Découpage `bacs-audit.js` backend** — fichier monstre splitté en sous-plugins (`transcripts`, `inspections`, `exports`, `lifecycle`, `_shared`).
- **R175-5-1 inspections** — table dédiée, action items générés automatiquement, fixture étendue.
- **Suppression du système de refs stables** (2.Z01, 3.Z01.04, ...) jugé bruyant.
- **Polish iteratif** — contraste hiérarchique cards, micro-labels, inputs 12px, placeholders, Plan d'action en cards 2 lignes.
- **Bug fixes systémiques** — drift Number/boolean sur PATCH thermal-regulation, R175Tooltip clippé par parents overflow (Teleport), InspectionsSection sans validation d'étape.
