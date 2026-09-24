# Contrôles des rapports PDF d'audit BACS

Une commande relance les contrôles de la revue du rapport (septembre 2026).
Elle attrape les défauts qu'une relecture à l'œil laisse passer : décomptes
incohérents, page de synthèse qui déborde, élément trop large qui fait réduire
tout le document, caractère absent des polices, sommaire décalé.

```bash
cd backend-node
npm run check:pdf -- 40,43,45,56,60,61 --fake-photos --tables
```

- `--fake-photos` : image de remplacement pour chaque photo absente. La base de
  dev vient de la prod **sans** les fichiers joints : sans cette option, les
  photos et vignettes ne sont pas rendues.
- `--tables` : rend et contrôle aussi les tableaux de synthèse A3.
- `--db=chemin` : base source (défaut : `DATABASE_PATH` du `.env`).
- `--out=dossier` : dossier de travail (défaut : dossier temporaire, gardé).

Code de sortie : `0` si tout est ✓, `1` au moindre écart, `2` si le contrôle
n'a pas pu tourner.

## Sécurité des données

- La base source n'est **jamais** modifiée : `run.js` la copie par la
  sauvegarde SQLite (cohérente même serveur de dev lancé) dans le dossier de
  travail, puis tout se passe sur la copie.
- Dans la copie, les chemins des anciens exports sont vidés : la purge
  automatique des exports supprimerait sinon les vrais fichiers PDF.
- Les fichiers joints sont copiés dans le dossier de travail (le cache
  d'images s'écrit à côté d'eux, jamais dans `data/`).
- `checks.js` refuse de tourner s'il n'est pas lancé par `run.js`.

## Contrôles (par audit)

| Contrôle | Règle |
|---|---|
| Décomptes cohérents | L'essentiel = cartes du plan = page de clôture = actions numérotées ; tableau de bord = actions rattachées à une exigence (réserves à part) |
| Compteurs | statut de l'onglet Compteurs = statut imprimé au chapitre 4 |
| L'essentiel sur une page | hauteur ≤ 263 mm |
| Tableau de bord sur une page | hauteur ≤ 263 mm, pastilles dans leur colonne |
| Débordement horizontal | aucun élément plus large que la page (A4 174 mm, A3 392 mm) |
| Rapport produit | chemin d'export de production (plan régénéré, mêmes options de rendu) |
| Caractères | tous couverts par les polices embarquées (poppler requis) |
| Sommaire | chaque entrée renvoie à la page réelle de son titre (poppler requis) |

poppler (`pdftotext`, `pdfinfo`) : `brew install poppler`. Sans lui, les deux
derniers contrôles sont ignorés avec un avertissement.

## Mesure facultative

`pdf-metrics.py rapport.pdf` (Python 3 + poppler) : remplissage de chaque
page, titres possiblement isolés en bas de page, répartition des corps de
texte. Informatif, sans verdict.
