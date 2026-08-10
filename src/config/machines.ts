/**
 * MACHINE REGISTRY — data driven.
 *
 * Las máquinas son estado COMPARTIDO de la fábrica. Se simulan de forma
 * determinista a partir de timestamps (ver game/systems/production.ts):
 * el cliente NO escribe cada tick, sólo "liquida" la máquina cuando alguien
 * interactúa con ella. Ver FIREBASE_COSTS.md.
 */

import type { ItemId } from './items';

export type MachineKind = 'smelter' | 'assembler' | 'lab';

export interface MachineDef {
  id: string;
  kind: MachineKind;
  name: string;
  short: string;
  icon: string;
  /** Receta: entradas consumidas por ciclo. */
  input: Partial<Record<ItemId, number>>;
  /** Salidas producidas por ciclo. */
  output: Partial<Record<ItemId, number>>;
  /** Duración base de un ciclo en ms (antes de multiplicadores). */
  cycleMs: number;
  /** Capacidad del buffer de entrada (por tipo de item). */
  inputCap: number;
  /** Capacidad del buffer de salida (por tipo de item). Se atasca al llenarse. */
  outputCap: number;
  /** Nivel de fábrica necesario para que exista/funcione. */
  unlockFactoryLevel: number;
  /** XP que recibe el jugador al depositar una unidad de input. */
  xpPerDeposit: number;
  /** XP que recibe el jugador al recoger una unidad de output. */
  xpPerCollect: number;
  /** Posición en el mundo (en tiles). */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  accent: string;
  desc: string;
}

export const MACHINES = {
  smelter: {
    id: 'smelter',
    kind: 'smelter',
    name: 'Fundidora MK-I',
    short: 'FUNDIDORA',
    icon: '🔥',
    input: { ore: 2 },
    output: { ingot: 1 },
    cycleMs: 4200,
    inputCap: 40,
    outputCap: 30,
    unlockFactoryLevel: 1,
    xpPerDeposit: 2,
    xpPerCollect: 4,
    tx: 24,
    ty: 5,
    tw: 5,
    th: 4,
    accent: '#ff8a3d',
    desc: 'Convierte 2 Mineral en 1 Lingote de Acero.',
  },
  assembler: {
    id: 'assembler',
    kind: 'assembler',
    name: 'Ensambladora A-7',
    short: 'ENSAMBLADORA',
    icon: '🤖',
    input: { ingot: 2 },
    output: { gear: 1 },
    cycleMs: 7000,
    inputCap: 30,
    outputCap: 24,
    unlockFactoryLevel: 3,
    xpPerDeposit: 4,
    xpPerCollect: 9,
    tx: 24,
    ty: 15,
    tw: 5,
    th: 4,
    accent: '#8ef04a',
    desc: 'Convierte 2 Lingotes en 1 Engranaje.',
  },
  lab: {
    id: 'lab',
    kind: 'lab',
    name: 'Laboratorio Q',
    short: 'LABORATORIO',
    icon: '🔬',
    input: { gear: 2, crystal: 1 },
    output: { circuit: 1 },
    cycleMs: 12000,
    inputCap: 20,
    outputCap: 16,
    unlockFactoryLevel: 6,
    xpPerDeposit: 9,
    xpPerCollect: 22,
    tx: 8,
    ty: 15,
    tw: 5,
    th: 4,
    accent: '#c084fc',
    desc: 'Fabrica Circuitos Cuánticos con Engranajes y Cristal.',
  },
} as const satisfies Record<string, MachineDef>;

export type MachineId = keyof typeof MACHINES;

export const MACHINE_LIST = Object.values(MACHINES) as MachineDef[];

export function getMachine(id: string): MachineDef {
  const m = (MACHINES as Record<string, MachineDef>)[id];
  if (!m) throw new Error(`Máquina desconocida: ${id}`);
  return m;
}

/**
 * Mejoras de máquina (COMPARTIDAS, se pagan con dinero individual pero
 * benefician a todos). Cada nivel acelera el ciclo.
 */
export const MACHINE_UPGRADE = {
  maxLevel: 20,
  /** Multiplicador de velocidad por nivel: cycle / (1 + level * step) */
  speedStep: 0.22,
  baseCost: 450,
  costGrowth: 1.62,
  /** Contribución a la fábrica que genera comprar una mejora de máquina. */
  contribPerPurchase: 0.55,
};

export function machineUpgradeCost(level: number): number {
  return Math.round(
    MACHINE_UPGRADE.baseCost * Math.pow(MACHINE_UPGRADE.costGrowth, level),
  );
}

export function machineSpeedMultiplier(level: number): number {
  return 1 + level * MACHINE_UPGRADE.speedStep;
}
