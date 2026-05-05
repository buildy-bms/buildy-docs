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

### Design system PDF (référence centrale)

**Voir `docs/pdf-design-system.md`** — référence vivante des conventions visuelles de tous les PDF Buildy : tokens (palette, typographie Poppins+Inter, espacements, bords arrondis), vocabulaire de composants (panel, info-card, system-card, m-pill, usage-pill, headline, stat, recap-tile, gtb-summary, dashboard-row, action-card, callout, etc.), patterns de layout (cover, page L'essentiel, sommaire, dashboard R175, opener chapitre, annexes), formats de page par type de doc, helpers Handlebars, conventions de code.

Tout nouveau template ou modification visuelle doit s'aligner sur ce document.

### Atelier de design PDF (preview fixtures, dev only)

Pour itérer sur le design des PDF audit BACS et GTB classique sans cycle "créer audit → exporter Puppeteer ~30 s" :

**URLs preview** (404 en `NODE_ENV=production` sans `DEV_BYPASS_AUTH=1`) :

| URL | Format | Contenu |
|---|---|---|
| `/api/bacs-audit/__preview-fixture` | HTML | Audit BACS principal (≈33 pages A4) |
| `/api/bacs-audit/__preview-fixture/pdf` | PDF | Idem en PDF Puppeteer |
| `/api/bacs-audit/__preview-fixture/tables` | HTML | Tableaux de synthèse BACS (5 pages A3 paysage) |
| `/api/bacs-audit/__preview-fixture/tables/pdf` | PDF | Idem en PDF |
| `/api/bacs-audit/__preview-fixture-classique` | HTML | Audit GTB classique (≈23 pages A4) |
| `/api/bacs-audit/__preview-fixture-classique/pdf` | PDF | Idem en PDF |
| `/api/bacs-audit/__preview-fixture-classique/tables` | HTML | Tableaux de synthèse classique (5 pages A3 paysage) |
| `/api/bacs-audit/__preview-fixture-classique/tables/pdf` | PDF | Idem en PDF |

**Hot reload** : éditer `.css` ou `.hbs` dans `backend-node/templates/pdf/` → refresh navigateur — **pas de `pm2 restart`** (flag `fresh: true` propagé dans `loadTemplate()` / `renderHtml()` / `renderPdf()` pour les routes preview).

**Bandeau dev** : injecté en haut à droite (caché en `@media print`). Boutons Reload / Print / 4 boutons groupe BACS (vert) / 4 boutons groupe Classique (orange) + timestamp.

**Fixture Atlas Sud** : dataset partagé entre BACS et classique — `backend-node/src/routes/bacs-audit/_preview-fixture.js` accepte `{ kind: 'bacs_audit' | 'site_audit' }`. Profil : Plateforme Logistique Atlas Sud à Saint-Quentin-Fallavier, GTB Schneider EcoStruxure partielle, 14 équipements (DRV Daikin → CoolMaster Pro, aérothermes Reznor), 8 compteurs, 4 régulations thermiques, 15 actions correctives, photos skeleton dans `data/fixtures/photos/` (régénérables via `node data/fixtures/photos/_generate.js`).

**Polices PDF** : Poppins (titres) + **Inter** (corps, alignée Stripe / Linear / GitHub / Vercel). Migration mai 2026 — Manrope encore embed dans `lib/pdf.js` 30 jours pour compat descendante, à retirer après si rien ne casse.

**Limite v1 fixture** : charts (`sevDonutDataUrl`, `barUsagePowerDataUrl`) non générés — apparaissent à blanc.

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
- **Champs synchronisés** : `name`, `customer_name` (Docs) ↔ `client` (FM), `address`, `notes`, `deleted_at`. La source de vérité de l'**adresse** est la table `sites` ; les documents (`afs`, `bacs_audit`, `site_audit`) ne stockent PAS de duplicata. La colonne legacy `documents.site_address` est lue mais plus écrite côté mobile/audit-store. Édition possible côté Docs (audit Site tab + AfsListView desktop) ou côté FM (modale create/edit Site → champ Adresse).

## Vue Mobile / PWA (audit BACS / GTB sur iPhone-iPad)

### Architecture
- **Routage** : `views/AuditDetailRouter.vue` choisit dynamiquement entre `BacsAuditDetailView.vue` (desktop ≥ 1024px) et `views/MobileAuditDetailView.vue` (mobile < 1024px) via `useViewport().isNarrow`. Routes `/bacs-audit/:id` et `/site-audit/:id` ont `meta.fullscreenMobile: true` → `App.vue` skip `AppLayout` (header navy + sidebar) en mobile pour donner tout l'écran à la vue native.
- **Idem home** : `views/HomeRouter.vue` → `MobileHomeView.vue` (audits uniquement, pas d'AF/brochures) sur mobile, `AfsListView.vue` sur desktop.
- **5 onglets bottom nav** : Site / Zones / Compteurs / Systèmes / GTB. Régulation thermique R175-6 nichée dans Systèmes (panneau ambré sous chaque heating/cooling). Plan d'action et synthèse Claude restent desktop-only.
- **Composants mobiles** dans `frontend/src/components/mobile-audit/` : `MobileSheet` (slide-up plein écran avec close+save iOS-natif), `MobileField` (label uppercase tracking-wider + slot), `MobileFab`, `MobileShareSheet`, et 5 `Mobile<Tab>.vue` (Site / Zones / Meters / Systems / Bms).
- **Store partagé** : `stores/audit.js` charge le site via `getSite(site_uuid)` au boot, expose `updateSiteFields(patch)` qui appelle `PATCH /api/sites/:uuid` (propagation FM via sync existant).

### Breakpoints (`composables/useViewport.js`)
- `isMobile` : `(max-width: 767px)` — phone portrait/landscape, déclenche les rendus cards stack
- `isNarrow` : `(max-width: 1023px)` — phone + iPad portrait, masque le stepper sidebar et active la bottom nav
- `isCoarsePointer` : `(pointer: coarse)` — détection touch
- `isDesktop` / `isWide` : inverses

### Conventions tactile iOS
- Tap targets ≥ 44pt (utility class `.tap-target` dans `assets/main.css`)
- Inputs forcés à `font-size: 16px` en mobile (anti-zoom Safari focus). Placeholders réduits à 14px opacity 0.7 pour hiérarchie label/valeur
- Champs nombre : `inputmode="decimal"` + `pattern="[0-9.,]*"` (jamais `type="number"` qui sort double clavier)
- Date : `<input type="date">` natif (picker iOS)
- Selects courts (≤ 6 options) : `<select>` natif. Plus longs : modal plein écran avec recherche
- Bottom safe-area : tous les conteneurs sticky/fixed bas utilisent `env(safe-area-inset-bottom)` pour ne pas être cachés par la home indicator iPhone X+
- Bottom nav : h-14 (56px) + safe-area = ~90px (proche du standard Apple ~83px)
- Body bg #ffffff explicite dans `main.css` pour éviter tout bleed gris dans la zone safe-area en PWA standalone

### PWA standalone iOS / Android
- `frontend/public/manifest.webmanifest` : `display: standalone`, `theme_color: #ffffff`, icons 180/192/512 générés depuis `img/favicon-buildy-fond-blanc.png` via `sharp`
- Meta tags `apple-mobile-web-app-capable=yes` + `status-bar-style=default` (texte sombre sur fond blanc) dans `frontend/index.html`
- `frontend/public/sw.js` : SW minimal et conservateur, n'intercepte PAS navigation / api / auth (incident 2026-05-05 où v1 cassait la chaîne de redirects OIDC sur Safari iOS). Cache uniquement assets statiques en StaleWhileRevalidate
- `components/InstallBanner.vue` : bannière non intrusive iOS Safari après 5s qui dit « Tap 📤 puis Sur l'écran d'accueil ». Auto-dismiss 30 jours via localStorage. Capture aussi `beforeinstallprompt` Android pour install 1-clic
- **Force refresh** : bouton dans le sheet « Paramètres de l'audit » mobile (icône engrenage en topbar) qui désinscrit le SW + purge `caches.keys()` + reload bypass-cache. Indispensable car le SW peut servir un app-shell obsolète sur iOS standalone.

### Cert TLS Let's Encrypt + DNS-01 OVH
Le domaine `docs.buildy.fr` résout vers une IP NetBird interne (`100.64.x.x`), donc HTTP-01 impossible. On utilise DNS-01 :
- `acme.sh` installé dans `/root/.acme.sh/` sur le VPS Hosteur (cron auto-renew 60j)
- Plugin OVH natif `dns_ovh` configuré via env vars `OVH_AK`, `OVH_AS`, `OVH_CK`, `OVH_END_POINT=ovh-eu`
- **Scope token OVH** : `GET=/domain/zone/* POST=/domain/zone/* PUT=/domain/zone/* DELETE=/domain/zone/*` (le scope par-zone `/buildy.fr/*` ne suffit pas car le plugin teste `GET /domain/zone/buildy.fr` sans path)
- Cert installé via `acme.sh --install-cert -d docs.buildy.fr --ecc --fullchain-file /opt/buildy-docs/certs/server.crt --key-file /opt/buildy-docs/certs/server.key --reloadcmd "pm2 restart buildy-docs"`
- L'ancien cert auto-signé est sauvegardé en `server.crt.selfsigned-bak` / `server.key.selfsigned-bak`
- Renouvellement test : `/root/.acme.sh/acme.sh --cron --home /root/.acme.sh`

## Partage d'audit (et AF)

### Modèle
Mêmes routes pour AF et audits car la table `documents` est unifiée :
- `GET /api/afs/:id/permissions` — owner_id + grants
- `POST /api/afs/:id/permissions` — body `{ user_id, role }` (role ∈ 'read' | 'write')
- `DELETE /api/afs/:id/permissions/:userId`

### Côté UI
- **Desktop** : `components/ShareAfModal.vue` ouvert depuis :
  - AF : bouton dans `CycleBandeau.vue` menu « Plus »
  - Audit : bouton « Plus » → « Partager » dans `BacsAuditDetailView.vue` topbar
- **Mobile** : `components/mobile-audit/MobileShareSheet.vue` ouvert depuis le sheet Paramètres audit (icône engrenage)

### Toolbar audit desktop (cohérent avec AF)
Pattern unifié : actions d'export visibles + menu « Plus » :
- Boutons visibles : `Aperçu` (gris outline) | `Rapport` (PDF A4 indigo plein) | `Synthèse` (PDF A3 indigo plein) | `Livrer` (vert)
- Menu `Plus` (icône `EllipsisHorizontalIcon`) : Partager / Activité / Photos terrain / Transcript IA / ─── / Supprimer cet audit (rouge)
- Le kind switch BACS/GTB reste dans le `<select>` du `<h1>` titre
- **Pas de Tout replier/déplier dans la toolbar globale** — c'est une action par section gérée par les `CollapsibleSection`

### Liste utilisateurs PocketID
- Backend `routes/users.js` : `GET /api/users` complète sa liste avec les utilisateurs PocketID via `X-API-Key` header (env `POCKETID_API_KEY`). Cache 60s in-memory pour ne pas hammer l'admin API. Dédup par email avec les users locaux.
- Backend `POST /api/users/ensure-by-pocketid-id` : crée un placeholder local (oidc_sub = pocketid id) pour pouvoir grant à un collègue qui ne s'est pas encore loggé sur Docs. Au prochain login OIDC, `getByOidcSub` retrouve l'enregistrement et complète le profil via `updateProfile`.
- Frontend (ShareAfModal + MobileShareSheet) : si l'user sélectionné est PocketID (id préfixé `pocketid:`), appelle d'abord `ensureUserFromPocketId(pocketid_id)` pour obtenir l'id local, puis `grantAfPermission`.
- Env var requise prod : `POCKETID_API_KEY=...` dans `/opt/buildy-docs/.env`. Token créé dans PocketID admin (Paramètres → API Keys) avec scope minimum `users:read`.
