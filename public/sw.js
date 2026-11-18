const SHELL_CACHE = 'bookhighlighter-shell-v1';
const COVERS_CACHE = 'bookhighlighter-covers-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== SHELL_CACHE && key !== COVERS_CACHE)
            .map(key => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Stale-while-revalidate runtime cache for Cloudinary book covers & avatars.
  if (url.hostname === 'res.cloudinary.com') {
    event.respondWith(
      caches.open(COVERS_CACHE).then(async cache => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then(response => {
            if (response.ok || response.type === 'opaque') {
              void cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || (await network) || Response.error();
      }),
    );
    return;
  }

  // Same-origin App Shell + hashed Vite static chunks (/assets/*).
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then(response => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(SHELL_CACHE)
                .then(cache => cache.put('/index.html', copy));
            }
            return response;
          })
          .catch(async () => {
            const cache = await caches.open(SHELL_CACHE);
            return (
              (await cache.match('/index.html')) ||
              (await cache.match('/')) ||
              Response.error()
            );
          }),
      );
      return;
    }

    if (
      url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/icons/') ||
      SHELL_URLS.includes(url.pathname)
    ) {
      event.respondWith(
        caches.open(SHELL_CACHE).then(async cache => {
          const cached = await cache.match(request);
          if (cached && url.pathname.startsWith('/assets/')) return cached;

          try {
            const response = await fetch(request);
            if (response.ok) void cache.put(request, response.clone());
            return response;
          } catch {
            return cached || Response.error();
          }
        }),
      );
    }
  }
});
