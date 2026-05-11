/**
 * Service Worker — Buildy Docs PWA.
 *
 * Stratégie :
 * - **App shell offline** : `index.html` mis en cache à l'install et
 *   servi en fallback sur toute requête `mode === 'navigate'` qui
 *   échoue. Sans ça, l'app PWA installée iOS standalone reste sur
 *   page blanche au moindre passage hors-ligne, et le mode offline
 *   queue ne peut même pas s'enclencher.
 * - **Assets statiques** (JS / CSS / fonts / icons) : StaleWhileRevalidate.
 *   Cache la version réseau quand dispo, sert le cache sinon.
 * - **API et auth** : network-only — jamais cachés (les données
 *   évoluent côté serveur, la queue offline gère les écritures).
 *
 * Le SW est nécessaire pour que iOS Safari déclenche l'eligibilité PWA
 * « Add to Home Screen » en mode standalone propre.
 */

const CACHE_VERSION = 'buildy-docs-v5';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const APP_SHELL_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.add(APP_SHELL_URL))
      .catch(() => { /* fail-soft : sera retenté au premier navigate */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ── Navigation : on tente le réseau d'abord (pour avoir la dernière
  //    version de l'app), fallback sur l'app shell cachée si offline.
  //    On met à jour l'app shell cachée à chaque succès.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(APP_SHELL_URL, copy));
          }
          return res;
        })
        .catch(() => caches.match(APP_SHELL_URL).then((cached) => cached || Response.error()))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  // API / auth : jamais cachés. Les écritures hors-ligne sont gérées
  // côté frontend par lib/offline-queue.js (interceptor axios).
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Assets statiques : StaleWhileRevalidate.
  const isStatic = url.pathname.startsWith('/assets/')
                || url.pathname.startsWith('/icons/')
                || /\.(svg|png|jpg|jpeg|webp|woff2|woff)$/.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const fetched = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    )
  );
});
