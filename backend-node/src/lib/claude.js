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
    `Tu es l'assistant de redaction Buildy Docs, specialise dans la redaction d'analyses fonctionnelles GTB (Gestion Technique du Batiment).`,
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

// ── Assistant redaction bibliotheque (generate / reformulate) ───────────

const AVAIL_LABEL = {
  included:    'Inclus',
  paid_option: 'Option payante',
};

// System prompt v2 — reflete le modele a jour (sections narratives sans
// BACS, equipements avec BACS herite de la categorie, fonctionnalites
// avec matrice de disponibilite E/S/P inclus|paid_option|non_disponible).
const SYSTEM_PROMPT_LIBRARY = [
  `Tu es l'assistant de redaction Buildy Docs, specialise dans les analyses fonctionnelles GTB (Gestion Technique du Batiment).`,
  ``,
  `=== CONTEXTE BUILDY ===`,
  `Buildy est une plateforme de supervision et d'hypervision multi-sites, agnostique des marques d'automates et de capteurs. Buildy ne remplace pas les systemes terrain (CTA, regulateurs, GTC) : il les supervise et les expose dans une UI unifiee.`,
  `Trois niveaux d'offre commerciale : Essentials (E), Smart (S), Premium (P).`,
  `L'AF (Analyse Fonctionnelle) est un livrable DOE remis aux integrateurs GTB et clients.`,
  ``,
  `=== MODELE DE DONNEES BIBLIOTHEQUE ===`,
  `1) Sections types narratives : chapitres redacteurs du document (titre + texte). Pas de BACS, pas de niveau de contrat. Servent a structurer le document : preambule, perimetre, glossaire, etc.`,
  `2) Modeles d'equipement : CTA, chaudiere, eclairage, comptage, etc. Possedent une description fonctionnelle + une justification BACS contextualisee. Les articles BACS sont edites au niveau de la CATEGORIE (Ventilation, Chauffage...) et herites par tous les equipements de la categorie.`,
  `3) Fonctionnalites : features du systeme Buildy Docs. Possedent :`,
  `   - des articles BACS applicables (R175-1 a R175-6)`,
  `   - une matrice de disponibilite par niveau de contrat :`,
  `     • Essentials / Smart / Premium chacun -> Inclus | Option payante | Non disponible`,
  `   Les options payantes sont des features facturees en sus du contrat (revenu additionnel).`,
  ``,
  `=== STYLE OBLIGATOIRE ===`,
  `- Francais professionnel, technique, precis. Tous les accents corrects (e aigu, e grave, c cedille, a circonflexe, etc.).`,
  `- Phrases concises et structurees. Pas de superlatifs marketing ("revolutionnaire", "incroyable"). Pas de generalites molles.`,
  `- Vocabulaire metier GTB et IoT : supervision, anomalie, derive, trame, point, MQTT, Modbus TCP, BACnet, KNX, M-Bus, R175-1, niveau de service, regulation, consigne, alarme, courbe de chauffe, etc.`,
  `- Pas d'invention : si une info manque, ne la fabrique pas.`,
  `- Buildy supervise, ne pilote pas. Ne pas decrire un automate terrain ou un integrateur GTB comme si c'etait Buildy.`,
  `- Pas de description de zones/locaux (parties communes, etage 2...) : la bibliotheque est agnostique des sites.`,
  ``,
  `=== FORMAT DE SORTIE OBLIGATOIRE ===`,
  `- HTML compatible Tiptap : <p>, <ul>, <ol>, <li>, <strong>, <em>, <h3>, <blockquote>.`,
  `- Aucune classe CSS, aucun <div>, aucun <html>/<body>, aucun markdown (pas de **gras**, pas de # titres).`,
  `- Reponds UNIQUEMENT par le HTML demande. Pas de preambule "Voici...", pas de conclusion, pas d'explication.`,
].join('\n');

// Construit la partie USER du prompt selon le type d'entite et le mode
function buildLibraryUserPrompt({ mode, kind, title, html, parent_path, category_label, bacs_articles, avail_e, avail_s, avail_p }) {
  const lines = [];
  // Bloc d'identification de l'entite
  lines.push(`=== ENTITE A REDIGER ===`);
  if (kind === 'narrative_section')          lines.push(`Type : section type narrative (chapitre du document)`);
  else if (kind === 'functionality')         lines.push(`Type : fonctionnalite Buildy`);
  else if (kind === 'equipment_description') lines.push(`Type : modele d'equipement — description fonctionnelle`);
  else if (kind === 'equipment_bacs_justification') lines.push(`Type : modele d'equipement — justification BACS contextualisee`);

  if (title)         lines.push(`Titre : ${title}`);
  if (parent_path)   lines.push(`Section parente : ${parent_path}`);
  if (category_label) lines.push(`Categorie : ${category_label}`);
  if (bacs_articles)  lines.push(`Articles BACS applicables : ${bacs_articles}`);

  // Matrice de disponibilite (fonctionnalites uniquement)
  if (kind === 'functionality') {
    const fmt = (v) => v ? AVAIL_LABEL[v] || v : 'Non disponible';
    lines.push(`Disponibilite par niveau de contrat :`);
    lines.push(`  - Essentials : ${fmt(avail_e)}`);
    lines.push(`  - Smart      : ${fmt(avail_s)}`);
    lines.push(`  - Premium    : ${fmt(avail_p)}`);
  }
  lines.push('');

  // Texte source (mode reformulate) ou rien (mode generate)
  if (mode === 'reformulate' && html?.trim()) {
    lines.push(`=== TEXTE ACTUEL A REFORMULER ===`);
    lines.push(html.trim());
    lines.push('');
    lines.push(`Reformule ce texte en respectant le sens et en ameliorant clarte, concision, vocabulaire GTB. Garde la structure (paragraphes / listes) si elle est pertinente.`);
  } else {
    lines.push(`=== INSTRUCTION ===`);
    if (kind === 'narrative_section') {
      lines.push(`Redige le contenu de cette section narrative en 2 a 4 paragraphes courts. Style sobre, technique, precis. Pas de redondance avec le titre.`);
    } else if (kind === 'functionality') {
      lines.push(`Decris cette fonctionnalite Buildy : ce qu'elle apporte fonctionnellement au client, pourquoi (lien BACS si applicable), comment elle se distingue selon le niveau de contrat. 2 a 4 paragraphes courts.`);
    } else if (kind === 'equipment_description') {
      lines.push(`Decris ce modele d'equipement de maniere agnostique (sans marque ni modele particulier) : son role dans le batiment, ce que la solution Buildy apporte en supervision en aval. 2 a 3 paragraphes courts. Pas de zones/locaux.`);
    } else if (kind === 'equipment_bacs_justification') {
      lines.push(`Redige une justification courte (1 a 2 paragraphes) qui explique pourquoi cet equipement est concerne par le decret BACS, en citant les articles applicables. Style juridique-technique sobre.`);
    } else {
      lines.push(`Redige le contenu HTML demande dans le style Buildy.`);
    }
  }

  return lines.join('\n');
}

/**
 * Assistant unique de la bibliotheque (mode generate ou reformulate).
 * Retourne le HTML produit + usage de tokens.
 */
async function assistLibrary({ mode, kind, title, html, parent_path, category_label, bacs_articles, avail_e, avail_s, avail_p } = {}) {
  if (mode === 'reformulate' && (!html || !html.trim())) {
    throw new Error('Texte a reformuler vide');
  }
  const userPrompt = buildLibraryUserPrompt({ mode, kind, title, html, parent_path, category_label, bacs_articles, avail_e, avail_s, avail_p });

  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 2048,
    // Cache_control sur le SYSTEM (invariant entre tous les appels biblio
    // -> economies de tokens et latence reduite sur les appels successifs).
    system: [{ type: 'text', text: SYSTEM_PROMPT_LIBRARY, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  return { html: text, usage: resp.usage };
}

module.exports = { streamSection, buildPrompts, assistLibrary };
