import type { Appearance } from '../config/cosmetics';

export type { Appearance };

/* ─────────────────────────── JUGADOR ─────────────────────────── */

export interface LifetimeStats {
  gathered: number;
  deposited: number;
  produced: number;
  sold: number;
  earned: number;
  contributed: number;
  upgradesBought: number;
  playtime: number; // segundos
}

export interface MissionProgress {
  id: string;
  progress: number;
  claimed: boolean;
  startedAt: number;
}

/** Estado persistente e INDIVIDUAL del jugador (Firestore: users/{uid}). */
export interface PlayerState {
  uid: string;
  name: string;
  photoURL: string | null;
  appearance: Appearance;

  level: number;
  xp: number;
  money: number;
  /** Valor de estamina en el instante `staminaAt`. El valor actual se DERIVA
   *  (ver `currentStamina`): así la regeneración no cuesta ni una escritura. */
  stamina: number;
  staminaAt: number;

  /** id de mejora → nivel comprado */
  upgrades: Record<string, number>;
  /** itemId → cantidad */
  inventory: Record<string, number>;

  missions: MissionProgress[];
  stats: LifetimeStats;

  factoryId: string | null;
  createdAt: number;
  lastSeenAt: number;
  /** Timestamp de la última liquidación de producción offline. */
  lastOfflineClaimAt: number;
  onboarded: boolean;
  /**
   * Último reinicio de fábrica que este jugador ya ha aplicado a su progreso.
   * Si `factory.resetAt` es mayor, el cliente ejecuta el reinicio al entrar.
   */
  resetAckAt: number;
}

/* ─────────────────────────── FÁBRICA ─────────────────────────── */

/** Estado de una máquina compartida. Se simula desde `cycleStartAt`. */
export interface MachineState {
  level: number;
  /** itemId → unidades en el buffer de entrada */
  input: Record<string, number>;
  /** itemId → unidades listas para recoger */
  output: Record<string, number>;
  /** Inicio del ciclo actual (ms epoch). 0 = parada. */
  cycleStartAt: number;
  /** Ciclos totales completados (para métricas y objetivos). */
  cycles: number;
}

/** Robot logístico comprado por la fábrica. */
export interface RobotState {
  level: number;
  /** Instante desde el que se cuenta su trabajo pendiente (ms epoch). */
  lastRunAt: number;
  /** Unidades transportadas en total (métrica visible en el Taller). */
  moved: number;
}

export interface FactoryStats {
  gathered: number;
  produced: number;
  sold: number;
  contributed: number;
}

/** Estado COMPARTIDO (Firestore: factories/{factoryId}). */
export interface FactoryState {
  id: string;
  name: string;
  level: number;
  /** Contribución acumulada hacia el siguiente nivel. */
  contribution: number;
  /** Contribución histórica total. */
  totalContribution: number;
  machines: Record<string, MachineState>;
  /** robotId → estado. Vacío hasta que alguien compra el primero. */
  robots: Record<string, RobotState>;
  stats: FactoryStats;
  /** objetivoId → progreso; los completados se marcan con `-1`. */
  objectives: Record<string, number>;
  playerCount: number;
  createdAt: number;
  updatedAt: number;
  /** Reservado para el sistema de prestigio (fase futura). */
  prestige: number;
  /**
   * Instante del último reinicio administrativo. Cuando sube, cada jugador
   * reinicia su propio progreso la próxima vez que entra (ver `resetAckAt`).
   * Se hace así, y no escribiendo el documento de cada usuario, porque un
   * administrador no debe poder tocar documentos ajenos.
   */
  resetAt: number;
}

/** Documento ligero por miembro (Firestore: factories/{fid}/members/{uid}).
 *  Sirve para ranking y presencia persistente sin leer todos los users. */
export interface FactoryMember {
  uid: string;
  name: string;
  photoURL: string | null;
  level: number;
  contributed: number;
  produced: number;
  sold: number;
  money: number;
  joinedAt: number;
  lastSeenAt: number;
}

/* ─────────────────────── MULTIPLAYER REALTIME ─────────────────────── */

export type FacingDir = 'up' | 'down' | 'left' | 'right';
export type ActivityKind = 'idle' | 'walk' | 'run' | 'gather' | 'work' | 'sell' | 'tired';

/** Payload efímero en Realtime Database. Nunca toca Firestore. */
export interface PresenceState {
  uid: string;
  name: string;
  level: number;
  x: number;
  y: number;
  dir: FacingDir;
  act: ActivityKind;
  appearance: Appearance;
  /** Emote en curso (id de config/emotes) o null. */
  emote?: string | null;
  /** Instante en que empezó el emote (ms). */
  emoteAt?: number;
  /** Timestamp del emisor (ms). */
  t: number;
}

/* ────────────────────────── AUTENTICACIÓN ────────────────────────── */

export interface AuthUser {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  isAnonymous?: boolean;
}

/* ──────────────────────────── MUTACIONES ──────────────────────────── */

/** Delta atómico aplicado al estado del jugador. Todos los campos suman. */
export interface PlayerDelta {
  money?: number;
  xp?: number;
  stamina?: number;
  /** itemId → delta (puede ser negativo) */
  inventory?: Record<string, number>;
  stats?: Partial<LifetimeStats>;
  /** Campos que se sobrescriben en vez de sumarse. */
  set?: Partial<Pick<PlayerState, 'level' | 'appearance' | 'missions' | 'name' | 'onboarded' | 'lastOfflineClaimAt' | 'upgrades' | 'stamina' | 'staminaAt' | 'money'>>;
}

export interface OpResult<T = unknown> {
  ok: boolean;
  reason?: string;
  data?: T;
}

export interface OfflineReport {
  seconds: number;
  units: number;
  money: number;
  xp: number;
  robots: number;
  factoryLevel: number;
}
