'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const db = require('../database');
const { resolveSectionPoints } = require('./points-resolver');
const { BACS_INTRO_HTML, BACS_ARTICLES } = require('../seeds/bacs-articles');

let _client = null;
function client() {
  if (!_client) {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY non configure');
    _client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return _client;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Construit le prompt SYSTEM (cache-friendly : invariant entre sections d'une
 * meme AF, change rarement) et USER (specifique a la section courante).
 */
function buildPrompts(sectionId, { instruction } = {}) {
  const section = db.sections.getById(sectionId);
  if (!section) throw new Error('Section introuvable');
  const af = db.afs.getById(section.af_id);

  // Contexte parent
  let parent = null;
  if (section.parent_id) parent = db.sections.getById(section.parent_id);

  // Points + instances (si equipment)
  let pointsBlock = '';
  let instancesBlock = '';
  if (section.kind === 'equipment') {
    const points = resolveSectionPoints(sectionId);
    if (points.length) {
      pointsBlock = '\n\nPoints attendus pour cet equipement (deja resolus depuis le template + overrides) :\n' +
        points.map(p => `  - ${p.label} (${p.data_type}, ${p.direction === 'read' ? 'lecture' : 'ecriture'}${p.unit ? ', ' + p.unit : ''})`).join('\n');
    }
    const instances = db.equipmentInstances.listBySection(sectionId);
    if (instances.length) {
      instancesBlock = '\n\nInstances reelles sur le site :\n' +
        instances.map(i => `  - ${i.reference}${i.location ? ' a ' + i.location : ''} (${i.qty})`).join('\n');
    }
  }

  // BACS si reference
  let bacsBlock = '';
  if (section.bacs_articles) {
    const article = BACS_ARTICLES.find(a => a.id === section.bacs_articles);
    if (article) {
      bacsBlock = `\n\nDecret BACS applicable a cette section (${article.id}) — extraits :\n${stripHtml(article.full_html).slice(0, 1500)}`;
    }
  }

  const system = [
    `Tu es l'assistant de redaction Buildy AF, specialise dans la redaction d'analyses fonctionnelles GTB (Gestion Technique du Batiment).`,
    `Style :`,
    `- Francais professionnel, technique, precis. Accents corrects (e accent aigu, e accent grave, c cedille, etc.)`,
    `- Phrases concises, structure logique. Pas de superlatifs marketing.`,
    `- Vocabulaire metier GTB : CTA, BACS, niveau de service, supervision, anomalie, derive, etc.`,
    `- Pas de bullshit. Si une information manque, ne pas inventer.`,
    ``,
    `Format :`,
    `- HTML simple et propre, compatible Tiptap : <p>, <ul>/<li>, <strong>, <em>, <h3>, <blockquote>.`,
    `- Pas de classes CSS, pas de <div>, pas de styles inline.`,
    `- Structure naturelle : paragraphe d'introduction puis details ou listes si pertinent.`,
    `- Reste sur la section demandee, ne deborde pas sur le reste de l'AF.`,
    ``,
    `Reference Buildy : niveaux de service [E] Essentials, [S] Smart, [P] Premium.`,
    `Le decret BACS (R175-1 a R175-6) regit les obligations d'automation et de monitoring des batiments tertiaires.`,
    BACS_INTRO_HTML ? `\nIntro decret BACS pour contexte : ${stripHtml(BACS_INTRO_HTML).slice(0, 800)}` : '',
  ].join('\n');

  const user = [
    `Contexte AF :`,
    `- Client : ${af.client_name}`,
    `- Projet : ${af.project_name}`,
    af.site_address ? `- Site : ${af.site_address}` : null,
    af.service_level ? `- Niveau de service contractuel : ${af.service_level}` : null,
    ``,
    `Section a rediger :`,
    section.number ? `- Numero : ${section.number}` : null,
    `- Titre : ${section.title}`,
    section.kind !== 'standard' ? `- Type : ${section.kind}` : null,
    section.service_level ? `- Niveau de service : ${section.service_level}` : null,
    section.bacs_articles ? `- Decret BACS : ${section.bacs_articles}` : null,
    parent?.title ? `- Section parente : ${parent.number || ''} ${parent.title}` : null,
    ``,
    pointsBlock,
    instancesBlock,
    bacsBlock,
    section.body_html ? `\n\nBrouillon actuel a remplacer/ameliorer :\n${stripHtml(section.body_html).slice(0, 800)}` : '',
    ``,
    instruction
      ? `Demande specifique : ${instruction}`
      : `Redige le corps de cette section dans le style Buildy. Renvoie uniquement le HTML, sans balise <html>, sans wrapper, sans markdown.`,
  ].filter(Boolean).join('\n');

  return { system, user };
}

/**
 * Stream depuis Claude. Appelle onText(chunk) pour chaque token de texte recu.
 */
async function streamSection(sectionId, { instruction, onText, onError, onDone }) {
  const { system, user } = buildPrompts(sectionId, { instruction });
  let stream;
  try {
    stream = await client().messages.stream({
      model: config.claudeModel,
      max_tokens: 2048,
      // Prompt caching sur le SYSTEM (invariant entre appels d'une meme AF/journee)
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) {
    onError(e);
    return;
  }
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        onText(event.delta.text);
      }
    }
    const finalMsg = await stream.finalMessage();
    onDone({
      stop_reason: finalMsg.stop_reason,
      usage: finalMsg.usage,
    });
  } catch (e) {
    onError(e);
  }
}

module.exports = { streamSection, buildPrompts };
