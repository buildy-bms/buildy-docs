'use strict';

/**
 * Chiffrement AES-256-GCM pour les credentials site (passwords notamment).
 *
 * Cle derivee du JWT_SECRET via scryptSync (pas besoin d'env var dediee).
 * En prod, le JWT_SECRET est obligatoirement non-defaut (cf config.js
 * validation au boot), donc la cle est forte.
 *
 * Format de stockage : "ivHex:authTagHex:cipherHex" (3 segments separes
 * par `:`). 12 bytes IV + 16 bytes authTag + ciphertext variable.
 */

const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

let _cachedKey = null;

function _getKey() {
  if (_cachedKey) return _cachedKey;
  // Derivation deterministe du JWT_SECRET (32 bytes pour AES-256)
  // Salt fixe pour rester deterministe entre redemarrages — la securite
  // vient du secret JWT lui-meme, pas du salt.
  _cachedKey = crypto.scryptSync(config.jwtSecret, 'buildy-docs-crypto-v1', 32);
  return _cachedKey;
}

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = _getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(stored) {
  if (stored == null) return null;
  const key = _getKey();
  const parts = String(stored).split(':');
  if (parts.length !== 3) throw new Error('Ciphertext malforme (3 segments attendus)');
  const [ivHex, authTagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };
