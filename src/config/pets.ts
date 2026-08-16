/**
 * MASCOTAS CUADRÚPEDAS — ayudantes de extracción.
 *
 * Cada jugador tiene la suya: es individual, como el dinero y el inventario.
 * No transporta material de la fábrica (de eso van los robots logísticos):
 * mina por su cuenta en las vetas cercanas, guarda lo que saca en su propia
 * mochila y te lo entrega cuando se llena.
 *
 * Todo es data-driven: añadir un chasis nuevo es añadir una entrada aquí más
 * un caso en `render/pet.ts`.
 */

export type PetChassis = 'spot' | 'go2' | 'hound';
export type PetStat = 'capacity' | 'mining' | 'speed' | 'radius';

/**
 * Qué está haciendo la mascota. Lo decides tú, igual que con los robots:
 *  · `gather` — autónoma: busca la zona más cercana, pica y lleva el material
 *    a la cinta o máquina que le corresponde. Nunca se queda con carga muerta.
 *  · `follow` — sólo te acompaña. Si le queda material encima, te lo entrega.
 *  · `off` — recogida. Ni se dibuja ni consume nada.
 */
export type PetMode = 'gather' | 'follow' | 'off';

export const PET_MODES: { id: PetMode; label: string; icon: string; desc: string }[] = [
  {
    id: 'gather',
    label: 'Extraer',
    icon: '⛏️',
    desc: 'Busca la zona más cercana, pica y deja el material en su cinta o máquina.',
  },
  {
    id: 'follow',
    label: 'Seguir',
    icon: '🐾',
    desc: 'Sólo te acompaña. Si lleva material encima, te lo entrega y deja de trabajar.',
  },
  { id: 'off', label: 'Reposo', icon: '⏸️', desc: 'La guardas. No aparece en el mapa.' },
];

export interface PetChassisDef {
  id: PetChassis;
  name: string;
  desc: string;
  icon: string;
  /** Colores con los que llega de fábrica. */
  color: string;
  accent: string;
  cost: number;
  unlockLevel: number;
  /** Multiplicadores propios del chasis. */
  bonus: { mining: number; capacity: number; speed: number };
  /** Proporciones de la silueta (las usa el renderer). */
  build: {
    /** Largo del cuerpo en px. */
    body: number;
    /** Alto del cuerpo en px. */
    height: number;
    /** Largo de cada segmento de pata. */
    leg: number;
    /** Redondeo del chasis: 0 = angular, 1 = cápsula. */
    round: number;
  };
}

export const PET_CHASSIS: PetChassisDef[] = [
  {
    id: 'spot',
    name: 'K9 «PERRO»',
    desc: 'El de serie. Patas de obra, chasis amarillo y un brazo sensor.',
    icon: '🐕',
    color: '#f2c015',
    accent: '#1e2430',
    cost: 0,
    unlockLevel: 1,
    bonus: { mining: 1, capacity: 1, speed: 1 },
    build: { body: 26, height: 12, leg: 9, round: 0.35 },
  },
  {
    id: 'go2',
    name: 'GO-2 «GALGO»',
    desc: 'Chasis ligero de aleación. Más rápido y más fino perforando.',
    icon: '🦿',
    color: '#c7ced8',
    accent: '#5b6675',
    cost: 24_000,
    unlockLevel: 8,
    bonus: { mining: 1.12, capacity: 1, speed: 1.16 },
    build: { body: 28, height: 11, leg: 10.5, round: 0.85 },
  },
  {
    id: 'hound',
    name: 'HOUND-X',
    desc: 'Prototipo de la Zona Avanzada. Carga más, corre más, mina más.',
    icon: '🐺',
    color: '#2b3346',
    accent: '#22d3ee',
    cost: 220_000,
    unlockLevel: 18,
    bonus: { mining: 1.32, capacity: 1.25, speed: 1.26 },
    build: { body: 31, height: 13.5, leg: 11.5, round: 0.55 },
  },
];

export const PET_CHASSIS_MAP: Record<string, PetChassisDef> = Object.fromEntries(
  PET_CHASSIS.map((c) => [c.id, c]),
);

export function getChassis(id: string | undefined): PetChassisDef {
  return PET_CHASSIS_MAP[id ?? 'spot'] ?? PET_CHASSIS[0];
}

/** Colores de carrocería. Personalizar es gratis: es sólo estética. */
export const PET_COLORS: { id: string; name: string }[] = [
  { id: '#f2c015', name: 'Obra' },
  { id: '#c7ced8', name: 'Aluminio' },
  { id: '#2b3346', name: 'Carbono' },
  { id: '#ef4444', name: 'Rojo' },
  { id: '#22c55e', name: 'Verde' },
  { id: '#0ea5e9', name: 'Azul' },
  { id: '#a855f7', name: 'Violeta' },
  { id: '#f472b6', name: 'Rosa' },
  { id: '#e2e8f0', name: 'Hueso' },
];

/** Color de los detalles: LED, juntas y placa del sensor. */
export const PET_ACCENTS: { id: string; name: string }[] = [
  { id: '#22d3ee', name: 'Cian' },
  { id: '#fbbf24', name: 'Ámbar' },
  { id: '#4ade80', name: 'Lima' },
  { id: '#f472b6', name: 'Magenta' },
  { id: '#1e2430', name: 'Negro' },
  { id: '#ffffff', name: 'Blanco' },
];

/** Mejoras de mascota sin tope. La UI lo reconoce y no pinta «MÁX». */
export const UNLIMITED_PET_LEVEL = 9_999;

export function isPetStatUnlimited(def: Pick<PetStatDef, 'maxLevel'>): boolean {
  return def.maxLevel >= UNLIMITED_PET_LEVEL;
}

export interface PetStatDef {
  id: PetStat;
  name: string;
  icon: string;
  accent: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  /** Texto del efecto en el nivel dado. */
  effect: (level: number) => string;
}

/** Valores base, sin mejoras ni chasis. */
export const PET_BASE = {
  capacity: 24,
  capacityPerLevel: 14,
  /** Unidades por segundo. */
  mining: 0.55,
  miningPerLevel: 0.2,
  /** px/s. */
  speed: 152,
  speedPerLevel: 12,
  /** Radio en el que detecta vetas, en px. */
  radius: 210,
  radiusPerLevel: 30,
} as const;

export const PET_STATS: PetStatDef[] = [
  {
    id: 'capacity',
    name: 'Mochila',
    icon: '🎒',
    accent: '#38bdf8',
    desc: 'Cuánto material aguanta antes de tener que descargar.',
    maxLevel: 12,
    baseCost: 900,
    costGrowth: 1.55,
    effect: (l) => `${PET_BASE.capacity + PET_BASE.capacityPerLevel * l} unidades de carga`,
  },
  {
    id: 'mining',
    name: 'Perforadora',
    icon: '⛏️',
    accent: '#fbbf24',
    desc: 'Velocidad a la que saca material de una veta. Sin tope.',
    // Sin tope: es la mejora que define el ritmo de toda la cadena, así que
    // el freno lo pone el precio (×1,6 por nivel), no un número inventado.
    maxLevel: UNLIMITED_PET_LEVEL,
    baseCost: 1_200,
    costGrowth: 1.6,
    effect: (l) => `${((PET_BASE.mining + PET_BASE.miningPerLevel * l) * 60).toFixed(0)} unidades/min`,
  },
  {
    id: 'speed',
    name: 'Servos',
    icon: '🦿',
    accent: '#4ade80',
    desc: 'Lo rápido que trota entre la veta y tú.',
    maxLevel: 10,
    baseCost: 750,
    costGrowth: 1.5,
    effect: (l) => `${PET_BASE.speed + PET_BASE.speedPerLevel * l} px/s`,
  },
  {
    id: 'radius',
    name: 'Sensor',
    icon: '📡',
    accent: '#c084fc',
    desc: 'Distancia a la que detecta una zona de extracción y se lanza sola.',
    maxLevel: 8,
    baseCost: 1_000,
    costGrowth: 1.58,
    effect: (l) => `${PET_BASE.radius + PET_BASE.radiusPerLevel * l} px de detección`,
  },
];

export const PET_STAT_MAP: Record<string, PetStatDef> = Object.fromEntries(
  PET_STATS.map((s) => [s.id, s]),
);

export function petStatCost(def: PetStatDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, level));
}

/* ─────────────────────────── DRONES ─────────────────────────── */

/**
 * DRONES DE APOYO.
 *
 * El perro pica muy rápido, pero cada vez que llena la mochila tiene que
 * dejar la veta e ir hasta la cinta: ese paseo es tiempo que no está picando.
 * Los drones lo resuelven — le quitan la carga en el sitio y la llevan ellos,
 * así el perro no se mueve de la veta.
 *
 * Comprar más drones sube el caudal de verdad: cada uno hace su viaje con su
 * propia carga, así que la cadena sólo se atasca si el perro produce más de
 * lo que la escuadrilla es capaz de mover.
 */
/**
 * JAURÍA. Hasta tres perros trabajando juntos.
 *
 * Se comportan como una unidad: van a la misma veta, reparten el trabajo y
 * comparten mochila. Multiplican el ritmo de extracción y la carga, y lo
 * natural es que cada uno lleve su dron —más otro que se queda contigo— para
 * que la escuadrilla no sea el cuello de botella.
 */
export const PACK = {
  max: 3,
  baseCost: 60_000,
  costGrowth: 4.5,
} as const;

export function dogCost(owned: number): number {
  return Math.round(PACK.baseCost * Math.pow(PACK.costGrowth, owned - 1));
}

export const DRONE = {
  /** Unidades por viaje, y cuánto sube por nivel de la escuadrilla. */
  carry: 18,
  carryPerLevel: 10,
  /** Velocidad de vuelo en px/s. Vuelan recto: no les frenan los muros. */
  speed: 210,
  speedPerLevel: 14,
  /** Segundos enganchado al perro y descargando. */
  loadMs: 450,
  dropMs: 400,
  /** Máximo de drones por jugador: uno por perro más tu escolta. */
  max: 6,
  /** Coste del primer dron y crecimiento por cada uno más. */
  baseCost: 18_000,
  costGrowth: 2.15,
  /** Coste de subir el nivel de TODA la escuadrilla. */
  upgradeBase: 9_000,
  upgradeGrowth: 1.72,
  maxLevel: UNLIMITED_PET_LEVEL,
} as const;

export function droneCost(owned: number): number {
  return Math.round(DRONE.baseCost * Math.pow(DRONE.costGrowth, owned));
}

export function droneUpgradeCost(level: number): number {
  return Math.round(DRONE.upgradeBase * Math.pow(DRONE.upgradeGrowth, level));
}

export interface DerivedDrone {
  count: number;
  level: number;
  /** Unidades que se lleva cada dron en cada viaje. */
  carry: number;
  speed: number;
}

export function deriveDrones(pet: PetState | undefined): DerivedDrone {
  const count = Math.max(0, Math.min(DRONE.max, Math.floor(pet?.drones ?? 0)));
  const level = Math.max(1, Math.floor(pet?.droneLevel ?? 1));
  return {
    count,
    level,
    carry: DRONE.carry + DRONE.carryPerLevel * (level - 1),
    speed: DRONE.speed + DRONE.speedPerLevel * (level - 1),
  };
}

/** Estado persistente de la mascota (vive dentro de PlayerState). */
export interface PetState {
  /** Chasis equipado. */
  chassis: PetChassis;
  /** Chasis comprados. El de serie siempre está. */
  owned: PetChassis[];
  color: string;
  accent: string;
  /** statId → nivel comprado. */
  stats: Record<string, number>;
  /** Mochila propia de la mascota: itemId → unidades. */
  inventory: Record<string, number>;
  /** Última liquidación de su trabajo (acota cuánto puede reclamar). */
  lastAt: number;
  /** Unidades extraídas en total. */
  mined: number;
  /** Qué le has mandado hacer. */
  mode: PetMode;
  /**
   * Material que le has encargado (id de item). `null` = automático: lo que
   * pille más cerca dentro del radio de su sensor.
   *
   * Se elige el MINERAL y no la zona: lo que importa es qué te falta para la
   * cadena, no en qué esquina del mapa está. Ella ya busca la veta.
   */
  target: string | null;
  /** Drones de apoyo comprados. */
  drones: number;
  /** Perros de la jauría (1..PACK.max). */
  dogs: number;
  /** Nivel de la escuadrilla: carga y velocidad de TODOS los drones. */
  droneLevel: number;
  /**
   * ¿Pueden los drones vaciarte a TI la mochila?
   *
   * Por defecto sí —es justo lo que ahorra los paseos— pero se puede apagar:
   * a veces llevas material a propósito para venderlo o contribuirlo y no
   * quieres que te lo lleven a una máquina.
   */
  droneTakesPlayer: boolean;
}

export const DEFAULT_PET: PetState = {
  chassis: 'spot',
  owned: ['spot'],
  color: '#f2c015',
  accent: '#22d3ee',
  stats: {},
  inventory: {},
  lastAt: 0,
  mined: 0,
  mode: 'gather',
  target: null,
  dogs: 1,
  drones: 0,
  droneLevel: 1,
  droneTakesPlayer: true,
};

/**
 * Repara una mascota leída de un documento antiguo o incompleto: garantiza
 * que existen todos los campos y que el chasis de serie nunca se pierde.
 */
/** Traducción de las zonas antiguas al material que las representa. */
const LEGACY_ZONE_ITEM: Record<string, string> = {
  resources: 'ore',
  salvage: 'scrap',
  mine: 'copper',
  danger: 'titanium',
};

export function normalizePet(raw: Partial<PetState> | undefined, now: number): PetState {
  const owned = [...new Set([...DEFAULT_PET.owned, ...(raw?.owned ?? [])])].filter(
    (id) => !!PET_CHASSIS_MAP[id],
  ) as PetChassis[];
  const chassis = owned.includes(raw?.chassis as PetChassis)
    ? (raw!.chassis as PetChassis)
    : DEFAULT_PET.chassis;
  // Documentos anteriores a los modos guardaban un simple `active`.
  const legacyActive = (raw as { active?: boolean } | undefined)?.active;
  const mode: PetMode =
    PET_MODES.find((m) => m.id === raw?.mode)?.id ??
    (legacyActive === false ? 'off' : DEFAULT_PET.mode);
  return {
    chassis,
    owned,
    color: raw?.color ?? DEFAULT_PET.color,
    accent: raw?.accent ?? DEFAULT_PET.accent,
    stats: { ...(raw?.stats ?? {}) },
    inventory: { ...(raw?.inventory ?? {}) },
    lastAt: raw?.lastAt || now,
    mined: raw?.mined ?? 0,
    mode,
    // Partidas viejas guardaban una ZONA; se traduce al material que daba.
    target:
      typeof raw?.target === 'string'
        ? raw.target
        : typeof (raw as { zone?: string } | undefined)?.zone === 'string'
          ? LEGACY_ZONE_ITEM[(raw as { zone: string }).zone] ?? null
          : null,
    drones: Math.max(0, Math.min(DRONE.max, Math.floor(raw?.drones ?? 0))),
    dogs: Math.max(1, Math.min(PACK.max, Math.floor(raw?.dogs ?? 1))),
    droneLevel: Math.max(1, Math.floor(raw?.droneLevel ?? 1)),
    droneTakesPlayer: raw?.droneTakesPlayer ?? true,
  };
}

export interface DerivedPet {
  def: PetChassisDef;
  /** Perros que trabajan a la vez. */
  dogs: number;
  /** Unidades que caben en su mochila. */
  capacity: number;
  /** Unidades por segundo que extrae. */
  minePerSec: number;
  /** Velocidad de desplazamiento en px/s. */
  speed: number;
  /** Radio de detección de vetas en px. */
  radius: number;
}

export function derivePet(pet: PetState | undefined): DerivedPet {
  const p = { ...DEFAULT_PET, ...(pet ?? {}) };
  const def = getChassis(p.chassis);
  const lvl = (id: PetStat) => Math.max(0, Math.floor(p.stats?.[id] ?? 0));
  // La jauría trabaja junta: más perros = más ritmo y más mochila.
  const dogs = Math.max(1, Math.min(PACK.max, Math.floor(p.dogs ?? 1)));
  return {
    def,
    dogs,
    capacity: Math.round(
      (PET_BASE.capacity + PET_BASE.capacityPerLevel * lvl('capacity')) * def.bonus.capacity * dogs,
    ),
    minePerSec:
      (PET_BASE.mining + PET_BASE.miningPerLevel * lvl('mining')) * def.bonus.mining * dogs,
    speed: Math.round((PET_BASE.speed + PET_BASE.speedPerLevel * lvl('speed')) * def.bonus.speed),
    radius: PET_BASE.radius + PET_BASE.radiusPerLevel * lvl('radius'),
  };
}

/** Unidades que la mascota lleva encima ahora mismo. */
export function petUsed(pet: PetState | undefined): number {
  return Object.values(pet?.inventory ?? {}).reduce((a, b) => a + Math.max(0, b), 0);
}

/** Hueco libre en su mochila. */
export function petFree(pet: PetState | undefined): number {
  return Math.max(0, derivePet(pet).capacity - petUsed(pet));
}

/**
 * Margen anti-trampas: cuánto puede haber minado como mucho en un intervalo.
 * Se aplica en el servidor, que no ve la simulación del cliente.
 */
export const PET_RATE_TOLERANCE = 1.8;

/** Cada cuánto liquida el cliente lo que ha minado la mascota. */
export const PET_FLUSH_MS = 5_000;
