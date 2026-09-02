/* Service Worker：App Shell + 数据离线缓存（cache-first，后台静默更新） */
'use strict';

const CACHE_VERSION = 'travel-h5-v26-dynamic';
const PRECACHE = [
  './',
  'index.html',
  'trip.html',
  'css/style.css',
  'js/config.js',
  'js/util.js',
  'js/map.js',
  'js/home.js',
  'js/trip.js',
  'data/trips.json',
  'data/trips/xinjiang-2026.json',
  'manifest.webmanifest',
  'assets/icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys
        .filter(function (k) { return k !== CACHE_VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // 高德等第三方资源不走离线缓存

  event.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(request).then(function (cached) {
        const fetched = fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        }).catch(function () {
          return cached || new Response('离线且无缓存', { status: 504, statusText: 'offline' });
        });
        return cached || fetched;
      });
    })
  );
});
