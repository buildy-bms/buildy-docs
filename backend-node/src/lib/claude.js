'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const db = require('../database');
const { resolveSectionPoints } = require('./points-resolver');
const { BACS_INTRO_HTML, BACS_ARTICLES } = require('../seeds/bacs-articles');
const { buildLibraryContext } = require('./library-context');
const { scoreArticle } = require('./seo-scorer');

let _client = null;
function client() {
  if (!_client) {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY non configure');
    _client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return _client;
}

const { stripHtml } = require('./text-utils');

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
  `=== NOMENCLATURE PRODUIT BUILDY (a respecter strictement) ===`,
  `Noms PUBLICS (autorises dans le contenu redige) :`,
  `- "Buildy" : la plateforme dans son ensemble + la societe et ses services. A utiliser comme sujet generique des enonces transverses ("Buildy supervise...", "la solution Buildy...", "les equipes Buildy...").`,
  `- "Hyperveez" : l'application web de supervision (interface principale desktop/tablette). A utiliser quand on parle de l'UI web ("depuis Hyperveez", "console Hyperveez").`,
  `- "Gojee" : l'application mobile iOS/Android. A utiliser quand on parle du mobile.`,
  `- "Buildy Edge" : la passerelle materielle deployee sur site.`,
  `- "Buildy Cloud" : le backend cloud heberge.`,
  `- "Buildy Connect" : l'API REST pour systemes tiers.`,
  ``,
  `Noms INTERNES (=== INTERDITS DANS LE CONTENU REDIGE ===) — usage strictement interne a l'equipe Buildy, jamais visibles par l'exploitant ou le constructeur :`,
  `- "Fleet Manager" / "edge-fleet-manager"   ← console interne d'admin du parc, NE JAMAIS citer.`,
  `- "Buildy Tools" / "buildy-tools"           ← outil embarque sur la passerelle, NE JAMAIS citer.`,
  `- "Buildy Docs" / "buildy-docs"             ← l'outil de redaction lui-meme (meta), NE JAMAIS citer dans le contenu produit.`,
  `Si tu dois evoquer une fonctionnalite couverte par ces composants internes, formule SANS les nommer :`,
  `  Mauvais : "La console Fleet Manager dans Hyperveez offre une vue d'ensemble du parc..."`,
  `  Bon     : "Buildy offre une vue d'ensemble du parc dans Hyperveez : etat de connectivite de chaque site, passerelles, routeurs et SIM cards."`,
  `  Mauvais : "synchronisation bidirectionnelle entre Fleet Manager et Buildy Docs"`,
  `  Bon     : (ne pas l'evoquer du tout — c'est un detail technique interne sans valeur pour l'exploitant)`,
  ``,
  `REGLE : ne pas ecrire "interface Buildy" pour designer l'UI desktop — utiliser "Hyperveez". Ne pas dire "depuis l'app Buildy" pour le mobile — utiliser "Gojee".`,
  ``,
  `=== CONTEXTE BUILDY ===`,
  `Buildy est une plateforme de supervision et d'hypervision multi-sites, agnostique des marques d'automates et de capteurs. Buildy ne remplace pas les systemes terrain (CTA, regulateurs, GTC) : il les supervise et les expose dans une UI unifiee.`,
  `Trois niveaux d'offre commerciale : Essentials (E), Smart (S), Premium (P).`,
  `L'AF (Analyse Fonctionnelle) est un livrable DOE remis aux integrateurs GTB et clients.`,
  ``,
  `=== REFERENTIEL R175 (notation obligatoire) ===`,
  `- R175-1 : definitions des systemes techniques. Sous-points :`,
  `    1° chauffage  •  2° climatisation  •  3° ventilation  •  4° eclairage integre + production d'electricite sur site.`,
  `- R175-3 : exigences fonctionnelles BACS. Sous-points :`,
  `    1° suivi en pas horaire (visualisation) + conservation 5 ans (les agregats mensuels stockes durablement sont consideres acceptables des lors que la visualisation horaire est disponible pendant la periode active).`,
  `    2° detection des pertes d'efficacite (derives) avec mecanismes de seuils et d'alerte.`,
  `    3° interoperabilite (BACnet/Modbus/KNX/M-Bus/MQTT).`,
  `    4° arret manuel + gestion autonome (programmations, scenarios, modes vacances). PAS "reporting" : le reporting n'est pas une exigence R175-3.`,
  `- R175-4 : verifications periodiques avec consignes ecrites. C'est un ARTICLE reglementaire, JAMAIS une "norme".`,
  `- R175-5 : formation des exploitants.`,
  `- R175-5-1 : inspection periodique du systeme par un tiers.`,
  `- R175-6 : regulation thermique automatique par piece ou zone.`,
  ``,
  `NOTATION FIXE :`,
  `- Sous-points : ecrire "R175-1 1°" et JAMAIS "R175-1 §1". Le caractere § est PROSCRIT pour designer un sous-point d'article. Utiliser 1°, 2°, 3°, 4°.`,
  `- Forme courte acceptable : "article R175-3" sans sous-point precise. Forme longue : "article R175-3 1°".`,
  ``,
  `REVENDICATIONS DE CONFORMITE — prudence :`,
  `- Privilegier "contribue a l'exigence R175-3 N°" plutot que "conforme a R175-3 N°" sauf si toutes les conditions sont reunies.`,
  `- Pour R175-3 1° : un stockage en agregats mensuels est defendable si la visualisation horaire est offerte pendant la periode active (derniers 12 mois par exemple). Formuler avec nuance.`,
  `- Ne JAMAIS confondre R175-3 4° avec "reporting" : R175-3 4° = arret manuel et gestion autonome.`,
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
  `=== ELEMENTS A NE PAS RE-DETAILLER (renvois obligatoires) ===`,
  `Certaines informations sont deja etablies dans des sections de reference. Ne pas les redeployer ailleurs ; renvoyer.`,
  `- La liste des protocoles supportes (BACnet, Modbus TCP, MQTT, KNX, M-Bus) est introduite UNE SEULE FOIS dans la section "Role de Buildy dans l'ecosysteme GTB". Ailleurs, ecrire : "via les protocoles standards supportes par Buildy (voir « Role de Buildy dans l'ecosysteme GTB »)".`,
  `- Le principe "Buildy supervise sans interferer avec la regulation terrain" est etabli dans la meme section. Ne pas le redevelopper a chaque section de perimetre — un simple renvoi suffit.`,
  `- Les destinataires du document, la conservation 10 ans, les conditions de mise a jour : etablies dans le "Preambule". Ailleurs, renvoyer.`,
  `- Les 3 fonctions de l'AF (reference fonctionnelle / contractuelle des tiers / piece reglementaire) : etablies dans "Objet du document". Ailleurs, renvoyer.`,
  ``,
  `=== STYLE OBLIGATOIRE ===`,
  `- Francais professionnel, technique, precis. Tous les accents corrects (e aigu, e grave, c cedille, a circonflexe, etc.).`,
  `- Phrases concises et structurees. Pas de superlatifs marketing ("revolutionnaire", "incroyable"). Pas de generalites molles.`,
  `- Vocabulaire metier GTB et IoT : supervision, anomalie, derive, trame, point, MQTT, Modbus TCP, BACnet, KNX, M-Bus, R175-1, niveau de service, regulation, consigne, alarme, courbe de chauffe, etc.`,
  `- Pas d'invention : si une info manque, ne la fabrique pas.`,
  `- Buildy supervise, ne pilote pas. Ne pas decrire un automate terrain ou un integrateur GTB comme si c'etait Buildy.`,
  `- Pas de description de zones/locaux (parties communes, etage 2...) : la bibliotheque est agnostique des sites.`,
  `- Espaces insecables a respecter dans les guillemets francais : « contenu » avec espaces fines avant »» et apres ««.`,
  ``,
  `=== FORMAT NIVEAUX DE SERVICE (canonique, normalise) ===`,
  `Quand une fonctionnalite a une matrice de disponibilite, terminer la fiche par UNE SEULE phrase canonique, parmi :`,
  `- "Disponible aux niveaux Smart et Premium ; Essentials : option payante."`,
  `- "Disponible uniquement au niveau Premium."`,
  `- "Disponible a tous les niveaux (Essentials, Smart, Premium)."`,
  `- "Option payante a tous les niveaux."`,
  `Adapter aux valeurs reelles de la matrice. Banni : phrases verbeuses du type "Cette fonctionnalite est incluse dans Smart et Premium. Elle n'est pas disponible dans Essentials.".`,
  ``,
  `=== FORMAT DE SORTIE OBLIGATOIRE ===`,
  `- HTML compatible Tiptap : <p>, <ul>, <ol>, <li>, <strong>, <em>, <h3>, <blockquote>.`,
  `- Aucune classe CSS, aucun <div>, aucun <html>/<body>, aucun markdown (pas de **gras**, pas de # titres).`,
  `- Reponds UNIQUEMENT par le HTML demande. Pas de preambule "Voici...", pas de conclusion, pas d'explication.`,
  ``,
  `=== SUGGESTION DE TITRE (OBLIGATOIRE en tete de reponse) ===`,
  `Tu DOIS commencer ta reponse par la ligne EXACTE \`<!--TITLE: titre-->\` puis enchainer sur le HTML.`,
  `CIBLE DU TITRE : EXPLOITANTS DE BATIMENT (gestionnaires de patrimoine, facility managers) et CONSTRUCTEURS DE BATIMENT (MOA, MOE, AMO, BE thermique). PAS des integrateurs GTB ni des developpeurs.`,
  `Ils comprennent le langage du batiment et de l'exploitation, mais PAS le jargon IT / GTB-technique pur.`,
  `Style : forme nominale francaise, claire, accessible, axee EXPLOITATION et VALEUR pour le batiment.`,
  ``,
  `Reformule les jargons techniques internes en concepts d'exploitation :`,
  `  Trop technique → Niveau exploitant/constructeur :`,
  `  • "Acquisition temps reel des points terrain"  → "Suivi en temps reel des equipements techniques"`,
  `  • "Detection des derives"                       → "Detection des derives de consommation"`,
  `  • "Notifications par email"                     → "Alertes par email"`,
  `  • "Acces simplifie par QR Codes"                → "Acces rapide aux equipements par QR Code"`,
  `  • "API Buildy Connect"                          → "Ouverture vers vos logiciels metiers"`,
  `  • "Mises a jour automatiques des apps"          → "Mises a jour automatiques de la passerelle"`,
  `  • "Cartographie multi-sites"                     → "Cartographie de votre parc de batiments"`,
  ``,
  `Vocabulaire OK : exploitation, batiment, equipement technique, consommation, alarme, releve, suivi, parc, patrimoine, site, energie, conformite, decret BACS, maintenance.`,
  `Vocabulaire a TRADUIRE (trop IT/GTB) : point, point terrain, polling, trame, broker MQTT, daemon, serveur, instance, provisionning, bus, automate.`,
  `INTERDIT (sloganesque, marketing creux) :`,
  `  • "Terrain toujours visible, en temps reel"   ← ton publicitaire`,
  `  • "Restez informe en temps reel"              ← injonction client, pas un titre de doc`,
  `  • "Surveillance proactive des consommations"  ← "proactive" = jargon marketing`,
  `  • "Toujours a jour, sans intervention"        ← punchline`,
  ``,
  `Garde-fous :`,
  `- Forme nominale (groupe nominal), 3 a 8 mots, sans virgule, sans guillemets francais.`,
  `- Pas d'injonction au lecteur ("Restez...", "Pilotez...", "Gardez la main...").`,
  `- Pas de superlatifs ni de jargon marketing : "proactive", "intelligente", "puissante", "instantane", "revolutionnaire" -> a EVITER.`,
  `- Pas de jargon IT pur : voir liste ci-dessus.`,
  `- Si le titre courant est deja accessible, descriptif et de niveau exploitant, RECOPIE-LE tel quel.`,
  `- Si le titre courant est trop technique/IT, traduis-le en langage exploitation.`,
  `- Le marker doit TOUJOURS etre present, meme si tu recopies le titre actuel.`,
  `Exemple : \`<!--TITLE: Suivi en temps reel des equipements techniques-->\` puis HTML.`,
  ``,
  `=== RYTHME VISUEL — IMPORTANT ===`,
  `Le contenu doit etre AERE et lisible, pas un pave dense.`,
  `- Plusieurs <p> COURTS valent mieux qu'un long paragraphe.`,
  `- Vise 1 a 3 phrases maximum par <p>. Si un paragraphe depasse 3 phrases, decoupe-le.`,
  `- Une nouvelle idee = un nouveau <p>. Une enumeration de 3 elements ou plus = <ul>.`,
  `- Met en valeur les concepts cles avec <strong> (1 a 3 occurrences par fiche, pas plus, pas en debut systematique).`,
  `- Banni : "blocs" denses de 4+ phrases qui dilluent l'information et fatiguent l'oeil.`,
].join('\n');

// Construit la partie USER du prompt selon le type d'entite et le mode
function buildLibraryUserPrompt({ mode, kind, title, html, parent_path, category_label, bacs_articles, avail_e, avail_s, avail_p, has_corpus }) {
  const lines = [];
  // Bloc d'identification de l'entite
  lines.push(`=== ENTITE A REDIGER ===`);
  if (kind === 'narrative_section')          lines.push(`Type : section type narrative (chapitre du document)`);
  else if (kind === 'functionality')         lines.push(`Type : fonctionnalite Buildy`);
  else if (kind === 'equipment_description') lines.push(`Type : modele d'equipement — description fonctionnelle`);
  else if (kind === 'equipment_bacs_justification') lines.push(`Type : modele d'equipement — justification BACS contextualisee`);
  else if (kind === 'bacs_audit_notes')      lines.push(`Type : note d'audit BACS — observation terrain sur un element saisi`);

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

  // Mode title : on ne genere ni ne reformule le contenu, juste un titre.
  if (mode === 'title') {
    if (html?.trim()) {
      lines.push(`=== CONTENU ACTUEL (pour t'aider a proposer un titre adapte) ===`);
      lines.push(html.trim());
      lines.push('');
    }
    lines.push(`=== INSTRUCTION ===`);
    lines.push(`Propose un meilleur titre pour cette entite. Tiens compte du contenu fourni s'il y en a.`);
    lines.push(`CIBLE : EXPLOITANTS DE BATIMENT (FM, gestionnaires patrimoine) et CONSTRUCTEURS (MOA, MOE, BE). PAS des integrateurs GTB ni des dev.`);
    lines.push(`Style : forme nominale francaise (3 a 8 mots), claire, accessible, axee EXPLOITATION/VALEUR batiment. Sans virgule, sans guillemets francais.`);
    lines.push(`Traduis le jargon technique en langage exploitation :`);
    lines.push(`  • "Acquisition temps reel des points terrain" → "Suivi en temps reel des equipements techniques"`);
    lines.push(`  • "Detection des derives"                       → "Detection des derives de consommation"`);
    lines.push(`  • "Notifications par email"                     → "Alertes par email"`);
    lines.push(`  • "API Buildy Connect"                          → "Ouverture vers vos logiciels metiers"`);
    lines.push(`Vocabulaire OK : exploitation, batiment, equipement technique, consommation, alarme, suivi, parc, patrimoine, energie, conformite, decret BACS.`);
    lines.push(`A TRADUIRE (trop IT/GTB) : point, point terrain, polling, trame, broker, daemon, instance, automate.`);
    lines.push(`INTERDIT (sloganesque) : "Terrain toujours visible…", "Restez informe…", "Surveillance proactive…", "Toujours a jour, sans intervention".`);
    lines.push(`Pas de jargon marketing ("proactive", "intelligente", "puissante", "instantane"). Pas d'injonction au lecteur ("Restez...", "Pilotez...").`);
    lines.push(`Si le titre actuel est deja accessible et clair pour un exploitant, RECOPIE-LE tel quel.`);
    lines.push(`REPONDS UNIQUEMENT PAR LA LIGNE \`<!--TITLE: titre propose-->\` ET RIEN D'AUTRE.`);
    lines.push(`Aucun HTML, aucun preambule, aucune explication. Juste le marker.`);
    return lines.join('\n');
  }

  // Texte source (mode reformulate) ou rien (mode generate)
  const isReformulate = mode === 'reformulate' && html?.trim();
  if (isReformulate) {
    lines.push(`=== TEXTE ACTUEL A REFORMULER ===`);
    lines.push(html.trim());
    lines.push('');
    lines.push(`Reformule ce texte en respectant le sens UTILE et en ameliorant clarte, concision, vocabulaire GTB. Garde la structure (paragraphes / listes) si elle est pertinente. RESPECTE le format aere : ne fusionne PAS les phrases en gros blocs denses.`);
    lines.push(`IMPORTANT : si le texte source contient des passages qui violent les regles "INTERDIT" ci-dessous (specifiques au type d'entite), tu DOIS LES SUPPRIMER, pas les conserver ni les reformuler. Le contenu interdit n'a rien a faire dans cette entree, peu importe qu'il existe deja.`);
    lines.push('');
  }

  lines.push(`=== INSTRUCTION ${isReformulate ? '(regles de fond a appliquer pendant la reformulation)' : ''} ===`);
  if (kind === 'narrative_section') {
    lines.push(`Redige le contenu de cette section narrative en 3 a 5 paragraphes COURTS (1 a 3 phrases par paragraphe). Style sobre, technique, precis. Pas de redondance avec le titre.`);
  } else if (kind === 'functionality') {
    lines.push(`Decris cette fonctionnalite Buildy : ce qu'elle apporte fonctionnellement au client, pourquoi (lien BACS si applicable), comment elle se distingue selon le niveau de contrat. 3 a 5 paragraphes COURTS (1 a 3 phrases par paragraphe).`);
  } else if (kind === 'equipment_description') {
    lines.push(`Decris ce modele d'equipement de maniere agnostique (sans marque ni modele particulier). 3 a 4 paragraphes COURTS (1 a 3 phrases par paragraphe). Pas de zones/locaux.`);
    lines.push(``);
    lines.push(`CONTENU OBLIGATOIRE — dans cet ordre :`);
    lines.push(`1) Fonctionnement de l'equipement : principe physique/technique, comment il marche concretement.`);
    lines.push(`2) Utilite : a quoi il sert dans le batiment, quel service il rend (conditionnement thermique d'un local, distribution d'eau, ventilation hygienique, eclairage de tel usage, etc.). Quand c'est pertinent, mentionner les modes d'usage typiques.`);
    lines.push(`3) Role de la supervision Buildy POUR CE TYPE D'EQUIPEMENT : quelle valeur d'exploitation elle apporte (suivi etat de marche, suivi consommation/energie, detection de derives, remontee de defauts, planning d'usage, comparaison inter-equipements...). Rester au niveau fonctionnel, PAS technique-points.`);
    lines.push(`4) Insister : la regulation (asservissement, boucle PID, sequence de demarrage, securites...) est assuree par l'equipement lui-meme ou son automate/regulateur natif. Buildy NE REGULE PAS, il supervise sans interferer. Faire un renvoi : "voir « Role de Buildy dans l'ecosysteme GTB »".`);
    lines.push(``);
    lines.push(`INTERDIT ABSOLU — ces contenus n'ont AUCUNE place dans une description d'equipement et doivent etre SUPPRIMES :`);
    lines.push(`- SUPPRIMER toute liste, enumeration ou mention de "points typiquement collectes / lus / ecrits / remontes" (exemples a NE PAS reproduire : "etat de marche/arret", "consigne de temperature active", "defauts equipement", "vitesse ventilateur", "temperature de soufflage", "puissance instantanee", etc.). Les points de l'equipement sont definis dans une table dediee — la description fonctionnelle n'a pas a les enumerer, meme partiellement, meme en exemple.`);
    lines.push(`- SUPPRIMER tout paragraphe ou phrase parlant d'"ecriture", "commande marche/arret transmise", "consigne transmise", "Buildy peut envoyer / piloter / commander". La capacite d'ecriture de Buildy n'est PAS le sujet d'une description fonctionnelle d'equipement.`);
    lines.push(`- SUPPRIMER toute recitation de protocoles (BACnet, Modbus, KNX, M-Bus, MQTT) : faire un renvoi a "Role de Buildy dans l'ecosysteme GTB".`);
    lines.push(`- SUPPRIMER tout ton commercial, superlatif, formule marketing.`);
    lines.push(``);
    lines.push(`Verification finale avant de rendre ta reponse : relis ton texte. Si une seule phrase mentionne un point lu/ecrit, un nom de protocole, ou la commande/ecriture Buildy, SUPPRIME-LA et compense au besoin par un developpement des 4 contenus obligatoires.`);
  } else if (kind === 'equipment_bacs_justification') {
    lines.push(`Redige une justification courte qui explique pourquoi cet equipement est concerne par le decret BACS, en citant les articles applicables avec la notation N° (jamais §). 2 a 3 paragraphes COURTS (1 a 3 phrases par paragraphe). Style juridique-technique sobre.`);
  } else if (kind === 'bacs_audit_notes') {
    lines.push(`Reformule ces notes d'audit terrain en un paragraphe ou une courte liste, francais professionnel, technique, precis. Conserve toutes les informations factuelles (marque, reference, etat, defaut constate, position GTB...), ameliore la clarte et le vocabulaire GTB. Ne pas inventer d'information manquante. Format HTML compatible Tiptap.`);
  } else {
    lines.push(`Redige le contenu HTML demande dans le style Buildy.`);
  }

  if (has_corpus) {
    lines.push('');
    lines.push(`=== CORPUS BIBLIOTHEQUE — METHODE OBLIGATOIRE ===`);
    lines.push(`Le corpus existant t'est fourni dans le system prompt (titres + contenus rediges).`);
    lines.push(``);
    lines.push(`ETAPE 1 — ANALYSE PREALABLE (silencieuse, ne l'ecris pas) :`);
    lines.push(`Avant de rediger une seule ligne, parcours le corpus et identifie :`);
    lines.push(`  a) Les entrees dont le titre OU le contenu recoupent ton sujet.`);
    lines.push(`  b) Pour chacune, liste mentalement les informations qu'elle couvre deja.`);
    lines.push(`  c) Determine ce qui RESTE a dire ici, qui n'est nulle part ailleurs.`);
    lines.push(``);
    lines.push(`ETAPE 2 — REDACTION (regles strictes) :`);
    lines.push(`- N'ecris QUE ce qui est specifique a cette entree et absent du corpus.`);
    lines.push(`- INTERDIT de re-enumerer, re-expliquer, re-resumer ce qui est deja decrit ailleurs (meme reformule).`);
    lines.push(`  Exemple concret : si "Objet du document" liste deja les 3 fonctions de l'AF (reference fonctionnelle / contractuelle / reglementaire), "Preambule" NE LES RELISTE PAS — meme dans une formulation differente.`);
    lines.push(`- Si tu dois evoquer un sujet couvert ailleurs, fais-le UNIQUEMENT par renvoi explicite : "voir la section « Titre exact »".`);
    lines.push(`- Verifie l'orthographe du titre dans le corpus avant de citer.`);
    lines.push(``);
    lines.push(`ETAPE 3 — TEST DE NON-REDONDANCE (avant de rendre ta reponse) :`);
    lines.push(`Relis ton brouillon. Pour chaque phrase, demande-toi : "Cette information est-elle deja dans une autre entree du corpus ?" Si OUI → supprime-la ou remplace-la par un renvoi.`);
    lines.push(``);
    lines.push(`Si apres analyse il ne reste presque rien a dire de specifique, RENVOIE un texte court (1-2 phrases) plutot que d'inventer du contenu redondant.`);
  }

  return lines.join('\n');
}

/**
 * Cle logique du prompt pour la bibliotheque editable depuis l'UI.
 * Si une ligne ai_prompts existe avec cette cle, son body remplace
 * SYSTEM_PROMPT_LIBRARY ; sinon on retombe sur la constante en dur.
 */
const PROMPT_KEY_LIBRARY = 'library';
function getActivePromptLibrary() {
  try {
    const row = db.aiPrompts && db.aiPrompts.get(PROMPT_KEY_LIBRARY);
    if (row && row.body && row.body.trim()) return row.body;
  } catch { /* fallback silencieux */ }
  return SYSTEM_PROMPT_LIBRARY;
}

/**
 * Assistant unique de la bibliotheque (mode generate ou reformulate).
 * Retourne le HTML produit + usage de tokens.
 *
 * Si `library_context.enabled` est vrai, un second bloc system est ajoute
 * avec le corpus existant (selon la strategie choisie). Ce bloc est aussi
 * cache pour beneficier des hits sur appels successifs.
 */
async function assistLibrary({
  mode, kind, title, html, parent_path, category_label, bacs_articles,
  avail_e, avail_s, avail_p,
  current_template_id, parent_template_id, category,
  library_context,
} = {}) {
  if (mode === 'reformulate' && (!html || !html.trim())) {
    throw new Error('Texte a reformuler vide');
  }

  // Construction optionnelle du bloc corpus
  let corpus = null;
  if (library_context && library_context.enabled) {
    corpus = buildLibraryContext({
      kind,
      currentTemplateId: current_template_id || null,
      parentTemplateId: parent_template_id || null,
      category: category || null,
      strategy: library_context.strategy || 'neighbors',
    });
  }

  const userPrompt = buildLibraryUserPrompt({
    mode, kind, title, html, parent_path, category_label, bacs_articles,
    avail_e, avail_s, avail_p,
    has_corpus: !!corpus,
  });

  // Cache_control sur chaque bloc system : le 1er ne change qu'a chaque
  // edition du prompt depuis l'UI (rare), le 2nd ne change qu'avec une
  // edition de la bibliotheque (rare entre 2 appels).
  const systemBlocks = [
    { type: 'text', text: getActivePromptLibrary(), cache_control: { type: 'ephemeral' } },
  ];
  if (corpus) {
    systemBlocks.push({
      type: 'text',
      text: `=== CORPUS BIBLIOTHEQUE EXISTANT (${corpus.strategy}) ===\n${corpus.text}`,
      cache_control: { type: 'ephemeral' },
    });
  }

  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 2048,
    system: systemBlocks,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  // Extraction d'une suggestion de titre. Le marker `<!--TITLE: ...-->`
  // est en principe en tete (mode=title) ou avant le HTML (autres modes),
  // mais on cherche sur l'ensemble de la reponse pour etre robuste a une
  // variante de Claude (saut de ligne, espace, position).
  // (variable `html` deja prise par le parametre destructure -> `outHtml`)
  let suggested_title = null;
  let outHtml = text;
  const titleMatch = outHtml.match(/<!--\s*TITLE:\s*(.+?)\s*-->/i);
  if (titleMatch) {
    const proposed = (titleMatch[1] || '').trim();
    if (proposed && proposed.toLowerCase() !== (title || '').toLowerCase()) {
      suggested_title = proposed;
    }
    // Strip le marker du HTML retourne (peu importe ou il etait).
    outHtml = outHtml.replace(titleMatch[0], '').trim();
  }
  // En mode 'title', si on n'a rien trouve mais que la reponse est courte
  // (< 120 chars), on suppose que c'est le titre brut sans marker.
  if (mode === 'title' && !suggested_title) {
    const stripped = text.replace(/<[^>]*>/g, '').trim();
    if (stripped && stripped.length < 120 && stripped.toLowerCase() !== (title || '').toLowerCase()) {
      suggested_title = stripped;
    }
    outHtml = '';
  }
  return {
    html: outHtml,
    suggested_title,
    usage: resp.usage,
    library_context: corpus ? {
      strategy: corpus.strategy,
      char_count: corpus.charCount,
      approx_tokens: corpus.approxTokens,
    } : null,
  };
}

// ─── Synthese d'audit BACS ──────────────────────────────────────────
// Appelee depuis /api/bacs-audit/:id/generate-synthesis. Construit un prompt
// ultra-complet a partir du dump complet de l'audit (site, zones, systemes,
// devices, compteurs, GTB, regulation, plan d'action) et demande a Claude
// de rediger une note de synthese commerciale, bienveillante, qui :
//  - Resume objectivement l'etat de conformite R175 du site
//  - Souligne les points forts deja en place
//  - Liste les actions correctives prioritaires (sans inventer)
//  - Rappelle le role de Buildy en accompagnement
//  - Invite le client a passer a l'action sans pression
const PROMPT_KEY_BACS_SYNTHESIS = 'bacs.synthesis';
const PROMPT_KEY_BACS_TRANSCRIPT = 'bacs.transcript_mapping';
const SYSTEM_PROMPT_SYNTHESIS = [
  `Tu es l'auditeur BACS senior de Buildy qui redige la note de synthese`,
  `transmise au client a la fin d'un audit de conformite au decret R175.`,
  `Cet audit est un constat de conformite, distinct de l'inspection`,
  `periodique R175-5-1 (mission separee).`,
  ``,
  `Style imperatif :`,
  `- Francais professionnel, technique mais accessible (le client n'est pas`,
  `  forcement expert GTB).`,
  `- Bienveillant, proactif, oriente solution. Jamais culpabilisant.`,
  `- Rappelle subtilement le role de Buildy : accompagner le client de`,
  `  l'audit jusqu'a la conformite operationnelle (pas un simple rapport,`,
  `  un partenariat).`,
  `- Termine par un appel a l'action concret : prendre contact pour planifier`,
  `  les prochaines etapes.`,
  ``,
  `Regles strictes :`,
  `- N'INVENTE JAMAIS de donnees absentes (puissance, marque, equipement,`,
  `  compteur, etc.). Si une info manque, ne la mentionne pas plutot que`,
  `  d'extrapoler.`,
  `- Reste fidele au plan d'action genere : ne minimise pas les ecarts`,
  `  bloquants, ne dramatise pas non plus.`,
  `- Cite les articles R175 quand pertinent :`,
  `  · R175-2 applicabilite (et puissance station d'echange si reseau urbain)`,
  `  · R175-3 1° suivi pas horaire + conservation 5 ans`,
  `  · R175-3 2° detection des pertes d'efficacite`,
  `  · R175-3 3° interoperabilite (BACnet/Modbus/KNX/M-Bus/MQTT)`,
  `  · R175-3 4° arret manuel + gestion autonome`,
  `  · R175-3 dernier alinea : mise a disposition des donnees au gestionnaire et aux exploitants`,
  `  · R175-4 verifications periodiques + consignes ecrites`,
  `  · R175-5 formation de l'exploitant`,
  `  · R175-6 regulation thermique automatique par piece ou zone`,
  `- Le TRI et les clauses de dispense (R175-2 et R175-6) ne sont PAS du`,
  `  ressort de Buildy ni du present audit : ne jamais calculer, estimer ou`,
  `  meme evoquer un temps de retour sur investissement. Le TRI sera etabli`,
  `  en aval, par le proprietaire ou son BET, sur la base des devis des`,
  `  integrateurs GTB qui suivront la livraison de cet audit.`,
  `- Si action_items_open contient des alternative_solutions, les presenter`,
  `  comme les preconisations Buildy par action (sans laisser entendre que`,
  `  Buildy est l'unique fournisseur possible).`,
  ``,
  `Format : HTML simple compatible Tiptap (<p>, <ul>, <li>, <strong>,`,
  `<em>, <h3>). 4 a 6 paragraphes courts. Evite les titres de section`,
  `marketing : reste sobre.`,
].join('\n');

// Post-traitement de la sortie Claude :
//  - Strip des fences markdown ```html ... ``` ou ```...```
//  - Si la sortie n'a aucune balise HTML, on enveloppe chaque paragraphe
//    (separe par double saut de ligne) dans <p>...</p>
function normalizeSynthesisHtml(raw) {
  let s = (raw || '').trim();
  // Strip d'un eventuel fence ```html ... ``` ou ``` ... ```
  const fenceMatch = s.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i);
  if (fenceMatch) s = fenceMatch[1].trim();
  // Si ca ressemble deja a du HTML structure (>=2 balises), on garde tel quel
  const hasHtml = /<\/(p|h[1-6]|ul|ol|li|strong|em|br)>/i.test(s);
  if (hasHtml) return s;
  // Sinon, conversion paragraphes plain text -> <p>...</p> avec preservation
  // simple de **gras** et listes ligne par ligne commencant par - ou *.
  const blocks = s.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    // Liste si toutes les lignes commencent par - ou *
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(l => /^[-*]\s+/.test(l))) {
      const items = lines.map(l => `<li>${l.replace(/^[-*]\s+/, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    // Sinon : paragraphe avec gras inline
    const inline = block
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, ' ');
    return `<p>${inline}</p>`;
  }).join('\n');
}

async function assistAuditSynthesis(auditDump) {
  const systemPrompt = getActivePrompt(PROMPT_KEY_BACS_SYNTHESIS, SYSTEM_PROMPT_SYNTHESIS);
  const userPrompt = [
    `=== AUDIT BACS — DUMP COMPLET ===`,
    JSON.stringify(auditDump, null, 2),
    ``,
    `=== INSTRUCTION ===`,
    `Redige la note de synthese commerciale a partir des donnees ci-dessus. ` +
    `4 a 6 paragraphes courts en HTML Tiptap. Aucun titre marketing. Pas ` +
    `d'invention. Termine sur un appel a l'action concret (prise de contact ` +
    `Buildy pour planifier les actions correctives prioritaires).`,
    ``,
    `IMPORTANT - format de sortie :`,
    `- Reponse directe en HTML (pas de markdown, pas de fences \`\`\`).`,
    `- Chaque paragraphe entoure de <p>...</p>.`,
    `- Mots cles importants en <strong>...</strong>.`,
    `- Si tu listes des points, utilise <ul><li>...</li></ul>.`,
    `- Aucun texte hors balises HTML.`,
  ].join('\n');

  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 3072,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const raw = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text).join('').trim();
  return { html: normalizeSynthesisHtml(raw), usage: resp.usage };
}

// ─── Alternatives a une action corrective (preconisations Buildy) ──
// Pour chaque action du plan de mise en conformite, l'auditeur peut
// generer une liste d'options techniques alternatives a presenter au
// proprietaire (qui choisira ensuite avec son integrateur GTB).
const SYSTEM_PROMPT_ALTERNATIVES = [
  `Tu es l'auditeur BACS senior de Buildy. Pour une action corrective`,
  `donnee, propose 2 a 4 solutions techniques alternatives realistes,`,
  `de natures differentes (ex : different protocole, different niveau`,
  `de profondeur, integration progressive vs remplacement complet,`,
  `solution proprietaire vs solution ouverte, etc.).`,
  ``,
  `Pour chaque option, indique en une phrase :`,
  `- la nature de la solution (1 a 4 mots)`,
  `- ses avantages (cout, delai, simplicite, perennite, etc.)`,
  `- ses limites ou contre-indications`,
  ``,
  `Reste fidele aux articles R175 (cite-les si pertinent). N'invente pas`,
  `de marques ou references precises (reste agnostique). Sortie HTML`,
  `Tiptap : <ul><li><strong>...</strong> : ...</li></ul>.`,
].join('\n');

async function assistActionAlternatives(actionContext) {
  const userPrompt = [
    `=== ACTION CORRECTIVE ===`,
    JSON.stringify(actionContext, null, 2),
    ``,
    `Propose les autres solutions envisageables (R175-5-1 4°).`,
    `Format HTML uniquement, pas de markdown, pas de fences.`,
  ].join('\n');
  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system: SYSTEM_PROMPT_ALTERNATIVES,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const raw = (resp.content || [])
    .filter(b => b.type === 'text').map(b => b.text).join('').trim();
  // Reuse normalizeSynthesisHtml for consistent post-processing
  return { html: normalizeSynthesisHtml(raw), usage: resp.usage };
}

// ─── Pre-remplissage d'un audit a partir d'un transcript Plaud Pro ──
// L'auditeur dicte sur site (numero checklist + observations). De retour au
// bureau, il importe le .txt : Claude lit le transcript + le squelette de
// l'audit (zones + systemes + devices + meters avec leurs "ref" stables) et
// renvoie une liste de suggestions de remplissage (champ par champ).
//
// Le prompt cache la portion stable (system prompt + schema), seul le
// transcript et le squelette varient → cache hit eleve sur les retries.
const SYSTEM_PROMPT_TRANSCRIPT = [
  `Tu es l'assistant de restitution d'un audit BACS Buildy. L'auditeur a`,
  `dicte ses observations sur Plaud Pro pendant la visite. Tu recois :`,
  `1. Le SQUELETTE de l'audit : liste des entites (zones, systemes,`,
  `   equipements, compteurs, regulations thermiques) avec leur id et`,
  `   leur libelle (nom, marque, zone d'appartenance).`,
  `2. Le TRANSCRIPT brut de la dictee.`,
  ``,
  `Ton role : extraire des suggestions de pre-remplissage, une ligne JSON`,
  `par information identifiable. Format de sortie strict :`,
  `\`\`\`json`,
  `{ "suggestions": [`,
  `  { "target_kind": "zone|system|device|meter|thermal",`,
  `    "target_id": <integer id du squelette>,`,
  `    "field_name": "notes | brand | model_reference | power_kw | name | communication | ...",`,
  `    "suggested_value": "valeur en clair (string ou nombre)",`,
  `    "confidence": 0.0 a 1.0,`,
  `    "source_quote": "extrait litteral du transcript qui justifie" }`,
  `]}`,
  `\`\`\``,
  ``,
  `Regles :`,
  `- Ne JAMAIS inventer une donnee qui n'est pas explicite dans le transcript.`,
  `- target_id doit etre un id existant dans le squelette correspondant`,
  `  au target_kind. Si l'entite cible n'est pas claire, omet la suggestion`,
  `  ou met target_id a null + explique dans source_quote.`,
  `- Privilegier confiance < 0.6 plutot qu'une mauvaise affectation.`,
  `- Sortie JSON valide uniquement, pas de texte autour.`,
].join('\n');

async function assistTranscriptMapping({ skeleton, transcript }) {
  const userPrompt = [
    `=== SQUELETTE AUDIT ===`,
    JSON.stringify(skeleton, null, 2),
    ``,
    `=== TRANSCRIPT DICTEE ===`,
    transcript,
    ``,
    `Extrait les suggestions au format JSON specifie.`,
  ].join('\n');
  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    system: [
      // System prompt cacheable (stable entre runs sur le meme audit)
      {
        type: 'text',
        text: getActivePrompt(PROMPT_KEY_BACS_TRANSCRIPT, SYSTEM_PROMPT_TRANSCRIPT),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const raw = (resp.content || [])
    .filter(b => b.type === 'text').map(b => b.text).join('').trim();
  // Tente de parser le JSON, en retirant les fences eventuelles
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(cleaned); }
  catch { /* tolerant : on renvoie [] */ }
  return {
    suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
    usage: resp.usage || {},
  };
}

// ─── FAQ Buildy / Crisp Knowledge Base ─────────────────────────────
// Trois modes d'assistance :
//   1) Réécrire/améliorer un article existant (`assistFaqRewrite`)
//   2) Générer un article complet à partir d'une question (`assistFaqGenerate`)
//   3) Suggérer des articles manquants en s'appuyant sur le corpus (`assistFaqSuggestMissing`)
// Le bloc corpus (sections + équipements + fonctionnalités + titres FAQ
// existants) est mis en cache éphémère car il change rarement.

const PROMPT_KEY_FAQ_REWRITE = 'faq.rewrite';
const PROMPT_KEY_FAQ_GENERATE = 'faq.generate';
const PROMPT_KEY_FAQ_SUGGEST_MISSING = 'faq.suggest_missing';
const PROMPT_KEY_FAQ_FROM_FUNCTIONALITY = 'faq.generate_from_functionality';

const SYSTEM_PROMPT_FAQ_BASE = [
  `Tu rédiges des articles de la FAQ publique Buildy, publiés sur https://help.buildy.fr/ et indexés par Google.`,
  `Mission : produire un titre + une meta-description + un corps qui matchent l'intent de recherche réel des personae cibles et qui maximisent CTR Google + crédibilité experte. PAS de contenu auto-promotionnel, PAS de jargon technique, PAS de procédure step-by-step.`,
  ``,
  `=== AUDIENCE CIBLE — FAQ CRISP = INBOUND SEO ===`,
  `Tu écris EXCLUSIVEMENT pour des décideurs et prescripteurs qui découvrent Buildy via Google :`,
  `- **Asset manager** / **property manager** / **gestionnaire de parc immobilier** / **foncière** : gèrent un patrimoine multi-sites, cherchent à évaluer / comprendre / comparer une solution GTB.`,
  `- **Directions techniques** côté MOA / MOE / BE thermiques / fluides : prescrivent ou cadrent un projet de supervision.`,
  ``,
  `PERSONAE EXCLUES : les exploitants quotidiens qui cherchent une procédure step-by-step dans l'app (« comment cliquer ici, puis là ») relèvent d'un futur user manual / aide in-app — JAMAIS de la FAQ Crisp publique.`,
  ``,
  `=== SERVICE-ANGLE OBLIGATOIRE (vs PROCÉDURAL) ===`,
  `Chaque article FAQ Crisp répond à une question de type **service / bénéfice / pourquoi-c'est-utile**, jamais de type procédure.`,
  `- Bad (procédural, à exclure) : « Comment créer une programmation horaire ? » → captures d'IHM, suite de clics.`,
  `- Good (service, ce qu'on veut) : « Comment optimiser le fonctionnement de ses équipements grâce aux programmations horaires ? » → bénéfice, économies, automatisation.`,
  `- Bad : « Comment acquitter une alarme ? » → step-by-step UI.`,
  `- Good : « Pourquoi acquitter ses alarmes GTB change la traçabilité d'exploitation ? » → traçabilité, conformité, organisation.`,
  ``,
  `Test rapide : si la réponse à ton titre est une suite de captures d'écran, c'est procédural → recule. Si c'est un argumentaire bénéfice / un explainer fonctionnel, c'est service → continue.`,
  ``,
  `=== TON ÉDITORIAL ===`,
  `- Voix experte mais accessible. Comme un consultant qui aurait 10 ans d'XP GTB et qui parle à un asset manager non technique.`,
  `- Phrases COURTES (15-25 mots max), structure logique. Pas de superlatifs marketing (« puissant », « complet », « performant », « solution unique »).`,
  `- Définis CHAQUE acronyme/terme technique la 1re fois : « GTB (Gestion Technique du Bâtiment) », « BACS (Building Automation and Control Systems — le décret tertiaire qui impose la régulation automatique) ».`,
  `- Donne du contexte AVANT l'argument : explique POURQUOI ça compte avant de décrire QUOI.`,
  `- Exemples concrets et vivants : « Par exemple, si la chaudière de votre site Lyon dépasse les 80 °C un dimanche à 3h, vous recevez une alerte avant que l'occupant n'arrive lundi matin. »`,
  `- Pas de jargon IT pur (« polling », « trame », « broker », « endpoint », « instance », « deployment »).`,
  `- Si une notion peut intimider (API, intégration, Modbus) → reformule ou métaphore : « Buildy se connecte à vos logiciels existants comme une rallonge entre deux prises ».`,
  ``,
  `=== STYLE BUILDY ===`,
  `- Français professionnel, clair, accessible. Tous les accents corrects.`,
  `- Phrases COURTES (15-25 mots max), structure logique. Pas de superlatifs marketing.`,
  `- Commence par une réponse concrète (1-2 phrases qui répondent directement à la question), finis par un encouragement ou un renvoi utile (autre article, contact support).`,
  `- Vocabulaire métier compréhensible : supervision, exploitation, équipement technique, alarme, parc, énergie. JAMAIS de jargon IT pur ("polling", "trame", "broker", "daemon", "endpoint", "instance", "deployment") sans le traduire.`,
  ``,
  `=== NOMENCLATURE PRODUIT (publique) ===`,
  `- "Buildy" : la plateforme + la société.`,
  `- "Hyperveez" : application web de supervision (UI desktop / tablette).`,
  `- "Gojee" : application mobile iOS/Android.`,
  `- "Buildy Edge" : la passerelle matérielle déployée sur site.`,
  `- "Buildy Cloud" : le backend cloud hébergé.`,
  `- "Buildy Connect" : l'API REST pour systèmes tiers.`,
  `INTERDIT côté client : "Fleet Manager", "Buildy Tools", "Buildy Docs" (composants internes, jamais nommés dans les articles publiés).`,
  ``,
  `=== STRUCTURE D'UN ARTICLE CRISP ===`,
  `Un article a un TITRE (champ séparé) + un CORPS. Tu produis uniquement le corps.`,
  `Hiérarchie typique d'un article réussi :`,
  `- 1 paragraphe d'introduction qui répond à la question (pas de titre, juste un <p>).`,
  `- Sections principales en <h2> (ex : "Activer la fonctionnalité", "Cas d'usage", "Dépannage").`,
  `- Sous-sections en <h3> si nécessaire (rares — éviter d'aller plus loin que H3).`,
  `- Un paragraphe de clôture (renvoi vers une autre fonctionnalité, contact support, etc.).`,
  `JAMAIS de <h1> dans le corps : le titre H1 est le titre de l'article (champ séparé).`,
  ``,
  `=== FORMAT DE SORTIE OBLIGATOIRE — HTML ===`,
  `Tu réponds en HTML qui sera converti en markdown Crisp côté serveur. Voici le mapping autorisé :`,
  ``,
  `Balises courantes (utilise-les librement) :`,
  `  <h2>Section</h2>            → "## Section" en markdown Crisp`,
  `  <h3>Sous-section</h3>       → "### Sous-section"`,
  `  <p>Paragraphe.</p>           → texte simple`,
  `  <strong>gras</strong>        → **gras**`,
  `  <em>italique</em>            → *italique*`,
  `  <u>souligné</u>              → __souligné__   (Crisp utilise __ pour le soulignement, pas le gras)`,
  `  <mark>surligné</mark>        → ++surligné++   (Crisp uniquement)`,
  `  <s>barré</s>                 → ~~barré~~`,
  `  <code>inline</code>          → \`inline\``,
  `  <pre><code class="language-bash">cmd</code></pre>  → bloc de code avec lang`,
  `  <a href="url">label</a>      → [label](url)`,
  `  <ul><li>item</li></ul>       → liste à puces`,
  `  <ol><li>étape</li></ol>      → liste numérotée`,
  `  <blockquote>citation</blockquote>  → "> citation"`,
  `  <hr>                          → "---" séparateur`,
  ``,
  `Encarts Crisp (à utiliser DÈS QUE PERTINENT, c'est ce qui rend un article aidant) :`,
  `  <blockquote class="callout-tip">Astuce ou bon réflexe.</blockquote>      → encart VERT ("| ..."), pour une astuce, un raccourci, une bonne pratique.`,
  `  <blockquote class="callout-info">Information complémentaire.</blockquote> → encart JAUNE ("|| ..."), pour préciser un détail utile, donner une info contextuelle ou un prérequis.`,
  `  <blockquote class="callout-warning">Attention ou risque.</blockquote>     → encart ORANGE ("||| ..."), pour avertir d'une action irréversible, d'une donnée perdue, d'un cas piège.`,
  ``,
  `RÈGLE D'EMPLOI :`,
  `- Sur un article de procédure, vise 1 à 3 encarts par article (pas plus, sinon ça dilue).`,
  `- Astuce (vert) : "Vous pouvez aussi accéder à cet écran depuis le menu latéral en cliquant sur l'icône engrenage."`,
  `- Information (jaune) : "Cette fonctionnalité nécessite un abonnement Smart ou Premium." | "Les modifications sont prises en compte sous 5 minutes."`,
  `- Avertissement (orange) : "Une fois l'équipement supprimé, son historique de mesures est perdu définitivement." | "Avant de redémarrer la passerelle, prévenez les utilisateurs : les alarmes seront temporairement indisponibles."`,
  `- Ces encarts sont VISIBLES dans l'éditeur Buildy Docs et publiés tels quels sur https://help.buildy.fr/. Le rédacteur peut les modifier ou les retirer après ta réécriture.`,
  ``,
  `Images (avec largeur explicite si pertinent) :`,
  `  <img src="https://www.buildy.fr/docs/crisp-faq/xxx.webp" alt="description" width="800">`,
  `  → ![description](url =800xauto) en markdown Crisp.`,
  `  N'INVENTE JAMAIS d'URL d'image — utilise UNIQUEMENT des URLs réelles que l'utilisateur t'a fournies, OU le mécanisme de placeholder ci-dessous.`,
  ``,
  `=== EMPLACEMENTS D'IMAGES — UTILISE LES PLACEHOLDERS ===`,
  `Une capture d'écran vaut souvent 10 lignes de texte. À chaque endroit où une image AIDERAIT vraiment la compréhension (capture d'un écran à montrer, schéma de raccordement, photo d'un équipement, illustration d'une alarme à l'écran...), tu DOIS insérer un placeholder :`,
  ``,
  `  <img data-placeholder="true" alt="Description précise de l'image attendue. Soit explicite : nom de l'écran, élément à mettre en évidence, action visible.">`,
  ``,
  `Le placeholder s'affiche dans l'éditeur comme une zone grise « image à uploader », et le rédacteur peut cliquer dessus pour téléverser la vraie image. Les placeholders ne sont JAMAIS publiés vers Crisp (notre converter les ignore au push).`,
  ``,
  `Bonne pratique : 1 placeholder par section visuelle critique. Trop d'images dilue la pédagogie. Pas de placeholder pour les sujets purement textuels (ex. tarifs, mentions légales).`,
  ``,
  `Exemples de bons alt :`,
  `  alt="Capture de l'écran « Alertes » d'Hyperveez, avec le bouton « Nouvelle alerte » entouré en haut à droite."`,
  `  alt="Schéma : passerelle Buildy Edge raccordée au routeur 4G d'un côté et à la GTB Schneider de l'autre."`,
  `  alt="Photo : QR code collé sur la porte d'une armoire électrique, scannable depuis l'application Gojee."`,
  ``,
  `Embeds vidéo (rares — uniquement si pertinent) :`,
  `  <a href="https://www.youtube.com/watch?v=ID" data-embed="youtube">titre vidéo</a>`,
  `  data-embed accepte aussi : "vimeo", "dailymotion", "frame".`,
  ``,
  `=== EXCELLENCE DU TITRE ===`,
  `Méthode en 4 temps :`,
  `1. **Intent** : identifie en 1 phrase ce que la persona cherche réellement à comprendre / décider.`,
  `2. **Plausibility test** : la requête Google équivalente, sans aucune marque, doit rester naturelle. Test : retire « Buildy » / « Hyperveez » / « Gojee » de ton titre — la requête restante doit ressembler à une vraie recherche.`,
  `3. **Variation interrogative** : alterne les formules selon l'intent. NE PAS commencer 100% des titres par « Comment ». Distribution attendue sur la flotte :`,
  `   - « Comment ... ? » (~40%) — réponse opérationnelle, "comment ça marche"`,
  `   - « Pourquoi ... ? » (~20%) — bénéfice, motivation, valeur`,
  `   - « À quoi sert ... ? » (~15%) — découverte produit/feature`,
  `   - « Faut-il ... ? » (~10%) — décision, doute, conformité`,
  `   - « Quels sont ... ? » (~10%) — inventaire, comparaison`,
  `   - autres (« Quand », « Qui peut », « Combien », nominal de référence) (~5%)`,
  `4. **SERP preview test** : visualise mentalement ton titre dans une SERP Google. Avec la description en dessous, est-ce qu'on a envie de cliquer ?`,
  ``,
  `Contraintes du titre :`,
  `- 40 à 65 caractères. Pas de guillemets, pas de point final. Forme question = avec « ? » final.`,
  `- **Marketing punch implicite** quand pertinent : « pour un parc multi-sites », « sans complexité », « avant l'échéance 2027 ». Pas de superlatifs vides.`,
  `- Mot-clé métier adapté au sujet (cf. règle 10 ci-dessous) si ça s'intègre naturellement. Sinon, tant pis pour le SEO du titre — un titre naturel + nom propre vaut mieux qu'un titre alourdi.`,
  ``,
  `=== EXCELLENCE DE LA META-DESCRIPTION (130-155 chars stricts) ===`,
  `La meta-description est ce que Google affiche sous le titre dans la SERP. Elle doit PROMETTRE une réponse, pas pitcher le produit. Bannir le pattern « [Verbe] + [feature] grâce à [produit Buildy] ».`,
  ``,
  `Choisis 1 des 3 patterns de hook selon le sujet (alterner sur la flotte) :`,
  `- **Hook scénario** : « Vendredi 22h, votre site Lyon en défaut chauffage. Voici comment l'alerte vous parvient avant l'occupant. »`,
  `- **Hook question** : « Comment savoir qu'un compteur dérive avant que la facture n'arrive ? »`,
  `- **Hook chiffre/fait** : « 5 ans de rétention, 30 sec de latence d'alerte : ce qu'apporte une supervision GTB temps réel. »`,
  ``,
  `Structure : hook (½ phrase) → promesse claire du contenu → marque max 1 fois en fin si la place le permet.`,
  ``,
  `Bannir absolument : « Buildy » ou « Cet article » en tête ; « grâce à Buildy » / « grâce à Hyperveez » en fin ; superlatifs vides (« puissant », « complet », « performant », « solution unique », « optimisé »).`,
  ``,
  `=== EXCELLENCE DU CORPS ===`,
  `- **Opener concret** dans le 1er paragraphe : mini-scénario, question rhétorique, ou chiffre fort. Plutôt que « La détection des dérives est l'une des fonctions clés... », préférer « Une fuite d'eau qui coule toute la nuit dans une chaufferie inoccupée — c'est ce que la détection automatique des dérives empêche. »`,
  `- **Persona en sujet de phrase**, pas seulement en <strong> décoratif. Préférer « En tant que property manager, vous voulez savoir... » plutôt que de citer la persona uniquement dans un strong isolé.`,
  `- **Bénéfices quantifiés quand factuel et vrai** : « rétention 5 ans », « alerte < 60 sec », « 8+ protocoles supportés ». **JAMAIS de chiffre fictif** : si tu n'as pas la donnée dans le corpus, ne l'invente pas.`,
  `- **Variation de la structure** selon longueur cible :`,
  `   - Article court (300-500 mots) : intro + 2 H2 + FAQ subsidiaire si pertinent.`,
  `   - Article moyen (500-900 mots) : intro + 3-4 H2 + 1 callout + FAQ subsidiaire 2-3 questions.`,
  `   - Article long (900-1500 mots) : intro + 4-5 H2 avec H3 imbriqués + 1-2 callouts + FAQ subsidiaire 3-4 questions.`,
  `- **CTA service-oriented** en fin d'article : pas « Contactez le support » mais plutôt « Évaluez votre conformité BACS en 10 min », « Réservez une démo Hyperveez », « Demandez votre audit BACS ».`,
  `- **Maillage interne riche** : viser **3-5 liens internes** par article, avec libellés descriptifs (jamais « ici » ni « cliquez ici »). Si le corpus Buildy fourni contient des articles cousins, lie-les.`,
  `- **Mots-clés métier répétés 2-3x max** dans tout l'article, en variant la formulation (« supervision GTB » / « pilotage des équipements techniques » / « logiciel d'hypervision multi-sites »).`,
  ``,
  `=== ANTI-HALLUCINATION ===`,
  `- **Sourcer factuel uniquement** depuis le CORPUS Buildy fourni ou les informations explicites de l'article source / question utilisateur. Pas d'extrapolation.`,
  `- **Claims interdits** :`,
  `   - Partenariat fictif (« Buildy est partenaire de Schneider/Siemens »).`,
  `   - Certification fictive (« Buildy est certifié ISO 27001 », « Hyperveez ISO 52120 »).`,
  `   - Chiffre client ou référence sans source dans le corpus (« utilisé par 500 foncières »).`,
  `   - Fonctionnalité non listée dans le corpus (« Buildy gère la GED documentaire »).`,
  `- En cas de doute sur un fait → **omets** plutôt qu'invente.`,
  ``,
  `=== SEO — STRATÉGIE 2026 ===`,
  `Les articles sont publiés sur help.buildy.fr et indexés par Google. Stratégie SEO Buildy 2026 — vise les requêtes des property managers, asset managers, gestionnaires de parc immobilier qui cherchent une solution. Concurrence : Citron.io, GTB-Ingénierie, Sensinov. Évite le jargon technique qui capte des intégrateurs concurrents (pas des acheteurs).`,
  ``,
  `Mots-clés prioritaires (à intégrer NATURELLEMENT, jamais en force, jamais répétés bêtement). La liste effective vit dans /faq/settings — adapte-toi à elle si elle a été personnalisée :`,
  ``,
  `Niveau 1 — Attaque rapide (forte conversion, faible compétition, à privilégier quand le sujet s'y prête) :`,
  `- audit BACS, logiciel GTB, gestion technique bâtiment multi-sites, intégrateur GTB`,
  `- "supervision GTB" est aussi un mot-clé prioritaire MAIS uniquement quand l'article parle vraiment de pilotage temps réel / dashboards / alarmes (cf. section ci-dessous). Ne PAS l'utiliser par défaut pour tout article GTB.`,
  ``,
  `Niveau 2 — Point d'entrée funnel (financement / appels d'offres) :`,
  `- prime CEE GTB, BAT-TH-116`,
  ``,
  `Niveau 3 — Notoriété (gros volume, dominé par concurrents — viser via sous-angles) :`,
  `- décret BACS, décret tertiaire, GTB bâtiment tertiaire, smart building`,
  ``,
  `Cible client (sous-angles différenciants Buildy à intégrer quand naturel) :`,
  `- property manager, asset manager, parc immobilier multi-sites, gestion de parc immobilier, foncière`,
  ``,
  `Produit / fonctions Buildy :`,
  `- GTB (gestion technique du bâtiment), supervision, supervision multi-sites, supervision énergétique`,
  `- pilotage à distance, télémaintenance, alertes énergétiques, programmation horaire`,
  `- performance énergétique, conformité énergétique, économies d'énergie, mise en conformité`,
  `- bâtiment tertiaire, exploitation, maintenance énergétique`,
  `- usages : chauffage, climatisation, ventilation, éclairage, consommation`,
  ``,
  `Marque (à nommer au moins 1 fois quand pertinent) : Buildy, Hyperveez, Gojee, Buildy Edge.`,
  ``,
  `À ÉVITER en mots-clés stratégiques (ils peuvent apparaître si vraiment indispensables au sens, mais NE PAS forcer) :`,
  `- "hypervision" : très peu recherché tel quel sur Google. Préférer "supervision".`,
  `- "BACnet, Modbus, M-Bus, KNX, LoRaWAN" : protocoles techniques, captent des intégrateurs concurrents, pas des acheteurs property/asset manager. Si tu dois les mentionner, regrouper sous "via les protocoles standards supportés par Buildy".`,
  `- "R175", "R175-3" et autres codes : jargon réglementaire, personne ne tape ça sur Google. Dire "décret BACS" + un lien interne vers l'article BACS quand pertinent (le champ bacs_articles côté Buildy Docs gère le mapping automatique).`,
  ``,
  `Règles SEO concrètes :`,
  `1. **Premier paragraphe stratégique** : le 1er <p> doit contenir 1-2 mots-clés métier prioritaires de la requête, en langage naturel. Google indexe lourd les premiers ~150 caractères.`,
  `2. **Titres H2/H3 descriptifs** : préférer "Configurer une alerte de dérive énergétique sur un parc multi-sites" à "Configurer une alerte". Inclure le terme métier + l'angle (multi-sites, parc, etc.).`,
  `3. **Long-tail naturel** : si l'article répond à "Comment réinitialiser mon mot de passe ?", traiter aussi des variantes proches que les utilisateurs cherchent : "mot de passe oublié Hyperveez", "se reconnecter à la supervision", etc. — sans listes artificielles, en formulant les phrases pour que ces variantes apparaissent.`,
  `4. **Termes en gras (<strong>)** sur les expressions métier importantes (ex : <strong>audit BACS</strong>, <strong>supervision multi-sites</strong>, <strong>property manager</strong>). Le snippet Google met ces termes en avant quand ils matchent la recherche.`,
  `5. **Liens internes** vers d'autres articles FAQ pertinents quand c'est utile : <a href="..."> avec un libellé descriptif (pas "ici" ni "cliquez ici"). Le maillage interne est un signal SEO fort.`,
  `6. **Pas de keyword stuffing** : un mot-clé répété 3+ fois dans un même paragraphe est PIRE qu'absent (Google pénalise). Varier les formulations.`,
  `7. **Acronymes développés à la 1re occurrence** : "GTB (Gestion Technique du Bâtiment)", "BACS (Building Automation and Control Systems)". Les deux formes (acronyme + développé) capturent plus de requêtes.`,
  `8. **Pas de paragraphe italique sous une image** : Crisp génère automatiquement la légende sous l'image à partir de son attribut alt. N'ajoute JAMAIS de <p><em>texte</em></p> juste après une <img>, ça produirait une double légende sur help.buildy.fr. Mets toute l'information descriptive dans l'alt.`,
  `9. **TITRE EN QUESTION PAR DÉFAUT (c'est une FAQ)** : Frequently Asked Questions = par construction, chaque article répond à une question. Le titre DOIT être formulé comme la question naturelle que la persona se pose (cf. méthode EXCELLENCE DU TITRE ci-dessus). Exception très rare : forme nominale uniquement si AUCUNE question naturelle ne capture le sujet (textes de référence type "Décret BACS : texte officiel", "CGV Buildy"). Si tu hésites, prends la question.`,
  `10. **TITRE adapté au sujet** : choisis le mot-clé qui matche l'intention de recherche réelle. NE METS PAS "supervision GTB" par défaut — c'est seulement le bon mot-clé si l'article parle vraiment de pilotage temps réel. Si l'article concerne un produit/feature avec un nom propre (Buildy Connect, Gojee, Hyperveez, audit BACS Premium...), ce nom DOIT apparaître dans le titre OU être le sujet implicite. Pas de termes-parapluie ("logiciels métiers", "outils tiers") quand des termes concrets existent (GMAO, ERP, BI, IoT).`,
  `11. **PAS DE MARQUE EN TÊTE DE TITRE** : Le titre ne commence PAS par "Buildy", "Hyperveez", "Gojee", "Buildy Edge" ni "Buildy Connect". La persona Google ne connaît pas la marque quand elle cherche — sa requête est "Comment superviser une GTB multi-sites ?", pas "Comment Buildy supervise ma GTB ?". La marque peut apparaître au milieu ou en fin du titre, ou comme sujet explicite d'un article dédié au produit ("À quoi sert Gojee, l'app mobile GTB de Buildy ?" : OK car Gojee EST le sujet). Test : si le titre privé de la marque reste une recherche Google plausible, OK. Sinon, retravaille.`,
  `12. **DESCRIPTION PERSONA-FIRST** : Cf. méthode EXCELLENCE DE LA META-DESCRIPTION ci-dessus. Hook scénario / question / chiffre ; promesse claire ; marque max 1x en fin ; pas de "grâce à Buildy" ni superlatifs vides.`,
  `13. **FAQ CRISP = SERVICE-ANGLE, JAMAIS PROCÉDURAL** : Cf. section SERVICE-ANGLE OBLIGATOIRE ci-dessus. Si la réponse à ton titre est une suite de captures d'écran, c'est procédural → exclure. Si c'est un argumentaire bénéfice / un explainer fonctionnel, c'est service → bienvenue.`,
  ``,
  `=== RÈGLES STRICTES ===`,
  `- Réponds UNIQUEMENT par le HTML du corps de l'article. Pas de préambule "Voici…", pas de conclusion meta, pas de markdown Crisp brut (notre converter s'en charge).`,
  `- Aucune classe CSS hors les "callout-*" listés. Aucun <div>, <span>, <html>, <body>. Aucun style inline.`,
  `- Les listes ne s'imbriquent pas (Crisp Markdown ne supporte pas les listes imbriquées proprement).`,
  `- Espacement : un saut de ligne entre éléments de bloc, c'est le rendu Crisp qui gère le visuel.`,
  `- Quand tu peux mettre en valeur une astuce, une info importante ou une mise en garde : utilise les callouts <blockquote class="callout-tip|info|warning">. C'est nettement plus efficace qu'un simple <p>.`,
  `- Quand un mot clé technique est cité pour la 1re fois, l'entourer de <code> aide la lecture (ex : <code>buildy.fr</code>, <code>R175-3</code> en référence légale).`,
].join('\n');

const SYSTEM_PROMPT_FAQ_REWRITE = [
  SYSTEM_PROMPT_FAQ_BASE,
  ``,
  `=== MODE : RÉÉCRITURE ===`,
  `Tu reçois un article existant. Améliore-le SANS changer son sens : clarté, concision, structure aérée, application stricte des règles 1-13 ci-dessus. Conserve la longueur générale (ne réduis pas drastiquement). Si tu vois une erreur factuelle évidente par rapport au corpus fourni, corrige-la (cf. ANTI-HALLUCINATION).`,
  ``,
  `=== TITRE (cf. EXCELLENCE DU TITRE du BASE) ===`,
  `Si le titre actuel respecte la méthode 4 étapes (intent → variation interrogative → plausibility test → SERP preview) et les règles 9/10/11/13 ci-dessus, RECOPIE-LE. Sinon propose un meilleur titre via le marker \`<!--TITLE: nouveau titre-->\` AVANT le HTML.`,
].join('\n');

const SYSTEM_PROMPT_FAQ_GENERATE = [
  SYSTEM_PROMPT_FAQ_BASE,
  ``,
  `=== MODE : GÉNÉRATION DEPUIS UNE QUESTION ===`,
  `Tu reçois une question utilisateur. Rédige un article FAQ complet qui y répond, en appliquant strictement les blocs EXCELLENCE DU TITRE / DE LA META-DESCRIPTION / DU CORPS du BASE.`,
  ``,
  `Appuie-toi sur le CORPUS BUILDY fourni : ne réinvente pas, cite les fonctionnalités/équipements existants par leur nom officiel (cf. ANTI-HALLUCINATION).`,
  ``,
  `=== TITRE OBLIGATOIRE ===`,
  `Commence ta réponse par le marker \`<!--TITLE: titre proposé-->\` puis enchaîne le HTML.`,
  `Applique la méthode 4 étapes + règles 9/10/11/13 du BASE.`,
  ``,
  `=== META-DESCRIPTION OBLIGATOIRE ===`,
  `Juste après le marker TITLE, ajoute le marker \`<!--DESCRIPTION: meta-description-->\`.`,
  `Applique le bloc EXCELLENCE DE LA META-DESCRIPTION du BASE : 1 des 3 hooks (scénario / question / chiffre), 130-145 chars, marque max 1x en fin, pas de "grâce à Buildy" ni de superlatif vide.`,
].join('\n');

// Prompt dédié à la génération d'articles FAQ depuis une fonctionnalité de la
// bibliothèque (Lot 138). Diffère du prompt GENERATE habituel sur 3 points :
//   - L'IA reçoit une FONCTIONNALITÉ structurée (titre + body_html biblio +
//     codes BACS) plutôt qu'une question utilisateur.
//   - L'IA reçoit la liste des CAPTURES déjà uploadées sur le CDN public Crisp
//     et doit les insérer naturellement dans le corps (pas de placeholders).
//   - L'IA reçoit la liste des ARTICLES BACS publiés et peut insérer des liens
//     internes pertinents pour le maillage SEO.
const SYSTEM_PROMPT_FAQ_FROM_FUNCTIONALITY = [
  SYSTEM_PROMPT_FAQ_BASE,
  ``,
  `=== MODE : ARTICLE DEPUIS UNE FONCTIONNALITÉ BUILDY ===`,
  `Tu reçois une FONCTIONNALITÉ de la bibliothèque Buildy (description riche métier),`,
  `optionnellement une liste de CAPTURES d'écran à insérer (URLs publiques), et`,
  `optionnellement une liste d'ARTICLES BACS de référence (R175-1 à R175-6) déjà`,
  `publiés sur la même base.`,
  ``,
  `Mission : produire un article FAQ qui présente cette fonctionnalité aux décideurs et`,
  `prescripteurs (asset/property manager, MOA/MOE), en appliquant strictement les blocs`,
  `EXCELLENCE DU TITRE / DE LA META-DESCRIPTION / DU CORPS du BASE.`,
  ``,
  `=== STRUCTURE ATTENDUE (corps) ===`,
  `Cf. bloc EXCELLENCE DU CORPS du BASE. Variation selon longueur cible :`,
  `- Article court (300-500 mots) : intro + 2 H2 + FAQ subsidiaire si pertinent.`,
  `- Article moyen (500-900 mots) : intro + 3-4 H2 + 1 callout + FAQ subsidiaire 2-3 questions.`,
  `- Article long (900-1500 mots) : intro + 4-5 H2 avec H3 imbriqués + 1-2 callouts + FAQ subsidiaire 3-4 questions.`,
  `Persona en sujet de phrase, bénéfices quantifiés (factuels uniquement), maillage interne 3-5 liens, CTA service-oriented en fin.`,
  ``,
  `=== CAPTURES D'ÉCRAN ===`,
  `Si la liste de captures est fournie, INSÈRE chaque capture là où elle éclaire le propos`,
  `(juste après le paragraphe qui décrit la fonctionnalité illustrée). Syntaxe :`,
  `\`<p><img src="URL_FOURNIE" alt="CAPTION_FOURNIE"></p>\``,
  `Utilise EXACTEMENT les URLs fournies, ne les réécris pas. La caption fournie va`,
  `UNIQUEMENT dans l'attribut alt — NE PAS ajouter de <p><em>...</em></p> sous l'image,`,
  `Crisp affiche déjà automatiquement le alt comme légende sous l'image (double légende sinon).`,
  `LIMITE 4-6 images max par article même s'il y en a plus. Choisis les plus pertinentes`,
  `selon la narration. Pas de <img data-placeholder> ici, on a des vraies images.`,
  ``,
  `=== MAILLAGE INTERNE BACS ===`,
  `Si une liste d'ARTICLES BACS est fournie avec leurs URLs, insère 1 ou 2 liens internes`,
  `vers les plus pertinents : "Pour le détail du décret sur ce point, voir notre article`,
  `<a href=\"URL_FOURNIE\">titre fourni</a>." Ne force pas un lien si le contexte ne s'y prête pas.`,
  ``,
  `=== POSITIONNEMENT — TRÈS IMPORTANT ===`,
  `NE mentionne JAMAIS les niveaux d'offre Essentials / Smart / Premium ni les notions`,
  `de "inclus" / "option payante". L'article public ne parle pas de tarification.`,
  ``,
  `=== TITRE OBLIGATOIRE ===`,
  `Commence ta réponse par le marker \`<!--TITLE: titre proposé-->\` puis enchaîne le HTML.`,
  `Applique la méthode 4 étapes + règles 9/10/11/13 du BASE.`,
  ``,
  `=== META-DESCRIPTION OBLIGATOIRE ===`,
  `Juste après le marker TITLE, ajoute le marker \`<!--DESCRIPTION: meta-description-->\`.`,
  `Applique le bloc EXCELLENCE DE LA META-DESCRIPTION du BASE : 1 des 3 hooks (scénario / question / chiffre), 130-145 chars, marque max 1x en fin, pas de "grâce à Buildy" ni de superlatif vide.`,
].join('\n');

const SYSTEM_PROMPT_FAQ_SUGGEST_MISSING = [
  `Tu es l'assistant éditorial de la base de connaissance Buildy. Tu reçois :`,
  `- Le CORPUS Buildy (sections types, équipements, fonctionnalités).`,
  `- La liste des TITRES d'articles FAQ existants.`,
  ``,
  `Mission : identifier 5 à 10 articles MANQUANTS qui devraient exister dans la FAQ pour bien couvrir le corpus. Privilégie les sujets fréquemment posés par les exploitants : démarrage, alarmes, accès, intégrations, contrats, maintenance, dépannage courant, conformité BACS.`,
  ``,
  `Format de sortie OBLIGATOIRE — JSON valide UNIQUEMENT, pas de texte autour :`,
  `\`\`\`json`,
  `{ "suggestions": [`,
  `  { "title": "Titre nominal court (3-8 mots)",`,
  `    "rationale": "Pourquoi cet article manque (1 phrase).",`,
  `    "source_refs": ["nom de la fonctionnalité ou équipement Buildy lié", "..."] }`,
  `]}`,
  `\`\`\``,
  ``,
  `Règles : ne propose pas un sujet déjà couvert par un titre existant. Pas de doublon. Pas de marketing. Pas de jargon IT.`,
].join('\n');

function getActivePrompt(key, fallback) {
  try {
    const row = db.aiPrompts && db.aiPrompts.get(key);
    if (row && row.body && row.body.trim()) return row.body;
  } catch { /* fallback silencieux */ }
  return fallback;
}

// Construit un bloc texte agrégeant le corpus Buildy COMPLET pour l'IA :
// sections types, équipements (avec listes de points), fonctionnalités, plus
// les articles FAQ déjà publiés (titre + URL Crisp + résumé) pour permettre
// les liens internes. Cacheable (change rarement) -> cache_control ephemeral
// côté appelant pour économiser les tokens entre appels successifs.
//
// Options :
//   - mode 'exhaustive'     : corpus intégral (8000 chars/entité, articles FAQ
//                             en entier 6000 chars). Pour la génération d'articles
//                             où la précision factuelle prime. S'appuie sur le
//                             prompt caching éphémère pour amortir le coût.
//   - mode 'full' (défaut)  : corpus résumé (1500 chars/entité) pour rewrite.
//   - mode 'titles'         : corpus minimal pour suggest_missing (titres+résumé court).
function buildBuildyCorpusContext({ mode = 'full' } = {}) {
  const lines = [];
  const isExhaustive = mode === 'exhaustive';
  const isFull = mode === 'full' || isExhaustive;
  // Garde-fou anti-pathologique sur le mode exhaustive : 8 K chars / entité
  // ≈ 2500 tokens × ~30 entités → corpus borné à ~75 K tokens en pire cas
  // (largement sous les 200 K du contexte Sonnet 4.6).
  const MAX = isExhaustive ? 8000 : (isFull ? 1500 : 240);
  const MAX_FAQ = isExhaustive ? 6000 : (isFull ? 600 : 180);
  const truncate = (html, max = MAX) => {
    const txt = stripHtml(html || '');
    return txt.length > max ? txt.slice(0, max) + '…' : txt;
  };

  lines.push('# CORPUS BUILDY — SOURCE DE VÉRITÉ POUR LA RÉDACTION');
  lines.push('');
  lines.push('Ce corpus est la SEULE source que tu peux utiliser pour rédiger les articles. Toute affirmation factuelle (nom d\'écran, fonctionnalité, capacité, valeur, comportement) doit être traçable à un élément de ce corpus. Si une info n\'est pas ici, ne l\'invente pas.');
  lines.push('');

  // ── Sections types narratives ──────────────────────────────────
  try {
    const sections = db.sectionTemplates?.list?.({ kind: 'standard' }) || [];
    if (sections.length) {
      lines.push('## SECTIONS TYPES NARRATIVES (chapitres documentaires Buildy)');
      for (const s of sections) {
        if (!s.title) continue;
        const summary = truncate(s.description_html || s.body_html || '');
        lines.push(`### ${s.title}`);
        if (summary) lines.push(summary);
        if (s.bacs_articles) lines.push(`(BACS : ${s.bacs_articles})`);
        lines.push('');
      }
    }
  } catch { /* */ }

  // ── Équipements (templates + points si dispo) ─────────────────
  try {
    const eqs = db.equipmentTemplates?.list?.() || [];
    if (eqs.length) {
      lines.push('## ÉQUIPEMENTS / SYSTÈMES TECHNIQUES BUILDY');
      for (const e of eqs) {
        if (!e.name) continue;
        const summary = truncate(e.description_html || '');
        lines.push(`### ${e.name}${e.category ? ' [' + e.category + ']' : ''}`);
        if (summary) lines.push(summary);
        if (isFull && e.bacs_justification) {
          const j = truncate(e.bacs_justification, 600);
          if (j) lines.push(`*Justification BACS :* ${j}`);
        }
        // Liste de points (si la méthode existe)
        if (isFull) {
          try {
            const points = db.equipmentTemplatePoints?.listByTemplate?.(e.id) || [];
            if (points.length) {
              const sample = points.slice(0, 12).map((p) => p.label || p.slug).filter(Boolean);
              if (sample.length) lines.push(`*Points :* ${sample.join(', ')}${points.length > 12 ? `, … (+${points.length - 12})` : ''}`);
            }
          } catch { /* */ }
        }
        lines.push('');
      }
    }
  } catch { /* */ }

  // ── Fonctionnalités (is_functionality=1) ──────────────────────
  try {
    const features = db.sectionTemplates?.list?.({ kind: 'functionality' }) || [];
    if (features.length) {
      lines.push('## FONCTIONNALITÉS BUILDY (matrice E/S/P)');
      for (const f of features) {
        if (!f.title) continue;
        const summary = truncate(f.description_html || f.body_html || '');
        const levels = [];
        if (f.avail_e) levels.push(`Essentials:${f.avail_e}`);
        if (f.avail_s) levels.push(`Smart:${f.avail_s}`);
        if (f.avail_p) levels.push(`Premium:${f.avail_p}`);
        const lvl = levels.length ? ' (' + levels.join(' / ') + ')' : '';
        lines.push(`### ${f.title}${lvl}`);
        if (summary) lines.push(summary);
        if (f.bacs_articles) lines.push(`(BACS : ${f.bacs_articles})`);
        lines.push('');
      }
    }
  } catch { /* */ }

  // ── Articles FAQ déjà publiés sur help.buildy.fr (avec URL) ──
  // Permet à l'IA de proposer des liens internes au lieu de re-rédiger
  // un sujet déjà couvert.
  try {
    const articles = db.faqArticles?.listForCorpus?.() || [];
    if (articles.length) {
      lines.push('## ARTICLES FAQ DÉJÀ PUBLIÉS (utilise leur URL pour les liens internes)');
      for (const a of articles) {
        if (!a.title || !a.crisp_url) continue;
        const summary = truncate(a.content_html, MAX_FAQ);
        lines.push(`### [${a.title}](${a.crisp_url})${a.category_name ? ' — *' + a.category_name + '*' : ''}`);
        if (summary) lines.push(summary);
        lines.push('');
      }
    }
  } catch { /* */ }

  return lines.join('\n');
}

function _extractTitle(text, currentTitle) {
  let outHtml = text || '';
  let suggested_title = null;
  let suggested_description = null;
  const mt = outHtml.match(/<!--\s*TITLE:\s*(.+?)\s*-->/i);
  if (mt) {
    const proposed = (mt[1] || '').trim();
    if (proposed && proposed.toLowerCase() !== (currentTitle || '').toLowerCase()) {
      suggested_title = proposed;
    }
    outHtml = outHtml.replace(mt[0], '').trim();
  }
  const md = outHtml.match(/<!--\s*DESCRIPTION:\s*([\s\S]+?)\s*-->/i);
  if (md) {
    suggested_description = (md[1] || '').trim().slice(0, 160);
    outHtml = outHtml.replace(md[0], '').trim();
  }
  return { html: outHtml, suggested_title, suggested_description };
}

// ── SEO helpers : few-shot examples + auto-rewrite loop ────────────
// Voir lib/seo-scorer.js pour le détail des critères. Ce module charge :
// 1. Les top 3 articles avec score >= 80 et les injecte en exemples
//    "voici à quoi ressemble un article bien noté SEO" → mimétisme Claude.
// 2. Wraps les générations dans une boucle : si score < 70, rappel à Claude
//    avec ses propres failles → 2e passe corrige.

function _buildFewShotBlock(opts = {}) {
  const { excludeId = null, minScore = 80, limit = 3, maxCharsPerArticle = 1500 } = opts;
  let examples;
  try {
    examples = db.faqArticles.listTopScored({ excludeId, minScore, limit });
  } catch (e) {
    return null; // bootstrap : DB pas encore migrée ou listTopScored absent
  }
  if (!examples || !examples.length) return null;
  const blocks = examples.map((a, i) => {
    const html = (a.content_html || '').slice(0, maxCharsPerArticle);
    return `--- EXEMPLE ${i + 1} (score ${a.seo_score}/100) — "${a.title}" ---\n${html}`;
  }).join('\n\n');
  return [
    `=== EXEMPLES D'ARTICLES BUILDY TRÈS BIEN RÉFÉRENCÉS ===`,
    `Inspire-toi de leur structure, longueur, ton, intégration des mots-clés métier,`,
    `hiérarchie H2/H3, gras, liens internes. Ne les recopie PAS — ils sont là pour`,
    `te montrer le standard de qualité attendu.`,
    ``,
    blocks,
  ].join('\n');
}

function _buildSeoFeedbackPrompt(html, scoreResult) {
  const weakList = scoreResult.weakChecks
    .map((c) => `- [${c.weight} pts] ${c.message}`)
    .join('\n');
  return [
    `Ton article a un score SEO de ${scoreResult.score}/100. Refais-le en corrigeant ces points :`,
    weakList,
    ``,
    `Garde le sens, le ton, les liens internes, la longueur approximative.`,
    `Réponds par le HTML uniquement (avec marker TITLE en tête si tu améliores le titre).`,
  ].join('\n');
}

// Wrapper auto-rewrite : génère, score, retry jusqu'à `maxRetries` fois si
// score < targetScore. Coupe la boucle si Claude n'arrive pas à progresser
// (cas pathologique : contenu structurellement bas-score, ex. article très
// court). Évalue title + description + content HTML pour matcher la stratégie
// SEO complète (cf. seo-scorer.js scoreArticle).
async function _withSeoLoop(genFn, { targetScore = 70, maxRetries = 1 } = {}) {
  let result = await genFn(null);
  let evaluation = scoreArticle({
    title: result.suggested_title || '',
    description: result.suggested_description || '',
    contentHtml: result.html,
  });
  let attempts = 1;
  while (evaluation.score < targetScore && attempts <= maxRetries) {
    const feedback = _buildSeoFeedbackPrompt(result.html, evaluation);
    const next = await genFn({ previousHtml: result.html, feedback });
    const nextEval = scoreArticle({
      title: next.suggested_title || result.suggested_title || '',
      description: next.suggested_description || result.suggested_description || '',
      contentHtml: next.html,
    });
    // On garde la meilleure des 2 passes.
    if (nextEval.score > evaluation.score) {
      result = next;
      evaluation = nextEval;
    } else {
      // Aucune progression : pas la peine de retry de plus, on accepte le score.
      break;
    }
    attempts++;
  }
  return {
    ...result,
    seo_score: evaluation.score,
    seo_attempts: attempts,
    seo_weak_checks: evaluation.weakChecks,
  };
}

// Helper : strip tous markers HTML et commentaires éventuels
function _cleanInline(s) {
  return String(s || '')
    // strip <!-- ... --> markers (TITLE, DESCRIPTION, etc.)
    .replace(/<!--[\s\S]*?-->/g, '')
    // strip remaining HTML tags
    .replace(/<[^>]*>/g, '')
    // strip surrounding quotes/spaces
    .replace(/^[\s"«»'`]+|[\s"«»'`]+$/g, '')
    .replace(/[«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper : tronque à la dernière fin de phrase / espace propre avant maxLen.
// Évite "...autonome de vos" coupé mid-mot.
function _truncateClean(text, maxLen) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  // Cherche la dernière ponctuation forte (.!?) ; on accepte > 60% de maxLen
  const minBoundary = Math.floor(maxLen * 0.6);
  const lastPunct = Math.max(
    cut.lastIndexOf('.'),
    cut.lastIndexOf('!'),
    cut.lastIndexOf('?'),
  );
  if (lastPunct >= minBoundary) {
    return cut.slice(0, lastPunct + 1).trim();
  }
  // Sinon, dernière virgule ou point-virgule
  const lastSoft = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'), cut.lastIndexOf(':'));
  if (lastSoft >= minBoundary) {
    return cut.slice(0, lastSoft).trim() + '…';
  }
  // Sinon dernier espace
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= minBoundary) {
    return cut.slice(0, lastSpace).trim() + '…';
  }
  // Cas extrême : on cap brut au maxLen-1 + ellipse
  return cut.slice(0, maxLen - 1).trim() + '…';
}

// Helper : nettoie le contenu fourni à Claude (retire markers + tags + comments)
function _cleanContextHtml(html, maxChars) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ''); // strip markers
  s = stripHtml(s);
  if (maxChars && s.length > maxChars) s = s.slice(0, maxChars);
  return s;
}

// Reformulation IA du titre uniquement. Renvoie { title }.
// Prompt minimal (n'inclut PAS SYSTEM_PROMPT_FAQ_REWRITE qui contient les
// instructions sur les markers TITLE/DESCRIPTION et confond Claude).
async function assistFaqRewriteTitle({ article }) {
  if (!article) throw new Error('Article manquant');
  const systemText = [
    `Tu es un rédacteur SEO B2B expert GTB pour Buildy. Tu reformules UNIQUEMENT le titre`,
    `d'un article FAQ. Audience cible exclusive : décideurs et prescripteurs qui découvrent`,
    `Buildy via Google — asset manager, property manager, gestionnaire de parc immobilier,`,
    `foncière, MOA/MOE/BE. PAS d'exploitants qui cherchent une procédure step-by-step.`,
    ``,
    `=== MÉTHODE — 4 étapes obligatoires ===`,
    ``,
    `1. **Identifie l'INTENT de recherche** :`,
    `   - Lis l'article. Que cherche réellement la persona qui atterrit dessus ?`,
    `   - Quelle requête Google taperait-elle pour le trouver ?`,
    `   - Réponds en 1 phrase mentalement avant de continuer.`,
    ``,
    `2. **Choisis la BONNE FORME interrogative** (par défaut, c'est une question — c'est une FAQ) :`,
    `   - "Comment ... ?"             → réponse opérationnelle ("comment ça marche")`,
    `   - "Pourquoi ... ?"            → bénéfice, motivation, valeur, "qu'est-ce que ça change"`,
    `   - "À quoi sert ... ?"         → découverte d'un produit/feature avec nom propre`,
    `   - "Faut-il ... ?"             → décision, doute, conformité ("Faut-il une GTB pour le décret BACS ?")`,
    `   - "Quels sont ... ?"          → inventaire, comparaison, énumération courte`,
    `   - "Quand ... ?" / "Qui peut ... ?" / "Combien ... ?" → cas particuliers`,
    `   - Forme NOMINALE COURTE       → uniquement pour textes de référence ("Décret BACS : texte officiel", "CGV Buildy")`,
    `   ÉVITE DE COMMENCER 100% PAR "Comment". Alterne selon l'intent réel.`,
    ``,
    `3. **PLAUSIBILITY TEST — pas de marque en tête** :`,
    `   - Le titre ne commence PAS par "Buildy", "Hyperveez", "Gojee", "Buildy Edge", "Buildy Connect".`,
    `   - Test : retire mentalement la marque du titre. La requête restante doit rester une`,
    `     recherche Google plausible faite par quelqu'un qui ne connaît pas encore Buildy.`,
    `   - Exception : la marque/nom de feature peut être le SUJET explicite ("À quoi sert Gojee, l'app mobile GTB de Buildy ?").`,
    `   - La marque peut apparaître au MILIEU ou en FIN ("Comment optimiser ses programmations horaires avec Hyperveez ?" : OK).`,
    ``,
    `4. **SERP PREVIEW TEST** :`,
    `   - Visualise mentalement ton titre dans une SERP Google.`,
    `   - Est-ce qu'on a envie de cliquer ? Est-ce que ça répond à la requête ?`,
    `   - Si ça sonne robotique ou générique, retravaille.`,
    ``,
    `=== Règles complémentaires ===`,
    ``,
    `- **Nom propre du produit obligatoire** quand l'article EST dédié à un produit/feature (Buildy Connect → "Buildy Connect" ou le périmètre concret comme "GMAO/ERP" doit apparaître).`,
    `- **Termes que la persona TAPE** : préfère "GMAO, ERP, BI, IoT, CVC, ECS" aux parapluies ("logiciels métiers", "outils tiers"). Si l'article cite des outils précis dans son contenu, NOMME-LES.`,
    `- **Pas d'énumération sèche "X : Y, Z et W"**. Max 2 outils énumérés.`,
    `- **Mot-clé SEO secondaire** uniquement si naturel. Mapping intent → mot-clé :`,
    `   • Audit / conformité régl.              → "audit BACS", "décret BACS", "mise en conformité"`,
    `   • Logiciel / SaaS / offre commerciale   → "logiciel GTB"`,
    `   • Multi-sites / parc immobilier         → "parc immobilier", "multi-sites"`,
    `   • Pilotage temps réel / alarmes         → "supervision GTB"`,
    `   • Économies d'énergie / dérives         → "performance énergétique"`,
    `   • Intégrations / API / interop          → nomme l'outil ciblé (GMAO, ERP, BI...)`,
    `   • Personae cibles                       → "asset manager", "property manager"`,
    `  NE METS PAS "supervision GTB" par défaut. Si aucun mot-clé ne tombe naturellement, tant pis pour le SEO du titre.`,
    `- **Marketing punch implicite** quand pertinent : "pour un parc multi-sites", "sans complexité", "avant l'échéance 2027". Pas de superlatifs vides ("puissant", "complet", "performant").`,
    `- **Évite** "hypervision", "BACnet", "Modbus", "R175", "BAT-TH-116", "BREEAM/HQE" (faible volume Google ou intent différent).`,
    ``,
    `=== Contraintes finales ===`,
    `- 40 à 65 caractères. Forme question = avec "?" final.`,
    `- Pas de guillemets, pas de point final, pas de virgule en milieu.`,
    `- Ne change pas le sens : le sujet reste le même.`,
    ``,
    `RÉPONSE : 1 ligne avec le NOUVEAU TITRE seul. Pas de préambule "Voici", pas de`,
    `guillemets, pas de markdown, pas de balises HTML, pas de commentaires.`,
  ].join('\n');
  const userText = [
    `Titre actuel : ${article.title || '(aucun)'}`,
    article.description ? `Description : ${article.description}` : null,
    ``,
    `Contenu (extrait nettoyé) :`,
    _cleanContextHtml(article.content_html || '', 800),
  ].filter(Boolean).join('\n');

  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 200,
    system: [{ type: 'text', text: systemText }],
    messages: [{ role: 'user', content: userText }],
  });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const title = _cleanInline(raw).slice(0, 200);
  return { title, usage: resp.usage };
}

// Réécriture IA d'une sélection HTML dans l'éditeur (BubbleMenu Tiptap).
// Renvoie { html } prêt à être inséré en remplacement de la sélection.
// L'instruction est optionnelle (« raccourcir », « rendre plus pédagogue », ...).
async function assistFaqRewriteSelection({ selectionHtml, instruction = '', article = null }) {
  if (!selectionHtml || !selectionHtml.trim()) {
    throw new Error('Sélection vide');
  }
  const systemText = [
    `Tu es un rédacteur SEO spécialisé en supervision technique du bâtiment (GTB) pour Buildy.`,
    `Tu réécris UNIQUEMENT le passage HTML fourni (article FAQ Buildy / Crisp Helpdesk),`,
    `en respectant l'instruction utilisateur si elle est donnée. Sinon améliore clarté + lisibilité.`,
    ``,
    `RÈGLES STRICTES :`,
    `- Ne sors JAMAIS du périmètre du passage. Pas d'ajout d'intro/conclusion/section nouvelle.`,
    `- Conserve la même structure HTML que l'entrée (mêmes balises de niveau supérieur :`,
    `  si l'entrée est <p>...</p>, sors <p>...</p>. Si <li>, sors <li>. Si plusieurs blocs,`,
    `  même nombre de blocs).`,
    `- Garde les <strong>, <em>, <a href> existants si pertinents (ne casse pas les liens internes).`,
    `- Ne change pas le sens du passage. Reformule, pas de fabrication.`,
    `- Mots-clés métier SEO : utilise ceux qui matchent le sujet (audit BACS / décret BACS pour`,
    `  conformité, logiciel GTB pour produit, parc immobilier / multi-sites, performance énergétique,`,
    `  asset manager / property manager pour persona). "supervision GTB" UNIQUEMENT si le passage`,
    `  parle de pilotage temps réel / alarmes. Sinon, ne force pas. Évite "hypervision", "BACnet", "R175".`,
    `- N'ajoute pas de commentaire HTML <!-- --> ni de marker TITLE/DESCRIPTION.`,
    ``,
    `RÉPONSE : UNIQUEMENT le HTML réécrit, rien d'autre. Pas de préambule "Voici", pas de`,
    `guillemets, pas de balises de code (\`\`\`), pas d'explication.`,
  ].join('\n');
  const userText = [
    instruction ? `Instruction : ${instruction.trim()}` : `Instruction : aucune (améliore clarté/lisibilité).`,
    article?.title ? `Contexte article : « ${article.title} »` : null,
    ``,
    `Passage HTML à réécrire :`,
    selectionHtml,
  ].filter(Boolean).join('\n');

  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    system: [{ type: 'text', text: systemText }],
    messages: [{ role: 'user', content: userText }],
  });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  // Nettoie : strip code fences ``` éventuels, strip markers HTML commentaires.
  const html = raw
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/<!--\s*(?:TITLE|DESCRIPTION):[\s\S]*?-->/gi, '')
    .trim();
  return { html, usage: resp.usage };
}

// Reformulation / génération IA de la description (meta-description SEO).
// Renvoie { description }. Prompt minimal isolé.
async function assistFaqRewriteDescription({ article }) {
  if (!article) throw new Error('Article manquant');
  const hasDescription = !!(article.description || '').trim();
  const systemText = [
    `Tu es un rédacteur SEO B2B expert GTB pour Buildy. Tu ${hasDescription ? 'reformules' : 'génères'} UNIQUEMENT`,
    `la meta-description SEO d'un article FAQ. C'est la phrase qui apparaît sous le titre dans les SERPs Google`,
    `et dans le partage Crisp. Audience cible : asset manager, property manager, gestionnaire de parc immobilier,`,
    `foncière, MOA/MOE — qui découvrent Buildy via Google.`,
    ``,
    `=== LONGUEUR (règle absolue) ===`,
    `- 130 à 145 caractères STRICT. Jamais plus.`,
    `- Vérifie mentalement le décompte AVANT de répondre — mais NE METS PAS le décompte dans la sortie.`,
    `- La phrase doit se TERMINER complètement (point final), pas être coupée.`,
    `- Si hésitation longue/courte, prends la courte.`,
    ``,
    `=== HOOK D'OUVERTURE — choisis 1 des 3 patterns selon le sujet ===`,
    `Pattern A — **Hook scénario** (situation concrète vécue par la persona) :`,
    `  • "Vendredi 22h, votre site Lyon en défaut chauffage. Voici comment l'alerte vous parvient avant l'occupant."`,
    `  • "Une fuite d'eau qui coule toute la nuit dans une chaufferie inoccupée : voici comment éviter ça."`,
    ``,
    `Pattern B — **Hook question** (pose la question que la persona se pose) :`,
    `  • "Comment savoir qu'un compteur dérive avant que la facture n'arrive ?"`,
    `  • "Faut-il une GTB sur tous vos sites pour respecter le décret BACS ?"`,
    ``,
    `Pattern C — **Hook chiffre / fait** (chiffre fort, fait notable, contraste) :`,
    `  • "5 ans de rétention, alertes < 60 sec : ce qu'apporte une supervision GTB temps réel."`,
    `  • "8 protocoles supportés, 1 console centralisée : le pilotage d'un parc multi-sites."`,
    ``,
    `ALTERNE les 3 patterns sur la flotte. Ne pas toujours commencer par un verbe d'action.`,
    ``,
    `=== STRUCTURE ===`,
    `Hook (½ phrase) → promesse claire de l'article → marque max 1 fois en fin si la place le permet.`,
    `Ton informatif et concret. Pas de superlatif marketing.`,
    ``,
    `=== MOTS-CLÉS MÉTIER (1 ou 2, ADAPTÉS au sujet, JAMAIS forcés) ===`,
    `  • Audit / conformité régl.              → "audit BACS", "décret BACS", "mise en conformité"`,
    `  • Logiciel / SaaS / offre commerciale   → "logiciel GTB"`,
    `  • Multi-sites / parc immobilier         → "parc immobilier multi-sites", "gestion de parc"`,
    `  • Pilotage temps réel / alarmes         → "supervision GTB" (seulement si vraiment temps réel)`,
    `  • Économies / dérives énergétiques      → "performance énergétique", "économies d'énergie"`,
    `  • Personae cibles                       → "asset manager", "property manager"`,
    ``,
    `NE METS PAS "supervision GTB" par défaut. Évite "hypervision", "BACnet", "Modbus", "KNX", "R175", "BREEAM/HQE".`,
    ``,
    `=== INTERDITS ABSOLUS ===`,
    `- "Buildy" ou "Cet article" en tête.`,
    `- "grâce à Buildy" / "grâce à Hyperveez" / "grâce à Gojee" en fin (pattern produit-first banni).`,
    `- Superlatifs marketing vides : "solution complète", "puissant", "performant", "optimisé", "leader", "innovant", "unique".`,
    `- Hook 100% du temps en verbe d'action ("Pilotez, Supervisez, Configurez, Auditez...") — c'est un pattern qui devient répétitif. Verbe d'action OK occasionnellement, alterner avec les patterns A/B/C.`,
    ``,
    `RÉPONSE : EXACTEMENT 1 ligne contenant la SEULE phrase finale (130-145 chars). RIEN d'autre.`,
    `INTERDIT dans la sortie (ce sont des erreurs déjà observées) :`,
    `- Préambule ("Voici", "Réponse :", "Description :")`,
    `- Décompte de caractères ("Comptage : 144 caractères.", "(144 chars)", "✓", "144c")`,
    `- Guillemets, markdown, balises HTML, commentaires <!-- -->`,
    `- Markers TITLE / DESCRIPTION`,
    `- Toute justification ou méta-commentaire après la phrase.`,
  ].join('\n');
  const userText = [
    `Titre : ${article.title || '(aucun)'}`,
    hasDescription ? `Description actuelle : ${article.description}` : `(Pas de description, à créer)`,
    ``,
    `Contenu (extrait nettoyé, sans HTML ni markers) :`,
    _cleanContextHtml(article.content_html || '', 1200),
  ].join('\n');

  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 400,
    system: [{ type: 'text', text: systemText }],
    messages: [{ role: 'user', content: userText }],
  });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  // Garde-fou : si Claude ajoute un méta-commentaire de comptage en fin
  // (« Comptage : 144 caractères. », « (144 chars) », « ✓ »), on le strip.
  const stripped = raw
    .replace(/\s*[—–-]?\s*Comptage\s*:[^\n]*$/i, '')
    .replace(/\s*\(\s*\d{1,3}\s*(chars?|caract[eè]res?)\s*\)\s*$/i, '')
    .replace(/\s*\d{1,3}\s*(chars?|caract[eè]res?)\s*\.?\s*[✓✗]?\s*$/i, '')
    .replace(/\s*[✓✗]\s*$/u, '')
    .trim();
  const description = _truncateClean(_cleanInline(stripped), 160);
  return { description, usage: resp.usage };
}

async function assistFaqRewrite({ article, instructions = null }) {
  if (!article) throw new Error('Article manquant');
  const corpus = buildBuildyCorpusContext({ mode: 'full' });
  const fewShot = _buildFewShotBlock({ excludeId: article.id });

  const systemBlocks = [
    {
      type: 'text',
      text: getActivePrompt(PROMPT_KEY_FAQ_REWRITE, SYSTEM_PROMPT_FAQ_REWRITE),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `=== CORPUS BUILDY ===\n${corpus}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (fewShot) {
    systemBlocks.push({ type: 'text', text: fewShot, cache_control: { type: 'ephemeral' } });
  }

  const callClaude = async (retryContext) => {
    const userParts = [
      `=== ARTICLE À RÉÉCRIRE ===`,
      `Titre : ${article.title || ''}`,
      `Catégorie : ${article.category_name || article.category || '—'}`,
      ``,
      `Contenu actuel (HTML) :`,
      retryContext?.previousHtml || article.content_html || '<p></p>',
      ``,
    ];
    if (retryContext?.feedback) {
      userParts.push(retryContext.feedback);
    } else {
      // Instructions custom de l'utilisateur (saisies dans la modale frontend) :
      // priorité absolue, en plus des règles du prompt système. Utile pour
      // corriger une hallucination ou imposer un angle (audience, longueur,
      // termes à éviter).
      if (instructions && String(instructions).trim()) {
        userParts.push(
          `=== INSTRUCTIONS PRIORITAIRES DE L'UTILISATEUR ===`,
          String(instructions).trim(),
          `Applique ces instructions EN PRIORITÉ sur les règles standard. Si une instruction contredit le prompt système, l'instruction utilisateur l'emporte sauf pour la syntaxe Crisp Markdown et la sécurité (URLs réelles uniquement, pas d'invention factuelle).`,
          ``,
        );
      }
      userParts.push(`Réécris l'article en améliorant clarté et structure. Réponds par le HTML uniquement (avec marker TITLE en tête si tu changes le titre).`);
    }
    const resp = await client().messages.create({
      model: config.claudeModel,
      max_tokens: 8192,
      system: systemBlocks,
      messages: [{ role: 'user', content: userParts.join('\n') }],
    });
    const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const truncated = resp.stop_reason === 'max_tokens';
    if (truncated) {
      console.warn('[faq.ai] rewrite truncated (max_tokens hit)', { usage: resp.usage });
    }
    const { html, suggested_title } = _extractTitle(raw, article.title);
    return { html, suggested_title, usage: resp.usage, truncated };
  };

  return _withSeoLoop(callClaude);
}

async function assistFaqGenerate({ question, categoryName = null }) {
  if (!question || !question.trim()) throw new Error('Question manquante');
  const corpus = buildBuildyCorpusContext({ mode: 'exhaustive' });
  const fewShot = _buildFewShotBlock();

  const systemBlocks = [
    {
      type: 'text',
      text: getActivePrompt(PROMPT_KEY_FAQ_GENERATE, SYSTEM_PROMPT_FAQ_GENERATE),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `=== CORPUS BUILDY ===\n${corpus}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (fewShot) {
    systemBlocks.push({ type: 'text', text: fewShot, cache_control: { type: 'ephemeral' } });
  }

  const callClaude = async (retryContext) => {
    const userParts = [
      `=== QUESTION CLIENT ===`,
      question.trim(),
      ``,
    ];
    if (categoryName) userParts.push(`Catégorie cible : ${categoryName}`, '');

    if (retryContext?.feedback) {
      userParts.push(`=== ARTICLE GÉNÉRÉ AU 1ER PASSAGE ===`);
      userParts.push(retryContext.previousHtml || '');
      userParts.push('');
      userParts.push(retryContext.feedback);
    } else {
      userParts.push(`Rédige l'article FAQ complet (titre + corps HTML).`);
    }
    const resp = await client().messages.create({
      model: config.claudeModel,
      max_tokens: 8192,
      system: systemBlocks,
      messages: [{ role: 'user', content: userParts.join('\n') }],
    });
    const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const truncated = resp.stop_reason === 'max_tokens';
    if (truncated) {
      console.warn('[faq.ai] generate truncated (max_tokens hit)', { usage: resp.usage });
    }
    const { html, suggested_title } = _extractTitle(raw, '');
    return { html, suggested_title, usage: resp.usage, truncated };
  };

  return _withSeoLoop(callClaude);
}

// Génération d'un article FAQ depuis une fonctionnalité bibliothèque (Lot 138).
// Args :
//   - functionality : row section_templates (is_functionality=1) avec body_html + bacs_articles
//   - attachments   : Array de { url, caption, position } déjà publiées sur CDN public Crisp
//   - bacsCoverage  : Array de { id, title, crisp_url } des articles BACS publiés à linker
//   - locale        : 'fr' par défaut
// Retour : { html, suggested_title, suggested_description, seo_score, usage }
async function assistFaqGenerateFromFunctionality({ functionality, attachments = [], bacsCoverage = [], locale = 'fr' }) {
  if (!functionality) throw new Error('Fonctionnalité manquante');
  const corpus = buildBuildyCorpusContext({ mode: 'exhaustive' });
  const fewShot = _buildFewShotBlock();

  const systemBlocks = [
    {
      type: 'text',
      text: getActivePrompt(PROMPT_KEY_FAQ_FROM_FUNCTIONALITY, SYSTEM_PROMPT_FAQ_FROM_FUNCTIONALITY),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `=== CORPUS BUILDY ===\n${corpus}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (fewShot) {
    systemBlocks.push({ type: 'text', text: fewShot, cache_control: { type: 'ephemeral' } });
  }

  // Bloc utilisateur structuré : fonctionnalité + captures + articles BACS à linker.
  function buildUserParts(retryContext) {
    const parts = [
      `=== FONCTIONNALITÉ SOURCE ===`,
      `Titre : ${functionality.title || '(sans titre)'}`,
      functionality.slug ? `Slug : ${functionality.slug}` : null,
      functionality.bacs_articles ? `Codes BACS couverts : ${functionality.bacs_articles}` : null,
      ``,
      `Contenu riche (HTML brut, source de vérité) :`,
      functionality.body_html || '(vide — déduire à partir du titre uniquement)',
      ``,
    ].filter(Boolean);

    if (attachments.length > 0) {
      parts.push(`=== CAPTURES À INSÉRER (URLs publiques, ordre suggéré) ===`);
      attachments.forEach((a, i) => {
        parts.push(`${i + 1}. URL : ${a.url}`);
        if (a.caption) parts.push(`   Caption : ${a.caption}`);
      });
      parts.push('');
    } else {
      parts.push(`=== CAPTURES ===`, `(aucune capture attachée — pas d'image à insérer)`, '');
    }

    if (bacsCoverage.length > 0) {
      parts.push(`=== ARTICLES BACS À LIER (maillage SEO interne) ===`);
      bacsCoverage.forEach((b) => {
        parts.push(`- "${b.title}" → ${b.crisp_url} (codes : ${b.bacs_articles || ''})`);
      });
      parts.push('');
    }

    if (retryContext?.feedback) {
      parts.push(`=== ARTICLE GÉNÉRÉ AU 1ER PASSAGE ===`);
      parts.push(retryContext.previousHtml || '');
      parts.push('');
      parts.push(retryContext.feedback);
    } else {
      parts.push(`Rédige l'article FAQ complet (markers TITLE + DESCRIPTION + HTML).`);
    }
    return parts.join('\n');
  }

  const callClaude = async (retryContext) => {
    const resp = await client().messages.create({
      model: config.claudeModel,
      max_tokens: 8192,
      system: systemBlocks,
      messages: [{ role: 'user', content: buildUserParts(retryContext) }],
    });
    const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const truncated = resp.stop_reason === 'max_tokens';
    if (truncated) console.warn('[faq.ai] from-functionality truncated (max_tokens hit)', { usage: resp.usage });
    const { html, suggested_title, suggested_description } = _extractTitle(raw, functionality.title || '');
    return { html, suggested_title, suggested_description, usage: resp.usage, truncated };
  };

  // Génération depuis biblio : on vise un score SEO plus élevé que pour les
  // autres générations (article public Google, l'investissement IA en vaut
  // la peine). 80 = cible "très bon". Jusqu'à 2 retries pour pousser le SEO.
  const result = await _withSeoLoop(callClaude, { targetScore: 80, maxRetries: 2 });
  return {
    title: result.suggested_title || functionality.title || 'Article FAQ',
    description: result.suggested_description || null,
    html: result.html,
    seo_score: result.seo_score,
    seo_weak_checks: result.seo_weak_checks,
    usage: result.usage,
    truncated: result.truncated,
  };
}

async function assistFaqSuggestMissing() {
  const corpus = buildBuildyCorpusContext({ includeFaqTitles: true });
  const systemBlocks = [
    {
      type: 'text',
      text: getActivePrompt(PROMPT_KEY_FAQ_SUGGEST_MISSING, SYSTEM_PROMPT_FAQ_SUGGEST_MISSING),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `=== CORPUS BUILDY + FAQ ===\n${corpus}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  const userPrompt = `Identifie les articles FAQ manquants. Sortie JSON strict.`;

  const resp = await client().messages.create({
    model: config.claudeModel,
    max_tokens: 8192,
    system: systemBlocks,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(cleaned); } catch { /* tolerant */ }
  return {
    suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
    usage: resp.usage,
  };
}

module.exports = {
  streamSection, buildPrompts, assistLibrary,
  assistAuditSynthesis, assistActionAlternatives, assistTranscriptMapping,
  // Pour la page d'administration "Prompts IA"
  PROMPT_KEY_LIBRARY,
  DEFAULT_SYSTEM_PROMPT_LIBRARY: SYSTEM_PROMPT_LIBRARY,
  getActivePromptLibrary,
  // FAQ Buildy / Crisp
  assistFaqRewrite, assistFaqGenerate, assistFaqSuggestMissing,
  assistFaqRewriteTitle, assistFaqRewriteDescription, assistFaqRewriteSelection,
  assistFaqGenerateFromFunctionality,
  buildBuildyCorpusContext,
  PROMPT_KEY_FAQ_REWRITE,
  PROMPT_KEY_FAQ_GENERATE,
  PROMPT_KEY_FAQ_FROM_FUNCTIONALITY,
  DEFAULT_SYSTEM_PROMPT_FAQ_FROM_FUNCTIONALITY: SYSTEM_PROMPT_FAQ_FROM_FUNCTIONALITY,
  PROMPT_KEY_FAQ_SUGGEST_MISSING,
  DEFAULT_SYSTEM_PROMPT_FAQ_REWRITE: SYSTEM_PROMPT_FAQ_REWRITE,
  DEFAULT_SYSTEM_PROMPT_FAQ_GENERATE: SYSTEM_PROMPT_FAQ_GENERATE,
  DEFAULT_SYSTEM_PROMPT_FAQ_SUGGEST_MISSING: SYSTEM_PROMPT_FAQ_SUGGEST_MISSING,
  // Audit BACS
  PROMPT_KEY_BACS_SYNTHESIS,
  PROMPT_KEY_BACS_TRANSCRIPT,
  DEFAULT_SYSTEM_PROMPT_BACS_SYNTHESIS: SYSTEM_PROMPT_SYNTHESIS,
  DEFAULT_SYSTEM_PROMPT_BACS_TRANSCRIPT: SYSTEM_PROMPT_TRANSCRIPT,
};
