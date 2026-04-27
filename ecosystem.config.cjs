module.exports = {
  apps: [
    {
      name: 'buildy-af',
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
        PORT: 443,
        TZ: 'Europe/Paris',
        // En prod, on ne watch pas (PM2 le desactive via env_production).
        watch: false,
      },
    },
  ],
};
