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
async function buildSiteStaticMap({ site, zones, zoom }) {
  const key = (config.googleMapsApiKey || '').trim();
  if (!key) return null;

  const center = await resolveSiteCenter({ site, zones }, key);
  if (!center) return null;

  // Zoom : priorité (1) valeur explicite passée par l'appelant,
  // (2) `site.map_zoom` saisi par l'auditeur, (3) défaut 17 (un cran plus
  // large que l'ancien 18 — un bâtiment industriel complet rentre dans le
  // cadre, l'ancien 18 ne montrait qu'une partie).
  //
  // ⚠ `Number(null)` vaut `0` (et `Number.isFinite(0) === true`) — il faut
  // tester `!= null` AVANT de coercer, sinon un site legacy sans map_zoom
  // renseigné produit zoom=0 et Google renvoie une vue monde tilée.
  const explicitZoom = (zoom != null && Number.isFinite(Number(zoom))) ? Number(zoom) : null;
  const persistedZoom = (site?.map_zoom != null && Number.isFinite(Number(site.map_zoom)))
    ? Number(site.map_zoom)
    : null;
  const effectiveZoom = explicitZoom ?? persistedZoom ?? 17;

  // Format large (640x400 × scale=2 = 1280x800) pour rester nette en pleine
  // largeur A4 (~180mm).
  const params = [
    'size=640x400', 'scale=2', 'maptype=hybrid', 'language=fr',
    `center=${center.lat},${center.lng}`, `zoom=${effectiveZoom}`,
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

/**
 * Vue satellite avec marqueurs étiquetés (1 par zone). Le cadrage est
 * laissé à Google Maps via le paramètre `visible` (auto-fit sur les
 * points listés) — pas besoin de calculer un bbox côté Node.
 *
 * Labels : initiale de la zone (limitation Google Static Maps — 1 char
 * alphanumérique). La légende détaillée nom-par-nom est rendue à part
 * dans le template PDF, sous l'image.
 *
 * @returns {Promise<{ url: string, legend: Array<{ initial: string, name: string, color: string }> } | null>}
 */
async function buildZonesStaticMap({ site, zones }) {
  const key = (config.googleMapsApiKey || '').trim();
  if (!key) return null;

  const located = (zones || []).filter(z => z.latitude != null && z.longitude != null);
  if (!located.length) return null;

  // Couleurs accessibles distinctes pour les pins (cycle si > 10 zones).
  // Choix sobre, contraste suffisant sur vue satellite hybrid.
  const PALETTE = [
    '0x1d4ed8', '0xb91c1c', '0x16a34a', '0xd97706', '0x7c3aed',
    '0x0ea5e9', '0xdb2777', '0x059669', '0xea580c', '0x6366f1',
  ];

  // Étiquetage SÉQUENTIEL — A, B, C, D… (lettres seules sur 1-26 zones,
  // chiffres au-delà). Évite le bug « B, C, 3, 4 » obtenu quand on
  // utilisait l'initiale du nom (3 zones « Cellules N » donnaient toutes
  // C, donc collisions et bascule chiffre).
  const legend = [];
  const markerParams = [];

  function labelFor(idx) {
    return idx < 26 ? String.fromCharCode(65 + idx) : String(idx - 25);
  }

  located.forEach((z, idx) => {
    const label = labelFor(idx);
    const color = PALETTE[idx % PALETTE.length];
    legend.push({ initial: label, name: z.name || `Zone ${idx + 1}`, color: `#${color.slice(2)}` });
    markerParams.push(
      'markers=' + encodeURIComponent(`color:${color}|label:${label}|size:mid|${z.latitude},${z.longitude}`)
    );
  });

  // visible= force l'auto-fit sur tous les points listés (pas besoin de
  // center/zoom explicites — Google calcule le cadrage).
  const visibles = located.map(z => `${z.latitude},${z.longitude}`).join('|');

  const params = [
    'size=640x400', 'scale=2', 'maptype=hybrid', 'language=fr',
    `visible=${encodeURIComponent(visibles)}`,
    ...markerParams,
    `key=${encodeURIComponent(key)}`,
  ];

  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.join('&')}`;
  try {
    const res = await fetch(url, {
      headers: { Referer: REFERER },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log.warn(`Vue satellite zones indisponible (HTTP ${res.status})`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/png';
    return {
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
      legend,
    };
  } catch (e) {
    log.warn(`Vue satellite zones : ${e.message}`);
    return null;
  }
}

module.exports = { buildSiteStaticMap, buildZonesStaticMap };
