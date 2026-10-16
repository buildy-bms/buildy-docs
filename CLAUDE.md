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

## Git workflow — Release

Convention alignee sur buildy-tools et edge-fleet-manager : tags `vX.Y.Z` avec bump
du 3e chiffre **a chaque commit** (cf. memory `feedback_buildy_docs_version_bump.md`).
Les chiffres majeur/mineur ne changent que sur ordre explicite.

1. **Bumper la version dans DEUX fichiers** avant chaque commit :
   - `frontend/package.json`
   - `backend-node/package.json`
   - (BD n'utilise pas de fichier `VERSION` racine, contrairement a BT/FM)
2. **Ajouter une entree** dans `frontend/src/release-notes.json` (cf. memory
   `feedback_buildy_docs_release_notes.md`)
3. Commit avec la version dans le sujet (convention BD) : `feat(scope): ... (0.1.45)`
4. Push sur `main`
5. **Apres chaque push, taguer le commit** :
   ```bash
   git tag v0.1.45 && git push origin v0.1.45
   ```
   Pas de prompt necessaire — c'est un reflexe, le tag est juste une marque de
   reference pour le rollback / audit / release notes.
6. **Deploiement prod** systematique apres chaque modif (cf. memory
   `feedback_buildy_docs_deploy_prod_each_change.md`) via Hosteur :
   ```bash
   ssh 39448-1106@gate.rag-control.hosteur.com -p 3022
   cd /opt/buildy-docs && bash deploy/update-vps.sh
   ```

**Tentatives multiples** : si un commit/tag `v0.1.45` s'avere defaillant et qu'on
refait `v0.1.46` sur le meme sujet, **editer l'entree existante** dans
`release-notes.json` plutot que d'en ajouter une nouvelle. La regle est identique
a BT/FM (cf. memory `feedback_bt_fm_release_notes.md`).

## ⚠️ Reflexes obligatoires Claude (incidents 2026-05-08 et 2026-05-09)

### Au demarrage de chaque session
1. `git status` + `git stash list` AVANT toute modification de code. Si untracked files dans `backend-node/src`, `frontend/src`, `scripts` → flag a l'utilisateur "tu veux que je commit ces fichiers d'abord ?". Si stash non vide → idem.
2. **`./dev.sh`** affiche au demarrage la liste des fichiers source non commites. Le hook `.githooks/pre-push` bloque les push qui laissent des orphelins (activation : `git config core.hooksPath .githooks`).

### JAMAIS de `Write` sur un fichier Vue/JS existant — TOUJOURS `Edit`
Tu utilises EXCLUSIVEMENT l'outil `Edit` avec `old_string` cible sur les composants existants. Si tu penses devoir reecrire un fichier entier, **STOP** et demande confirmation explicite. Reecrire from scratch = boutons / imports / features perdus.

### Composants FAQ ULTRA-SENSIBLES (a ne JAMAIS reecrire)

**`frontend/src/views/FaqArticleEditorView.vue`** — top-bar avec **9 boutons obligatoires** :
- `Retour FAQ` (back)
- Badge etat (Modifications non publiees / Synchronise / Local uniquement)
- `Voir en ligne` (visible si `crisp_url && status='published'`)
- `Reecrire avec IA` (`SparklesIcon`, calls `store.aiRewrite`)
- `Recharger` (visible si `crisp_id`, calls `pullFaqArticleFromCrisp`)
- `Historique` (`ClockIcon`, ouvre `FaqArticleHistoryModal`)
- `Enregistrer` (save)
- `Publier vers Crisp` (`pushToCrisp`, indigo)
- `Supprimer` (trash rouge)

Imports requis : `FaqArticleHistoryModal`, `pullFaqArticleFromCrisp`, icones `ArrowDownTrayIcon`, `ClockIcon` + 5 autres heroicons.

**`frontend/src/components/FaqRichTextEditor.vue`** — toolbar avec **callouts (tip/info/warning) via FaqBlockquote**, image upload + placeholder, **lien interne via `FaqArticleLinkModal`**, **BubbleMenu Tiptap** sur selection (bouton "Reecrire avec IA"). Imports : `FaqArticleLinkModal`, `FaqRewriteSelectionModal`, `BubbleMenu` de `@tiptap/vue-3/menus`. Le bouton "Inserer depuis captures" (`FaqGenerateModal` mode insert) a ete retire volontairement en 0.1.42 (doublon avec "Generer depuis captures" de la page FAQ, qui ouvre `FaqGenerateModal` en mode create) : son absence n'est PAS un ecrasement, ne pas le restaurer.

### Avant de modifier l'un de ces 2 fichiers
```bash
git log --oneline -5 -- frontend/src/views/FaqArticleEditorView.vue
wc -l frontend/src/views/FaqArticleEditorView.vue
grep -E "<button|<a " frontend/src/views/FaqArticleEditorView.vue | wc -l
```
- Si `FaqArticleEditorView.vue` < 300 lignes ou < 7 boutons : **NE PAS MODIFIER**, demander confirmation.
- Si `FaqRichTextEditor.vue` < 400 lignes ou pas d'import `FaqArticleLinkModal` : **NE PAS MODIFIER**, demander confirmation.

### Apres chaque modif
- `git diff --stat` : si > 30% de lignes supprimees, **STOP** et demande validation.
- `grep -E "<button|<a " <fichier>` : verifier que le compte de boutons n'a pas baisse.

### Restauration en cas d'ecrasement
```bash
git fetch origin
git checkout origin/main -- frontend/src/views/FaqArticleEditorView.vue
git checkout origin/main -- frontend/src/components/FaqRichTextEditor.vue
```
Puis re-appliquer UNIQUEMENT les changements explicitement demandes par l'utilisateur dans la session courante, par-dessus cette base.

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
- **Fonts embed cross-viewer** (Chrome OK ne suffit pas) :
  - `@fontsource/<famille>` doit être installé EN BACKEND, pas seulement frontend. Si absent, `require.resolve` dans `getEmbeddedFontsCss()` echoue silencieusement (warn dans logs) → font non embarquee → Safari/macOS Preview tombe en fallback → texte casse (espaces absorbes, lettres ecartees). Incident juin 2026 sur Inter (etait en frontend uniquement depuis migration Manrope→Inter).
  - Les variantes `font-style: italic` necessitent un fichier WOFF2 italique separe dans `FONT_FILES` avec `style: 'italic'`. Sans ca, Chrome synthese une oblique fake, Safari ne sait pas reproduire en PDF.
  - Audit `pm2 logs buildy-docs` au boot : tout warn `Font X Y absente` = symptome a corriger immediatement.
- **Pas de `box-shadow` floues** : Safari/macOS Preview rend les `box-shadow: 0 Xmm Ymm rgba(...)` comme un rectangle opaque cale a l'offset, sans blur. Visuellement catastrophique (CTA vert flanque d'un bloc vert, card avec halo plat qui deborde). Utiliser bordure pleine + radius + fond teinte pour la profondeur. Audit : `grep -rn "box-shadow" backend-node/templates/pdf/` ne doit pas retourner de blur > 0.5mm. Toujours ouvrir un PDF dans Safari avant validation.

### Rapport d'audit BACS — nouvelle mise en page (charte graphique, 2026-10-15)

Validée par Kévin sur maquettes (Virtuo, Sausheim), intégrée le 2026-10-15, **non commitée**. La charte
graphique Buildy des PDF vit dans le dépôt `../charte-graphique/` (règles, couleurs, polices, logos).
- **Gabarit** : `src/lib/bacs-audit-report.js` (`buildBacsAuditReportHtml(data, { mode })`, HTML depuis les
  données de `buildBacsAuditExportData`, comme l'ancien gabarit) + `templates/pdf/styles-bacs-audit-report.css`.
  Partie 1 « L'essentiel » (verdict en 3 questions, mot de l'auditeur, exigences du décret, plan par
  domaine), partie 2 « Le constat détaillé » par domaine (chaque chapitre finit par ses actions,
  justification et origine comprises : l'ancienne annexe C), annexes A décret, B méthodologie,
  C mentions légales, D documents joints. Tableaux : une ligne de valeurs courtes, le détail sur une
  ligne pleine largeur dessous (demande de Kévin : pas de retours à la ligne dans les colonnes).
- **Rien perdu** par rapport à `bacs-audit.hbs` : vérifié en comparant les textes (phrases, nombres,
  numéros d'actions) sur Virtuo, Sausheim, le jeu Atlas Sud et deux variantes qui forcent chaque cas
  rare. Toute rubrique ajoutée à l'export doit être ajoutée aux deux gabarits tant que l'ancien existe.
- **Pagination** : Paged.js 0.4.3 embarqué (`templates/pdf/vendor/pagedjs/`, voir son README),
  `lib/pdf.js` `renderPagedHtmlPdf()` / `preparePagedPage()` (même navigateur partagé et même délai
  que `renderPdf`). **Pagination en deux passes au moins** (`paginatePagedPage`, 2026-10-16) : Paged.js
  n'écrit les renvois de page (`target-counter` : sommaire, « · p. 32 ») qu'après la mise en forme de
  la page, avec « 0 » à la place ; un numéro plus large allongeait la ligne après coup et chassait la
  ligne du bas dans une colonne cachée, hors de la page (ligne de tableau absente du PDF, audit 56). La
  1re passe relève le numéro de chaque cible, la 2e pagine avec `data-pg` + `html.pg-known` (chaque règle
  `target-counter` de la feuille du rapport a sa jumelle `attr(data-pg)` : à garder en ajoutant un
  renvoi), une 3e si un numéro a encore bougé. Contenu resté hors de la page : avertissement dans les
  logs et contrôle « Aucun contenu posé hors de la page » de `check:pdf`.
  En-tête et pied de page en « margin boxes » `@page` générées par le gabarit
  (mêmes textes que `buildHeaderFooter()`, présentation de la charte) : exception assumée à la règle
  « seul buildHeaderFooter », Puppeteer ne peut ni retirer l'en-tête des intercalaires à fond perdu ni
  numéroter les renvois. `requestAnimationFrame` remplacé avant Paged.js (sinon blocage en arrière-plan).
- **Polices et logos** : `templates/pdf/charte/`, copie générée par
  `../charte-graphique/scripts/sync-buildy-docs.mjs` (ne pas modifier à la main). Sora en graisses fixes
  (« Sora Digits », chiffres seuls) ; « → » absent de Manrope → icône SVG.
- **Textes du décret en clair** : `frontend/src/lib/decree-plain.js`, chargé par import dynamique
  (source unique avec la fiche ⓘ de l'interface).
- **Ancienne mise en page gardée pour comparer** (règle « refonte = en double ») : `?layout=classic` sur
  `POST /bacs-audit/:id/export-pdf` et `GET /bacs-audit/:id/preview` ; menu « Plus » → « Rapport (ancienne
  mise en page) ». À retirer quand Kévin le décide (avec `bacs-audit.hbs`, `_action-group.hbs`,
  `styles-bacs-audit.css`, le `layout` d'`exports.js`).
- **Aperçu de l'application** (cadre sans script) : `mode: 'screen'`, d'un bloc, sans numéros de page.
- **Contrôles** : `npm run check:pdf` mesure le rapport paginé (débordement vertical et horizontal,
  titre seul en bas de page, sommaire) ; test `test/bacs-audit-report.test.mjs`.

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

### Convention soft-delete (Lot 2, mig 124)

3 patterns selon la nature de l'entite :

1. **`deleted_at` (soft-delete)** : entites metier que l'utilisateur peut perdre par erreur et qu'il faut pouvoir restaurer. Filtrer `WHERE deleted_at IS NULL` dans toutes les listes. Tables concernees : `afs`, `sites`, `zones`, `equipments`, `users`.

   - **Cascade transactionnelle** : `sites.softDelete(id)` marque le site + ses zones + les equipements de ces zones avec le **meme timestamp** (capture `strftime('%Y-%m-%d %H:%M:%f', 'now')` une fois). `restore(id)` ne ranime que les enfants dont `deleted_at` matche le timestamp du parent — preserve les suppressions manuelles anterieures. Idem `zones.softDelete` -> equipements.
   - **Users** : hard-delete impossible (FK `created_by`/`updated_by`/`uploaded_by`). `softDelete` coupe l'acces (`getByOidcSub` filtre `deleted_at`) sans casser l'audit trail. `getById` / `getByIds` renvoient TOUJOURS y compris les soft-deleted (pour resoudre les noms dans l'historique). Pour la liste UI, utiliser `users.listActive()` ou filtrer dans la requete.

2. **Tombstones (anti-reseed)** : entites bibliotheque dont la suppression doit empecher le re-seed automatique au prochain boot. Tables : `deleted_section_template_slugs`, `deleted_equipment_template_slugs`, `faq_categories_tombstones`. Le seeder verifie le tombstone avant d'inserer ; les routes POST effacent le tombstone (= resurrection explicite). Pattern complementaire au soft-delete (pas alternatif).

3. **Hard-delete** : tout le reste — logs (`audit_log`), sessions, FTS index, donnees referentielles (`*_catalog`, `*_matrix`), versions immuables (`*_versions`), enfants en cascade FK (`bacs_audit_*`, `equipment_instances`, `sections` — leur cycle de vie est portee par l'AF parente), junctions tables, queues de sync, transients.

## Bibliotheque & Plan AF
- **3 pages dediees** (Lot 32, cf. `frontend/src/router.js:81-106`) :
  - `/library/sections` -> `LibrarySectionsView.vue` (sections types narratives, hierarchie editable)
  - `/library/equipments` -> `LibrarySystemsView.vue` (onglets Systemes + Categories)
  - `/library/functionalities` -> `LibraryFunctionalitiesView.vue` (matrice E/S/P, PDF offres)
- **`section_templates` = source de verite du plan AF** (Lot 33). La structure du plan vit dans cette table. `seeds/plan-af.js` ne fait que bootstrap via migration 26 — modifier `plan-af.js` ne suffit PAS, il faut aussi une migration de bootstrap si on ajoute des nodes.
- **Seeder idempotent** (`lib/seeder.js:77-82`) : n'ecrase JAMAIS les `description_html`, `bacs_articles`, `preferred_protocols` editees manuellement. Pour reseed un champ, le vider explicitement en DB d'abord. Ne jamais "corriger" le seeder pour overwrite.
- **Tombstones de slugs** : 2 tables symetriques pour empecher le re-seed apres suppression UI :
  - `deleted_section_template_slugs` (sections types narratives + fonctionnalites)
  - `deleted_equipment_template_slugs` (equipements de la biblio, mig 95) — `seedLibraryOnBoot` skip si le slug y figure ; routes DELETE/POST `/equipment-templates` posent / effacent le tombstone (resurrection explicite).
  Sans tombstone, suppression UI = recreation au prochain boot ("bug fantome").
- **Cascade manuelle DELETE section_templates** : la FK `sections.section_template_id` n'a pas `ON DELETE CASCADE`. Routes DELETE (`routes/section-templates.js:169-185`) doivent : (1) compter AFs affectees via `countAffectedAfs()`, (2) renvoyer 409 si > 0 et `!force`, (3) `DELETE FROM sections WHERE section_template_id = ?` AVANT, (4) ajouter le tombstone.
- **Niveaux d'offre** : `section_templates.avail_e | avail_s | avail_p` accepte `'included' | 'paid_option' | NULL` (Zod enum strict, `routes/section-templates.js:16`). **La valeur exacte est `'paid_option'`, jamais `'option'`** — bug recurrent. Le `service_level` est *derive* (niveau minimum d'inclusion), pas saisi.
- **PDF tableau offres** = parcours d'arbre (`routes/offerings.js`). DFS sur `parent_template_id`, tri par profondeur, indentation cumulee. Une feature peut avoir des features enfants (nested).

### Sections equipement = biblio uniquement (mig 95)

A la creation d'une AF, **les sections kind='equipment' sont generees exclusivement depuis `equipment_templates`** (= biblio), jamais depuis du hardcode `plan-af.js`. Mecanismes :

- **`section_templates.library_categories`** (TEXT JSON array) sur les parents narratifs `2.1` -> `2.10`. Ex : `2.1 Chauffage & Climatisation` -> `["chauffage", "climatisation"]`. Declare quelles categories d'equipement ce parent accueille.
- **`libraryExtendAf(afId)`** (`lib/seeder.js`) : pour chaque parent du plan, agrege les categories cibles depuis (1) `section_templates.library_categories` + (2) les categories des equipements deja inseres dans cette AF, puis materialise tous les `equipment_templates` de la biblio matchant l'une de ces categories qui ne sont pas deja presents. Idempotent (dedup par `equipment_template_id`).
- **Filet de securite `seedAfStructure`** : skip les section_templates `kind='equipment'` avec `equipment_template_id IS NULL` (l'equipement a ete supprime de la biblio -> FK SET NULL -> on n'instancie pas une section orpheline).
- **Migration 95 (a)** : retire `'af'` du `document_kinds` de tous les section_templates legacy `kind='equipment'`. Effet : ils restent visibles en bibliotheque mais ne sont plus injectes dans les nouvelles AFs.
- **Titre de section** = `equipment_templates.name` quand l'eq_template est rattache (`seedAfStructure.insertNode`, fallback sur `tpl.title`). La biblio est la source de verite des noms d'equipements ; un renommage en biblio est donc reflete sur les nouvelles AFs.

Pour ajouter un nouvel equipement dans la biblio et qu'il apparaisse dans les AFs futures : creer le row dans `equipment_templates` avec un `category` qui matche les `library_categories` d'un parent du plan (ex : `category='climatisation'` -> apparaitra sous `2.1`). Aucun toucher a `plan-af.js` n'est necessaire.

### Pull biblio -> AF (sync manuelle)

`POST /api/afs/:id/sync-library` (body `{ overwrite_bodies?: bool }`) — bouton **Synchroniser depuis la bibliothèque** dans le menu Plus du `CycleBandeau`. Actions cumulees, idempotentes :
1. Resync des titres : `equipment_template.name` (priorite) ou `section_template.title` -> `sections.title`.
2. Insertion des `section_templates` manquants tagges `'af'` (via `missingByAf` + `addMissingTemplateToAf`).
3. `libraryExtendAf` pour materialiser les nouveaux equipements de la biblio.
4. Bump des `section_template_version` / `equipment_template_version` (acquittement, pas de pop-up restant).
5. Optionnel via `overwrite_bodies=true` : ecrasement des `body_html` locaux par le contenu canonique du `section_template`. **Off par defaut** pour preserver les edits utilisateur. La case a cocher dans la modale UI le rend explicite.

Trace dans `audit_log` (action `af.sync.library` + payload des compteurs).

### Engagement de commande du contrat de services (mig 94)

Section type `13.x` sous le chapitre 13 (`slug='engagement-commande-contrat-services'`). Lors de la transition d'AF vers `validee` :
- Modale `CycleBandeau` affiche un bloc d'engagement + checkbox bloquante.
- Bouton « Valider l'AF » `:disabled` tant que la case n'est pas cochee.
- Backend `POST /api/afs/:id/transition` rejette `400` si `to='validee'` sans `agreement_accepted=true` ; trace dans `audit_log` (`payload.agreement_accepted=true`).

## AF detail — performance & UX

### Chargement initial light (perf PR #51)
`GET /api/afs/:afId/sections?light=1` renvoie la structure SANS `body_html` ni `body_yjs` (les BLOB Yjs peuvent peser plusieurs Mo sur des AFs riches), avec un champ derive `is_empty` (1/0 calcule en SQL) pour preserver l'indicateur "section vide" du tree. Le body est rapatrie a la selection via `getSection(id)`.

- `db.sections.listByAfLight(afId)` : variante SQL.
- `frontend/src/stores/af.js` `loadAf` / `refreshSections` -> `light: true`.
- `CycleBandeau.loadSectionsForPicker` aussi en light (titres + parent_id suffisent).
- `SectionTree.isEmpty(node)` lit `node.is_empty` quand fourni, fallback sur `body_html`.

### Cache localStorage de la structure (perf PR #52)
Pattern stale-while-revalidate dans `stores/af.js`. Cle `af-<id>-structure-v1`, TTL 7 jours. `loadAf` hydrate immediatement depuis le cache (tree visible en 0 ms sur revisite), puis lance le refresh reseau en arriere-plan qui ecrase le cache. Helpers `readCache` / `writeCache` privates au store.

### Tree-shake FA Pro Solid (perf PR #52)
Sans precaution, `import * as allSolidIcons from '@fortawesome/pro-solid-svg-icons'` + `Object.values(...)` defait le tree-shaking — Vite hoist les ~3000 icones (~2.5 Mo) dans le chunk du 1er consommateur. Strategie en 3 couches :

1. **`frontend/src/lib/equipment-icons.js`** : registre cure (~37 icones) avec named imports + `library.add(...ICONS)` + `resolveFaIconName(iconValue)` -> nom valide ou `'cube'` fallback. Couvre les icon_value seedees dans `equipment-templates/*.js` + system_categories_db.
2. **Composants au runtime** (EquipmentIcon, SearchableSelect, SectionTreeNode, MeterTypePill, MeterUsagePill, SystemCategoryIcon) : importent UNIQUEMENT depuis `lib/equipment-icons.js` ou en named explicit. **Jamais `import *`**.
3. **Pickers admin** (FaIconPicker, EquipmentTemplateEditor, SystemCategoryEditor, LibraryFunctionalitiesView) : `await import('@fortawesome/pro-solid-svg-icons')` au mount — la full lib charge a l'ouverture du picker, pas avant.
4. **`vite.config.js` `manualChunks`** : force `@fortawesome/pro-solid-svg-icons` dans son propre chunk `fa-pro-solid` (charge a la demande). Sans ce split, Vite hoist le module dans le chunk du 1er consommateur, gonflant `equipment-icons.js` a 2.5 Mo.

Mesure : chunk sur le chemin AF passe de **2.5 Mo a 80 Ko**. Le chunk `fa-pro-solid` (2.5 Mo) ne se charge QUE sur les routes admin avec un picker.

**Regle** : ne jamais reintroduire `import * as allSolidIcons` sur le chemin AF detail. Si une nouvelle icone est requise au runtime, l'ajouter au registre cure de `lib/equipment-icons.js`.

### Async components AfDetailView (perf PR #52)
`defineAsyncComponent(() => import('...'))` sur les composants poids lourds (Tiptap, captures, instances, etc.) :
SectionEditor, PointsTable, EquipmentInstancesTable, AttachmentsGrid, ZonesTable, EquipmentDescriptionPanel, EquipmentTemplatePicker, TemplatePropagationBanner, ActivityPanel, RequiredServiceLevelPanel.
Resultat : chunk AfDetailView 179 Ko -> 102 Ko ; le tree est paint avant que Tiptap charge. Le `TemplatePropagationBanner` retarde son 1er fetch via `requestIdleCallback` (fallback `setTimeout 200ms`) pour ne pas concurrencer le paint initial.

### Tree actions au survol (PR #52)
`SectionTreeNode` rend au hover :
- **↑ / ↓** : reordonner dans la fratrie (events `move-up` / `move-down`)
- **← / →** : indenter / outdenter (events `outdent` / `indent`)
- **Œil**, **+**, **Suppr**, etc.

Backend : `POST /api/sections/:id/move` accepte `direction ∈ ('up'|'down'|'indent'|'outdent')`.
- `indent` : la section devient enfant de son sibling precedent (placee en derniere position dans ce nouveau parent).
- `outdent` : remonte d'un niveau (devient frere de son parent, juste apres lui dans la fratrie du grand-parent).
Le drag-drop SortableJS reste disponible en parallele pour les deplacements rapides cross-fratries.

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
- **Auto-generated items immuables sur metier** (`routes/bacs-audit.js:501-507`) : items `auto_generated=1` n'acceptent en UPDATE QUE `estimated_effort, status, position, alternative_solutions_html` (`commercial_notes` : colonne dormante, retirée de l'UI). Toute ecriture sur `title`/`description`/`severity` est ignoree silencieusement. DELETE refuse en 400 (status=declined a la place).
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

## Base de connaissance reglementaire BACS (Lot 173)

Table `bacs_knowledge` + index FTS5 `bacs_knowledge_fts` (migration 173).
Source unifiee pour : (1) le MCP de Fleet Manager qui pilote Buildy Docs au nom
de l'utilisateur — outils `bacs_knowledge_*` du domaine `buildy_audit` ;
(2) les futures fonctionnalites UI (badges decret sur les sections, suggestions
sourcees, etc.).

### Schema
- `source ∈ ('decree','gov_faq','gov_guide','profeel')` — la provenance.
- `authority ∈ ('opposable','official','professional','internal')` — le poids juridique.
- `kind ∈ ('article','faq_qa','guide_section','glossary_term')` — le type d'entree.
- `code` (TEXT, unique recommande dans une source) — identifiant stable :
  `R175-3`, `FAQ-12`, `GUIDE-1.1`, `PROFEEL-3.1.1`.
- `title`, `body_text` (NOT NULL), `body_html` (HTML conserve pour les FAQ).
- `r175_refs` (TEXT) — codes R175 cites dans le corps, separes par virgule
  (extraction regex `extractR175Refs`). Utilise par `authoritative-lookup` pour
  filtrer par article.
- `source_url`, `source_page`, `version_label`, `position`, `fetched_at`.

### Hierarchie d'autorite (toujours respecter)
1. **opposable** — Decret R175 (seule source juridiquement opposable).
2. **official** — FAQ ministerielle (30 entrees, mise a jour juin 2025) + guide
   d'application V2 ministere (janvier 2026).
3. **professional** — Guide PROFEEL v1.1 (novembre 2025), interpretation metier.
4. **internal** — Methodologie Buildy (lib/bacs-audit-methodology.js, non
   ingere dans `bacs_knowledge`).

Toute reponse construite par un agent (Claude via MCP, futur assistant UI) doit
citer le decret EN PREMIER s'il s'applique, puis les sources officielles, puis
PROFEEL en interpretation. Jamais l'inverse.

### Endpoints `/api/bacs-knowledge/*`
- `GET /search?q=&source=&kind=&limit=` — recherche FTS5 prefixe, classee par
  bm25.
- `GET /by-source/:source?kind=&limit=` — sommaire d'une source.
- `GET /by-code/:code` — texte integral d'une entree (404 si introuvable).
- `GET /authoritative-lookup?q=&r175=` — vue hierarchique multi-sources :
  retourne `{ decree, gov_faq, gov_guide, profeel }` chacun avec les 5 meilleurs
  extraits.
- `GET /glossary` — termes `kind='glossary_term'`.

Pas d'auth specifique au-dela des gardes Docs habituelles (cookie OIDC ou
Bearer `BUILDY_DOCS_MCP_TOKEN` + headers `X-Buildy-Act-*`).

### Ingestion (`backend-node/scripts/bacs-knowledge/`)
- `decree-articles.json` — texte integral du decret R175 extrait de Notion
  (9 entrees : R175-1 a R175-6 + analyses historique/ISO 52120).
- `fetch-gov-faq.mjs` — scrape les 30 FAQ ministerielles
  (`rt-re-batiment.developpement-durable.gouv.fr/faq-bacs-NN-...html`) via
  cheerio, ecrit `gov-faq.json`. Liste exhaustive des slugs hardcoded
  (mise a jour si le ministere en ajoute).
- `ingest.mjs` — point d'entree unique :
  1. Charge `decree-articles.json` -> source `decree`, authority `opposable`,
     kind `article`.
  2. Charge `gov-faq.json` -> source `gov_faq`, authority `official`,
     kind `faq_qa`.
  3. Parse `../docs/guide_bacs_janvier_2026.pdf` (pdf-parse v2 `PDFParse` class
     API) -> source `gov_guide`.
  4. Parse `../docs/guide-bacs-profeel.pdf` -> source `profeel`.

**Heuristique de chunking PDF (`chunkByHeadings`)** : detecte deux conventions
de titres :
- Avec point (guide ministere) : `1.`, `1.1.`, `1.2.1.` + libelle Capitale.
- Sans point (PROFEEL) : `1`, `3.1.1` + titre EN MAJUSCULES.
+ filtre `NOISE_RE` qui retire les pieds/entetes recurrents (`-- N of M --`,
`<num>\tGuide pratique...`, `<num> Guide d'application...`).
+ post-traitement : tout titre qui apparait >= 3 fois est considere comme un
en-tete de page mal capture — son body est rapatrie dans la section reelle
precedente.

Ingestion **idempotente** : `DELETE FROM bacs_knowledge WHERE source = ?` avant
chaque INSERT par source. Rejouer le script ne cree pas de doublons.

**Relancer** apres mise a jour des sources :
```bash
cd buildy-docs/backend-node
node scripts/bacs-knowledge/fetch-gov-faq.mjs   # si la FAQ ministere change
node scripts/bacs-knowledge/ingest.mjs          # repeuple la table
```
Le serveur Docs n'a pas besoin d'etre relance (FTS5 reagit aux triggers AI/AD/AU).

## Source unique de vérité pour les chiffres d'un audit (helpers ternaires)

Beaucoup de champs métier de l'audit BACS sont **ternaires** (null / 0/false /
1/true). L'incident audit Communay (mai 2026) — Claude a présenté « 0 communicants »
alors qu'aucune question n'avait été répondue — a révélé que chaque consommateur
(PDF, MCP, UI, _compliance-summary, _preview-fixture) utilisait son propre
filtre truthy qui collapsait silencieusement `null` en `false`.

### Helper centralisé `_ternary.js`

Tout nouveau compteur d'agrégation sur un champ ternaire DOIT passer par :

```js
const { isTrue, isFalse, isUnanswered, ternaryCounts } = require('./_ternary');

// Trois compteurs séparés pour le champ managed_by_bms :
const { true_count, false_count, unanswered_count } = ternaryCounts(devices, 'managed_by_bms');
```

**Interdiction stricte** d'écrire `arr.filter(x => x.managed_by_bms)` (truthy JS)
ou `arr.filter(x => x.managed_by_bms === 1)` (oublie `true`) ailleurs. Le helper
unique est la garantie qu'on ne réintroduira pas le bug Communay.

Côté FM (MCP), équivalent ESM dans
[`edge-fleet-manager/backend-node/src/lib/audit-ternary.mjs`](../edge-fleet-manager/backend-node/src/lib/audit-ternary.mjs).

### Vérifier la cohérence PDF ↔ MCP avant release

Script [`scripts/verify-audit-coherence.mjs`](scripts/verify-audit-coherence.mjs)
qui pour un ou plusieurs audits récupère le bundle d'export PDF (recapStats)
ET recalcule en local le résumé MCP, puis compare chiffre à chiffre :

```bash
BUILDY_DOCS_TOKEN=<cookie_docs_token> \
  node scripts/verify-audit-coherence.mjs --audit-ids 43,44,45
```

Doit retourner « ✓ Tous les audits sont cohérents. » avant toute release qui
touche aux calculs d'agrégation (`recapStats`, `devices_summary`,
`meters_summary`, `_compliance-summary`, `_export-data`, `_preview-fixture`).

### Cas connus de ternaires à respecter

| Entité | Champs ternaires (null / 0 / 1) |
|---|---|
| `bacs_audit_systems` | `present`, `not_concerned`, `meets_r175_3_p3`, `meets_r175_3_p4`, `meets_r175_3_p4_autonomous`, `managed_by_bms`, `marked_negligible_under_5pct`, `is_district_heating_substation`, `serves_multiple_buildings` |
| `bacs_audit_system_devices` | `wired`, `meets_r175_3_p4`, `meets_r175_3_p4_autonomous`, `managed_by_bms`, `is_backup`, `out_of_service`, `bms_integration_out_of_service` |
| `bacs_audit_meters` | `present_actual`, `required`, `communicating`, `managed_by_bms`, `out_of_service` |
| `bacs_audit_bms` | `present` (singleton GTB), `meets_r175_3_p1`, `meets_r175_3_p2`, `has_maintenance_procedures`, `operator_trained`, `out_of_service` (tenu d'accord avec `functional_state`, voir ci-dessous) |
| `documents` | `audit_existing_af_status` (text ternaire : 'present' / 'absent' / null) |

## Toggles Oui/Non pour saisies binaires (cf. memoire feedback_segmented_control_for_binary_state)

L'audit BACS expose beaucoup de questions binaires (présent / absent, intégré /
non intégré, communicant / non, etc.). On a banni les **checkboxes uniques** au
profit de **toggles à deux boutons côte à côte** pour éviter l'ambiguïté
« décoché = non répondu OU réponse non ».

**3 composants, chacun pour son contexte** (tous fonctionnellement équivalents,
mais avec un look adapté). Pas un doublon problématique — chacun a sa niche :

| Composant | Look | Usage |
|---|---|---|
| `components/audit/SegmentedToggle.vue` | Boutons libellés "Oui / Non / Partiel", vert charte Buildy #00cd92 | Formulaires desktop (questions R175 dans BmsSection, IdentificationSection, SystemsSection, DeviceEditModal). Supporte ternaire (`null` = non répondu). Prop `disabled` pour les questions dont le prérequis n'est pas rempli. |
| `components/mobile-audit/MobileYesNo.vue` | Carte plein largeur, 44px tactile, charte Buildy | Sheets mobiles (MobileBmsTab, MobileSystemsTab, MobileSiteTab). Ternaire idem. |
| `components/SegmentedToggle.vue` | Compact icônes ✓ / ✗, min-width 36px desktop / 48px tactile | Tables denses (MetersSection desktop + mobile, BmsSection tables Équipements / Compteurs intégrés). Prop `compact`, `yes-danger` pour les "oui rouge" (HS). |

**Patterns d'usage** :
- Question = label + toggle à droite : `<div class="flex items-center justify-between"><span>Question ?</span><Toggle ... /></div>`.
- Reformuler les labels en QUESTIONS explicites (pas en affirmations) : `Présent ?` plutôt que `Présent`, sinon le toggle est ambigu (« coché Oui = présent ou pas ? »).
- Pour les disabled (prérequis manquant) : `:disabled="!prereq"` + `:tooltip="'Réponds d’abord X'"`
  (propriété `tooltip` des deux SegmentedToggle, portée par le conteneur : visible même grisé ;
  jamais `title`). Bouton grisé ordinaire : enveloppe `<Tooltip :text="raison">` (cf. § Infobulles).
- Pour les cards multi-select cliquables (5 usages traités par la GTB), faire la **card entière** click-toggle plutôt que de mettre une checkbox dedans.

**Patch côté serveur** : envoyer **boolean strict** (`true`/`false`), pas
`0`/`1`. Le schema Zod serveur est `z.boolean().nullable().optional()` et
refuse les entiers → 400 Bad Request silencieux.

## Infobulles (UI) — système unique `v-tooltip` (2026-10-12)

Porté de Buildy Tools (même rendu, charte commune). Demande de Kévin : toutes les infobulles
navy, aérées, icônes colorées, langage simple pour un non-expert du décret BACS, très peu de
retours à la ligne, placement parfait (jamais sur l'élément survolé, toujours entières).

- **Une directive globale** `v-tooltip` (`frontend/src/lib/tooltip.js`, `installTooltips` dans
  `main.js`) et **une seule bulle** rendue par `components/tooltip/TooltipHost.vue` (montée dans
  `App.vue`, chargée au premier survol ou au repos : hors du bundle de démarrage). Jamais
  `title=` natif (lent, gris, invisible au doigt), jamais de bulle faite main.
- **Deux formats, tous deux navy** (`bg-primary` = #1b2842) :
  - **étiquette** : `v-tooltip="'Supprimer ce compteur'"` ou `{ label, keys: ['Mod','B'], icon }`.
    12 px, jusqu'à 460 px de large (640 px pour le texte complet d'un texte coupé, `.overflow`), icône choisie d'après le premier mot (`labelIcon` /
    `VERB_ICONS` de `lib/tooltip-content.js` : poubelle rouge pour « Supprimer »…) ;
  - **carte** : `v-tooltip="{ title, text, tone, accent, icon, rows, todo, article, meta }"`,
    300 à 540 px. `tone` ∈ success / warning / error / info / neutral (alias de pastilles
    acceptés). `accent` = couleur et icône métier (`heating`, `cooling`, `ventilation`, `dhw`,
    `lighting`, `pv`, `electric`, `gas`, `water`, `thermal`, phases `site` / `equipment` /
    `supervision` / `dossier`). `rows: [{ label, value, icon?, tone?|accent? }]` = faits
    « clé → valeur ». `todo` = encadré « À faire ». `article: 'R175-3'` → pied discret
    « Décret BACS · article R175-3 ».
- **Modificateurs** : `.right` `.bottom` `.left` (côté préféré), `.keep` (reste après un clic),
  `.touch` (s'ouvre au doigt), `.overflow` (seulement si le texte est coupé ; sans valeur =
  texte visible de l'élément). Valeur fonction = évaluée au survol. Valeur vide = pas de bulle
  (l'ancre devient transparente : la bulle du parent s'affiche).
- **Bouton grisé** : un bouton désactivé ne reçoit pas le survol → la raison est portée par
  l'enveloppe `<Tooltip :text="raison"><button :disabled>…</button></Tooltip>` (`data-tip-wrap`,
  règle CSS dans `main.css`). Interrupteurs Oui/Non : propriété `tooltip` de `SegmentedToggle`
  (les deux), portée par le conteneur.
- **Délai d'apparition** (demande de Kévin, « comme le veut la norme ») : `lib/tooltip-timing.js`,
  source unique pour `v-tooltip`, la fiche du décret et les repères des cartes Google Maps.
  400 ms avant la première bulle (survol ou focus clavier) ; ensuite **aucun délai** vers
  l'élément voisin tant qu'une bulle est ouverte ou fermée depuis moins de 300 ms ; **immédiat**
  au toucher et au clic sur un ⓘ / une pastille / un bouton grisé (demande explicite). Un clic
  d'action pendant l'attente, Échap, le défilement ou un changement de page annulent la bulle
  en attente. Ne jamais réintroduire d'affichage instantané au survol.
- **Fondu** (demande de Kévin, « comme ce qu'il se fait de mieux ») : `tooltipMotion()` de
  `lib/tooltip-timing.js` (Web Animations API), utilisé par `TooltipHost`, la fiche du décret et
  les étiquettes des cartes.
  - Ouverture en 160 ms : fondu, glissement de 4 px depuis l'élément survolé (côté calculé
    après placement), zoom 0,97 → 1 depuis la flèche, courbe `cubic-bezier(0.16, 1, 0.3, 1)`.
  - Fermeture en 110 ms, courbe « ease in » : la bulle reste affichée, contenu figé, le temps de
    s'effacer.
  - D'un élément au voisin, ou si une bulle s'ouvre pendant l'effacement : changement sur place,
    sans fondu.
  - `hideTip({ instant: true })` (défilement, redimensionnement, changement de page, élément
    retiré) : sans fondu.
  - « Réduire les animations » du système : fondu seul, sans mouvement.
  - Le placement reste sur la boîte `#bd-tooltip`, l'animation sur son enveloppe intérieure :
    pour mesurer la position d'une bulle (tests), attendre la fin du fondu (≈ 200 ms).
- **Comportement** : une bulle à la fois, retournement et 8 px des bords, centrée sur
  le curseur pour une ancre large, jamais par-dessus l'ancre ; clavier (focus visible, Échap
  ferme la bulle sans fermer la fenêtre) ; au doigt (PWA) : cartes seulement, sur un ⓘ
  (`HelpTip`, `.touch`) ou une pastille hors bouton ; `aria-label` automatique sur un bouton à
  icône seule, `aria-describedby`, `aria-keyshortcuts`. Couche `z-[1100]` (au-dessus des
  modales 110–120 et des notifications 200) ; fiche du décret `R175Tooltip` en `z-[1090]`.
- **Fiche du décret** (`components/R175Tooltip.vue`, ⓘ à côté des titres) : même navy, bloc
  « En clair » (`lib/decree-plain.js`), puis texte officiel (bacs_knowledge), puis « Ce que
  vérifie l'audit ».

### Rédaction (règles de Kévin, 2026-10-12)
- **Étiquette** : infinitif + objet, ≤ 40 caractères, sans point, jamais « Cliquer pour ».
- **Carte** : titre ≤ 6 mots ; 1–2 phrases simples (≤ 160 caractères) ; faits dans `rows`,
  conseil dans `todo`. Une bulle de bouton grisé dit **pourquoi** et **quoi faire**.
- **Sans jargon** : jamais « R175-3 1° », « P3 », « HS »… dans le texte. On dit l'idée ; l'article
  va en pied (`article`). Acronymes développés (CTA, ECS, DRV, PCBT, PV…). Vocabulaire maison :
  système / équipement / catégorie d'usage / GTB. Aucun anglais (snapshot, sync, chiller,
  template, credential, override, process, firmware…).
- **Tutoiement** quand la bulle s'adresse à l'utilisateur (convention BD).
- **Typographie** : accents, ’, « », espace insécable devant « : », jamais « (s) »
  (`plural(n, 'compteur', 'compteurs')`), pas de `\n` (→ carte), « … » (pas « ... »), dates
  lisibles, chiffres dans la police de l'app (pas de `font-mono`).
- **Glossaire du décret en clair** (aussi pour les textes visibles de l'audit) :
  R175-2 = le bâtiment est concerné (tertiaire, > 70 kW) · R175-1 6° = zone fonctionnelle
  (locaux aux usages homogènes) · R175-3 1° = suivre les consommations heure par heure, par zone
  et par usage · 2° = repérer les dérives · 3° = dialoguer avec les équipements, quelle que soit
  leur marque · 4° = arrêt manuel et fonctionnement autonome · R175-4 = vérifier la GTB
  régulièrement · R175-5 = former l'exploitant · R175-5-1 = inspection périodique · R175-6 =
  réguler la température pièce par pièce.
- **Contenus à côté de leur logique** (fonctions pures, imports relatifs, testées côté backend ;
  un module par domaine, réutilisé par le bureau ET le mobile) :
  - audit : `lib/audit-tips.js` (étapes, compteurs), `lib/audit-tips-systems.js` (systèmes,
    équipements, fonctions, GTB, tableau de présence), `lib/audit-tips-site.js` (site et verdict
    d'assujettissement, zones, régulation, check-list, inspections, plan d'actions, documents,
    accès), `lib/audit-tips-shell.js` (cadre de l'audit, barre d'outils, photos, notes vocales,
    partage, coût de Claude), `lib/meter-plan-state.js` (comptage commun / non exigé) ;
  - décret en clair : `lib/decree-plain.js` (une phrase par article, aussi pour la fiche ⓘ) ;
  - hors audit : `lib/af-tips.js` (AF, statuts, offres), `lib/editor-tips.js` (arbre des
    sections, éditeur, points), `lib/library-tips.js` (bibliothèque), `lib/faq-tips.js` (FAQ,
    administration), `lib/misc-tips.js` (sites, accueil, livres blancs, brochures, dates lisibles) ;
  - sigles et protocoles affichés tels quels : `lib/acronym-tips.js` (`protocolTip`, `abbreviationTip` ;
    un sigle de zone ou de catégorie resté sans bulle → l'ajouter à `ABBREVIATIONS`).
- **Icône d'une étiquette** : `VERB_ICONS` est lu sur les deux premiers mots, puis sur le premier
  (`'eau chaude'` → robinet, `eau` → goutte). Un premier mot sans icône → l'ajouter à `VERB_ICONS`.
- **Icônes** des bulles : `lib/tooltip-icons.js` est GÉNÉRÉ (`node frontend/scripts/gen-tooltip-icons.mjs`,
  à relancer après avoir cité une nouvelle icône ; `--check` pour vérifier). Import depuis
  free-solid, hors du chunk pro de 2,5 Mo.
- Typographie automatique (`typo()` de `tooltip-content.js`) : apostrophe ’, espaces insécables
  dans « », devant « : ; ! ? » et entre un nombre et son unité.

### Garde-fous
- `node frontend/scripts/tooltip-lint.mjs [--files|--list] [--strict] [cibles]` : lit les
  gabarits (`@vue/compiler-sfc`) et les expressions (`@babel/parser`). Règles : `html-title`,
  `iframe-title`, `component-title-prop` (v-tooltip posé à la place du `title` d'une modale :
  bug historique), `tip-on-fragment`, `old-tooltip`, `icon-button-no-tip`, `truncate-no-tip`,
  `tip-copy`, `tip-raw-data` ; avertissements `disabled-tip-on-control`, `tip-long-label`.
  Objectif : **0 erreur**.
- Tests : `backend-node/test/tooltip-{position,content,timing}.test.mjs` (+ contenus métier), lancés
  par `cd backend-node && npx vitest run`.
- Galerie : route cachée `/style-guide` (étiquettes, cartes, tons, accents, cas limites).

## Étape Systèmes : mise en page guidée (2026-10-13)

**Une seule mise en page** (Kévin, 2026-10-15, v0.1.277) : le bouton « Mise en page : Actuelle /
Nouvelle » et tout le code de l'ancienne (« Actuelle », `classic`, `!guided`) sont retirés —
`composables/useAuditLayout.js`, `SystemDevicesTable.vue`, `DeviceAddModal.vue`,
`VerticalStepper.vue` supprimés ; `SystemDeviceList`, `SystemsPresenceMatrix`, `CreateSystemModal`,
`DeviceMoveShare`, `RubricShell`, `MeterEnergyGroup`, `SiteDocumentsManager` n'ont plus que leur
forme guidée. Retrait vérifié pixel par pixel (12 étapes × 6 audits, onglets, fiches). Les clés
`bacs-audit-layout*`, `bacs-systems-layout` et `bacs-zone-collapse:*` du navigateur ne sont plus lues.
Le mode « sans étapes » (`isStepMode` faux, page unique) reste dans le code, jamais atteint.
Règle de Kévin : jamais moins pratique (aucune fonction perdue, jamais plus de clics) et **aucune
réponse en masse**. `DeviceEditModal` garde ses deux formes : rubriques (fiche à droite) et fiche
entière (fenêtre « Agrandir »).

- **Guidée** (« piste D ») : trois états partout — « à compléter » (information manquante),
  « à vérifier » (règles du pré-contrôle de livraison `GET /bacs-audit/:id/precheck` + production
  sans puissance `power_summary.incompletePowerDeviceIds`), « sans réponse » (ni présent ni non
  concerné). Pastilles sur les onglets, guide des usages à gauche (`SystemsGuideRail`), lignes
  « reste à faire » et filtre (`SystemsGuideSummary`), un seul tableau par zone
  (`SystemDeviceList` `guided` / `header-only` / `compact`), fiche seulement ouverte
  (`SystemsGuidePanel` : cartes « à vérifier », « Suivant à reprendre » qui enchaîne les points de
  toute l'étape), synthèse avec totaux et colonne « Reste à faire » (`SystemsPresenceMatrix`
  `guide`), fenêtres guidées (`DeviceAddGuidedModal`, `CreateSystemModal` `variant="tiles"`,
  `DeviceMoveShare` `searchable`).
- Logique pure : `lib/systems-guide.js` (états, compteurs, parcours ; mêmes règles de comptage que
  l'ancienne mise en page). Textes : `lib/audit-tips-systems-guide.js` (un texte en clair par
  code du pré-contrôle). Tests : `backend-node/test/systems-guide.test.mjs`,
  `audit-tips-systems-guide.test.mjs`. Un nouveau code du pré-contrôle à afficher dans l'étape :
  l'ajouter à `CHECK_DEVICE_CODES` / `CHECK_SYSTEM_CODES` ET son texte dans `CHECKS` (le test
  échoue sinon).

### Complétude d'un équipement : une seule règle (décisions de Kévin, 2026-10-13)
Toute question affichée par la fiche doit avoir sa réponse (bug d'origine : « dispose d'une
régulation ? » vide sur une fiche « complète »). Source unique : `deviceMissingItems(device,
catégorie de l'usage d'ORIGINE)` de `lib/audit-options.js` → `{ key, section, label }`, rubriques
`DEVICE_SECTIONS` ; `deviceMissingFields` / `isDeviceComplete` en dérivent (deux mises en page,
mobile, bandeau de l'étape, guide).
- Régulation Oui/Non ; si Oui : intégrée ou déportée, et le type de régulation de chaque fonction
  (production, distribution, émission). « Régulation : Non » efface les réponses devenues cachées :
  fiche bureau et mobile, et serveur au passage à Non (`clearRegulationAnswersOnNo`, PATCH devices,
  pour les appels MCP) ; mig 215 = rattrapage de l'existant. Exception voulue (Kévin, 2026-10-13) :
  un type choisi depuis l'étape Régulation sur un équipement déjà à Non est gardé
  (« Équilibrage hydraulique » d'un circuit sans régulation, Rexel) ; la mig 215 laisse aussi
  les équipements désignés dans l'étape Régulation et les audits livrés.
- « Dessert plusieurs bâtiments ? » (vide comptait « non » dans la répartition des responsabilités).
- Puissance (ou « puissance inconnue ») d'une production de chauffage ou de froid comptée dans le
  seuil des 70 kW (hors secours, hors service, « hors cumul »).
- Fonction exigée pour tous les usages sauf la production PV (PV : ni fonction, ni énergie, ni
  comptage séparable : la fiche les masque).
- Équipement hors du périmètre GTB (« Non ») : liaison câblée, arrêt à la main, fonctionnement
  seul non exigés.
- « Faut-il raccorder cet équipement à la GTB ? » (`gtb_scope_override` : null = Oui, false = « Non,
  pas à raccorder » ; true n'est plus proposé) : le **motif** `gtb_exclusion_reason` (mig 217, 300
  caractères) est exigé pour une production de chauffage, froid, ventilation ou eau chaude, facultatif
  ailleurs (cas d'origine, Kévin 2026-10-15 : unité extérieure de DRV pilotée par ses unités
  intérieures, raccordées par une passerelle CoolMaster). Un motif lève DEV-007 du pré-contrôle (un
  système exempté par la règle des 5 % aussi) ; repasser à « Oui » efface le motif (PATCH devices et
  correction en un clic `reset_gtb_scope_override`). Imprimé dans les deux rapports (ligne de détail
  de l'équipement, tableau de la GTB, verdict « non évalué » du système). Fiche bureau seulement : le
  mobile n'a pas la question.
- Usage d'eau chaude présent : bouclage (Bouclée / Non bouclée / Inconnu) exigé.
Un nouveau manque → son libellé court dans `MISSING_SHORT` (`lib/systems-guide.js`, test).

**Bandeau de l'étape** (`STEP_DEFINITIONS.systems`) = `systemsStepTodo` (`lib/systems-guide.js`) :
usages sans réponse, usages présents sans équipement, bouclage manquant, équipements incomplets ;
un équipement partagé compte une fois (usage d'origine s'il est présent, sinon le premier usage
présent qui le partage). « À vérifier » ne bloque pas (contrôlé à la livraison). Le verrou serveur
`bacs-audit-step-completion.js` reste plus souple (validation par l'API / MCP) : à aligner.

**Mise en page guidée, maquette « piste D »** : fiche en rubriques (`DeviceEditModal` props
`rubrics` + `checks`, en-têtes `DeviceSectionHeader.vue` : état ✓ / à compléter / à vérifier,
résumé d'une ligne ; « Le reste à faire » / « Toute la fiche », `localStorage`
`bacs-device-rubrics` ; `openRubric()` pour les boutons « Corriger dans … ») ; ligne de faits sous
le nom ; fiche de 440 à 620 px ; « Déplacer ou partager » en une fenêtre à onglets
(`DeviceMoveShare` prop `dialog`) ; pastille « N puissances manquantes » dans l'en-tête ; fondu
sur le bord de la barre des zones (`AuditSubTabs` prop `scrollHints`).

**Hiérarchie visuelle (retour de Kévin : « tout se mélange »)** — trois niveaux, trois traitements,
comme un schéma technique où chaque circuit a sa couleur (`lib/system-fluids.js`, mêmes teintes que
`SystemCategoryIcon`) : un usage = une carte séparée (fond gris clair autour), bandeau de tête teinté
de sa couleur (`--fluid-tint`) ; un équipement = une ligne, production en tête (point plein, nom en
gras), équipements desservis décalés et reliés par le trait du circuit (`--fluid`) ; une rubrique de
la fiche = une carte (icône, titre, résumé sur une 2e ligne, état à droite, bandeau teinté selon
l'état quand elle est ouverte).
**Filtre par usage** (demande de Kévin, 13/10) : en tête du guide de gauche, « Tous les usages »
(par défaut) ; un clic sur un usage n'affiche plus que ce système (rappel « Seulement l'usage … »
au-dessus de la liste), le résumé, les compteurs et précédent / suivant de la fiche suivent ; le
parcours « Reprendre » déplace le filtre ; remis à « Tous » à chaque changement de zone.

## Autres étapes : même mise en page (2026-10-13)

Même langage que l'étape Systèmes : le reste à faire en tête (encadré orange + « Aller au
premier »), filtres en pastilles (« À compléter », « Non conformes »…), chaque groupe dans sa carte,
une couleur = un sens (usage / énergie / état, jamais décoratif), une ligne par élément.
**Vérifier un changement d'affichage au pixel près** : copie de l'interface de référence (`rsync` de
`frontend/` sans `node_modules`, lien symbolique vers ceux du dépôt, `server.fs.allow` dans la copie
de `vite.config.js`), Vite sur un autre port, captures pleine page des 12 étapes, puis comparaison
pixel par pixel ; attendre la fin du chargement de l'audit (bandeau de l'étape affiché, plus de
« Chargement… »), un seul navigateur à la fois. Bruit connu : carte Google de l'étape Zones,
lissage de 1 à 2 niveaux, sommaire collant de la GTB à 1 024 px (calque composité).

- **Pièces communes** (`components/audit/guided/`) : `RubricShell` (rubrique repliable, en-tête
  `DeviceSectionHeader`, qui accepte aussi `unanswered` = « sans réponse » en pointillés), `RubricsFilter` (« Le reste à faire / Toute
  l'étape »), `AuditGuideRail` (guide de gauche, une ligne par rubrique), `composables/useStepRubrics.js`
  (ouverture des rubriques, `localStorage` `bacs-step-rubrics`). Textes : `lib/audit-tips-guided.js`.
- **Bandeau** : chaque étape publie ses questions encore sans réponse (`AUDIT_STEP_NOTES_KEY`,
  `provide` de la vue) ; le bandeau les liste dans « Encore à renseigner — ne bloque pas la
  validation » et ne dit plus « Tout est renseigné ». Deux niveaux partout : « à compléter » = ce
  que l'étape exige (mêmes règles que `STEP_DEFINITIONS`), « sans réponse » = question affichée vide.
- **Identification** : verdict en tête (libellé, puissance retenue, permis), 4 rubriques
  (`lib/identification-guide.js`). **Zones** : groupes « Zones fonctionnelles » / « Locaux
  techniques » (`lib/zones-guide.js`), pastille par zone, champs sans objet des locaux techniques
  en « — ». **Régulation** : trait de couleur du circuit, verdict par système
  (`lib/thermal-guide.js`, mêmes règles que le plan : émission par pièce / par zone, froid non
  évalué, émetteur sans régulation renseignée = « à préciser ») ; émetteur et production manquants
  en orange, la distribution reste facultative (`ThermalLevelCell` `device-optional`) ; point orange
  dans le verdict d'un système « à préciser » ; filtre « À compléter » = tout ce qui bloque. **Compteurs** : carte par énergie teintée, une ligne
  par compteur (usage, puis ce qu'il mesure sans « Électricité consommée par : »), filtres « À
  compléter » / « Requis manquants » qui ouvrent l'énergie concernée. **GTB** : guide des 12 rubriques
  (`lib/bms-guide.js`), « Reprendre les N rubriques ». **Check-list** : « Photos du site » avec
  progression, « Pièces du dossier » avec l'état de chaque pièce. **Plan d'actions** : gravité en
  barre de couleur, numéros en chiffres Sora, filtre « Sans préconisation ».
- **Documents** (2026-10-14) : `SiteDocumentsManager` prop `guided` (utilisé par l'audit seul) —
  groupes par rattachement (`lib/documents-guide.js` : documents du site, pièces de la check-list
  triées par point, GTB, éléments, actions et inspection), catégorie en `SearchableSelect`, pastille
  « Rattaché à » sans le type redit par le groupe, ligne « N documents · N joints au rapport ».
  **Inspections** : une réponse « Non » qui garde des inspections enregistrées est signalée (encadré +
  bandeau), sans rien effacer ; les inspections sans date autres que la plus récente (déjà dans
  « Reste à faire ») sont rappelées. **Synthèse** : le bandeau rappelle les étapes pas encore
  validées (la note reprend l'audit tel qu'il est ; la note périmée était déjà signalée).
- **Inchangée** : Accès (une à trois lignes par site, déjà compact).
- **Questions sans réponse = bloquantes** (décision de Kévin, 2026-10-14, comme à l'étape Systèmes) :
  `lib/step-unanswered.js` ajoute aux `STEP_DEFINITIONS` de la vue, dans les **deux** mises en page :
  Identification (structure de propriété, audit BACS rattaché à un site, fiche du site chargée),
  Zones (nature ; régime et surface des zones fonctionnelles), Régulation (émetteur — dispense bois
  déduite du générateur comprise —, équipement de production, type de régulation de chaque
  équipement désigné), Compteurs (présence des compteurs requis), GTB (questions des rubriques,
  sauf facultatives GTB hors service ; liste complète d'un coup, plus d'arrêt au premier manque ;
  documents d'analyse fonctionnelle comptés par la vue via `siteDocCounts.af`, recompte sur
  l'événement `site-documents:changed`, émis aussi par `SiteDocumentsManager`), Inspections
  (inspections sans date autres que la plus récente). Les étapes calculent leurs états avec les
  mêmes fonctions (`bmsStepRubrics`, `thermalGuideForRow`). Restent dans « Encore à renseigner —
  ne bloque pas » : préconisations du plan, étapes pas encore validées (Synthèse), inspection gardée
  malgré « Non ». Verrou serveur (`bacs-audit-step-completion.js`) inchangé, plus large.
- **Puissance enregistrée** (`bacs_total_power_kw`, simple cache en calcul automatique) : le champ de
  l'étape Identification affiche la puissance retenue (`power_summary.retainedKw`) ; la note de
  synthèse (Claude) reçoit la puissance retenue (`resolveTotalPower`) ; changer la date du permis
  (`PATCH /afs/:id`) juge sur le cumul et rafraîchit le cache. Mig 216 (accord de Kévin 15/10) :
  rattrapage des caches des audits BACS non livrés (base de dev : #43 122,8 → 155,8 kW, #56 949 →
  1 002 kW, aucun verdict changé ; test `power-cache-migration`).
- Zones : nom `min-w-40`, régime `w-60` (le nom tombait à 16 px).
- Pièges vus en relisant sur d'autres audits que STEF (2026-10-14) : une rubrique ouverte « par
  défaut » avant la fin d'un chargement propre au composant reste ouverte une fois complète → mettre
  ce chargement dans la clé de `useStepRubrics` (GTB : `afDocsLoaded`) ; la clé est comparée valeur par
  valeur (v0.1.278) : la synchro de l'audit (`useAuditAutoSync`, 5 s) remplace l'objet GTB du store et un
  nouveau tableau aux mêmes valeurs refermait les rubriques ouvertes (GTB de STEF, 16/10) ; le résumé de la puissance
  doit lire la puissance **retenue** (`power_summary.retainedKw`, celle du verdict), pas
  `bacs_total_power_kw` (en calcul automatique, cache parfois ancien : audit #56, 949 kW enregistrés,
  1 002 kW retenus) ; « 1er » du mois (`toLocaleDateString` écrit « 1 janvier »).
- Tests : `bms-guide`, `thermal-guide`, `identification-guide`, `zones-guide`, `documents-guide`,
  `step-unanswered` (`backend-node/test`).

## GTB fonctionnelle, partiellement ou non (mig 218, 2026-10-16)

« La GTB et la supervision sont-elles fonctionnelles ? » Oui / Partiellement / Non
(`bacs_audit_bms.functional_state` ∈ `functional` | `partial` | `not_functional`, null = sans réponse)
+ `functional_notes` (ce qui est constaté ou relaté par le client), rubrique « Fonctionnement de la
GTB » (bureau et mobile). Décisions de Kévin :
- **Non** = l'ancien « hors service » : `out_of_service = 1`, action bloquante « Remettre en service la
  GTB », exigences sur la GTB ignorées, rubriques de ce qu'elle sait faire facultatives.
- **Partiellement** : la GTB reste évaluée ; action **majeure** « Remettre en état les fonctions
  défaillantes de la GTB » (`bms_partially_functional`, R175-4) qui reprend les notes ; notes
  **exigées** (rubrique « à compléter » sinon).
- Notes imprimées dans les deux rapports (encadré « partiellement fonctionnelles », « Constat » sous
  « hors service », ligne « Fonctionnement »).
- `out_of_service` reste la colonne lue par le plan, la conformité, les rapports et les outils Claude :
  `lib/bms-functional-state.js` (`syncBmsFunctionalState`, PUT `/bacs-audit/:id/bms`) les tient
  d'accord ; `out_of_service` seul (outils Claude, ancienne version) garde un « Partiellement » en
  service ; les deux en désaccord → `out_of_service` l'emporte. Côté interface : `bmsFunctionalState()`
  (`lib/bms-guide.js`, repli sur `out_of_service`). Mig 218 : reprise 0 → `functional`, 1 → `not_functional`.
- Tests : `bms-functional-state`, `bacs-audit-action-generator`.

## Listes "intégré à la GTB" filtrées par usages traités

Dans la card GTB (`BmsSection.vue` + `MobileBmsTab.vue`), les tables
« Équipements intégrés » et « Compteurs intégrés » sont filtrées par les
flags `bms.manages_*` (heating / cooling / ventilation / dhw / lighting).
Mapping :

| system_category / meter usage | Flag GTB |
|---|---|
| `heating` | `manages_heating` |
| `cooling` | `manages_cooling` |
| `ventilation` (devices uniquement) | `manages_ventilation` |
| `dhw` | `manages_dhw` |
| `lighting_indoor`, `lighting_outdoor`, `lighting` | `manages_lighting` |
| `electricity_production`, `pv`, `other` | jamais affiché (hors champ GTB) |

**Règle stricte** : si l'auditeur n'a coché **aucun** usage, les tables sont
**vides** avec un message ambré « ⚠ Coche d'abord un usage ci-dessus ». Pas de
fallback "tout afficher" — ça suggérait à tort que toutes les catégories
étaient à intégrer.

## Perfomance — patterns à respecter dans l'audit

**Toggles non bloquants** : les `patchDeviceMb` / `patchMeter` etc. de
`BmsSection` font `Object.assign(d, fullPatch)` synchroniquement pour mise à
jour visuelle instantanée, puis lancent le PATCH HTTP en fire-and-forget
(`.then(scheduleRefresh).catch(...)`). Ne pas remettre des `await` qui bloquent
la réactivité.

**Debounce du refresh plan d'action** : après chaque PATCH, on **debounce**
800ms l'appel `audit.refreshActionItems()` (qui fait 2 GET parallèles +
recalcul serveur). Sans ça, cliquer 10 toggles d'affilée = 10 recalculs
sérialisés.

**Rate-limit Fastify** : 1500 req/min (`backend-node/src/index.js`). Les
audits riches (~30 action items × N photos) déclenchent des cascades de
`GET /api/sites/.../documents?bacs_audit_action_item_id=X` au mount des
`BacsPhotoButton`. C'est un anti-pattern **N+1 queries** — TODO long terme :
1 fetch global au store + distribuer aux N enfants. En attendant, le
rate-limit absorbe.

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
- **Composants mobiles** dans `frontend/src/components/mobile-audit/` : `MobileSheet` (slide-up plein écran avec close+save iOS-natif), `MobileField` (label uppercase tracking-wider + slot), `MobileShareSheet`, et 5 `Mobile<Tab>.vue` (Site / Zones / Meters / Systems / Bms).
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
- Selects audit mobile : tous via `components/mobile-audit/MobileSelectSheet.vue` (bottom sheet custom slide-up iOS, items 48pt min, icônes colorées / pilules, recherche auto ≥8 options, mode creatable). Plus de `<select>` natif iOS dans le périmètre audit PWA — l'expérience native est jugée insuffisamment visuelle. Pour les inputs/boutons, classe utilitaire `.touch-control` (44pt + style cohérent gray-200/indigo-500/30) dans `assets/main.css`. Biblio d'équipements en plein écran (`MobileLibraryPicker.vue`), jamais en BaseModal mobile
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
- Menu `Plus` (icône `EllipsisHorizontalIcon`) : Partager / Activité / Photos terrain / Transcript IA / Dossier complet (ZIP) / ─── / Supprimer cet audit (rouge)
- **Dossier complet (ZIP)** : `POST /api/bacs-audit/:id/exports/dossier` — rapport A4 + tableaux A3 (rendus et tracés comme les exports habituels) + documents du site cochés « Inclure dans le rapport » (`site_documents.include_in_report`), nommés « PJ 02 - titre.ext » comme l'annexe E. Archive envoyée à la volée (non stockée). Les URL d'export ne passent jamais par la file hors-ligne (`lib/offline-queue.js`).
- **Aperçu des PDF joints** : `components/DocumentViewerModal.vue` (étape Documents, check-list, rapport d'inspection, factures d'énergie) ; le PDF est servi inline par `GET /api/site-documents/:id/download?inline=1` (réservé aux PDF). Sur mobile, le lien ouvre la visionneuse du téléphone. Les images ne s'ouvrent en ligne que pour les formats de `IMAGE_MIMES` + GIF (un SVG part en téléchargement : il peut contenir du script).
- **Opérations longues jamais mises en file hors-ligne** (`lib/offline-queue.js` `NEVER_QUEUE`) : livraison, générations Claude (synthèse, alternatives, suggestions de transcript), resynchronisation, clonage, versions. Au-delà du délai de 12 s des petites écritures, elles repartaient à chaque retour sur la fenêtre (synthèses et livraisons en double). Délai de 180 s côté `api.js` (`LONG_OPERATION`). Le drain garde la file sur 401/408/429 (reprise après reconnexion) et retire les entrées devenues non éligibles.
- **Livraison** : si le pré-contrôle plante, `POST /deliver` répond 409 `precheck_failed` ; l'UI propose « Livrer sans vérification » (`?force=1`, tracé `bacs_audit.deliver.forced`).
- **Vue commerciale / CSV** : numérotation BACS-xxx partagée (`routes/bacs-audit/_action-numbering.js`), repères `{{zone|system|device:id}}` résolus par `_action-tags.js` (source unique PDF + vue commerciale via `GET …/action-items?plain=1` + CSV). CSV (`_actions-csv.js`) : `;`, BOM UTF-8, CRLF, libellés de `_labels.js` alignés sur l'écran, plan numéroté d'abord.
- **Contrôles PDF** : `cd backend-node && npm run check:pdf -- 40,43,45,56,60,61 --fake-photos --tables` (toujours sur une copie de la base ; détail `backend-node/scripts/pdf-checks/README.md`). À relancer avant chaque mise en production touchant le rapport.
- Le kind switch BACS/GTB reste dans le `<select>` du `<h1>` titre
- **Pas de Tout replier/déplier dans la toolbar globale** — c'est une action par section gérée par les `CollapsibleSection`

### Liste utilisateurs PocketID
- Backend `routes/users.js` : `GET /api/users` complète sa liste avec les utilisateurs PocketID via `X-API-Key` header (env `POCKETID_API_KEY`). Cache 60s in-memory pour ne pas hammer l'admin API. Dédup par email avec les users locaux.
- Backend `POST /api/users/ensure-by-pocketid-id` : crée un placeholder local (oidc_sub = pocketid id) pour pouvoir grant à un collègue qui ne s'est pas encore loggé sur Docs. Au prochain login OIDC, `getByOidcSub` retrouve l'enregistrement et complète le profil via `updateProfile`.
- Frontend (ShareAfModal + MobileShareSheet) : si l'user sélectionné est PocketID (id préfixé `pocketid:`), appelle d'abord `ensureUserFromPocketId(pocketid_id)` pour obtenir l'id local, puis `grantAfPermission`.
- Env var requise prod : `POCKETID_API_KEY=...` dans `/opt/buildy-docs/.env`. Token créé dans PocketID admin (Paramètres → API Keys) avec scope minimum `users:read`.
## FAQ Buildy / Crisp Knowledge Base

Gestion centralisée de la base de connaissance Crisp Helpdesk (`https://help.buildy.fr/`) depuis Buildy Docs, avec assistance IA et synchronisation manuelle. Sidebar : *Support → FAQ Buildy* (`/faq`).

### Architecture (Lot 90-91)
- **DB** : `crisp_settings` (singleton, credentials chiffrés via `lib/crypto.js`), `faq_categories`, `faq_articles` (avec `crisp_id`, `dirty`, `crisp_url`, `crisp_updated_at`).
- **SDK officiel** : `crisp-api` v10.9.x. Auth tier `website` obligatoire (token généré dans Crisp → *Settings → Workspace Settings → Advanced configuration → API Token*, **pas** un plugin Marketplace ; quota 10 000 req/jour). Wrapper minimal dans `lib/crisp.js`.
- **Service sync** : `lib/faq-sync.js` — `pullFromCrisp()`, `pushArticleToCrisp()`, `pushCategoryToCrisp()`, `deleteCategoryOnCrisp()`. Pull = endpoint flat `/helpdesk/locale/{locale}/articles` (PAS `/category/{id}/articles` qui retourne 404), puis `getArticle()` pour le content. Le mapping `category_id` Crisp ↔ local se fait via la map `crisp_id → faqCategories.id`.
- **Routes Fastify** : `routes/faq.js` (`/api/faq/{settings,test-connection,sync/pull,categories,articles,upload-image,ai/{rewrite,generate,missing-articles}}`).
- **Frontend** : `views/FaqBuildyView.vue` (arbre catégories + tableau articles + modales settings/IA), `views/FaqArticleEditorView.vue` (éditeur), `components/FaqRichTextEditor.vue` (Tiptap dédié), `components/FaqCategoryNode.vue`, `stores/faq.js`.

### Conversion Markdown Crisp ↔ HTML — `lib/crisp-markdown.js`
Crisp stocke ses articles en **Markdown Crisp-flavored** (non-standard). Bidirectionnel obligatoire :
- **Pull** : `crispMarkdownToHtml(md)` → HTML pour Tiptap.
- **Push** : `htmlToCrispMarkdown(html)` → Markdown pour Crisp.

Spécificités Crisp à respecter (différentes du Markdown standard) :
- `__texte__` = **soulignement** (PAS gras, le gras c'est `**`).
- `++texte++` = **surlignage** (custom Crisp).
- `~~texte~~` = barré.
- Callouts inline sur 1 ligne : `| ...` (tip vert) / `|| ...` (info jaune) / `||| ...` (warning orange). **Le texte DOIT être sur la même ligne que le préfixe**, sinon Crisp affiche un encart vide. → cf. pièges ci-dessous.
- Embeds : `${youtube}[label](id)`, idem `vimeo`, `dailymotion`, `frame`.
- Image avec dimension : `![alt](url =800xauto)`.
- Listes : Crisp insère systématiquement une ligne vide entre items, et **renumérote `1.` partout** au stockage. Notre converter MD→HTML doit fusionner les `1.\n\n1.\n\n1.` en une `<ol>` unique avec numérotation correcte côté HTML.

### Pièges connus à NE PAS oublier
1. **Tiptap enveloppe systématiquement en `<p>` à l'intérieur des `<blockquote>` et des `<li>`**. Le converter HTML→MD doit aplatir (`_flattenForCallout` / `_flattenListItem`) AVANT la conversion inline, sinon les callouts produisent `||\nTexte` (encart vide + paragraphe orphelin) et les listes produisent `1.\nÉtape` (chiffre seul + texte séparé).
2. **Crisp réécrit la numérotation `1.`, `2.`, `3.` en `1.`, `1.`, `1.`** lors du stockage (chaque item devient un paragraphe-liste isolé). Notre converter MD→HTML doit donc absorber les lignes vides entre items numérotés et regrouper en une `<ol>` unique.
3. **Auth tier `website`** uniquement. `plugin` exige une installation marketplace. `user` n'existe pas pour les endpoints helpdesk. La doc principale mentionne `plugin` partout — le tier `website` est documenté à part : https://docs.crisp.chat/guides/rest-api/authentication/website-token/.
4. **`saveHelpdeskLocaleArticle` exige `description: null`** explicite dans le payload, sinon Crisp répond `invalid_data` (HTTP 502 côté backend).
5. **Le pull ne récupère pas les articles dont `dirty=1` localement** (conflit). Ça inclut le champ `crisp_url` qui n'est populé qu'au prochain pull non-conflictuel après un push.

### Éditeur FAQ — features spécifiques
- **Headings H1–H4** (le RichTextEditor partagé limite à H3-H4 ; ne PAS utiliser le partagé pour la FAQ).
- **Underline + Highlight + Image + Link** + StarterKit (Blockquote désactivé pour utiliser notre `FaqBlockquote`).
- **Callouts éditables** via `FaqBlockquote` qui ajoute un attribut `variant: 'tip'|'info'|'warning'` mappé en classe `callout-{variant}`. 3 boutons toolbar dédiés (vert/jaune/orange + icônes ampoule/info/triangle).
- **Image upload** : drag-drop ou bouton, push vers FTP OVH `crisp-faq/<uuid>.<ext>` via `lib/faq-image-upload.js` (sharp resize ≤1600px, conversion WebP sauf PNG transparent). Config via `FAQ_FTP_*` (fallback sur `FTP_*`).
- **Image placeholders** : `<img data-placeholder="true" alt="...">` rendu en zone grise rayée cliquable, ignoré au push Crisp. L'IA en insère aux emplacements pertinents pour suggestion.
- **Bouton "Réécrire avec IA"** intégré à droite de la toolbar (visible si `articleId` fourni).
- **Bouton "Voir en ligne"** dans le top-bar de l'éditeur (visible si `crisp_url && status='published'`), ouvre l'article publié sur help.buildy.fr.

### Prompts IA (éditables via `/ai-prompts`)
- `faq.rewrite` — réécrit un article existant en améliorant clarté/structure.
- `faq.generate` — produit titre + corps depuis une question utilisateur.
- `faq.suggest_missing` — propose une liste d'articles manquants (JSON).

Tous les 3 héritent du même `SYSTEM_PROMPT_FAQ_BASE` (`lib/claude.js`) qui :
- Cible une audience non technique (utilisateurs Hyperveez/Gojee, exploitants de bâtiment, MOA/MOE/BE) et impose un ton pédagogue (définir chaque acronyme, POURQUOI avant COMMENT, exemples concrets, pas de jargon IT pur).
- Documente exhaustivement la correspondance HTML ↔ Markdown Crisp à respecter.
- Impose la hiérarchie titres : H1 = champ titre séparé, corps commence en H2, jamais de H1 dans le contenu.
- Encourage les callouts (1-3 par article max) avec cas d'usage explicites.
- Encourage les `<img data-placeholder="true">` aux emplacements visuels pertinents.
- Le corpus Buildy (sections, équipements, fonctionnalités) est mis en cache éphémère (Anthropic prompt caching) pour minimiser les tokens.

### Workflow utilisateur
1. *Settings → Paramètres Crisp* (token + website_id chiffrés en DB).
2. *Pull depuis Crisp* — récupère catégories + articles, conversion MD→HTML, marqués `dirty=0`.
3. Édition dans Buildy Docs (toolbar avec callouts, image upload, IA).
4. *Publier vers Crisp* sur chaque article (jamais d'auto-push). Conversion HTML→MD, push via SDK, `dirty=0`.
5. *Voir en ligne* pour vérifier le rendu sur help.buildy.fr.
6. Re-pull périodique pour récupérer les éditions faites côté Crisp directement (les conflits avec `dirty=1` local sont signalés sans écraser).

### Synchronisation bibliothèque de fonctionnalités → FAQ (Lot 138, mig 138)

Une fonctionnalité de la biblio (`section_templates.is_functionality=1`) peut générer un article FAQ publiable Crisp via le bouton « Article FAQ » de `LibraryFunctionalitiesView`.

- **Direction unique** biblio → FAQ. Une édition côté FAQ ne remonte JAMAIS dans la biblio (sinon les PDF audits BACS hériteraient d'un texte SEO Google, hors-charte).
- **Flag confidentiel** : `section_templates.faq_publishable` (0/1). À 0 → bouton FAQ grisé en biblio + 403 backend. Cocher si la fonctionnalité décrit un algo propriétaire à ne pas exposer aux concurrents.
- **Lien article ↔ fonctionnalité** : colonne `faq_articles.source_section_template_id` (FK SET NULL si la fonctionnalité est supprimée). `source_synced_version` mémorise la version au moment de la génération, `source_overridden=1` dès qu'un PATCH article touche au content/title/description.
- **Divergence** : `section_templates.current_version > faq_articles.source_synced_version` → badge orange dans la biblio + bandeau jaune dans l'éditeur FAQ avec bouton « Regénérer » (snapshot `before_library_resync` avant écrasement).
- **Captures** : `lib/library-faq-sync.js` publie les attachements `section_template` vers le FTP OVH via `faq-image-upload.js` (sharp resize ≤1600px, WebP). Cache de mapping local → FTP dans `library_attachment_publications` (clé `attachment_id`, comparaison `file_hash` sha256 pour éviter les re-uploads). CASCADE FK sur suppression de l'attachment.
- **Prompt IA dédié** : `faq.generate_from_functionality` (éditable via `/ai-prompts`), distinct de `faq.generate`. Le prompt reçoit en contexte le `body_html` de la fonctionnalité + la liste structurée des captures FTP + les articles BACS à linker (cf. ci-dessous).
- **Maillage SEO interne BACS** : `faq_articles.bacs_articles` (TEXT, ex `'R175-3 1°, R175-6'`). L'admin tagge ses articles « décret BACS » avec les codes couverts. À la génération d'un article fonctionnalité dont la `bacs_articles` matche, l'IA reçoit en contexte la liste `{title, crisp_url}` des articles BACS publiés et insère des liens internes naturels. Si aucun article BACS publié, pas de maillage (sans erreur). Lookup via `db.faqArticles.listBacsCoverage(codes)` — match `LIKE %code%`, articles `status='published' AND crisp_url IS NOT NULL` uniquement.

### Stratégie SEO (audit concurrentiel mai 2026)

**Cible search Google** : property managers, asset managers, gestionnaires de parc immobilier, foncières. Pas les intégrateurs GTB ni les BETs (autre canal). Pas les techniciens automaticiens.

**Acteurs dominants à concurrencer** :
- **Citron.io** (★★★★★) — décret BACS, décret tertiaire, clients BNP/Lagardère
- **GTB-Ingénierie.fr** (★★★★) — décret BACS GTB, audit BACS, BAT-TH-116
- **Sensinov** (★★★★) — SaaS GTB, concurrence Hyperveez directement
- Advizeo/Deepki, Lowit, Hellio

**Termes prioritaires** (à viser dans le scoring SEO + prompts IA + whitelist `/faq/settings`) :

| Priorité | Terme | Pourquoi |
|---|---|---|
| 🔥 Attaque rapide | `audit BACS` | Meilleur ratio pertinence/compétition, module audit déjà dans Hyperveez |
| 🔥 Attaque rapide | `logiciel GTB` | Intent transactionnel fort, SERP peu consolidé (SpinalCom = enterprise, Wattsense = IoT) |
| 🔥 Attaque rapide | `gestion technique bâtiment multi-sites` | Longue traîne, quasi 0 concurrence, cible exacte (asset manager 50+ sites) |
| 🟠 Moyen terme | `supervision GTB` | SERP désorganisé, contenu qualité peut s'imposer |
| 🟠 Moyen terme | `intégrateur GTB` | Mot clé sous-estimé, qualité d'intent maximale (appels d'offres BET) |
| 🟠 Moyen terme | `prime CEE GTB`, `BAT-TH-116` | Point d'entrée funnel : le gestionnaire cherche le financement avant la solution |
| 🟡 Long terme | `décret BACS` | Volume max mais dominé par Citron — viser les sous-angles : property manager, parc immobilier multi-sites, asset manager |
| 🟡 Long terme | `GTB bâtiment tertiaire` | SERP dominé par installateurs (Veolia, Idex). Angle SaaS multi-sites sous-exploité |
| 🟡 Long terme | `décret tertiaire` | Citron quasi-indélogeable. Longue traîne uniquement |
| 🟡 Long terme | `smart building` | Top of funnel, intent dispersé. Notoriété de marque uniquement |

**Termes à éviter ou retirer** :
- **`hypervision`** : très peu recherché tel quel sur Google, malgré l'usage produit. Préférer `supervision` partout dans les articles SEO.
- **`BACnet / Modbus / M-Bus / KNX / LoRaWAN`** : trop technique, capte des intégrateurs concurrents (jamais des acheteurs property/asset manager).
- **`R175`, `R175-3`, etc.** : jargon réglementaire, pas une vraie recherche utilisateur. Garder uniquement dans `faq_articles.bacs_articles` (mapping interne pour maillage SEO, pas dans le contenu visible).
- **`BREEAM / HQE`** : certifications amont, intent complètement différent de l'achat GTB.

**Sous-angles différenciants Buildy à exploiter** :
- `property manager`, `asset manager`, `gestion de parc immobilier`, `foncière`
- `multi-sites`, `parc immobilier`
- `mise en conformité`, `économies d'énergie`

**Modification opérationnelle** : la whitelist effective vit dans `faq_settings.seo_keywords_json`, éditée via `/faq/settings`. Le `DEFAULT_KEYWORDS` de `seo-scorer.js` est juste un fallback minimal au démarrage avant override admin. Les **prompts IA** (`faq.generate`, `faq.rewrite`, `faq.generate_from_functionality`) qui contiennent des suggestions de mots-clés sont éditables via `/ai-prompts` — c'est là qu'on ajuste la stratégie sans toucher au code.

### Articles BACS de référence sur Crisp

Approche retenue : **1 seul article consolidé** « Décret BACS R175-1 à R175-6 : texte officiel » plutôt que 6 articles séparés (analyse search : personne ne cherche `R175-3` ; les recherches sont sur `décret BACS`, `GTB`, etc.). L'article unique doit avoir son champ `bacs_articles` rempli avec tous les codes couverts : `R175-1, R175-2, R175-3, R175-4, R175-5, R175-6`. Le maillage interne pointera alors vers cet article unique depuis tous les articles fonctionnalité.

