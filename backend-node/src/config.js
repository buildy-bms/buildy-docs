'use strict';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// En dev, si JWT_SECRET n'est pas defini, on en genere un aleatoire en
// memoire (jamais persiste). Ca evite le default partage "change-me" sans
// imposer de creer un .env pour demarrer. En prod, le default est rejete
// au demarrage (cf. validations en bas de fichier).
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') return 'buildy-docs-secret-change-me';
  const generated = crypto.randomBytes(32).toString('hex');
  console.warn(`[DEV] JWT_SECRET non defini — secret aleatoire en memoire genere (les sessions ne survivent pas au restart).`);
  return generated;
}

const config = Object.freeze({
  // Server
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3100', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  isProduction: process.env.NODE_ENV === 'production',

  // Database — on garde le filename historique buildy_af.db pour ne pas casser
  // les deploiements existants. Un script de migration data/ sera fourni si on
  // souhaite renommer le fichier (DATABASE_PATH override possible via .env).
  databasePath: process.env.DATABASE_PATH || path.resolve(__dirname, '../../data/buildy_af.db'),
  attachmentsDir: process.env.ATTACHMENTS_DIR || path.resolve(__dirname, '../../data/attachments'),
  exportsDir: process.env.EXPORTS_DIR || path.resolve(__dirname, '../../data/exports'),
  gitReposDir: process.env.GIT_REPOS_DIR || path.resolve(__dirname, '../../data/repos'),

  // Auth
  jwtSecret: resolveJwtSecret(),
  accessTokenMaxAge: parseInt(process.env.ACCESS_TOKEN_MAX_AGE || '28800', 10), // 8 h (sliding)
  refreshTokenMaxAge: parseInt(process.env.REFRESH_TOKEN_MAX_AGE || '604800', 10), // 7 days
  // Mode dev : injecte un user fictif sans passer par PocketID. Inactif en prod.
  devBypassAuth: process.env.DEV_BYPASS_AUTH === '1' && process.env.NODE_ENV !== 'production',
  devBypassUser: {
    email: process.env.DEV_BYPASS_EMAIL || 'dev@buildy.fr',
    displayName: process.env.DEV_BYPASS_NAME || 'Dev User',
  },

  // OIDC (PocketID)
  oidcEnabled: process.env.OIDC_ENABLED === 'true',
  oidcIssuer: process.env.OIDC_ISSUER || '',
  oidcClientId: process.env.OIDC_CLIENT_ID || '',
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || '',
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI || '',
  // PocketID admin API key (X-API-Key). Si présent, /api/users complète
  // sa liste avec TOUS les utilisateurs PocketID (pour le partage d'audits
  // à des collègues qui ne se sont pas encore loggés sur Docs).
  pocketidApiKey: process.env.POCKETID_API_KEY || '',
  pocketidApiUrl: process.env.POCKETID_API_URL || process.env.OIDC_ISSUER || '',

  // Public URL (utilise pour les redirects + emails). Ex: https://buildy-docs.buildy.wan
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:5173',

  // Claude (Anthropic) — assistant redaction
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  // Budget mensuel Claude en euros (0 = pas de plafond, credit restant non affiche)
  claudeMonthlyBudgetEur: parseFloat(process.env.CLAUDE_MONTHLY_BUDGET_EUR || '0') || 0,

  // Google Maps — carte de positionnement des zones (cle restreinte par
  // referent HTTP, exposee au frontend via GET /api/public-config).
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  // OpenAI — transcription des notes vocales (Whisper / gpt-4o-transcribe).
  // Anthropic ne fournit pas de speech-to-text : moteur isole dans
  // lib/transcription.js, swappable.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',

  // CORS — origines autorisees
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3100')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Synchro Sites avec Fleet Manager (token de service partage entre les 2 apps)
  buildySitesSyncToken: process.env.BUILDY_SITES_SYNC_TOKEN || '',
  fmSyncUrl: process.env.FM_SYNC_URL || '',
  // Token Bearer pour pousser l'audit trail Docs vers FM (POST /api/fleet/docs-audit-batch).
  // Token dedie (separation de privileges avec sites-sync) — meme valeur cote FM.
  buildyDocsAuditToken: process.env.BUILDY_DOCS_AUDIT_TOKEN || '',
  // Token de service pour l'auth « act-as-user » du serveur MCP de Fleet
  // Manager. FM presente ce Bearer + l'identite PocketID de l'utilisateur
  // agissant (headers X-Buildy-Act-*). Les permissions appliquees restent
  // celles de cet utilisateur — aucun bypass. Meme valeur cote FM.
  buildyDocsMcpToken: process.env.BUILDY_DOCS_MCP_TOKEN || '',

  // HTTPS (optionnel — certificats auto-signes pour acces NetBird)
  httpsEnabled: process.env.HTTPS_ENABLED === 'true',
  httpsCertPath: process.env.HTTPS_CERT_PATH || path.resolve(__dirname, '../../certs/server.crt'),
  httpsKeyPath: process.env.HTTPS_KEY_PATH || path.resolve(__dirname, '../../certs/server.key'),

  // FAQ Buildy : upload images vers FTP OVH (mêmes credentials que docs/.env.ftp)
  faqFtpHost: process.env.FAQ_FTP_HOST || process.env.FTP_HOST || '',
  faqFtpPort: parseInt(process.env.FAQ_FTP_PORT || process.env.FTP_PORT || '21', 10),
  faqFtpUser: process.env.FAQ_FTP_USER || process.env.FTP_USER || '',
  faqFtpPassword: process.env.FAQ_FTP_PASSWORD || process.env.FTP_PASSWORD || '',
  faqFtpRemoteDir: (process.env.FAQ_FTP_REMOTE_DIR || 'www/docs/crisp-faq').replace(/\/$/, ''),
  faqFtpPublicBase: (process.env.FAQ_FTP_PUBLIC_BASE || 'https://www.buildy.fr/docs/crisp-faq').replace(/\/$/, ''),

  // Livres blancs : publication des PDF vers le FTP OVH buildy.fr
  // (mêmes credentials FTP que la FAQ ; seuls le dossier et l'URL changent).
  wpFtpRemoteDir: (process.env.WP_FTP_REMOTE_DIR || 'www/telechargements').replace(/\/$/, ''),
  wpFtpPublicBase: (process.env.WP_FTP_PUBLIC_BASE || 'https://www.buildy.fr/telechargements').replace(/\/$/, ''),

  // Lien traçable des livres blancs : redirecteur PHP /dl/<slug> hébergé sur
  // buildy.fr qui journalise chaque clic puis redirige vers le PDF. Les logs
  // sont ramenés par une ingestion FTP quotidienne.
  wpTrackerRemoteDir: (process.env.WP_TRACKER_REMOTE_DIR || 'www/dl').replace(/\/$/, ''),
  wpTrackerPublicBase: (process.env.WP_TRACKER_PUBLIC_BASE || 'https://www.buildy.fr/dl').replace(/\/$/, ''),
});

// Validations securite
if (config.isProduction) {
  if (config.jwtSecret === 'buildy-docs-secret-change-me') {
    console.error('[SECURITY] JWT_SECRET par defaut en production — refus de demarrer.');
    process.exit(1);
  }
  if (!config.oidcEnabled) {
    console.error('[SECURITY] OIDC desactive en production — buildy-docs exige PocketID.');
    process.exit(1);
  }
  if (config.devBypassAuth) {
    console.error('[SECURITY] DEV_BYPASS_AUTH=1 en production — refus de demarrer.');
    process.exit(1);
  }
}

if (config.devBypassAuth) {
  console.warn('[DEV] DEV_BYPASS_AUTH actif — un user fictif est injecte sur chaque requete.');
}

module.exports = config;
