// Minimal service worker: makes the companion installable and keeps the app
// shell loading fast. The sync API is never touched — cloud state must always
// be live. Registered from /companion at root scope, so once installed it
// also fronts the desktop game; both are network-first for HTML, so a deploy
// is never hidden.
const CACHE = 'duckstead-v1';

// Hashed assets are immutable but pile up one set per deploy. After each
// fresh shell arrives, drop every cached /assets/ entry it no longer names.
async function evictStaleAssets(shellHtml) {
  const live = new Set([...shellHtml.matchAll(/\/assets\/[\w.-]+/g)].map((m) => m[0]));
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/assets/') && !live.has(path)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Navigations: network first so deploys land, cached shell as the offline net.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // Only a good shell goes in the cache — a 5xx error page during a
          // deploy must not become the offline fallback.
          if (res.ok) {
            const copy = res.clone();
            const shell = res.clone();
            event.waitUntil(
              caches
                .open(CACHE)
                .then((c) => c.put(event.request, copy))
                .then(() => shell.text())
                .then(evictStaleAssets),
            );
          }
          return res;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((hit) => hit ?? caches.match('/companion'))
            // respondWith(undefined) surfaces as a browser network-error
            // page; a real Response keeps the failure legible.
            .then((hit) => hit ?? new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })),
        ),
    );
    return;
  }

  // Hashed assets: cache first (immutable), fill the cache as we go.
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ??
        fetch(event.request)
          .then((res) => {
            if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/guide/'))) {
              const copy = res.clone();
              event.waitUntil(caches.open(CACHE).then((c) => c.put(event.request, copy)));
            }
            return res;
          })
          .catch(() => new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })),
    ),
  );
});
