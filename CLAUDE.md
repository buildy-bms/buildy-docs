# CLAUDE.md — analyse-fonctionnelle

## Projet
App web Buildy de redaction d'**Analyses Fonctionnelles GTB** (livrables DOE) et de **listes de points contractuelles** (PDF A3 portrait).

Cible : equipe Buildy en interne. Cycle de vie d'une AF : `setup → chantier (vivant) → livree → revision`, avec inspections BACS periodiques (R175-5-1).

Plan complet : `~/.claude/plans/dans-le-dosser-analyse-fonctionnelle-warm-locket.md` (versionne hors repo).

## Stack (alignee BT/FM)
- **Backend** : Node.js 20+ / Fastify 5 / better-sqlite3 (WAL) / Pino / @fastify/jwt + cookie
- **Frontend** : Vue 3.5 / Vite 7 / Tailwind 4 / Vue Router 4 / Pinia / Axios / Heroicons
- **Auth** : PocketID OIDC (cookie httpOnly JWT) — pas de fallback local. Mode dev = `DEV_BYPASS_AUTH=1`
- **PDF** : Puppeteer + Handlebars (Lot 5+7 — A4 AF + A3 liste de points)
- **Editeur** : Tiptap 2 + extensions collaboration/image/table (Lot 3+11)
- **IA** : Claude SDK pour assistant redaction (Lot 12)

## Dev rapide
```bash
cd analyse-fonctionnelle
./dev.sh                       # backend PM2 :3100 + frontend Vite :5173 + DEV_BYPASS_AUTH=1
pm2 logs buildy-af             # suivre les logs backend
pm2 restart buildy-af          # restart manuel (PM2 watch est actif sur backend-node/src)
pm2 stop buildy-af             # arret backend
```

## PM2 (cohérent avec BT/FM)
- Dev : `pm2 start ecosystem.config.cjs` (watch actif sur `backend-node/src`)
- Prod : `pm2 start ecosystem.config.cjs --env production` (NODE_ENV=production, PORT=443, TZ=Europe/Paris, watch désactivé)
- Premier déploiement / après `pm2 delete` : `pm2 start ecosystem.config.cjs --env production && pm2 save`

## Convention chemins
- Backend Node : `backend-node/src/{lib,routes,services}/` (meme convention FM)
- Frontend Vue : `frontend/src/{components,views,composables,stores}/`
- DB : `data/buildy_af.db` (WAL)
- Captures : `data/attachments/<af-id>/<uuid>.png`
- Exports : `data/exports/<af-id>/{af,points-list}-<ts>.pdf`
- Repos Git par AF (Lot 10) : `data/repos/<af-id>/.git`

## Cookies & ports
- Cookie auth : `af_token` (httpOnly, 15 min)
- Cookie OIDC state : `af_oidc_state` (5 min)
- Port backend dev : **3100**
- Port frontend dev : **5173** (proxy `/api` → 3100)

## Sources de verite (jamais reinventer, toujours referencer)
1. **PDF des offres Buildy 2026** : `docs/offres-buildy-2026-ia.pdf` — niveaux [E]/[S]/[P] de chaque feature
2. **Page Notion BACS** : R175-1 a R175-6 (annexe PDF optionnelle)
3. **Code Hyperveez** : `../hyperveez/` — vraies pages UI pour seeder le ch.10.2 du plan AF
4. **Document Ekium** (a fournir) : listes de points typiques par equipement
5. **Logos Buildy** : `../hyperveez/src/assets/logo-buildy*.svg` (copies dans `frontend/public/` au build)

## Etat actuel — Lot 1 (Squelette)
Squelette livre : backend Fastify + frontend Vite + Tailwind + charte BT/FM, login PocketID (mode dev bypass actif par defaut), AppLayout vide, route `/auth/me` fonctionnelle.

Lots a venir : voir le plan principal pour la suite (modele DB + biblioteque d'equipements + editeur Tiptap + exports PDF, etc.).

## Regles
- **Charte visuelle** : strictement identique a edge-fleet-manager / buildy-tools. Toute incoherence visuelle = bug.
- **Accents francais** dans tous les textes UI : Sante, planifiee, creee, desactive, etc. (Note : ce CLAUDE.md est sans accents pour ASCII-safety, mais **le code en a**).
- **Pas d'invention** : pour decrire Hyperveez, lire le code reel ou demander a Kevin. Le PDF AF doit refleter ce qui existe.
- **Sauvegarde proteger la DB** : data/buildy_af.db est dans `.gitignore`. Jamais de mv/cp/rm pendant que le serveur tourne.
