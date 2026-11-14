'use strict';

const CACHE_NAME = 'tradepath-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/tradepath-192.png',
  '/icons/tradepath-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('tradepath-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const appShell = await cache.match('/');
        if (appShell) return appShell;
      }
      throw error;
    }
  })());
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.warn('TradePath received a push notification with invalid JSON.', error);
  }
  const title = typeof payload.title === 'string' ? payload.title : 'Mr T · hourly chart review';
  const body = typeof payload.body === 'string'
    ? payload.body
    : 'Your scheduled chart review is ready. Open TradePath to see the observations.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/tradepath-192.png',
    badge: '/icons/tradepath-192.png',
    tag: 'tradepath-hourly-review',
    data: { url: typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/#mt5' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || '/#mt5', self.location.origin);
  const destination = requestedUrl.origin === self.location.origin
    ? requestedUrl.href
    : new URL('/#mt5', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    const appClient = windowClients.find(client => new URL(client.url).origin === self.location.origin);
    if (appClient) {
      return appClient.navigate(destination).then(client => client ? client.focus() : undefined);
    }
    return clients.openWindow(destination);
  }));
});
