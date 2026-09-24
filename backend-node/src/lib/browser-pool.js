'use strict';

// Pool Puppeteer à instance unique, partagé par tous les rendus PDF
// (lib/pdf.js). Protections conservées :
//   1. contrôle de vie (`version()`) avant chaque réutilisation : une
//      instance morte (OOM, crash) est relancée ;
//   2. recyclage après N rendus (fuite mémoire de Chromium) ;
//   3. délai maximal par rendu — appliqué par lib/pdf.js (_withTimeout).
// Le recyclage n'interrompt plus les rendus en cours : l'ancienne instance
// ne ferme qu'une fois ses rendus terminés (au plus tard après
// `retireGraceMs`, filet pour un rendu figé). Et la déconnexion d'une
// instance recyclée ne « débranche » plus l'instance courante.

function createBrowserPool({ launch, recycleAfter = 50, retireGraceMs = 150000, log = console } = {}) {
  let current = null; // génération courante
  const live = new Set(); // toutes les générations non fermées

  function spawn() {
    const gen = {
      promise: null, uses: 0, inFlight: 0,
      retiring: false, closed: false, graceTimer: null, closing: null,
    };
    gen.promise = Promise.resolve().then(launch).then((browser) => {
      browser.on('disconnected', () => {
        gen.closed = true;
        clearTimeout(gen.graceTimer);
        live.delete(gen);
        if (current === gen) {
          log.warn('Puppeteer browser disconnected — will relaunch on next export');
          current = null;
        }
      });
      return browser;
    });
    gen.promise.catch(() => {
      live.delete(gen);
      if (current === gen) current = null;
    });
    live.add(gen);
    current = gen;
    return gen;
  }

  function close(gen) {
    if (!gen.closing) {
      gen.closed = true;
      clearTimeout(gen.graceTimer);
      live.delete(gen);
      gen.closing = gen.promise.then((b) => b.close()).catch(() => { /* déjà fermée */ });
    }
    return gen.closing;
  }

  function retire(gen) {
    if (current === gen) current = null;
    if (gen.retiring) return;
    gen.retiring = true;
    if (gen.inFlight === 0) {
      close(gen);
    } else {
      gen.graceTimer = setTimeout(() => close(gen), retireGraceMs);
      if (gen.graceTimer.unref) gen.graceTimer.unref();
    }
  }

  // Réserve le navigateur pour un rendu. L'appelant DOIT appeler
  // `release()` à la fin du rendu (succès ou échec).
  async function lease() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = !current;
      const gen = current || spawn();
      let browser;
      try {
        browser = await gen.promise;
      } catch (err) {
        if (current === gen) current = null;
        throw err; // lancement impossible : erreur rendue telle quelle
      }
      if (!fresh) {
        try {
          await browser.version();
        } catch (err) {
          log.warn(`Puppeteer healthcheck KO (${err.message}) — relance`);
          if (current === gen) current = null;
          close(gen);
          continue;
        }
      }
      // Recyclée ou fermée pendant l'attente : on repart sur la courante.
      if (gen.retiring || gen.closed) continue;
      if (gen.uses >= recycleAfter) {
        log.info(`Puppeteer recycle apres ${gen.uses} renders`);
        retire(gen);
        continue;
      }
      gen.uses++;
      gen.inFlight++;
      let released = false;
      return {
        browser,
        release() {
          if (released) return;
          released = true;
          gen.inFlight--;
          if (gen.retiring && gen.inFlight === 0) close(gen);
        },
      };
    }
    throw new Error('Puppeteer : aucun navigateur disponible');
  }

  async function shutdown() {
    current = null;
    await Promise.all([...live].map(close));
  }

  return { lease, shutdown };
}

module.exports = { createBrowserPool };
