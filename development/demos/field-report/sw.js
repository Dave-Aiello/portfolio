/*
 * Service worker: keeps the app working with no signal.
 * Pages: network first, so updates arrive, with the cached copy as fallback.
 * Scripts, styles and fonts: cache first, refreshed in the background.
 */
var CACHE = 'field-reports-v1';
var SHELL = [
  './',
  'index.html',
  'app.css',
  'js/store.js',
  'js/photos.js',
  'js/signature.js',
  'js/app.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  '../../vendor/jquery/jquery-3.7.1.min.js',
  '../../vendor/bootstrap/bootstrap.min.css',
  '../../vendor/bootstrap/bootstrap.bundle.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put('index.html', copy); });
        return response;
      }).catch(function () {
        return caches.match('index.html');
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      var refresh = fetch(request).then(function (response) {
        if (response && (response.ok || response.type === 'opaque')) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || refresh;
    })
  );
});
