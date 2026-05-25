# Procédure — Corriger les débordements de page (méthode-audit-bacs.html)

À appliquer à chaque mise à jour de contenu du livre blanc.

## 1. Détecter les pages qui dépassent A4 (297 mm)

Le HTML embarque un détecteur automatique en bas du document (`<script>` final).
Au chargement, il :

- Mesure le `scrollHeight` de chaque `<section class="page">`
- Si `scrollHeight > 1122 px` (= 297 mm @ 96 dpi), il :
  - Entoure la page d'un cadre rouge `4px solid #dc2626`
  - Affiche un badge en haut à droite : « ⚠ Page N — déborde de Xmm »

Recharger après chaque édition. Les pages problématiques apparaissent immédiatement.

## 2. Diagnostiquer le point de coupure

Pour une page qui déborde, identifier le bloc qui pousse au-delà :

- H1/H2 de section
- Callout (`.callout`, `.callout.warn`, `.callout.tip`, `.callout.r175`)
- Liste longue (`<ul>` / `<ol>`)
- Bloc d'icônes (`icon-chip`)
- Quote-pull (`.quote-pull`)

Règle empirique : si la page dépasse de plus de 20 mm, il faut **scinder** ;
en dessous de 20 mm, on peut **compresser** (raccourcir un paragraphe, fusionner deux listes).

## 3. Scinder une page

Insérer un saut de page **avant** un titre H2, un callout ou une liste auto-suffisante.

Patron à coller (remplacer `N` par le numéro de page et `Chapitre X / 11 — …`
par le bandeau en cours) :

```html
  <div class="page-foot"><span class="chap">buildy.fr · contact@buildy.fr</span><span class="num">N</span></div>
</section>

<section class="page">
  <div class="page-header"><span class="head-chap">Chapitre X / 11 — …</span><img src="assets/logo-mark.png" class="head-mark" alt=""></div>

  <!-- contenu déplacé sur la nouvelle page -->
```

Points de coupure préférentiels :

- Avant un H2 majeur (« Pourquoi cette étape… », « Piège n°N… », « Ce que ce chapitre vous apporte »)
- Avant un callout volumineux (R175, warn, tip)
- Avant la liste de synthèse de fin de chapitre

À éviter :

- Couper un callout au milieu (utiliser `break-inside: avoid` — déjà en place)
- Laisser un H2 orphelin en bas de page

## 4. Compresser sans scinder (< 20 mm de débordement)

Options dans l'ordre de préférence :

1. Raccourcir les phrases redondantes (les introductions sont souvent trop longues)
2. Fusionner deux listes contiguës
3. Supprimer une liste de 11 items pour la condenser en 8
4. Retirer un callout secondaire si l'info figure dans le corps du texte
5. En dernier recours, réduire l'espacement vertical d'un bloc (`margin`)

## 5. Renumérotation

La numérotation des pieds de page (`<span class="num">N</span>`) est **manuelle**.
Après ajout/suppression de page, ne pas oublier de réaligner :

- Soit en renumérotant toute la séquence à partir du point d'insertion
- Soit en laissant la numérotation telle quelle si l'ordre logique reste lisible (chapitre/section)

## 6. Encadrés : marges de référence

```css
.callout, .quote-pull {
  padding: 5mm 12mm;
  margin: 10px 0;
  max-width: 170mm;
  break-inside: avoid;
}
```

Ne jamais revenir à des padding > 5 mm vertical sous peine de provoquer
des débordements en cascade.

## 7. Tolérance

Une page à `+1 à +3 mm` de débordement est dans la tolérance de rendu
navigateur/imprimante — pas d'action requise. Le détecteur ne flagge
qu'au-delà de 2 mm pour éviter le bruit.

## 8. Générer le PDF vectoriel

Deux chemins, au choix :

- **Rapide (navigateur)** : ouvrir le HTML → bouton vert « Enregistrer en PDF »
  en haut à droite → boîte d'impression du navigateur → Destination
  « Enregistrer au format PDF ».
- **Reproductible (CLI)** : `node build-pdf.mjs` dans ce dossier. Le script
  lance un Chromium headless via Puppeteer (binaire récupéré depuis
  `buildy-docs/backend-node/`), exécute un pre-flight overflow check
  (mêmes seuils que le détecteur visuel) puis produit
  `Methode-audit-BACS-Buildy.pdf` à côté du HTML. Le script échoue avec
  la liste des pages problématiques si une `.page` déborde — pas de PDF
  dégradé silencieux.

Le PDF généré est vectoriel : texte sélectionnable et recherchable,
hyperliens actifs (mailto:, https://), polices Poppins + Manrope nettes,
taille ~2-5 Mo (vs ~30-50 Mo pour l'ancien export PNG).

### Fidélité écran ↔ PDF

Depuis la restructuration de la pagination (`.page { height:297mm; overflow:hidden }`
+ `@page { margin:0 }`), le rendu écran utilise exactement les mêmes dimensions
que le rendu PDF (174mm de large × 247mm de haut de contenu utile). Donc :
si une page tient sur écran sans cadre rouge du détecteur, elle tient en PDF.
`overflow:hidden` empêche physiquement tout chevauchement avec la page suivante.
