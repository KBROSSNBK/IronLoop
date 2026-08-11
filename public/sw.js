/**
 * Service Worker de IRONLOOP.
 *
 * Estrategia:
 *  · Navegación (HTML) → SIEMPRE red primero, con la caché sólo como red de
 *    seguridad si no hay conexión. Así un despliegue nuevo se ve al instante.
 *  · Assets con hash en el nombre → caché primero (son inmutables).
 *  · Firebase / Google → nunca se cachean: el estado debe venir del servidor.
 *
 * IMPORTANTE: sube VERSION en cada cambio de esta estrategia. Al activarse,
 * borra todas las cachés anteriores y avisa a las pestañas para que recarguen,
 * lo que evita que un móvil se quede clavado en una versión antigua.
 */

const VERSION = 'ironloop-v3';

const SHELL = ['./', './index.html', './manifest.webmanifest'];

const NETWORK_ONLY_HOSTS = [
  'firestore.googleapis.com',
  'firebasedatabase.app',
  'firebaseio.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
  'apis.google.com',
  'accounts.google.com',
  'cloudfunctions.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        // Avisa a las pestañas abiertas de que hay versión nueva.
        for (const client of clients) client.postMessage({ type: 'SW_UPDATED', version: VERSION });
      }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) return;

  // Navegación: red primero. Nunca se sirve HTML viejo si hay conexión.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches
            .match('./index.html')
            .then((r) => r ?? new Response('Sin conexión', { status: 503 })),
        ),
    );
    return;
  }

  // Sólo se cachean recursos propios. Los assets llevan hash: son inmutables.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => new Response('', { status: 504 }));
    }),
  );
});
