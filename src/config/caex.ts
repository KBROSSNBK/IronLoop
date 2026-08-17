/**
 * CAEX — CAMIÓN MINERO DE CARGA.
 *
 * La tercera mascota, y la que trabaja distinto a todas. No le mandas a dónde
 * ir: hace su ronda por TODAS las zonas de recolección, una detrás de otra, y
 * en cada parada carga lo que haya. Es lento y no elige, pero su caja es
 * enorme y no para nunca: es la automatización de fondo mientras tú haces
 * otra cosa.
 *
 * Se mejora sin tope en las dos cosas que le importan —caja y ritmo de
 * carga— y lleva su propio dron, que le vacía la tolva sin que el camión
 * tenga que dejar la ronda.
 */

import { UNLIMITED_PET_LEVEL } from './pets';

export type CaexMode = 'route' | 'off';

export const CAEX_MODES: { id: CaexMode; label: string; icon: string; desc: string }[] = [
  {
    id: 'route',
    label: 'En ruta',
    icon: '🚚',
    desc: 'Hace la ronda por todas las zonas de recolección y carga lo que encuentra.',
  },
  { id: 'off', label: 'En taller', icon: '⏸️', desc: 'Aparcado. No aparece en el mapa.' },
];

/** Chasis del camión: puro aspecto, como los del perro. */
export interface CaexSkinDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  accent: string;
  cost: number;
  unlockLevel: number;
  /** Proporciones de la silueta. */
  build: { body: number; height: number; wheel: number };
}

export const CAEX_SKINS: CaexSkinDef[] = [
  {
    id: 'srt',
    name: 'CAEX SRT-95',
    desc: 'El de serie. Tolva alta, seis ruedas y una bocina que se oye en toda la nave.',
    icon: '🚚',
    color: '#f2b705',
    accent: '#1e2430',
    cost: 0,
    unlockLevel: 1,
    build: { body: 62, height: 26, wheel: 13 },
  },
  {
    id: 'titan',
    name: 'CAEX TITÁN',
    desc: 'Chasis reforzado y tolva ampliada. Más grande, más lento de frenar.',
    icon: '🚛',
    color: '#e2e8f0',
    accent: '#0ea5e9',
    cost: 180_000,
    unlockLevel: 20,
    build: { body: 70, height: 30, wheel: 15 },
  },
  {
    id: 'nocturno',
    name: 'CAEX NOCTURNO',
    desc: 'Pintura mate y faros de xenón. El mismo camión, con otra cara.',
    icon: '🌒',
    color: '#2b3346',
    accent: '#f472b6',
    cost: 420_000,
    unlockLevel: 32,
    build: { body: 66, height: 28, wheel: 14 },
  },
];

export const CAEX_SKIN_MAP: Record<string, CaexSkinDef> = Object.fromEntries(
  CAEX_SKINS.map((s) => [s.id, s]),
);

export function getCaexSkin(id: string | undefined): CaexSkinDef {
  return CAEX_SKIN_MAP[id ?? 'srt'] ?? CAEX_SKINS[0];
}

export const CAEX = {
  /** Lo que cuesta sacarlo del taller la primera vez. */
  cost: 320_000,
  unlockFactoryLevel: 8,
  /** Tolva base y lo que suma cada nivel. Sin tope. */
  capacity: 90,
  capacityPerLevel: 70,
  /** Unidades por segundo cargando, y lo que suma cada nivel. Sin tope. */
  mining: 1.8,
  miningPerLevel: 0.9,
  /** Velocidad de marcha en px/s. Es un camión: no corre. */
  speed: 96,
  /** Segundos que se queda en cada parada aunque no llene. */
  dwellMs: 9000,
  /** Coste de las mejoras. */
  capacityBase: 6_000,
  capacityGrowth: 1.5,
  miningBase: 8_000,
  miningGrowth: 1.58,
  maxLevel: UNLIMITED_PET_LEVEL,
  /** Su dron: uno, y sólo para él. */
  droneCost: 45_000,
  droneUpgradeBase: 14_000,
  droneUpgradeGrowth: 1.7,
  /** Carga del dron del camión: mueve mucho más que los de los perros. */
  droneCarry: 40,
  droneCarryPerLevel: 26,
  droneSpeed: 230,
  droneSpeedPerLevel: 16,
} as const;

export type CaexStat = 'capacity' | 'mining';

export interface CaexStatDef {
  id: CaexStat;
  name: string;
  icon: string;
  accent: string;
  desc: string;
  effect: (level: number) => string;
  cost: (level: number) => number;
}

export const CAEX_STATS: CaexStatDef[] = [
  {
    id: 'capacity',
    name: 'Tolva',
    icon: '📦',
    accent: '#38bdf8',
    desc: 'Cuánto material aguanta antes de tener que vaciar. Sin tope.',
    effect: (l) => `${CAEX.capacity + CAEX.capacityPerLevel * l} unidades`,
    cost: (l) => Math.round(CAEX.capacityBase * Math.pow(CAEX.capacityGrowth, l)),
  },
  {
    id: 'mining',
    name: 'Cuchara',
    icon: '⛏️',
    accent: '#fbbf24',
    desc: 'Lo rápido que carga en cada parada. Sin tope.',
    effect: (l) => `${((CAEX.mining + CAEX.miningPerLevel * l) * 60).toFixed(0)} unidades/min`,
    cost: (l) => Math.round(CAEX.miningBase * Math.pow(CAEX.miningGrowth, l)),
  },
];

/** Estado persistente del camión (vive dentro de PlayerState). */
export interface CaexState {
  /** ¿Lo has comprado ya? Sin esto no existe. */
  owned: boolean;
  /** Chasis equipado y comprados. */
  skin: string;
  skins: string[];
  color: string;
  accent: string;
  /** statId → nivel comprado. */
  stats: Record<string, number>;
  /** Su tolva: itemId → unidades. */
  bag: Record<string, number>;
  /** Última liquidación de su carga. */
  lastAt: number;
  /** Unidades cargadas en total. */
  mined: number;
  mode: CaexMode;
  /** ¿Tiene su dron? Es uno, y sólo suyo. */
  drone: boolean;
  droneLevel: number;
}

export const DEFAULT_CAEX: CaexState = {
  owned: false,
  skin: 'srt',
  skins: ['srt'],
  color: '#f2b705',
  accent: '#1e2430',
  stats: {},
  bag: {},
  lastAt: 0,
  mined: 0,
  mode: 'route',
  drone: false,
  droneLevel: 1,
};

export function normalizeCaex(raw: Partial<CaexState> | undefined, now: number): CaexState {
  const skins = [...new Set([...DEFAULT_CAEX.skins, ...(raw?.skins ?? [])])].filter(
    (id) => !!CAEX_SKIN_MAP[id],
  );
  return {
    owned: raw?.owned === true,
    skin: skins.includes(raw?.skin ?? '') ? raw!.skin! : DEFAULT_CAEX.skin,
    skins,
    color: raw?.color ?? DEFAULT_CAEX.color,
    accent: raw?.accent ?? DEFAULT_CAEX.accent,
    stats: { ...(raw?.stats ?? {}) },
    bag: { ...(raw?.bag ?? {}) },
    lastAt: raw?.lastAt || now,
    mined: raw?.mined ?? 0,
    mode: CAEX_MODES.some((m) => m.id === raw?.mode) ? raw!.mode! : DEFAULT_CAEX.mode,
    drone: raw?.drone === true,
    droneLevel: Math.max(1, Math.floor(raw?.droneLevel ?? 1)),
  };
}

export interface DerivedCaex {
  def: CaexSkinDef;
  capacity: number;
  minePerSec: number;
  speed: number;
  /** Su dron, si lo tiene. */
  droneCarry: number;
  droneSpeed: number;
}

export function deriveCaex(caex: CaexState | undefined): DerivedCaex {
  const c = { ...DEFAULT_CAEX, ...(caex ?? {}) };
  const lvl = (id: CaexStat) => Math.max(0, Math.floor(c.stats?.[id] ?? 0));
  const dl = Math.max(1, Math.floor(c.droneLevel ?? 1));
  return {
    def: getCaexSkin(c.skin),
    capacity: CAEX.capacity + CAEX.capacityPerLevel * lvl('capacity'),
    minePerSec: CAEX.mining + CAEX.miningPerLevel * lvl('mining'),
    speed: CAEX.speed,
    droneCarry: CAEX.droneCarry + CAEX.droneCarryPerLevel * (dl - 1),
    droneSpeed: CAEX.droneSpeed + CAEX.droneSpeedPerLevel * (dl - 1),
  };
}

export function caexUsed(caex: CaexState | undefined): number {
  return Object.values(caex?.bag ?? {}).reduce((a, b) => a + Math.max(0, b), 0);
}

export function caexFree(caex: CaexState | undefined): number {
  return Math.max(0, deriveCaex(caex).capacity - caexUsed(caex));
}

export function caexStatCost(def: CaexStatDef, level: number): number {
  return def.cost(level);
}

export function caexDroneUpgradeCost(level: number): number {
  return Math.round(CAEX.droneUpgradeBase * Math.pow(CAEX.droneUpgradeGrowth, level));
}

/** Cada cuánto liquida el cliente lo que ha cargado el camión. */
export const CAEX_FLUSH_MS = 8_000;
