/**
 * Service Worker minimal pour Buildy Docs.
 *
 * Stratégies :
 * - Navigation HTML (mode standalone) : NetworkFirst → fallback cache → fallback offline page.
 * - Assets statiques /assets/* : StaleWhileRevalidate (rapide + frais en arrière-plan).
 * - API /api/* : pas de cache (online-only, données changeantes).
 *
 * On reste léger : pas de Workbox, pas de cachage exhaustif. Objectif = lancement
 * rapide en mode standalone iOS et bascule rapide entre onglets.
 */

const CACHE_VERSION = 'buildy-docs-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

// App shell : pages HTML pré-cachées
const APP_SHELL = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
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

  // API : pas de cache, network-only
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Navigation HTML : NetworkFirst avec fallback cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/')))
    );
    return;
  }

  // Assets statiques : StaleWhileRevalidate
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const fetched = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || fetched;
        })
      )
    );
  }
});
