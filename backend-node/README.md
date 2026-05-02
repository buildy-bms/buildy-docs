# buildy-docs / backend-node

API Fastify 5 + better-sqlite3. Documentation complète à la racine : [`../README.md`](../README.md).

## Scripts

```bash
npm run dev        # node --watch (hot reload, port 3100)
npm test           # Vitest (32 tests)
npm test:watch     # Vitest mode watch
npm start          # Production node (lancé via PM2 en pratique)
```

## Structure

```
src/
├── routes/                # Plugins Fastify (un fichier = un domaine)
│   ├── afs.js             # CRUD analyses fonctionnelles
│   ├── bacs-audit.js      # Routes audit BACS (orchestrateur)
│   ├── bacs-audit/        # Sous-plugins (transcripts, inspections, exports, lifecycle, _shared)
│   ├── export.js          # Génération PDF AF / synthèse / liste de points / XLSX
│   ├── attachments.js     # Upload + EXIF + optimisation sharp
│   ├── claude.js          # Endpoints assistant Claude (synthèse, alternatives, transcripts)
│   ├── sites.js           # CRUD sites + sync FM
│   └── ...
├── lib/                   # Utilitaires métier
│   ├── pdf.js             # Wrapper Puppeteer + Handlebars + watermark + TOC
│   ├── claude.js          # Anthropic SDK + prompt caching
│   ├── seeder.js          # Seed AF (sections + équipements depuis section_templates)
│   ├── sites-sync.js      # Worker queue sync sites bidirectionnelle
│   ├── image-optimizer.js # sharp (data URL pour PDFs)
│   ├── crypto.js          # AES-256-GCM (credentials sites)
│   ├── slug.js            # URL-safe slugs
│   └── ...
├── database.js            # better-sqlite3 + migrations (PRAGMA user_version)
└── index.js               # Bootstrap Fastify
templates/pdf/             # Templates Handlebars + CSS embed
test/                      # Vitest (.mjs avec createRequire pour CommonJS)
```

## Conventions

- Routes en plugins Fastify (`async function (fastify, opts) { fastify.get(...) }`)
- Validation des bodies via Zod
- Logs Pino structurés (auto-inclus par Fastify)
- Pas de fallback "user/password local" en prod (PocketID OIDC obligatoire)

## Tests

Tests Vitest en `.mjs` (CommonJS via `createRequire`). Pour ajouter un test :

```js
// test/foo.test.mjs
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { foo } = require('../src/lib/foo.js');

describe('foo', () => {
  it('renvoie bar', () => {
    expect(foo()).toBe('bar');
  });
});
```

## Migrations DB

Toujours par `PRAGMA user_version` dans `src/database.js`, pas de système ORM. Pattern :

```js
const TARGET_VERSION = 65;
// ...
if (currentVersion < 65) {
  db.exec(`ALTER TABLE foo ADD COLUMN bar TEXT;`);
  db.pragma('user_version = 65');
}
```

DB en WAL : ne jamais `mv`/`cp`/`rm` pendant que le serveur tourne (`buildy_af.db-wal`, `buildy_af.db-shm` se synchronisent automatiquement).
