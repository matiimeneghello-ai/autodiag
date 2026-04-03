const CACHE_NAME = 'autodiag-v2';
const STATIC_CACHE = [
  '/',
  '/app',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap',
];

// Install — cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_CACHE))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API calls — always network, never cache
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ ok: false, error: 'Sin conexión — modo offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets — network first, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
  );
});

// Background sync for offline scans (future)
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-scans') {
    e.waitUntil(syncOfflineScans());
  }
});

async function syncOfflineScans() {
  // Future: sync scans stored offline
  console.log('AutoDiag: syncing offline data...');
}
