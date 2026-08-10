/**
 * NIVELES, INVENTARIO, MISIONES Y RECOMPENSAS OFFLINE — lógica pura.
 * Compartida por el cliente, el backend local y las Cloud Functions.
 */

import { BALANCE, deriveStats } from '../../config/balance';
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

/** Aplica XP y resuelve todas las subidas de nivel encadenadas. */
export function applyXp(level: number, xp: number, gained: number): LevelUpResult {
  let lv = level;
  let cur = xp + gained;
  let gainedLevels = 0;
  let money = 0;
  let guard = 0;
  while (cur >= xpForLevel(lv) && guard++ < 500) {
    cur -= xpForLevel(lv);
    lv += 1;
    gainedLevels += 1;
    money += BALANCE.leveling.moneyPerLevel(lv);
  }
  return { level: lv, xp: cur, levelsGained: gainedLevels, moneyReward: money };
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
): SaleResult {
  const mult = deriveStats(upgrades).sellMultiplier;
  const breakdown: SaleResult['breakdown'] = [];
  let money = 0;
  let units = 0;
  for (const [id, qtyRaw] of Object.entries(items)) {
    const qty = Math.min(qtyRaw, inventory[id] ?? 0);
    if (qty <= 0) continue;
    const def = getItem(id);
    if (def.sellPrice <= 0) continue;
    const value = Math.round(def.sellPrice * qty * mult);
    money += value;
    units += qty;
    breakdown.push({ item: id, qty, value });
  }
  return { money, xp: Math.round(units * 3 + money * 0.05), units, breakdown };
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
    money: Math.round(units * BALANCE.offline.moneyPerUnit),
    xp: Math.round(units * BALANCE.offline.xpPerUnit),
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
export function applyFactoryContribution(
  level: number,
  contribution: number,
  points: number,
): { level: number; contribution: number; levelsGained: number } {
  let lv = level;
  let cur = contribution + points;
  let gained = 0;
  let guard = 0;
  while (cur >= getFactoryLevel(lv).xpToNext && guard++ < 200) {
    cur -= getFactoryLevel(lv).xpToNext;
    lv += 1;
    gained += 1;
  }
  return { level: lv, contribution: cur, levelsGained: gained };
}
