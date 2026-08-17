import type {
  AuthUser,
  FactoryMember,
  FactoryState,
  PlayerState,
  PresenceState,
} from '../../types';
import type { OpName, OpOutcome } from './ops';

export type Unsub = () => void;

/**
 * Contrato del backend.
 *
 * Dos implementaciones intercambiables:
 *  - `firebase` → Auth + Firestore (persistente) + Realtime Database (efímero)
 *  - `local`    → localStorage + BroadcastChannel (multiplayer entre pestañas)
 *
 * Toda mutación del juego pasa por `runOp`, que ejecuta el reductor puro
 * correspondiente DENTRO de una transacción del backend. El cliente nunca
 * escribe dinero/XP/inventario directamente.
 */
export interface Backend {
  readonly kind: 'firebase' | 'rtdb' | 'local';
  /** Etiqueta legible para la UI. */
  readonly label: string;

  init(): Promise<void>;

  /* Autenticación */
  onAuthChanged(cb: (user: AuthUser | null) => void): Unsub;
  signInWithGoogle(): Promise<void>;
  signInAsGuest(nickname?: string): Promise<void>;
  signOut(): Promise<void>;

  /* Jugador (persistente, individual) */
  loadPlayer(user: AuthUser): Promise<PlayerState>;
  watchPlayer(uid: string, cb: (p: PlayerState) => void): Unsub;
  /** Campos no críticos (estamina, lastSeenAt, playtime). Throttled por el llamante. */
  savePlayerSoft(uid: string, patch: Partial<PlayerState>): Promise<void>;

  /* Fábrica (compartida) */
  joinFactory(player: PlayerState): Promise<string>;
  leaveFactory(factoryId: string, uid: string): Promise<void>;
  watchFactory(factoryId: string, cb: (f: FactoryState) => void): Unsub;
  watchMembers(factoryId: string, cb: (members: FactoryMember[]) => void): Unsub;

  /* Operaciones transaccionales */
  runOp(
    uid: string,
    factoryId: string,
    op: OpName,
    args: unknown,
  ): Promise<OpOutcome>;

  /* Multiplayer efímero */
  publishPresence(factoryId: string, state: PresenceState): void;
  watchPresence(
    factoryId: string,
    selfUid: string,
    cb: (players: PresenceState[]) => void,
  ): Unsub;
  clearPresence(factoryId: string, uid: string): Promise<void>;

  /* Herramientas de desarrollo (bloqueadas en producción) */
  debugPatchPlayer?(uid: string, patch: Partial<PlayerState>): Promise<void>;
  debugPatchFactory?(factoryId: string, patch: Partial<FactoryState>): Promise<void>;
}

export class BackendError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
  }
}
