'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./database');
const log = require('./lib/logger').system;

async function main() {
  log.info('Starting Buildy AF...');
  log.info(`Node.js ${process.version}, PID ${process.pid}`);

  db.init();

  // Seed bibliotheque equipements (idempotent : ne touche pas l'existant)
  require('./lib/seeder').seedLibraryOnBoot();

  const fastifyOpts = { logger: false, trustProxy: true };
  if (config.httpsEnabled) {
    if (!fs.existsSync(config.httpsCertPath) || !fs.existsSync(config.httpsKeyPath)) {
      log.error('HTTPS active mais certificats introuvables :');
      log.error(`  cert: ${config.httpsCertPath}`);
      log.error(`  key:  ${config.httpsKeyPath}`);
      process.exit(1);
    }
    fastifyOpts.https = {
      key: fs.readFileSync(config.httpsKeyPath),
      cert: fs.readFileSync(config.httpsCertPath),
    };
    log.info('HTTPS active');
  }
  const fastify = require('fastify')(fastifyOpts);

  await fastify.register(require('@fastify/cookie'));
  await fastify.register(require('@fastify/jwt'), { secret: config.jwtSecret });
  await fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB / fichier
  });

  await fastify.register(require('@fastify/cors'), {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS non autorise'), false);
    },
    credentials: true,
  });

  await fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false,
    hsts: config.httpsEnabled ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  await fastify.register(require('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
  });

  // Health check (no auth)
  fastify.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    version: require('../package.json').version,
  }));

  // Auth hook global (protege /api/* sauf endpoints publics)
  require('./lib/auth-hooks').registerAuthHook(fastify);

  // Routes
  await fastify.register(require('./routes/auth'), { prefix: '/api' });
  await fastify.register(require('./routes/afs'), { prefix: '/api' });
  await fastify.register(require('./routes/sections'), { prefix: '/api' });
  await fastify.register(require('./routes/equipment-templates'), { prefix: '/api' });
  await fastify.register(require('./routes/attachments'), { prefix: '/api' });
  await fastify.register(require('./routes/export'), { prefix: '/api' });
  await fastify.register(require('./routes/inspections'), { prefix: '/api' });
  await fastify.register(require('./routes/versions'), { prefix: '/api' });
  await fastify.register(require('./routes/search'), { prefix: '/api' });
  await fastify.register(require('./routes/claude'), { prefix: '/api' });
  await fastify.register(require('./routes/bacs'), { prefix: '/api' });

  // Sert les captures uploadees sous /attachments/<af-id>/<uuid>.png
  // (auth verifiee par le hook global qui couvre /attachments/*).
  const attachmentsRoot = path.resolve(config.attachmentsDir);
  if (!fs.existsSync(attachmentsRoot)) fs.mkdirSync(attachmentsRoot, { recursive: true });
  await fastify.register(require('@fastify/static'), {
    root: attachmentsRoot,
    prefix: '/attachments/',
    decorateReply: false, // 2nd enregistrement
    // wildcard: true (defaut) : sert dynamiquement TOUT fichier sous root/.
    // NE PAS metttre wildcard: false ici car ca pre-scan le dossier au boot
    // et les uploads ulterieurs renvoient 404 jusqu'au prochain restart PM2
    // (cf. memoire feedback_deploy_static_restart pour le meme bug sur BT/FM).
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
      if (map[ext]) res.setHeader('Content-Type', map[ext]);
      // Cache cote navigateur (les filenames sont des UUIDs immuables)
      res.setHeader('Cache-Control', 'private, max-age=86400');
    },
  });

  // Sert le frontend Vue build (production uniquement)
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    log.info(`Serving frontend from ${frontendDist}`);
    await fastify.register(require('@fastify/static'), {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });
    fastify.setNotFoundHandler((request, reply) => {
      // /api/* et /attachments/* doivent renvoyer 404 propres, pas le SPA.
      // (Sinon une image manquante recoit le index.html en text/html, et le
      //  navigateur affiche un IMG cassee silencieusement.)
      if (request.url.startsWith('/api/') || request.url.startsWith('/attachments/')) {
        return reply.code(404).send({ detail: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    log.info('No frontend/dist (dev mode — frontend served by Vite on :5173)');
  }

  // Request log
  fastify.addHook('onResponse', (request, reply, done) => {
    const url = request.url.split('?')[0];
    if (url !== '/api/health') {
      const ms = Math.round(reply.elapsedTime);
      const level = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info';
      log[level](`${request.method} ${request.url} ${reply.statusCode} (${ms}ms) ip=${request.ip}`);
    }
    done();
  });

  // Cleanup sessions expirees (toutes les 10 min)
  setInterval(() => {
    try { db.sessions.deleteExpired(); } catch { /* ignore */ }
  }, 10 * 60_000);

  // Checkpoint Git auto toutes les 10 min pour les AFs ayant eu de l'activite
  // depuis le dernier commit (compare audit_log.created_at au dernier commit Git).
  const gitLib = require('./lib/git');
  setInterval(async () => {
    try {
      const afs = db.afs.list({});
      for (const af of afs) {
        const lastActivity = db.db.prepare(`
          SELECT MAX(created_at) AS last FROM audit_log WHERE af_id = ?
        `).get(af.id)?.last;
        if (!lastActivity) continue;
        const commits = await gitLib.listCommits(af.id);
        const lastCommitTs = commits[0]?.timestamp ? commits[0].timestamp * 1000 : 0;
        const lastActivityTs = new Date(lastActivity + 'Z').getTime();
        if (lastActivityTs > lastCommitTs) {
          await gitLib.commitAf(af.id, 'Checkpoint auto');
        }
      }
    } catch (e) {
      log.warn(`Checkpoint Git auto en erreur : ${e.message}`);
    }
  }, 10 * 60_000);

  try {
    await fastify.listen({ port: config.port, host: config.host });
    const proto = config.httpsEnabled ? 'https' : 'http';
    log.info(`Buildy AF listening on ${proto}://${config.host}:${config.port}`);
  } catch (err) {
    log.error(`Server listen error: ${err.message}`);
    process.exit(1);
  }
}

main();
