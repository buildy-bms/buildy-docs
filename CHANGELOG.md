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

### À venir

- **Lot A1** — Polish AfDetailView (Pinia + sous-composants + scroll-spy + step validate)
- **Lot B2** — Charts dans les PDFs
- **Lot B4** — Boilerplate admin (méthodologie + disclaimers en DB)
- **Lot A2** — Brochure backend (DB + routes + lib + variante catalogue d'offres)
- **Lot A3** — Brochure UI (composition par drag, 2 variantes Brochure / Catalogue)
- **Lot A4** — Liaison cross-document AF / BACS / Brochure
- **Lot B5** — Signature électronique (page d'approbation AcroForm)
- **Lot A1** — Polish AfDetailView (Pinia + sous-composants + scroll-spy + step validate)
- **Lot B2** — Charts dans les PDFs (donut sévérité + radar conformité + bar puissance)
- **Lot B4** — Boilerplate admin-configurable (méthodologie + disclaimers en DB)
- **Lot A2** — Brochure backend (DB + routes + lib + seed)
- **Lot A3** — Brochure UI (composition par drag)
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
