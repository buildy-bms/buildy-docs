# Paged.js 0.4.3 (copie embarquée)

`paged.polyfill.min.js` : fichier `dist/paged.polyfill.min.js` du paquet npm `pagedjs@0.4.3`
(licence MIT, `LICENSE.md`). Copié tel quel, sans dépendance npm (2026-10-15).

Utilisé par `src/lib/pdf.js` (`preparePagedPage`, `renderPagedHtmlPdf`) pour paginer le rapport
d'audit BACS : en-tête et pied de page en « margin boxes » `@page`, numéros de page des renvois et
du sommaire (`target-counter`), pages sombres à fond perdu (page nommée `full`).

Pièges connus :
- Paged.js avance par `requestAnimationFrame` / `requestIdleCallback`, suspendus par Chromium dans
  un onglet en arrière-plan : `preparePagedPage` les remplace par une file de messages avant de
  charger ce fichier (sinon blocage jusqu'au délai maximal quand deux rendus se chevauchent).
- Pas de sélecteurs de voisinage (`a + b`, `:last-of-type + …`) dans le CSS paginé : Paged.js les
  ignore ou plante (« item doesn't belong to list »). Écrire le séparateur dans le HTML.
- `break-after: avoid` n'est pas respecté : garder un titre avec la suite en les enveloppant dans
  un bloc `break-inside: avoid` (classe `.keep` du rapport).
