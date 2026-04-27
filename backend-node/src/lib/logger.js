'use strict';

const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';
const level = (process.env.LOG_LEVEL || 'info').toLowerCase();

const logger = pino({
  level,
  transport: !isProd
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.token_hash',
    ],
    censor: '[REDACTED]',
  },
});

function _format(args) {
  return args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
}

function createLogger(prefix) {
  const child = logger.child({ component: prefix });
  return {
    info:  (...args) => child.info(_format(args)),
    warn:  (...args) => child.warn(_format(args)),
    error: (...args) => child.error(_format(args)),
  };
}

module.exports = {
  system: createLogger('SYSTEM'),
  auth: createLogger('AUTH'),
  pino: logger,
};
