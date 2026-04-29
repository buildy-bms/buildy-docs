'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const config = require('../config');
const db = require('../database');
const log = require('../lib/logger').system;
const { assertWrite } = require('../lib/af-permissions');

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function ensureSectionDir(afId) {
  const dir = path.join(config.attachmentsDir, String(afId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Captures partagees rattachees aux templates (pas a une AF) — stockees
// dans un sous-dossier dedie pour ne pas se melanger aux captures d'AFs.
function ensureTemplateDir(kind /* 'section' | 'equipment' */) {
  const dir = path.join(config.attachmentsDir, '_tpl', kind);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Helper d'upload + ecriture disque (factorise entre section/templates).
async function streamFileToDisk(file, fullPath) {
  return new Promise((resolve, reject) => {
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
  // GET /api/sections/:id/attachments — captures effectives :
  // celles de la section + celles heritees des templates referencees.
  // Les heritees portent source='section_template' ou 'equipment_template'
  // (read-only au niveau section, editables au niveau du template).
  fastify.get('/sections/:id/attachments', async (request) => {
    const sectionId = parseInt(request.params.id, 10);
    const effective = db.attachments.listEffectiveForSection(sectionId);
    // Enrichit chaque attachment avec son URL servable (path different selon source)
    return effective.map(a => {
      let urlPath;
      if (a.source === 'section_template') urlPath = `/attachments/_tpl/section/${a.filename}`;
      else if (a.source === 'equipment_template') urlPath = `/attachments/_tpl/equipment/${a.filename}`;
      else {
        // section AF : on doit retrouver l'af_id pour construire le path
        const sec = db.sections.getById(a.section_id);
        urlPath = sec ? `/attachments/${sec.af_id}/${a.filename}` : null;
      }
      return { ...a, url_path: urlPath };
    });
  });

  // POST /api/sections/:id/attachments — upload multipart
  fastify.post('/sections/:id/attachments', async (request, reply) => {
    const sectionId = parseInt(request.params.id, 10);
    const section = db.sections.getById(sectionId);
    if (!section) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (!assertWrite(request, reply, section.af_id)) return;

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

    const attachment = db.attachments.create({
      sectionId,
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

  // POST /api/attachments/:id/move — deplacer une capture vers une autre
  // section de la MEME AF. Refuse les attachments heritees (template).
  fastify.post('/attachments/:id/move', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const targetSectionId = parseInt(request.body?.section_id, 10);
    if (!targetSectionId) return reply.code(400).send({ detail: 'section_id requis' });
    const att = db.attachments.getById(id);
    if (!att) return reply.code(404).send({ detail: 'Attachment non trouvé' });
    if (!att.section_id) return reply.code(400).send({ detail: 'Capture héritée d\'un modèle — non déplaçable depuis l\'AF' });
    const sourceSec = db.sections.getById(att.section_id);
    const targetSec = db.sections.getById(targetSectionId);
    if (!targetSec) return reply.code(404).send({ detail: 'Section cible introuvable' });
    if (!sourceSec || sourceSec.af_id !== targetSec.af_id) {
      return reply.code(400).send({ detail: 'Déplacement entre AFs interdit' });
    }
    if (!assertWrite(request, reply, sourceSec.af_id)) return;
    if (sourceSec.id === targetSec.id) return att; // no-op

    // Position : append en queue de la section cible.
    const targetExisting = db.attachments.listBySection(targetSectionId);
    const newPos = targetExisting.length;
    db.db.prepare('UPDATE attachments SET section_id = ?, position = ? WHERE id = ?')
      .run(targetSectionId, newPos, id);

    db.auditLog.add({
      afId: sourceSec.af_id, sectionId: targetSectionId, userId: request.authUser?.id,
      action: 'attachment.move',
      payload: { attachment_id: id, from_section_id: sourceSec.id, to_section_id: targetSectionId },
    });
    return db.attachments.getById(id);
  });

  // PATCH /api/attachments/:id — caption / position
  fastify.patch('/attachments/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const att = db.attachments.getById(id);
    if (!att) return reply.code(404).send({ detail: 'Attachment non trouvé' });
    const sec = db.sections.getById(att.section_id);
    if (sec && !assertWrite(request, reply, sec.af_id)) return;

    let body;
    try { body = updateSchema.parse(request.body); }
    catch (err) { return reply.code(400).send({ detail: err.errors?.[0]?.message || 'Validation' }); }

    return db.attachments.update(id, body);
  });

  // POST /api/sections/:id/attachments/reorder — reorder en bloc
  fastify.post('/sections/:id/attachments/reorder', async (request, reply) => {
    const sectionId = parseInt(request.params.id, 10);
    const sec = db.sections.getById(sectionId);
    if (!sec) return reply.code(404).send({ detail: 'Section non trouvée' });
    if (!assertWrite(request, reply, sec.af_id)) return;
    const ids = Array.isArray(request.body?.order) ? request.body.order : null;
    if (!ids?.length) return reply.code(400).send({ detail: 'order doit etre un tableau d ids' });
    const tx = db.db.transaction(() => {
      ids.forEach((id, i) => db.attachments.update(id, { position: i }));
    });
    tx();
    return { ok: true };
  });

  // DELETE /api/attachments/:id (gère les 3 types de parents)
  fastify.delete('/attachments/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const att = db.attachments.getById(id);
    if (!att) return reply.code(404).send({ detail: 'Attachment non trouvé' });

    let fullPath = null;
    if (att.section_id) {
      const section = db.sections.getById(att.section_id);
      if (section && !assertWrite(request, reply, section.af_id)) return;
      fullPath = path.join(config.attachmentsDir, String(section?.af_id || ''), att.filename);
      db.auditLog.add({
        afId: section?.af_id, sectionId: att.section_id, userId: request.authUser?.id,
        action: 'attachment.delete', payload: { attachment_id: id, filename: att.filename },
      });
    } else if (att.section_template_id) {
      fullPath = path.join(config.attachmentsDir, '_tpl', 'section', att.filename);
    } else if (att.equipment_template_id) {
      fullPath = path.join(config.attachmentsDir, '_tpl', 'equipment', att.filename);
    }

    if (fullPath) {
      fs.unlink(fullPath, (err) => {
        if (err && err.code !== 'ENOENT') log.warn(`Failed to delete file ${fullPath}: ${err.message}`);
      });
    }
    db.attachments.delete(id);
    return { ok: true };
  });

  // ── Captures sur templates (section_templates / equipment_templates) ──
  // Ces captures sont reutilisees automatiquement par les AFs qui referencent
  // le template — evite de re-uploader les memes screenshots dans chaque AF.

  // Helper interne pour les routes template attachment.
  async function uploadToTemplate(request, reply, { kind, templateRow, templateIdField, parentDir }) {
    if (!templateRow) return reply.code(404).send({ detail: 'Template non trouvé' });
    const file = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) return reply.code(400).send({ detail: 'Aucun fichier reçu' });
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.code(400).send({ detail: `Type de fichier non supporté : ${file.mimetype}` });
    }
    const filename = crypto.randomUUID() + extFor(file.mimetype);
    const dir = ensureTemplateDir(parentDir);
    const fullPath = path.join(dir, filename);
    try { await streamFileToDisk(file, fullPath); }
    catch (err) {
      if (err.message === 'FILE_TOO_LARGE') {
        return reply.code(413).send({ detail: `Fichier trop lourd (max ${MAX_BYTES / 1024 / 1024} MB)` });
      }
      throw err;
    }
    let writtenSize = 0;
    try { writtenSize = fs.statSync(fullPath).size; } catch {}
    if (writtenSize === 0) return reply.code(500).send({ detail: 'Echec ecriture fichier' });

    const userId = request.authUser?.id;
    const existing = kind === 'section'
      ? db.attachments.listBySectionTemplate(templateRow.id)
      : db.attachments.listByEquipmentTemplate(templateRow.id);
    const attachment = db.attachments.create({
      [templateIdField]: templateRow.id,
      filename, originalName: file.filename,
      position: existing.length, uploadedBy: userId,
    });
    log.info(`Attachment uploaded: ${file.filename} → ${kind}_template #${templateRow.id} (${attachment.id})`);
    return attachment;
  }

  // GET / POST captures pour section_templates
  fastify.get('/section-templates/:id/attachments', async (request) => {
    return db.attachments.listBySectionTemplate(parseInt(request.params.id, 10));
  });
  fastify.post('/section-templates/:id/attachments', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.sectionTemplates.getById(id);
    return uploadToTemplate(request, reply, {
      kind: 'section', templateRow: tpl,
      templateIdField: 'sectionTemplateId', parentDir: 'section',
    });
  });
  fastify.post('/section-templates/:id/attachments/reorder', async (request, reply) => {
    const ids = Array.isArray(request.body?.order) ? request.body.order : null;
    if (!ids?.length) return reply.code(400).send({ detail: 'order requis' });
    const tx = db.db.transaction(() => {
      ids.forEach((aid, i) => db.attachments.update(aid, { position: i }));
    });
    tx();
    return { ok: true };
  });

  // GET / POST captures pour equipment_templates
  fastify.get('/equipment-templates/:id/attachments', async (request) => {
    return db.attachments.listByEquipmentTemplate(parseInt(request.params.id, 10));
  });
  fastify.post('/equipment-templates/:id/attachments', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const tpl = db.equipmentTemplates.getById(id);
    return uploadToTemplate(request, reply, {
      kind: 'equipment', templateRow: tpl,
      templateIdField: 'equipmentTemplateId', parentDir: 'equipment',
    });
  });
  fastify.post('/equipment-templates/:id/attachments/reorder', async (request, reply) => {
    const ids = Array.isArray(request.body?.order) ? request.body.order : null;
    if (!ids?.length) return reply.code(400).send({ detail: 'order requis' });
    const tx = db.db.transaction(() => {
      ids.forEach((aid, i) => db.attachments.update(aid, { position: i }));
    });
    tx();
    return { ok: true };
  });
}

module.exports = routes;
