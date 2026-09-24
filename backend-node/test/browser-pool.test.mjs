// Pool Puppeteer (lib/browser-pool.js) avec un lanceur factice : le
// recyclage n'interrompt plus les rendus en cours, le contrôle de vie
// relance une instance morte, et la déconnexion d'une ancienne instance ne
// débranche pas la nouvelle.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createBrowserPool } = require('../src/lib/browser-pool');

const quietLog = { info() {}, warn() {} };
// La fermeture d'une instance passe par une promesse : laisser la file des
// micro-tâches se vider avant de vérifier.
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function fakeLauncher() {
  const browsers = [];
  const launch = vi.fn(async () => {
    const listeners = {};
    const b = {
      id: browsers.length + 1,
      alive: true,
      version: vi.fn(async () => { if (!b.alive) throw new Error('dead'); return 'HeadlessChrome'; }),
      close: vi.fn(async () => { b.alive = false; (listeners.disconnected || []).forEach(f => f()); }),
      on: (evt, f) => { (listeners[evt] = listeners[evt] || []).push(f); },
      crash: () => { b.alive = false; (listeners.disconnected || []).forEach(f => f()); },
    };
    browsers.push(b);
    return b;
  });
  return { launch, browsers };
}

afterEach(() => { vi.useRealTimers(); });

describe('createBrowserPool', () => {
  it('réutilise la même instance jusqu\'au seuil de recyclage', async () => {
    const { launch } = fakeLauncher();
    const pool = createBrowserPool({ launch, recycleAfter: 3, log: quietLog });
    for (let i = 0; i < 3; i++) (await pool.lease()).release();
    expect(launch).toHaveBeenCalledTimes(1);
    (await pool.lease()).release(); // 4e rendu : recyclage
    expect(launch).toHaveBeenCalledTimes(2);
    await pool.shutdown();
  });

  it('recyclage pendant des rendus : l\'ancienne instance ferme après leur fin', async () => {
    const { launch, browsers } = fakeLauncher();
    const pool = createBrowserPool({ launch, recycleAfter: 2, log: quietLog });
    const r1 = await pool.lease();
    const r2 = await pool.lease();
    const r3 = await pool.lease(); // seuil atteint : nouvelle instance
    expect(r1.browser).toBe(browsers[0]);
    expect(r3.browser).toBe(browsers[1]);
    await flush();
    expect(browsers[0].close).not.toHaveBeenCalled(); // 2 rendus en cours
    r1.release();
    await flush();
    expect(browsers[0].close).not.toHaveBeenCalled();
    r2.release();
    await flush();
    expect(browsers[0].close).toHaveBeenCalledTimes(1);
    r3.release();
    await pool.shutdown();
  });

  it('la déconnexion de l\'ancienne instance ne débranche pas la nouvelle', async () => {
    const { launch, browsers } = fakeLauncher();
    const pool = createBrowserPool({ launch, recycleAfter: 2, log: quietLog });
    const r1 = await pool.lease();
    const r2 = await pool.lease();
    const r3 = await pool.lease(); // instance 2 (1 rendu)
    r1.release();
    r2.release(); // l'instance 1 ferme → événement « disconnected »
    await flush();
    expect(browsers[0].close).toHaveBeenCalledTimes(1);
    r3.release();
    const r4 = await pool.lease(); // l'instance 2 reste la courante
    expect(r4.browser).toBe(browsers[1]);
    expect(launch).toHaveBeenCalledTimes(2);
    r4.release();
    await pool.shutdown();
  });

  it('contrôle de vie : une instance morte est relancée', async () => {
    const { launch, browsers } = fakeLauncher();
    const pool = createBrowserPool({ launch, recycleAfter: 50, log: quietLog });
    (await pool.lease()).release();
    browsers[0].alive = false; // morte sans événement (OOM)
    const r = await pool.lease();
    expect(r.browser).toBe(browsers[1]);
    r.release();
    await pool.shutdown();
  });

  it('plantage (disconnected) : relance au rendu suivant', async () => {
    const { launch, browsers } = fakeLauncher();
    const pool = createBrowserPool({ launch, recycleAfter: 50, log: quietLog });
    (await pool.lease()).release();
    browsers[0].crash();
    const r = await pool.lease();
    expect(r.browser).toBe(browsers[1]);
    r.release();
    await pool.shutdown();
  });

  it('lancement impossible : erreur rendue, nouvel essai au rendu suivant', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error('chrome introuvable'))
      .mockImplementation(fakeLauncher().launch);
    const pool = createBrowserPool({ launch, log: quietLog });
    await expect(pool.lease()).rejects.toThrow('chrome introuvable');
    const r = await pool.lease();
    expect(r.browser.alive).toBe(true);
    r.release();
    await pool.shutdown();
  });

  it('rendu figé : l\'instance recyclée ferme quand même après le délai de grâce', async () => {
    vi.useFakeTimers();
    const { launch, browsers } = fakeLauncher();
    const pool = createBrowserPool({ launch, recycleAfter: 1, retireGraceMs: 1000, log: quietLog });
    await pool.lease(); // jamais rendu (rendu figé)
    const r2 = await pool.lease();
    await flush();
    expect(browsers[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(browsers[0].close).toHaveBeenCalledTimes(1);
    r2.release();
    await pool.shutdown();
  });

  it('release() plusieurs fois : sans effet', async () => {
    const { launch, browsers } = fakeLauncher();
    const pool = createBrowserPool({ launch, recycleAfter: 1, log: quietLog });
    const r1 = await pool.lease();
    const r2 = await pool.lease(); // instance 1 en retrait, 1 rendu en cours
    r1.release();
    r1.release();
    await flush();
    expect(browsers[0].close).toHaveBeenCalledTimes(1);
    r2.release();
    await pool.shutdown();
    expect(browsers[1].close).toHaveBeenCalledTimes(1);
  });
});
