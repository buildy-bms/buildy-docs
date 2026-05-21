'use strict';

const config = require('../config');

// Configuration publique consommee par le frontend (cles restreintes,
// sans danger cote navigateur). La cle Google Maps est restreinte par
// referent HTTP dans la console Google Cloud.
async function routes(fastify) {
  fastify.get('/public-config', async () => ({
    googleMapsApiKey: config.googleMapsApiKey || '',
  }));
}

module.exports = routes;
