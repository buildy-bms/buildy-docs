// Placement d'une infobulle (directive v-tooltip, 2026-10-12, porté de Buildy Tools) :
// fonction pure, testée (backend-node/test/tooltip-position.test.mjs).
// Côté préféré, retournement s'il manque de place, marge de 8 px au bord de l'écran, flèche
// pointée sur l'ancre, côté conservé pendant les mises à jour (pas de saut).
// Ajouts Buildy Docs :
//   - sur une ancre large (ligne, carte, cellule), la bulle se centre sur le CURSEUR quand il
//     n'est pas déjà sous la bulle centrée : elle reste au-dessus ou au-dessous de l'ancre
//     entière, donc ne la recouvre jamais ;
//   - quand rien ne tient (ancre plus haute que l'écran), la bulle se place autour du curseur
//     au lieu d'être écrasée ou poussée hors de l'écran.

const FALLBACKS = {
  top: ['top', 'bottom', 'right', 'left'],
  bottom: ['bottom', 'top', 'right', 'left'],
  right: ['right', 'left', 'top', 'bottom'],
  left: ['left', 'right', 'top', 'bottom'],
};

function space(side, a, v) {
  if (side === 'top') return a.top;
  if (side === 'bottom') return v.height - (a.top + a.height);
  if (side === 'left') return a.left;
  return v.width - (a.left + a.width);
}

function needed(side, size) {
  return side === 'top' || side === 'bottom' ? size.height : size.width;
}

const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

// Distance minimale entre le curseur et le bord de la bulle centrée pour la garder centrée.
const POINTER_PAD = 24;
// En dessous de cette hauteur disponible, une bulle tronquée devient illisible.
const MIN_USEFUL_HEIGHT = 64;

/** Ancre virtuelle autour du pointeur. */
export function cursorAnchor(clientX, clientY, size = 24) {
  return { left: clientX - size / 2, top: clientY - size / 2, width: size, height: size };
}

/**
 * @param {object} p
 * @param {{left:number, top:number, width:number, height:number}} p.anchor  rectangle de l'ancre
 * @param {{width:number, height:number}} p.size     taille mesurée de l'infobulle
 * @param {{width:number, height:number}} p.viewport
 * @param {'top'|'bottom'|'left'|'right'} [p.placement='top']
 * @param {number} [p.offset=8]    écart entre l'ancre et l'infobulle
 * @param {number} [p.margin=8]    marge minimale au bord de l'écran
 * @param {number} [p.arrowPad=10] distance minimale de la flèche aux coins
 * @param {string|null} [p.previous]  côté utilisé juste avant (conservé s'il tient encore)
 * @param {{x:number, y:number}|null} [p.pointer]  position du pointeur à l'entrée sur l'ancre
 * @returns {{placement:string, x:number, y:number, arrow:number|null, maxHeight:number|null, onPointer:boolean}|null}
 *   null si l'ancre est entièrement hors de l'écran.
 */
export function computeTooltipPosition({
  anchor,
  size,
  viewport,
  placement = 'top',
  offset = 8,
  margin = 8,
  arrowPad = 10,
  previous = null,
  pointer = null,
}) {
  const a = anchor;
  const v = viewport;
  if (a.left + a.width < 0 || a.top + a.height < 0 || a.left > v.width || a.top > v.height) return null;

  const order = FALLBACKS[placement] || FALLBACKS.top;
  // À gauche ou à droite, la hauteur doit aussi tenir dans l'écran.
  const fits = (side) =>
    space(side, a, v) >= needed(side, size) + offset + margin &&
    (side === 'top' || side === 'bottom' || size.height <= v.height - 2 * margin);
  let side = previous && order.includes(previous) && fits(previous) ? previous : order.find(fits);
  let maxHeight = null;
  if (!side) {
    const best = space('top', a, v) > space('bottom', a, v) ? 'top' : 'bottom';
    const room = Math.floor(space(best, a, v) - offset - margin);
    if (pointer && room < MIN_USEFUL_HEIGHT) {
      // Ancre plus haute que l'écran : la bulle se place autour du curseur (elle peut alors
      // recouvrir une partie de l'ancre, jamais le curseur).
      const p = computeTooltipPosition({
        anchor: cursorAnchor(pointer.x, pointer.y),
        size,
        viewport: v,
        placement,
        offset,
        margin,
        arrowPad,
      });
      return p && { ...p, onPointer: true };
    }
    // Rien ne tient : le côté vertical le plus spacieux, contenu limité en hauteur.
    side = best;
    maxHeight = Math.max(48, room);
  }
  const height = maxHeight != null ? Math.min(size.height, maxHeight) : size.height;

  let x;
  let y;
  let target; // point visé par la flèche (x pour haut / bas, y pour gauche / droite)
  if (side === 'top' || side === 'bottom') {
    target = a.left + a.width / 2;
    x = clamp(target - size.width / 2, margin, Math.max(margin, v.width - size.width - margin));
    // Ancre large : si le curseur n'est pas sous la bulle centrée, on la recentre sur lui.
    if (pointer && (pointer.x < x + POINTER_PAD || pointer.x > x + size.width - POINTER_PAD)) {
      const inset = Math.min(8, a.width / 2);
      target = clamp(pointer.x, a.left + inset, a.left + a.width - inset);
      x = clamp(target - size.width / 2, margin, Math.max(margin, v.width - size.width - margin));
    }
    y = side === 'top' ? a.top - offset - height : a.top + a.height + offset;
  } else {
    target = a.top + a.height / 2;
    y = clamp(target - height / 2, margin, Math.max(margin, v.height - height - margin));
    x = side === 'left' ? a.left - offset - size.width : a.left + a.width + offset;
  }

  // Flèche : vers le point visé, jamais dans un coin arrondi ; absente s'il sort de la bulle.
  const along = side === 'top' || side === 'bottom';
  const center = along ? target - x : target - y;
  const length = along ? size.width : height;
  const arrow = center < 0 || center > length ? null : Math.round(clamp(center, arrowPad, length - arrowPad));

  return { placement: side, x: Math.round(x), y: Math.round(y), arrow, maxHeight, onPointer: false };
}
