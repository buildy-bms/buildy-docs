'use strict';

// Transcodage des notes vocales en MP3.
//
// Les fichiers produits par MediaRecorder (notamment l'`audio/mp4` d'iOS
// Safari) sont souvent illisibles par l'élément <audio> : atome `moov`
// absent en tête, durée non renseignée → le lecteur « tourne en rond ».
// On re-encode en MP3 mono : format à trames, sans conteneur, lisible
// de façon fiable partout (iOS compris).
//
// Best-effort : si ffmpeg n'est pas installé ou échoue, l'appelant
// conserve le fichier d'origine.

const { execFile } = require('child_process');
const log = require('./logger').system;

/**
 * Transcode un fichier audio en MP3 mono 64 kbps.
 * @returns {Promise<boolean>} true si le MP3 a été produit.
 */
function transcodeToMp3(srcPath, destPath) {
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', srcPath,
        '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-y', destPath],
      { timeout: 120000 },
      (err) => {
        if (err) {
          log.warn(`Transcodage audio MP3 échoué (ffmpeg) : ${err.message}`);
          resolve(false);
        } else {
          resolve(true);
        }
      },
    );
  });
}

module.exports = { transcodeToMp3 };
