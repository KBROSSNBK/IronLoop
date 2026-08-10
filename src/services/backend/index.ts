import { BACKEND_KIND } from '../../config/env';
import type { Backend } from './types';

let instance: Backend | null = null;
let initPromise: Promise<Backend> | null = null;

/**
 * Devuelve el backend activo, inicializándolo una sola vez.
 * La elección (Firebase vs local) depende de si hay credenciales en .env.
 */
export function getBackend(): Promise<Backend> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (BACKEND_KIND === 'firebase') {
      const { FirebaseBackend } = await import('./firebase/firebaseBackend');
      instance = new FirebaseBackend();
    } else {
      const { LocalBackend } = await import('./local/localBackend');
      instance = new LocalBackend();
    }
    await instance.init();
    return instance;
  })();
  return initPromise;
}

/** Acceso síncrono una vez inicializado (para el bucle de juego). */
export function backendSync(): Backend {
  if (!instance) throw new Error('Backend no inicializado');
  return instance;
}

export type { Backend, Unsub } from './types';
