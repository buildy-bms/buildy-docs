'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const log = require('./logger').system;

// exifr est require lazy (seulement quand on parse de l'EXIF complet) pour
// ne pas pénaliser le boot de l'app.
let _exifr = null;
function getExifr() {
  if (!_exifr) _exifr = require('exifr');
  return _exifr;
}

const PHOTO_MAX_DIM = 1600;
const PHOTO_JPEG_QUALITY = 82;

const RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'avif', 'gif']);

// JPEG ne supporte pas l'alpha. Sans flatten, sharp compose la trans-
// parence sur du noir (defaut), ce qui donne un fond noir indesirable
// sur les captures PNG (frames Mac, logos, screenshots avec coins
// arrondis). On compose sur blanc avant JPEG. Sans effet sur les
// images deja opaques.
function createOptimizerStream({ maxDim = PHOTO_MAX_DIM, quality = PHOTO_JPEG_QUALITY } = {}) {
  return sharp()
    .rotate()
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true });
}

async function optimizeBuffer(buffer, { maxDim = PHOTO_MAX_DIM, quality = PHOTO_JPEG_QUALITY } = {}) {
  return sharp(buffer)
    .rotate()
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

function bufferToDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// Cache differencie par mime de sortie : `.jpg` pour les images opaques
// (compresse JPEG q=82), `.png` pour celles avec alpha (PNG palette).
// Permet de regenerer le bon format au lecture du cache.
function cachePathFor(absPath, ext = 'jpg') {
  const dir = path.join(path.dirname(absPath), '.optimized');
  const base = path.basename(absPath);
  return path.join(dir, `${base}.${ext}`);
}

function readCache(absPath, ext) {
  try {
    const cachePath = cachePathFor(absPath, ext);
    const srcStat = fs.statSync(absPath);
    const cacheStat = fs.statSync(cachePath);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) return fs.readFileSync(cachePath);
  } catch { /* miss */ }
  return null;
}

function writeCache(absPath, buffer, ext) {
  try {
    const cachePath = cachePathFor(absPath, ext);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, buffer);
  } catch (err) {
    log.warn(`image-optimizer: cache write failed for ${absPath}: ${err.message}`);
  }
}

async function optimizeFileToDataUrl(absPath, opts = {}) {
  if (!fs.existsSync(absPath)) return null;
  const ext = path.extname(absPath).slice(1).toLowerCase();

  if (ext === 'svg') {
    const base64 = fs.readFileSync(absPath).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
  }

  if (!RASTER_EXTS.has(ext)) {
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'octet-stream'}`;
    return bufferToDataUrl(fs.readFileSync(absPath), mime);
  }

  // Cache hit (PNG en priorite si l'image source supporte alpha) :
  const cachedPng = readCache(absPath, 'png');
  if (cachedPng) return bufferToDataUrl(cachedPng, 'image/png');
  const cachedJpg = readCache(absPath, 'jpg');
  if (cachedJpg) return bufferToDataUrl(cachedJpg, 'image/jpeg');

  try {
    const buffer = fs.readFileSync(absPath);
    const meta = await sharp(buffer).metadata();
    const maxDim = opts.maxDim || PHOTO_MAX_DIM;
    const quality = opts.quality || PHOTO_JPEG_QUALITY;
    const pipeline = sharp(buffer).rotate().resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
    if (meta.hasAlpha) {
      // PNG palette : preserve la transparence, ~5-10x plus leger qu'un
      // PNG truecolor. Quality=80 + compressionLevel=9 = ratio optimal.
      const optimized = await pipeline.png({ palette: true, quality: 80, compressionLevel: 9 }).toBuffer();
      writeCache(absPath, optimized, 'png');
      return bufferToDataUrl(optimized, 'image/png');
    }
    const optimized = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    writeCache(absPath, optimized, 'jpg');
    return bufferToDataUrl(optimized, 'image/jpeg');
  } catch (err) {
    log.warn(`image-optimizer: failed to optimize ${absPath}, falling back to raw: ${err.message}`);
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return bufferToDataUrl(fs.readFileSync(absPath), mime);
  }
}

// Lit DateTimeOriginal d'un buffer JPEG/HEIC sans dependance externe.
// EXIF stocke les dates en ASCII "YYYY:MM:DD HH:MM:SS" : on scanne les
// premiers 256ko du buffer pour le pattern. Renvoie un timestamp ISO ou null.
// Si plusieurs matches (DateTimeOriginal, DateTimeDigitized, DateTime),
// on prend le premier qui est typiquement DateTimeOriginal dans IFD0.
function readExifTakenAt(buffer) {
  if (!buffer || buffer.length < 32) return null;
  const head = buffer.slice(0, Math.min(buffer.length, 262144)).toString('latin1');
  const re = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g;
  const matches = [];
  let m;
  while ((m = re.exec(head)) !== null) {
    const [, Y, M, D, h, mi, s] = m;
    const iso = `${Y}-${M}-${D}T${h}:${mi}:${s}`;
    const t = Date.parse(iso);
    if (!isNaN(t) && t > 946684800000 /* 2000-01-01 */) matches.push({ iso, t });
    if (matches.length >= 3) break;
  }
  if (matches.length === 0) return null;
  // Prefere la plus ancienne (DateTimeOriginal devrait l'etre).
  matches.sort((a, b) => a.t - b.t);
  return matches[0].iso;
}

// Lit les métadonnées EXIF utiles d'un buffer image (JPEG, HEIC, TIFF…).
// Renvoie { taken_at, gps_latitude, gps_longitude, camera_make, camera_model }
// avec les champs manquants à null. JAMAIS de throw : si le parser échoue
// ou si le fichier n'a pas d'EXIF, on retourne tout à null. Fallback sur
// readExifTakenAt() pour la date si exifr ne la trouve pas (regex sur les
// 256k premiers bytes — moins précis mais plus tolérant aux EXIF tronqués).
async function readExifMetadata(buffer) {
  const result = {
    taken_at: null,
    gps_latitude: null,
    gps_longitude: null,
    camera_make: null,
    camera_model: null,
  };
  if (!buffer || buffer.length < 32) return result;
  let parsedKeys = [];
  let parseError = null;
  try {
    const exifr = getExifr();
    // gps:true demande explicitement à exifr de décoder le segment GPS
    // (séparé de IFD0/Exif). Sans ça, certains JPEG iOS retournent les
    // tags Make/Model mais pas latitude/longitude.
    const data = await exifr.parse(buffer, { gps: true, ifd0: true, exif: true });
    if (data) {
      parsedKeys = Object.keys(data);
      // exifr expose latitude/longitude déjà en degrés décimaux signés.
      if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        result.gps_latitude = data.latitude;
        result.gps_longitude = data.longitude;
      }
      const dt = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
      if (dt instanceof Date && !isNaN(dt.getTime())) {
        result.taken_at = dt.toISOString();
      }
      if (typeof data.Make === 'string')  result.camera_make = data.Make.trim() || null;
      if (typeof data.Model === 'string') result.camera_model = data.Model.trim() || null;
    }
  } catch (err) {
    parseError = err.message;
  }
  if (!result.taken_at) result.taken_at = readExifTakenAt(buffer);
  // Log de diagnostic temporaire : permet de voir, pour chaque upload,
  // ce que exifr a réussi à extraire du buffer original. À retirer une
  // fois l'origine du strip EXIF iPhone identifiée.
  log.info(`exif-debug: buffer=${buffer.length}B keys=${parsedKeys.join(',') || '(none)'} err=${parseError || 'null'} → date=${result.taken_at} gps=${result.gps_latitude},${result.gps_longitude} cam=${result.camera_make}/${result.camera_model}`);
  return result;
}

module.exports = {
  PHOTO_MAX_DIM,
  PHOTO_JPEG_QUALITY,
  createOptimizerStream,
  optimizeBuffer,
  optimizeFileToDataUrl,
  bufferToDataUrl,
  readExifTakenAt,
  readExifMetadata,
};
