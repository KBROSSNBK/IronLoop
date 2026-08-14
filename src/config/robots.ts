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
  /**
   * Máquina en la que deja. Si no existe (final de la cadena) el robot no
   * puede repartir: su único trabajo útil es VENDER.
   */
  to?: string;
  /** Item que transporta. */
  item: string;
  /** Unidades por minuto y por nivel. */
  ratePerMin: number;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  unlockFactoryLevel: number;
  /**
   * Recorrido REAL en píxeles de mundo: el primer punto es donde carga (frente
   * de la máquina de origen) y el último donde descarga (extremo de carga de
   * la cinta). El robot va y vuelve por estos puntos, que están trazados para
   * bordear las máquinas — hay un test que comprueba que no atraviesan nada.
   */
  path: { x: number; y: number }[];
  /** Cinta por la que entrega. Los robots terminales no tienen. */
  viaConveyor?: string;
  accent: string;
}

/**
 * Qué está haciendo un robot.
 *  · `belt`  — lleva el material a la cinta de la siguiente máquina (por defecto)
 *  · `sell`  — lo vende, y el dinero se reparte entre los jugadores conectados
 *  · `off`   — parado
 */
export type RobotMode = 'belt' | 'sell' | 'off';

export const ROBOT_MODES: { id: RobotMode; label: string; icon: string; desc: string }[] = [
  { id: 'belt', label: 'A la cinta', icon: '🛒', desc: 'Alimenta la siguiente máquina.' },
  {
    id: 'sell',
    label: 'Vender',
    icon: '💰',
    desc: 'Vende lo que recoge y reparte el dinero entre los conectados.',
  },
  { id: 'off', label: 'Parado', icon: '⏸️', desc: 'No hace nada.' },
];

export const ROBOTS: RobotDef[] = [
  {
    id: 'hauler_ingot',
    name: 'Portador MK-I',
    icon: '🤖',
    desc: 'Lleva Lingotes de la Fundidora a la Ensambladora por la cinta.',
    from: 'smelter',
    to: 'assembler',
    item: 'ingot',
    ratePerMin: 20,
    maxLevel: 10,
    baseCost: 2500,
    costGrowth: 1.7,
    unlockFactoryLevel: 5,
    // Frente de la Fundidora → extremo de carga de la cinta c2.
    path: [
      { x: 1060, y: 350 },
      { x: 1176, y: 350 },
      { x: 1176, y: 372 },
    ],
    viaConveyor: 'c2',
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
    ratePerMin: 12,
    maxLevel: 10,
    baseCost: 12000,
    costGrowth: 1.75,
    unlockFactoryLevel: 7,
    // Frente de la Ensambladora → rodea por debajo → carga de la cinta c5.
    path: [
      { x: 1060, y: 750 },
      { x: 920, y: 750 },
      { x: 920, y: 676 },
    ],
    viaConveyor: 'c5',
    accent: '#c084fc',
  },
  {
    id: 'hauler_recycled',
    name: 'Reciclador RX',
    icon: '♻️',
    desc: 'Saca el acero reciclado de la Recicladora y lo manda a la Ensambladora.',
    from: 'recycler',
    to: 'assembler',
    item: 'ingot',
    ratePerMin: 16,
    maxLevel: 10,
    baseCost: 6000,
    costGrowth: 1.72,
    unlockFactoryLevel: 4,
    // Frente de la Recicladora → rodea por debajo → carga de la cinta c8.
    path: [
      { x: 1060, y: 976 },
      { x: 1214, y: 976 },
      { x: 1214, y: 872 },
    ],
    viaConveyor: 'c8',
    accent: '#34d399',
  },
  {
    id: 'hauler_circuit',
    name: 'Portador MK-III',
    icon: '🔌',
    desc: 'Saca los Circuitos del Laboratorio y los manda a la Planta de Baterías.',
    from: 'lab',
    to: 'batteryPlant',
    item: 'circuit',
    ratePerMin: 8,
    maxLevel: 10,
    baseCost: 60000,
    costGrowth: 1.78,
    unlockFactoryLevel: 7,
    // Frente del Laboratorio → rodea el pilar por el sur → cinta de circuitos.
    path: [
      { x: 420, y: 790 },
      { x: 620, y: 790 },
      { x: 620, y: 545 },
    ],
    viaConveyor: 'c10',
    accent: '#c084fc',
  },
  {
    id: 'hauler_alloy',
    name: 'Portador Pesado',
    icon: '🧿',
    desc: 'Lleva las Aleaciones al Reactor de Núcleos.',
    from: 'alloy',
    to: 'reactor',
    item: 'alloy',
    ratePerMin: 7,
    maxLevel: 10,
    baseCost: 90000,
    costGrowth: 1.8,
    unlockFactoryLevel: 10,
    path: [
      { x: 1620, y: 700 },
      { x: 1770, y: 700 },
      { x: 1770, y: 918 },
      { x: 1600, y: 918 },
    ],
    viaConveyor: 'c11',
    accent: '#38bdf8',
  },
  {
    id: 'hauler_battery',
    name: 'Portador de Carga',
    icon: '🔋',
    desc: 'Lleva las Baterías al Reactor de Núcleos.',
    from: 'batteryPlant',
    to: 'reactor',
    item: 'battery',
    ratePerMin: 5,
    maxLevel: 10,
    baseCost: 180000,
    costGrowth: 1.82,
    unlockFactoryLevel: 10,
    path: [
      { x: 1620, y: 862 },
      { x: 1770, y: 862 },
      { x: 1770, y: 918 },
      { x: 1600, y: 918 },
    ],
    viaConveyor: 'c11',
    accent: '#a3e635',
  },
  {
    id: 'hauler_core',
    name: 'Custodio de Núcleos',
    icon: '💠',
    desc:
      'Retira los Núcleos del Reactor. Al final de la cadena no hay a dónde ' +
      'llevarlos: su trabajo es venderlos y repartir el dinero.',
    from: 'reactor',
    item: 'core',
    ratePerMin: 3,
    maxLevel: 10,
    baseCost: 400000,
    costGrowth: 1.85,
    unlockFactoryLevel: 12,
    path: [
      { x: 920, y: 1220 },
      { x: 1080, y: 1220 },
    ],
    accent: '#22d3ee',
  },
];

/** Fases del viaje de ida y vuelta del robot. */
export const ROBOT_TRIP = {
  /** Tiempo cargando en origen. */
  loadMs: 900,
  /** Tiempo descargando en la cinta. */
  unloadMs: 700,
  /** Velocidad de desplazamiento en px/s. */
  speed: 78,
};

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

/** Duración de un viaje completo (cargar, ir, descargar, volver) en ms. */
export function robotTripMs(def: RobotDef): number {
  let len = 0;
  for (let i = 1; i < def.path.length; i++) {
    len += Math.hypot(def.path[i].x - def.path[i - 1].x, def.path[i].y - def.path[i - 1].y);
  }
  const travel = (len / ROBOT_TRIP.speed) * 1000;
  return ROBOT_TRIP.loadMs + travel * 2 + ROBOT_TRIP.unloadMs;
}

/**
 * Unidades que carga el robot en CADA viaje. Es lo que sube al mejorarlo y
 * lo que se muestra encima del chasis mientras transporta, de modo que el
 * número que ves coincide con el caudal real (`robotRate`).
 */
export function robotCarry(def: RobotDef, level: number): number {
  if (level <= 0) return 0;
  const tripsPerMin = 60000 / robotTripMs(def);
  return Math.max(1, Math.round(robotRate(def, level) / tripsPerMin));
}

/** Parte del coste que va al progreso compartido de la fábrica. */
export const ROBOT_CONTRIB_RATIO = 0.5;

/** Tope de tiempo acumulable sin nadie conectado (anti-inflación). */
export const ROBOT_MAX_CATCHUP_MS = 8 * 3600 * 1000;
