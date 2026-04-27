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
        // PORT non defini ici : laisse le .env decider (3443 par defaut sur le VPS,
        // FM occupe deja 443 sur le meme node). Eviter de hardcoder.
        TZ: 'Europe/Paris',
        watch: false,
      },
    },
  ],
};
