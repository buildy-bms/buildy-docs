'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function ensureSectionDir(afId) {
  const dir = path.join(config.attachmentsDir, String(afId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extFor(mime) {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg':
    case 'image/jpg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    default: return '.bin';
  }
}

const updateSchema = z.object({
  caption: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

async function routes(fastify) {
  // GET /api/sections/:id/attachments
  fastify.get('/sections/:id/attachments', async (request) => {
    return db.attachments.listBySection(parseInt(request.params.id, 10));
  });

  // POST /api/sections/:id/attachments — upload multipart
  fastify.post('/sections/:id/attachments', async (request, reply) => {
    const sectionId = parseInt(request.params.id, 10);
    const section = db.sections.getById(sectionId);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });

    const file = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) return reply.code(400).send({ detail: 'Aucun fichier reçu' });

    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.code(400).send({ detail: `Type de fichier non supporté : ${file.mimetype}` });
    }

    // Génère un nom unique
    const filename = crypto.randomUUID() + extFor(file.mimetype);
    const dir = ensureSectionDir(section.af_id);
    const fullPath = path.join(dir, filename);

    // Stream vers le disque + fsync pour garantir que le fichier est
    // disponible immediatement aux GETs qui suivent (sinon le frontend
    // peut recevoir une image tronquee si son refresh post-upload est
    // plus rapide que le flush du filesystem).
    try {
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
          // Force le flush kernel → disque AVANT de retourner OK
          fs.open(fullPath, 'r', (err, fd) => {
            if (err) return resolve();
            fs.fsync(fd, () => fs.close(fd, () => resolve()));
          });
        });
      });
    } catch (err) {
      if (err.message === 'FILE_TOO_LARGE') {
        return reply.code(413).send({ detail: `Fichier trop lourd (max ${MAX_BYTES / 1024 / 1024} MB)` });
      }
      throw err;
    }

    // Verifie que le fichier est bien sur disque avec la bonne taille
    let writtenSize = 0;
    try { writtenSize = fs.statSync(fullPath).size; } catch {}
    if (writtenSize === 0) {
      return reply.code(500).send({ detail: 'Echec ecriture fichier' });
    }

    const userId = request.authUser?.id;
    const existing = db.attachments.listBySection(sectionId);
    const position = existing.length;

    const attachment = db.attachments.create(sectionId, {
      filename, originalName: file.filename,
      position, uploadedBy: userId,
    });
    db.auditLog.add({
      afId: section.af_id, sectionId, userId, action: 'attachment.upload',
      payload: { filename: file.filename, attachment_id: attachment.id },
    });
    log.info(`Attachment uploaded: ${file.filename} → section #${sectionId} (${attachment.id})`);
    return attachment;
  });

  // PATCH /api/attachments/:id — caption / position
  fastify.patch('/attachments/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const att = db.attachments.getById(id);
    if (!att) return reply.code(404).send({ detail: 'Attachment non trouvé' });

    let body;
    try { body = updateSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    return db.attachments.update(id, body);
  });

  // POST /api/sections/:id/attachments/reorder — reorder en bloc
  fastify.post('/sections/:id/attachments/reorder', async (request, reply) => {
    const ids = Array.isArray(request.body?.order) ? request.body.order : null;
    if (!ids?.length) return reply.code(400).send({ detail: 'order doit etre un tableau d ids' });
    const tx = db.db.transaction(() => {
      ids.forEach((id, i) => db.attachments.update(id, { position: i }));
    });
    tx();
    return { ok: true };
  });

  // DELETE /api/attachments/:id
  fastify.delete('/attachments/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const att = db.attachments.getById(id);
    if (!att) return reply.code(404).send({ detail: 'Attachment non trouvé' });

    const section = db.sections.getById(att.section_id);
    const fullPath = path.join(config.attachmentsDir, String(section?.af_id || ''), att.filename);
    fs.unlink(fullPath, (err) => {
      if (err && err.code !== 'ENOENT') log.warn(`Failed to delete file ${fullPath}: ${err.message}`);
    });

    db.attachments.delete(id);
    db.auditLog.add({
      afId: section?.af_id, sectionId: att.section_id, userId: request.authUser?.id,
      action: 'attachment.delete', payload: { attachment_id: id, filename: att.filename },
    });
    return { ok: true };
  });
}

module.exports = routes;
