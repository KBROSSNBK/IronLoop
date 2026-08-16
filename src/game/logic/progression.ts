/**
 * NIVELES, INVENTARIO, MISIONES Y RECOMPENSAS OFFLINE — lógica pura.
 * Compartida por el cliente, el backend local y las Cloud Functions.
 */

import {
  BALANCE,
  LEVELUP_TOTAL_MONEY_CAP,
  MAX_FACTORY_LEVELS_PER_WRITE,
  MAX_LEVELS_PER_WRITE,
  OFFLINE_MONEY_CAP,
  OFFLINE_XP_CAP,
  SALE_CLAIM_CAP,
  deriveStats,
} from '../../config/balance';
import { getItem } from '../../config/items';
import {
  ACTIVE_MISSION_SLOTS,
  getMissionDef,
  rollMissions,
  type MissionMetric,
} from '../../config/missions';
import { getFactoryLevel } from '../../config/factoryLevels';
import type {
  FactoryState,
  MissionProgress,
  OfflineReport,
  PlayerState,
} from '../../types';

/* ───────────────────────────── NIVELES ───────────────────────────── */

export function xpForLevel(level: number): number {
  return BALANCE.leveling.xpForLevel(level);
}

export interface LevelUpResult {
  level: number;
  xp: number;
  levelsGained: number;
  moneyReward: number;
}

/**
 * Aplica XP y resuelve todas las subidas de nivel encadenadas.
 *
 * CON TECHO DE NIVELES POR ESCRITURA. Las reglas de seguridad rechazan una
 * escritura que suba el nivel más de 50 de golpe, y una cifra de XP absurda
 * (un documento manipulado, un cambio de balance) podía subir 300. La
 * escritura se rechazaría entera y el jugador se quedaría SIN PODER JUGAR:
 * cada acción reintentaría el mismo salto imposible. Es exactamente lo que ya
 * pasó una vez con la recompensa de dinero.
 */
export function applyXp(level: number, xp: number, gained: number): LevelUpResult {
  let lv = level;
  let cur = xp + gained;
  let gainedLevels = 0;
  let money = 0;
  while (cur >= xpForLevel(lv) && gainedLevels < MAX_LEVELS_PER_WRITE) {
    cur -= xpForLevel(lv);
    lv += 1;
    gainedLevels += 1;
    money += BALANCE.leveling.moneyPerLevel(lv);
  }
  // Al tocar techo, lo que sobra no se arrastra: un resto gigante también
  // reventaría el límite de XP por escritura.
  if (gainedLevels >= MAX_LEVELS_PER_WRITE && cur >= xpForLevel(lv)) {
    cur = Math.max(0, xpForLevel(lv) - 1);
  }
  return {
    level: lv,
    xp: cur,
    levelsGained: gainedLevels,
    // Techo también al total: subir varios niveles de golpe no puede pasarse
    // de lo que las reglas de seguridad admiten en una escritura.
    moneyReward: Math.min(money, LEVELUP_TOTAL_MONEY_CAP),
  };
}

export function levelProgress(level: number, xp: number): number {
  const need = xpForLevel(level);
  return need > 0 ? Math.min(1, xp / need) : 0;
}

/* ───────────────────────────── ESTAMINA ───────────────────────────── */

type StaminaSource = Pick<PlayerState, 'stamina' | 'staminaAt' | 'upgrades'>;

/**
 * Estamina actual DERIVADA del par (valor, instante).
 * La regeneración no requiere ninguna escritura: se calcula sobre la marcha,
 * igual que el progreso de las máquinas.
 */
export function currentStamina(p: StaminaSource, now: number): number {
  const s = deriveStats(p.upgrades);
  const base = Math.min(p.stamina, s.maxStamina);
  const dt = Math.max(0, (now - (p.staminaAt || now)) / 1000);
  return Math.max(0, Math.min(s.maxStamina, base + s.staminaRegen * dt));
}

export function maxStamina(p: Pick<PlayerState, 'upgrades'>): number {
  return deriveStats(p.upgrades).maxStamina;
}

/** Consume estamina fijando una nueva línea base temporal. */
export function spendStamina(
  p: StaminaSource,
  now: number,
  cost: number,
): { stamina: number; staminaAt: number } {
  const cur = currentStamina(p, now);
  return { stamina: Math.max(0, cur - cost), staminaAt: now };
}

/* ──────────────────────────── INVENTARIO ──────────────────────────── */

export function inventoryUsed(inv: Record<string, number>): number {
  let n = 0;
  for (const [id, qty] of Object.entries(inv)) {
    if (qty <= 0) continue;
    n += getItem(id).weight * qty;
  }
  return n;
}

export function inventoryCapacity(p: Pick<PlayerState, 'upgrades'>): number {
  return deriveStats(p.upgrades).inventorySlots;
}

export function inventoryFree(p: Pick<PlayerState, 'upgrades' | 'inventory'>): number {
  return Math.max(0, inventoryCapacity(p) - inventoryUsed(p.inventory));
}

export function addToInventory(
  inv: Record<string, number>,
  item: string,
  qty: number,
): Record<string, number> {
  const next = { ...inv };
  next[item] = (next[item] ?? 0) + qty;
  if (next[item] <= 0) delete next[item];
  return next;
}

export function hasItems(
  inv: Record<string, number>,
  items: Record<string, number>,
): boolean {
  return Object.entries(items).every(([id, n]) => (inv[id] ?? 0) >= n);
}

/* ────────────────────────────── VENTA ────────────────────────────── */

export interface SaleResult {
  money: number;
  xp: number;
  units: number;
  breakdown: { item: string; qty: number; value: number }[];
}

/** Valor de venta de un lote, aplicando la mejora de comercio del jugador. */
export function computeSale(
  inventory: Record<string, number>,
  items: Record<string, number>,
  upgrades: Record<string, number>,
  /**
   * Techo de dinero de UNA venta. Las reglas de seguridad rechazan cualquier
   * escritura que suba el dinero más de `MAX_MONEY_PER_WRITE`, y con la
   * mochila mejorable sin tope y los productos finales valiendo miles, un
   * cargamento entero podía pasarse y dejar la partida bloqueada. Lo que no
   * cabe simplemente no se vende: se queda en la mochila.
   */
  moneyCap = SALE_CLAIM_CAP,
): SaleResult {
  const mult = deriveStats(upgrades).sellMultiplier;
  const breakdown: SaleResult['breakdown'] = [];
  let money = 0;
  let units = 0;
  // Lo barato primero: así el techo sólo recorta las piezas gordas y nunca
  // deja al jugador con la mochila llena de chatarra sin vender.
  const lineas = Object.entries(items).sort(
    (a, b) => precio(a[0]) - precio(b[0]),
  );
  for (const [id, qtyRaw] of lineas) {
    let qty = Math.min(qtyRaw, inventory[id] ?? 0);
    if (qty <= 0) continue;
    const def = itemOrNull(id);
    if (!def || def.sellPrice <= 0) continue;
    const unidad = Math.max(1, Math.round(def.sellPrice * mult));
    const caben = Math.floor((moneyCap - money) / unidad);
    if (caben <= 0) continue;
    qty = Math.min(qty, caben);
    const value = Math.round(def.sellPrice * qty * mult);
    money += value;
    units += qty;
    breakdown.push({ item: id, qty, value });
  }
  return { money, xp: Math.round(units * 3 + money * 0.05), units, breakdown };
}

/** Material del catálogo, o null si el documento trae uno desconocido. */
function itemOrNull(id: string): ReturnType<typeof getItem> | null {
  try {
    return getItem(id);
  } catch {
    return null;
  }
}

function precio(id: string): number {
  return itemOrNull(id)?.sellPrice ?? 0;
}

/** Todo lo vendible que lleva encima el jugador. */
export function sellableItems(inv: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, qty] of Object.entries(inv)) {
    if (qty > 0 && getItem(id).sellPrice > 0) out[id] = qty;
  }
  return out;
}

/* ────────────────────────────── MISIONES ────────────────────────────── */

export interface MissionEvent {
  metric: MissionMetric;
  item?: string;
  amount: number;
}

/** Devuelve las misiones actualizadas y cuáles se acaban de completar. */
export function applyMissionEvents(
  missions: MissionProgress[],
  events: MissionEvent[],
): { missions: MissionProgress[]; completed: string[] } {
  const completed: string[] = [];
  const next = missions.map((m) => {
    const def = getMissionDef(m.id);
    if (!def || m.claimed) return m;
    let progress = m.progress;
    for (const ev of events) {
      if (ev.metric !== def.metric) continue;
      if (def.item && ev.item && def.item !== ev.item) continue;
      progress += ev.amount;
    }
    if (progress === m.progress) return m;
    const capped = Math.min(progress, def.target);
    if (m.progress < def.target && capped >= def.target) completed.push(m.id);
    return { ...m, progress: capped };
  });
  return { missions: next, completed };
}

export function isMissionComplete(m: MissionProgress): boolean {
  const def = getMissionDef(m.id);
  return !!def && m.progress >= def.target && !m.claimed;
}

/** Reclama una misión: devuelve recompensa y sustituye la misión por otra. */
export function claimMission(
  player: PlayerState,
  missionId: string,
  now = Date.now(),
):
  | { ok: false; reason: string }
  | {
      ok: true;
      reward: { money: number; xp: number; items: Record<string, number> };
      missions: MissionProgress[];
    } {
  const idx = player.missions.findIndex((m) => m.id === missionId);
  if (idx < 0) return { ok: false, reason: 'Misión no encontrada' };
  const m = player.missions[idx];
  const def = getMissionDef(missionId);
  if (!def) return { ok: false, reason: 'Misión desconocida' };
  if (m.claimed) return { ok: false, reason: 'Ya reclamada' };
  if (m.progress < def.target) return { ok: false, reason: 'Aún no completada' };

  const others = player.missions.filter((_, i) => i !== idx).map((x) => x.id);
  const [replacement] = rollMissions(player.level, [...others, missionId], 1);
  const missions = [...player.missions];
  missions[idx] = { id: replacement ?? missionId, progress: 0, claimed: false, startedAt: now };
  while (missions.length < ACTIVE_MISSION_SLOTS) {
    const [extra] = rollMissions(player.level, missions.map((x) => x.id), 1);
    missions.push({ id: extra, progress: 0, claimed: false, startedAt: now });
  }
  return {
    ok: true,
    reward: { money: def.reward.money, xp: def.reward.xp, items: def.reward.items ?? {} },
    missions,
  };
}

/* ──────────────────────── RECOMPENSAS OFFLINE ──────────────────────── */

/**
 * Producción pasiva mientras el jugador estaba fuera.
 * Escala con el nivel de la fábrica (automatización compartida) y con el
 * nivel del jugador. Limitada por `capSeconds` para evitar inflación.
 */
export function computeOfflineReport(
  player: Pick<PlayerState, 'level' | 'lastOfflineClaimAt'>,
  factoryLevel: number,
  now = Date.now(),
): OfflineReport | null {
  const def = getFactoryLevel(factoryLevel);
  const elapsedSec = Math.max(0, (now - player.lastOfflineClaimAt) / 1000);
  if (elapsedSec < BALANCE.offline.minSeconds) return null;
  if (def.idleRate <= 0) return null;

  const seconds = Math.min(elapsedSec, BALANCE.offline.capSeconds);
  const scale = BALANCE.offline.playerLevelScale(player.level);
  const units = Math.floor(def.idleRate * seconds * scale * 0.01);
  if (units <= 0) return null;

  return {
    seconds: Math.floor(seconds),
    units,
    // Con techo: una recompensa enorme la rechazarían las reglas de seguridad
    // y el jugador se quedaría sin poder jugar (ver MAX_MONEY_PER_WRITE).
    money: Math.min(OFFLINE_MONEY_CAP, Math.round(units * BALANCE.offline.moneyPerUnit)),
    xp: Math.min(OFFLINE_XP_CAP, Math.round(units * BALANCE.offline.xpPerUnit)),
    robots: Math.max(0, Math.floor((factoryLevel - 3) / 2)),
    factoryLevel,
  };
}

/* ──────────────────────── PROGRESO DE LA FÁBRICA ──────────────────────── */

export interface FactoryProgress {
  level: number;
  contribution: number;
  needed: number;
  ratio: number;
}

export function factoryProgress(f: Pick<FactoryState, 'level' | 'contribution'>): FactoryProgress {
  const needed = getFactoryLevel(f.level).xpToNext;
  return {
    level: f.level,
    contribution: f.contribution,
    needed,
    ratio: needed > 0 ? Math.min(1, f.contribution / needed) : 0,
  };
}

/** Aplica contribución a la fábrica resolviendo subidas de nivel encadenadas. */
/**
 * Sube el nivel de la fábrica con lo contribuido.
 *
 * CON TECHO POR ESCRITURA, igual que el nivel del jugador: las reglas no
 * admiten que la fábrica suba más de 5 niveles de golpe, y en los primeros
 * niveles —que son baratísimos— una donación grande se los comía de una
 * tacada. Lo que sobra NO se pierde: se queda como contribución y sube el
 * siguiente nivel en la acción siguiente.
 */
export function applyFactoryContribution(
  level: number,
  contribution: number,
  points: number,
): { level: number; contribution: number; levelsGained: number } {
  let lv = level;
  let cur = contribution + points;
  let gained = 0;
  while (cur >= getFactoryLevel(lv).xpToNext && gained < MAX_FACTORY_LEVELS_PER_WRITE) {
    cur -= getFactoryLevel(lv).xpToNext;
    lv += 1;
    gained += 1;
  }
  return { level: lv, contribution: cur, levelsGained: gained };
}
