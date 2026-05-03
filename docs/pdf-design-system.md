# Design system — PDF Buildy

Charte graphique commune à tous les exports PDF de buildy-docs (AF, audit BACS, brochure, tableau des offres, plan d'actions, fiches techniques…). Mise au point en **mai 2026** lors de l'itération sur le tableau des offres et le PDF AF, validée explicitement par le PO.

L'objectif : un rendu **premium, sobre, professionnel**, qui respecte des principes de neuromarketing tout en restant typographiquement classique.

---

## 1. Principe directeur

> **Moins de couleur = plus de premium.**
> Le contenu (✓ / — / €) raconte l'histoire. Les chromes (cadres, fonds, accents) ne servent qu'à **subtilement orienter** le regard, jamais à enfermer ou à crier.

Trois règles non-négociables :

1. **Pas de cadre coloré** autour d'un élément à mettre en avant. On utilise un **fond légèrement teinté** + une **élévation** subtile (padding ou ombre douce). Pattern Stripe / Notion / Linear.
2. **Pas de bandeau coloré** pour les niveaux de hiérarchie secondaires (catégories, sous-titres). Palette neutre gris/navy uniquement.
3. **Une seule couleur d'accent par PDF** (vert Buildy ou or selon le contexte). Le reste = navy + nuances de gris.

---

## 2. Palette

### Couleurs primaires (Buildy)

| Rôle | Hex | Usage |
|---|---|---|
| Navy primary | `#1b2842` | Titres H1/H2, header de table, CTA, fond cover |
| Vert accent | `#00cd92` | Markers (▸), accent positif modéré, traits décoratifs |
| Vert foncé | `#00b884` | Bordures sur le vert accent |

### Couleurs « médaille » (offre vedette)

| Rôle | Hex | Usage |
|---|---|---|
| Or clair | `#fde68a` | Début de gradient badge médaille |
| Or saturé | `#fbbf24` | Fin de gradient badge médaille |
| Bordure or | `#d97706` | Contour 0.4pt du badge |
| Crème colonne (zébra paire) | `#fff8e7` | Fond cellules colonne vedette |
| Crème colonne (zébra impaire) | `#fef3d4` | Alternance discrète |

> **Pourquoi or et pas vert ?** Le vert vif évoque le « bon » mais aussi le « publicitaire » (boutons d'achat, promos). L'or évoque la qualité, l'élite, la rareté — registre premium. Texte navy sur fond or = lisible et calme.

### Neutres (catégories, séparateurs)

| Rôle | Hex |
|---|---|
| Gris ardoise foncé (cat. d0) | `#1b2842` |
| Gris ardoise (cat. d1 texte) | `#475569` |
| Gris (cat. d2 texte) | `#64748b` |
| Gris pâle (cat. d3 texte) | `#94a3b8` |
| Fond cat. d0 | `#f8fafc` |
| Fond cat. d1 | `#fafbfc` |
| Bordure cat. | `#e2e8f0` |
| Marker cat. d0 | `#00cd92` (vert Buildy) |
| Marker cat. d1+ | `#cbd5e1` / `#e2e8f0` (gris) |

### Couleurs sémantiques (indicateurs)

| État | Fond | Texte | Bordure |
|---|---|---|---|
| ✓ Inclus (normal) | `#d1fae5` | `#065f46` | — |
| ✓ Inclus (colonne vedette) | `#6ee7b7` | `#064e3b` | — |
| — Non disponible | `transparent` | `#d1d5db` | — |
| € Option payante | `#fff7ed` | `#c2410c` | `#fed7aa` |
| € Option (col. vedette) | `#fffaf0` | `#c2410c` | `#fbbf24` |
| ★ Demandée MOA (vert) | `#d1fae5` | `#065f46` | `#6ee7b7` |
| Refusé MOA (rouge) | `#fee2e2` | `#991b1b` | `#fca5a5` |

---

## 3. Typographie

### Familles

- **Poppins** : titres (H1, H2, H3), badges « médaille », noms de niveau
- **Manrope** : corps de texte, headers de table, labels (uppercase + letter-spacing)
- **SFMono-Regular / Menlo** : références techniques, codes équipement

### Échelles (PDF, pt)

| Élément | Taille | Poids | Notes |
|---|---|---|---|
| H1 page de garde | 48pt | 700 | line-height 1, letter-spacing -0.02em |
| Titre de section (page-title) | 13pt | 700 | navy `#1b2842` |
| Nom de niveau (PREMIUM…) | 9pt | 700 | uppercase, letter-spacing 0.06em |
| Tagline niveau | 6pt | 400 | italique, opacity 0.85 |
| Header de table | 6.6pt | 700 | uppercase, letter-spacing 0.12em |
| Cellule de feature | 6.6pt | 400 | line-height 1.25 |
| Bandeau catégorie d0 | 6.8pt | 700 | uppercase 0.06em |
| Bandeau catégorie d1 | 6pt | 600 | uppercase 0.04em |
| Bandeau catégorie d2 | 5.6pt | 600 | uppercase 0.03em |
| Badge médaille | 5.4pt | 800 | uppercase 0.12em |
| Badge € Option | 5.4pt | 600 | normal |
| Footer admin | 7pt | 400 | gris `#9ca3af`, centré |

> **Règle** : pas de texte sous **5pt** (illisible à l'impression noir & blanc). Pas de texte au-dessus de **18pt** dans le corps (réservé aux pages de garde).

---

## 4. Patterns visuels clés

### 4.1 Mise en valeur sans cadre (« featured column »)

**Inspiration** : grilles tarifaires Stripe, Notion, Linear.
**Usage** : colonne d'offre vedette, ligne demandée MOA, fonctionnalité phare.

```css
/* PAS de border. PAS de box-shadow lourd. */
.element-vedette {
  background: #fff8e7;            /* crème-or chaud */
  /* zébra alternance */
}
.element-vedette:nth-child(odd) {
  background: #fef3d4;
}

/* Header monte un peu plus haut → "lift" visuel */
.header-vedette {
  padding-top: 1mm; /* +1mm de plus que les autres */
}

/* Saturation booster sur les ✓ pour appeler l'œil */
.element-vedette .avail-included {
  background: #6ee7b7;
  color: #064e3b;
}
```

❌ **À éviter** : `border: solid green`, `box-shadow: inset 0 1mm green`, `border-radius` sur les coins de la colonne (le tableau doit rester rectangulaire).

### 4.2 Badge « médaille » (signal d'élite)

**Usage** : « ★ LE PLUS CHOISI », « ★ DEMANDÉE MOA », sceau de qualité.

```css
.badge-medaille {
  display: inline-block;
  padding: 0.7mm 2.5mm;
  font-family: 'Manrope', sans-serif;
  font-size: 5.4pt;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  background: linear-gradient(135deg, #fde68a 0%, #fbbf24 100%);
  color: #1b2842;
  border-radius: 4mm;
  border: 0.4pt solid #d97706;
  box-shadow: 0 0.4mm 1mm rgba(180, 130, 0, 0.25);
  white-space: nowrap;
}
```

**Règles d'usage** :
- Le badge est **dans le flux** (`display: inline-block`), jamais en `position: absolute`. Sinon il est clippé au saut de page ou au bord de page.
- Quand il existe sur une colonne, **réserver un placeholder de même hauteur** dans les autres colonnes pour préserver l'alignement vertical.
- Texte court (max 18 caractères). « ★ Le plus choisi » va, « ★ Le choix le plus fréquent » non.

### 4.3 Bandes de catégorie sobres

```css
.category-row td {
  background: #f8fafc !important;
  color: #1b2842;
  font-family: 'Poppins', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-top: 0.4pt solid #e2e8f0;
  border-bottom: 0.4pt solid #e2e8f0;
}
.cat-marker { color: #00cd92; font-size: 7.5pt; margin-right: 1.2mm; }
```

❌ **À éviter** : `background: #eef2ff` (indigo), couleurs vives sur les bandeaux. La hiérarchie passe par la **profondeur de gris** et la **diminution de la taille de police**, pas par la couleur.

### 4.4 Indicateurs ✓ / — / €

```css
.avail {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 4mm;
  height: 4mm;
  border-radius: 50%;     /* picto rond pour ✓ */
  font-size: 7pt;
  font-weight: 700;
}
.avail-included    { background: #d1fae5; color: #065f46; }
.avail-unavailable { background: transparent; color: #d1d5db; }  /* loss aversion contrôlée : on ne crie pas le négatif */

.avail-text {  /* € Option : badge texte plutôt que picto */
  display: inline-block;
  padding: 0.3mm 1.4mm;
  background: #fff7ed;
  color: #c2410c;
  border: 0.4pt solid #fed7aa;
  border-radius: 0.6mm;
  font-size: 5.4pt;
  font-weight: 600;
}
```

**Pourquoi le « — » est si gris ?** Loss aversion contrôlée : si le « non disponible » crie autant que le « inclus », l'œil s'arrête sur le négatif et perçoit l'offre comme « pleine de manques ». On veut que les ✓ soient les **seuls** accents visuels positifs marquants.

### 4.5 CTA en pied de tableau

Bloc navy plein, centré, court. Pas de gradient ni d'image — juste du texte.

```css
.cta-block {
  margin: 3mm 0 2mm;
  padding: 3mm 5mm;
  background: #1b2842;
  color: white;
  border-radius: 1.5mm;
  text-align: center;
  page-break-inside: avoid;
}
```

---

## 5. Règles de mise en page A4

### Marges
- **Densité standard** : `14mm 12mm 14mm 12mm`
- **Densité élevée (1 page max)** : `10mm 10mm 10mm 10mm`
- **Cover full-bleed** : `0` (background couleur sur toute la page)

### Sauts de page
- `page-break-before: always` sur les annexes, sur les tableaux de synthèse (chapitre 12 AF), sur les sections H1 du corps.
- `page-break-inside: avoid` sur chaque `<tr>` du tableau, sur les blocs CTA.
- `display: table-header-group` sur `<thead>` pour répéter le header sur chaque page.

### Densité du tableau
Largeur des colonnes :
- Feature (label) : `auto`
- Niveau (E/S/P) : `22mm` (ou `18mm` en mode très dense)

Padding cellules :
- Header : `1.5mm 2mm 2.5mm`
- Feature : `0.6mm 2mm` (densité élevée) à `1.4mm 2mm` (standard)
- Indentation : `+5mm` par niveau de profondeur (5/8/11/14mm)

---

## 6. Polices embarquées (impératif Puddy)

Les PDF Puppeteer Buildy sont générés sans accès Internet sortant (firewall Jelastic) — **jamais** de Google Fonts.
Toutes les polices sont embarquées via `@fontsource` + injection en data-URL au build du CSS.

Voir `feedback_pdf_fonts_embed.md` dans la mémoire utilisateur.

---

## 7. Checklist avant de livrer un nouveau PDF

- [ ] Aucun `border: solid <couleur vive>` autour d'un élément à mettre en avant
- [ ] Mise en valeur uniquement par fond teinté + élévation
- [ ] Badge en `display: inline-block` (pas `position: absolute`)
- [ ] Placeholder de même hauteur dans les colonnes équivalentes
- [ ] Bandes de catégorie en gris/navy, pas en indigo
- [ ] ✓ saturé sur la colonne vedette
- [ ] « — » volontairement très gris (`#d1d5db`)
- [ ] Aucun texte sous 5pt
- [ ] `page-break-inside: avoid` sur les `<tr>` et les blocs CTA
- [ ] `@page { margin: ... }` cohérent avec la densité visée
- [ ] Polices embarquées (jamais de Google Fonts)
- [ ] Test visuel des sauts de page (le badge médaille n'est pas clippé)
- [ ] Test sur impression N&B : la hiérarchie reste lisible sans couleur

---

## 8. À faire — propagation aux autres PDF

État au **2026-05-03** :

| PDF | Statut |
|---|---|
| Tableau des offres (`offering-catalog.hbs` + `styles-offering-catalog.css`) | ✅ Référence |
| AF — corps + annexe offerings + synthèse systèmes (`styles-af.css`) | ✅ Aligné — bandeaux catégorie en gris/navy, mise en valeur sans cadre crème-or sur niveau cible, badge médaille, encart BACS en filet navy |
| AF — chapitre Engagement contractuel (`_contractual-summary.hbs`) | ✅ Aligné (vert pour offre recommandée car contexte sémantique distinct) |
| Audit BACS — rapport principal (`styles-bacs-audit.css`) | ✅ Aligné — synthèse + alt-solutions + callouts R175 + cartes méthodologie/justification en navy/gris |
| Audit BACS — checklist (`styles-bacs-audit-checklist.css`) | ✅ Aligné — H2/H3 + howto + tags + ref en navy/gris |
| Plan d'actions BACS commercial (`bacs-audit-commercial.hbs`) | 🟡 Hérite de `styles-bacs-audit.css` (à vérifier visuellement) |
| Liste de points A3 (`points-list.hbs`) | ❌ Non audité |
| Brochure (`brochure.hbs`) | ❌ Non audité |

**Prochaine étape** : audit visuel du Plan d'actions BACS commercial + alignement points-list A3 et brochure si pertinent.
