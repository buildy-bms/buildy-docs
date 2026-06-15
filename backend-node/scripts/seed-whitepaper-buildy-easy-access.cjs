#!/usr/bin/env node
/**
 * Crée le livre blanc marketing « Buildy Easy Access » (3 pages : cover +
 * chapitre corps + chapitre CTA). Mode chapitres (Tiptap + template
 * `whitepaper-book.hbs`). Idempotent : si slug='buildy-easy-access'
 * existe déjà, le script affiche l'URL et sort sans dupliquer.
 *
 * Lancer DEPUIS LA RACINE du repo buildy-docs :
 *   node backend-node/scripts/seed-whitepaper-buildy-easy-access.cjs
 *
 * Effet :
 *  - crée un document afs (kind='whitepaper', wp_layout='book',
 *    wp_audience='asset_manager', wp_meta_json.subtitle=...)
 *  - insère 2 chapitres dans `sections` (kind='standard', parent_id=null,
 *    position 1 et 2)
 *  - grant 'write' aux autres utilisateurs pour partage équipe
 *
 * Ton : « punchy LinkedIn » — reprend l'angle du post Kevin Brocard de
 * mars 2026 qui a fait réagir (« GTB la plus utilisée en France = Excel »).
 */
'use strict';

const path = require('path');

const ROOT = process.cwd();
const SLUG = 'buildy-easy-access';
const TITLE = 'Le logiciel de supervision GTB le plus utilisé en France ? Un fichier Excel.';
const SUBTITLE = 'Comment Buildy Easy Access remplace les VPN, les credentials partagés et les interfaces obscures par un seul point d\'entrée sécurisé.';

const CHAPTER_1_TITLE = 'Un Excel, des VPN, et une grande confiance dans le turnover';
const CHAPTER_1_HTML = `
<h2>Aujourd'hui, voilà à quoi ressemble votre supervision multi-sites</h2>
<p>Un fichier Excel partagé dans Teams ou Google Drive. Une colonne « URL », une colonne « VPN », une colonne « login », une colonne « mot de passe ». Vous tapez le nom du site, vous récupérez les credentials, vous installez le client VPN du bon fabricant, vous attendez la connexion, vous tombez sur une interface qui n'a pas bougé depuis 2008.</p>
<p>Et quand la personne qui maintenait ce fichier quitte l'entreprise, <strong>c'est l'apocalypse</strong> : la moitié des sites devient inaccessible, les mots de passe sont périmés, plus personne ne sait quel VPN va avec quelle marque.</p>
<h2>Ce que Buildy Easy Access fait à la place</h2>
<p>Un seul portail Hyperveez. Les supervisions de Schneider EcoStruxure, Distech Controls, Niagara, PCVue, Panorama, ABB doGate, Spacelynk — <strong>quelle que soit la marque déployée sur chaque site</strong> — sont exposées via des liens proxy chiffrés HTTPS de la forme :</p>
<blockquote><p><code>https://votre_gtb.proxy.buildy.fr</code></p></blockquote>
<p>Pas de client VPN à installer. Pas de mot de passe partagé. <strong>Authentification forte unique</strong> + accès tracé. Les interfaces s'intègrent à la vue cartographique d'hypervision Buildy : un clic sur un site et la console native du fabricant s'ouvre dans un nouvel onglet, sans changer d'identité.</p>
<h2>Pas besoin de remplacer ce qui marche</h2>
<p>Vos automates, vos régulateurs, vos sondes terrain restent en place. La supervision historique du site continue de fonctionner — c'est juste l'<strong>accès</strong> et la <strong>vue d'ensemble</strong> qui changent. Pas de serveur hyperviseur à 100 k€, pas de migration de données, pas de PV de réception bloqué pendant 6 mois.</p>
`.trim();

const CHAPTER_2_TITLE = 'Voir Buildy Easy Access sur votre patrimoine';
// Note : ce chapitre est rendu en BACK-COVER (fond navy plein-bord) grâce
// à meta.has_back_cover=true ci-dessous. On utilise <p class="cta-button">
// pour produire un bouton CTA vert menthe arrondi.
const CHAPTER_2_HTML = `
<h2>30 minutes pour voir si ça change vraiment quelque chose</h2>
<p>Une démo guidée d'Hyperveez avec vos sites réels. On configure 1 ou 2 supervisions tierces sur votre patrimoine en live, vous testez l'accès, vous mesurez le gain de temps.</p>
<p>Si ça vous parle, vous déployez sur l'ensemble du parc. Si ça ne vous parle pas, vous gardez votre Excel.</p>
<p class="cta-button"><a href="https://buildy.fr/demo">Réserver une démo</a></p>
<h2>Ou par email</h2>
<p><a href="mailto:contact@buildy.fr">contact@buildy.fr</a></p>
<p><em>Buildy Easy Access est inclus de série dans les niveaux Smart et Premium. Aucun engagement requis pour la démo.</em></p>
`.trim();

const db = require(path.join(ROOT, 'backend-node/src/database'));
db.init();

const UPDATE_MODE = process.argv.includes('--update');
const existing = db.afs.getBySlug(SLUG);
if (existing && existing.kind === 'whitepaper' && !existing.deleted_at) {
  if (!UPDATE_MODE) {
    console.log(`✓ Livre blanc déjà présent : afs #${existing.id} (slug='${SLUG}').`);
    console.log(`  Édition  : https://docs.buildy.fr:3443/whitepapers/${existing.id}`);
    console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/preview`);
    console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/export/pdf`);
    console.log('  Pour re-synchroniser meta + body chapitres avec ce script (idempotent, sans toucher à la DB ad hoc) :');
    console.log('    node backend-node/scripts/seed-whitepaper-buildy-easy-access.cjs --update');
    process.exit(0);
  }

  // Mode --update : aligne le whitepaper existant sur le contenu du
  // script (meta + titres + body_html des 2 chapitres). Pas de DELETE :
  // on UPDATE en place via les helpers DB officiels. Tout edit manuel
  // utilisateur sur le titre/body sera écrasé — c'est le but du mode.
  console.log(`→ Mode --update : alignement du whitepaper afs #${existing.id} sur le script.`);

  db.afs.update(existing.id, {
    title: TITLE,
    wp_layout: 'book',
    wp_audience: 'asset_manager',
    wp_version: '1.0',
    wp_meta_json: JSON.stringify({
      subtitle: SUBTITLE,
      has_back_cover: true,
      cover_image_url: null,
      cover_image_caption: null,
    }),
  });

  const currentChapters = db.sections.listByAf(existing.id)
    .slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const wanted = [
    { position: 1, title: CHAPTER_1_TITLE, bodyHtml: CHAPTER_1_HTML },
    { position: 2, title: CHAPTER_2_TITLE, bodyHtml: CHAPTER_2_HTML },
  ];
  // Aligne 1-1 sur position : update si existe, create si manque, delete les excédents.
  for (const w of wanted) {
    const c = currentChapters.find(x => x.position === w.position);
    if (c) {
      db.sections.update(c.id, { title: w.title, body_html: w.bodyHtml });
    } else {
      db.sections.create({ afId: existing.id, parentId: null, position: w.position,
                           title: w.title, bodyHtml: w.bodyHtml, kind: 'standard' });
    }
  }
  for (const c of currentChapters) {
    if (!wanted.find(w => w.position === c.position)) db.sections.delete(c.id);
  }

  console.log(`✓ Whitepaper mis à jour : afs #${existing.id}.`);
  console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/preview`);
  console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${existing.id}/export/pdf`);
  process.exit(0);
}

const owner = db.db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
if (!owner) {
  console.error('✗ Aucun utilisateur en base — impossible d\'assigner un propriétaire.');
  process.exit(1);
}

// 1. Création du document whitepaper
const wp = db.afs.create({
  slug: SLUG,
  clientName: 'Buildy',         // colonnes legacy NOT NULL
  projectName: TITLE,
  kind: 'whitepaper',
  title: TITLE,
  createdBy: owner.id,
});
db.afs.update(wp.id, {
  status: 'draft',
  wp_layout: 'book',
  wp_audience: 'asset_manager',
  wp_version: '1.0',
  wp_meta_json: JSON.stringify({
    subtitle: SUBTITLE,
    // Dernier chapitre rendu en BACK-COVER navy plein-bord (CTA marketing).
    has_back_cover: true,
    // URL d'une capture d'écran Hyperveez en page de garde. Vide pour
    // l'instant — à renseigner via PATCH /api/whitepapers/:id { meta: {...} }
    // ou édition wp_meta_json directe. Format : URL HTTPS publique (FTP OVH
    // crisp-faq/, ou data URI base64). Recommandé : 1600x900px max.
    cover_image_url: null,
    cover_image_caption: null,
  }),
  updatedBy: owner.id,
});

// 2. Insertion des 2 chapitres (kind='standard', parent_id=null, position 1 et 2)
db.sections.create({
  afId: wp.id,
  parentId: null,
  position: 1,
  title: CHAPTER_1_TITLE,
  bodyHtml: CHAPTER_1_HTML,
  kind: 'standard',
});
db.sections.create({
  afId: wp.id,
  parentId: null,
  position: 2,
  title: CHAPTER_2_TITLE,
  bodyHtml: CHAPTER_2_HTML,
  kind: 'standard',
});

// 3. Accès équipe (grant 'write' aux autres utilisateurs)
const others = db.db.prepare('SELECT id FROM users WHERE id != ?').all(owner.id);
for (const u of others) db.afPermissions.grant(wp.id, u.id, 'write', owner.id);

console.log(`✓ Livre blanc créé : afs #${wp.id} (slug='${SLUG}').`);
console.log(`  Édition  : https://docs.buildy.fr:3443/whitepapers/${wp.id}`);
console.log(`  Preview  : https://docs.buildy.fr:3443/api/whitepapers/${wp.id}/preview`);
console.log(`  Export PDF : https://docs.buildy.fr:3443/api/whitepapers/${wp.id}/export/pdf`);
console.log(`  Propriétaire : user #${owner.id} · accès équipe : ${others.length} collègue(s).`);
process.exit(0);
