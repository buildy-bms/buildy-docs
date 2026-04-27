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
      if (request.url.startsWith('/api/')) {
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
