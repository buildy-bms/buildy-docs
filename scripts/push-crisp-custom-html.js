#!/usr/bin/env node
/**
 * Pousse le contenu de docs/crisp-helpdesk-custom.html dans le Custom HTML
 * du Helpdesk Crisp via l'API (endpoint saveHelpdeskSettings).
 *
 * Usage : node scripts/push-crisp-custom-html.js
 *
 * Évite le aller-retour copier-coller dans la dashboard Crisp.
 */

const fs = require('fs');
const path = require('path');

// Credentials Crisp : .env à la racine du projet (cf. CLAUDE.md)
const NM = path.join(__dirname, '..', 'backend-node', 'node_modules');
require(path.join(NM, 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const Crisp = require(path.join(NM, 'crisp-api', 'dist', 'crisp.js')).Crisp;

const TOKEN_ID = process.env.CRISP_TOKEN_ID;
const TOKEN_KEY = process.env.CRISP_TOKEN_KEY;
const WEBSITE_ID = process.env.CRISP_WEBSITE_ID;

if (!TOKEN_ID || !TOKEN_KEY || !WEBSITE_ID) {
  console.error('❌ Manque CRISP_TOKEN_ID / CRISP_TOKEN_KEY / CRISP_WEBSITE_ID dans backend-node/.env');
  process.exit(1);
}

const HTML_PATH = path.join(__dirname, '..', 'docs', 'crisp-helpdesk-custom.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

console.log(`📄 Fichier local : ${HTML_PATH}`);
console.log(`   Taille : ${html.length} caractères`);

const client = new Crisp();
client.authenticateTier('website', TOKEN_ID, TOKEN_KEY);

(async () => {
  try {
    // Récupère la conf actuelle pour ne pas écraser les autres champs (appearance, behavior, etc.)
    console.log('\n🔍 Lecture de la conf Helpdesk actuelle…');
    const current = await client.website.resolveHelpdeskSettings(WEBSITE_ID);
    console.log(`   include.html actuel : ${(current.include?.html || '').length} caractères`);

    // Patch uniquement le champ include.html
    const next = {
      ...current,
      include: {
        ...(current.include || {}),
        html,
      },
    };

    console.log('\n📤 Push de la nouvelle Custom HTML…');
    await client.website.saveHelpdeskSettings(WEBSITE_ID, next);
    console.log('✅ Custom HTML mise à jour côté Crisp.');
    console.log('\n🌐 Vérifie sur https://help.buildy.fr/fr/ (hard refresh : Cmd+Shift+R)');
  } catch (e) {
    console.error('❌ Échec :', e.message || e);
    if (e.response) console.error('Response :', JSON.stringify(e.response, null, 2));
    process.exit(1);
  }
})();
