/**
 * Configuración de entorno.
 *
 * El juego arranca SIEMPRE, tenga o no credenciales de Firebase:
 *  - Con credenciales  → backend Firebase (Auth Google + Firestore + RTDB).
 *  - Sin credenciales  → backend Local (localStorage + BroadcastChannel).
 *    El modo local es multiplayer real entre pestañas del mismo navegador,
 *    lo que permite probar el loop completo sin configurar nada.
 */

const env = import.meta.env;

export const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL as string | undefined,
};

/**
 * authDomain efectivo.
 *
 * Si la app se sirve desde su propio dominio de Firebase Hosting, usamos ESE
 * dominio como authDomain en lugar de `<proyecto>.firebaseapp.com`. Firebase
 * Hosting publica el handler de OAuth en `/__/auth/handler`, así que el login
 * pasa a ser del MISMO origen y deja de depender de cookies de terceros.
 *
 * Eso es justo lo que rompe `signInWithRedirect` en Safari/iOS y en Chrome con
 * el bloqueo de cookies de terceros activado — es decir, en buena parte de los
 * móviles. Fuera de Hosting se usa el valor configurado en .env.
 */
export function resolveAuthDomain(): string | undefined {
  const configured = FIREBASE_CONFIG.authDomain;
  if (typeof window === 'undefined') return configured;
  const host = window.location.hostname;
  if (host.endsWith('.web.app') || host.endsWith('.firebaseapp.com')) return host;
  return configured;
}

export const HAS_FIREBASE_CONFIG = Boolean(
  FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.projectId &&
    FIREBASE_CONFIG.appId &&
    FIREBASE_CONFIG.authDomain,
);

/** Fuerza el backend local aunque haya credenciales (útil para desarrollar). */
export const FORCE_LOCAL_BACKEND = env.VITE_FORCE_LOCAL === 'true';

export type BackendKind = 'firebase' | 'local';

export const BACKEND_KIND: BackendKind =
  HAS_FIREBASE_CONFIG && !FORCE_LOCAL_BACKEND ? 'firebase' : 'local';

/** Panel de admin/debug. Sólo en dev, o con VITE_ENABLE_DEBUG=true. */
export const DEBUG_ENABLED =
  env.DEV || env.VITE_ENABLE_DEBUG === 'true';

/** UIDs con permisos de admin en producción (validado también en las rules). */
export const ADMIN_UIDS: string[] = ((env.VITE_ADMIN_UIDS as string) || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const APP_VERSION = '0.1.0-mvp';
