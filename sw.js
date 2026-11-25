/* TaskFlow PWA Service Worker — Caches static shell ONLY (never /api/*) */
'use strict';

var CACHE_NAME = 'taskflow-shell-v3';
var SHELL_ASSETS = [
  '/',
  '/index.html',
  '/privacy.html',
  '/manifest.webmanifest',
  '/css/tokens.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/analytics.css',
  '/js/state.js',
  '/js/timer.js',
  '/js/tasks-ui.js',
  '/js/routines-ui.js',
  '/js/analytics-ui.js',
  '/js/auth-ui.js',
  '/js/app.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return Promise.resolve();
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (!req || req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never intercept or cache /api/* routes (OAuth, cloud workspace, Telegram webhooks)
  if (url.pathname.indexOf('/api/') === 0) return;

  event.respondWith(
    fetch(req).then(function (response) {
      if (response && response.ok && response.type === 'basic') {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, copy).catch(function () {});
        });
      }
      return response;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          if (url.pathname === '/privacy.html') {
            return caches.match('/privacy.html');
          }
          return caches.match('/index.html');
        }
        return undefined;
      });
    })
  );
});
