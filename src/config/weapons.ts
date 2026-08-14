/**
 * ARMAS AUTOMÁTICAS — data driven.
 *
 * El arma dispara SOLA a lo que se acerque: no hay botón de disparo, porque
 * el juego sigue siendo de fábrica, no un shooter. Lo que el jugador decide
 * es en qué invertir: daño, cadencia, número de proyectiles o cambiar de arma.
 *
 * Todo se compra en el TALLER, con el mismo dinero individual que las demás
 * mejoras personales.
 */

export type WeaponStat = 'damage' | 'rate' | 'multishot';

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Daño por proyectil antes de mejoras. */
  damage: number;
  /** Milisegundos entre disparos antes de mejoras. */
  fireRateMs: number;
  /** Proyectiles por disparo antes de mejoras. */
  projectiles: number;
  /** Dispersión total del abanico, en radianes. */
  spread: number;
  /** Alcance en píxeles de mundo. */
  range: number;
  /** Velocidad del proyectil en px/s. */
  speed: number;
  /** Coste de desbloqueo. El arma inicial es gratis. */
  cost: number;
  /** Nivel de jugador necesario para comprarla. */
  unlockLevel: number;
  color: string;
  /** Aspecto del proyectil. */
  bullet: 'dot' | 'pellet' | 'beam' | 'plasma';
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'pistol',
    name: 'Pistola de Servicio',
    icon: '🔫',
    desc: 'El arma reglamentaria de todo operario. Fiable y sin sorpresas.',
    damage: 6,
    fireRateMs: 620,
    projectiles: 1,
    spread: 0,
    range: 190,
    speed: 340,
    cost: 0,
    unlockLevel: 1,
    color: '#fbbf24',
    bullet: 'dot',
  },
  {
    id: 'smg',
    name: 'Subfusil MK-2',
    icon: '🔩',
    desc: 'Cadencia alta y poco daño por bala. Bueno contra enjambres.',
    damage: 5,
    fireRateMs: 260,
    projectiles: 1,
    spread: 0.1,
    range: 210,
    speed: 400,
    cost: 4500,
    unlockLevel: 5,
    color: '#38bdf8',
    bullet: 'dot',
  },
  {
    id: 'shotgun',
    name: 'Escopeta de Taller',
    icon: '💥',
    desc: 'Abanico de perdigones. Demoledora de cerca, inútil de lejos.',
    damage: 5,
    fireRateMs: 900,
    projectiles: 4,
    spread: 0.6,
    range: 130,
    speed: 300,
    cost: 14000,
    unlockLevel: 9,
    color: '#f97316',
    bullet: 'pellet',
  },
  {
    id: 'rifle',
    name: 'Rifle de Riel',
    icon: '🎯',
    desc: 'Un solo proyectil, muy rápido y muy lejos.',
    damage: 26,
    fireRateMs: 1100,
    projectiles: 1,
    spread: 0,
    range: 320,
    speed: 720,
    cost: 42000,
    unlockLevel: 14,
    color: '#a78bfa',
    bullet: 'beam',
  },
  {
    id: 'plasma',
    name: 'Emisor de Plasma',
    icon: '⚡',
    desc: 'Descarga en abanico que atraviesa la chatarra más dura.',
    damage: 18,
    fireRateMs: 520,
    projectiles: 3,
    spread: 0.35,
    range: 250,
    speed: 460,
    cost: 130000,
    unlockLevel: 20,
    color: '#22d3ee',
    bullet: 'plasma',
  },
];

export const WEAPON_MAP: Record<string, WeaponDef> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
);

export function getWeapon(id: string | undefined): WeaponDef {
  return WEAPON_MAP[id ?? 'pistol'] ?? WEAPONS[0];
}

/** Mejoras del arma. Se aplican al arma que lleves puesta, sea cual sea. */
export interface WeaponStatDef {
  id: WeaponStat;
  name: string;
  icon: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  accent: string;
  effect: (level: number) => string;
}

export const WEAPON_STATS: Record<WeaponStat, WeaponStatDef> = {
  damage: {
    id: 'damage',
    name: 'Munición Perforante',
    icon: '🩸',
    desc: 'Más daño por proyectil.',
    maxLevel: 25,
    baseCost: 400,
    costGrowth: 1.42,
    accent: '#f87171',
    effect: (l) => `+${l * 18}% daño`,
  },
  rate: {
    id: 'rate',
    name: 'Mecanismo Rápido',
    icon: '⏱️',
    desc: 'Dispara más veces por segundo.',
    maxLevel: 20,
    baseCost: 600,
    costGrowth: 1.46,
    accent: '#38bdf8',
    effect: (l) => `−${Math.round((1 - Math.pow(0.93, l)) * 100)}% tiempo entre disparos`,
  },
  multishot: {
    id: 'multishot',
    name: 'Cargador Múltiple',
    icon: '🎇',
    desc: 'Añade proyectiles a cada disparo.',
    maxLevel: 8,
    baseCost: 3000,
    costGrowth: 1.9,
    accent: '#a3e635',
    effect: (l) => `+${l} proyectil${l === 1 ? '' : 'es'}`,
  },
};

export const WEAPON_STAT_LIST = Object.values(WEAPON_STATS);

export function weaponStatCost(def: WeaponStatDef, currentLevel: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** Estado del arma que guarda el jugador. */
export interface WeaponState {
  type: string;
  /** Armas ya compradas, para poder cambiar sin volver a pagar. */
  owned: string[];
  damage: number;
  rate: number;
  multishot: number;
}

export const DEFAULT_WEAPON: WeaponState = {
  type: 'pistol',
  owned: ['pistol'],
  damage: 0,
  rate: 0,
  multishot: 0,
};

export interface DerivedWeapon {
  def: WeaponDef;
  damage: number;
  fireRateMs: number;
  projectiles: number;
  spread: number;
  range: number;
  speed: number;
  /** Daño teórico por segundo, para mostrarlo en el Taller. */
  dps: number;
}

export function deriveWeapon(w: WeaponState | undefined): DerivedWeapon {
  const state = { ...DEFAULT_WEAPON, ...(w ?? {}) };
  const def = getWeapon(state.type);
  const damage = def.damage * (1 + state.damage * 0.18);
  const fireRateMs = Math.max(70, def.fireRateMs * Math.pow(0.93, state.rate));
  const projectiles = def.projectiles + state.multishot;
  // Un abanico con más proyectiles se abre un poco más, si el arma abre.
  const spread = def.spread > 0 ? def.spread + state.multishot * 0.06 : 0;
  return {
    def,
    damage,
    fireRateMs,
    projectiles,
    spread,
    range: def.range,
    speed: def.speed,
    dps: (damage * projectiles) / (fireRateMs / 1000),
  };
}
