/**
 * Service Worker de IRONLOOP.
 *
 * Estrategia:
 *  · App shell (HTML/JS/CSS/iconos) → cache-first con actualización en segundo
 *    plano: la partida abre al instante y sin conexión muestra un aviso claro.
 *  · Peticiones a Firebase / Google → SIEMPRE red. Nunca se cachean datos de
 *    juego: el estado debe venir del servidor.
 */

const VERSION = 'ironloop-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-64.png',
];

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
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) return;

  // Navegación: red primero (para recibir despliegues nuevos), cache de reserva.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Recursos estáticos: cache primero + revalidación silenciosa.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
