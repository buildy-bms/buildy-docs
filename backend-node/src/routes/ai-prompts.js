'use strict';

// Routes d'administration des prompts IA editables.
// /api/ai-prompts                 -> liste tous les prompts (current + default + meta)
// /api/ai-prompts/:key            -> details + historique des versions
// PATCH /api/ai-prompts/:key      -> body: { body, label? } modifie le prompt courant
// POST  /api/ai-prompts/:key/reset -> remet le prompt par defaut (efface l'override)
// POST  /api/ai-prompts/:key/restore/:versionId -> restaure une version historique

const db = require('../database');
const log = require('../lib/logger').system;
const {
  PROMPT_KEY_LIBRARY,
  DEFAULT_SYSTEM_PROMPT_LIBRARY,
} = require('../lib/claude');

// Catalogue des prompts exposes a l'admin (cle -> meta)
const PROMPT_CATALOG = {
  [PROMPT_KEY_LIBRARY]: {
    label: 'Bibliothèque (sections, fonctionnalités, équipements)',
    description: 'Prompt système utilisé par le bouton "Reformuler avec Claude" sur toutes les fiches de la bibliothèque (sections types, fonctionnalités, descriptions et justifications BACS d\'équipements).',
    default_body: DEFAULT_SYSTEM_PROMPT_LIBRARY,
  },
};

function expand(key) {
  const meta = PROMPT_CATALOG[key];
  if (!meta) return null;
  const row = db.aiPrompts.get(key);
  return {
    key,
    label: meta.label,
    description: meta.description,
    body: row?.body || meta.default_body,
    is_overridden: !!row,
    default_body: meta.default_body,
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null,
  };
}

async function routes(fastify) {
  // GET /api/ai-prompts — liste tous les prompts du catalogue
  fastify.get('/ai-prompts', async () => {
    return Object.keys(PROMPT_CATALOG).map(expand);
  });

  // GET /api/ai-prompts/:key — detail + historique
  fastify.get('/ai-prompts/:key', async (request, reply) => {
    const { key } = request.params;
    const item = expand(key);
    if (!item) return reply.code(404).send({ detail: 'Prompt inconnu' });
    const versions = db.aiPrompts.listVersions(key);
    return { ...item, versions };
  });

  // PATCH /api/ai-prompts/:key — sauvegarde une nouvelle version courante
  fastify.patch('/ai-prompts/:key', async (request, reply) => {
    const { key } = request.params;
    if (!PROMPT_CATALOG[key]) return reply.code(404).send({ detail: 'Prompt inconnu' });
    const body = (request.body?.body || '').trim();
    if (!body) return reply.code(400).send({ detail: 'Corps du prompt vide' });
    if (body.length > 30000) return reply.code(400).send({ detail: 'Prompt trop long (>30000 chars)' });
    db.aiPrompts.upsert({
      key,
      body,
      updatedBy: request.authUser?.id || null,
      label: request.body?.label || null,
    });
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'ai_prompt.update',
      payload: { key, length: body.length, label: request.body?.label || null },
    });
    log.info(`Prompt IA ${key} mis a jour par user=${request.authUser?.id}`);
    return expand(key);
  });

  // POST /api/ai-prompts/:key/reset — supprime l'override, retour au defaut code
  fastify.post('/ai-prompts/:key/reset', async (request, reply) => {
    const { key } = request.params;
    if (!PROMPT_CATALOG[key]) return reply.code(404).send({ detail: 'Prompt inconnu' });
    db.aiPrompts.delete(key);
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'ai_prompt.reset',
      payload: { key },
    });
    log.info(`Prompt IA ${key} reinitialise par user=${request.authUser?.id}`);
    return expand(key);
  });

  // POST /api/ai-prompts/:key/restore/:versionId — restaure une version
  fastify.post('/ai-prompts/:key/restore/:versionId', async (request, reply) => {
    const { key, versionId } = request.params;
    if (!PROMPT_CATALOG[key]) return reply.code(404).send({ detail: 'Prompt inconnu' });
    const v = db.aiPrompts.getVersion(parseInt(versionId, 10));
    if (!v || v.key !== key) return reply.code(404).send({ detail: 'Version introuvable' });
    db.aiPrompts.upsert({
      key,
      body: v.body,
      updatedBy: request.authUser?.id || null,
      label: `Restauration v${versionId}`,
    });
    db.auditLog.add({
      userId: request.authUser?.id,
      action: 'ai_prompt.restore',
      payload: { key, versionId: parseInt(versionId, 10) },
    });
    return expand(key);
  });
}

module.exports = routes;
