import { BACKEND_KIND } from '../../config/env';
import { setMeterMode } from '../writeMeter';
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
    // La RTDB cobra por datos, Firestore por operaciones: el medidor de la
    // esquina tiene que enseñar la cuota que de verdad se está gastando.
    setMeterMode(BACKEND_KIND === 'rtdb' ? 'data' : 'ops');

    if (BACKEND_KIND === 'rtdb') {
      const { RtdbBackend } = await import('./rtdb/rtdbBackend');
      instance = new RtdbBackend();
    } else if (BACKEND_KIND === 'firebase') {
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

/**
 * Vuelve a Firestore cuando la Realtime Database rechaza la partida.
 *
 * Sólo pasa por una razón: el código nuevo se ha publicado antes que las
 * reglas (`firebase deploy --only database`). Sin esto, ese despiste dejaría a
 * todo el mundo mirando una pantalla de error; con esto se sigue jugando en el
 * backend viejo, que no se ha ido a ninguna parte, y basta con desplegar las
 * reglas para que la próxima recarga ya entre por el nuevo.
 */
export async function caerAFirestore(): Promise<Backend | null> {
  if (BACKEND_KIND !== 'rtdb' || instance?.kind === 'firebase') return null;
  const { FirebaseBackend } = await import('./firebase/firebaseBackend');
  const alterno = new FirebaseBackend();
  await alterno.init();
  instance = alterno;
  initPromise = Promise.resolve(alterno);
  setMeterMode('ops');
  return alterno;
}

/** ¿El fallo es «las reglas de la RTDB no están desplegadas»? */
export function esFaltaDeReglas(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /permission[_ ]denied/i.test(msg);
}

export type { Backend, Unsub } from './types';
