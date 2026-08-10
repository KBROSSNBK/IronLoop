/**
 * Registro del Service Worker.
 * En desarrollo se salta para no cachear módulos de Vite.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((e) => console.warn('[pwa] no se pudo registrar el SW', e));
  });
}
