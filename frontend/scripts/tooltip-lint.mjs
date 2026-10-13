#!/usr/bin/env node
/**
 * tooltip-lint — garde-fou des infobulles de Buildy Docs (2026-10-12).
 *
 * Lit VRAIMENT les gabarits Vue (@vue/compiler-sfc) et les expressions des bulles
 * (@babel/parser) pour prouver que TOUTES les infobulles suivent le système unique v-tooltip
 * (lib/tooltip.js) et les règles de rédaction (CLAUDE.md § « Infobulles (UI) ») :
 *   html-title            title= natif (lent, gris, invisible au doigt) → v-tooltip
 *   iframe-title          une <iframe> doit garder title= (nom accessible)
 *   component-title-prop  v-tooltip posé à la place de la propriété « title » d'un composant
 *   tip-on-fragment       v-tooltip sur un composant sans élément racine unique (ignoré par Vue)
 *   old-tooltip           ancien mécanisme (v-truncate-tooltip, tooltip-directive, bulle faite main)
 *   icon-button-no-tip    bouton / lien à icône seule sans infobulle ni aria-label
 *   truncate-no-tip       texte coupé (truncate, line-clamp) sans bulle .overflow
 *   tip-copy              rédaction : « (s) », « Cliquer pour », vouvoiement, article du décret
 *                         dans le texte, anglais, « ... », retour à la ligne dans une étiquette,
 *                         étiquette > 90 caractères
 *   tip-raw-data          donnée brute sans libellé (date, nombre, clé interne)
 * Avertissements (non bloquants) : disabled-tip-on-control (bulle sur un bouton grisé : à
 * porter par <Tooltip>), tip-long-label (étiquette > 40 caractères).
 *
 * Usage :
 *   node scripts/tooltip-lint.mjs                    # toute l'app (src/)
 *   node scripts/tooltip-lint.mjs --files            # + détail par fichier
 *   node scripts/tooltip-lint.mjs --list             # + chaque signalement (fichier:ligne)
 *   node scripts/tooltip-lint.mjs --strict [cibles]  # code 1 s'il reste une erreur
 *   node scripts/tooltip-lint.mjs --only=html-title,tip-copy src/components/audit
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@vue/compiler-sfc');
const { parseExpression } = require(require.resolve('@babel/parser', { paths: [require.resolve('@vue/compiler-sfc')] }));

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Fichiers qui DÉFINISSENT le système (exclus des règles de structure).
const SYSTEM_FILES = [
  'src/components/tooltip/TooltipHost.vue',
  'src/components/tooltip/TipLabel.vue',
  'src/components/tooltip/TipCard.vue',
  'src/components/R175Tooltip.vue',
  'src/components/Tooltip.vue',
  'src/views/StyleGuideView.vue',
];

export const RULES = {
  'html-title': { level: 'error', desc: 'title= natif → v-tooltip' },
  'iframe-title': { level: 'error', desc: '<iframe> sans title= (nom accessible)' },
  'component-title-prop': { level: 'error', desc: 'v-tooltip à la place de la propriété « title » du composant' },
  'tip-on-fragment': { level: 'error', desc: 'v-tooltip sur un composant sans racine unique' },
  'old-tooltip': { level: 'error', desc: 'ancien mécanisme d’infobulle' },
  'icon-button-no-tip': { level: 'error', desc: 'bouton à icône seule sans infobulle ni aria-label' },
  'truncate-no-tip': { level: 'error', desc: 'texte coupé sans bulle .overflow' },
  'tip-copy': { level: 'error', desc: 'rédaction de la bulle (cf. CLAUDE.md § Infobulles)' },
  'tip-raw-data': { level: 'error', desc: 'donnée brute sans libellé' },
  'disabled-tip-on-control': { level: 'warning', desc: 'bulle sur un contrôle grisable → l’envelopper dans <Tooltip>' },
  'tip-long-label': { level: 'warning', desc: 'étiquette > 40 caractères (viser court)' },
};

// ── Rédaction ──────────────────────────────────────────────────────────────────────────────
// Mots anglais ou internes à proscrire dans une bulle (→ équivalent français).
const ENGLISH = [
  'snapshot', 'sync', 'override', 'overrides', 'credential', 'credentials', 'chiller', 'process', 'firmware',
  'datasheet', 'datasheets', 'template', 'templates', 'add-on', 'container', 'pull', 'push', 'outdent', 'indent',
  'toggle', 'checkbox', 'dropdown', 'tooltip', 'drag', 'drop', 'upload', 'download', 'click', 'refresh', 'reset',
  'item', 'items', 'draft', 'preview', 'workflow', 'setting', 'settings', 'default', 'tag', 'tags', 'badge', 'bulk',
  'slug', 'baseline', 'polling', 'wizard', 'plc', 'io', 'decoy', 'pii', 'ocr', 'puppeteer', 'html', 'git', 'api key',
];
const ENGLISH_RE = new RegExp(`(^|[^\\p{L}-])(${ENGLISH.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})(?=$|[^\\p{L}-])`, 'iu');

/**
 * Règles de rédaction d'un texte affiché dans une bulle.
 * @param {string} text
 * @param {{ label?: boolean }} [opts]  label = étiquette (texte court, une ligne)
 * @returns {string[]} problèmes (vide = conforme)
 */
export function checkCopy(text, { label = false } = {}) {
  const t = String(text ?? '');
  const out = [];
  if (!t.trim()) return out;
  // Texte cité entre « » (nom, titre saisi, libellé d'un bouton) : repris tel quel, hors des
  // règles de voix (tutoiement, anglais) qui portent sur le texte de l'application.
  const own = t.replace(/«[^«»]*»/g, '« »');
  if (/\((e?)s\)|\(x\)|\(es\)/i.test(t)) out.push('« (s) » → plural()');
  if (/\bcliqu(er|ez|e)\s+(pour|ici)\b/i.test(t)) out.push('« Cliquer pour… » → verbe d’action');
  if (/(^|[^\p{L}])(vous|votre|vos)(?=$|[^\p{L}])/iu.test(own) || /(^|[.!?:;]\s+)(?!Chez|Assez|Hyperveez)\p{Lu}\p{Ll}+ez(?=$|[^\p{L}])/u.test(own)) {
    out.push('vouvoiement → tutoiement');
  }
  if (/\bR\s?175\b|\bR\.\s?175\b|(^|[^\p{L}])P[1-4](?=$|[^\p{L}\d])/u.test(t)) out.push('article du décret dans le texte → en clair (article en pied : `article`)');
  const en = t.match(ENGLISH_RE);
  if (en) out.push(`anglais / interne : « ${en[2]} »`);
  if (/\.\.\./.test(t)) out.push('« ... » → « … »');
  if (label && /\n/.test(t)) out.push('retour à la ligne dans une étiquette → carte');
  if (label && t.length > 90) out.push(`étiquette de ${t.length} caractères → carte`);
  if (/\b[a-z]+_[a-z_]+\b/.test(t) && !/https?:/.test(t)) out.push('clé interne (snake_case)');
  return out;
}

// ── Expressions : textes affichés d'une valeur de bulle ────────────────────────────────────
const SKIP_KEYS = new Set(['meta', 'article', 'placement', 'icon', 'tone', 'accent', 'keys', 'variant', 'wide', 'mono', 'layout']);

/** Textes affichés d'une expression v-tooltip : [{ text, label, key }] (key = clé d'objet). */
export function shownStrings(exp) {
  let ast;
  try {
    ast = parseExpression(exp, { plugins: ['typescript'] });
  } catch {
    return [];
  }
  const out = [];
  const isCard = (node) =>
    node?.type === 'ObjectExpression' && node.properties.some((p) => (p.key?.name || p.key?.value) === 'title');
  function walk(node, key, inCard) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, key, inCard));
    switch (node.type) {
      case 'StringLiteral':
        out.push({ text: node.value, label: !inCard && (!key || key === 'label' || key === 'text'), key });
        return;
      case 'TemplateLiteral':
        out.push({ text: node.quasis.map((q) => q.value.cooked).join('…'), label: !inCard && (!key || key === 'label' || key === 'text'), key });
        node.expressions.forEach((e) => walk(e, key, inCard));
        return;
      case 'ObjectExpression': {
        const card = inCard || isCard(node);
        for (const p of node.properties) {
          const k = p.key?.name || p.key?.value;
          if (k && SKIP_KEYS.has(k)) continue;
          walk(p.value ?? p.argument, k ?? key, card);
        }
        return;
      }
      case 'CallExpression':
        // Arguments d'appel (clés, formats) : seules les chaînes passées à plural() s'affichent.
        if (node.callee?.name === 'plural') node.arguments.slice(1).forEach((a) => walk(a, key, inCard));
        else node.arguments.forEach((a) => (a.type === 'StringLiteral' || a.type === 'TemplateLiteral' ? null : walk(a, key, inCard)));
        return;
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        return;
      case 'BinaryExpression':
        if (['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'].includes(node.operator)) return;
        walk(node.left, key, inCard);
        walk(node.right, key, inCard);
        return;
      default:
        for (const [k, v] of Object.entries(node)) {
          if (['type', 'start', 'end', 'loc', 'range', 'extra', 'leadingComments', 'trailingComments', 'test'].includes(k)) continue;
          if (v && typeof v === 'object') walk(v, key, inCard);
        }
    }
  }
  walk(ast, null, false);
  return out;
}

const CONTENT_NAME_RE = /(tip|title|detail|label|help|hint|description|name|reason|note|text|message|caption|summary|statusof|card)/i;

function isRawData(exp) {
  const v = exp.trim();
  if (/^['"`]/.test(v) && /[A-Za-zÀ-ÿ]{3,}/.test(v)) return false; // texte écrit
  if (/^\{/.test(v) || /^\(\s*\)\s*=>/.test(v)) return false; // objet ou fonction
  if (/'[^']*[A-Za-zÀ-ÿ]{3,}[^']*'|`[^`]*[A-Za-zÀ-ÿ]{3,}[^`]*`/.test(v)) return false; // mélange avec du texte
  if (/toLocale\w*String|JSON\.stringify|\bString\(/.test(v)) return true;
  return !CONTENT_NAME_RE.test(v);
}

// ── Composants de l'application (propriétés, racine) ───────────────────────────────────────
let componentIndex = null;
function indexComponents() {
  if (componentIndex) return componentIndex;
  componentIndex = new Map();
  for (const f of walk(SRC)) {
    if (!f.endsWith('.vue')) continue;
    componentIndex.set(basename(f, '.vue'), f);
  }
  return componentIndex;
}
const componentInfoCache = new Map();
function componentInfo(name) {
  const pascal = name.includes('-') ? name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()) : name;
  const file = indexComponents().get(pascal);
  if (!file) return null;
  if (componentInfoCache.has(file)) return componentInfoCache.get(file);
  const src = readFileSync(file, 'utf8');
  const { descriptor } = parse(src, { filename: file });
  const script = (descriptor.scriptSetup?.content || '') + (descriptor.script?.content || '');
  const propsBlock = script.match(/defineProps\s*\(\s*([\s\S]*?)\)\s*(\n|;|$)/)?.[1] || script.match(/props\s*:\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/)?.[1] || '';
  const hasTitleProp = /(^|[\s{,[])['"]?title['"]?\s*[:,\]]/.test(propsBlock);
  const roots = (descriptor.template?.ast?.children || []).filter((c) => c.type !== 3 && !(c.type === 2 && !c.content.trim()));
  const fragment = roots.length !== 1 || (roots[0].type === 1 && roots[0].tag === 'Teleport');
  const info = { file, hasTitleProp, fragment };
  componentInfoCache.set(file, info);
  return info;
}

// ── Gabarit ────────────────────────────────────────────────────────────────────────────────
const ICON_COMPONENT_RE = /(Icon|^FontAwesomeIcon$|^font-awesome-icon$|^EquipmentIcon$|^SystemCategoryIcon$)$/;
const SYMBOL_ONLY_RE = /^[\s✓✗×✕✔✖⋯…↑↓←→↗↘⇪⟳↻+−\-–—·•|/\\*#%€?!:;.,()[\]{}<>=~^°ⓘ⚠]*$/u;
const ACTIONABLE = new Set(['button', 'a', 'router-link', 'RouterLink']);
const TRUNCATE_RE = /(^|\s)(truncate|text-ellipsis|line-clamp-\d+)(\s|$)/;

function propOf(node, name) {
  return node.props.find((p) => p.type === 6 && p.name === name);
}
function bindOf(node, name) {
  return node.props.find((p) => p.type === 7 && p.name === 'bind' && p.arg?.content === name);
}
function directiveOf(node, name) {
  return node.props.find((p) => p.type === 7 && p.name === name);
}
function modsOf(dir) {
  return (dir?.modifiers || []).map((m) => (typeof m === 'string' ? m : m.content));
}
function hasAttr(node, name) {
  return !!(propOf(node, name) || bindOf(node, name));
}
function classText(node) {
  const s = propOf(node, 'class')?.value?.content || '';
  const b = bindOf(node, 'class')?.exp?.content || '';
  return `${s} ${b}`;
}

/** L'élément contient-il du texte lisible (pas seulement des icônes / symboles) ? */
function hasReadableContent(node) {
  for (const c of node.children || []) {
    if (c.type === 2 && !SYMBOL_ONLY_RE.test(c.content)) return true; // texte
    if (c.type === 5 || c.type === 8 || c.type === 12) return true; // {{ }} interpolation
    if (c.type === 9) {
      if (c.branches.some((b) => hasReadableContent(b))) return true;
      continue;
    }
    if (c.type === 11 && hasReadableContent(c)) return true;
    if (c.type !== 1) continue;
    if (c.tagType === 2) return true; // <slot> : contenu fourni par l'appelant
    if (directiveOf(c, 'html') || directiveOf(c, 'text')) return true;
    if (c.tagType === 1) {
      if (ICON_COMPONENT_RE.test(c.tag)) continue; // icône
      return true; // composant inconnu : peut porter un libellé
    }
    if (c.tag === 'svg' || c.tag === 'i') continue;
    if (c.tag === 'img') {
      if ((propOf(c, 'alt')?.value?.content || '').trim() || bindOf(c, 'alt')) return true;
      continue;
    }
    if (c.tag === 'span' && /\bsr-only\b/.test(classText(c))) return true;
    if (hasReadableContent(c)) return true;
  }
  return false;
}

/**
 * Analyse un fichier .vue.
 * @returns {Array<{ rule:string, line:number, text:string }>}
 */
export function lintVue(src, file = 'file.vue') {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const hits = [];
  const push = (rule, line, text) => hits.push({ rule, line, text: String(text).slice(0, 140) });
  const isSystem = SYSTEM_FILES.some((s) => rel.endsWith(s));

  // Script : anciens mécanismes
  src.split('\n').forEach((l, i) => {
    if (/tooltip-directive/.test(l)) push('old-tooltip', i + 1, l.trim());
    if (/\b(showTooltip|hideTooltip)\s*\(|useCursorTooltip/.test(l)) push('old-tooltip', i + 1, l.trim());
  });

  let descriptor;
  try {
    ({ descriptor } = parse(src, { filename: file }));
  } catch {
    return hits;
  }
  const root = descriptor.template?.ast;
  if (!root) return hits;
  const heroicons = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@heroicons\/vue[^'"]*['"]/g)) {
    for (const n of m[1].split(',')) {
      const name = n.trim().split(/\s+as\s+/).pop();
      if (name) heroicons.add(name);
    }
  }

  function checkTipExpression(exp, line, { mods = [], viaComponent = false } = {}) {
    if (!exp) return;
    if (!mods.includes('overflow') && isRawData(exp)) push('tip-raw-data', line, exp);
    for (const s of shownStrings(exp)) {
      for (const problem of checkCopy(s.text, { label: s.label })) push('tip-copy', line, `${problem} — « ${s.text.slice(0, 80)} »`);
      if (s.label && s.text.length > 40 && s.text.length <= 90) push('tip-long-label', line, s.text);
    }
    void viaComponent;
  }

  function visit(node, ancestors) {
    if (node.type === 9) return node.branches.forEach((b) => visit(b, ancestors));
    if (node.type === 10 || node.type === 11) return (node.children || []).forEach((c) => visit(c, ancestors));
    if (node.type !== 1) return;
    const line = node.loc.start.line;
    const tip = directiveOf(node, 'tooltip');
    const isComponent = node.tagType === 1;
    const passThrough = isComponent && (['RouterLink', 'router-link', 'FontAwesomeIcon', 'font-awesome-icon'].includes(node.tag) || heroicons.has(node.tag));

    if (directiveOf(node, 'truncate-tooltip')) push('old-tooltip', line, 'v-truncate-tooltip');
    if (!isSystem && (propOf(node, 'role')?.value?.content === 'tooltip')) push('old-tooltip', line, 'role="tooltip" fait main');

    // title=
    const title = propOf(node, 'title') || bindOf(node, 'title');
    if (node.tag === 'iframe') {
      if (!title) push('iframe-title', line, '<iframe> sans title');
    } else if (title && (node.tagType === 0 || passThrough)) {
      const exempt = node.tag === 'abbr' || node.tag === 'option' || (node.tag === 'input' && hasAttr(node, 'pattern'));
      if (!exempt) push('html-title', line, `title : ${title.value?.content ?? title.exp?.content ?? ''}`);
    } else if (title && isComponent) {
      const info = componentInfo(node.tag);
      if (info && !info.hasTitleProp) push('html-title', line, `title transmis tel quel à <${node.tag}> (pas de propriété title) → :tooltip ou v-tooltip`);
    }

    if (tip) {
      if (isComponent && !passThrough) {
        const info = componentInfo(node.tag);
        if (info?.hasTitleProp && !title) push('component-title-prop', line, `<${node.tag} v-tooltip> : sa propriété « title » attend ce texte`);
        else if (info?.fragment) push('tip-on-fragment', line, `<${node.tag}> n’a pas d’élément racine unique`);
      }
      if (!isSystem) checkTipExpression(tip.exp?.content, line, { mods: modsOf(tip) });
      const disabledBound = hasAttr(node, 'disabled');
      if (disabledBound && ['button', 'input', 'select', 'textarea'].includes(node.tag)) {
        push('disabled-tip-on-control', line, `<${node.tag} :disabled v-tooltip>`);
      }
    }
    // Textes des bulles passées en propriété (<Tooltip text>, SegmentedToggle tooltip)
    if (isComponent && !isSystem) {
      for (const name of ['text', 'tooltip']) {
        if (node.tag !== 'Tooltip' && name === 'text') continue;
        const p = propOf(node, name);
        const b = bindOf(node, name);
        if (p?.value?.content) {
          for (const problem of checkCopy(p.value.content, { label: true })) push('tip-copy', line, `${problem} — « ${p.value.content.slice(0, 80)} »`);
        } else if (b?.exp?.content) {
          checkTipExpression(b.exp.content, line);
        }
      }
    }

    // Bouton à icône seule
    const tagName = node.tag;
    const roleButton = propOf(node, 'role')?.value?.content === 'button';
    if (!isSystem && (ACTIONABLE.has(tagName) || roleButton) && !tip && !hasAttr(node, 'aria-label') && !hasAttr(node, 'aria-labelledby') && !hasAttr(node, 'title')) {
      const wrapped = ancestors.some((a) => a.tag === 'Tooltip' && (hasAttr(a, 'text')));
      if (!wrapped && !hasReadableContent(node)) push('icon-button-no-tip', line, `<${tagName}> à icône seule`);
    }

    // Texte coupé
    if (!isSystem && TRUNCATE_RE.test(classText(node)) && node.tagType === 0) {
      const near = [node, ...ancestors.slice(-2)];
      const covered = near.some((n) => directiveOf(n, 'tooltip') || (n.tag === 'Tooltip' && hasAttr(n, 'text')));
      const isFormField = ['input', 'select', 'textarea'].includes(node.tag);
      if (!covered && !isFormField) push('truncate-no-tip', line, `<${node.tag} class="${classText(node).trim().slice(0, 60)}">`);
    }

    const next = [...ancestors, node];
    for (const c of node.children || []) visit(c, next);
  }
  for (const c of root.children) visit(c, []);
  return hits;
}

/** Analyse un module .js (lib/, composables/) : anciens mécanismes seulement. */
export function lintJs(src) {
  const hits = [];
  src.split('\n').forEach((l, i) => {
    if (/from ['"].*tooltip-directive['"]/.test(l)) hits.push({ rule: 'old-tooltip', line: i + 1, text: l.trim() });
  });
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(vue|js)$/.test(name)) out.push(p);
  }
  return out;
}

/** Analyse une liste de fichiers ; renvoie les signalements par règle. */
export function lintFiles(files) {
  const results = Object.fromEntries(Object.keys(RULES).map((r) => [r, []]));
  for (const file of files) {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (rel.endsWith('lib/tooltip-directive.js')) continue;
    const hits = file.endsWith('.vue') ? lintVue(src, file) : lintJs(src);
    for (const h of hits) results[h.rule]?.push({ rel, ...h });
  }
  return results;
}

export function collectFiles(targets = []) {
  if (!targets.length) return walk(SRC);
  const out = [];
  for (const t of targets) {
    const p = t.startsWith('/') ? t : join(ROOT, t);
    try {
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    } catch {
      /* cible absente */
    }
  }
  return out;
}

// ── Ligne de commande ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const showFiles = args.includes('--files');
  const showList = args.includes('--list');
  const strict = args.includes('--strict');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
  const targets = args.filter((a) => !a.startsWith('--'));
  const files = collectFiles(targets);
  const results = lintFiles(files);
  let errors = 0;
  let warnings = 0;
  console.log('\n  tooltip-lint — infobulles de Buildy Docs\n  ' + '─'.repeat(60));
  for (const [id, rule] of Object.entries(RULES)) {
    if (only && !only.has(id)) continue;
    const hits = results[id];
    if (rule.level === 'error') errors += hits.length;
    else warnings += hits.length;
    const mark = hits.length === 0 ? '   ✓' : String(hits.length).padStart(4);
    console.log(`  ${mark}  ${id.padEnd(24)} ${rule.level === 'warning' ? '(avert.) ' : ''}${rule.desc}`);
    if ((showFiles || showList) && hits.length) {
      if (showList) {
        for (const h of hits) console.log(`         ${h.rel}:${h.line}  ${h.text}`);
      } else {
        const byFile = {};
        for (const h of hits) byFile[h.rel] = (byFile[h.rel] || 0) + 1;
        Object.entries(byFile)
          .sort((a, b) => b[1] - a[1])
          .forEach(([f, n]) => console.log(`         ${String(n).padStart(4)}  ${f}`));
      }
    }
  }
  console.log('  ' + '─'.repeat(60));
  console.log(`  ${errors} erreur(s), ${warnings} avertissement(s) sur ${files.length} fichier(s)\n`);
  if (strict && errors > 0) {
    console.error('  ✗ --strict : il reste des erreurs.\n');
    process.exit(1);
  }
}
