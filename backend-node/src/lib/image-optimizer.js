'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const log = require('./logger').system;

const PHOTO_MAX_DIM = 1600;
const PHOTO_JPEG_QUALITY = 82;

const RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'avif', 'gif']);

function createOptimizerStream({ maxDim = PHOTO_MAX_DIM, quality = PHOTO_JPEG_QUALITY } = {}) {
  return sharp()
    .rotate()
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true });
}

async function optimizeBuffer(buffer, { maxDim = PHOTO_MAX_DIM, quality = PHOTO_JPEG_QUALITY } = {}) {
  return sharp(buffer)
    .rotate()
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

function bufferToDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function cachePathFor(absPath) {
  const dir = path.join(path.dirname(absPath), '.optimized');
  const base = path.basename(absPath);
  return path.join(dir, `${base}.jpg`);
}

function readCache(absPath) {
  try {
    const cachePath = cachePathFor(absPath);
    const srcStat = fs.statSync(absPath);
    const cacheStat = fs.statSync(cachePath);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) return fs.readFileSync(cachePath);
  } catch { /* miss */ }
  return null;
}

function writeCache(absPath, buffer) {
  try {
    const cachePath = cachePathFor(absPath);
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

  const cached = readCache(absPath);
  if (cached) return bufferToDataUrl(cached, 'image/jpeg');

  try {
    const optimized = await optimizeBuffer(fs.readFileSync(absPath), opts);
    writeCache(absPath, optimized);
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

module.exports = {
  PHOTO_MAX_DIM,
  PHOTO_JPEG_QUALITY,
  createOptimizerStream,
  optimizeBuffer,
  optimizeFileToDataUrl,
  bufferToDataUrl,
  readExifTakenAt,
};
