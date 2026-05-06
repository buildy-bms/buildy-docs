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
      out.push(`<blockquote class="${callout.cls}">${_inline(callout.content)}</blockquote>`);
      i++;
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

    // Unordered list
    if (/^[*\-+]\s+/.test(trimmed)) {
      flushParagraph(para); para = [];
      const items = [];
      while (i < lines.length && /^\s*[*\-+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[*\-+]\s+/, ''));
        i++;
      }
      out.push('<ul>' + items.map((t) => `<li>${_inline(t)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(para); para = [];
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
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

  // Liens
  s = s.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
    return `[${cleanLabel || href}](${href})`;
  });

  // Images
  s = s.replace(/<img\s+[^>]*>/gi, (m) => {
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

  // Listes (non imbriquées au lot 1 — Tiptap StarterKit gère le plat)
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => `* ${_htmlInline(m[1]).trim()}`);
    return '\n' + items.join('\n') + '\n';
  });
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m, idx) => `${idx + 1}. ${_htmlInline(m[1]).trim()}`);
    return '\n' + items.join('\n') + '\n';
  });

  // Blockquote callouts (classes spécifiques)
  s = s.replace(/<blockquote\s+class="callout-warning"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n||| ${_htmlInline(c).trim()}\n`);
  s = s.replace(/<blockquote\s+class="callout-info"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n|| ${_htmlInline(c).trim()}\n`);
  s = s.replace(/<blockquote\s+class="callout-tip"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n| ${_htmlInline(c).trim()}\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n> ${_htmlInline(c).trim()}\n`);

  // Tables : peu utilisé en Tiptap StarterKit, on ignore au lot 1 (passe-plat HTML brut).

  // Paragraphes
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n${_htmlInline(c).trim()}\n`);

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
