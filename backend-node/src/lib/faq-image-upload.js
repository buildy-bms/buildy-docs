'use strict';

// Upload d'images depuis l'éditeur FAQ vers le FTP OVH buildy.fr.
// Reuse le même hébergement que les captures de la doc Notion
// (config FAQ_FTP_* avec fallback sur FTP_*).
//
// Pipeline : multipart -> sharp (resize ≤1600px, recompression) -> uuid + ext
// -> FTP push -> URL publique.

const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('basic-ftp');
const sharp = require('sharp');
const config = require('../config');
const log = require('./logger').system;

const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB en entrée
const MAX_WIDTH = 1600;

function _extFromMime(mime) {
  if (!mime) return null;
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return null;
}

async function _optimize(buffer, ext) {
  // GIF : on ne touche pas (animations fragiles avec sharp).
  if (ext === 'gif') return { buffer, ext };

  const img = sharp(buffer, { failOn: 'error' });
  const meta = await img.metadata();
  let pipeline = img;
  if (meta.width && meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }
  // Standardise vers WebP pour une compression efficace, sauf si PNG transparent.
  if (ext === 'png' && meta.hasAlpha) {
    return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(), ext: 'png' };
  }
  return { buffer: await pipeline.webp({ quality: 82 }).toBuffer(), ext: 'webp' };
}

async function uploadImage(buffer, mime) {
  if (!config.faqFtpHost || !config.faqFtpUser || !config.faqFtpPassword) {
    throw new Error('FTP non configuré (FAQ_FTP_HOST / FAQ_FTP_USER / FAQ_FTP_PASSWORD manquants)');
  }
  if (!buffer || !buffer.length) throw new Error('Fichier vide');
  if (buffer.length > MAX_BYTES) throw new Error(`Fichier > ${MAX_BYTES / 1024 / 1024} MB`);

  const inExt = _extFromMime(mime);
  if (!inExt || !ALLOWED_EXTS.includes(inExt)) {
    throw new Error(`Type non supporté (${mime}) — autorisés : ${ALLOWED_EXTS.join(', ')}`);
  }

  const optimized = await _optimize(buffer, inExt);
  const uuid = crypto.randomUUID();
  const filename = `${uuid}.${optimized.ext}`;

  // Push FTP
  const client = new Client(30_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: config.faqFtpHost,
      port: config.faqFtpPort,
      user: config.faqFtpUser,
      password: config.faqFtpPassword,
      secure: false,
    });
    await client.ensureDir(config.faqFtpRemoteDir);
    const { Readable } = require('node:stream');
    await client.uploadFrom(Readable.from(optimized.buffer), filename);
  } finally {
    client.close();
  }

  // Récupère width finale via sharp pour fournir au client (markdown =Wxauto)
  let width = null;
  try {
    const m = await sharp(optimized.buffer).metadata();
    width = m.width || null;
  } catch { /* ignore */ }

  const url = `${config.faqFtpPublicBase}/${filename}`;
  log.info(`FAQ image uploaded: ${filename} (${optimized.buffer.length} bytes) -> ${url}`);
  return { url, width, size: optimized.buffer.length, format: optimized.ext };
}

module.exports = { uploadImage };
