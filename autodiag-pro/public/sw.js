// Service Worker v4 — minimal, no caching of HTML
const CACHE_NAME = 'autodiag-v5';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only cache fonts, never HTML
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // API and WebSocket — always network
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  
  // HTML — always network, no cache
  if (e.request.destination === 'document') {
    e.respondWith(fetch(e.request));
    return;
  }
  
  // Google Fonts — cache
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || 
        fetch(e.request).then(r => {
          const clone = r.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return r;
        })
      )
    );
    return;
  }
  
  // Everything else — network
});
