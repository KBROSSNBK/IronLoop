/**
 * OPERACIONES DEL JUEGO — reductores puros y transaccionales.
 *
 * Reciben el estado leído dentro de una transacción y devuelven el estado
 * nuevo. No conocen Firebase ni React. Los usan:
 *   - el backend Firebase (dentro de runTransaction)
 *   - el backend local (dentro de un lock de BroadcastChannel)
 *   - las Cloud Functions (functions/src/ops.ts las reexporta)
 *
 * Ninguna operación confía en cantidades enviadas por el cliente sin validarlas
 * contra el estado real (dinero, inventario, buffers de máquina).
 */

import { BALANCE, deriveStats } from '../../config/balance';
import { getItem, CONSUMABLE_EFFECTS } from '../../config/items';
import {
  getMachine,
  MACHINE_UPGRADE,
  machineUpgradeCost,
} from '../../config/machines';
import {
  UPGRADES,
  UPGRADE_CONTRIB_RATIO,
  upgradeCost,
  type UpgradeId,
} from '../../config/upgrades';
import { FACTORY_OBJECTIVES } from '../../config/factoryLevels';
import { STATIONS } from '../../config/world';
import type {
  FactoryMember,
  FactoryState,
  MachineState,
  OfflineReport,
  PlayerState,
} from '../../types';
import {
  addToInventory,
  applyFactoryContribution,
  applyMissionEvents,
  applyXp,
  claimMission as claimMissionLogic,
  computeOfflineReport,
  computeSale,
  currentStamina,
  inventoryFree,
  spendStamina,
  type MissionEvent,
} from '../../game/logic/progression';
import { inputRoom, settleMachine } from '../../game/logic/production';

/* ────────────────────────────── TIPOS ────────────────────────────── */

export type OpEventKind =
  | 'money'
  | 'xp'
  | 'item'
  | 'levelUp'
  | 'factoryLevelUp'
  | 'missionComplete'
  | 'contribution'
  | 'info'
  | 'error';

export interface OpEvent {
  kind: OpEventKind;
  text?: string;
  amount?: number;
  item?: string;
  level?: number;
}

export interface OpOutcome<T = unknown> {
  ok: boolean;
  reason?: string;
  player?: PlayerState;
  factory?: FactoryState;
  /** Incrementos a aplicar al documento de miembro (ranking). */
  memberDelta?: Partial<Record<keyof FactoryMember, number>>;
  events: OpEvent[];
  data?: T;
}

/** Resultado de fallo. `T = never` lo hace asignable a cualquier `OpOutcome<X>`. */
function fail<T = never>(reason: string): OpOutcome<T> {
  return { ok: false, reason, events: [{ kind: 'error', text: reason }] };
}

/* ──────────────────────────── HELPERS ──────────────────────────── */

/** Aplica XP con subidas de nivel encadenadas y genera eventos. */
function grantXp(p: PlayerState, xp: number, events: OpEvent[], now: number): PlayerState {
  if (xp <= 0) return p;
  const res = applyXp(p.level, p.xp, xp);
  events.push({ kind: 'xp', amount: xp });
  let money = p.money;
  let stamina = p.stamina;
  let staminaAt = p.staminaAt;
  if (res.levelsGained > 0) {
    money += res.moneyReward;
    events.push({ kind: 'levelUp', level: res.level, amount: res.moneyReward });
    if (BALANCE.leveling.staminaRefillOnLevelUp) {
      stamina = deriveStats(p.upgrades).maxStamina;
      staminaAt = now;
    }
  }
  return { ...p, level: res.level, xp: res.xp, money, stamina, staminaAt };
}

/** Avanza misiones personales y avisa de las completadas. */
function bumpMissions(
  p: PlayerState,
  evts: MissionEvent[],
  events: OpEvent[],
): PlayerState {
  const { missions, completed } = applyMissionEvents(p.missions, evts);
  for (const id of completed) {
    events.push({ kind: 'missionComplete', text: id });
  }
  return { ...p, missions };
}

/** Suma contribución a la fábrica y resuelve subidas de nivel. */
function addContribution(
  f: FactoryState,
  points: number,
  events: OpEvent[],
): FactoryState {
  if (points <= 0) return f;
  const res = applyFactoryContribution(f.level, f.contribution, points);
  if (res.levelsGained > 0) {
    events.push({ kind: 'factoryLevelUp', level: res.level });
  }
  return {
    ...f,
    level: res.level,
    contribution: res.contribution,
    totalContribution: f.totalContribution + points,
    stats: { ...f.stats, contributed: f.stats.contributed + points },
    updatedAt: Date.now(),
  };
}

/** Progreso de los objetivos cooperativos. */
function bumpObjectives(
  f: FactoryState,
  metric: 'produced' | 'sold' | 'contributed' | 'gathered',
  amount: number,
  events: OpEvent[],
): FactoryState {
  if (amount <= 0) return f;
  let next = f;
  const objectives = { ...f.objectives };
  let bonus = 0;
  for (const obj of FACTORY_OBJECTIVES) {
    if (obj.metric !== metric) continue;
    if (f.level < obj.fromLevel) continue;
    const cur = objectives[obj.id] ?? 0;
    if (cur < 0) continue; // ya completado
    const nv = cur + amount;
    if (nv >= obj.target) {
      objectives[obj.id] = -1;
      bonus += obj.rewardContribution;
      events.push({ kind: 'info', text: `OBJETIVO DE FÁBRICA: ${obj.title}` });
    } else {
      objectives[obj.id] = nv;
    }
  }
  next = { ...next, objectives };
  if (bonus > 0) next = addContribution(next, bonus, events);
  return next;
}

function stat(p: PlayerState, patch: Partial<PlayerState['stats']>): PlayerState {
  const stats = { ...p.stats };
  for (const [k, v] of Object.entries(patch)) {
    (stats as Record<string, number>)[k] = (stats as Record<string, number>)[k] + (v as number);
  }
  return { ...p, stats };
}

/* ─────────────────────────── 1. RECOLECTAR ─────────────────────────── */

export interface GatherArgs {
  stationId: string;
  now: number;
  /** Inyectable para tests deterministas. */
  rand?: () => number;
}

export function opGather(
  player: PlayerState,
  factory: FactoryState,
  args: GatherArgs,
): OpOutcome<{ items: Record<string, number> }> {
  const station = STATIONS.find((s) => s.id === args.stationId);
  if (!station || station.type !== 'oreVein') return fail('Estación inválida');

  const stats = deriveStats(player.upgrades);
  const cost = BALANCE.actions.gather.stamina * stats.actionCostMult;
  if (currentStamina(player, args.now) < cost) return fail('Sin estamina');

  const free = inventoryFree(player);
  if (free <= 0) return fail('Inventario lleno');

  const rand = args.rand ?? Math.random;
  const events: OpEvent[] = [];
  const gained: Record<string, number> = {};

  const baseItem = station.yields?.[0]?.item ?? 'ore';
  const qty = Math.min(stats.gatherAmount, free);
  gained[baseItem] = qty;

  // Hallazgo raro
  let remaining = free - qty;
  if (remaining > 0 && rand() < stats.rareChance) {
    const table = BALANCE.luck.table;
    const total = table.reduce((a, t) => a + t.weight, 0);
    let roll = rand() * total;
    for (const entry of table) {
      roll -= entry.weight;
      if (roll <= 0) {
        const add = Math.min(entry.amount, remaining);
        if (add > 0) {
          gained[entry.item] = (gained[entry.item] ?? 0) + add;
          remaining -= add;
          events.push({ kind: 'info', text: `¡HALLAZGO RARO! ${getItem(entry.item).name}` });
        }
        break;
      }
    }
  }

  let inventory = player.inventory;
  let totalUnits = 0;
  for (const [id, n] of Object.entries(gained)) {
    inventory = addToInventory(inventory, id, n);
    totalUnits += n;
    events.push({ kind: 'item', item: id, amount: n });
  }

  let p: PlayerState = {
    ...player,
    inventory,
    ...spendStamina(player, args.now, cost),
  };
  p = stat(p, { gathered: totalUnits });
  p = grantXp(p, BALANCE.actions.gather.xp * totalUnits, events, args.now);
  p = bumpMissions(
    p,
    Object.entries(gained).map(([item, amount]) => ({ metric: 'gather' as const, item, amount })),
    events,
  );

  let f: FactoryState = {
    ...factory,
    stats: { ...factory.stats, gathered: factory.stats.gathered + totalUnits },
    updatedAt: args.now,
  };
  f = bumpObjectives(f, 'gathered', totalUnits, events);

  return { ok: true, player: p, factory: f, events, data: { items: gained } };
}

/* ─────────────────────────── 2. DEPOSITAR ─────────────────────────── */

export interface DepositArgs {
  machineId: string;
  /** Si no se indica, deposita todo lo compatible que lleve encima. */
  item?: string;
  qty?: number;
  now: number;
}

export function opDeposit(
  player: PlayerState,
  factory: FactoryState,
  args: DepositArgs,
): OpOutcome<{ deposited: Record<string, number> }> {
  const def = getMachine(args.machineId);
  const cur = factory.machines[args.machineId];
  if (!cur) return fail('Máquina no encontrada');
  if (factory.level < def.unlockFactoryLevel)
    return fail(`Requiere fábrica nivel ${def.unlockFactoryLevel}`);

  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  let machine: MachineState = settled.state;

  const stats = deriveStats(player.upgrades);
  const perAction = stats.gatherAmount * 5; // depositar es más rápido que extraer
  const wanted = Object.keys(def.input);
  const deposited: Record<string, number> = {};
  let inventory = player.inventory;
  let units = 0;

  for (const item of wanted) {
    if (args.item && args.item !== item) continue;
    const have = inventory[item] ?? 0;
    if (have <= 0) continue;
    const room = inputRoom(machine, args.machineId, item);
    const qty = Math.min(have, room, args.qty ?? perAction);
    if (qty <= 0) continue;
    inventory = addToInventory(inventory, item, -qty);
    machine = { ...machine, input: { ...machine.input, [item]: (machine.input[item] ?? 0) + qty } };
    deposited[item] = qty;
    units += qty;
  }

  if (units === 0) {
    const full = wanted.some((i) => inputRoom(machine, args.machineId, i) <= 0);
    return fail(full ? 'Buffer de entrada lleno' : 'No llevas material compatible');
  }

  // Tras depositar, la máquina puede arrancar.
  const restarted = settleMachine(machine, args.machineId, factory.level, args.now);
  machine = restarted.state;

  const events: OpEvent[] = [];
  const staminaCost = BALANCE.actions.deposit.stamina * stats.actionCostMult * units;

  let p: PlayerState = {
    ...player,
    inventory,
    ...spendStamina(player, args.now, staminaCost),
  };
  p = stat(p, { deposited: units });
  p = grantXp(p, def.xpPerDeposit * units, events, args.now);
  p = bumpMissions(
    p,
    Object.entries(deposited).map(([item, amount]) => ({ metric: 'deposit' as const, item, amount })),
    events,
  );

  const f: FactoryState = {
    ...factory,
    machines: { ...factory.machines, [args.machineId]: machine },
    updatedAt: args.now,
  };

  for (const [item, n] of Object.entries(deposited)) {
    events.push({ kind: 'item', item, amount: -n });
  }

  return { ok: true, player: p, factory: f, events, data: { deposited } };
}

/* ──────────────────────────── 3. RECOGER ──────────────────────────── */

export interface CollectArgs {
  machineId: string;
  now: number;
}

export function opCollect(
  player: PlayerState,
  factory: FactoryState,
  args: CollectArgs,
): OpOutcome<{ collected: Record<string, number> }> {
  const def = getMachine(args.machineId);
  const cur = factory.machines[args.machineId];
  if (!cur) return fail('Máquina no encontrada');

  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  let machine = settled.state;

  const free = inventoryFree(player);
  if (free <= 0) return fail('Inventario lleno');

  const collected: Record<string, number> = {};
  let inventory = player.inventory;
  let room = free;
  let units = 0;

  for (const [item, avail] of Object.entries(machine.output)) {
    if (avail <= 0 || room <= 0) continue;
    const qty = Math.min(avail, room);
    inventory = addToInventory(inventory, item, qty);
    const out = { ...machine.output, [item]: avail - qty };
    if (out[item] <= 0) delete out[item];
    machine = { ...machine, output: out };
    collected[item] = qty;
    room -= qty;
    units += qty;
  }

  if (units === 0) return fail('No hay producto listo');

  // Al liberar el buffer de salida la máquina puede reanudar.
  machine = settleMachine(machine, args.machineId, factory.level, args.now).state;

  const events: OpEvent[] = [];
  const stats = deriveStats(player.upgrades);

  let p: PlayerState = {
    ...player,
    inventory,
    ...spendStamina(player, args.now, BALANCE.actions.collect.stamina * stats.actionCostMult),
  };
  p = stat(p, { produced: units });
  p = grantXp(p, def.xpPerCollect * units, events, args.now);
  p = bumpMissions(
    p,
    Object.entries(collected).map(([item, amount]) => ({ metric: 'produce' as const, item, amount })),
    events,
  );

  let f: FactoryState = {
    ...factory,
    machines: { ...factory.machines, [args.machineId]: machine },
    stats: { ...factory.stats, produced: factory.stats.produced + units },
    updatedAt: args.now,
  };
  const contrib = units * BALANCE.factory.contribPerProduced;
  f = addContribution(f, contrib, events);
  f = bumpObjectives(f, 'produced', units, events);
  p = stat(p, { contributed: contrib });

  for (const [item, n] of Object.entries(collected)) {
    events.push({ kind: 'item', item, amount: n });
  }
  events.push({ kind: 'contribution', amount: contrib });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { produced: units, contributed: contrib },
    events,
    data: { collected },
  };
}

/* ───────────────────────────── 4. VENDER ───────────────────────────── */

export interface SellArgs {
  /** Si se omite, vende todo lo vendible. */
  items?: Record<string, number>;
  now: number;
}

export function opSell(
  player: PlayerState,
  factory: FactoryState,
  args: SellArgs,
): OpOutcome<{ money: number; units: number }> {
  const wanted =
    args.items ??
    Object.fromEntries(
      Object.entries(player.inventory).filter(
        ([id, q]) => q > 0 && getItem(id).sellPrice > 0,
      ),
    );

  const sale = computeSale(player.inventory, wanted, player.upgrades);
  if (sale.units <= 0) return fail('No llevas nada vendible');

  const events: OpEvent[] = [];
  let inventory = player.inventory;
  for (const line of sale.breakdown) {
    inventory = addToInventory(inventory, line.item, -line.qty);
  }

  let p: PlayerState = { ...player, inventory, money: player.money + sale.money };
  p = stat(p, { sold: sale.units, earned: sale.money });
  p = grantXp(p, sale.xp, events, args.now);
  p = bumpMissions(
    p,
    [
      ...sale.breakdown.map((l) => ({ metric: 'sell' as const, item: l.item, amount: l.qty })),
      { metric: 'earn' as const, amount: sale.money },
    ],
    events,
  );

  let f: FactoryState = {
    ...factory,
    stats: { ...factory.stats, sold: factory.stats.sold + sale.money },
    updatedAt: args.now,
  };
  const contrib = Math.round(sale.money * BALANCE.factory.contribPerSale);
  f = addContribution(f, contrib, events);
  f = bumpObjectives(f, 'sold', sale.money, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: sale.money });
  events.push({ kind: 'contribution', amount: contrib });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { sold: sale.units, contributed: contrib, money: p.money },
    events,
    data: { money: sale.money, units: sale.units },
  };
}

/* ───────────────────────── 5. CONTRIBUIR ───────────────────────── */

export interface ContributeArgs {
  money?: number;
  items?: Record<string, number>;
  now: number;
}

export function opContribute(
  player: PlayerState,
  factory: FactoryState,
  args: ContributeArgs,
): OpOutcome<{ points: number }> {
  const events: OpEvent[] = [];
  let points = 0;
  let p = { ...player };

  if (args.money && args.money > 0) {
    const amount = Math.floor(args.money);
    if (amount < BALANCE.factory.minMoneyDonation)
      return fail(`Mínimo $${BALANCE.factory.minMoneyDonation}`);
    if (p.money < amount) return fail('Dinero insuficiente');
    p = { ...p, money: p.money - amount };
    points += amount * BALANCE.factory.contribPerMoney;
  }

  if (args.items) {
    let inventory = p.inventory;
    for (const [id, qtyRaw] of Object.entries(args.items)) {
      const qty = Math.min(Math.floor(qtyRaw), inventory[id] ?? 0);
      if (qty <= 0) continue;
      inventory = addToInventory(inventory, id, -qty);
      points += getItem(id).contribValue * qty;
      events.push({ kind: 'item', item: id, amount: -qty });
    }
    p = { ...p, inventory };
  }

  points = Math.round(points);
  if (points <= 0) return fail('Nada que contribuir');

  p = stat(p, { contributed: points });
  p = grantXp(p, Math.round(points * 0.35), events, args.now);
  p = bumpMissions(p, [{ metric: 'contribute', amount: points }], events);

  let f = addContribution(factory, points, events);
  f = bumpObjectives(f, 'contributed', points, events);

  events.push({ kind: 'contribution', amount: points });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: points, money: p.money },
    events,
    data: { points },
  };
}

/* ───────────────────── 6. MEJORA PERSONAL ───────────────────── */

export function opBuyUpgrade(
  player: PlayerState,
  factory: FactoryState,
  args: { upgradeId: string; now: number },
): OpOutcome<{ level: number; cost: number }> {
  const def = UPGRADES[args.upgradeId as UpgradeId];
  if (!def) return fail('Mejora desconocida');
  if (player.level < def.unlockLevel)
    return fail(`Requiere nivel ${def.unlockLevel}`);

  const current = player.upgrades[def.id] ?? 0;
  if (current >= def.maxLevel) return fail('Nivel máximo alcanzado');

  const cost = upgradeCost(def, current);
  if (player.money < cost) return fail('Dinero insuficiente');

  const events: OpEvent[] = [];
  let p: PlayerState = {
    ...player,
    money: player.money - cost,
    upgrades: { ...player.upgrades, [def.id]: current + 1 },
  };
  // Al subir estamina máxima, rellena la diferencia para que se note.
  const before = deriveStats(player.upgrades).maxStamina;
  const after = deriveStats(p.upgrades).maxStamina;
  if (after > before) {
    p = {
      ...p,
      stamina: currentStamina(player, args.now) + (after - before),
      staminaAt: args.now,
    };
  }

  p = stat(p, { upgradesBought: 1 });
  p = bumpMissions(p, [{ metric: 'upgrade', amount: 1 }], events);

  // Parte del gasto alimenta el progreso global (economía cooperativa).
  const contrib = Math.round(cost * UPGRADE_CONTRIB_RATIO);
  const f = addContribution(factory, contrib, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: -cost });
  events.push({ kind: 'info', text: `${def.name} nivel ${current + 1}` });
  events.push({ kind: 'contribution', amount: contrib });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { level: current + 1, cost },
  };
}

/* ───────────────────── 7. MEJORA DE MÁQUINA (compartida) ───────────────────── */

export function opUpgradeMachine(
  player: PlayerState,
  factory: FactoryState,
  args: { machineId: string; now: number },
): OpOutcome<{ level: number; cost: number }> {
  const def = getMachine(args.machineId);
  const cur = factory.machines[args.machineId];
  if (!cur) return fail('Máquina no encontrada');
  if (factory.level < def.unlockFactoryLevel)
    return fail(`Requiere fábrica nivel ${def.unlockFactoryLevel}`);
  if (cur.level >= MACHINE_UPGRADE.maxLevel) return fail('Nivel máximo');

  const cost = machineUpgradeCost(cur.level);
  if (player.money < cost) return fail('Dinero insuficiente');

  const events: OpEvent[] = [];
  // Liquidar con la velocidad antigua antes de cambiarla.
  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  const machine: MachineState = {
    ...settled.state,
    level: cur.level + 1,
    cycleStartAt: settled.state.cycleStartAt > 0 ? args.now : 0,
  };

  let p: PlayerState = { ...player, money: player.money - cost };
  p = grantXp(p, Math.round(cost * 0.08), events, args.now);

  let f: FactoryState = {
    ...factory,
    machines: { ...factory.machines, [args.machineId]: machine },
    updatedAt: args.now,
  };
  const contrib = Math.round(cost * MACHINE_UPGRADE.contribPerPurchase);
  f = addContribution(f, contrib, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: -cost });
  events.push({ kind: 'info', text: `${def.name} → nivel ${machine.level}` });
  events.push({ kind: 'contribution', amount: contrib });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { level: machine.level, cost },
  };
}

/* ───────────────────── 8. RECLAMAR MISIÓN ───────────────────── */

export function opClaimMission(
  player: PlayerState,
  factory: FactoryState,
  args: { missionId: string; now: number },
): OpOutcome<{ money: number; xp: number }> {
  const res = claimMissionLogic(player, args.missionId, args.now);
  if (!res.ok) return fail(res.reason);

  const events: OpEvent[] = [];
  let inventory = player.inventory;
  for (const [id, qty] of Object.entries(res.reward.items)) {
    inventory = addToInventory(inventory, id, qty);
    events.push({ kind: 'item', item: id, amount: qty });
  }

  let p: PlayerState = {
    ...player,
    inventory,
    money: player.money + res.reward.money,
    missions: res.missions,
  };
  p = stat(p, { earned: res.reward.money });
  p = grantXp(p, res.reward.xp, events, args.now);

  events.push({ kind: 'money', amount: res.reward.money });
  events.push({ kind: 'info', text: '¡MISIÓN COMPLETADA!' });

  return {
    ok: true,
    player: p,
    factory,
    memberDelta: { money: p.money },
    events,
    data: { money: res.reward.money, xp: res.reward.xp },
  };
}

/* ───────────────────── 9. RECOMPENSA OFFLINE ───────────────────── */

export function opClaimOffline(
  player: PlayerState,
  factory: FactoryState,
  args: { now: number },
): OpOutcome<OfflineReport> {
  const report = computeOfflineReport(player, factory.level, args.now);
  if (!report) {
    return {
      ok: true,
      player: { ...player, lastOfflineClaimAt: args.now },
      factory,
      events: [],
      data: undefined,
    };
  }

  const events: OpEvent[] = [];
  let p: PlayerState = {
    ...player,
    money: player.money + report.money,
    lastOfflineClaimAt: args.now,
  };
  p = stat(p, { earned: report.money });
  p = grantXp(p, report.xp, events, args.now);
  p = bumpMissions(p, [{ metric: 'earn', amount: report.money }], events);

  const contrib = Math.round(report.units * 0.15);
  const f = addContribution(factory, contrib, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: report.money });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: report,
  };
}

/* ───────────────────── 10. CONSUMIBLES / APARIENCIA ───────────────────── */

export function opUseItem(
  player: PlayerState,
  factory: FactoryState,
  args: { itemId: string; now: number },
): OpOutcome {
  const qty = player.inventory[args.itemId] ?? 0;
  if (qty <= 0) return fail('No tienes ese objeto');
  const effect = CONSUMABLE_EFFECTS[args.itemId];
  if (!effect) return fail('Ese objeto no se puede usar');

  const stats = deriveStats(player.upgrades);
  const events: OpEvent[] = [];
  const p: PlayerState = {
    ...player,
    inventory: addToInventory(player.inventory, args.itemId, -1),
    stamina: Math.min(
      stats.maxStamina,
      currentStamina(player, args.now) + (effect.stamina ?? 0),
    ),
    staminaAt: args.now,
  };
  events.push({ kind: 'info', text: `+${effect.stamina} estamina` });
  return { ok: true, player: p, factory, events };
}

export function opSetAppearance(
  player: PlayerState,
  factory: FactoryState,
  args: { appearance: PlayerState['appearance']; name?: string },
): OpOutcome {
  const name = (args.name ?? player.name).trim().slice(0, 20) || player.name;
  return {
    ok: true,
    player: { ...player, appearance: args.appearance, name, onboarded: true },
    factory,
    memberDelta: {},
    events: [{ kind: 'info', text: 'Aspecto actualizado' }],
  };
}

/* ───────────────────── 11. TICK DE SESIÓN ───────────────────── */

/**
 * Latido de sesión: acumula tiempo jugado y avanza las misiones de tipo
 * `playtime`. Se llama una vez por minuto, no por frame (ver FIREBASE_COSTS.md).
 */
export function opTick(
  player: PlayerState,
  factory: FactoryState,
  args: { seconds: number; stamina?: number; now: number },
): OpOutcome {
  const seconds = Math.max(0, Math.min(300, Math.floor(args.seconds)));
  if (seconds <= 0 && args.stamina === undefined) {
    return { ok: true, player, factory, events: [] };
  }
  const events: OpEvent[] = [];
  let p = stat(player, { playtime: seconds });
  if (args.stamina !== undefined) {
    // El sprint gasta estamina en cliente; aquí se fija la nueva línea base.
    const cap = deriveStats(player.upgrades).maxStamina;
    const claimed = Math.max(0, Math.min(cap, args.stamina));
    // Nunca puede subir por encima de lo que la regeneración permitiría.
    const legit = Math.min(claimed, currentStamina(player, args.now));
    p = { ...p, stamina: legit, staminaAt: args.now };
  }
  p = bumpMissions(p, [{ metric: 'playtime', amount: seconds }], events);
  return { ok: true, player: { ...p, lastSeenAt: args.now }, factory, events };
}

/* ───────────────────── REGISTRO DE OPERACIONES ───────────────────── */

export type OpName =
  | 'gather'
  | 'deposit'
  | 'collect'
  | 'sell'
  | 'contribute'
  | 'buyUpgrade'
  | 'upgradeMachine'
  | 'claimMission'
  | 'claimOffline'
  | 'useItem'
  | 'setAppearance'
  | 'tick';

type AnyOp = (p: PlayerState, f: FactoryState, args: never) => OpOutcome<never>;

export const OPS = {
  gather: opGather,
  deposit: opDeposit,
  collect: opCollect,
  sell: opSell,
  contribute: opContribute,
  buyUpgrade: opBuyUpgrade,
  upgradeMachine: opUpgradeMachine,
  claimMission: opClaimMission,
  claimOffline: opClaimOffline,
  useItem: opUseItem,
  setAppearance: opSetAppearance,
  tick: opTick,
} as unknown as Record<OpName, AnyOp>;

export function runOp(
  name: OpName,
  player: PlayerState,
  factory: FactoryState,
  args: unknown,
): OpOutcome {
  const op = OPS[name];
  if (!op) return fail(`Operación desconocida: ${name}`);
  try {
    return op(player, factory, args as never) as OpOutcome;
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Error interno');
  }
}
