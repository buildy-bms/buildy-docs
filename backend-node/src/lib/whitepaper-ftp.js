'use strict';

// Publication des PDF de livres blancs vers le FTP OVH buildy.fr.
// Reuse l'hébergement et les credentials FTP de la FAQ (config faqFtp*),
// avec un dossier et une URL publique dédiés (config wpFtp*).
//
// Le fichier distant prend le nom du slug du livre blanc : l'URL publique
// est donc stable, et une republication réécrit le même fichier.

const fs = require('node:fs');
const { Client } = require('basic-ftp');
const config = require('../config');
const log = require('./logger').system;

/**
 * Envoie un PDF local vers le FTP OVH et renvoie l'URL publique.
 * @param {string} localPath  chemin du PDF généré localement
 * @param {string} filename   nom du fichier distant (ex: 'methode-audit-bacs.pdf')
 * @returns {Promise<{url:string, filename:string, size:number}>}
 */
async function uploadWhitepaperPdf(localPath, filename) {
  if (!config.faqFtpHost || !config.faqFtpUser || !config.faqFtpPassword) {
    throw new Error('FTP non configuré (FAQ_FTP_HOST / FAQ_FTP_USER / FAQ_FTP_PASSWORD manquants)');
  }
  if (!filename || !/^[a-z0-9._-]+\.pdf$/i.test(filename)) {
    throw new Error(`Nom de fichier invalide : ${filename}`);
  }
  if (!fs.existsSync(localPath)) {
    throw new Error(`PDF introuvable : ${localPath}`);
  }
  const size = fs.statSync(localPath).size;

  const client = new Client(60_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: config.faqFtpHost,
      port: config.faqFtpPort,
      user: config.faqFtpUser,
      password: config.faqFtpPassword,
      secure: false,
    });
    await client.ensureDir(config.wpFtpRemoteDir);
    await client.uploadFrom(localPath, filename);
    // SITE CHMOD 644 : sans ça, certains serveurs FTP (dont OVH) créent
    // les fichiers en 600, ce qui empêche le serveur web de les servir
    // → 403 Forbidden côté visiteur. Best-effort : si le serveur ne
    // supporte pas SITE CHMOD, on log un warn et on continue.
    try {
      await client.send(`SITE CHMOD 644 ${filename}`);
    } catch (err) {
      log.warn(`SITE CHMOD 644 ${filename} a échoué : ${err.message}`);
    }
  } finally {
    client.close();
  }

  const url = `${config.wpFtpPublicBase}/${filename}`;
  log.info(`Livre blanc publié : ${filename} (${size} octets) -> ${url}`);
  return { url, filename, size };
}

module.exports = { uploadWhitepaperPdf };
