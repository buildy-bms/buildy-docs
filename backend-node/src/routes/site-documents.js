'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const sharp = require('sharp');
const { z } = require('zod');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;

const CATEGORIES = ['plan','schema_electrique','schema_synoptique','analyse_fonctionnelle',
  'datasheet','manuel_utilisateur','rapport_essais','photo','autre'];

// 25 MB max — DOE peut contenir des plans lourds
const MAX_BYTES = 25 * 1024 * 1024;

// Photos : on resize a max 1600px de cote + JPEG quality 82 → typique
// passage de 4-8 MB iPhone a 200-400 KB. EXIF strippe (privacy).
const PHOTO_MAX_DIM = 1600;
const PHOTO_JPEG_QUALITY = 82;
const IMAGE_MIMES = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif']);

function siteDocsDir(siteUuid) {
  const dir = path.resolve(config.attachmentsDir, '..', 'site-documents', siteUuid);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extFromMime(mime, fallbackName) {
  const map = {
    'application/pdf': '.pdf',
    'application/x-dwg': '.dwg', 'image/vnd.dwg': '.dwg',
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt',
  };
  if (map[mime]) return map[mime];
  // Fallback : recupere l'extension du filename d'origine
  const m = (fallbackName || '').match(/\.[a-z0-9]{1,8}$/i);
  return m ? m[0].toLowerCase() : '';
}

async function routes(fastify) {
  // GET /sites/:uuid/documents — liste filtree
  fastify.get('/sites/:uuid/documents', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });
    const { category, bacs_audit_system_id, bacs_audit_device_id,
      bacs_audit_zone_id, bacs_audit_meter_id, bacs_audit_bms_document_id } = request.query;
    let sql = `
      SELECT d.*, u.display_name AS uploaded_by_name
      FROM site_documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.site_id = ?
    `;
    const args = [site.site_id];
    if (category) { sql += ' AND d.category = ?'; args.push(category); }
    if (bacs_audit_system_id) {
      sql += ' AND d.bacs_audit_system_id = ?';
      args.push(parseInt(bacs_audit_system_id, 10));
    }
    if (bacs_audit_device_id) {
      sql += ' AND d.bacs_audit_device_id = ?';
      args.push(parseInt(bacs_audit_device_id, 10));
    }
    if (bacs_audit_zone_id) {
      sql += ' AND d.bacs_audit_zone_id = ?';
      args.push(parseInt(bacs_audit_zone_id, 10));
    }
    if (bacs_audit_meter_id) {
      sql += ' AND d.bacs_audit_meter_id = ?';
      args.push(parseInt(bacs_audit_meter_id, 10));
    }
    if (bacs_audit_bms_document_id) {
      sql += ' AND d.bacs_audit_bms_document_id = ?';
      args.push(parseInt(bacs_audit_bms_document_id, 10));
    }
    sql += ' ORDER BY d.uploaded_at DESC';
    return db.db.prepare(sql).all(...args);
  });

  // POST /sites/:uuid/documents — upload multipart (champs additionnels en query/header)
  // Note : le titre + categorie + rattachements peuvent venir en query string ou
  // en parts multipart. Pour simplicite, on les attend en query string.
  fastify.post('/sites/:uuid/documents', async (request, reply) => {
    const site = db.sites.getByUuid(request.params.uuid);
    if (!site || site.deleted_at) return reply.code(404).send({ detail: 'Site non trouve' });

    const { title, category, bacs_audit_system_id, bacs_audit_bms_document_id,
      bacs_audit_device_id, bacs_audit_zone_id, bacs_audit_meter_id } = request.query;
    if (!title) return reply.code(400).send({ detail: 'Title requis (query string)' });
    if (!category || !CATEGORIES.includes(category)) {
      return reply.code(400).send({ detail: 'Categorie invalide' });
    }

    const file = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) return reply.code(400).send({ detail: 'Aucun fichier recu' });

    const isImage = IMAGE_MIMES.has((file.mimetype || '').toLowerCase());
    const dir = siteDocsDir(site.site_uuid);

    // Pour les images on force JPEG optimise. Pour le reste (PDF/DWG/etc.)
    // on garde l'extension d'origine et on ecrit le stream tel quel.
    const filename = crypto.randomUUID() + (isImage ? '.jpg' : extFromMime(file.mimetype, file.filename));
    const fullPath = path.join(dir, filename);
    let storedMime = isImage ? 'image/jpeg' : (file.mimetype || 'application/octet-stream');

    try {
      if (isImage) {
        const transformer = sharp()
          .rotate()
          .resize(PHOTO_MAX_DIM, PHOTO_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true });
        await pipeline(file.file, transformer, fs.createWriteStream(fullPath));
        if (file.file.truncated) throw new Error('FILE_TOO_LARGE');
      } else {
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(fullPath);
          let aborted = false;
          file.file.pipe(ws);
          file.file.on('limit', () => {
            aborted = true;
            ws.destroy();
            fs.unlink(fullPath, () => {});
            reject(new Error('FILE_TOO_LARGE'));
          });
          ws.on('error', reject);
          ws.on('finish', () => {
            if (aborted) return;
            fs.open(fullPath, 'r', (err, fd) => {
              if (err) return resolve();
              fs.fsync(fd, () => fs.close(fd, () => resolve()));
            });
          });
        });
      }
    } catch (err) {
      try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
      if (err.message === 'FILE_TOO_LARGE') {
        return reply.code(413).send({ detail: `Fichier trop lourd (max ${MAX_BYTES / 1024 / 1024} MB)` });
      }
      throw err;
    }

    const sizeBytes = fs.statSync(fullPath).size;
    if (sizeBytes === 0) {
      return reply.code(500).send({ detail: 'Echec ecriture fichier' });
    }

    const userId = request.authUser?.id;
    const r = db.db.prepare(`
      INSERT INTO site_documents
        (site_id, title, category, filename, original_name, size_bytes, mime_type,
         bacs_audit_system_id, bacs_audit_bms_document_id, bacs_audit_device_id,
         bacs_audit_zone_id, bacs_audit_meter_id, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      site.site_id, title, category, filename, file.filename, sizeBytes, storedMime,
      bacs_audit_system_id ? parseInt(bacs_audit_system_id, 10) : null,
      bacs_audit_bms_document_id ? parseInt(bacs_audit_bms_document_id, 10) : null,
      bacs_audit_device_id ? parseInt(bacs_audit_device_id, 10) : null,
      bacs_audit_zone_id ? parseInt(bacs_audit_zone_id, 10) : null,
      bacs_audit_meter_id ? parseInt(bacs_audit_meter_id, 10) : null,
      userId || null,
    );
    db.auditLog.add({ userId, action: 'site_document.upload',
      payload: { site_uuid: site.site_uuid, title, category, filename: file.filename } });
    log.info(`Site document uploaded: ${file.filename} → site ${site.site_uuid} (id=${r.lastInsertRowid})`);
    return reply.code(201).send(db.db.prepare('SELECT * FROM site_documents WHERE id = ?').get(r.lastInsertRowid));
  });

  // GET /site-documents/:id/download — sert le fichier
  fastify.get('/site-documents/:id/download', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const doc = db.db.prepare(`
      SELECT d.*, s.site_uuid FROM site_documents d
      JOIN sites s ON s.site_id = d.site_id WHERE d.id = ?
    `).get(id);
    if (!doc) return reply.code(404).send({ detail: 'Document non trouve' });
    const fullPath = path.join(siteDocsDir(doc.site_uuid), doc.filename);
    if (!fs.existsSync(fullPath)) return reply.code(404).send({ detail: 'Fichier introuvable sur disque' });
    return reply
      .header('Content-Type', doc.mime_type || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${doc.original_name || doc.filename}"`)
      .send(fs.createReadStream(fullPath));
  });

  // PATCH /site-documents/:id — title, category, rattachements
  fastify.patch('/site-documents/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const doc = db.db.prepare('SELECT * FROM site_documents WHERE id = ?').get(id);
    if (!doc) return reply.code(404).send({ detail: 'Document non trouve' });
    const schema = z.object({
      title: z.string().min(1).optional(),
      category: z.enum(CATEGORIES).optional(),
      bacs_audit_system_id: z.number().int().nullable().optional(),
      bacs_audit_bms_document_id: z.number().int().nullable().optional(),
      bacs_audit_device_id: z.number().int().nullable().optional(),
      bacs_audit_zone_id: z.number().int().nullable().optional(),
      bacs_audit_meter_id: z.number().int().nullable().optional(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    const sets = [], args = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`); args.push(v);
    }
    if (sets.length) {
      args.push(id);
      db.db.prepare(`UPDATE site_documents SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    return db.db.prepare('SELECT * FROM site_documents WHERE id = ?').get(id);
  });

  // DELETE /site-documents/:id
  fastify.delete('/site-documents/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const doc = db.db.prepare(`
      SELECT d.*, s.site_uuid FROM site_documents d
      JOIN sites s ON s.site_id = d.site_id WHERE d.id = ?
    `).get(id);
    if (!doc) return reply.code(404).send({ detail: 'Document non trouve' });
    const fullPath = path.join(siteDocsDir(doc.site_uuid), doc.filename);
    try { fs.unlinkSync(fullPath); } catch { /* fichier deja supprime */ }
    db.db.prepare('DELETE FROM site_documents WHERE id = ?').run(id);
    db.auditLog.add({ userId: request.authUser?.id, action: 'site_document.delete',
      payload: { site_uuid: doc.site_uuid, filename: doc.filename } });
    return reply.code(204).send();
  });
}

module.exports = routes;
