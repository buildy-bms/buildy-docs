// Placement des infobulles (frontend/src/lib/tooltip-position.js, porté de Buildy Tools) :
// côté préféré, retournement, 8 px des bords, flèche, côté conservé, et les ajouts Buildy Docs
// (centrage sur le curseur pour une ancre large, repli autour du curseur si rien ne tient).
import { describe, it, expect } from 'vitest';
import { computeTooltipPosition, cursorAnchor } from '../../frontend/src/lib/tooltip-position.js';

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 60 };
const at = (left, top, width = 40, height = 20) => ({ left, top, width, height });
const overlaps = (p, a, s = size) =>
  !(p.x + s.width <= a.left || p.x >= a.left + a.width || p.y + s.height <= a.top || p.y >= a.top + a.height);

describe('computeTooltipPosition', () => {
  it('au-dessus, centrée, flèche au centre', () => {
    const p = computeTooltipPosition({ anchor: at(480, 400), size, viewport });
    expect(p.placement).toBe('top');
    expect(p.x).toBe(400); // 480 + 20 - 100
    expect(p.y).toBe(400 - 8 - 60);
    expect(p.arrow).toBe(100);
    expect(p.maxHeight).toBe(null);
  });

  it('près du haut : passe en dessous', () => {
    const p = computeTooltipPosition({ anchor: at(480, 20), size, viewport });
    expect(p.placement).toBe('bottom');
    expect(p.y).toBe(20 + 20 + 8);
  });

  it('à droite, ou à gauche si le bord droit est trop près', () => {
    expect(computeTooltipPosition({ anchor: at(100, 400), size, viewport, placement: 'right' }).placement).toBe('right');
    const p = computeTooltipPosition({ anchor: at(900, 400), size, viewport, placement: 'right' });
    expect(p.placement).toBe('left');
    expect(p.x).toBe(900 - 8 - 200);
  });

  it('ni droite ni gauche : au-dessus', () => {
    const narrow = { width: 300, height: 800 };
    const p = computeTooltipPosition({ anchor: at(130, 400), size, viewport: narrow, placement: 'right' });
    expect(p.placement).toBe('top');
  });

  it('reste à 8 px du bord, la flèche suit l’ancre', () => {
    const p = computeTooltipPosition({ anchor: at(0, 400, 20), size, viewport });
    expect(p.x).toBe(8);
    expect(p.arrow).toBe(10);
    const r = computeTooltipPosition({ anchor: at(985, 400, 10), size, viewport });
    expect(r.x).toBe(1000 - 200 - 8);
    expect(r.arrow).toBe(190);
  });

  it('trop haute pour tenir (sans curseur) : côté le plus spacieux et hauteur maximale', () => {
    const p = computeTooltipPosition({ anchor: at(480, 300), size: { width: 200, height: 900 }, viewport });
    expect(p.placement).toBe('bottom');
    expect(p.maxHeight).toBe(800 - 320 - 8 - 8);
  });

  it('ancre hors de l’écran : rien', () => {
    expect(computeTooltipPosition({ anchor: at(480, -100), size, viewport })).toBe(null);
    expect(computeTooltipPosition({ anchor: at(1200, 400), size, viewport })).toBe(null);
  });

  it('garde le côté précédent s’il tient encore (pas de saut pendant une mise à jour)', () => {
    const p = computeTooltipPosition({ anchor: at(480, 400), size, viewport, previous: 'bottom' });
    expect(p.placement).toBe('bottom');
    const q = computeTooltipPosition({ anchor: at(480, 760), size, viewport, previous: 'bottom' });
    expect(q.placement).toBe('top');
  });

  it('pixels entiers', () => {
    const p = computeTooltipPosition({ anchor: at(480.4, 400.6, 33.3, 21.1), size: { width: 201.5, height: 60.2 }, viewport });
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  });

  it('ancre virtuelle autour du pointeur', () => {
    expect(cursorAnchor(100, 200)).toEqual({ left: 88, top: 188, width: 24, height: 24 });
  });
});

describe('ajouts Buildy Docs', () => {
  const row = at(40, 400, 900, 32); // ligne de tableau de 900 px

  it('ancre large : la bulle se centre sur le curseur, pas au milieu de la ligne', () => {
    const p = computeTooltipPosition({ anchor: row, size, viewport, pointer: { x: 120, y: 410 } });
    expect(p.placement).toBe('top');
    expect(p.x).toBe(20); // 120 - 100
    expect(p.arrow).toBe(100); // flèche sous le curseur
    expect(overlaps(p, row)).toBe(false);
  });

  it('curseur déjà sous la bulle centrée (bouton) : rien ne change', () => {
    const btn = at(480, 400);
    const a = computeTooltipPosition({ anchor: btn, size, viewport });
    const b = computeTooltipPosition({ anchor: btn, size, viewport, pointer: { x: 495, y: 405 } });
    expect(b.x).toBe(a.x);
    expect(b.arrow).toBe(a.arrow);
  });

  it('curseur près du bord droit : bulle bornée à 8 px, flèche toujours sous le curseur', () => {
    const p = computeTooltipPosition({ anchor: row, size, viewport, pointer: { x: 930, y: 410 } });
    expect(p.x).toBe(1000 - 200 - 8);
    expect(p.arrow).toBe(930 - 792);
  });

  it('jamais par-dessus l’ancre, quel que soit le côté', () => {
    for (const anchor of [at(480, 400), at(0, 0, 60, 30), at(940, 770, 60, 30), at(300, 30, 400, 40), row]) {
      for (const placement of ['top', 'bottom', 'left', 'right']) {
        const p = computeTooltipPosition({ anchor, size, viewport, placement, pointer: { x: anchor.left + 5, y: anchor.top + 5 } });
        if (p && !p.onPointer) expect(overlaps(p, anchor)).toBe(false);
      }
    }
  });

  it('toujours entièrement dans l’écran (8 px)', () => {
    for (const anchor of [at(0, 0, 10, 10), at(990, 790, 10, 10), at(500, 0, 10, 10), at(0, 400, 10, 10)]) {
      const p = computeTooltipPosition({ anchor, size, viewport });
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x + size.width).toBeLessThanOrEqual(1000 - 8);
      expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.y + size.height).toBeLessThanOrEqual(800 - 8);
    }
  });

  it('ancre plus haute que l’écran : bulle autour du curseur, sans le recouvrir', () => {
    const tall = at(100, -50, 700, 900);
    const pointer = { x: 400, y: 300 };
    const p = computeTooltipPosition({ anchor: tall, size, viewport, pointer });
    expect(p.onPointer).toBe(true);
    const cur = cursorAnchor(pointer.x, pointer.y);
    expect(overlaps(p, cur)).toBe(false);
    expect(p.maxHeight).toBe(null);
  });
});
