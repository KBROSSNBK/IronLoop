/**
 * MISIONES PERSONALES — data driven.
 * Se mantienen 3 activas. Al reclamar una, entra otra del pool.
 */

export type MissionMetric =
  | 'gather'      // unidades extraídas
  | 'deposit'     // unidades depositadas en máquinas
  | 'produce'     // unidades recogidas de máquinas
  | 'sell'        // unidades vendidas
  | 'earn'        // dinero ganado
  | 'contribute'  // puntos contribuidos al núcleo
  | 'playtime'    // segundos jugados
  | 'upgrade';    // mejoras compradas

export interface MissionDef {
  id: string;
  title: string;
  icon: string;
  metric: MissionMetric;
  /** Filtro opcional por item (para gather/deposit/produce/sell). */
  item?: string;
  target: number;
  reward: { money: number; xp: number; items?: Record<string, number> };
  /** Nivel mínimo de jugador para que el pool la ofrezca. */
  minLevel: number;
  tier: 1 | 2 | 3;
}

export const MISSION_POOL: MissionDef[] = [
  { id: 'm_gather_15', title: 'Extrae 15 Minerales', icon: '⛏️', metric: 'gather', item: 'ore', target: 15, reward: { money: 180, xp: 60 }, minLevel: 1, tier: 1 },
  { id: 'm_deposit_10', title: 'Deposita 10 unidades en máquinas', icon: '📥', metric: 'deposit', target: 10, reward: { money: 200, xp: 70 }, minLevel: 1, tier: 1 },
  { id: 'm_produce_5', title: 'Recoge 5 productos terminados', icon: '📦', metric: 'produce', target: 5, reward: { money: 260, xp: 90 }, minLevel: 1, tier: 1 },
  { id: 'm_sell_8', title: 'Vende 8 unidades', icon: '💰', metric: 'sell', target: 8, reward: { money: 240, xp: 80 }, minLevel: 1, tier: 1 },
  { id: 'm_play_180', title: 'Trabaja 3 minutos seguidos', icon: '⏱️', metric: 'playtime', target: 180, reward: { money: 150, xp: 100 }, minLevel: 1, tier: 1 },
  { id: 'm_contrib_200', title: 'Contribuye 200 al núcleo', icon: '🏭', metric: 'contribute', target: 200, reward: { money: 300, xp: 150 }, minLevel: 2, tier: 2 },
  { id: 'm_earn_1000', title: 'Gana $1.000', icon: '💵', metric: 'earn', target: 1000, reward: { money: 400, xp: 160 }, minLevel: 2, tier: 2 },
  { id: 'm_gather_60', title: 'Extrae 60 Minerales', icon: '⛏️', metric: 'gather', item: 'ore', target: 60, reward: { money: 520, xp: 220, items: { energyDrink: 1 } }, minLevel: 3, tier: 2 },
  { id: 'm_upgrade_2', title: 'Compra 2 mejoras', icon: '🛠️', metric: 'upgrade', target: 2, reward: { money: 350, xp: 200 }, minLevel: 3, tier: 2 },
  { id: 'm_produce_25', title: 'Recoge 25 productos', icon: '📦', metric: 'produce', target: 25, reward: { money: 900, xp: 380 }, minLevel: 5, tier: 3 },
  { id: 'm_sell_50', title: 'Vende 50 unidades', icon: '💰', metric: 'sell', target: 50, reward: { money: 1200, xp: 420 }, minLevel: 5, tier: 3 },
  { id: 'm_contrib_2000', title: 'Contribuye 2.000 al núcleo', icon: '🏭', metric: 'contribute', target: 2000, reward: { money: 1600, xp: 700, items: { energyDrink: 2 } }, minLevel: 6, tier: 3 },
  { id: 'm_earn_10000', title: 'Gana $10.000', icon: '💵', metric: 'earn', target: 10000, reward: { money: 2500, xp: 900 }, minLevel: 8, tier: 3 },
];

export const ACTIVE_MISSION_SLOTS = 3;

export function getMissionDef(id: string): MissionDef | undefined {
  return MISSION_POOL.find((m) => m.id === id);
}

/** Elige misiones nuevas evitando duplicados y respetando el nivel. */
export function rollMissions(
  playerLevel: number,
  exclude: string[],
  count: number,
  rand: () => number = Math.random,
): string[] {
  const pool = MISSION_POOL.filter(
    (m) => m.minLevel <= playerLevel && !exclude.includes(m.id),
  );
  const picked: string[] = [];
  const copy = [...pool];
  while (picked.length < count && copy.length > 0) {
    const i = Math.floor(rand() * copy.length);
    picked.push(copy[i].id);
    copy.splice(i, 1);
  }
  // Si el pool se agota (jugador de nivel bajo), permite repetir.
  if (picked.length < count) {
    const fallback = MISSION_POOL.filter((m) => m.minLevel <= playerLevel);
    while (picked.length < count && fallback.length > 0) {
      picked.push(fallback[Math.floor(rand() * fallback.length)].id);
    }
  }
  return picked;
}
