# Buildy Docs

Application web Buildy de **rédaction documentaire multi-domaines**, hébergée à `buildy-docs.buildy.wan` (production) et au port 3100/5173 en dev.

Trois familles de documents :

1. **AF — Analyses Fonctionnelles GTB** : livrables DOE de chantier (A4, sections récursives, équipements, points, exports XLSX/PDF).
2. **Audit BACS / GTB classique** : relevé de site avec rapport PDF de conformité au décret R175 + plan de mise en conformité (base de devis commercial).
3. **Brochure commerciale** *(en cours de construction — voir [`docs/improvements-sprint.md`](docs/improvements-sprint.md))* : assemblée depuis la bibliothèque de fonctionnalités.

Cible : équipe Buildy en interne (auditeurs, ingénieurs MOE, commerciaux).

---

## Stack

| Couche | Tech |
|---|---|
| Backend | Node.js 20+ / Fastify 5 / better-sqlite3 (WAL) / Pino |
| Frontend | Vue 3.5 / Vite 7 / Tailwind 4 / Vue Router 4 / Pinia / Axios / Heroicons |
| Auth | PocketID OIDC (cookie httpOnly JWT) — dev via `DEV_BYPASS_AUTH=1` |
| PDF | Puppeteer + Handlebars (A4 AF, A3 liste de points, A4 audit BACS, A4 paysage synthèse) |
| Éditeur | Tiptap 2 + extensions image / table |
| IA | Anthropic SDK (assistant rédaction, synthèse audit, alternatives, transcripts Plaud) |
| Process | PM2 (dev + prod) |

Stack alignée sur **edge-fleet-manager** et **buildy-tools** (cf. `../CLAUDE.md`).

---

## Démarrage rapide

```bash
git clone git@github.com:buildy-bms/buildy-docs.git
cd buildy-docs
./dev.sh
```

`dev.sh` :
- copie `.env.example` → `.env` si absent ;
- installe les deps backend + frontend ;
- démarre le backend Fastify via PM2 sur `:3100` ;
- démarre le frontend Vite sur `:5173` (proxy `/api` → `:3100`).

URL : http://localhost:5173 — auth bypassée en dev (`DEV_BYPASS_AUTH=1` dans `.env`).

Stop : `Ctrl+C` (frontend) puis `pm2 stop buildy-docs` (backend).

---

## Variables d'environnement

Voir [`.env.example`](.env.example). Les principales :

| Var | Rôle |
|---|---|
| `PORT` | Port backend (3100 dev, 3443 prod) |
| `JWT_SECRET` | Secret signature cookie auth (32 octets hex) |
| `DEV_BYPASS_AUTH` | Bypass OIDC en dev (1 = user fictif) |
| `OIDC_*` | Config PocketID en prod |
| `ANTHROPIC_API_KEY` | Assistant Claude (synthèse, alternatives, suggestions Plaud) |
| `CLAUDE_MODEL` | Modèle utilisé (défaut `claude-sonnet-4-6`) |
| `BUILDY_SITES_SYNC_TOKEN` | Token Bearer pour la sync sites Fleet Manager |
| `FM_SYNC_URL` | URL endpoint sync côté FM |

---

## Structure du projet

```
buildy-docs/
├── backend-node/           # API Fastify
│   ├── src/
│   │   ├── routes/         # Plugins Fastify (afs, bacs-audit, sites, exports, auth, ...)
│   │   ├── lib/            # Utilitaires métier (pdf, claude, sites-sync, seeder, ...)
│   │   ├── database.js     # Migrations + accès better-sqlite3
│   │   └── index.js        # Bootstrap
│   ├── templates/pdf/      # Templates Handlebars + CSS embed
│   └── test/               # Tests Vitest (.mjs)
├── frontend/               # Vue 3 + Vite
│   └── src/
│       ├── views/          # Vues principales (AfDetailView, BacsAuditDetailView, ...)
│       ├── components/     # Composants réutilisables (audit/, editor/, modals, ...)
│       ├── stores/         # Pinia stores (audit.js — af.js et brochure.js à venir)
│       ├── composables/    # useNotification, useConfirm, ...
│       ├── api.js          # Client Axios
│       └── router.js       # Vue Router
├── data/                   # Storage (gitignored)
│   ├── buildy_af.db        # SQLite WAL
│   ├── attachments/        # Captures et photos
│   ├── exports/            # PDFs générés
│   └── repos/              # Repos Git par document (versioning)
├── docs/                   # Doc utilisateur + assets
├── deploy/                 # Scripts/configs déploiement Hosteur
├── ecosystem.config.cjs    # PM2 (dev + prod)
├── dev.sh                  # Lance dev mode (PM2 + Vite)
└── CLAUDE.md               # Conventions et guides pour Claude Code
```

---

## Scripts

### Backend

```bash
cd backend-node
npm run dev      # node --watch (hot reload)
npm test         # Vitest (32 tests actuellement)
npm test:watch   # Vitest mode watch
```

### Frontend

```bash
cd frontend
npm run dev      # Vite dev server :5173
npm run build    # Build prod → frontend/dist
npm run preview  # Preview du build
```

---

## Déploiement (production)

Hébergement : **VPS Hosteur Jelastic** (`/opt/buildy-docs`), cf. mémoire utilisateur `feedback_deploy_hosteur.md`.

```bash
ssh 39448-1106@gate.rag-control.hosteur.com -p 3022
cd /opt/buildy-docs
git pull
cd frontend && npm run build && cd ..
pm2 restart buildy-docs
```

PM2 prod : `NODE_ENV=production`, `PORT=3443`, `TZ=Europe/Paris`, watch désactivé. URL publique : https://buildy-docs.buildy.wan (via NetBird).

DB : `data/buildy_af.db` (WAL). **Ne jamais `mv`/`cp`/`rm` pendant que le serveur tourne.**

---

## Audit BACS — protection juridique

- Approche **fonctionnelle** R175-3 (pas de certification ISO 52120-1 obligatoire).
- Buildy **ne calcule pas le TRI** (clause de dispense R175-2 — responsabilité du propriétaire).
- L'audit Buildy ≠ inspection officielle R175-5-1 (réalisée par un tiers indépendant).
- Distinction explicite : décret BACS ≠ CEE BAT-TH-116.
- Annexes obligatoires de chaque PDF audit :
  - **A** texte intégral R175,
  - **B** méthodologie Buildy,
  - **C** justification des préconisations,
  - **D** disclaimers.

---

## Sources de vérité (à référencer, jamais réinventer)

1. **Offres Buildy 2026** — `docs/offres-buildy-2026-ia.pdf` (niveaux [E]/[S]/[P] de chaque feature)
2. **Page Notion BACS** — articles R175-1 à R175-6 (texte intégral seedé dans `bacs-articles.js`)
3. **Hyperveez** — `../hyperveez/` (vraies pages UI pour seeder le ch.10.2 du plan AF)
4. **Logos Buildy** — `../hyperveez/src/assets/logo-buildy*.svg` (copiés dans `frontend/public/`)
5. **Schéma Directus** — `docs/directus-schema.yaml` (référence de nommage cross-app)

---

## Synchro sites avec Fleet Manager

Bidirectionnelle via `site_uuid` partagé + last-write-wins basé sur `updated_at`.

- Token de service Bearer `BUILDY_SITES_SYNC_TOKEN` partagé FM ↔ Buildy Docs.
- Endpoint réciproque `/api/sites/sync` côté chaque app.
- Worker queue avec retry exponentiel pour résilience réseau.

---

## Documentation supplémentaire

- [`CLAUDE.md`](CLAUDE.md) — conventions de code et guides pour Claude Code (workflow Notion, captures Playwright, règles métier)
- [`CHANGELOG.md`](CHANGELOG.md) — historique des releases
- [`docs/improvements-sprint.md`](docs/improvements-sprint.md) — suivi des 10 lots Produit/Restitution en cours

---

## Sécurité

- Pas de secrets dans le repo (le `.env` est gitignored).
- Le `.env` complet (avec tokens) est embarqué dans les backups cloud chiffrés (cf. CLAUDE.md racine `~/buildy-edge-projects/CLAUDE.md`).
- Cookies `docs_token` httpOnly (15 min) — auth via PocketID en prod, bypass en dev.
- Aucun fallback "user/password local" en prod.

---

## Tests

```bash
cd backend-node && npm test
```

32 tests Vitest (image-optimizer, action-generator BACS, slug, crypto). Frontend : pas de tests automatisés actuellement (axe Qualité, gardé pour plus tard).

---

## Contact

Équipe Buildy (interne). Pour les problèmes techniques, ouvrir un ticket Linear ou contacter Kevin.
