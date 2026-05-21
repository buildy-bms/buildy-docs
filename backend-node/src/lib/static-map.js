'use strict';

// Vue satellite statique du site pour le PDF d'audit (Google Static Maps API).
//
// L'image est récupérée ici côté Node puis intégrée en data URL : le
// firewall du VPS bloque les fetch sortants pendant le rendu Puppeteer
// (cf. mémoire « PDF fonts embed »), il faut donc embarquer l'image.
//
// La clé `GOOGLE_MAPS_API_KEY` est restreinte par référent HTTP — on
// présente le référent du site pour qu'elle soit acceptée côté serveur.
// Best-effort : toute erreur (clé absente, API Static Maps non activée,
// réseau) → renvoie null, le PDF s'affiche simplement sans carte.
//
// Cadrée sur le site uniquement, sans marqueur de zone : les zones n'ont
// pas de libellé sur la carte, leurs pins n'apportaient donc rien.

const config = require('../config');
const log = require('./logger').system;

const REFERER = 'https://docs.buildy.fr/';

/**
 * @returns {Promise<string|null>} data URL PNG, ou null si indisponible.
 */
async function buildSiteStaticMap({ site }) {
  const key = (config.googleMapsApiKey || '').trim();
  if (!key) return null;

  const siteHasCoords = site && site.latitude != null && site.longitude != null;
  if (!siteHasCoords) return null;

  const params = [
    'size=640x360', 'scale=2', 'maptype=hybrid', 'language=fr',
    `center=${site.latitude},${site.longitude}`, 'zoom=18',
    'markers=' + encodeURIComponent(`color:0x0d9488|size:mid|${site.latitude},${site.longitude}`),
    `key=${encodeURIComponent(key)}`,
  ];

  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.join('&')}`;
  try {
    const res = await fetch(url, {
      headers: { Referer: REFERER },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log.warn(`Vue satellite site indisponible (HTTP ${res.status})`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    log.warn(`Vue satellite site : ${e.message}`);
    return null;
  }
}

module.exports = { buildSiteStaticMap };
