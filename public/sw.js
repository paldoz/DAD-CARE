// v6-landing: Bumped to force-clear old cache that had stale / route
const CACHE_NAME = 'dadcare-v6-landing';
const STATIC_ASSETS = [
  '/dashboard',
  '/customers',
  '/ledger',
  '/daily-book',
  '/payments',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
  // NOTE: '/' (landing page) intentionally excluded — must always fetch fresh
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          return caches.delete(cacheName);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Pass all requests straight to the network, no caching.
});
