'use strict';

// Carte statique du site pour le PDF d'audit (Google Static Maps API).
//
// L'image est récupérée ici côté Node puis intégrée en data URL : le
// firewall du VPS bloque les fetch sortants pendant le rendu Puppeteer
// (cf. mémoire « PDF fonts embed »), il faut donc embarquer l'image.
//
// La clé `GOOGLE_MAPS_API_KEY` est restreinte par référent HTTP — on
// présente le référent du site pour qu'elle soit acceptée côté serveur.
// Best-effort : toute erreur (clé absente, API Static Maps non activée,
// réseau) → renvoie null, le PDF s'affiche simplement sans carte.

const config = require('../config');
const log = require('./logger').system;

// Couleurs des pins, cohérentes avec l'app (ZONE_PIN_COLORS du frontend).
const ZONE_PIN_COLORS = { functional: '0x4f46e5', technical: '0x475569' };
const REFERER = 'https://docs.buildy.fr/';

/**
 * @returns {Promise<string|null>} data URL PNG, ou null si indisponible.
 */
async function buildSiteStaticMap({ site, zones }) {
  const key = (config.googleMapsApiKey || '').trim();
  if (!key) return null;

  const located = (zones || []).filter(z => z.latitude != null && z.longitude != null);
  const siteHasCoords = site && site.latitude != null && site.longitude != null;
  if (!located.length && !siteHasCoords) return null;

  const params = [
    'size=640x360', 'scale=2', 'maptype=hybrid', 'language=fr',
    `key=${encodeURIComponent(key)}`,
  ];
  // Marqueurs des zones, groupés par couleur (fonctionnelle / technique).
  for (const kind of ['functional', 'technical']) {
    const pts = located.filter(z => (z.kind || 'functional') === kind);
    if (!pts.length) continue;
    const coords = pts.map(z => `${z.latitude},${z.longitude}`).join('|');
    params.push('markers=' + encodeURIComponent(`color:${ZONE_PIN_COLORS[kind]}|size:mid|${coords}`));
  }
  // Marqueur du site (teal) — sert aussi de point central s'il n'y a pas
  // de zone géolocalisée.
  if (siteHasCoords) {
    params.push('markers=' + encodeURIComponent(`color:0x0d9488|size:mid|${site.latitude},${site.longitude}`));
    if (!located.length) params.push(`center=${site.latitude},${site.longitude}`, 'zoom=17');
  }

  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.join('&')}`;
  try {
    const res = await fetch(url, {
      headers: { Referer: REFERER },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log.warn(`Carte statique site indisponible (HTTP ${res.status})`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    log.warn(`Carte statique site : ${e.message}`);
    return null;
  }
}

module.exports = { buildSiteStaticMap };
