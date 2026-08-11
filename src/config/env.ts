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
 * Por defecto se usa el `<proyecto>.firebaseapp.com` que viene en la
 * configuración, porque es el ÚNICO redirect URI que Google registra
 * automáticamente al activar el proveedor. Usar otro dominio sin darlo de alta
 * provoca `Error 400: redirect_uri_mismatch` en el login.
 *
 * Opcionalmente se puede servir el handler de OAuth desde el propio dominio de
 * Hosting (mismo origen), lo que evita depender de cookies de terceros y hace
 * `signInWithRedirect` mucho más fiable en Safari/iOS. Para activarlo:
 *
 *   1. Google Cloud Console → APIs y servicios → Credenciales
 *   2. Abrir el "Web client (auto created by Google Service)" del proyecto
 *   3. Añadir en *URI de redireccionamiento autorizados*:
 *        https://TU-DOMINIO/__/auth/handler
 *   4. Poner VITE_AUTH_SAME_ORIGIN=true y volver a desplegar
 *
 * Ver FIREBASE_SETUP.md § "Login fiable en móvil".
 */
export const AUTH_SAME_ORIGIN = env.VITE_AUTH_SAME_ORIGIN === 'true';

export function resolveAuthDomain(): string | undefined {
  const configured = FIREBASE_CONFIG.authDomain;
  if (!AUTH_SAME_ORIGIN || typeof window === 'undefined') return configured;
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
