const CACHE_NAME = 'autodiag-v3';
const STATIC_CACHE = [
  '/manifest.json',
];

// Install — minimal cache
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_CACHE))
  );
  self.skipWaiting();
});

// Activate — clean old caches immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('SW: deleting old cache', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API calls — ALWAYS go direct to network, NO SW interference
  // Use a timeout so they don't hang forever
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    e.respondWith(
      Promise.race([
        fetch(e.request.clone()),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 25000)
        )
      ]).catch((err) => {
        const msg = err.message === 'timeout'
          ? 'El servidor tardó demasiado. Recargá la página.'
          : 'Sin conexión al servidor.';
        return new Response(JSON.stringify({ ok: false, error: msg }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // WebSocket — never intercept
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // HTML pages — ALWAYS network, never cache
  // This ensures landing and app always load fresh from server
  if (e.request.destination === 'document' || 
      e.request.url.includes('railway.app/') ||
      e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Static assets (fonts, icons) — cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok && e.request.url.includes('fonts.googleapis')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
