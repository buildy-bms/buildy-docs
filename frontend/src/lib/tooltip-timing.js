// Délai d'apparition des infobulles (2026-10-12, demande de Kévin : « pas instantané, comme le
// veut la norme, pour que ce soit moins gênant »). Une bulle qui s'ouvre au moindre passage de
// souris masque ce qu'on lit ; l'usage est d'attendre que le pointeur se pose. Repères : Windows
// 500 ms puis 100 ms d'un outil au voisin, Atlassian 300 ms, Radix 700 ms puis 300 ms.
// Retenu pour toute l'application (v-tooltip, fiche du décret ⓘ, repères des cartes) :
//   - 400 ms avant la première bulle, au survol comme au focus clavier ;
//   - aucun délai vers l'élément voisin tant qu'une bulle est ouverte ou vient de se fermer
//     (moins de 300 ms) : parcourir une barre d'outils ou une ligne de pastilles reste fluide ;
//   - aucun délai quand on touche ou clique un ⓘ : c'est une demande explicite.
// Fonctions PURES (testées par backend-node/test/tooltip-timing.test.mjs), sauf
// prefersReducedMotion qui lit le réglage du système.

export const TOOLTIP_OPEN_DELAY = 400;
export const TOOLTIP_SKIP_DELAY = 300;

/**
 * Délai (ms) avant d'ouvrir une bulle.
 * @param {{ via?: 'hover'|'focus'|'touch'|'click', visible?: boolean, now?: number, warmUntil?: number }} o
 *   visible : une bulle est déjà ouverte ; warmUntil : fin du passage libre après la dernière fermeture.
 */
export function tooltipOpenDelay({ via = 'hover', visible = false, now = 0, warmUntil = 0 } = {}) {
  if (via === 'touch' || via === 'click') return 0;
  if (visible || now < warmUntil) return 0;
  return TOOLTIP_OPEN_DELAY;
}

// ── Fondu d'apparition et de disparition (2026-10-12, demande de Kévin : « un bel effet de
// fondu, comme ce qu'il se fait de mieux ») ──────────────────────────────────────────────────
// Ouverture : fondu + glissement de 4 px depuis l'élément survolé + léger zoom (0,97 → 1),
// courbe « expo out » rapide au départ et douce à l'arrivée (Linear, Radix, Vercel). Fermeture :
// plus courte, courbe « ease in » (la bulle s'efface sans traîner). D'un élément au voisin : pas
// de nouveau fondu (aucun clignotement). « Réduire les animations » (macOS, iOS) : fondu seul.
export const TOOLTIP_ENTER_MS = 160;
export const TOOLTIP_EXIT_MS = 110;
export const TOOLTIP_EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const TOOLTIP_EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

// Décalage de départ (px) : la bulle part de l'élément survolé et s'en écarte.
const MOTION_OFFSET = { top: [0, 4], bottom: [0, -4], left: [4, 0], right: [-4, 0] };

/**
 * Animation d'une bulle (Web Animations API) : images clés et réglages.
 * @param {'top'|'bottom'|'left'|'right'} side côté où la bulle s'est placée
 * @param {{ entering?: boolean, reduced?: boolean }} o reduced = « Réduire les animations »
 * @returns {{ keyframes: Keyframe[], options: KeyframeAnimationOptions }}
 */
export function tooltipMotion(side = 'top', { entering = true, reduced = false } = {}) {
  const [dx, dy] = MOTION_OFFSET[side] || MOTION_OFFSET.top;
  const rest = reduced ? { opacity: 1 } : { opacity: 1, transform: 'translate(0px, 0px) scale(1)' };
  const away = reduced
    ? { opacity: 0 }
    : entering
      ? { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.97)` }
      : { opacity: 0, transform: `translate(${dx / 2}px, ${dy / 2}px) scale(0.98)` };
  return entering
    ? { keyframes: [away, rest], options: { duration: reduced ? 120 : TOOLTIP_ENTER_MS, easing: TOOLTIP_EASE_OUT } }
    : { keyframes: [rest, away], options: { duration: reduced ? 90 : TOOLTIP_EXIT_MS, easing: TOOLTIP_EASE_IN, fill: 'forwards' } };
}

/** Images clés précédées d'une transformation de base (étiquettes des repères Google Maps,
 *  centrées par « translate(-50%, -100%) »). */
export function withBaseTransform(keyframes, base) {
  return keyframes.map((k) => ({ ...k, transform: k.transform ? `${base} ${k.transform}` : base }));
}

/** Point d'origine du zoom : du côté de l'élément survolé, au niveau de la flèche s'il y en a une. */
export function tooltipMotionOrigin(side = 'top', arrow = null) {
  const along = arrow == null ? '50%' : `${Math.round(arrow)}px`;
  if (side === 'bottom') return `${along} 0%`;
  if (side === 'left') return `100% ${along}`;
  if (side === 'right') return `0% ${along}`;
  return `${along} 100%`;
}

/** L'utilisateur a-t-il demandé « Réduire les animations » ? */
export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
