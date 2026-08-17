/**
 * AUTENTICACIÓN COMPARTIDA.
 *
 * Los dos backends de Firebase —el de Firestore y el de Realtime Database—
 * usan exactamente el mismo login: misma app, mismo proveedor de Google, mismo
 * apaño de redirect para móvil. Vive aquí para que no se separen con el tiempo
 * y para que arreglar el login sea arreglarlo una vez.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  updateProfile,
  type Auth,
} from 'firebase/auth';

import { FIREBASE_CONFIG, resolveAuthDomain } from '../../../config/env';
import type { AuthUser } from '../../../types';
import { BackendError, type Unsub } from '../types';

/** La app de Firebase, creada una sola vez aunque cambie el backend activo. */
export function firebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp({
    apiKey: FIREBASE_CONFIG.apiKey!,
    // Mismo origen cuando se sirve desde Firebase Hosting: imprescindible
    // para que el login funcione en móvil (ver `resolveAuthDomain`).
    authDomain: resolveAuthDomain()!,
    projectId: FIREBASE_CONFIG.projectId!,
    storageBucket: FIREBASE_CONFIG.storageBucket,
    messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
    appId: FIREBASE_CONFIG.appId!,
    databaseURL: FIREBASE_CONFIG.databaseURL,
  });
}

export async function prepararAuth(app: FirebaseApp): Promise<Auth> {
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence).catch(() => {});
  // Recoge el resultado si volvemos de un signInWithRedirect (móvil).
  await getRedirectResult(auth).catch(() => null);
  return auth;
}

export function observarAuth(auth: Auth, cb: (u: AuthUser | null) => void): Unsub {
  return onAuthStateChanged(auth, (u) => {
    cb(
      u
        ? {
            uid: u.uid,
            displayName: u.displayName,
            photoURL: u.photoURL,
            email: u.email,
            isAnonymous: u.isAnonymous,
          }
        : null,
    );
  });
}

export async function entrarConGoogle(auth: Auth): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    // Los popups fallan a menudo en navegadores móviles / con bloqueadores.
    if (
      code.includes('popup-blocked') ||
      code.includes('popup-closed-by-user') ||
      code.includes('operation-not-supported')
    ) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw new BackendError(describeAuthError(code), code);
  }
}

export async function entrarComoInvitado(auth: Auth, nickname?: string): Promise<void> {
  const cred = await signInAnonymously(auth);
  if (nickname) {
    await updateProfile(cred.user, { displayName: nickname.slice(0, 20) }).catch(() => {});
  }
}

export async function salir(auth: Auth): Promise<void> {
  await fbSignOut(auth);
}

export function describeAuthError(code: string): string {
  if (code.includes('unauthorized-domain'))
    return 'Dominio no autorizado en Firebase Auth. Añádelo en Authentication → Settings → Authorized domains.';
  if (code.includes('configuration-not-found'))
    return 'El proveedor de Google no está activado en Firebase Authentication.';
  if (code.includes('network-request-failed'))
    return 'Sin conexión con Firebase.';
  return 'No se pudo iniciar sesión con Google.';
}
