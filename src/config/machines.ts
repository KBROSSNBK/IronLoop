/**
 * MACHINE REGISTRY — data driven.
 *
 * Las máquinas son estado COMPARTIDO de la fábrica. Se simulan de forma
 * determinista a partir de timestamps (ver game/systems/production.ts):
 * el cliente NO escribe cada tick, sólo "liquida" la máquina cuando alguien
 * interactúa con ella. Ver FIREBASE_COSTS.md.
 */

import type { ItemId } from './items';

export type MachineKind =
  | 'smelter'
  | 'assembler'
  | 'lab'
  | 'recycler'
  | 'alloy'
  | 'battery'
  | 'reactor'
  | 'fusion'
  | 'refinery'
  | 'starforge';

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
  /**
   * Referencia visual de "llenado" de los buffers. NO limita nada: las
   * máquinas aceptan y acumulan material sin tope (ver `production.ts`).
   * Sólo se usa para pintar la barrita de la tolva.
   */
  inputCap: number;
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
  recycler: {
    id: 'recycler',
    kind: 'recycler',
    name: 'Recicladora R-3',
    short: 'RECICLADORA',
    icon: '♻️',
    // Da salida a la chatarra: 4 restos sin valor → 1 lingote aprovechable.
    input: { scrap: 4 },
    output: { ingot: 1 },
    cycleMs: 5000,
    inputCap: 60,
    outputCap: 40,
    unlockFactoryLevel: 4,
    xpPerDeposit: 2,
    xpPerCollect: 6,
    tx: 24,
    ty: 21,
    tw: 5,
    th: 4,
    accent: '#34d399',
    desc: 'Convierte 4 de Chatarra en 1 Lingote de Acero.',
  },

  // ── Cadena avanzada: cobre y titanio → aleación → batería → núcleo ──
  alloy: {
    id: 'alloy',
    kind: 'alloy',
    name: 'Fundición de Aleaciones',
    short: 'ALEACIONES',
    icon: '🧿',
    input: { copper: 2, ingot: 1 },
    output: { alloy: 1 },
    cycleMs: 9000,
    inputCap: 40,
    outputCap: 30,
    unlockFactoryLevel: 5,
    xpPerDeposit: 6,
    xpPerCollect: 16,
    tx: 38,
    ty: 14,
    tw: 5,
    th: 4,
    accent: '#38bdf8',
    desc: 'Funde 2 Cobre y 1 Lingote en 1 Aleación Reforzada.',
  },
  batteryPlant: {
    id: 'batteryPlant',
    kind: 'battery',
    name: 'Planta de Baterías',
    short: 'BATERÍAS',
    icon: '🔋',
    input: { circuit: 1, copper: 2 },
    output: { battery: 1 },
    cycleMs: 14000,
    inputCap: 30,
    outputCap: 24,
    unlockFactoryLevel: 7,
    xpPerDeposit: 12,
    xpPerCollect: 34,
    tx: 38,
    ty: 18,
    tw: 5,
    th: 4,
    accent: '#a3e635',
    desc: 'Combina 1 Circuito y 2 Cobre en 1 Batería de Alta Carga.',
  },
  reactor: {
    id: 'reactor',
    kind: 'reactor',
    name: 'Reactor de Núcleos',
    short: 'REACTOR',
    icon: '💠',
    input: { alloy: 2, battery: 1, titanium: 2 },
    output: { core: 1 },
    cycleMs: 22000,
    inputCap: 24,
    outputCap: 20,
    unlockFactoryLevel: 10,
    xpPerDeposit: 22,
    xpPerCollect: 90,
    tx: 20,
    ty: 27,
    tw: 6,
    th: 4,
    accent: '#22d3ee',
    desc: 'Ensambla Aleación, Batería y Titanio en 1 Núcleo de Energía.',
  },

  // ── Final de la cadena: la Zona Final, al suroeste de la nave ──
  fusion: {
    id: 'fusion',
    kind: 'fusion',
    name: 'Cámara de Singularidad',
    short: 'SINGULARIDAD',
    icon: '🔳',
    input: { core: 1, circuit: 2, alloy: 2 },
    output: { singularity: 1 },
    cycleMs: 34000,
    inputCap: 20,
    outputCap: 12,
    unlockFactoryLevel: 12,
    xpPerDeposit: 40,
    xpPerCollect: 240,
    tx: 5,
    ty: 28,
    tw: 6,
    th: 4,
    accent: '#f472b6',
    desc: 'Comprime Núcleo, Circuitos y Aleación en 1 Célula de Singularidad.',
  },

  /*
   * ── EXPEDICIÓN: máquinas del otro planeta ──
   *
   * Trabajan con material que en la estación no existe, así que la cadena de
   * allí es independiente. Lo que sale se manda de vuelta en la lanzadera y
   * se vende para toda la tripulación.
   */
  refinery: {
    id: 'refinery',
    kind: 'refinery',
    name: 'Refinería de Vacío',
    short: 'REFINERÍA',
    icon: '🔮',
    input: { voidOre: 2, stellarGas: 1 },
    output: { voidAlloy: 1 },
    cycleMs: 11000,
    inputCap: 40,
    outputCap: 30,
    unlockFactoryLevel: 15,
    xpPerDeposit: 14,
    xpPerCollect: 40,
    tx: 32,
    ty: 42,
    tw: 5,
    th: 4,
    accent: '#a78bfa',
    desc: 'Refina 2 Mineral de Vacío con 1 Gas Estelar en 1 Aleación de Vacío.',
  },
  starForge: {
    id: 'starForge',
    kind: 'starforge',
    name: 'Forja Estelar',
    short: 'FORJA ESTELAR',
    icon: '⭐',
    input: { voidAlloy: 3 },
    output: { starCell: 1 },
    cycleMs: 26000,
    inputCap: 24,
    outputCap: 16,
    unlockFactoryLevel: 16,
    xpPerDeposit: 30,
    xpPerCollect: 150,
    tx: 39,
    ty: 48,
    tw: 5,
    th: 4,
    accent: '#fbbf24',
    desc: 'Funde 3 Aleaciones de Vacío en 1 Célula Estelar.',
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
