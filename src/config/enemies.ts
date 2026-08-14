/**
 * ENEMIGOS — chatarra reanimada que ronda las zonas de trabajo.
 *
 * Aparecen mientras recolectas, que es cuando estás quieto y expuesto. No
 * quitan vida (no existe tal recurso): drenan ESTAMINA, así que reutilizan un
 * sistema que ya estaba y que además encaja — si te descuidas, te quedas sin
 * fuelle para seguir extrayendo.
 *
 * La simulación es LOCAL de cada jugador: cada uno se enfrenta a sus propios
 * drones. Así no hay que sincronizar decenas de entidades por red y no puede
 * haber dos jugadores matando al mismo bicho. La XP sí se valida en servidor
 * (ver `opCombatReward`).
 */

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  /** Velocidad en px/s. */
  speed: number;
  /** Estamina que drena por segundo mientras te toca. */
  drain: number;
  /** XP al destruirlo. */
  xp: number;
  /** Radio de colisión. */
  radius: number;
  color: string;
  accent: string;
  /** Nivel de jugador a partir del cual puede aparecer. */
  fromLevel: number;
  /** Peso relativo en la tabla de aparición. */
  weight: number;
  shape: 'drone' | 'crawler' | 'brute';
}

export const ENEMIES: EnemyDef[] = [
  {
    id: 'scrapfly',
    name: 'Chatarrilla',
    hp: 10,
    speed: 46,
    drain: 5,
    xp: 4,
    radius: 9,
    color: '#94a3b8',
    accent: '#f87171',
    fromLevel: 1,
    weight: 10,
    shape: 'drone',
  },
  {
    id: 'crawler',
    name: 'Reptador',
    hp: 26,
    speed: 34,
    drain: 8,
    xp: 9,
    radius: 11,
    color: '#7c4a1e',
    accent: '#fbbf24',
    fromLevel: 4,
    weight: 7,
    shape: 'crawler',
  },
  {
    id: 'sparker',
    name: 'Chispeante',
    hp: 18,
    speed: 72,
    drain: 6,
    xp: 12,
    radius: 9,
    color: '#0ea5e9',
    accent: '#67e8f9',
    fromLevel: 8,
    weight: 5,
    shape: 'drone',
  },
  {
    id: 'brute',
    name: 'Amasijo',
    hp: 90,
    speed: 26,
    drain: 14,
    xp: 34,
    radius: 15,
    color: '#4c1d95',
    accent: '#c084fc',
    fromLevel: 12,
    weight: 3,
    shape: 'brute',
  },
];

export const COMBAT = {
  /** Distancia a la que aparecen, fuera de la pantalla cercana. */
  spawnDistance: 260,
  /** Máximo de enemigos vivos a la vez. */
  maxAlive: 14,
  /** Segundos entre apariciones mientras recolectas. */
  spawnEveryMs: 2600,
  /** Fuera de la recolección aparecen mucho más despacio. */
  idleSpawnMultiplier: 4,
  /** Nivel de jugador desde el que empiezan a aparecer. */
  fromPlayerLevel: 2,
  /** La vida del enemigo escala con el nivel del jugador. */
  hpPerPlayerLevel: 0.09,
  /** Distancia a la que dejan de perseguirte y desaparecen. */
  despawnDistance: 900,
  /** Cada cuánto se envía al servidor la XP acumulada. */
  rewardFlushMs: 12000,
  /** Tope de XP por envío, para que un cliente manipulado no infle nada. */
  maxXpPerFlush: 900,
};

/** Elige un enemigo apropiado para el nivel del jugador. */
export function rollEnemy(playerLevel: number, rand: () => number = Math.random): EnemyDef {
  const pool = ENEMIES.filter((e) => e.fromLevel <= playerLevel);
  const usable = pool.length > 0 ? pool : [ENEMIES[0]];
  const total = usable.reduce((a, e) => a + e.weight, 0);
  let roll = rand() * total;
  for (const e of usable) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return usable[usable.length - 1];
}

/** Vida efectiva según el nivel del jugador. */
export function enemyHp(def: EnemyDef, playerLevel: number): number {
  return Math.round(def.hp * (1 + (playerLevel - 1) * COMBAT.hpPerPlayerLevel));
}
