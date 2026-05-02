# Sprint d'amélioration buildy-docs — Produit & Restitution

Sprint en cours, ~10-12 jours estimés. Suivi détaillé de chaque lot. Mis à jour à chaque livraison.

## Vue d'ensemble

Deux axes :

- **Axe A — Produit** : Brochure unifiée (Brochure commerciale + Catalogue d'offres annuel, mêmes outils, 2 variantes de mise en page) + polisher AfDetailView.
- **Axe B — Restitution PDFs** : preview, charts, boilerplate admin.

**Hors périmètre** (gardé pour plus tard) : Terrain & dictée Plaud, Qualité/dette technique (tests frontend, E2E, Sentry), Collaboration multi-utilisateur (verrous, commentaires inline).

**Annulés en cours de sprint** :
- ~~B3 Vue commerciale exportable PDF~~ (besoin différent côté utilisateur)
- ~~B5 Signature électronique~~ (pas demandée)

## État des lots

| # | Lot | Effort | Statut |
|---|---|---|---|
| 0 | Documentation foundations | 0.5j | ✅ Livré |
| 1 | **B1** Preview HTML/PDF | 0.5j | ✅ Livré (BACS + AF + points-list ; synthesis hors périmètre) |
| 2 | ~~**B3** Vue commerciale exportable~~ | — | ❌ Annulé (besoin différent) |
| 3 | ~~**B5** Signature électronique~~ | — | ❌ Annulé |
| 4 | **A1** Polish AfDetailView | 2j | ✅ Livré (Pinia + indicateur vérification) |
| 5 | **B2** Charts dans les PDFs | 1j | ✅ Livré (BACS — donut + radar + bar) |
| 6 | **B4** Boilerplate admin | 1j | ✅ Livré |
| 7 | **A2** Brochure backend | 1.5j | ✅ Livré |
| 8 | **A3** Brochure UI | 2-3j | ✅ Livré (sans drag-drop ni export PDF) |
| 9 | **A4** Liaison cross-document | 1j | ✅ Livré (panneau RelatedSiteDocsPanel) |

---

## Lot 0 — Documentation foundations

**Statut** : 🔄 En cours

### Pourquoi

Le projet n'avait aucun README. Mauvais point de départ pour un onboarding et pour suivre les améliorations à venir.

### Livrables

- [x] [`README.md`](../README.md) racine — présentation, stack, install, dev, déploiement, structure, sources de vérité
- [x] [`CHANGELOG.md`](../CHANGELOG.md) — historique, à enrichir à chaque lot
- [x] [`docs/improvements-sprint.md`](improvements-sprint.md) — ce fichier

---

## Lot B1 — Preview HTML/PDF avant export

**Statut** : ⏳ À venir | **Effort estimé** : 0.5j

### Problème

Aujourd'hui, on clique « Générer le rapport », on attend Puppeteer (~3-5s), on télécharge, on ouvre le PDF dans un viewer externe et on découvre les manques (notes vides, photos manquantes, action sans préconisation). Aller-retour pénible. Rend l'itération sur les autres lots PDF beaucoup plus lente.

### Solution

Une preview HTML in-browser réutilisant les mêmes templates Handlebars + CSS embed, sans pipe Puppeteer.

### Périmètre

- Refactor `backend-node/src/routes/bacs-audit/exports.js` pour extraire `renderHtml()` réutilisable
- Idem `backend-node/src/routes/export.js` (AF / points-list / synthesis)
- Endpoints `GET /preview` qui renvoient le HTML brut avec CSS embed
- Composant `frontend/src/components/PdfPreviewModal.vue` (modal plein écran, iframe sandboxée, boutons « Télécharger PDF » et « Fermer »)
- Boutons « Aperçu » dans `BacsAuditDetailView` et `AfDetailView`

### Tests

- Cliquer Aperçu sur audit BACS → modal s'ouvre, contenu identique au PDF
- Cliquer Aperçu sur AF → idem
- Cliquer « Télécharger PDF » dans la modal → PDF généré comme avant

---

## Lot B3 — Vue commerciale exportable

**Statut** : ⏳ À venir | **Effort estimé** : 0.5j

### Problème

Le rapport BACS actuel est un livrable de conformité (lecture pour direction technique). Mais le commercial a besoin d'une vue alternative : plan de mise en conformité avec note commerciale, références produit, prix estimés, préconisations Buildy — sans le R175-blabla. Cette vue existe à l'écran (`BacsAuditActionItemsView`), pas en PDF.

### Périmètre

- Nouveau template `backend-node/templates/pdf/bacs-audit-commercial.hbs` :
  - Page de garde Buildy
  - Synthèse compteurs (N actions par sévérité, montant total estimé si renseigné)
  - Plan d'action : titre + description + sévérité + zone + note commerciale + préconisations Buildy (HTML rich text rédigé) + statut chiffrage
  - Annexe « Pourquoi se mettre en conformité ? » (texte commercial)
- Endpoint `POST /bacs-audit/:documentId/exports/commercial`
- Bouton « Vue commerciale → PDF » dans `BacsAuditActionItemsView`

---

## Lot B5 — Signature électronique

**Statut** : ⏳ À venir | **Effort estimé** : 0.5j

### Problème

Un audit livré sans signature client n'est pas validé légalement. Aujourd'hui zéro mécanisme.

### Approche retenue : light AcroForm

La mécanique `addFormFields: true` est déjà en place dans `bacs-audit-checklist.hbs`. On la copie pour ajouter une page d'approbation finale aux PDFs principaux (audit BACS, AF, vue commerciale).

### Périmètre

- Partial `backend-node/templates/pdf/_signature-page.hbs` (2 cadres signature : auditeur Buildy + client, date, nom, signature scannée)
- Mode `?mode=draft|final` sur les routes export → contrôle l'affichage de la page
- Mode `draft` : watermark « BROUILLON » diagonale, pas de signature
- Mode `final` : page signature à la fin
- Bouton UI : choix Brouillon / Final lors de la génération

### Hors périmètre

DocuSign / Yousign (signature légale forte) — gardé pour plus tard.

---

## Lot A1 — Polish AfDetailView

**Statut** : ⏳ À venir | **Effort estimé** : 2j

### Problème

`AfDetailView` est utilisé sur tous les chantiers DOE (livrable phare). Pourtant :

- Tout est en refs locales (46x dans la vue) sans Pinia → flicker, props drilling, DOM repaints lourds
- Pas de scroll-spy
- Pas de `StepValidateBadge` per-section (seulement statut global de l'AF)
- Layout 3 colonnes dès l'ouverture (dense, mauvais sur écrans laptop)
- Pas de `SectionHeader` unifié

L'auditeur BACS a été énormément aidé par ces patterns récents. L'AF doit en bénéficier aussi.

### Périmètre

- **Pinia store `useAfStore`** centralisant `af`, `sections`, `attachments`, `equipmentInstances`, `zones`, `serviceLevel`, `tree`, `tocFlat`, `loading`. Pattern copié de [`frontend/src/stores/audit.js`](../frontend/src/stores/audit.js).
- **Extraction sous-composants** dans `frontend/src/components/af/` :
  - `AfMetadataPanel.vue` (page de garde, statut, niveau service)
  - `AfEquipmentPanel.vue` (template équipement actif)
  - `AfPointsPanel.vue` (tableau points)
  - `AfZonesPanel.vue` (zones du site)
  - `AfAttachmentsPanel.vue` (captures)
  - `AfSectionTree.vue` et `AfSectionEditor.vue` existent déjà
- **`SectionHeader` partagé** : déplacement de `frontend/src/components/audit/SectionHeader.vue` vers `frontend/src/components/SectionHeader.vue` (devient générique)
- **CollapsibleSection** sur les panels droite + persistance localStorage
- **StepValidateBadge per-chapitre** :
  - Migration : `sections.validated_at TIMESTAMP NULL`, `sections.validated_by INTEGER NULL`
  - Endpoint `POST /api/afs/:afId/sections/:sectionId/validate` + invalidate
  - Badge cliquable sur chaque section éditable
- **Scroll-spy + bordure indigo** sur la section active (réutilise `SECTION_ID_TO_STEP` + `IntersectionObserver` de `BacsAuditDetailView`)
- **Layout 2 colonnes** : tree à gauche (sticky), éditeur central + panel latéral collapsible (au lieu de 3 colonnes égales)

### Risques

Refacto profond, risque de régression. Mitigation : commits séparés (un par sous-composant extrait, un pour le store, un pour le layout), revert facile.

---

## Lot B2 — Charts dans les PDFs

**Statut** : ⏳ À venir | **Effort estimé** : 1j

### Problème

Aujourd'hui les PDFs sont 100% texte/tableaux. Un audit BACS de 250 pages serait beaucoup plus impactant pour le client avec 3-4 visuels stratégiques sur la page de synthèse. **Le PDF est l'outil de vente.**

### Périmètre

- Dépendance : `chartjs-node-canvas` (rendu serveur, plus rapide que Puppeteer pour les charts)
- `backend-node/src/lib/pdf-charts.js` : helpers `renderDonut`, `renderRadar`, `renderBar` → sortie PNG inline data URL
- Helper Handlebars `{{chart "kind" data}}` → `<img src="data:image/png;base64,...">`
- **Charts BACS** :
  - Donut sévérité (page de garde) : N bloquantes / majeures / mineures
  - Radar conformité (synthèse) : 7 axes (R175-3 1°, 2°, 3°, 4° + R175-4 + R175-5 + R175-6) — score 0-100
  - Bar horizontal puissance/usage par zone : kW chauffage / clim / vent / ECS / éclairage
- **Charts AF** :
  - Matrice couverture niveau service (graphique au-dessus du tableau ch.12)

---

## Lot B4 — Boilerplate admin-configurable

**Statut** : ⏳ À venir | **Effort estimé** : 1j

### Problème

La méthodologie Buildy (Annexe B) et les disclaimers (Annexe D) sont hardcodés dans `backend-node/src/lib/bacs-audit-methodology.js` et `backend-node/src/lib/bacs-audit-disclaimers.js`. Pour mettre à jour, il faut éditer le code et redéployer. Si Buildy juridique veut affiner un disclaimer, lourd.

### Périmètre

- Migration : table `pdf_boilerplate(id, kind, version, title, body_html, applies_to, is_active, created_at, created_by)`
- `kind` ∈ `'methodology'`, `'disclaimers'`, `'cover_intro_bacs'`, `'cover_intro_af'`, `'commercial_appendix'`
- Migration des contenus actuels depuis les `.js` vers la DB (seed initial, version `1`)
- Page admin `frontend/src/views/admin/BoilerplateAdminView.vue` :
  - Liste des kinds
  - Éditeur Tiptap pour chaque
  - Versioning : sauvegarde → nouvelle version active, l'ancienne reste en DB
- Route admin protégée par permission (à définir — actuellement tout le monde est admin)
- Génération PDF : lit la version active de chaque kind, l'embed dans `exports.snapshot_json` (versioning historique : un PDF de 2024 régénéré plus tard retrouve sa méthodo de l'époque)

---

## Lot A2 — Brochure backend

**Statut** : ⏳ À venir | **Effort estimé** : 1.5j

### Problème

La brochure commerciale est listée comme « à venir » depuis le début. Doit assembler des extraits de la bibliothèque de fonctionnalités (déjà seedée pour les AF via `HYPERVEEZ_PAGES`).

**Approche unifiée** : on traite ensemble la Brochure commerciale (par client) ET le Catalogue d'offres annuel (générique, type `docs/offres-buildy-2026-ia.pdf`). Même outil de composition, mêmes items dans la bibliothèque, 2 variantes de mise en page PDF.

### Périmètre

- **Schema DB** :
  - `brochure_chapters(id, brochure_id, parent_id, position, title, body_html, created_at, updated_at)`
  - `brochure_items(id, brochure_id, chapter_id, item_kind, source_id, position, override_html, override_title, created_at)`
  - `item_kind` ∈ `'feature'`, `'offering_level'`, `'equipment_template'`, `'hyperveez_page'`, `'cgv'`, `'custom'`
  - Nouvelle colonne `documents.layout_template` ∈ `'commercial-brochure'` | `'offering-catalog'`
  - CHECK constraint statuts brochure : `'draft' | 'published'`
- **Routes** `backend-node/src/routes/brochures.js` :
  - `GET /api/brochures/:id` (full tree)
  - `POST /api/brochures/:id/chapters` + `PATCH` + `DELETE`
  - `POST /api/brochures/:id/items` (pick from library)
  - `PATCH /api/brochures/:id/items/:itemId` (override)
  - `DELETE /api/brochures/:id/items/:itemId`
  - `GET /api/brochures/library` (catalogue indexé par `item_kind`, filtrable par niveau de service E/S/P)
- **`backend-node/src/lib/brochure-library.js`** : catalogage + seed initial depuis :
  - `HYPERVEEZ_PAGES` (pages produit déjà seedées)
  - `equipment_templates` (fiches équipement)
  - 3 items de type `offering_level` : Essentiel, Smart, Premium (1 par niveau, à rédiger une fois)
  - `cgv` : extrait du PDF CGV Buildy 2026
- Tests Vitest

---

## Lot A3 — Brochure UI

**Statut** : ⏳ À venir | **Effort estimé** : 2-3j

### Périmètre

- `frontend/src/views/BrochureDetailView.vue` :
  - Layout 2 colonnes : catalogue gauche, composition centrale
  - Filtre catalogue par `item_kind`, niveau service [E]/[S]/[P], tags
  - Drag-drop catalogue → composition (`sortablejs` est déjà installé)
  - Réordonnement par drag des items
  - Override par item : titre + body_html via Tiptap
  - Sélecteur de variante en header : « Brochure commerciale » / « Catalogue d'offres » (modifie `documents.layout_template`)
- `frontend/src/views/BrochuresListView.vue` (séparée d'`AfsListView`)
- Liaison route : `/brochures/:id`
- Pinia store `useBrochureStore`
- Activation du bouton « Brochure » actuellement disabled dans `AfsListView`
- À la création : choix de la variante (commerciale par défaut). Une variante "Catalogue" pré-rempli avec un assemblage standard (Qui est Buildy → Niveaux E/S/P → Tableau comparatif → Conditions générales) pour gagner du temps.

### Templates PDF (au lot A3 ou en transition vers un mini-A3.5)

- `backend-node/templates/pdf/brochure-commercial.hbs` (page de garde "Proposition pour [Client]", structure libre)
- `backend-node/templates/pdf/brochure-catalog.hbs` (page de garde "Offres Buildy 2026", structure systématique avec tableau comparatif)
- Partials communs : `_item-feature.hbs`, `_item-equipment.hbs`, `_item-hyperveez.hbs`, `_item-offering-level.hbs`, `_item-cgv.hbs`
- Endpoint `POST /api/brochures/:id/exports` (lit `documents.layout_template` pour choisir le template)

---

## Lot A4 — Liaison cross-document AF / BACS / Brochure

**Statut** : ⏳ À venir | **Effort estimé** : 1j

### Périmètre

- **Site comme pivot** : page `frontend/src/views/SiteOverview.vue` listant tous les documents d'un site (AF + audits + brochures)
- **Reuse depuis l'AF dans une brochure** : si une AF validée existe pour le site, le catalogue brochure propose un bandeau « Reprendre des sections de l'AF #N » → injecte les sections `kind='equipment'` / `kind='synthesis'`
- **Annexe automatique brochure** : plan de mise en conformité audit BACS lié comme appendice commercial
- **Liaison inverse AF → audits** : badge « Audit BACS lié » cliquable sur `AfDetailView`

---

## Workflow de livraison par lot

Pour chaque lot :

1. Implémentation locale
2. Build + tests (`npm run build` frontend, `npm test` backend)
3. Mise à jour `CHANGELOG.md` + section concernée du README + ce fichier (statut → ✅ Livré)
4. Commit + push + déploiement Hosteur (`ssh 39448-1106@gate.rag-control.hosteur.com -p 3022 'cd /opt/buildy-docs && git pull && cd frontend && npm run build && cd .. && pm2 restart buildy-docs'`)
5. Test rapide en prod
6. Passage au lot suivant
