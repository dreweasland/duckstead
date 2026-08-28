// Minimal service worker: makes the companion installable and keeps the app
// shell loading fast. The sync API is never touched — cloud state must always
// be live.
const CACHE = 'duckstead-v1';

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
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
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
            if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          })
          .catch(() => new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })),
    ),
  );
});
