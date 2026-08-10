/**
 * ÁRBOL DE MEJORAS PERSONALES — data driven.
 * Cada mejora se compra con el dinero INDIVIDUAL del jugador.
 * Añadir una rama nueva = añadir una entrada aquí.
 */

export type UpgradeId =
  | 'speed'
  | 'stamina'
  | 'regen'
  | 'capacity'
  | 'strength'
  | 'efficiency'
  | 'trading'
  | 'luck';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  desc: string;
  /** Texto del efecto por nivel, para la UI. */
  effect: (level: number) => string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  accent: string;
  /** Nivel de jugador mínimo para desbloquear la rama. */
  unlockLevel: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  speed: {
    id: 'speed',
    name: 'Botas Servo',
    icon: '👟',
    desc: 'Te mueves más rápido por la nave.',
    effect: (l) => `+${(l * 7).toFixed(0)}% velocidad`,
    maxLevel: 15,
    baseCost: 120,
    costGrowth: 1.45,
    accent: '#38bdf8',
    unlockLevel: 1,
  },
  stamina: {
    id: 'stamina',
    name: 'Batería Metabólica',
    icon: '🔋',
    desc: 'Aumenta tu estamina máxima.',
    effect: (l) => `+${l * 25} estamina máx.`,
    maxLevel: 20,
    baseCost: 150,
    costGrowth: 1.42,
    accent: '#22c55e',
    unlockLevel: 1,
  },
  regen: {
    id: 'regen',
    name: 'Regulador Metabólico',
    icon: '💚',
    desc: 'Recuperas estamina más rápido.',
    effect: (l) => `+${(l * 0.65).toFixed(2)}/s regeneración`,
    maxLevel: 20,
    baseCost: 240,
    costGrowth: 1.48,
    accent: '#4ade80',
    unlockLevel: 2,
  },
  capacity: {
    id: 'capacity',
    name: 'Mochila Modular',
    icon: '🎒',
    desc: 'Más huecos de inventario.',
    effect: (l) => `+${l * 5} huecos`,
    maxLevel: 18,
    baseCost: 300,
    costGrowth: 1.55,
    accent: '#f59e0b',
    unlockLevel: 1,
  },
  strength: {
    id: 'strength',
    name: 'Exoesqueleto',
    icon: '💪',
    desc: 'Extraes y depositas más unidades por acción.',
    effect: (l) => `+${l} unidad(es) por acción`,
    maxLevel: 12,
    baseCost: 500,
    costGrowth: 1.68,
    accent: '#ef4444',
    unlockLevel: 3,
  },
  efficiency: {
    id: 'efficiency',
    name: 'Optimizador Neural',
    icon: '🧠',
    desc: 'Las acciones tardan menos y gastan menos estamina.',
    effect: (l) => `-${Math.round((1 - Math.pow(0.93, l)) * 100)}% tiempo y coste`,
    maxLevel: 15,
    baseCost: 420,
    costGrowth: 1.55,
    accent: '#a78bfa',
    unlockLevel: 2,
  },
  trading: {
    id: 'trading',
    name: 'Licencia Comercial',
    icon: '📈',
    desc: 'Vendes tus productos más caros.',
    effect: (l) => `+${(l * 6).toFixed(0)}% precio de venta`,
    maxLevel: 20,
    baseCost: 650,
    costGrowth: 1.6,
    accent: '#fbbf24',
    unlockLevel: 4,
  },
  luck: {
    id: 'luck',
    name: 'Escáner de Vetas',
    icon: '🍀',
    desc: 'Más probabilidad de encontrar materiales raros.',
    effect: (l) => `+${(l * 1.8).toFixed(1)}% hallazgo raro`,
    maxLevel: 20,
    baseCost: 800,
    costGrowth: 1.62,
    accent: '#34d399',
    unlockLevel: 5,
  },
};

export const UPGRADE_LIST = Object.values(UPGRADES);

export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** Contribución a la fábrica generada por comprar mejoras personales.
 *  El dinero gastado NO desaparece del progreso global: una parte alimenta
 *  el núcleo (ver GAME_DESIGN.md § economía). */
export const UPGRADE_CONTRIB_RATIO = 0.35;
