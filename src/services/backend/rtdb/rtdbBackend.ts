/**
 * BACKEND REALTIME DATABASE.
 *
 * POR QUÉ EXISTE
 * Firestore cobra por OPERACIONES: 20.000 escrituras al día en el plan
 * gratuito. Una fábrica con perros, drones y el CAEX trabajando se las come en
 * una tarde y la partida muere con «Quota exceeded». La Realtime Database cobra
 * por DATOS (10 GB de bajada al mes), y este juego mueve poquísimos datos: el
 * estado entero de una fábrica cabe en unos pocos kilobytes.
 *
 * CÓMO SE MANTIENE LA ATOMICIDAD SIN TRANSACCIONES
 * Firestore daba una transacción que abarcaba jugador + fábrica + miembro. La
 * RTDB sólo sabe transaccionar UN nodo, así que aquí se usan dos herramientas:
 *
 *   1. `update()` con varias rutas absolutas es ATÓMICO: o entran todas o no
 *      entra ninguna. Con eso, jugador y fábrica siguen cambiando a la vez.
 *   2. Para detectar carreras entre jugadores, la fábrica lleva un contador
 *      `rev`. Cada escritura manda `rev + 1` y las reglas de seguridad exigen
 *      que sea exactamente el siguiente. Si dos tripulantes escriben a la vez,
 *      el segundo es rechazado, se refresca y reintenta. Es el mismo
 *      «compara y cambia» que hacía Firestore, hecho a mano.
 *
 * Las operaciones de un jugador que NO tocan la fábrica (ponerse un gorro,
 * cobrar una misión) no llevan `rev`: sólo su dueño escribe ahí y la cola de
 * `useSessionStore` ya las serializa.
 *
 * POR QUÉ SALE TAN BARATO
 * No se manda el documento entero en cada recado: `diffRutas` compara el estado
 * viejo con el nuevo y manda sólo las hojas que cambiaron. Y no hace falta leer
 * antes de escribir, porque los `onValue` ya mantienen el estado al día.
 */

import {
  get,
  getDatabase,
  increment,
  limitToLast,
  onDisconnect,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type Database,
} from 'firebase/database';
import type { Auth } from 'firebase/auth';

import { BALANCE } from '../../../config/balance';
import { FIREBASE_CONFIG } from '../../../config/env';
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
import { addBytes } from '../../writeMeter';
import { runOp as runOpLocal, type OpName, type OpOutcome } from '../ops';
import { BackendError, type Backend, type Unsub } from '../types';
import {
  entrarComoInvitado,
  entrarConGoogle,
  firebaseApp,
  observarAuth,
  prepararAuth,
  salir,
} from '../firebase/authCore';
import { diffRutas, limpiar, pesoAprox, sinRev } from './paths';
import { importarDesdeFirestore } from './migrate';

/** Reintentos cuando otro jugador se nos adelanta escribiendo la fábrica. */
const REINTENTOS = 4;

export class RtdbBackend implements Backend {
  readonly kind = 'rtdb' as const;
  readonly label = 'Realtime Database';

  private db!: Database;
  private auth!: Auth;
  private presenceArmed = new Set<string>();

  /** Última versión conocida de cada documento, mantenida por los `onValue`. */
  private players = new Map<string, PlayerState>();
  private factories = new Map<string, FactoryState>();
  private revs = new Map<string, number>();

  async init(): Promise<void> {
    if (!FIREBASE_CONFIG.databaseURL) {
      throw new BackendError(
        'Falta VITE_FIREBASE_DATABASE_URL: la Realtime Database no está configurada.',
      );
    }
    const app = firebaseApp();
    this.db = getDatabase(app);
    this.auth = await prepararAuth(app);
  }

  /* ─────────────────────────── Autenticación ─────────────────────────── */

  onAuthChanged(cb: (u: AuthUser | null) => void): Unsub {
    return observarAuth(this.auth, cb);
  }
  signInWithGoogle(): Promise<void> {
    return entrarConGoogle(this.auth);
  }
  signInAsGuest(nickname?: string): Promise<void> {
    return entrarComoInvitado(this.auth, nickname);
  }
  signOut(): Promise<void> {
    return salir(this.auth);
  }

  /* ─────────────────────────── Rutas ─────────────────────────── */

  private rutaJugador(uid: string) {
    return `users/${uid}`;
  }
  private rutaFabrica(fid: string) {
    return `factories/${fid}/state`;
  }
  private rutaMiembro(fid: string, uid: string) {
    return `factories/${fid}/members/${uid}`;
  }
  /** Nodo minúsculo aparte para buscar fábrica sin bajarse su estado entero. */
  private rutaIndice(fid: string) {
    return `factoryIndex/${fid}`;
  }

  private async leer<T>(ruta: string): Promise<T | null> {
    const snap = await get(ref(this.db, ruta));
    if (!snap.exists()) return null;
    const val = snap.val() as T;
    addBytes(pesoAprox(val));
    return val;
  }

  /* ─────────────────────────── Jugador ─────────────────────────── */

  async loadPlayer(user: AuthUser): Promise<PlayerState> {
    const ruta = this.rutaJugador(user.uid);
    let raw = await this.leer<Partial<PlayerState> & { rev?: number }>(ruta);

    // Primera vez en la RTDB: si este jugador ya tenía partida en Firestore se
    // trae tal cual, para que la migración no le cueste su progreso.
    if (!raw) {
      const rescatado = await importarDesdeFirestore(this.db, user.uid);
      if (rescatado) raw = rescatado;
    }

    if (raw) {
      this.revs.set(ruta, raw.rev ?? 0);
      const player = normalizePlayer(sinRev(raw), user);
      this.players.set(user.uid, player);
      // Refresca datos de la cuenta sin tocar el progreso.
      await this.escribir({
        [`${ruta}/name`]: player.name,
        [`${ruta}/photoURL`]: user.photoURL ?? null,
        [`${ruta}/lastSeenAt`]: Date.now(),
      }).catch(() => {});
      return player;
    }

    const fresh = createPlayerState(user);
    this.revs.set(ruta, 0);
    this.players.set(user.uid, fresh);
    await this.escribir({ [ruta]: limpiar({ ...fresh, rev: 0 }) });
    return fresh;
  }

  watchPlayer(uid: string, cb: (p: PlayerState) => void): Unsub {
    const ruta = this.rutaJugador(uid);
    return onValue(ref(this.db, ruta), (snap) => {
      if (!snap.exists()) return;
      const raw = snap.val() as Partial<PlayerState> & { rev?: number };
      addBytes(pesoAprox(raw));
      this.revs.set(ruta, raw.rev ?? 0);
      const player = normalizePlayer(sinRev(raw));
      this.players.set(uid, player);
      cb(player);
    });
  }

  async savePlayerSoft(uid: string, patch: Partial<PlayerState>): Promise<void> {
    const ruta = this.rutaJugador(uid);
    const cambios: Record<string, unknown> = {};
    // Sólo campos no críticos: estamina, presencia, tiempo jugado.
    if (patch.stamina !== undefined) cambios[`${ruta}/stamina`] = patch.stamina;
    if (patch.staminaAt !== undefined) cambios[`${ruta}/staminaAt`] = patch.staminaAt;
    if (patch.lastSeenAt !== undefined) cambios[`${ruta}/lastSeenAt`] = patch.lastSeenAt;
    if (patch.stats !== undefined) cambios[`${ruta}/stats`] = limpiar(patch.stats);
    if (Object.keys(cambios).length === 0) return;
    await this.escribir(cambios).catch(() => {});
  }

  /* ─────────────────────────── Fábrica ─────────────────────────── */

  async joinFactory(player: PlayerState): Promise<string> {
    // 1. Si ya tiene fábrica y sigue existiendo, vuelve a ella.
    if (player.factoryId) {
      const existe = await this.leer<{ level?: number }>(
        `${this.rutaFabrica(player.factoryId)}/level`,
      );
      if (existe !== null) {
        await this.apuntarMiembro(player.factoryId, player);
        return player.factoryId;
      }
    }

    // 2. Busca fábricas con hueco en el índice ligero (no en los estados).
    const snap = await get(
      query(ref(this.db, 'factoryIndex'), orderByChild('playerCount'), limitToLast(6)),
    ).catch(() => null);
    if (snap?.exists()) {
      const indice = snap.val() as Record<string, { playerCount?: number }>;
      const conHueco = Object.entries(indice)
        .filter(([, v]) => (v?.playerCount ?? 0) < BALANCE.factory.maxPlayers)
        // Prioriza fábricas con gente: mundo más vivo.
        .sort((a, b) => (b[1]?.playerCount ?? 0) - (a[1]?.playerCount ?? 0));
      for (const [fid] of conHueco) {
        const ok = await this.apuntarMiembro(fid, player).catch(() => false);
        if (ok !== false) return fid;
      }
    }

    // 3. Ninguna disponible: crea una nueva.
    return this.crearFabrica(player);
  }

  private async crearFabrica(player: PlayerState): Promise<string> {
    const fid = push(ref(this.db, 'factories')).key!;
    const tx = await runTransaction(ref(this.db, 'meta/counters/factories'), (n) =>
      ((n as number) ?? 0) + 1,
    ).catch(() => null);
    const index = (tx?.snapshot.val() as number) ?? Math.floor(Math.random() * 900) + 1;

    const factory = { ...createFactoryState(fid, index), playerCount: 1 };
    this.revs.set(this.rutaFabrica(fid), 0);
    this.factories.set(fid, factory);
    await this.escribir({
      [this.rutaFabrica(fid)]: limpiar({ ...factory, rev: 0 }),
      [this.rutaMiembro(fid, player.uid)]: limpiar(createMember(player)),
      [this.rutaIndice(fid)]: { playerCount: 1, name: factory.name, level: 1 },
      [`${this.rutaJugador(player.uid)}/factoryId`]: fid,
    });
    return fid;
  }

  /**
   * Apunta al jugador respetando el aforo. La plaza se reserva con una
   * transacción sobre el contador —ahí sí hay carrera real entre jugadores— y
   * el resto se escribe después.
   */
  private async apuntarMiembro(fid: string, player: PlayerState): Promise<boolean> {
    const rutaM = this.rutaMiembro(fid, player.uid);
    const yaEra = (await this.leer<FactoryMember>(rutaM)) !== null;

    if (!yaEra) {
      const tx = await runTransaction(
        ref(this.db, `${this.rutaFabrica(fid)}/playerCount`),
        (n) => {
          const actual = (n as number) ?? 0;
          if (actual >= BALANCE.factory.maxPlayers) return; // aborta: sin plaza
          return actual + 1;
        },
      );
      if (!tx.committed) throw new BackendError('Fábrica llena');
      await this.escribir({
        [rutaM]: limpiar(createMember(player)),
        [`${this.rutaIndice(fid)}/playerCount`]: tx.snapshot.val() as number,
        [`${this.rutaJugador(player.uid)}/factoryId`]: fid,
      });
      return true;
    }

    await this.escribir({
      [`${rutaM}/name`]: player.name,
      [`${rutaM}/level`]: player.level,
      [`${rutaM}/money`]: player.money,
      [`${rutaM}/lastSeenAt`]: Date.now(),
      [`${this.rutaJugador(player.uid)}/factoryId`]: fid,
    });
    return true;
  }

  async leaveFactory(fid: string, uid: string): Promise<void> {
    // El progreso y la pertenencia se conservan; sólo se limpia la presencia.
    await this.clearPresence(fid, uid);
    await this.escribir({
      [`${this.rutaMiembro(fid, uid)}/lastSeenAt`]: Date.now(),
    }).catch(() => {});
  }

  watchFactory(fid: string, cb: (f: FactoryState) => void): Unsub {
    const ruta = this.rutaFabrica(fid);
    return onValue(ref(this.db, ruta), (snap) => {
      if (!snap.exists()) return;
      const raw = snap.val() as Partial<FactoryState> & { rev?: number };
      addBytes(pesoAprox(raw));
      this.revs.set(ruta, raw.rev ?? 0);
      const factory = normalizeFactory(sinRev(raw), fid);
      this.factories.set(fid, factory);
      cb(factory);
    });
  }

  watchMembers(fid: string, cb: (m: FactoryMember[]) => void): Unsub {
    return onValue(ref(this.db, `factories/${fid}/members`), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, FactoryMember>;
      addBytes(pesoAprox(val));
      cb(Object.values(val).filter(Boolean));
    });
  }

  /* ─────────────────────────── Operaciones ─────────────────────────── */

  private async escribir(cambios: Record<string, unknown>): Promise<void> {
    addBytes(pesoAprox(cambios));
    await update(ref(this.db), cambios);
  }

  /**
   * Estado actual. Normalmente sale de la caché que mantienen los `onValue`,
   * que va al día sin coste añadido; sólo se baja del servidor si aún no hay
   * escucha montada o si venimos de un rechazo por carrera.
   */
  private async jugadorAhora(uid: string, fresco: boolean): Promise<PlayerState | null> {
    if (!fresco) {
      const cache = this.players.get(uid);
      if (cache) return cache;
    }
    const ruta = this.rutaJugador(uid);
    const raw = await this.leer<Partial<PlayerState> & { rev?: number }>(ruta);
    if (!raw) return null;
    this.revs.set(ruta, raw.rev ?? 0);
    const player = normalizePlayer(sinRev(raw));
    this.players.set(uid, player);
    return player;
  }

  private async fabricaAhora(fid: string, fresco: boolean): Promise<FactoryState | null> {
    if (!fresco) {
      const cache = this.factories.get(fid);
      if (cache) return cache;
    }
    const ruta = this.rutaFabrica(fid);
    const raw = await this.leer<Partial<FactoryState> & { rev?: number }>(ruta);
    if (!raw) return null;
    this.revs.set(ruta, raw.rev ?? 0);
    const factory = normalizeFactory(sinRev(raw), fid);
    this.factories.set(fid, factory);
    return factory;
  }

  /**
   * Añade a `cambios` lo mínimo para llevar `base` de `prev` a `next`.
   * Devuelve la `rev` que quedará escrita, o -1 si no había nada que hacer.
   */
  private planear(
    base: string,
    prev: unknown,
    next: object,
    cambios: Record<string, unknown>,
    conRev: boolean,
  ): number {
    const rev = this.revs.get(base) ?? 0;
    const d = diffRutas(prev, next, base);
    // `d[base]` significa que el diff decidió reescribir el subárbol entero;
    // mezclarlo con rutas hijas rompería el `update` (rutas solapadas).
    if (d === null || d[base] !== undefined) {
      cambios[base] = limpiar(conRev ? { ...next, rev: rev + 1 } : next);
      return rev + 1;
    }
    if (Object.keys(d).length === 0) return -1;
    Object.assign(cambios, d);
    if (conRev) cambios[`${base}/rev`] = rev + 1;
    return rev + 1;
  }

  async runOp(uid: string, fid: string, op: OpName, args: unknown): Promise<OpOutcome> {
    for (let intento = 0; intento < REINTENTOS; intento++) {
      const fresco = intento > 0;
      const player = await this.jugadorAhora(uid, fresco);
      const factory = await this.fabricaAhora(fid, fresco);
      if (!player || !factory) {
        return { ok: false, reason: 'Estado no disponible', events: [] };
      }

      const out = runOpLocal(op, player, factory, args);
      if (!out.ok) return out;

      const cambios: Record<string, unknown> = {};
      const rutaP = this.rutaJugador(uid);
      const rutaF = this.rutaFabrica(fid);
      const revP = out.player ? this.planear(rutaP, player, out.player, cambios, false) : -1;
      const revF = out.factory
        ? this.planear(rutaF, factory, { ...out.factory, updatedAt: Date.now() }, cambios, true)
        : -1;

      this.planearMiembro(fid, uid, out, cambios);

      if (Object.keys(cambios).length === 0) return out;

      try {
        await this.escribir(cambios);
        // Adelanta la caché: el `onValue` llegará en unos milisegundos, pero la
        // siguiente operación no puede esperarlo sin volver a atascar el juego.
        if (out.player) this.players.set(uid, out.player);
        if (out.factory) this.factories.set(fid, out.factory);
        if (revP >= 0) this.revs.set(rutaP, revP);
        if (revF >= 0) this.revs.set(rutaF, revF);
        return out;
      } catch (e) {
        if (!esCarrera(e) || intento === REINTENTOS - 1) {
          return {
            ok: false,
            reason: e instanceof Error ? e.message : 'No se pudo guardar',
            events: [],
          };
        }
        // Otro tripulante escribió primero. Se le da un respiro al `onValue`
        // para que traiga su versión y se repite la operación sobre ella.
        await pausa(40 * (intento + 1));
      }
    }
    return { ok: false, reason: 'Fábrica muy ocupada', events: [] };
  }

  /** Documento público de ranking: se acumulan los deltas que declara la op. */
  private planearMiembro(
    fid: string,
    uid: string,
    out: OpOutcome,
    cambios: Record<string, unknown>,
  ): void {
    const base = this.rutaMiembro(fid, uid);
    const delta = out.memberDelta ?? {};
    for (const [k, v] of Object.entries(delta)) {
      if (typeof v !== 'number' || k === 'money') continue;
      // `increment` lo suma el servidor sobre lo que haya: no hace falta leer
      // el documento antes, y dos pestañas del mismo jugador no se pisan.
      cambios[`${base}/${k}`] = increment(v);
    }
    if (out.player) {
      cambios[`${base}/level`] = out.player.level;
      cambios[`${base}/name`] = out.player.name;
      cambios[`${base}/money`] = out.player.money;
    } else if (typeof delta.money === 'number') {
      cambios[`${base}/money`] = delta.money;
    }
    if (Object.keys(cambios).some((k) => k.startsWith(base))) {
      // El `uid` va siempre: si por lo que sea el documento de miembro no
      // existiera, se crea entero y no medio ranking sin dueño.
      cambios[`${base}/uid`] = uid;
      cambios[`${base}/lastSeenAt`] = Date.now();
    }
  }

  /* ─────────────────────── Presencia ─────────────────────── */

  private presenceRef(fid: string, uid: string) {
    return ref(this.db, `presence/${fid}/${uid}`);
  }

  publishPresence(fid: string, state: PresenceState): void {
    const r = this.presenceRef(fid, state.uid);
    const key = `${fid}/${state.uid}`;
    if (!this.presenceArmed.has(key)) {
      this.presenceArmed.add(key);
      // Limpieza automática si el cliente se cae, cierra o pierde red.
      onDisconnect(r).remove().catch(() => {});
      onValue(ref(this.db, '.info/connected'), (snap) => {
        if (snap.val() === true) onDisconnect(r).remove().catch(() => {});
      });
    }
    addBytes(pesoAprox(state));
    set(r, state).catch(() => {});
  }

  watchPresence(
    fid: string,
    selfUid: string,
    cb: (p: PresenceState[]) => void,
  ): Unsub {
    return onValue(ref(this.db, `presence/${fid}`), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, PresenceState>;
      addBytes(pesoAprox(val));
      const now = Date.now();
      cb(
        Object.values(val).filter(
          (p) => p && p.uid !== selfUid && now - (p.t ?? 0) < BALANCE.net.staleAfterMs,
        ),
      );
    });
  }

  async clearPresence(fid: string, uid: string): Promise<void> {
    await remove(this.presenceRef(fid, uid)).catch(() => {});
    this.presenceArmed.delete(`${fid}/${uid}`);
  }

  async pingRealtime(): Promise<boolean> {
    try {
      await get(ref(this.db, '.info/serverTimeOffset'));
      return true;
    } catch {
      return false;
    }
  }

  /* ─────────────────────────── Debug ─────────────────────────── */

  async debugPatchPlayer(uid: string, patch: Partial<PlayerState>): Promise<void> {
    await update(ref(this.db, this.rutaJugador(uid)), limpiar(patch) as object);
  }

  async debugPatchFactory(fid: string, patch: Partial<FactoryState>): Promise<void> {
    await update(ref(this.db, this.rutaFabrica(fid)), limpiar(patch) as object);
  }
}

/**
 * ¿El rechazo viene de que otro escribió primero? Las reglas devuelven
 * PERMISSION_DENIED cuando la `rev` no es la siguiente, que es exactamente lo
 * que pasa en una carrera.
 */
function esCarrera(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('PERMISSION_DENIED') || msg.includes('permission_denied');
}

function pausa(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
