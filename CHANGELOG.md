# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Le projet n'a pas de versions taggées formelles ; chaque entrée correspond à un lot fonctionnel ou un sprint d'améliorations cohérent.

## [Non publié] — Sprint Produit & Restitution

Sprint d'amélioration en cours. Plan complet dans [`docs/improvements-sprint.md`](docs/improvements-sprint.md). 10 lots planifiés, ~10-12 jours de travail.

### Refonte data-tables desktop audit BACS (v0.1.4 → v0.1.9) ✅

Refonte du rendu desktop des 4 listes principales d'un audit en **vrais data-tables alignés** avec entêtes triables, bordures fines, lignes alternées, hover, actions icon-only, drag-drop conservé.

- **CSS factorisé** [`frontend/src/assets/main.css`](frontend/src/assets/main.css) `@layer components` — classe `.data-table` partagée, fond gris des thead, indicateurs de tri ↑↓↕, pills de flags `.flag-pill` / `.flag-on` / `.flag-off`.
- **Composable [`useTableSort`](frontend/src/composables/useTableSort.js)** (asc → desc → off) + **[`DataTableSortHeader.vue`](frontend/src/components/DataTableSortHeader.vue)** — pattern unifié pour tous les tableaux.
- **Card 02 Zones** [`ZonesSection.vue`](frontend/src/components/audit/ZonesSection.vue) — 7 colonnes alignées, tri Nom + Surface, actions Dup/Suppr toujours visibles.
- **Card 03 Systèmes** [`SystemDevicesTable.vue`](frontend/src/components/SystemDevicesTable.vue) — colonnes Quantité, Puissance, **Âge** (déplacé depuis Card 05), Protocoles 1er+badge `+N`, actions Notes/Photo/Partage/Dup/Suppr icon-only, stepper desktop repliable.
- **Card 04 Compteurs** [`MetersSection.vue`](frontend/src/components/audit/MetersSection.vue) — 13 colonnes alignées dont 5 colonnes flags séparées (Requis / Présent / Communicant / Câblé / Hors service).
- **Card 05 Régulation thermique** [`ThermalSection.vue`](frontend/src/components/audit/ThermalSection.vue) — 12 colonnes alignées, **1 ligne par couple zone × usage** (plus de dépliage), ligne détail R175-6 toujours visible sous chaque couple, tri Zone + Usage + Type de régul. `Granularité` renommé en `Type de régul`.

**Migration 135** : `bacs_audit_system_devices.age_years` (déplacé depuis `bacs_audit_thermal_regulation.generator_age_years`). Drop `generator_type` (redondant avec `device.energy_source`).

### Régulation thermique R175-6 — 3 niveaux + exemption bois auto (v0.1.10) ✅

- **3 niveaux d'équipement par couple zone × usage** : Production / Distribution / Émission, avec un sélecteur d'équipement de régulation par niveau (TEXT libres `creatable`). Icône notes 📝 à côté du sélecteur de régulation, point bleu si la note existe (`<level>_notes_html`).
- **Exemption R175-6 II (générateurs bois)** : détection automatique via `device.energy_source = 'wood'` du générateur de production pointé. Checkbox « Exempté bois » pré-cochée et grisée. Le générateur d'actions correctives [`bacs-audit-action-generator.js`](backend-node/src/lib/bacs-audit-action-generator.js) skip l'action R175-6 II quand l'exemption est détectée.
- **En-têtes desktop lisibles** : libellés complets (Quantité, Puissance, Requis/Présent/Communicant/Câblé/Hors service, Type de régulation, Régulation auto, Régulation production/distribution/émission). Plus de troncatures cryptiques.

### Tooltips Buildy v-tooltip (v0.1.10 → v0.1.12) ✅

- **Délai 30 ms** (vs 120 ms) — perception quasi-instantanée, indispensable sur les data-tables denses où plusieurs icônes s'enchaînent (Notes / Photo / Partage / Dup / Suppr).
- **Nouvelle directive [`v-truncate-tooltip`](frontend/src/lib/tooltip-directive.js)** — affiche automatiquement le texte complet quand une cellule déborde (`scrollWidth > clientWidth`). Aucun argument requis, lit `textContent` au survol.
- **Tooltip sur SystemCategoryIcon** — l'icône seule ne portait pas de libellé, ajout du nom de catégorie en tooltip.
- **Migration des derniers `title=` HTML natifs vers `v-tooltip`** — exports PDF, bouton HS, BmsTopicNoteButton, régénération du plan.
- **Fix [`tooltip-directive.js`](frontend/src/lib/tooltip-directive.js) (v0.1.11+12)** : capture de `el` via closure dans le mount au lieu de lire `e.currentTarget` dans le setTimeout (la spec DOM résette `currentTarget` à null après le retour du handler, le tooltip ne s'affichait plus du tout sur certains navigateurs).
- **Fix shadowing `document`** dans [`ChecklistSection.vue`](frontend/src/components/audit/ChecklistSection.vue) — `const { document } = storeToRefs(audit)` masquait le DOM global, `document.addEventListener` ciblait la Ref Pinia. Forcé `window.document.addEventListener(...)`.
- **Bump SW v4 → v5** [`frontend/public/sw.js`](frontend/public/sw.js) — force purge des caches StaleWhileRevalidate qui pouvaient continuer à servir les anciens chunks après deploy.

### PWA tactile audit BACS (v0.1.0 → v0.1.3) ✅

- **Modale d'ajout de systèmes tactile** — taille auto, items ≥ 44 px, plus de troncature, stack vertical sur les listes (mémoire `feedback_pwa_all_touch.md`).
- **Sous-section « Communication » par device** — Protocoles puis Câblé regroupés desktop + PWA pour cohérence.
- **Sync desktop → PWA** : polling 5 s + listener `pageshow` à chaque navigation d'onglet — éditions desktop visibles côté PWA quasi-immédiatement.
- **KPI cliquables → entité ciblée** : taper un KPI (Zones / Systèmes / Compteurs / GTB) ouvre directement la fiche correspondante (et non la liste). Card de site dans les KPIs Docs.
- **Photos terrain par action** du plan de mise en conformité — `BacsPhotoButton` attaché aux items du plan.
- **Bouton Photos zones en haut** + bandeau « Nouvelle version disponible » desktop + PWA.

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

### Lots A2 + A3 + A4 — Brochure unifiée ✅

**Approche** : un même outil de composition pour 2 variantes (Brochure commerciale par client, Catalogue d'offres annuel type *Offres Buildy 2026*), distinguées par `afs.layout_template`.

**Backend (A2)** :
- Migration 66 : table `brochure_items` (liste plate par brochure) + `brochure_library_items` (catalogue partagé) + `afs.layout_template`
- Seed minimal de la bibliothèque (Qui est Buildy / Niveaux E/S/P / CGV 2026)
- Modules DB `brochureItems`, `brochureLibrary`
- Routes [`backend-node/src/routes/brochures.js`](backend-node/src/routes/brochures.js) :
  - `GET /api/brochures/library?kind=...`
  - `GET /api/brochures/:id/items`
  - `POST /api/brochures/:id/items` (pioche dans la bibliothèque ou crée custom)
  - `PATCH /api/brochures/items/:id` (override titre / contenu / position)
  - `DELETE /api/brochures/items/:id`
  - `PATCH /api/brochures/:id/layout` (variante commercial / catalogue)

**Frontend (A3)** :
- Vue [`frontend/src/views/BrochureDetailView.vue`](frontend/src/views/BrochureDetailView.vue) : layout 2 colonnes (catalogue gauche / composition centrale)
- Filtres catalogue : Tout / Présentations / Niveaux / Buildy / CGV
- Items déjà ajoutés visuellement marqués (✓ vert) dans le catalogue
- Composition : cards numérotées avec boutons ↑↓ (réordonner), édition dépliable Tiptap pour override titre + contenu
- Bouton « Section libre » pour items custom rédigés à la main
- Sélecteur de variante dans le header (commerciale / catalogue)
- Activation du bouton « Brochure » dans `AfsListView` (anciennement « Bientôt »)
- Route `/brochures/:id`

**Liaison cross-document (A4)** :
- Composant [`RelatedSiteDocsPanel.vue`](frontend/src/components/RelatedSiteDocsPanel.vue) : liste les autres documents du même site (AF + audits BACS/GTB + autres brochures), groupés par kind avec icônes et badges colorés
- Intégré dans `BrochureDetailView` (catalogue gauche, en bas)
- Réutilisable dans `BacsAuditDetailView` et `AfDetailView` ultérieurement

**Hors périmètre** (à itérer plus tard) :
- Drag-drop sortablejs (les boutons ↑↓ suffisent pour MVP)
- Export PDF brochure (templates HBS dédiés `brochure-commercial.hbs` et `brochure-catalog.hbs`) — base posée mais routes pas implémentées
- Reuse direct de sections AF dans une brochure (panneau "Reprendre depuis l'AF" dans le catalogue)

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
