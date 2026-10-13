// Délai d'apparition des infobulles (frontend/src/lib/tooltip-timing.js, 2026-10-12) : la
// première bulle attend que le pointeur se pose, la voisine s'ouvre sans délai, une demande
// explicite (toucher, clic sur un ⓘ) répond tout de suite.
import { describe, it, expect } from 'vitest';
import {
  tooltipOpenDelay, TOOLTIP_OPEN_DELAY, TOOLTIP_SKIP_DELAY,
  tooltipMotion, tooltipMotionOrigin, withBaseTransform, TOOLTIP_ENTER_MS, TOOLTIP_EXIT_MS,
} from '../../frontend/src/lib/tooltip-timing.js';

describe('tooltipOpenDelay', () => {
  it('attend que le pointeur se pose avant la première bulle (norme : 300 à 500 ms)', () => {
    expect(TOOLTIP_OPEN_DELAY).toBeGreaterThanOrEqual(300);
    expect(TOOLTIP_OPEN_DELAY).toBeLessThanOrEqual(500);
    expect(tooltipOpenDelay({ via: 'hover', now: 10_000 })).toBe(TOOLTIP_OPEN_DELAY);
    expect(tooltipOpenDelay()).toBe(TOOLTIP_OPEN_DELAY);
  });

  it('applique le même délai au focus clavier', () => {
    expect(tooltipOpenDelay({ via: 'focus', now: 10_000 })).toBe(TOOLTIP_OPEN_DELAY);
  });

  it('ouvre tout de suite au toucher ou au clic sur un ⓘ', () => {
    expect(tooltipOpenDelay({ via: 'touch', now: 10_000 })).toBe(0);
    expect(tooltipOpenDelay({ via: 'click', now: 10_000 })).toBe(0);
  });

  it('passe sans délai à l’élément voisin tant qu’une bulle est ouverte', () => {
    expect(tooltipOpenDelay({ via: 'hover', visible: true, now: 10_000 })).toBe(0);
    expect(tooltipOpenDelay({ via: 'focus', visible: true, now: 10_000 })).toBe(0);
  });

  it('passe sans délai juste après une fermeture, puis le délai revient', () => {
    const closedAt = 10_000;
    const warmUntil = closedAt + TOOLTIP_SKIP_DELAY;
    expect(tooltipOpenDelay({ now: closedAt + 120, warmUntil })).toBe(0);
    expect(tooltipOpenDelay({ now: warmUntil - 1, warmUntil })).toBe(0);
    expect(tooltipOpenDelay({ now: warmUntil, warmUntil })).toBe(TOOLTIP_OPEN_DELAY);
    expect(tooltipOpenDelay({ now: closedAt + 2_000, warmUntil })).toBe(TOOLTIP_OPEN_DELAY);
  });
});

describe('tooltipMotion (fondu)', () => {
  it('ouverture : du transparent au visible, en partant de l’élément survolé, rapide (≤ 200 ms)', () => {
    const { keyframes, options } = tooltipMotion('top');
    expect(keyframes[0].opacity).toBe(0);
    expect(keyframes[keyframes.length - 1]).toEqual({ opacity: 1, transform: 'translate(0px, 0px) scale(1)' });
    expect(keyframes[0].transform).toContain('translate(0px, 4px)'); // bulle au-dessus : part d'un peu plus bas
    expect(options.duration).toBe(TOOLTIP_ENTER_MS);
    expect(options.duration).toBeLessThanOrEqual(200);
    expect(options.fill).toBeUndefined(); // pas d'état figé après l'animation
  });

  it('le glissement part toujours du côté de l’élément survolé', () => {
    expect(tooltipMotion('bottom').keyframes[0].transform).toContain('translate(0px, -4px)');
    expect(tooltipMotion('right').keyframes[0].transform).toContain('translate(-4px, 0px)');
    expect(tooltipMotion('left').keyframes[0].transform).toContain('translate(4px, 0px)');
    expect(tooltipMotion('inconnu').keyframes[0].transform).toContain('translate(0px, 4px)');
  });

  it('fermeture : plus courte que l’ouverture, finit transparente', () => {
    const { keyframes, options } = tooltipMotion('top', { entering: false });
    expect(keyframes[0].opacity).toBe(1);
    expect(keyframes[keyframes.length - 1].opacity).toBe(0);
    expect(options.duration).toBe(TOOLTIP_EXIT_MS);
    expect(TOOLTIP_EXIT_MS).toBeLessThan(TOOLTIP_ENTER_MS);
    expect(options.fill).toBe('forwards');
  });

  it('« Réduire les animations » : fondu seul, sans mouvement', () => {
    for (const entering of [true, false]) {
      const { keyframes } = tooltipMotion('bottom', { entering, reduced: true });
      expect(keyframes.every((k) => k.transform === undefined)).toBe(true);
      expect(keyframes.map((k) => k.opacity)).toEqual(entering ? [0, 1] : [1, 0]);
    }
  });

  it('zoom depuis la flèche, du côté de l’élément', () => {
    expect(tooltipMotionOrigin('top', 42.4)).toBe('42px 100%');
    expect(tooltipMotionOrigin('bottom')).toBe('50% 0%');
    expect(tooltipMotionOrigin('left', 10)).toBe('100% 10px');
    expect(tooltipMotionOrigin('right')).toBe('0% 50%');
  });

  it('étiquettes des cartes : le centrage est conservé pendant le fondu', () => {
    const base = 'translate(-50%, -100%)';
    const frames = withBaseTransform(tooltipMotion('top').keyframes, base);
    expect(frames.every((k) => k.transform.startsWith(base))).toBe(true);
    expect(withBaseTransform(tooltipMotion('top', { reduced: true }).keyframes, base).every((k) => k.transform === base)).toBe(true);
  });
});
