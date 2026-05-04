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

## Sauvegardes DB de prod
- **Daily auto** : crontab root `0 3 * * * /opt/buildy-docs/deploy/backup-db.sh daily`, retention 30 jours, log dans `/var/log/buildy-docs-backup.log`
- **Pre-deploy auto** : `deploy/update-vps.sh` execute `backup-db.sh predeploy` en etape 0 avant tout `git pull`, retention 20 deploys, snapshot tagge avec le SHA git
- **Stockage** : `/opt/buildy-docs/data/backups/{daily,predeploy,manual-legacy,pre-restore}/<kind>-<ts>[-<sha>].db.gz`
- **Methode** : `node + better-sqlite3.backup()` — copie WAL-safe sans arret pm2
- **Restauration** : `bash /opt/buildy-docs/deploy/restore-db.sh` (mode interactif liste les snapshots, demande confirmation, sauvegarde l'etat courant sous `pre-restore/` avant overwrite, restart pm2)
- **Non-offsite** : protection contre regression / erreur humaine uniquement, PAS contre une perte du VPS

## PDF — point d'entree unique et conventions
Tous les PDF passent par `backend-node/src/lib/pdf.js::renderPdf()`. Options en flags : `coverFullBleed`, `populateToc`, `addFormFields`, `watermark`, `skipFirstPageHeaderFooter`, `pageFormat`, `pageOrientation`. Ne pas creer de pool Puppeteer ad-hoc.

- **Pool Puppeteer durci** : healthcheck `browser.version()` pre-render, recyclage env `PUPPETEER_RECYCLE_AFTER` (defaut 50), timeout env `PUPPETEER_RENDER_TIMEOUT_MS` (defaut 120000ms, applique via `Promise.race`). Les 3 mecanismes sont cumulatifs — supprimer l'un = ressusciter l'incident OOM/freeze qu'ils corrigent.
- **Charts PDF lazy require** : `routes/bacs-audit/_export-data.js` : `pdf-charts` (= `chartjs-node-canvas`) DOIT etre require au 1er appel via `getCharts()`. Top-level require pollue `require.cache` (entry `undefined`) et fait crasher Fastify sur `getPluginName()` en prod.
- **Cover full-bleed double defense** : ne pas retirer `@page :first { background: #1b2842 }` des CSS templates. C'est le filet de secours quand Chromium dérape sur le sub-pixel.
- **Header/footer unifie** : seul `buildHeaderFooter()` de `lib/pdf.js`. Logo en footer (jamais header). Toute modif `.hbs` => `pm2 restart`.
- **Constantes mm/pt/px** : 1mm = 3.7795px (viewport), 1mm = 2.83465pt (post-process), PT_PER_PX = 0.75 (96 DPI Puppeteer). Disseminees, ne pas les redefinir ailleurs.
- **Cover-level-band partial** : `templates/pdf/_cover-level-band.hbs` est l'unique source pour le bandeau "Required vs Vise + justif + verdict" (AF, Synthese, Liste de points).
- **populateToc 2-passes** : `setContent` -> `page.evaluate` calcule pages via scrollY + mute le DOM `.toc-page` -> `pdf()`. Une seule passe DOM. La TOC est cliquable car les ancres recoivent leur `id` injecte.

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
- `documents` (kind ∈ 'af' | 'bacs_audit' | 'site_audit' | 'brochure') — table unifiee. `site_audit` partage tout le schema `bacs_audit_*` mais R175 ne s'applique pas (audit GTB classique = devis Buildy hors decret).
- `sites` (synchro bidirectionnelle avec FM via site_uuid + last-write-wins)
- `zones`, `equipments` — locaux Buildy Docs, lies au site, partages entre tous les documents du site
- `bacs_audit_systems`, `bacs_audit_meters`, `bacs_audit_bms`, `bacs_audit_thermal_regulation`, `bacs_audit_action_items` — specifique audit BACS

Statuts AF : `'draft' | 'validated' | 'commissioning' | 'commissioned' | 'delivered'` (anglais — renommage migration 34)
Statuts audit BACS : `'draft' | 'review' | 'delivered'`
Statuts brochure : `'draft' | 'published'`

## Bibliotheque & Plan AF
- **3 pages dediees** (Lot 32, cf. `frontend/src/router.js:81-106`) :
  - `/library/sections` -> `LibrarySectionsView.vue` (sections types narratives, hierarchie editable)
  - `/library/equipments` -> `LibrarySystemsView.vue` (onglets Systemes + Categories)
  - `/library/functionalities` -> `LibraryFunctionalitiesView.vue` (matrice E/S/P, PDF offres)
- **`section_templates` = source de verite du plan AF** (Lot 33). La structure du plan vit dans cette table. `seeds/plan-af.js` ne fait que bootstrap via migration 26 — modifier `plan-af.js` ne suffit PAS, il faut aussi une migration de bootstrap si on ajoute des nodes.
- **Seeder idempotent** (`lib/seeder.js:77-82`) : n'ecrase JAMAIS les `description_html`, `bacs_articles`, `preferred_protocols` editees manuellement. Pour reseed un champ, le vider explicitement en DB d'abord. Ne jamais "corriger" le seeder pour overwrite.
- **Tombstones de slugs** : table `deleted_section_template_slugs`. Empeche le re-seed apres suppression d'une section type. Sans tombstone, suppression UI = recreation au prochain boot ("bug fantome").
- **Cascade manuelle DELETE section_templates** : la FK `sections.section_template_id` n'a pas `ON DELETE CASCADE`. Routes DELETE (`routes/section-templates.js:169-185`) doivent : (1) compter AFs affectees via `countAffectedAfs()`, (2) renvoyer 409 si > 0 et `!force`, (3) `DELETE FROM sections WHERE section_template_id = ?` AVANT, (4) ajouter le tombstone.
- **Niveaux d'offre** : `section_templates.avail_e | avail_s | avail_p` accepte `'included' | 'paid_option' | NULL` (Zod enum strict, `routes/section-templates.js:16`). **La valeur exacte est `'paid_option'`, jamais `'option'`** — bug recurrent. Le `service_level` est *derive* (niveau minimum d'inclusion), pas saisi.
- **PDF tableau offres** = parcours d'arbre (`routes/offerings.js`). DFS sur `parent_template_id`, tri par profondeur, indentation cumulee. Une feature peut avoir des features enfants (nested).

## Architecture Audit BACS
- **Routes decoupees par domaine** : `backend-node/src/routes/bacs-audit.js` (point d'entree, CRUD systems/meters/bms/thermal/devices/action-items) enregistre 4 sous-plugins :
  - `routes/bacs-audit/transcripts.js` — Claude suggestions, upload Plaud Pro
  - `routes/bacs-audit/inspections.js` — R175-5-1 (inspections officielles)
  - `routes/bacs-audit/exports.js` — PDF + checklist + preview HTML
  - `routes/bacs-audit/lifecycle.js` — livraison + stepper 10 etapes
  - `routes/bacs-audit/_shared.js` — enums + `assertBacsAuditExists()` (accepte kind 'bacs_audit' OU 'site_audit')
- **2 kinds, meme schema** : `documents.kind ∈ ('bacs_audit', 'site_audit')` partagent toutes les tables `bacs_audit_*`. **R175 ne s'applique QUE sur `bacs_audit`** (commits feat(audits): kind 'site_audit' = devis hors BACS). A chaque export/calcul de conformite, brancher sur `const isBacs = af.kind === 'bacs_audit'` (cf. `_export-data.js:298`).
- **Photos site-level** : stockees dans `data/site-documents/<site_uuid>/`, **pas par document**. Association via FK colonnes `bacs_audit_zone_id | bacs_audit_system_id | bacs_audit_meter_id | bacs_audit_device_id | bacs_audit_bms_document_id` sur `site_documents` (migrations 38+). Optimisation `optimizeFileToDataUrl()` pour embed PDF.
- **Action items idempotence** : clé unique `(source_table, source_id, source_subtype)` dans `lib/bacs-audit-action-generator.js:68`. Toute regeneration upsert sur cette cle. Sans le `source_subtype` discriminant, doublons garantis.
- **Auto-generated items immuables sur metier** (`routes/bacs-audit.js:501-507`) : items `auto_generated=1` n'acceptent en UPDATE QUE `commercial_notes, estimated_effort, status, position, alternative_solutions_html`. Toute ecriture sur `title`/`description`/`severity` est ignoree silencieusement. DELETE refuse en 400 (status=declined a la place).
- **3 sources d'enums a synchroniser** : DB CHECK constraints (`database.js`) + constantes JS (`routes/bacs-audit/_shared.js`: SYSTEM_CATEGORIES, COMMUNICATION_VALUES, METER_USAGES, METER_TYPES, RECOMMENDATIONS, REGULATION_TYPES, GENERATOR_TYPES) + labels FR (`_export-data.js`). Toute desync = INSERT en erreur OU export PDF avec valeurs anglaises.
- **Store Pinia centralise** : `frontend/src/stores/audit.js`. Tous les sous-composants (`SystemsSection.vue`, `MetersSection.vue`, `BmsSection.vue`, etc.) lisent/ecrivent via `storeToRefs()`. **Pas de props drilling** — choix conscient, ne pas refactoriser vers props.

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
