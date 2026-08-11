/**
 * Registro del Service Worker y actualización automática.
 *
 * Un móvil que instaló la app hace días puede quedarse con una versión vieja
 * cacheada. Para evitarlo:
 *   · se comprueba si hay versión nueva en cada arranque y al volver a la app,
 *   · cuando el SW nuevo toma el control, la página se recarga una sola vez.
 */

const RELOAD_FLAG = 'ironloop:sw-reloaded';

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((reg) => {
        reg.update().catch(() => {});
        // Vuelve a comprobar al recuperar el foco (típico en móvil).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
        // Si ya hay un SW esperando, que tome el control cuanto antes.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch((e) => console.warn('[pwa] no se pudo registrar el SW', e));

    // Recarga UNA vez cuando el control pasa a un SW nuevo.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    });
  });
}

/**
 * Borra service workers y cachés. Es la salida de emergencia cuando un
 * dispositivo se queda atascado en una versión antigua.
 */
export async function hardReset(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    sessionStorage.removeItem(RELOAD_FLAG);
    window.location.replace(`${location.origin}${location.pathname}?fresh=${Date.now()}`);
  }
}
