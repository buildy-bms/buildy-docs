// Tests du convertisseur Crisp Markdown <-> HTML.
// Couvre les pièges documentés dans CLAUDE.md (callouts, listes, embeds,
// underline vs gras, surlignage) et le fix Sprint 3 (round-trip embed YouTube).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { crispMarkdownToHtml, htmlToCrispMarkdown } = require('../src/lib/crisp-markdown');

// Normalise les whitespaces pour comparer souplement (Crisp tolère les
// variations \n / espaces multiples au stockage).
function norm(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

describe('crispMarkdownToHtml — bases', () => {
  it('titres H1-H4', () => {
    const html = crispMarkdownToHtml('# T1\n\n## T2\n\n### T3\n\n#### T4');
    expect(html).toMatch(/<h1[^>]*>T1<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>T2<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>T3<\/h3>/);
    expect(html).toMatch(/<h4[^>]*>T4<\/h4>/);
  });

  it('gras et italique', () => {
    const html = crispMarkdownToHtml('**gras** et *ital*');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).toContain('<em>ital</em>');
  });

  it('underline __ (PAS gras — spécificité Crisp)', () => {
    const html = crispMarkdownToHtml('__souligné__');
    expect(html).toContain('<u>souligné</u>');
    expect(html).not.toContain('<strong>souligné</strong>');
  });

  it('surlignage ++', () => {
    const html = crispMarkdownToHtml('++jaune++');
    expect(html).toContain('<mark>jaune</mark>');
  });

  it('image avec largeur =800xauto', () => {
    const html = crispMarkdownToHtml('![alt](https://x.com/i.png =800xauto)');
    expect(html).toMatch(/<img\s+src="https:\/\/x\.com\/i\.png"[^>]*width="800"/);
  });
});

describe('crispMarkdownToHtml — callouts', () => {
  it('| → blockquote tip', () => {
    const html = crispMarkdownToHtml('| info utile');
    expect(html).toMatch(/<blockquote[^>]*class="callout-tip"[^>]*>.*info utile.*<\/blockquote>/s);
  });

  it('|| → blockquote info', () => {
    const html = crispMarkdownToHtml('|| à savoir');
    expect(html).toMatch(/<blockquote[^>]*class="callout-info"/);
  });

  it('||| → blockquote warning', () => {
    const html = crispMarkdownToHtml('||| attention');
    expect(html).toMatch(/<blockquote[^>]*class="callout-warning"/);
  });
});

describe('crispMarkdownToHtml — listes ordonnées renumérotées par Crisp', () => {
  it('1.\\n\\n1.\\n\\n1. → <ol> unique avec 3 items', () => {
    const md = '1. Premier\n\n1. Deuxième\n\n1. Troisième';
    const html = crispMarkdownToHtml(md);
    // Une seule ouverture <ol> et 3 <li>
    const olCount = (html.match(/<ol[^>]*>/g) || []).length;
    const liCount = (html.match(/<li[^>]*>/g) || []).length;
    expect(olCount).toBe(1);
    expect(liCount).toBe(3);
    expect(html).toContain('Premier');
    expect(html).toContain('Deuxième');
    expect(html).toContain('Troisième');
  });
});

describe('crispMarkdownToHtml — embeds vidéo', () => {
  it('${youtube}[label](id) → <a data-embed="youtube">', () => {
    const html = crispMarkdownToHtml('${youtube}[Vidéo démo](abc123XYZW0)');
    expect(html).toMatch(/<a[^>]*data-embed="youtube"/);
    expect(html).toMatch(/href="https:\/\/www\.youtube\.com\/watch\?v=abc123XYZW0"/);
    expect(html).toContain('Vidéo démo');
  });

  it('${vimeo}[label](id)', () => {
    const html = crispMarkdownToHtml('${vimeo}[Demo](123456)');
    expect(html).toMatch(/data-embed="vimeo"/);
    expect(html).toMatch(/href="https:\/\/vimeo\.com\/123456"/);
  });
});

describe('htmlToCrispMarkdown — round-trip embed YouTube (fix Sprint 3 / M14)', () => {
  it('${youtube}[L](id) → HTML → MD préserve la syntaxe embed (pas link plat)', () => {
    const md = '${youtube}[Demo](abc123XYZW0)';
    const html = crispMarkdownToHtml(md);
    const back = htmlToCrispMarkdown(html);
    // Doit retomber sur ${youtube}[Demo](abc123XYZW0), PAS [Demo](https://...)
    expect(back).toContain('${youtube}');
    expect(back).toContain('abc123XYZW0');
    expect(back).not.toMatch(/^\[Demo\]\(https/);
  });

  it('lien interne classique reste un link plat (pas embed)', () => {
    const html = '<p><a href="/fr/article/foo">Guide complet</a></p>';
    const md = htmlToCrispMarkdown(html);
    expect(md).toContain('[Guide complet](/fr/article/foo)');
    expect(md).not.toContain('${');
  });
});

describe('htmlToCrispMarkdown — Tiptap <p> dans blockquote / li (CLAUDE.md piège #1)', () => {
  it('callout avec <p> imbriqué : aplatit pour produire | texte sur 1 ligne', () => {
    const html = '<blockquote class="callout-tip"><p>Mon astuce</p></blockquote>';
    const md = htmlToCrispMarkdown(html);
    // Doit produire "| Mon astuce" sur la même ligne (pas "|\nMon astuce")
    expect(md).toMatch(/\|\s*Mon astuce/);
    expect(md).not.toMatch(/\|\s*\n\s*Mon astuce/);
  });

  it('liste numérotée avec <p> dans <li>', () => {
    const html = '<ol><li><p>Étape 1</p></li><li><p>Étape 2</p></li></ol>';
    const md = htmlToCrispMarkdown(html);
    expect(md).toMatch(/1\.\s*Étape 1/);
    expect(md).toMatch(/Étape 2/);
  });
});

describe('htmlToCrispMarkdown — placeholders ignorés', () => {
  it('image avec data-placeholder="true" → omise', () => {
    const html = '<p><img data-placeholder="true" alt="Capture à venir"></p>';
    const md = htmlToCrispMarkdown(html);
    expect(md).not.toContain('![');
    expect(md).not.toContain('placeholder');
  });

  it('image normale dans un <p> → conservée avec syntaxe MD', () => {
    const html = '<p><img src="https://x.com/i.png" alt="x" width="500"></p>';
    const md = htmlToCrispMarkdown(html);
    expect(md).toContain('![x](https://x.com/i.png =500xauto)');
  });

  it('image block-level (Tiptap inline:false, hors <p>) → conservée', () => {
    // Reproduit le bug observé sur article 39 : Tiptap rend l'extension Image
    // en inline:false donc <img> est un sibling des <p>, pas un enfant.
    // Sans handler block-level, le strip général dégageait l'image.
    const html = '<p>Avant</p><img src="https://x.com/i.png" alt="x" width="320"><p>Après</p>';
    const md = htmlToCrispMarkdown(html);
    expect(md).toContain('![x](https://x.com/i.png =320xauto)');
  });

  it('image block-level sans width → markdown sans dimension', () => {
    const html = '<p>Avant</p><img src="https://x.com/i.png" alt="x"><p>Après</p>';
    const md = htmlToCrispMarkdown(html);
    expect(md).toContain('![x](https://x.com/i.png)');
    expect(md).not.toContain('=xauto');
  });
});

describe('round-trip général (sanity check)', () => {
  it('paragraphe simple : MD → HTML → MD ≈ MD', () => {
    const md = 'Un paragraphe avec **gras** et *italique*.';
    const back = htmlToCrispMarkdown(crispMarkdownToHtml(md));
    expect(norm(back)).toContain('**gras**');
    expect(norm(back)).toContain('*italique*');
  });

  it('underline __ et surlignage ++', () => {
    const md = '__souligné__ et ++marqué++';
    const back = htmlToCrispMarkdown(crispMarkdownToHtml(md));
    expect(norm(back)).toContain('__souligné__');
    expect(norm(back)).toContain('++marqué++');
  });
});
