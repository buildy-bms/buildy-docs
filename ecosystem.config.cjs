module.exports = {
  apps: [
    {
      name: 'buildy-docs',
      script: 'backend-node/src/index.js',
      cwd: __dirname,
      // Dev : watch actif sur le backend pour reload automatique.
      // Prod : `pm2 start ecosystem.config.cjs --env production` desactive watch.
      watch: ['backend-node/src'],
      ignore_watch: ['node_modules', 'data', 'certs', '*.log'],
      env: {
        NODE_ENV: 'development',
        PORT: 3100,
      },
      env_production: {
        NODE_ENV: 'production',
        // 3443 = port HTTPS de buildy-docs sur le VPS Jelastic (FM occupe deja 443).
        // PM2 merge env_production par-dessus env, donc il faut redefinir PORT
        // sinon il garde 3100 (dev).
        PORT: 3443,
        TZ: 'Europe/Paris',
        watch: false,
      },
    },
  ],
};
