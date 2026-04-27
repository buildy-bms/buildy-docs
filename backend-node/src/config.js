'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = Object.freeze({
  // Server
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3100', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  isProduction: process.env.NODE_ENV === 'production',

  // Database
  databasePath: process.env.DATABASE_PATH || path.resolve(__dirname, '../../data/buildy_af.db'),
  attachmentsDir: process.env.ATTACHMENTS_DIR || path.resolve(__dirname, '../../data/attachments'),
  exportsDir: process.env.EXPORTS_DIR || path.resolve(__dirname, '../../data/exports'),
  gitReposDir: process.env.GIT_REPOS_DIR || path.resolve(__dirname, '../../data/repos'),

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'buildy-af-secret-change-me',
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

  // Public URL (utilise pour les redirects + emails). Ex: https://buildy-af.buildy.wan
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:5173',

  // Claude (Anthropic) — assistant redaction
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',

  // CORS — origines autorisees
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3100')
    .split(',').map(s => s.trim()).filter(Boolean),

  // HTTPS (optionnel — certificats auto-signes pour acces NetBird)
  httpsEnabled: process.env.HTTPS_ENABLED === 'true',
  httpsCertPath: process.env.HTTPS_CERT_PATH || path.resolve(__dirname, '../../certs/server.crt'),
  httpsKeyPath: process.env.HTTPS_KEY_PATH || path.resolve(__dirname, '../../certs/server.key'),
});

// Validations securite
if (config.isProduction) {
  if (config.jwtSecret === 'buildy-af-secret-change-me') {
    console.error('[SECURITY] JWT_SECRET par defaut en production — refus de demarrer.');
    process.exit(1);
  }
  if (!config.oidcEnabled) {
    console.error('[SECURITY] OIDC desactive en production — buildy-af exige PocketID.');
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
