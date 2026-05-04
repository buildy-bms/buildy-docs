# Design system — PDF Buildy

Référence centrale pour tous les exports PDF de buildy-docs : AF (analyse fonctionnelle), audit BACS, audit GTB classique, brochure commerciale, catalogue d'offres, fiches techniques (synthesis, points-list, checklist BACS), tableaux de synthèse paysage. Consolidée mai 2026 lors de l'itération sur l'audit BACS — applicable à tous les PDF Buildy nouveaux ou existants.

L'objectif : un rendu **premium, sobre, professionnel, illustré et actionnable** qui se distingue radicalement des rapports techniques bricolés que produisent nos concurrents. Carte de visite Buildy auprès des intégrateurs GTB, BET, exploitants et propriétaires.

---

## 1. Principe directeur

> **Moins de couleur = plus de premium.**
> Le contenu (verdicts, chiffres, statuts, ✓/✗) raconte l'histoire. Les chromes (cadres, fonds, accents) ne servent qu'à **subtilement orienter** le regard, jamais à enfermer ou à crier.

Trois règles non-négociables :

1. **Pas de cadre coloré** autour d'un élément à mettre en avant. On utilise un **fond légèrement teinté** + une **élévation** subtile (padding ou ombre douce). Pattern Stripe / Notion / Linear.
2. **Palette navy + vert Buildy + neutres**, plus utilitaires sévérité (rouge / orange / ambre) et conformité (vert / ambre / rouge) strictement nommés. **Jamais d'indigo, violet, cyan disséminés** — ils noient le sens.
3. **Une seule couleur d'accent par PDF** (vert Buildy par défaut, ou or pour le tableau des offres). Le reste = navy + nuances de gris.

Quatre publics à servir simultanément (audit BACS) :
- **Le propriétaire / gestionnaire** : verdict + plan en 3 minutes max.
- **L'intégrateur Buildy** : devis chiffrable sans appel à l'auditeur.
- **L'auditeur** : pièce à charge personnelle défendable 6 mois plus tard sous contrôle R175-5-1.
- **L'inspecteur officiel** : item ↔ verdict ↔ preuve ↔ R175 sans rien deviner.

---

## 2. Tokens — palette

### Couleurs primaires (Buildy)

| Rôle | Hex | Usage |
|---|---|---|
| Navy primary | `#1b2842` | Titres H1/H2, header de table, CTA, fond cover, accents structurels |
| Vert accent | `#00cd92` | Eyebrow uppercase (`L'ESSENTIEL`, `TABLEAU DE BORD`), traits décoratifs sous h1.chapter, version pill, accents bandeau verdict |

### Neutres (CSS vars exposées dans `:root`)

| Var | Hex | Usage |
|---|---|---|
| `--neutral-50` | `#f9fafb` | Fond très clair (zone-row, info-card, tile, panel-body subtle) |
| `--neutral-100` | `#f3f4f6` | Hover, fond pastilles "off", chips inline |
| `--neutral-200` | `#e5e7eb` | Bordures fines (cards, panels, separateurs) |
| `--neutral-300` | `#d1d5db` | Bordures moyennes |
| `--neutral-400` | `#9ca3af` | Verdict NA, texte placeholder |
| `--neutral-500` | `#6b7280` | Texte secondaire, eyebrow gris, libellés table |
| `--neutral-600` | `#4b5563` | Texte tertiaire (notes, métadonnées) |
| `--neutral-700` | `#374151` | Texte courant non titre (body) |
| `--neutral-800` | `#1f2937` | Texte renforcé |
| `--neutral-900` | `#111827` | Très rare — préférer navy |

### Utilitaires sévérité (plan d'action)

| Var | Hex | Usage |
|---|---|---|
| `--sev-blocking` | `#dc2626` | Action bloquante (BACS) / essentielle (classique) |
| `--sev-major` | `#ea580c` | Action majeure (BACS) / recommandée (classique) |
| `--sev-minor` | `#f59e0b` | Action mineure (BACS) / optimisation (classique) |

### Utilitaires verdict conformité

| Var | Hex | Usage |
|---|---|---|
| `--verdict-ok` | `#059669` | ✓ Conforme / Couverture étendue |
| `--verdict-warn` | `#d97706` | ⚠ Partiellement conforme / Couverture partielle |
| `--verdict-bad` | `#dc2626` | ✗ Non conforme / Couverture insuffisante |
| `--verdict-na` | `#9ca3af` | – Non applicable |

### Couleurs catégorie de système (alignées UI)

Source de vérité partagée entre PDF (`backend-node/src/lib/pdf.js:52-60` `CATEGORY_ICON`) et UI Vue (`frontend/src/components/SystemCategoryIcon.vue`).

| Catégorie | Icône FA | Couleur |
|---|---|---|
| heating | `fire` | `#dc2626` |
| cooling | `snowflake` | `#0891b2` |
| ventilation | `fan` | `#64748b` |
| dhw | `faucet` | `#0284c7` |
| lighting_indoor | `lightbulb` | `#f59e0b` |
| lighting_outdoor | `tower-cell` | `#f59e0b` |
| electricity_production | `solar-panel` | `#16a34a` |

### Couleurs « médaille » (offre vedette catalogue d'offres)

| Rôle | Hex | Usage |
|---|---|---|
| Or clair | `#fde68a` | Début de gradient badge médaille |
| Or saturé | `#fbbf24` | Fin de gradient badge médaille |
| Bordure or | `#d97706` | Contour 0.4pt du badge |
| Crème colonne | `#fff8e7` / `#fef3d4` | Fond cellules colonne vedette (zébrage) |

> **Pourquoi or et pas vert pour la médaille ?** Le vert vif évoque le « publicitaire » (boutons d'achat, promos). L'or évoque la qualité, l'élite, la rareté — registre premium.

---

## 3. Tokens — typographie

### Familles

- **Poppins** (titres, badges typographiques, accents) — geometric sans, modern. Poids 500 / 600 / 700.
- **Inter** (corps, labels, têtières table) — référence éditoriale Stripe, Linear, Vercel, GitHub, Notion. Poids 400 / 500 / 600 / 700.

Source de vérité partagée : `backend-node/src/lib/pdf.js` charge les WOFF2 via `@fontsource/*` (lignes 188-207). Côté frontend, `frontend/src/main.js` charge les mêmes familles. Manrope reste embed côté backend pour compatibilité descendante uniquement (à retirer après 30 jours sans régression — note dans `pdf.js`).

### Échelle de tailles avec contexte d'usage

| Élément | Taille | Famille | Poids | Contexte |
|---|---|---|---|---|
| `.cover-title` | 22pt | Poppins | 700 | Titre projet sur cover, grand mais sobre |
| `.essential-title` / `.dashboard-title` | 16pt | Poppins | 700 | Titre des pages spéciales (L'essentiel, tableau de bord) |
| `.cover-verdict-value` | 16pt | Poppins | 700 | Verdict "Non conforme" / "Couverture partielle" sur cover |
| `h1.chapter` | 13pt | Poppins | 700 | Titre de chapitre numéroté |
| `.essential-verdict-label` / `.section-title` (paysage) | 12-14pt | Poppins | 700 | Bandeau verdict L'essentiel, titre section paysage |
| `.cover-client` | 11pt | Inter | 500 | Nom du client sur cover |
| `h2` | 10-11pt | Poppins | 600 | Sous-titre dans un chapitre |
| `.r175-row-label` / `.tile-label` | 9-10pt | Poppins | 600 | Libellé de ligne dashboard, label tuile |
| `h3` | 8.5-10pt | Poppins | 600 | Sous-section, eyebrow encart |
| Corps body | 8.5-9.5pt | Inter | 400 | Texte courant (paragraphes, descriptions) |
| Corps tableau A4 | 7.5-8.5pt | Inter | 400 | Cellules de tableau format portrait |
| Corps tableau A3 paysage dense | 7.5-7.8pt | Inter | 400 | Tableaux de synthèse |
| Têtière table | 6.5-7pt | Inter | 600 uppercase letterspacing 0.05-0.08em | `<th>` |
| Eyebrow uppercase | 6.5-8pt | Inter ou Poppins | 600 letterspacing 0.18-0.28em | "L'ESSENTIEL", "TABLEAU DE BORD", "TABLEAU 1 / 4" |
| Réf monospace | 7-8pt | SFMono | 600-700 | E-001 / M-001 / BACS-001 / R175-3 1° |

### Line-height

- 1.15 sur titres (compact pour faire respirer la typo).
- 1.45 corps standard.
- 1.55 corps dense lecture éditoriale (pas de paragraphes longs ; 3-5 lignes max).
- 1.5 pour les notes terrain et descriptions d'action.

---

## 4. Tokens — espacement

### Marges page

| Format | Marges (top/right/bottom/left) | Cas d'usage |
|---|---|---|
| A4 portrait | `18mm 18mm 16mm 18mm` | Rapports principaux (AF, audit BACS/classique, brochure, catalogue, checklist BACS) |
| A4 paysage | `12mm 14mm 12mm 14mm` | Fiches techniques denses (synthesis AF, points-list) |
| A3 paysage | `12mm 14mm 12mm 14mm` | Tableaux de synthèse très denses (bacs-audit-tables) |

### Padding cards / panels

- Cards/panels standard : `4-6mm` horizontal × `3-5mm` vertical (selon densité).
- Tuiles compactes : `4mm 5mm`.
- Cellules tableau : `1.5-2mm` vertical × `2mm` horizontal en A3 paysage dense, `1.5-2mm × 2mm` en A4 portrait.

### Gap entre éléments

- `2mm` — chips inline, lignes d'une liste compacte (bms-list, kv-list).
- `4-6mm` — entre cards / blocs / panels au sein d'une section.
- `8mm` — entre sections de page (avant/après chapitre, entre tableau et legend).

---

## 5. Tokens — bords arrondis

| Token | Usage |
|---|---|
| `1mm` | Chips inline, code, badges discrets |
| `2mm` | Cards / panels / encarts (info-card, system-card, panel, callout, action-card, tile, gtb-summary) |
| `2.5mm` | Sections de page (cover-verdict, essential-verdict-banner, annex), grands blocs |
| `999px` | Pills allongées (m-pill, usage-pill, status-pill, sev-stat-count) |
| `50%` | Cercles (verdict-icon, step-num, sev-dot, bms-section-icon) |

**Tous les coins arrondis, jamais d'asymétrique** (pas de `border-radius: 0 2mm 2mm 0`) — décision PO mai 2026.

---

## 6. Vocabulaire de composants

Pour tout nouveau template PDF Buildy, **réutiliser les composants existants** plutôt que recréer. Référence par classe + fichier où ils sont définis :

| Composant | Classes CSS | Définition | Usage |
|---|---|---|---|
| **Panel** | `.panel` + `.panel-head` + `.panel-body` + `.panel-subtitle` + `.panel-body-flush` | `styles-bacs-audit.css` | Bloc de section avec head (titre + sous-titre) + body. Sert à grouper inventaires ou sub-sections (ex. capacités R175-3, équipements intégrés GTB). |
| **Info-card** | `.info-cards` + `.info-card` (+ variantes `info-card-wide` / `info-card-accent` / `info-card-value-strong` / `info-card-value-warn`) | `styles-bacs-audit.css` | Carte clé/valeur en grille. Identification site (ch.1), identité GTB (ch.6). |
| **System-card** | `.system-card` + `.system-card-{category}` (+ head / body / notes) | `styles-bacs-audit.css` | Carte par catégorie de système (chauffage rouge à gauche, etc.) avec icône + label + power + nb équipements + tableau devices imbriqué. |
| **m-pill** (compteur) | `.m-pill` + helpers `meterTypePill` / `meterUsagePill` | `pdf.js:73-99` (helpers) + `styles-bacs-audit.css` (CSS) | Pastilles compteurs alignées sur UI `MeterTypePill.vue` / `MeterUsagePill.vue`. Couleurs et icônes synchronisées strictement. |
| **usage-pill** (GTB) | `.usage-pill` + `.usage-pill-{category}` + variante `.usage-pill-off` | `styles-bacs-audit.css` | Pastilles "usages couverts par la GTB" — colorées si couvert, grisées + barré si non couvert. |
| **Headline** (action phare) | `.headline` + `.headline-num` + `.headline-meta` | `styles-bacs-audit.css` | Action phare sur la page L'essentiel : numéro BACS-XXX + titre + sévérité + R175 + zone. |
| **Stat** (chiffre clé) | `.stats-grid` + `.stat` + `.stat-num` + `.stat-label` + variantes `stat-blocking/major/minor` | `styles-bacs-audit.css` | Grosses pastilles colorées (5 Bloquantes / 6 Majeures / 4 Mineures) sur la page L'essentiel. |
| **Recap-tile** (récap chiffré) | `.recap-tiles` + `.tile` + `.tile-label` + `.tile-value` + `.tile-unit` + `.tile-of` + `.tile-sub` + `.sev-dot` | `styles-bacs-audit-tables.css` | 4 tuiles d'en-tête sur le PDF tableaux de synthèse paysage (puissance / équipements / compteurs / plan). |
| **GTB summary** | `.gtb-summary` + head + cells (`.gtb-cell-label` / `.gtb-cell-value` / `.gtb-checks` / `.check`) | `styles-bacs-audit-tables.css` | Bandeau compact GTB existante avec 5 colonnes (usages / R175-3 / R175-3 mise à dispo / R175-4 / R175-5). |
| **R175 dashboard row** | `.r175-row` + variantes verdict + `.r175-row-code` + `.r175-row-verdict` | `styles-bacs-audit.css` | Ligne du tableau de bord conformité R175 (8 lignes par exigence). |
| **Action card** (vertical) | `.action-card` + `.action-card-minor` + head/title/desc + alt-solutions | `styles-bacs-audit.css` | Carte action en plan d'action vertical (chapitre 7 BACS). |
| **Action row** (table) | `.action-row` + `.action-row-{severity}` + cellules `.col-ref/sev/r175/zone/title/source/status` | `styles-bacs-audit-tables.css` | Ligne table en plan d'action récapitulatif paysage (tableau 4). |
| **Callout** | `.callout` + `.callout-info/warn/reco/r175` + `.callout-icon` + `.callout-body` | `styles-bacs-audit.css` | Bloc d'avertissement/info avec icône emoji + texte. |
| **bms-list / bms-row** | `.bms-list` + `.bms-row` + `.bms-row-name/meta/icon/pwr/pills` + `.bms-section-head` | `styles-bacs-audit.css` | Listes plates compactes (équipements/compteurs intégrés vs à intégrer dans la GTB), avec section heads ✓/⚠ pour le gap. |
| **Photo grid + placeholder** | `.photo-grid` + `<img>` data URL | `styles-bacs-audit.css` + générateur placeholder `data/fixtures/photos/_generate.js` | Grille photos terrain. Placeholder skeleton gris hachuré pour le fixture (regenérable). |
| **Sévérité pill** | `.sev` + `.sev-blocking/major/minor` | `styles-bacs-audit.css` + `styles-bacs-audit-tables.css` | Badge sévérité d'action. Texte adapté par kind (Bloquante/Essentielle, Majeure/Recommandée, Mineure/Optimisation). |
| **Status pill commercial** | `.status-pill` + `.status-pill-{open/quoted/in_progress}` | `styles-bacs-audit-tables.css` | Statut commercial d'une action dans la table récap. |
| **TOC** | `.toc-row.lvl-1` + `.toc-link` + `.toc-num` + `.toc-title` + `.toc-dots` + `.toc-page` | `styles-bacs-audit.css` (charte AF/Synthèse) | Sommaire compact avec dots, pagination via `populateToc` dans `pdf.js`. |
| **Cover** | `.cover` + `.cover-top` + `.cover-main` + `.cover-verdict` (+ variantes) + `.cover-footer` | `styles-bacs-audit.css` | Page de garde sobre, fond navy full-bleed, trait vert vertical à gauche, verdict bandeau, footer 3 colonnes. |

---

## 7. Patterns de layout — pages spéciales

### Cover (page 1)

Structure 3 niveaux : header (logo + eyebrow uppercase) + main (titre projet + client + adresse) + verdict bandeau (BACS = État de conformité, classique = Couverture GTB) + footer 3 colonnes (date / auditeur / version pill verte). Fond navy full-bleed. Trait vert vertical à gauche.

### Page « L'essentiel » (page 2)

Synthèse en 1 page :
1. Eyebrow vert "L'essentiel" + titre 16pt.
2. Bandeau verdict colorié (vert/orange/rouge) avec icône ronde + label + détail explicatif.
3. Grille 2 colonnes :
   - **BACS** : Calcul d'assujettissement R175-2 (3 étapes numérotées) + 3 pastilles chiffres.
   - **Classique** : Couverture GTB (3 étapes) + 3 pastilles préconisations.
4. 3 actions phares (BACS-001/002/003) avec sévérité + R175 + zone.

### Sommaire (page 3)

Compact, charte AF/Synthèse. Une ligne par chapitre numéroté : numéro mono + titre Poppins + dots pointillés discrets + page mono. Cliquable dans le PDF (wrap par `populateToc` dans `pdf.js`).

### Tableau de bord conformité R175 (page 4, BACS uniquement)

Une page synoptique : 8 lignes pour chaque exigence du décret (R175-2 / R175-3 1° / R175-3 3° / R175-3 4° / R175-3 D.A. / R175-4 / R175-5 / R175-6). Chaque ligne : code en pastille navy + libellé + résumé + verdict pastillé + nombre d'actions associées. Bordure gauche colorée par verdict.

### Opener de chapitre

`h1.chapter` avec icône FA `categoryIcon` + numéro + libellé. Trait court vert Buildy 14mm × 1mm sous le titre. Page break avant.

### Annexes

**Pas de wrapper card global** (décision PO mai 2026 — trop lourd). Les sous-éléments (`.article-card`, `.method-card`, `.justif-card`, `.callout`, `.disclaimer-list`) portent leur propre visuel. Page break avant chaque annexe.

---

## 8. Formats de page par type de doc

| Format | Type de doc | Templates |
|---|---|---|
| **A4 portrait** | Rapports principaux (lecture séquentielle, archivage, PDF de référence) | `af.hbs`, `bacs-audit.hbs`, `bacs-audit-checklist.hbs`, `brochure.hbs`, `offering-catalog.hbs` |
| **A4 paysage** | Fiches techniques denses (lecture rapide, beaucoup de colonnes) | `synthesis.hbs`, `points-list.hbs` |
| **A3 paysage** | Tableaux de synthèse très denses (devis, scannabilité maximale) | `bacs-audit-tables.hbs` |

Cover full-bleed avec `@page :first { background: #1b2842 }` (double défense — ne pas retirer, c'est le filet de secours quand Chromium dérape sur le sub-pixel).

---

## 9. Helpers Handlebars disponibles

Définis dans `backend-node/src/lib/pdf.js`. À utiliser systématiquement plutôt que de coder un SVG inline.

| Helper | Usage | Exemple |
|---|---|---|
| `{{{faIcon "name" "color" "size"}}}` | Icône FontAwesome arbitraire (pro-solid ou free-solid) | `{{{faIcon "building" "#1b2842" "16"}}}` |
| `{{{categoryIcon "heating" "16"}}}` | Icône catégorie système avec couleur baked (heating rouge, cooling cyan, etc.) | `{{{categoryIcon system_category "12"}}}` |
| `{{{meterTypePill type}}}` | Pastille type compteur avec icône + libellé + couleur (alignée UI MeterTypePill) | `{{{meterTypePill "electric"}}}` |
| `{{{meterUsagePill usage}}}` | Pastille usage compteur (chauffage rouge, ECS bleu, PV vert, etc.) | `{{{meterUsagePill "heating"}}}` |
| `{{eq a b}}` | Égalité stricte | `{{#if (eq severity "blocking")}}…{{/if}}` |
| `{{or a b ...}}` / `{{and a b ...}}` | Composition logique | `{{#if (or notes_html photos.length)}}…{{/if}}` |
| `{{boolLabel v}}` | 1/true → "Oui", 0/false → "Non", null → "—" | `{{boolLabel meets_r175_3_p1}}` |

---

## 10. Atelier de design (dev)

Outil indispensable pour itérer sur le design des PDF audit BACS et classique sans cycle "créer audit → exporter Puppeteer ~30s".

### URLs preview (dev only — 404 en `NODE_ENV=production` sans `DEV_BYPASS_AUTH=1`)

| URL | Format | Contenu |
|---|---|---|
| `https://localhost:3100/api/bacs-audit/__preview-fixture` | HTML | Audit BACS principal (33 pages A4) |
| `https://localhost:3100/api/bacs-audit/__preview-fixture/pdf` | PDF | Idem en PDF généré Puppeteer |
| `https://localhost:3100/api/bacs-audit/__preview-fixture/tables` | HTML | Tableaux de synthèse BACS (5 pages A3 paysage) |
| `https://localhost:3100/api/bacs-audit/__preview-fixture/tables/pdf` | PDF | Idem en PDF |
| `https://localhost:3100/api/bacs-audit/__preview-fixture-classique` | HTML | Audit GTB classique (≈23 pages A4) |
| `https://localhost:3100/api/bacs-audit/__preview-fixture-classique/pdf` | PDF | Idem en PDF |
| `https://localhost:3100/api/bacs-audit/__preview-fixture-classique/tables` | HTML | Tableaux de synthèse classique (5 pages A3 paysage) |
| `https://localhost:3100/api/bacs-audit/__preview-fixture-classique/tables/pdf` | PDF | Idem en PDF |

### Hot reload

Éditer un `.css` ou `.hbs` dans `backend-node/templates/pdf/` → refresh navigateur — **pas de `pm2 restart`** (flag `fresh: true` propagé dans `loadTemplate()` / `renderHtml()` / `renderPdf()` pour les routes preview, cf. `pdf.js:124-138`).

### Bandeau dev

Affiché en haut à droite de la preview HTML (caché en `@media print`) :
- `Reload` / `Print` (preview impression A4/A3)
- Groupe **BACS** (vert) : `HTML` / `PDF` / `Tab. HTML` / `Tab. PDF`
- Groupe **Classique** (orange) : `HTML` / `PDF` / `Tab. HTML` / `Tab. PDF`
- Timestamp de la dernière requête

### Fixture Atlas Sud

Dataset partagé entre BACS et classique — `backend-node/src/routes/bacs-audit/_preview-fixture.js`. Profil : Plateforme Logistique Atlas Sud à Saint-Quentin-Fallavier, 45 000 m² bâtis, GTB Schneider EcoStruxure partielle, 14 équipements (dont DRV Daikin → CoolMaster Pro et aérothermes Reznor), 8 compteurs, 4 régulations thermiques, 15 actions correctives.

Toggle BACS/classique via `buildFixturePreviewData({ kind: 'bacs_audit' | 'site_audit' })`. Photos placeholder skeleton dans `data/fixtures/photos/`, regénérables via `node data/fixtures/photos/_generate.js`.

---

## 11. Cohérence cross-templates

### Templates de référence

- **`bacs-audit.css`** — référence A4 portrait éditorial. Cover sobre, page L'essentiel, dashboard, opener chapitre, annexes.
- **`bacs-audit-tables.css`** — référence A3 paysage dense. Récap chiffré, GTB summary, tableaux multi-colonnes nowrap, banderoles zone par groupe.

Tout nouveau template PDF Buildy doit s'aligner sur l'une de ces deux références selon son usage.

### Tokens partagés

Tous les templates exposent les mêmes tokens dans `:root` (palette, typo, espacements, bords arrondis). Si un nouveau token est nécessaire, l'ajouter dans la liste de cette doc et l'exposer dans le `:root` du fichier CSS concerné.

### Helpers partagés

`pdf.js` registers des helpers Handlebars utilisables dans **tous** les templates. Avant d'inliner un SVG ou de redéfinir un comportement, vérifier qu'un helper n'existe pas déjà.

### Sources de vérité cross-app

| Donnée | Source | À synchroniser dans |
|---|---|---|
| Couleurs catégorie système | `pdf.js:52-60` `CATEGORY_ICON` | `frontend/src/components/SystemCategoryIcon.vue` |
| Pastilles type compteur | `pdf.js` `METER_TYPE_PILL` | `frontend/src/components/MeterTypePill.vue` |
| Pastilles usage compteur | `pdf.js` `METER_USAGE_PILL` | `frontend/src/components/MeterUsagePill.vue` |
| Labels enums BACS | `routes/bacs-audit/_labels.js` | `routes/bacs-audit/_shared.js` (DB enums) + UI Vue |
| Polices | `pdf.js` `FONT_FILES` (Poppins + Inter) | `frontend/src/main.js` (mêmes poids) + `frontend/src/assets/main.css` (`--font-sans` Poppins / `--font-body` Inter) |

---

## 12. Conventions de code

- **Ne jamais réintroduire indigo / violet / cyan** disséminés dans un nouveau template. Les couleurs catégorie restent (héritées du métier), mais les accents généraux = navy + vert Buildy uniquement.
- **Toujours réutiliser les helpers existants** plutôt que coder un SVG ou une logique inline.
- **Pour tout nouveau composant PDF**, vérifier d'abord s'il existe déjà côté UI Vue (`MeterTypePill`, `SystemCategoryIcon`, `R175Tooltip`, etc.) et porter les mêmes couleurs/icônes/libellés.
- **Pas de `border-radius` asymétrique** — toujours les 4 coins.
- **Pas de `box-shadow` lourd** dans le PDF — préférer `border` 0.4pt + `background` teinté pastel.
- **Toujours `white-space: nowrap` par défaut sur les `<td>`** des tableaux denses (paysage A3) avec `overflow: hidden; text-overflow: ellipsis;` ; ouvrir `white-space: normal` ponctuellement sur la colonne notes.
- **Refactor préventif** : toute valeur magique répétée 3 fois doit devenir un token dans `:root` ou un helper.
- **Migration Manrope → Inter mai 2026** : Manrope reste embed dans `pdf.js` 30 jours pour compatibilité descendante. Après cette période, retirer les 4 lignes `Manrope` du `FONT_FILES` si aucune régression.

---

## 13. Maintenance de cette doc

Ce fichier est la **référence vivante**. Tout ajout d'un nouveau composant PDF Buildy doit s'accompagner d'un ajout de ligne dans la section 6 (Vocabulaire de composants) et, le cas échéant, dans les sections 2/3/4/5 (tokens). Toute modification d'un token global doit être répercutée dans le `:root` des CSS concernés ET dans cette doc.

Cas d'école : si Buildy livre un jour un nouveau type de PDF (ex. rapport énergétique annuel), l'auteur lit cette doc, choisit un format de page (section 8), réutilise les tokens (sections 2-5) et les composants (section 6), s'aligne sur l'un des templates de référence (section 11). Le nouveau PDF s'intègre visuellement dans le portfolio Buildy sans qu'on ait à inventer.
