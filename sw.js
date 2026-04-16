/**
 * ConstructCo Service Worker
 * Strategy: Cache-First with Network Fallback
 * Cache version: constructco-v1
 *
 * Update CACHE_NAME to bust the cache on re-deploy (e.g. constructco-v2).
 */

const CACHE_NAME = 'constructco-v1';

// Core app-shell files to pre-cache on install
const APP_SHELL = [
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── INSTALL ─────────────────────────────────────────────
// Pre-cache all app-shell files immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installing…');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      return cache.addAll(APP_SHELL);
    }).then(() => {
      // Force this SW to become active immediately (skip waiting)
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ────────────────────────────────────────────
// Delete any old caches from a previous version
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating…');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Take control of all open clients immediately
      return self.clients.claim();
    })
  );
});

// ── FETCH ────────────────────────────────────────────────
// Cache-First: serve from cache; on miss fetch from network and cache it.
// On network error: serve offline.html for navigation requests.
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests that aren't part of our app
  // (Supabase API calls, CDN assets, etc. — always go to network)
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.hostname.includes('cdn.') ||
                url.hostname.includes('unpkg.com') ||
                url.hostname.includes('fonts.') ||
                url.hostname.includes('supabase.');

  if (!isSameOrigin || isCDN) {
    // Network-only for CDN / Supabase (live data & 3rd-party scripts)
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Serve from cache; also refresh it in background (stale-while-revalidate)
        const networkFetch = fetch(event.request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {/* silently ignore background refresh errors */});
        return cached;
      }

      // Not in cache — fetch from network and cache the response
      return fetch(event.request).then((response) => {
        if (!response || !response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Network failed — show offline page for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
        // For other assets (images, scripts) return a transparent 1px response
        return new Response('', { status: 204 });
      });
    })
  );
});
