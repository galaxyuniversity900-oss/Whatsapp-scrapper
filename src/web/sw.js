'use strict';
const CACHE_NAME = 'wa-workspace-shell-v2';
const SHELL = ['/', '/manifest.json'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('wa-workspace-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses, auth material, QR codes, contacts, or campaign data.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('token=')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('/', response.clone()));
      return response;
    }).catch(async () => (await caches.match('/')) || new Response('Workspace is offline. Reconnect to the local WhatsApp engine and reload.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
    return;
  }
  if (url.pathname === '/manifest.json') {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
});
