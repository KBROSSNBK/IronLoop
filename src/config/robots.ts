/**
 * ROBOTS LOGÍSTICOS — data driven.
 *
 * Un robot NO extrae: eso sigue siendo trabajo de los jugadores. Lo que hace
 * es el paseo aburrido: sacar producto de la salida de una máquina y meterlo
 * en la entrada de la siguiente, usando la cinta correspondiente.
 *
 * Se compran en el TALLER, se pagan con dinero individual y benefician a toda
 * la fábrica, igual que las mejoras de máquina.
 */

export interface RobotDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Máquina de la que recoge (su buffer de SALIDA). */
  from: string;
  /** Máquina en la que deja (su buffer de ENTRADA). */
  to: string;
  /** Item que transporta. */
  item: string;
  /** Unidades por minuto y por nivel. */
  ratePerMin: number;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  unlockFactoryLevel: number;
  /** Ruta visual de config/world.ts. */
  routeId: string;
  accent: string;
}

export const ROBOTS: RobotDef[] = [
  {
    id: 'hauler_ingot',
    name: 'Portador MK-I',
    icon: '🤖',
    desc: 'Lleva Lingotes de la Fundidora a la Ensambladora por la cinta.',
    from: 'smelter',
    to: 'assembler',
    item: 'ingot',
    ratePerMin: 8,
    maxLevel: 10,
    baseCost: 2500,
    costGrowth: 1.7,
    unlockFactoryLevel: 5,
    routeId: 'r1',
    accent: '#8ef04a',
  },
  {
    id: 'hauler_gear',
    name: 'Portador MK-II',
    icon: '🦿',
    desc: 'Lleva Engranajes de la Ensambladora al Laboratorio.',
    from: 'assembler',
    to: 'lab',
    item: 'gear',
    ratePerMin: 5,
    maxLevel: 10,
    baseCost: 12000,
    costGrowth: 1.75,
    unlockFactoryLevel: 7,
    routeId: 'r2',
    accent: '#c084fc',
  },
];

export const ROBOT_MAP: Record<string, RobotDef> = Object.fromEntries(
  ROBOTS.map((r) => [r.id, r]),
);

export function getRobot(id: string): RobotDef | undefined {
  return ROBOT_MAP[id];
}

export function robotCost(def: RobotDef, currentLevel: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** Unidades por minuto que mueve el robot a un nivel dado. */
export function robotRate(def: RobotDef, level: number): number {
  return def.ratePerMin * level;
}

/** Parte del coste que va al progreso compartido de la fábrica. */
export const ROBOT_CONTRIB_RATIO = 0.5;

/** Tope de tiempo acumulable sin nadie conectado (anti-inflación). */
export const ROBOT_MAX_CATCHUP_MS = 8 * 3600 * 1000;
