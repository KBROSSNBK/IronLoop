import type { Appearance } from '../config/cosmetics';
import type { PetState } from '../config/pets';
import type { CaexState } from '../config/caex';
import type { RobotMode } from '../config/robots';

export type { Appearance, CaexState, PetState, RobotMode };

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
  /** Unidades extraídas por tu mascota. */
  petMined: number;
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
  /** Mascota cuadrúpeda: chasis, color, mejoras y una mochila por perro. */
  pet: PetState;
  /** Camión minero: hace la ronda por todas las zonas y carga lo que pilla. */
  caex: CaexState;
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

/**
 * Tanda de material viajando por una cinta. La posición de cada bulto NO se
 * guarda: se deriva de `at` y de la velocidad de la cinta, igual que el
 * progreso de las máquinas. Así todos los jugadores ven exactamente lo mismo
 * sin sincronizar nada por frame.
 */
export interface BeltBatch {
  item: string;
  qty: number;
  /** Instante en que entró en la cinta (ms epoch). */
  at: number;
}

export interface BeltState {
  queue: BeltBatch[];
}

/** Robot logístico comprado por la fábrica. */
export interface RobotState {
  level: number;
  /** Instante desde el que se cuenta su trabajo pendiente (ms epoch). */
  lastRunAt: number;
  /** Unidades transportadas en total (métrica visible en el Taller). */
  moved: number;
  /** Qué hace: llevar a la cinta, vender, o estar parado. */
  mode: RobotMode;
  /** Dinero generado en total vendiendo (métrica del Taller). */
  sold: number;
}

/**
 * Objeto tirado en el suelo. Vive en el documento COMPARTIDO de la fábrica,
 * así que recogerlo es una transacción: dos jugadores no pueden llevárselo
 * a la vez ni duplicarlo.
 */
export interface GroundItem {
  id: string;
  item: string;
  qty: number;
  x: number;
  y: number;
  /** uid de quien lo soltó (para atribución y depuración). */
  by: string;
  droppedAt: number;
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
  /** Objetos tirados en el suelo, compartidos por todos. */
  ground: Record<string, GroundItem>;
  /** cintaId → material en tránsito. */
  belts: Record<string, BeltState>;
  /**
   * uid → último instante en que se le vio activo. Se usa para repartir el
   * dinero de las ventas automáticas entre quienes están conectados.
   * Vive en el documento de fábrica, no en RTDB, porque las operaciones
   * transaccionales necesitan leerlo.
   */
  online: Record<string, number>;
  /**
   * uid → dinero pendiente de cobrar de las ventas de los robots. Cada
   * jugador reclama SÓLO su parte, así que no puede duplicarse ni robarse.
   */
  saleLedger: Record<string, number>;
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
  /**
   * Aspecto de su mascota, para que los demás la vean como su dueño la ha
   * pintado.
   */
  pet?: { chassis: string; color: string; accent: string } | null;
  /**
   * Dónde está y qué hace cada perro: `[x, y, act, x, y, act, …]`.
   *
   * Antes esto no viajaba y cada cliente fingía que la jauría del vecino le
   * seguía a todas partes. Salía gratis pero era falso: veías sus perros
   * pegados a él mientras picaban al otro lado del mapa, y saber quién tiene
   * la jauría trabajando es información de juego. Tres números por perro
   * cuestan poco y a cambio se ve la verdad. Ver `game/systems/petSync.ts`.
   */
  pets?: number[] | null;
  /** Lo mismo para el camión: `[x, y, act]`. */
  caex?: number[] | null;
  /** Colores del camión, para que se vea como su dueño lo ha pintado. */
  caexLook?: { color: string; accent: string } | null;
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
