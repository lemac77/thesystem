// No cache - always fetch from network
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  // Just fetch, never cache
  e.respondWith(fetch(e.request).catch(() => new Response('Offline', {status: 503})));
});
