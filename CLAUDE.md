# CLAUDE.md — buildy-docs

## Projet
App web Buildy de redaction documentaire multi-domaines.

Trois familles de documents heberges :
1. **AF (Analyses Fonctionnelles GTB)** — livrables DOE de chantier
2. **Audit BACS** — releve de site avec rapport PDF de conformite au decret R175 + plan de mise en conformite (base de devis commercial)
3. **Brochure commerciale** — assemblee depuis la bibliotheque de fonctionnalites (a venir)

Cible : equipe Buildy en interne. Plan complet : `~/.claude/plans/construis-moi-une-analyse-scalable-pancake.md` (versionne hors repo).

## Stack (alignee BT/FM)
- **Backend** : Node.js 20+ / Fastify 5 / better-sqlite3 (WAL) / Pino / @fastify/jwt + cookie
- **Frontend** : Vue 3.5 / Vite 7 / Tailwind 4 / Vue Router 4 / Pinia / Axios / Heroicons
- **Auth** : PocketID OIDC (cookie httpOnly JWT) — pas de fallback local. Mode dev = `DEV_BYPASS_AUTH=1`
- **PDF** : Puppeteer + Handlebars (A4 AF, A3 liste de points, A4 audit BACS)
- **Editeur** : Tiptap 2 + extensions collaboration/image/table
- **IA** : Claude SDK pour assistant redaction

## Dev rapide
```bash
cd buildy-docs
./dev.sh                         # backend PM2 :3100 + frontend Vite :5173 + DEV_BYPASS_AUTH=1
pm2 logs buildy-docs             # suivre les logs backend
pm2 restart buildy-docs          # restart manuel (PM2 watch est actif sur backend-node/src)
pm2 stop buildy-docs             # arret backend
```

## PM2
- Dev : `pm2 start ecosystem.config.cjs` (watch actif sur `backend-node/src`)
- Prod : `pm2 start ecosystem.config.cjs --env production` (NODE_ENV=production, PORT=3443, TZ=Europe/Paris, watch desactive)
- Premier deploiement / apres `pm2 delete` : `pm2 start ecosystem.config.cjs --env production && pm2 save`

## Convention chemins
- Backend Node : `backend-node/src/{lib,routes,services}/` (meme convention FM)
- Frontend Vue : `frontend/src/{components,views,composables,stores}/`
- DB : `data/buildy_af.db` (WAL)
- Captures : `data/attachments/<document-id>/<uuid>.png`
- Exports : `data/exports/<document-id>/{document,bacs-audit,points-list,brochure}-<ts>.pdf`
- Repos Git par document : `data/repos/<document-id>/.git`

## Cookies & ports
- Cookie auth : `docs_token` (httpOnly, 15 min)
- Cookie OIDC state : `docs_oidc_state` (5 min)
- Port backend dev : **3100**
- Port frontend dev : **5173** (proxy `/api` -> 3100)

## Modele de donnees (apercu)
- `documents` (kind ∈ 'af' | 'bacs_audit' | 'brochure') — table unifiee
- `sites` (synchro bidirectionnelle avec FM via site_uuid + last-write-wins)
- `zones`, `equipments` — locaux Buildy Docs, lies au site, partages entre tous les documents du site
- `bacs_audit_systems`, `bacs_audit_meters`, `bacs_audit_bms`, `bacs_audit_thermal_regulation`, `bacs_audit_action_items` — specifique audit BACS

Statuts AF : `'draft' | 'validated' | 'commissioning' | 'commissioned' | 'delivered'` (anglais — renommage migration 34)
Statuts audit BACS : `'draft' | 'review' | 'delivered'`
Statuts brochure : `'draft' | 'published'`

## Sources de verite (jamais reinventer, toujours referencer)
1. **PDF des offres Buildy 2026** : `docs/offres-buildy-2026-ia.pdf` — niveaux [E]/[S]/[P] de chaque feature
2. **Page Notion BACS** : R175-1 a R175-6 (texte integral seede dans `bacs-articles.js`, annexe PDF des audits)
3. **Code Hyperveez** : `../hyperveez/` — vraies pages UI pour seeder le ch.10.2 du plan AF
4. **Document Ekium** (a fournir) : listes de points typiques par equipement
5. **Logos Buildy** : `../hyperveez/src/assets/logo-buildy*.svg` (copies dans `frontend/public/` au build)
6. **Schema Directus** : `docs/directus-schema.yaml` — reference de conception pour le nommage et la structure (AUCUN coupling technique avec Directus, juste cohérence cross-app)

## Regles
- **Charte visuelle** : strictement identique a edge-fleet-manager / buildy-tools. Toute incoherence visuelle = bug.
- **Identifiants techniques en anglais** : tables, colonnes, fonctions, fichiers, routes API. Les libelles UI restent en francais avec accents.
- **Accents francais** dans tous les textes UI : Sante, planifiee, creee, desactive, etc. (Note : ce CLAUDE.md est sans accents pour ASCII-safety, mais **le code en a**).
- **Pas d'invention** : pour decrire Hyperveez, lire le code reel ou demander a Kevin.
- **Proteger la DB** : `data/buildy_af.db` est dans `.gitignore`. Jamais de mv/cp/rm pendant que le serveur tourne.

## Audit BACS — protection juridique Buildy
- Approche fonctionnelle (R175-3) — pas de certification ISO 52120-1 obligatoire
- Buildy NE CALCULE PAS le TRI (clause de dispense R175-2) — c'est la responsabilite du proprietaire
- L'audit Buildy != inspection officielle R175-5-1 (qui est realisee par un tiers)
- Distinction explicite decret BACS != CEE BAT-TH-116
- Annexes obligatoires de chaque PDF audit : A) texte integral R175 / B) methodologie Buildy / C) justification des preconisations / D) disclaimers

## Synchro sites avec Fleet Manager
- Bidirectionnelle via `site_uuid` partage + last-write-wins basé sur `updated_at`
- Token de service Bearer `BUILDY_SITES_SYNC_TOKEN` (memes valeurs cote FM et Buildy Docs)
- Endpoint reciproque `/api/sites/sync` cote chaque app
- Worker queue avec retry exponentiel pour resilience reseau
