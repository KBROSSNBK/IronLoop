/**
 * PROGRESIÓN DE LA FÁBRICA (compartida).
 *
 * `xpToNext` es la contribución acumulada necesaria para pasar al siguiente
 * nivel. La contribución se genera vendiendo, produciendo, donando materiales
 * o dinero y comprando mejoras de máquina.
 *
 * La lista NO está limitada a 10 niveles: más allá del último definido se
 * genera procedimentalmente (ver `getFactoryLevel`).
 */

export interface FactoryLevelDef {
  level: number;
  title: string;
  desc: string;
  /** Contribución necesaria para pasar del nivel anterior a éste. */
  xpToNext: number;
  /** Multiplicador global de producción (velocidad de máquinas). */
  productionMult: number;
  /** Producción pasiva base (unidades de valor/segundo) para recompensas offline. */
  idleRate: number;
  unlocks: string[];
  accent: string;
}

export const FACTORY_LEVELS: FactoryLevelDef[] = [
  {
    level: 1,
    title: 'Nave Abandonada',
    desc: 'Las luces parpadean. Todo se hace a mano.',
    xpToNext: 900,
    productionMult: 1,
    idleRate: 0,
    unlocks: ['Fundidora MK-I', 'Muelle de venta'],
    accent: '#64748b',
  },
  {
    level: 2,
    title: 'Primeras Cintas',
    desc: 'Las cintas transportadoras vuelven a girar.',
    xpToNext: 2600,
    productionMult: 1.15,
    idleRate: 0.6,
    unlocks: ['Cintas transportadoras', '+15% producción'],
    accent: '#0ea5e9',
  },
  {
    level: 3,
    title: 'Línea de Ensamblaje',
    desc: 'La Ensambladora A-7 arranca por primera vez.',
    xpToNext: 6200,
    productionMult: 1.32,
    idleRate: 1.6,
    unlocks: ['Ensambladora A-7', 'Engranajes'],
    accent: '#22c55e',
  },
  {
    level: 4,
    title: 'Semi-Automática',
    desc: 'Los brazos robóticos alimentan las máquinas.',
    xpToNext: 13000,
    productionMult: 1.55,
    idleRate: 3.4,
    unlocks: ['Brazos robóticos', 'Más cintas'],
    accent: '#84cc16',
  },
  {
    level: 5,
    title: 'Unidades Autónomas',
    desc: 'Los primeros robots de transporte patrullan la nave.',
    xpToNext: 26000,
    productionMult: 1.85,
    idleRate: 6.5,
    unlocks: ['Robot de transporte', 'Producción offline mejorada'],
    accent: '#eab308',
  },
  {
    level: 6,
    title: 'Laboratorio Q',
    desc: 'Se abre el ala de investigación.',
    xpToNext: 48000,
    productionMult: 2.2,
    idleRate: 11,
    unlocks: ['Laboratorio Q', 'Circuitos Cuánticos'],
    accent: '#a855f7',
  },
  {
    level: 7,
    title: 'Expansión Norte',
    desc: 'Nuevas áreas se iluminan.',
    xpToNext: 88000,
    productionMult: 2.6,
    idleRate: 18,
    unlocks: ['Segundo robot', 'Zona ampliada'],
    accent: '#ec4899',
  },
  {
    level: 8,
    title: 'Red Neuronal',
    desc: 'Una IA coordina la logística.',
    xpToNext: 160000,
    productionMult: 3.1,
    idleRate: 30,
    unlocks: ['IA logística', '+velocidad global'],
    accent: '#06b6d4',
  },
  {
    level: 9,
    title: 'Mega Fábrica',
    desc: 'La nave completa trabaja a pleno rendimiento.',
    xpToNext: 300000,
    productionMult: 3.8,
    idleRate: 52,
    unlocks: ['Tercer robot', 'Bonus global'],
    accent: '#f97316',
  },
  {
    level: 10,
    title: 'Complejo Futurista',
    desc: 'Hologramas, neón y acero. Aquí empieza lo bueno.',
    xpToNext: 560000,
    productionMult: 4.6,
    idleRate: 85,
    unlocks: ['Skin futurista', 'Prestigio disponible'],
    accent: '#22d3ee',
  },
];

/** Nivel a partir del cual el prestigio queda disponible (fase futura). */
export const PRESTIGE_UNLOCK_LEVEL = 10;

const LAST = FACTORY_LEVELS[FACTORY_LEVELS.length - 1];

/** Devuelve la definición de un nivel, generándola si supera la tabla. */
export function getFactoryLevel(level: number): FactoryLevelDef {
  if (level <= 0) return FACTORY_LEVELS[0];
  if (level <= FACTORY_LEVELS.length) return FACTORY_LEVELS[level - 1];
  const over = level - FACTORY_LEVELS.length;
  return {
    level,
    title: `Complejo Futurista +${over}`,
    desc: 'La fábrica sigue expandiéndose más allá de los planos originales.',
    xpToNext: Math.round(LAST.xpToNext * Math.pow(1.85, over)),
    productionMult: +(LAST.productionMult * Math.pow(1.12, over)).toFixed(3),
    idleRate: +(LAST.idleRate * Math.pow(1.35, over)).toFixed(2),
    unlocks: ['Bonus de producción'],
    accent: '#22d3ee',
  };
}

export function factoryProductionMultiplier(level: number): number {
  return getFactoryLevel(level).productionMult;
}

/** Objetivos cooperativos por nivel — se muestran en el panel de fábrica. */
export interface FactoryObjectiveDef {
  id: string;
  title: string;
  metric: 'produced' | 'sold' | 'contributed' | 'gathered';
  target: number;
  fromLevel: number;
  rewardContribution: number;
}

export const FACTORY_OBJECTIVES: FactoryObjectiveDef[] = [
  { id: 'obj_first_100', title: 'Producir 100 Lingotes entre todos', metric: 'produced', target: 100, fromLevel: 1, rewardContribution: 400 },
  { id: 'obj_gather_500', title: 'Extraer 500 unidades de Mineral', metric: 'gathered', target: 500, fromLevel: 1, rewardContribution: 500 },
  { id: 'obj_sell_10k', title: 'Vender $10.000 en mercancía', metric: 'sold', target: 10000, fromLevel: 2, rewardContribution: 1200 },
  { id: 'obj_produced_1k', title: 'Producir 1.000 unidades', metric: 'produced', target: 1000, fromLevel: 3, rewardContribution: 3000 },
  { id: 'obj_contrib_50k', title: 'Contribuir 50.000 al núcleo', metric: 'contributed', target: 50000, fromLevel: 5, rewardContribution: 9000 },
];
