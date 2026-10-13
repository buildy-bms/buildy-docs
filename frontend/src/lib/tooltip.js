// Infobulles de Buildy Docs (2026-10-12, porté de Buildy Tools) : directive v-tooltip GLOBALE +
// une seule infobulle rendue par components/tooltip/TooltipHost.vue (montée une fois dans App.vue,
// chargée au premier survol ou au repos).
//
//   <button v-tooltip="'Supprimer ce compteur'">                     étiquette
//   <span v-tooltip="{ label: 'Gras', keys: ['Mod','B'] }">            étiquette + raccourci
//   <span v-tooltip="{ title, text, tone, accent, rows, todo, article }">  carte d'explication
//   <span v-tooltip="() => meterTip(m)">                               évaluée au survol
//   <span class="truncate" v-tooltip.overflow>{{ nom }}</span>         texte complet s'il est coupé
// Modificateurs : .right .bottom .left (côté préféré), .keep (reste après un clic), .touch
// (s'ouvre au doigt), .overflow (seulement si le texte est coupé ; sans valeur = texte visible).
//
// Écouteurs posés UNE fois sur document : la directive ne fait que ranger sa valeur sur
// l'élément. Une seule infobulle à la fois, ouverte quand le pointeur se pose (400 ms, puis
// sans délai d'un élément au voisin : tooltip-timing.js) ; un ⓘ touché ou cliqué répond tout
// de suite. Une ancre sans contenu est transparente (la bulle de l'élément parent s'affiche).
// Un bouton grisé ne reçoit pas le survol : sa bulle est portée par une enveloppe <Tooltip>
// (data-tip-wrap, cf. main.css).

import { shallowReactive, markRaw, ref } from 'vue';
import { normalizeTip, labelVariant, ariaKeys } from './tooltip-content.js';
import { tooltipOpenDelay, TOOLTIP_SKIP_DELAY } from './tooltip-timing.js';

export const TOOLTIP_ID = 'bd-tooltip';

export const tooltipState = shallowReactive({
  anchor: null, // élément survolé (markRaw)
  value: null, // valeur brute du v-tooltip (texte, objet ou fonction)
  placement: 'top',
  variant: null, // étiquette : 'action' ou 'info' (choisit l'icône par défaut)
  via: null, // 'hover' | 'focus' | 'touch'
  pointer: null, // position du pointeur à l'entrée sur l'ancre { x, y }
  version: 0, // incrémenté à chaque mise à jour de la valeur (relance le placement)
  instant: false, // dernière fermeture sans fondu (défilement, changement de page…)
});

// TooltipHost (et ses icônes) est chargé en différé : au premier survol, ou au repos.
export const tooltipHostWanted = ref(false);

let suppressed = null; // ancre cliquée ou fermée par Échap : rien jusqu'à ce que le pointeur la quitte
let lastPointerDown = 0;
let pending = null; // bulle en attente de son délai : { el, via, timer }
let warmUntil = 0; // jusqu'à quand la bulle suivante s'ouvre sans délai (passage d'un élément au voisin)
let lastPoint = null; // dernière position du pointeur pendant l'attente (la bulle se cale dessus)

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function placementOf(mods = {}) {
  if (mods.right) return 'right';
  if (mods.bottom) return 'bottom';
  if (mods.left) return 'left';
  return 'top';
}

const INTERACTIVE = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]';
const ACTION_SELECTOR =
  'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="option"]';
const ANCHOR_SELECTOR = '[data-tooltip], [data-tooltip-off]';
const TRUNCATE_SELECTOR = '.truncate, .text-ellipsis, [class*="line-clamp-"]';

// ── Texte coupé (.overflow) ──
let measureCtx = null;
function inputOverflows(el) {
  const text = el.value || el.placeholder || '';
  if (!text) return false;
  try {
    measureCtx ||= document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(el);
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    return measureCtx.measureText(text).width > room + 1;
  } catch {
    return el.scrollWidth > el.clientWidth + 1;
  }
}
function overflowTarget(el) {
  if (el.matches?.(TRUNCATE_SELECTOR)) return el;
  return el.querySelector?.(TRUNCATE_SELECTOR) || el;
}
/** Le texte de l'élément est-il coupé (… ou lignes masquées) ? */
export function isTruncated(el) {
  if (el.tagName === 'INPUT') return inputOverflows(el);
  if (el.tagName === 'TEXTAREA') return el.scrollHeight > el.clientHeight + 1;
  const t = overflowTarget(el);
  const cls = typeof t.className === 'string' ? t.className : '';
  if (/line-clamp-/.test(cls)) return t.scrollHeight > t.clientHeight + 1;
  return t.scrollWidth > t.clientWidth + 1;
}
function overflowText(el) {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return (el.value || el.placeholder || '').trim();
  const t = overflowTarget(el);
  return (t.innerText || t.textContent || '').replace(/\s+/g, ' ').trim();
}

// Valeur à afficher pour l'ancre (null = rien) : .overflow sans valeur → texte visible.
function rawValueOf(el) {
  const mods = el.__vtipMods || {};
  const v = el.__vtip;
  if (mods.overflow) {
    if (!isTruncated(el)) return null;
    return v == null || v === true || v === '' ? overflowText(el) : v;
  }
  return v;
}
function tipOf(el) {
  return normalizeTip(rawValueOf(el));
}

/** Ancre effective sous le pointeur : la plus proche qui a un contenu (une ancre vide est
 *  transparente), sauf zone marquée data-tooltip-off (ⓘ du décret) ou ancre fermée à l'instant. */
function resolveAnchor(node) {
  let el = node && node.closest ? node.closest(ANCHOR_SELECTOR) : null;
  while (el) {
    if (el.hasAttribute('data-tooltip-off') || el === suppressed) return null;
    if (tipOf(el)) return el;
    el = el.parentElement ? el.parentElement.closest(ANCHOR_SELECTOR) : null;
  }
  return null;
}

// Enveloppe d'un bouton (data-tip-wrap) : c'est le bouton qui porte le nom accessible.
function describedTarget(el) {
  if (el && el.hasAttribute && el.hasAttribute('data-tip-wrap')) return el.querySelector(ACTION_SELECTOR) || el;
  return el;
}

function setDescribedBy(el, on) {
  if (!el) return;
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  const has = ids.includes(TOOLTIP_ID);
  if (on && !has) ids.push(TOOLTIP_ID);
  if (!on && has) ids.splice(ids.indexOf(TOOLTIP_ID), 1);
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

// Pas de double lecture : une étiquette identique au nom ou au texte de l'élément n'est pas
// annoncée une seconde fois.
function isRedundant(target, tip) {
  if (!target || tip.kind !== 'label') return false;
  const name = (target.getAttribute('aria-label') || target.textContent || '').replace(/\s+/g, ' ').trim();
  return !!name && name === tip.label;
}

function variantOf(el, tip, mods) {
  const target = el.closest(ACTION_SELECTOR) || (el.hasAttribute('data-tip-wrap') && el.querySelector(ACTION_SELECTOR)) || el;
  return labelVariant({
    tag: target.tagName,
    role: target.getAttribute('role'),
    clickable: !!el.closest('.cursor-pointer'),
    disabled: !!target.disabled || target.getAttribute('aria-disabled') === 'true',
    hasKeys: tip.keys.length > 0,
    explicit: tip.variant || (mods.info ? 'info' : mods.action ? 'action' : null),
  });
}

function cancelPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}

/** Ouvre la bulle de el après le délai d'usage : tout de suite si une bulle est ouverte, vient
 *  de se fermer, ou si la demande est explicite (toucher, clic sur un ⓘ). */
function requestTip(el, via, pointer = null) {
  cancelPending();
  const delay = tooltipOpenDelay({ via, visible: !!tooltipState.anchor, now: Date.now(), warmUntil });
  if (!delay) return showTip(el, via, pointer);
  tooltipHostWanted.value = true; // la bulle se charge pendant l'attente
  lastPoint = pointer;
  pending = {
    el,
    via,
    timer: setTimeout(() => {
      const p = pending;
      pending = null;
      if (p && p.el.isConnected && p.el !== suppressed) showTip(p.el, p.via, p.via === 'hover' ? lastPoint : null);
    }, delay),
  };
}

export function showTip(el, via = 'hover', pointer = null) {
  cancelPending();
  if (!el || !el.isConnected) return;
  const tip = el === suppressed ? null : tipOf(el);
  if (!tip) {
    // Rien à montrer ici : l'infobulle d'un élément voisin ne doit pas rester affichée.
    if (tooltipState.anchor && tooltipState.anchor !== el) hideTip();
    return;
  }
  tooltipHostWanted.value = true;
  if (tooltipState.anchor && tooltipState.anchor !== el) setDescribedBy(describedTarget(tooltipState.anchor), false);
  const mods = el.__vtipMods || {};
  tooltipState.anchor = markRaw(el);
  tooltipState.value = rawValueOf(el);
  tooltipState.placement = tip.placement || placementOf(mods);
  tooltipState.variant = tip.kind === 'label' ? variantOf(el, tip, mods) : null;
  tooltipState.via = via;
  tooltipState.pointer = pointer;
  tooltipState.instant = false;
  tooltipState.version++;
  const target = describedTarget(el);
  // L'étiquette d'un bouton à icône est déjà son nom accessible ; un texte coupé est déjà lu.
  if (!el.__vtipAutoAria && !mods.overflow && !isRedundant(target, tip)) setDescribedBy(target, true);
}

/** Ferme la bulle (et annule celle en attente), avec un fondu de sortie (TooltipHost).
 *  { warm: true } : le pointeur ou le focus vient de quitter l'élément, la bulle du voisin
 *  s'ouvrira sans délai. { instant: true } : sans fondu (défilement, changement de page… : une
 *  bulle qui s'efface loin de son élément paraîtrait flotter). */
export function hideTip(opts) {
  cancelPending();
  if (!tooltipState.anchor) return;
  setDescribedBy(describedTarget(tooltipState.anchor), false);
  tooltipState.instant = !!(opts && opts.instant === true);
  tooltipState.anchor = null;
  tooltipState.value = null;
  tooltipState.via = null;
  tooltipState.pointer = null;
  if (opts && opts.warm === true) warmUntil = Date.now() + TOOLTIP_SKIP_DELAY;
}

/** Une bulle est ouverte ou vient de se fermer : la suivante s'ouvre sans délai (fiche du décret). */
export function tooltipWarm() {
  return !!tooltipState.anchor || Date.now() < warmUntil;
}

/** Valeur modifiée pendant l'affichage (compteur, « Copié ») : contenu et placement relus. */
export function refreshTip() {
  const el = tooltipState.anchor;
  if (!el) return;
  if (!el.isConnected) return hideTip();
  const value = rawValueOf(el);
  if (normalizeTip(value) == null) return hideTip();
  tooltipState.value = value;
  tooltipState.version++;
}

// Bouton ou lien sans texte (icône seule) : l'étiquette devient son nom accessible, comme le
// faisait title=. Recalculé seulement si le texte change (tableaux de 500 lignes).
function syncAutoAria(el) {
  const target = describedTarget(el);
  if (!target || !target.matches) return;
  const v = el.__vtip;
  const label =
    typeof v === 'string' || typeof v === 'number'
      ? String(v).trim()
      : v && typeof v === 'object' && !v.title
        ? String(v.label ?? v.text ?? '').trim()
        : '';
  // Raccourci annoncé tant que la bulle le montre (retiré quand il disparaît, ex. Suppr sur
  // une ligne qui n'est plus sélectionnée).
  const keys = v && typeof v === 'object' && Array.isArray(v.keys) && v.keys.length ? ariaKeys(v.keys, isMac) : '';
  if (keys) {
    target.setAttribute('aria-keyshortcuts', keys);
    target.__vtipAriaKeys = true;
  } else if (target.__vtipAriaKeys) {
    target.removeAttribute('aria-keyshortcuts');
    target.__vtipAriaKeys = false;
  }
  if (target.__vtipAutoAria) {
    if (label && target.__vtipAriaText !== label) {
      target.setAttribute('aria-label', label);
      target.__vtipAriaText = label;
    }
    return;
  }
  if (!label || !target.matches('button, a') || target.hasAttribute('aria-label') || target.textContent.trim()) return;
  target.setAttribute('aria-label', label);
  target.__vtipAutoAria = true;
  target.__vtipAriaText = label;
  el.__vtipAutoAria = true;
}

export const vTooltip = {
  mounted(el, binding) {
    el.__vtip = binding.value;
    el.__vtipMods = binding.modifiers || {};
    el.setAttribute('data-tooltip', el.__vtipMods.overflow ? 'overflow' : '');
    syncAutoAria(el);
  },
  updated(el, binding) {
    el.__vtipMods = binding.modifiers || {};
    if (binding.value === binding.oldValue) return;
    el.__vtip = binding.value;
    syncAutoAria(el);
    if (tooltipState.anchor === el) refreshTip();
  },
  beforeUnmount(el) {
    if (tooltipState.anchor === el) hideTip({ instant: true }); // l'élément disparaît : sa bulle aussi
    if (pending && pending.el === el) cancelPending();
    if (suppressed === el) suppressed = null;
  },
};

const pointOf = (e) => ({ x: e.clientX, y: e.clientY });

function onPointerOver(e) {
  if (e.pointerType === 'touch') return;
  const el = resolveAnchor(e.target);
  if (!el || el === tooltipState.anchor || (pending && pending.el === el)) return;
  requestTip(el, 'hover', pointOf(e));
}

function onPointerMove(e) {
  if (pending && e.pointerType !== 'touch') lastPoint = pointOf(e);
}

function onPointerOut(e) {
  if (e.pointerType === 'touch') return;
  const to = e.relatedTarget;
  if (suppressed && !(to && suppressed.contains(to))) suppressed = null;
  const anchor = tooltipState.anchor;
  const waiting = pending && pending.via === 'hover';
  if (!waiting && (!anchor || tooltipState.via === 'touch')) return;
  const next = resolveAnchor(to);
  // Bulle en attente : abandonnée dès que le pointeur quitte son élément (le suivant lance la sienne).
  if (waiting && next !== pending.el) cancelPending();
  if (!anchor || tooltipState.via === 'touch' || next === anchor) return; // reste dans l'ancre (ou un enfant sans bulle)
  if (next) showTip(next, 'hover', pointOf(e)); // voisin ou parent : contenu remplacé sur place, sans délai
  else if (tooltipState.via !== 'focus') hideTip({ warm: true });
}

// Un clic sur un élément actif ferme son étiquette (elle gênerait la suite) ; la carte d'un
// bouton grisé reste (c'est la raison qu'on vient chercher).
function isEnabledAction(el) {
  const action = el.closest(ACTION_SELECTOR) || (el.hasAttribute('data-tip-wrap') && el.querySelector(ACTION_SELECTOR));
  return !!action && !action.disabled && action.getAttribute('aria-disabled') !== 'true';
}

// Clic « pour agir » (bouton actif, ligne cliquable) plutôt que « pour savoir » (ⓘ, pastille,
// bouton grisé dont on cherche la raison).
function isActionClick(el) {
  const mods = el.__vtipMods || {};
  if (mods.keep || mods.touch) return false;
  return isEnabledAction(el) || !!el.closest('.cursor-pointer');
}

function onPointerDown(e) {
  lastPointerDown = Date.now();
  if (e.pointerType === 'touch') {
    cancelPending();
    const el = resolveAnchor(e.target);
    const tip = el && tipOf(el);
    const mods = (el && el.__vtipMods) || {};
    // Au doigt : une carte s'ouvre sur un ⓘ (.touch), une pastille hors bouton ou un bouton grisé
    // (sa raison) ; toucher un bouton actif — même enveloppé dans <Tooltip> — déclenche l'action,
    // sans infobulle. Le toucher suivant referme.
    const actionTap = el && (el.closest(INTERACTIVE) || (el.hasAttribute('data-tip-wrap') && isEnabledAction(el)));
    if (tip && tip.kind === 'card' && (mods.touch || !actionTap)) {
      if (tooltipState.anchor === el) hideTip();
      else showTip(el, 'touch', pointOf(e));
    } else if (tooltipState.anchor) {
      hideTip();
    }
    return;
  }
  // Clic pendant l'attente : la réponse s'affiche tout de suite si on la demandait (ⓘ, pastille,
  // bouton grisé) ; après un clic d'action, aucune étiquette ne vient gêner la suite.
  if (pending) {
    const el = pending.el;
    cancelPending();
    if (el.contains(e.target)) {
      if (!isActionClick(el)) showTip(el, 'hover', pointOf(e));
      else if (isEnabledAction(el)) suppressed = el;
      return;
    }
  }
  const anchor = tooltipState.anchor;
  if (!anchor) return;
  if (!anchor.contains(e.target)) return hideTip();
  if (!(anchor.__vtipMods || {}).keep && isEnabledAction(anchor)) {
    hideTip();
    suppressed = anchor;
  }
}

function onFocusIn(e) {
  // Un champ qui reçoit le focus au clic ou au doigt n'affiche rien (focus clavier seulement).
  if (Date.now() - lastPointerDown < 500) return;
  const el = resolveAnchor(e.target);
  if (!el) return;
  if (el !== e.target && !(el.hasAttribute('data-tip-wrap') && el.contains(e.target))) return;
  let visible = true;
  try {
    visible = e.target.matches(':focus-visible');
  } catch {
    /* navigateur ancien : on affiche */
  }
  if (visible) requestTip(el, 'focus');
}

function onFocusOut(e) {
  if (pending && pending.via === 'focus' && pending.el.contains(e.target)) cancelPending();
  if (tooltipState.via === 'focus' && tooltipState.anchor && tooltipState.anchor.contains(e.target)) hideTip({ warm: true });
}

// Échap ferme d'abord la bulle ; la fenêtre ouverte reste (un second Échap la ferme). Une bulle
// encore en attente est abandonnée sans retenir la touche.
function onKeyDown(e) {
  if (e.key !== 'Escape') return;
  if (pending) {
    suppressed = pending.el;
    cancelPending();
  }
  if (!tooltipState.anchor) return;
  suppressed = tooltipState.anchor;
  hideTip();
  e.stopPropagation();
}

function onScroll() {
  hideTip({ instant: true });
}

const dismiss = () => hideTip({ instant: true });

/** Directive globale + écouteurs (une seule fois, même après un rechargement à chaud). */
export function installTooltips(app, router) {
  app.directive('tooltip', vTooltip);
  if (typeof window === 'undefined' || window.__bdTooltipsInstalled) return;
  window.__bdTooltipsInstalled = true;
  const capture = { capture: true, passive: true };
  document.addEventListener('pointerover', onPointerOver, capture);
  document.addEventListener('pointermove', onPointerMove, capture);
  document.addEventListener('pointerout', onPointerOut, capture);
  document.addEventListener('pointerdown', onPointerDown, capture);
  document.addEventListener('pointercancel', dismiss, capture);
  document.addEventListener('dragstart', dismiss, capture);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onScroll, capture);
  window.addEventListener('resize', dismiss, { passive: true });
  document.addEventListener('visibilitychange', dismiss);
  router?.afterEach(dismiss);
  // L'infobulle et ses icônes se chargent au repos (ou au premier survol, cf. showTip).
  const want = () => {
    tooltipHostWanted.value = true;
  };
  if (window.requestIdleCallback) window.requestIdleCallback(want, { timeout: 4000 });
  else setTimeout(want, 2000);
}
