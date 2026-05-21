'use strict';

// Vue satellite statique du site pour le PDF d'audit (Google Static Maps API).
//
// L'image est récupérée ici côté Node puis intégrée en data URL : le
// firewall du VPS bloque les fetch sortants pendant le rendu Puppeteer
// (cf. mémoire « PDF fonts embed »), il faut donc embarquer l'image.
//
// La clé `GOOGLE_MAPS_API_KEY` est restreinte par référent HTTP — on
// présente le référent du site pour qu'elle soit acceptée côté serveur.
// Best-effort : toute erreur (clé absente, API non activée, réseau) →
// renvoie null, le PDF s'affiche simplement sans carte.
//
// Cadrée sur le site uniquement, sans marqueur de zone : les zones n'ont
// pas de libellé sur la carte, leurs pins n'apportaient donc rien.
//
// Centre résolu par ordre de priorité :
//   1. coordonnées GPS explicites du site,
//   2. géocodage de l'adresse du site,
//   3. centroïde des zones géolocalisées (la plupart des sites n'ont pas
//      de coordonnées propres mais ont leurs zones placées sur la carte).

const config = require('../config');
const log = require('./logger').system;

const REFERER = 'https://docs.buildy.fr/';

// Géocode une adresse via la Geocoding API. Best-effort : null si la clé
// n'autorise pas l'API ou si l'adresse est introuvable.
async function geocodeAddress(address, key) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json'
    + `?address=${encodeURIComponent(address)}&region=fr&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      headers: { Referer: REFERER },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;
    if (data?.status === 'OK' && loc) return { lat: loc.lat, lng: loc.lng };
    return null;
  } catch (e) {
    log.warn(`Géocodage site : ${e.message}`);
    return null;
  }
}

// Résout le point central de la vue satellite du site.
async function resolveSiteCenter({ site, zones }, key) {
  if (site && site.latitude != null && site.longitude != null) {
    return { lat: Number(site.latitude), lng: Number(site.longitude) };
  }
  if (site && site.address) {
    const geo = await geocodeAddress(site.address, key);
    if (geo) return geo;
  }
  const located = (zones || []).filter(z => z.latitude != null && z.longitude != null);
  if (located.length) {
    const lat = located.reduce((s, z) => s + Number(z.latitude), 0) / located.length;
    const lng = located.reduce((s, z) => s + Number(z.longitude), 0) / located.length;
    return { lat, lng };
  }
  return null;
}

/**
 * @returns {Promise<string|null>} data URL PNG, ou null si indisponible.
 */
async function buildSiteStaticMap({ site, zones }) {
  const key = (config.googleMapsApiKey || '').trim();
  if (!key) return null;

  const center = await resolveSiteCenter({ site, zones }, key);
  if (!center) return null;

  const params = [
    'size=640x360', 'scale=2', 'maptype=hybrid', 'language=fr',
    `center=${center.lat},${center.lng}`, 'zoom=18',
    'markers=' + encodeURIComponent(`color:0x0d9488|size:mid|${center.lat},${center.lng}`),
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
