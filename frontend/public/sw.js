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

const CACHE_VERSION = 'buildy-docs-v2';
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

  // ⚠️ N'intercepte PAS les navigations ni l'API ni l'auth — laisse le
  // navigateur gérer normalement (cookies, redirects OIDC, etc).
  // Le SW se contente de cacher /assets/* et /icons/* pour accélérer
  // le second lancement standalone.
  if (req.mode === 'navigate') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Assets statiques uniquement : StaleWhileRevalidate
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
