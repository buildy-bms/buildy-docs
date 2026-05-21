'use strict';

// Transcription audio → texte des notes vocales.
//
// Anthropic ne propose pas de speech-to-text (Claude n'accepte pas l'audio
// en entrée). On passe par l'API de transcription OpenAI (Whisper /
// gpt-4o-transcribe). C'est le SEUL fichier à modifier pour changer de
// moteur (Deepgram, AssemblyAI, Google Speech-to-Text…).
//
// Aucune dépendance npm : Node 20+ fournit fetch / FormData / Blob nativement.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

function isEnabled() {
  return !!config.openaiApiKey;
}

/**
 * Transcrit un fichier audio en texte.
 * @param {string} filePath  chemin absolu du fichier audio
 * @param {{language?: string}} opts
 * @returns {Promise<{text: string}>}
 */
async function transcribeAudio(filePath, { language = 'fr' } = {}) {
  if (!config.openaiApiKey) {
    throw new Error('Transcription indisponible : OPENAI_API_KEY non configurée.');
  }
  const buffer = fs.readFileSync(filePath);
  const filename = path.basename(filePath) || 'audio.webm';

  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('model', config.openaiTranscribeModel);
  form.append('language', language);

  const res = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI transcription ${res.status} : ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return { text: (data.text || '').trim() };
}

module.exports = { transcribeAudio, isEnabled };
