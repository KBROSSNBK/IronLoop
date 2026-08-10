/**
 * BACKEND FIREBASE.
 *
 * Reparto de responsabilidades (justificado en README.md § Arquitectura):
 *   · Firestore            → datos PERSISTENTES (usuario, fábrica, miembros).
 *                            Escrituras poco frecuentes y transaccionales.
 *   · Realtime Database    → datos EFÍMEROS (posición, dirección, actividad,
 *                            presencia). Escrituras frecuentes y baratas, con
 *                            `onDisconnect` para limpiar al desconectar.
 *   · Cloud Functions      → operaciones críticas cuando se activan
 *                            (VITE_USE_FUNCTIONS=true). Si no, las mismas
 *                            operaciones corren en transacciones de cliente
 *                            acotadas por las Security Rules.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
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
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import {
  get as rtdbGet,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  remove,
  set as rtdbSet,
  type Database,
} from 'firebase/database';
import {
  getFunctions,
  httpsCallable,
  type Functions,
} from 'firebase/functions';

import { FIREBASE_CONFIG } from '../../../config/env';
import { BALANCE } from '../../../config/balance';
import type {
  AuthUser,
  FactoryMember,
  FactoryState,
  PlayerState,
  PresenceState,
} from '../../../types';
import {
  createFactoryState,
  createMember,
  createPlayerState,
  normalizeFactory,
  normalizePlayer,
} from '../../../game/logic/defaults';
import { runOp as runOpLocal, type OpName, type OpOutcome } from '../ops';
import { BackendError, type Backend, type Unsub } from '../types';

const USE_FUNCTIONS = import.meta.env.VITE_USE_FUNCTIONS === 'true';

export class FirebaseBackend implements Backend {
  readonly kind = 'firebase' as const;
  readonly label = 'Firebase';

  private app!: FirebaseApp;
  private auth!: Auth;
  private db!: Firestore;
  private rtdb: Database | null = null;
  private fns: Functions | null = null;
  private presenceArmed = new Set<string>();

  async init(): Promise<void> {
    this.app = initializeApp({
      apiKey: FIREBASE_CONFIG.apiKey!,
      authDomain: FIREBASE_CONFIG.authDomain!,
      projectId: FIREBASE_CONFIG.projectId!,
      storageBucket: FIREBASE_CONFIG.storageBucket,
      messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
      appId: FIREBASE_CONFIG.appId!,
      databaseURL: FIREBASE_CONFIG.databaseURL,
    });
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);
    if (FIREBASE_CONFIG.databaseURL) this.rtdb = getDatabase(this.app);
    if (USE_FUNCTIONS) this.fns = getFunctions(this.app);

    await setPersistence(this.auth, browserLocalPersistence).catch(() => {});
    // Recoge el resultado si volvemos de un signInWithRedirect (móvil).
    await getRedirectResult(this.auth).catch(() => null);
  }

  /* ─────────────────────────── Autenticación ─────────────────────────── */

  onAuthChanged(cb: (u: AuthUser | null) => void): Unsub {
    return onAuthStateChanged(this.auth, (u) => {
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

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(this.auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      // Los popups fallan a menudo en navegadores móviles / con bloqueadores.
      if (
        code.includes('popup-blocked') ||
        code.includes('popup-closed-by-user') ||
        code.includes('operation-not-supported')
      ) {
        await signInWithRedirect(this.auth, provider);
        return;
      }
      throw new BackendError(describeAuthError(code), code);
    }
  }

  async signInAsGuest(nickname?: string): Promise<void> {
    const cred = await signInAnonymously(this.auth);
    if (nickname) {
      await updateProfile(cred.user, { displayName: nickname.slice(0, 20) }).catch(() => {});
    }
  }

  async signOut(): Promise<void> {
    await fbSignOut(this.auth);
  }

  /* ─────────────────────────── Jugador ─────────────────────────── */

  private userRef(uid: string) {
    return doc(this.db, 'users', uid);
  }

  async loadPlayer(user: AuthUser): Promise<PlayerState> {
    const refDoc = this.userRef(user.uid);
    const snap = await getDoc(refDoc);
    if (snap.exists()) {
      const player = normalizePlayer(snap.data() as Partial<PlayerState>, user);
      // Refresca datos de la cuenta Google sin tocar el progreso.
      await updateDoc(refDoc, {
        name: player.name,
        photoURL: user.photoURL ?? null,
        lastSeenAt: Date.now(),
      }).catch(() => {});
      return player;
    }
    const fresh = createPlayerState(user);
    await setDoc(refDoc, fresh);
    return fresh;
  }

  watchPlayer(uid: string, cb: (p: PlayerState) => void): Unsub {
    return onSnapshot(this.userRef(uid), (snap) => {
      if (!snap.exists()) return;
      cb(normalizePlayer(snap.data() as Partial<PlayerState>));
    });
  }

  async savePlayerSoft(uid: string, patch: Partial<PlayerState>): Promise<void> {
    // Sólo campos no críticos: estamina, presencia, tiempo jugado.
    const allowed: Partial<PlayerState> = {};
    if (patch.stamina !== undefined) allowed.stamina = patch.stamina;
    if (patch.staminaAt !== undefined) allowed.staminaAt = patch.staminaAt;
    if (patch.lastSeenAt !== undefined) allowed.lastSeenAt = patch.lastSeenAt;
    if (patch.stats !== undefined) allowed.stats = patch.stats;
    if (Object.keys(allowed).length === 0) return;
    await updateDoc(this.userRef(uid), allowed as Record<string, unknown>).catch(() => {});
  }

  /* ─────────────────────────── Fábrica ─────────────────────────── */

  private factoryRef(fid: string) {
    return doc(this.db, 'factories', fid);
  }

  private memberRef(fid: string, uid: string) {
    return doc(this.db, 'factories', fid, 'members', uid);
  }

  async joinFactory(player: PlayerState): Promise<string> {
    // 1. Si ya tiene fábrica asignada y sigue existiendo, vuelve a ella.
    if (player.factoryId) {
      const snap = await getDoc(this.factoryRef(player.factoryId));
      if (snap.exists()) {
        await this.attachMember(player.factoryId, player);
        return player.factoryId;
      }
    }

    // 2. Busca fábricas con hueco (una sola query, índice automático).
    const q = query(
      collection(this.db, 'factories'),
      where('playerCount', '<', BALANCE.factory.maxPlayers),
      orderBy('playerCount', 'desc'), // prioriza fábricas con gente: mundo más vivo
      limit(5),
    );
    const candidates = await getDocs(q);
    for (const candidate of candidates.docs) {
      const ok = await this.attachMember(candidate.id, player).catch(() => false);
      if (ok !== false) return candidate.id;
    }

    // 3. Ninguna disponible: crea una nueva.
    return this.createFactory(player);
  }

  private async createFactory(player: PlayerState): Promise<string> {
    const counterRef = doc(this.db, 'meta', 'counters');
    const fid = doc(collection(this.db, 'factories')).id;
    const index = await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(counterRef);
      const next = ((snap.data()?.factories as number) ?? 0) + 1;
      tx.set(counterRef, { factories: next }, { merge: true });
      return next;
    }).catch(() => Math.floor(Math.random() * 900) + 1);

    const factory = createFactoryState(fid, index);
    await setDoc(this.factoryRef(fid), { ...factory, playerCount: 1 });
    await setDoc(this.memberRef(fid, player.uid), createMember(player));
    await updateDoc(this.userRef(player.uid), { factoryId: fid });
    return fid;
  }

  /** Añade al jugador a la fábrica respetando el límite de plazas. */
  private async attachMember(fid: string, player: PlayerState): Promise<boolean> {
    return runTransaction(this.db, async (tx) => {
      const fRef = this.factoryRef(fid);
      const mRef = this.memberRef(fid, player.uid);
      const [fSnap, mSnap] = await Promise.all([tx.get(fRef), tx.get(mRef)]);
      if (!fSnap.exists()) throw new BackendError('La fábrica ya no existe');

      const alreadyMember = mSnap.exists();
      const count = (fSnap.data().playerCount as number) ?? 0;
      if (!alreadyMember && count >= BALANCE.factory.maxPlayers) {
        throw new BackendError('Fábrica llena');
      }

      if (alreadyMember) {
        tx.update(mRef, {
          name: player.name,
          level: player.level,
          money: player.money,
          lastSeenAt: Date.now(),
        });
      } else {
        tx.set(mRef, createMember(player));
        tx.update(fRef, { playerCount: count + 1, updatedAt: Date.now() });
      }
      tx.update(this.userRef(player.uid), { factoryId: fid });
      return true;
    });
  }

  async leaveFactory(fid: string, uid: string): Promise<void> {
    // El progreso y la pertenencia se conservan; sólo se limpia la presencia.
    await this.clearPresence(fid, uid);
    await updateDoc(this.memberRef(fid, uid), { lastSeenAt: Date.now() }).catch(() => {});
  }

  watchFactory(fid: string, cb: (f: FactoryState) => void): Unsub {
    return onSnapshot(this.factoryRef(fid), (snap) => {
      if (!snap.exists()) return;
      cb(normalizeFactory(snap.data() as Partial<FactoryState>, fid));
    });
  }

  watchMembers(fid: string, cb: (m: FactoryMember[]) => void): Unsub {
    return onSnapshot(collection(this.db, 'factories', fid, 'members'), (snap) => {
      cb(snap.docs.map((d) => d.data() as FactoryMember));
    });
  }

  /* ─────────────────────────── Operaciones ─────────────────────────── */

  async runOp(
    uid: string,
    fid: string,
    op: OpName,
    args: unknown,
  ): Promise<OpOutcome> {
    if (this.fns) {
      // Ruta segura de producción: la Cloud Function ejecuta el mismo reductor
      // con tiempo de servidor y devuelve el resultado.
      try {
        const call = httpsCallable<
          { factoryId: string; op: OpName; args: unknown },
          OpOutcome
        >(this.fns, 'gameOp');
        const res = await call({ factoryId: fid, op, args });
        return res.data;
      } catch (e) {
        return {
          ok: false,
          reason: e instanceof Error ? e.message : 'Error de servidor',
          events: [],
        };
      }
    }

    // Ruta de cliente: transacción sobre usuario + fábrica + miembro.
    // Las Security Rules limitan lo que se puede escribir (ver firestore.rules).
    try {
      return await runTransaction(this.db, async (tx) => {
        const uRef = this.userRef(uid);
        const fRef = this.factoryRef(fid);
        const mRef = this.memberRef(fid, uid);
        const [uSnap, fSnap, mSnap] = await Promise.all([
          tx.get(uRef),
          tx.get(fRef),
          tx.get(mRef),
        ]);
        if (!uSnap.exists() || !fSnap.exists()) {
          return { ok: false, reason: 'Estado no disponible', events: [] } as OpOutcome;
        }

        const player = normalizePlayer(uSnap.data() as Partial<PlayerState>);
        const factory = normalizeFactory(fSnap.data() as Partial<FactoryState>, fid);
        const out = runOpLocal(op, player, factory, args);
        if (!out.ok) return out;

        if (out.player) tx.set(uRef, out.player);
        if (out.factory) tx.set(fRef, { ...out.factory, updatedAt: Date.now() });

        if (mSnap.exists()) {
          const cur = mSnap.data() as FactoryMember;
          const next: FactoryMember = { ...cur, lastSeenAt: Date.now() };
          for (const [k, v] of Object.entries(out.memberDelta ?? {})) {
            if (k === 'money') next.money = v as number;
            else
              (next as unknown as Record<string, number>)[k] =
                ((next as unknown as Record<string, number>)[k] ?? 0) + (v as number);
          }
          if (out.player) {
            next.level = out.player.level;
            next.name = out.player.name;
            next.money = out.player.money;
          }
          tx.set(mRef, next);
        }
        return out;
      });
    } catch (e) {
      return {
        ok: false,
        reason: e instanceof Error ? e.message : 'Conflicto de transacción',
        events: [],
      };
    }
  }

  /* ─────────────────────── Presencia (Realtime DB) ─────────────────────── */

  private presenceRef(fid: string, uid: string) {
    if (!this.rtdb) return null;
    return ref(this.rtdb, `presence/${fid}/${uid}`);
  }

  publishPresence(fid: string, state: PresenceState): void {
    const r = this.presenceRef(fid, state.uid);
    if (!r) return;

    const key = `${fid}/${state.uid}`;
    if (!this.presenceArmed.has(key)) {
      this.presenceArmed.add(key);
      // Limpieza automática si el cliente se cae, cierra o pierde red.
      onDisconnect(r).remove().catch(() => {});
      // Re-arma el onDisconnect tras cada reconexión.
      const connRef = ref(this.rtdb!, '.info/connected');
      onValue(connRef, (snap) => {
        if (snap.val() === true) onDisconnect(r).remove().catch(() => {});
      });
    }
    rtdbSet(r, state).catch(() => {});
  }

  watchPresence(
    fid: string,
    selfUid: string,
    cb: (p: PresenceState[]) => void,
  ): Unsub {
    if (!this.rtdb) {
      cb([]);
      return () => {};
    }
    const roomRef = ref(this.rtdb, `presence/${fid}`);
    return onValue(roomRef, (snap) => {
      const val = (snap.val() ?? {}) as Record<string, PresenceState>;
      const now = Date.now();
      const list = Object.values(val).filter(
        (p) => p && p.uid !== selfUid && now - (p.t ?? 0) < BALANCE.net.staleAfterMs,
      );
      cb(list);
    });
  }

  async clearPresence(fid: string, uid: string): Promise<void> {
    const r = this.presenceRef(fid, uid);
    if (r) await remove(r).catch(() => {});
    this.presenceArmed.delete(`${fid}/${uid}`);
  }

  /** Comprueba si la Realtime Database responde (diagnóstico de setup). */
  async pingRealtime(): Promise<boolean> {
    if (!this.rtdb) return false;
    try {
      await rtdbGet(ref(this.rtdb, '.info/serverTimeOffset'));
      return true;
    } catch {
      return false;
    }
  }

  /* ─────────────────────────── Debug ─────────────────────────── */

  async debugPatchPlayer(uid: string, patch: Partial<PlayerState>): Promise<void> {
    await updateDoc(this.userRef(uid), patch as Record<string, unknown>);
  }

  async debugPatchFactory(fid: string, patch: Partial<FactoryState>): Promise<void> {
    await updateDoc(this.factoryRef(fid), patch as Record<string, unknown>);
  }
}

function describeAuthError(code: string): string {
  if (code.includes('unauthorized-domain'))
    return 'Dominio no autorizado en Firebase Auth. Añádelo en Authentication → Settings → Authorized domains.';
  if (code.includes('configuration-not-found'))
    return 'El proveedor de Google no está activado en Firebase Authentication.';
  if (code.includes('network-request-failed'))
    return 'Sin conexión con Firebase.';
  return 'No se pudo iniciar sesión con Google.';
}
