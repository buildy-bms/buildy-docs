'use strict';

// Conversion Crisp Helpdesk Markdown <-> HTML compatible Tiptap.
//
// Le markdown Crisp est non-standard sur plusieurs points :
//   - `__text__` = soulignement (PAS gras)
//   - `++text++` = surlignage
//   - `| ...`   = callout "tip"
//   - `|| ...`  = callout "info"
//   - `||| ...` = callout "warning"
//   - `${youtube}[label](id)` = embed YouTube (idem vimeo, dailymotion, frame)
//   - `![alt](url =WIDTHxauto)` = image avec largeur explicite
//
// Doc : https://help.crisp.chat/en/article/how-to-format-knowledge-base-articles-oiurpj/

// ─── Markdown -> HTML ──────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _inline(s) {
  if (!s) return '';
  let out = s;

  // Échapper les `<` / `>` qui ne sont pas dans une balise <a> qu'on a déjà construite.
  // (On gère plus bas la conversion des liens, donc ici on protège juste contre l'injection.)
  // On garde les caractères tels quels, puis on transforme.

  // Inline code (backticks) — protéger en premier pour ne pas réinterpréter le contenu
  const codeStash = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codeStash.push(`<code>${escapeHtml(code)}</code>`);
    return `CODE${codeStash.length - 1}`;
  });

  // Échapper le HTML résiduel
  out = escapeHtml(out);

  // Images : ![alt](url =WIDTHxauto)
  out = out.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+=(\d+)x(?:auto|\d+))?\)/g, (_, alt, url, w) => {
    const widthAttr = w ? ` width="${w}"` : '';
    return `<img src="${url}" alt="${alt}"${widthAttr}>`;
  });

  // Embeds : ${youtube}[label](id) -> <a href="https://youtu.be/id">label</a>
  out = out.replace(/\$\{(youtube|vimeo|dailymotion|frame)\}\[([^\]]*)\]\(([^)]+)\)/g, (_, kind, label, id) => {
    let url;
    if (kind === 'youtube')      url = `https://www.youtube.com/watch?v=${id}`;
    else if (kind === 'vimeo')   url = `https://vimeo.com/${id}`;
    else if (kind === 'dailymotion') url = `https://www.dailymotion.com/video/${id}`;
    else                         url = id; // frame
    return `<a href="${url}" data-embed="${kind}">${label || url}</a>`;
  });

  // Liens : [label](url)
  out = out.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label, url) => {
    return `<a href="${url}">${label || url}</a>`;
  });

  // Bold ** ** (avant italic * * pour ne pas être mangé)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic * *
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Underline __ __
  out = out.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  // Highlight ++ ++
  out = out.replace(/\+\+([^+\n]+)\+\+/g, '<mark>$1</mark>');
  // Strikethrough ~~ ~~
  out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

  // Restaurer les codes
  out = out.replace(/CODE(\d+)/g, (_, i) => codeStash[Number(i)]);

  return out;
}

function crispMarkdownToHtml(md) {
  if (!md) return '';
  // Si le contenu ressemble déjà à du HTML (édité côté Buildy Docs et non encore poussé)
  // on le renvoie tel quel.
  if (/<\/(p|h[1-6]|ul|ol|li|strong|em|u|mark|s|blockquote|img|a|code|pre|hr)>/i.test(md)) {
    return md;
  }

  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  function flushParagraph(buf) {
    if (!buf.length) return;
    const text = buf.join(' ').trim();
    if (text) out.push(`<p>${_inline(text)}</p>`);
  }

  let para = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Ligne vide -> fin de paragraphe
    if (!trimmed) {
      flushParagraph(para);
      para = [];
      i++;
      continue;
    }

    // Code block ``` ou ```lang
    const fence = trimmed.match(/^```(\w*)$/);
    if (fence) {
      flushParagraph(para); para = [];
      const lang = fence[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const codeContent = escapeHtml(codeLines.join('\n'));
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${codeContent}</code></pre>`);
      continue;
    }

    // Heading
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushParagraph(para); para = [];
      const level = h[1].length;
      out.push(`<h${level}>${_inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed)) {
      flushParagraph(para); para = [];
      out.push('<hr>');
      i++;
      continue;
    }

    // Callouts ||| (warning) puis || (info) puis | (tip) — ordre important
    let callout = null;
    if (trimmed.startsWith('|||')) callout = { cls: 'callout-warning', content: trimmed.slice(3).trim() };
    else if (trimmed.startsWith('||')) callout = { cls: 'callout-info', content: trimmed.slice(2).trim() };
    else if (trimmed.startsWith('|') && !trimmed.startsWith('|-') && !/^\|.*\|/.test(trimmed)) {
      // évite la collision avec les tableaux pipe-delimités
      callout = { cls: 'callout-tip', content: trimmed.slice(1).trim() };
    }
    if (callout) {
      flushParagraph(para); para = [];
      i++;
      // Tolérance legacy : si le préfixe est sur une ligne seule, on absorbe
      // le 1er paragraphe qui suit (qui formait un paragraphe orphelin à cause
      // du bug pré-correction du converter HTML->MD). Skip les lignes vides.
      if (!callout.content) {
        while (i < lines.length && !lines[i].trim()) i++; // skip blanks
        const absorbed = [];
        while (i < lines.length && lines[i].trim() && !/^[#>|]|^[*\-+]\s|^\d+\.\s|^```/.test(lines[i].trim())) {
          absorbed.push(lines[i].trim());
          i++;
        }
        callout.content = absorbed.join(' ').trim();
      }
      out.push(`<blockquote class="${callout.cls}">${_inline(callout.content || '')}</blockquote>`);
      continue;
    }

    // Quote >
    if (trimmed.startsWith('>')) {
      flushParagraph(para); para = [];
      const qLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        qLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${_inline(qLines.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list — tolère les lignes vides entre items (legacy Crisp)
    if (/^[*\-+]\s+/.test(trimmed)) {
      flushParagraph(para); para = [];
      const items = [];
      let j = i;
      while (j < lines.length) {
        const l = lines[j];
        if (/^\s*[*\-+]\s+/.test(l)) {
          items.push(l.replace(/^\s*[*\-+]\s+/, ''));
          j++;
        } else if (!l.trim()) {
          // ligne vide : continue la liste si l'item suivant est encore une puce
          let k = j + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && /^\s*[*\-+]\s+/.test(lines[k])) j = k;
          else break;
        } else {
          break;
        }
      }
      i = j;
      out.push('<ul>' + items.map((t) => `<li>${_inline(t)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list — tolère "1. \n\n 1. \n\n 1." que Crisp produit quand
    // chaque item est isolé par une ligne vide. On fusionne en une <ol> unique
    // et on renumérote correctement côté HTML.
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(para); para = [];
      const items = [];
      let j = i;
      while (j < lines.length) {
        const l = lines[j];
        if (/^\s*\d+\.\s+/.test(l)) {
          items.push(l.replace(/^\s*\d+\.\s+/, ''));
          j++;
        } else if (!l.trim()) {
          let k = j + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && /^\s*\d+\.\s+/.test(lines[k])) j = k;
          else break;
        } else {
          break;
        }
      }
      i = j;
      out.push('<ol>' + items.map((t) => `<li>${_inline(t)}</li>`).join('') + '</ol>');
      continue;
    }

    // Tableaux pipe-delimités | col1 | col2 |
    if (/^\|.+\|$/.test(trimmed) && i + 1 < lines.length && /^\|\s*-+/.test(lines[i + 1].trim())) {
      flushParagraph(para); para = [];
      const headerCells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      i += 2; // skip header + séparateur
      const rows = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
        i++;
      }
      const thead = '<thead><tr>' + headerCells.map((c) => `<th>${_inline(c)}</th>`).join('') + '</tr></thead>';
      const tbody = '<tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${_inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>';
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Sinon -> ligne de paragraphe
    para.push(trimmed);
    i++;
  }
  flushParagraph(para);

  return out.join('\n');
}

// ─── HTML -> Markdown Crisp ────────────────────────────────────────

// Mini-walker DOM-less : on parse à la regex pour les tags Tiptap usuels.
// L'éditeur Tiptap produit du HTML très contraint (<p>, <ul>, <ol>, <li>,
// <strong>, <em>, <h*>, <a>, <img>, <blockquote>, <code>, <pre>).
// Pas besoin d'un vrai parseur DOM côté serveur.

function _htmlInline(html) {
  let s = html;

  // Décode les entités basiques (Tiptap encode &nbsp;, etc.)
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Inline tags. Ordre : remplacer les imbriqués en partant de l'intérieur.
  // On boucle tant qu'il y a des balises (gère imbrication simple).
  let prev;
  do {
    prev = s;
    s = s
      .replace(/<strong>([^<]*)<\/strong>/gi, '**$1**')
      .replace(/<b>([^<]*)<\/b>/gi, '**$1**')
      .replace(/<em>([^<]*)<\/em>/gi, '*$1*')
      .replace(/<i>([^<]*)<\/i>/gi, '*$1*')
      .replace(/<u>([^<]*)<\/u>/gi, '__$1__')
      .replace(/<mark>([^<]*)<\/mark>/gi, '++$1++')
      .replace(/<s>([^<]*)<\/s>/gi, '~~$1~~')
      .replace(/<del>([^<]*)<\/del>/gi, '~~$1~~')
      .replace(/<strike>([^<]*)<\/strike>/gi, '~~$1~~')
      .replace(/<code>([^<]*)<\/code>/gi, '`$1`');
  } while (s !== prev);

  // Liens : on traite d'abord les embeds (data-embed="...") pour préserver le
  // round-trip ${youtube}[label](id) → <a data-embed=...> → ${youtube}...
  // Sinon le pattern générique <a> below les transformerait en lien plat.
  s = s.replace(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
    const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
    const href = hrefMatch ? hrefMatch[1] : '';
    const embedMatch = attrs.match(/\bdata-embed="(youtube|vimeo|dailymotion|frame)"/i);
    if (embedMatch && href) {
      const kind = embedMatch[1];
      let id = href;
      if (kind === 'youtube') {
        const m = href.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{11})/);
        if (m) id = m[1];
      } else if (kind === 'vimeo') {
        const m = href.match(/vimeo\.com\/(\d+)/);
        if (m) id = m[1];
      } else if (kind === 'dailymotion') {
        const m = href.match(/dailymotion\.com\/(?:video\/|embed\/video\/)([\w]+)/);
        if (m) id = m[1];
      }
      return `\${${kind}}[${cleanLabel || id}](${id})`;
    }
    return `[${cleanLabel || href}](${href})`;
  });

  // Images — on ignore les placeholders (data-placeholder="true") qui sont
  // des suggestions d'emplacement de l'IA, jamais publiées vers Crisp.
  s = s.replace(/<img\s+[^>]*>/gi, (m) => {
    if (/\bdata-placeholder="true"/i.test(m)) return '';
    if (/\bsrc="placeholder:/i.test(m)) return '';
    const src = (m.match(/\bsrc="([^"]+)"/i) || [])[1] || '';
    const alt = (m.match(/\balt="([^"]*)"/i) || [])[1] || '';
    const w = (m.match(/\bwidth="(\d+)"/i) || [])[1];
    return src ? `![${alt}](${src}${w ? ` =${w}xauto` : ''})` : '';
  });

  // <br> -> espace
  s = s.replace(/<br\s*\/?>/gi, '\n');

  return s;
}

function htmlToCrispMarkdown(html) {
  if (!html) return '';

  let s = html.replace(/\r\n?/g, '\n');

  // Code blocks <pre><code class="language-X">...</code></pre>
  s = s.replace(/<pre>\s*<code(?:\s+class="language-([^"]+)")?>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, lang, code) => {
    const decoded = code
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return `\n\`\`\`${lang || ''}\n${decoded}\n\`\`\`\n`;
  });

  // Headings
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    return `\n${'#'.repeat(Number(level))} ${_htmlInline(content).trim()}\n`;
  });

  // hr
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Listes (non imbriquées au lot 1 — Tiptap StarterKit gère le plat).
  // Tiptap enveloppe le contenu de chaque <li> dans <p>...</p> -> on aplatit
  // pour produire `1. Item` sur une seule ligne (sinon Crisp casse la liste).
  function _flattenListItem(html) {
    const flat = html
      .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
      .replace(/<\/?p[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return _htmlInline(flat).replace(/\s+/g, ' ').trim();
  }
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => `* ${_flattenListItem(m[1])}`);
    return '\n' + items.join('\n') + '\n';
  });
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m, idx) => `${idx + 1}. ${_flattenListItem(m[1])}`);
    return '\n' + items.join('\n') + '\n';
  });

  // Blockquote callouts (classes spécifiques).
  // Crisp exige que le texte soit sur la MÊME ligne que le préfixe `|`/`||`/`|||`.
  // Tiptap enveloppe systématiquement le contenu d'un blockquote dans un ou
  // plusieurs <p>...</p> -> on aplatit en remplaçant les balises <p> par des
  // espaces avant la conversion inline.
  function _flattenForCallout(html) {
    const flat = html
      .replace(/<\/p>\s*<p[^>]*>/gi, ' ') // joint les <p> consécutifs
      .replace(/<\/?p[^>]*>/gi, '')        // strip <p> isolés
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return _htmlInline(flat).replace(/\s+/g, ' ').trim();
  }
  s = s.replace(/<blockquote\s+class="callout-warning"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n||| ${_flattenForCallout(c)}\n`);
  s = s.replace(/<blockquote\s+class="callout-info"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n|| ${_flattenForCallout(c)}\n`);
  s = s.replace(/<blockquote\s+class="callout-tip"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n| ${_flattenForCallout(c)}\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n> ${_flattenForCallout(c)}\n`);

  // Tables : peu utilisé en Tiptap StarterKit, on ignore au lot 1 (passe-plat HTML brut).

  // Paragraphes
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n${_htmlInline(c).trim()}\n`);

  // Images block-level (Tiptap rend l'extension Image en `inline: false`,
  // donc les `<img>` ne sont PAS dans un `<p>` et ne passent jamais par
  // _htmlInline — il faut les convertir explicitement avant le strip général.
  s = s.replace(/<img\s+[^>]*>/gi, (m) => {
    if (/\bdata-placeholder="true"/i.test(m)) return '';
    if (/\bsrc="placeholder:/i.test(m)) return '';
    const src = (m.match(/\bsrc="([^"]+)"/i) || [])[1] || '';
    const alt = (m.match(/\balt="([^"]*)"/i) || [])[1] || '';
    const w = (m.match(/\bwidth="(\d+)"/i) || [])[1];
    return src ? `\n![${alt}](${src}${w ? ` =${w}xauto` : ''})\n` : '';
  });

  // Strip toutes balises résiduelles
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');

  // Decode entities encore présentes
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Compact : pas plus de 2 \n consécutifs, trim global
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s;
}

module.exports = { crispMarkdownToHtml, htmlToCrispMarkdown };
