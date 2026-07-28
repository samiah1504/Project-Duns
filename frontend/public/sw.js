/**
 * Tardmart service worker.
 *
 * Strategy:
 *  - Static assets (JS/CSS/fonts/images bundled by Vite): cache-first with a
 *    version-keyed cache so stale assets are never served after a deploy.
 *  - Navigation requests (HTML shell): network-first, fall back to cached
 *    shell so the SPA still opens when installed.
 *  - /api/* requests: network-only, never cached.  Transactional data must
 *    always come from the live backend.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE  = `tardmart-static-${CACHE_VERSION}`;
const SHELL_CACHE   = `tardmart-shell-${CACHE_VERSION}`;

// Assets Vite emits with content-hash filenames — safe to cache aggressively.
const STATIC_EXTENSIONS = ['.js', '.css', '.woff', '.woff2', '.ttf', '.png', '.svg', '.ico'];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add('/'))
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. API calls — always go to the network, never touch the cache.
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it normally
  }

  // 2. Static assets with hash-based filenames — cache-first.
  const ext = url.pathname.substring(url.pathname.lastIndexOf('.'));
  if (STATIC_EXTENSIONS.includes(ext)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // 3. Navigation requests (HTML) — network-first, fall back to cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(SHELL_CACHE).then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
});
