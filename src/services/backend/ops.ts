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

import { BALANCE, SALE_CLAIM_CAP, deriveStats } from '../../config/balance';
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
import {
  ROBOT_CONTRIB_RATIO,
  getRobot,
  robotCost,
  type RobotMode,
} from '../../config/robots';
import { ONLINE_WINDOW_MS, settleFactory } from '../../game/logic/robots';
import { getBelt, pushToBelt } from '../../game/logic/belts';
import {
  DEFAULT_PET,
  PET_ACCENTS,
  PET_CHASSIS_MAP,
  PET_COLORS,
  PET_RATE_TOLERANCE,
  PET_MODES,
  PET_STAT_MAP,
  DRONE,
  deriveDrones,
  droneCost,
  droneUpgradeCost,
  getChassis,
  normalizePet,
  petStatCost,
} from '../../config/pets';
import {
  addToPet,
  getPetZone,
  isPetStation,
  petAccepts,
  petFree,
  petMineCap,
  petUsed,
  stationYield,
  unloadPet,
} from '../../game/logic/pet';

/**
 * La mascota rinde menos XP por unidad que picar tú mismo: automatizar da
 * material y tiempo libre, no progresión gratis.
 */
const PET_XP_RATIO = 0.4;
import { STATIONS, TILE } from '../../config/world';
import type {
  FactoryMember,
  FactoryState,
  GroundItem,
  MachineState,
  OfflineReport,
  PlayerState,
} from '../../types';
import { createPlayerState } from '../../game/logic/defaults';
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

/**
 * Cobra la parte que le corresponde al jugador de las ventas hechas por los
 * robots. Cada uno reclama SÓLO su entrada del reparto, así que el dinero no
 * se puede duplicar ni cobrar dos veces.
 */
function claimSaleShare(
  player: PlayerState,
  factory: FactoryState,
): { player: PlayerState; factory: FactoryState; money: number; events: OpEvent[] } {
  const pending = Math.floor(factory.saleLedger?.[player.uid] ?? 0);
  if (pending <= 0) return { player, factory, money: 0, events: [] };

  // Se cobra por tandas. Un robot vendiendo ocho horas puede acumular millones,
  // y una escritura que subiera tanto el dinero de golpe la rechazarían las
  // reglas de seguridad: el jugador se quedaría sin poder hacer NADA, porque
  // cada operación volvería a intentar el mismo cobro imposible.
  const paid = Math.min(pending, SALE_CLAIM_CAP);
  const rest = pending - paid;

  const ledger = { ...factory.saleLedger };
  if (rest > 0) ledger[player.uid] = rest;
  else delete ledger[player.uid];

  const events: OpEvent[] = [
    { kind: 'money', amount: paid },
    {
      kind: 'info',
      text:
        rest > 0
          ? `Tus robots vendieron: cobras ${paid.toLocaleString('es-ES')} $ (quedan ${rest.toLocaleString('es-ES')} $)`
          : `Tus robots vendieron por ${paid.toLocaleString('es-ES')} $`,
    },
  ];

  let p: PlayerState = { ...player, money: player.money + paid };
  p = stat(p, { earned: paid });

  return { player: p, factory: { ...factory, saleLedger: ledger }, money: paid, events };
}

/** Rectángulo del muelle de venta, con un margen de tolerancia. */
function insideSellArea(at: { x: number; y: number }): boolean {
  const dock = STATIONS.find((s) => s.type === 'sell');
  if (!dock) return false;
  const slack = BALANCE.actions.validationSlack;
  const x0 = dock.tx * TILE - slack;
  const y0 = dock.ty * TILE - slack;
  const x1 = (dock.tx + dock.tw) * TILE + slack;
  const y1 = (dock.ty + dock.th) * TILE + slack;
  return at.x >= x0 && at.x <= x1 && at.y >= y0 && at.y <= y1;
}

/** Distancia entre el jugador y un punto, para validar acciones de mundo. */
function within(a: { x: number; y: number }, b: { x: number; y: number }, r: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= r;
}

/** Alcance aceptado para tocar una máquina o una cinta, con su margen. */
const REACH = BALANCE.actions.range + BALANCE.actions.validationSlack;

/** Distancia de un punto a un rectángulo (0 si está dentro). */
function distanceToRect(
  at: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
): number {
  const dx = Math.max(r.x - at.x, 0, at.x - (r.x + r.w));
  const dy = Math.max(r.y - at.y, 0, at.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

function isPoint(at: unknown): at is { x: number; y: number } {
  const p = at as { x?: unknown; y?: unknown } | undefined;
  return typeof p?.x === 'number' && typeof p?.y === 'number';
}

/**
 * ¿Está el jugador junto a la máquina?
 *
 * Cargar y retirar material sólo tiene sentido estando delante: si no, la
 * fábrica sería un almacén remoto y no habría razón para moverse. Se valida
 * aquí, no sólo en la interfaz, porque la interfaz se puede saltar.
 */
function nearMachine(at: unknown, machineId: string): boolean {
  if (!isPoint(at)) return false;
  const m = getMachine(machineId);
  return (
    distanceToRect(at, {
      x: m.tx * TILE,
      y: m.ty * TILE,
      w: m.tw * TILE,
      h: m.th * TILE,
    }) <= REACH
  );
}

/** Lo mismo para una estación: picar exige estar en la veta. */
function nearStation(at: unknown, stationId: string): boolean {
  if (!isPoint(at)) return false;
  const s = STATIONS.find((x) => x.id === stationId);
  if (!s) return false;
  return (
    distanceToRect(at, {
      x: s.tx * TILE,
      y: s.ty * TILE,
      w: s.tw * TILE,
      h: s.th * TILE,
    }) <= REACH
  );
}

/** Lo mismo para una cinta: el material entra por donde estás tú. */
function nearBelt(at: unknown, beltId: string): boolean {
  if (!isPoint(at)) return false;
  const belt = getBelt(beltId);
  if (!belt) return false;
  const horizontal = belt.dir === 'left' || belt.dir === 'right';
  return (
    distanceToRect(at, {
      x: belt.tx * TILE,
      y: belt.ty * TILE,
      w: (horizontal ? belt.len : 0.7) * TILE,
      h: (horizontal ? 0.7 : belt.len) * TILE,
    }) <= REACH
  );
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
  /** Dónde está el jugador: picar exige estar en la veta. */
  at?: { x: number; y: number };
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
  // Yacimientos y zona de RECOLECCIÓN comparten la misma mecánica y el mismo
  // sistema de items; sólo cambia lo que rinde cada estación.
  if (!station || (station.type !== 'oreVein' && station.type !== 'salvage'))
    return fail('Estación inválida');
  if (!nearStation(args.at, args.stationId)) return fail('Acércate al yacimiento');

  const stats = deriveStats(player.upgrades);
  const cost = BALANCE.actions.gather.stamina * stats.actionCostMult;
  if (currentStamina(player, args.now) < cost) return fail('Sin estamina');

  const free = inventoryFree(player);
  if (free <= 0) return fail('Inventario lleno');

  const rand = args.rand ?? Math.random;
  const events: OpEvent[] = [];
  const gained: Record<string, number> = {};

  const yieldDef = station.yields?.[0];
  const baseItem = yieldDef?.item ?? 'ore';
  const perAction = Math.max(1, yieldDef?.amount ?? 1) * stats.gatherAmount;
  const qty = Math.min(perAction, free);
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
  /**
   * Si se indica, el material NO entra directo en la máquina: sube a esa
   * cinta y tarda en llegar, viajando a la vista de todos los jugadores.
   */
  beltId?: string;
  /** Dónde está el jugador: cargar exige estar delante. */
  at?: { x: number; y: number };
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
  // Por cinta se carga junto a la cinta; a mano, junto a la máquina.
  const cerca = args.beltId
    ? nearBelt(args.at, args.beltId)
    : nearMachine(args.at, args.machineId);
  if (!cerca) return fail(args.beltId ? 'Acércate a la cinta' : 'Acércate a la máquina');
  if (factory.level < def.unlockFactoryLevel)
    return fail(`Requiere fábrica nivel ${def.unlockFactoryLevel}`);

  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  let machine: MachineState = settled.state;

  const stats = deriveStats(player.upgrades);
  const perAction = stats.gatherAmount * 5; // depositar es más rápido que extraer
  const belt = args.beltId ? getBelt(args.beltId) : undefined;
  if (args.beltId && (!belt || belt.feeds !== args.machineId)) {
    return fail('Esa cinta no lleva a esta máquina');
  }
  // Una cinta con filtro propio manda sobre la receta de la máquina.
  const wanted =
    belt?.accepts && belt.accepts.length > 0 ? belt.accepts : Object.keys(def.input);
  const deposited: Record<string, number> = {};
  let inventory = player.inventory;
  let units = 0;

  for (const item of wanted) {
    if (!(item in def.input)) continue;
    if (args.item && args.item !== item) continue;
    const have = inventory[item] ?? 0;
    if (have <= 0) continue;
    const room = inputRoom(machine, args.machineId, item);
    const qty = Math.min(have, room, args.qty ?? perAction);
    if (qty <= 0) continue;
    inventory = addToInventory(inventory, item, -qty);
    if (!belt) {
      // Entrega directa: el jugador está delante de la máquina.
      machine = {
        ...machine,
        input: { ...machine.input, [item]: (machine.input[item] ?? 0) + qty },
      };
    }
    deposited[item] = qty;
    units += qty;
  }

  if (units === 0) {
    return fail(
      belt ? 'No llevas material para esta cinta' : 'No llevas material compatible',
    );
  }

  // Si va por cinta, el material entra en la cola y tarda en llegar.
  let belts = factory.belts ?? {};
  if (belt) {
    for (const [item, qty] of Object.entries(deposited)) {
      belts = pushToBelt(belts, belt.id, item, qty, args.now);
    }
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
    belts,
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
  /** Dónde está el jugador: recoger exige estar delante de la máquina. */
  at?: { x: number; y: number };
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
  if (!nearMachine(args.at, args.machineId)) return fail('Acércate a la máquina');

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
  /** Posición del jugador: la venta sólo vale dentro del muelle. */
  at?: { x: number; y: number };
  now: number;
}

export function opSell(
  player: PlayerState,
  factory: FactoryState,
  args: SellArgs,
): OpOutcome<{ money: number; units: number }> {
  // La zona de venta se valida AQUÍ, no sólo en la interfaz: sin esto,
  // cualquiera podría vender desde el otro extremo del mapa llamando a la op.
  if (!args.at || !insideSellArea(args.at)) {
    return fail('Sólo puedes vender en el MUELLE DE CARGA');
  }

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

/* ─────────────── 11. EXTRAER MATERIAL DE UNA MÁQUINA ─────────────── */

/**
 * Saca material guardado en una máquina y lo pasa al inventario. Sirve tanto
 * para el producto terminado como para material de entrada que se quedó
 * atascado porque falta el otro ingrediente de la receta.
 */
export function opWithdraw(
  player: PlayerState,
  factory: FactoryState,
  args: { machineId: string; item: string; qty: number; at?: { x: number; y: number }; now: number },
): OpOutcome<{ taken: number }> {
  const cur = factory.machines[args.machineId];
  if (!cur) return fail('Máquina no encontrada');
  if (!nearMachine(args.at, args.machineId)) return fail('Acércate a la máquina');

  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  const machine = settled.state;

  const inInput = machine.input[args.item] ?? 0;
  const inOutput = machine.output[args.item] ?? 0;
  const stored = inInput + inOutput;
  if (stored <= 0) return fail('La máquina no tiene ese material');

  const free = inventoryFree(player);
  if (free <= 0) return fail('Inventario lleno');

  const wanted = Math.floor(args.qty);
  if (!Number.isFinite(wanted) || wanted <= 0) return fail('Cantidad inválida');
  // Si no cabe todo, se retira sólo lo que quepa (nunca se pierde nada).
  const taken = Math.min(wanted, stored, free);
  if (taken <= 0) return fail('Inventario lleno');

  // Se vacía primero la SALIDA: es lo que el jugador espera llevarse.
  const fromOutput = Math.min(taken, inOutput);
  const fromInput = taken - fromOutput;

  const output = { ...machine.output };
  if (fromOutput > 0) {
    output[args.item] = inOutput - fromOutput;
    if (output[args.item] <= 0) delete output[args.item];
  }
  const input = { ...machine.input };
  if (fromInput > 0) {
    input[args.item] = inInput - fromInput;
    if (input[args.item] <= 0) delete input[args.item];
  }

  let next: MachineState = { ...machine, input, output };
  next = settleMachine(next, args.machineId, factory.level, args.now).state;

  const events: OpEvent[] = [];
  const def = getMachine(args.machineId);
  let p: PlayerState = {
    ...player,
    inventory: addToInventory(player.inventory, args.item, taken),
  };

  // Retirar producto terminado cuenta como producción recogida; retirar
  // material de entrada es sólo logística y no da XP ni contribución.
  let f: FactoryState = {
    ...factory,
    machines: { ...factory.machines, [args.machineId]: next },
    updatedAt: args.now,
  };
  if (fromOutput > 0) {
    p = stat(p, { produced: fromOutput });
    p = grantXp(p, def.xpPerCollect * fromOutput, events, args.now);
    p = bumpMissions(p, [{ metric: 'produce', item: args.item, amount: fromOutput }], events);
    f = {
      ...f,
      stats: { ...f.stats, produced: f.stats.produced + fromOutput },
    };
    const contrib = fromOutput * BALANCE.factory.contribPerProduced;
    f = addContribution(f, contrib, events);
    f = bumpObjectives(f, 'produced', fromOutput, events);
    p = stat(p, { contributed: contrib });
    events.push({ kind: 'contribution', amount: contrib });
  }

  events.push({ kind: 'item', item: args.item, amount: taken });
  if (taken < wanted) {
    events.push({ kind: 'info', text: `Sólo cabían ${taken}` });
  }

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: fromOutput > 0 ? { produced: fromOutput } : {},
    events,
    data: { taken },
  };
}

/* ─────────────── 12. SUELO: SOLTAR, RECOGER Y TIRAR ─────────────── */

/** Limpia objetos caducados. Mantiene acotado el documento de fábrica. */
function pruneGround(ground: Record<string, GroundItem>, now: number): Record<string, GroundItem> {
  const out: Record<string, GroundItem> = {};
  for (const [id, g] of Object.entries(ground)) {
    if (g && g.qty > 0 && now - g.droppedAt < BALANCE.ground.expireMs) out[id] = g;
  }
  return out;
}

export function opDropItem(
  player: PlayerState,
  factory: FactoryState,
  args: { item: string; qty: number; at: { x: number; y: number }; now: number },
): OpOutcome<{ dropped: number }> {
  const have = player.inventory[args.item] ?? 0;
  if (have <= 0) return fail('No llevas ese objeto');
  const qty = Math.min(Math.floor(args.qty), have);
  if (!Number.isFinite(qty) || qty <= 0) return fail('Cantidad inválida');
  if (!args.at) return fail('Posición desconocida');

  const ground = pruneGround(factory.ground ?? {}, args.now);
  if (Object.keys(ground).length >= BALANCE.ground.maxItems) {
    return fail('Hay demasiadas cosas tiradas por el suelo');
  }

  const id = `g_${args.now.toString(36)}_${player.uid.slice(-4)}_${Math.floor(Math.random() * 1296).toString(36)}`;
  ground[id] = {
    id,
    item: args.item,
    qty,
    x: Math.round(args.at.x),
    y: Math.round(args.at.y),
    by: player.uid,
    droppedAt: args.now,
  };

  const p: PlayerState = {
    ...player,
    inventory: addToInventory(player.inventory, args.item, -qty),
  };

  return {
    ok: true,
    player: p,
    factory: { ...factory, ground, updatedAt: args.now },
    events: [
      { kind: 'item', item: args.item, amount: -qty },
      { kind: 'info', text: `Has soltado ${qty} × ${getItem(args.item).name}` },
    ],
    data: { dropped: qty },
  };
}

/**
 * Recoge un objeto del suelo. Es transaccional: si dos jugadores lo intentan a
 * la vez, el segundo ve el montón ya reducido o vacío. Nunca se duplica.
 */
export function opPickupGround(
  player: PlayerState,
  factory: FactoryState,
  args: { groundId: string; at: { x: number; y: number }; now: number },
): OpOutcome<{ taken: number; remaining: number }> {
  const ground = { ...(factory.ground ?? {}) };
  const entry = ground[args.groundId];
  if (!entry || entry.qty <= 0) return fail('Ya no está ahí');

  if (
    !args.at ||
    !within(args.at, entry, BALANCE.actions.pickupRange + BALANCE.actions.validationSlack)
  ) {
    return fail('Estás demasiado lejos');
  }

  const free = inventoryFree(player);
  if (free <= 0) return fail('Inventario lleno');

  const taken = Math.min(entry.qty, free);
  const remaining = entry.qty - taken;
  if (remaining > 0) ground[args.groundId] = { ...entry, qty: remaining };
  else delete ground[args.groundId];

  const p: PlayerState = {
    ...player,
    inventory: addToInventory(player.inventory, entry.item, taken),
  };

  const events: OpEvent[] = [{ kind: 'item', item: entry.item, amount: taken }];
  if (remaining > 0) {
    events.push({ kind: 'info', text: `Quedan ${remaining} en el suelo` });
  }

  return {
    ok: true,
    player: p,
    factory: { ...factory, ground, updatedAt: args.now },
    events,
    data: { taken, remaining },
  };
}

/** Basurero: destruye material. No da dinero ni se puede deshacer. */
export function opTrashItem(
  player: PlayerState,
  factory: FactoryState,
  args: { item: string; qty: number; now: number },
): OpOutcome<{ destroyed: number }> {
  const have = player.inventory[args.item] ?? 0;
  if (have <= 0) return fail('No llevas ese objeto');
  const qty = Math.min(Math.floor(args.qty), have);
  if (!Number.isFinite(qty) || qty <= 0) return fail('Cantidad inválida');

  const p: PlayerState = {
    ...player,
    inventory: addToInventory(player.inventory, args.item, -qty),
  };

  return {
    ok: true,
    player: p,
    factory,
    events: [
      { kind: 'item', item: args.item, amount: -qty },
      { kind: 'info', text: `Has destruido ${qty} × ${getItem(args.item).name}` },
    ],
    data: { destroyed: qty },
  };
}

/** Cambia lo que hace un robot: repartir, vender o quedarse parado. */
export function opSetRobotMode(
  player: PlayerState,
  factory: FactoryState,
  args: { robotId: string; mode: RobotMode; now: number },
): OpOutcome<{ mode: RobotMode }> {
  const def = getRobot(args.robotId);
  if (!def) return fail('Robot desconocido');
  if (!['belt', 'sell', 'off'].includes(args.mode)) return fail('Modo inválido');
  if (args.mode === 'belt' && !def.to) {
    return fail('Este robot está al final de la cadena: sólo puede vender');
  }

  const cur = factory.robots?.[def.id];
  if (!cur || cur.level <= 0) return fail('Ese robot no está desplegado');
  if ((cur.mode ?? 'belt') === args.mode) {
    return { ok: true, player, factory, events: [], data: { mode: args.mode } };
  }

  const label =
    args.mode === 'sell' ? 'vendiendo' : args.mode === 'off' ? 'parado' : 'a la cinta';

  return {
    ok: true,
    player,
    factory: {
      ...factory,
      robots: {
        ...factory.robots,
        // Al cambiar de modo se reinicia el reloj: no se arrastra trabajo
        // pendiente de la tarea anterior.
        [def.id]: { ...cur, mode: args.mode, lastRunAt: args.now },
      },
      updatedAt: args.now,
    },
    events: [{ kind: 'info', text: `${def.name}: ${label}` }],
    data: { mode: args.mode },
  };
}

/* ───────────────────── 12b. MASCOTA CUADRÚPEDA ───────────────────── */

/** Compra o equipa un chasis de mascota. Equipar algo ya comprado es gratis. */
export function opBuyPetChassis(
  player: PlayerState,
  factory: FactoryState,
  args: { chassis: string; now: number },
): OpOutcome<{ equipped: string; cost: number }> {
  const def = PET_CHASSIS_MAP[args.chassis];
  if (!def) return fail('Chasis desconocido');

  const pet = normalizePet(player.pet, args.now);
  const owned = [...new Set([...DEFAULT_PET.owned, ...pet.owned])];

  if (owned.includes(def.id)) {
    return {
      ok: true,
      player: { ...player, pet: { ...pet, owned, chassis: def.id } },
      factory,
      events: [{ kind: 'info', text: `${def.name} equipado` }],
      data: { equipped: def.id, cost: 0 },
    };
  }

  if (player.level < def.unlockLevel) return fail(`Requiere nivel ${def.unlockLevel}`);
  if (player.money < def.cost) return fail('Dinero insuficiente');

  const events: OpEvent[] = [];
  let p: PlayerState = {
    ...player,
    money: player.money - def.cost,
    pet: { ...pet, owned: [...owned, def.id], chassis: def.id },
  };
  p = stat(p, { upgradesBought: 1 });
  p = bumpMissions(p, [{ metric: 'upgrade', amount: 1 }], events);

  const contrib = Math.round(def.cost * UPGRADE_CONTRIB_RATIO);
  const f = addContribution(factory, contrib, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: -def.cost });
  events.push({ kind: 'info', text: `${def.name} desbloqueado` });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { equipped: def.id, cost: def.cost },
  };
}

/** Sube una mejora de la mascota: mochila, perforadora, servos o sensor. */
export function opBuyPetStat(
  player: PlayerState,
  factory: FactoryState,
  args: { stat: string; now: number },
): OpOutcome<{ level: number; cost: number }> {
  const def = PET_STAT_MAP[args.stat];
  if (!def) return fail('Mejora desconocida');

  const pet = normalizePet(player.pet, args.now);
  const current = Math.max(0, Math.floor(pet.stats[def.id] ?? 0));
  if (current >= def.maxLevel) return fail('Nivel máximo alcanzado');

  const cost = petStatCost(def, current);
  if (player.money < cost) return fail('Dinero insuficiente');

  const events: OpEvent[] = [];
  let p: PlayerState = {
    ...player,
    money: player.money - cost,
    pet: { ...pet, stats: { ...pet.stats, [def.id]: current + 1 } },
  };
  p = stat(p, { upgradesBought: 1 });
  p = bumpMissions(p, [{ metric: 'upgrade', amount: 1 }], events);

  const contrib = Math.round(cost * UPGRADE_CONTRIB_RATIO);
  const f = addContribution(factory, contrib, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: -cost });
  events.push({ kind: 'info', text: `${def.name} nivel ${current + 1}` });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { level: current + 1, cost },
  };
}

/**
 * Compra un dron de apoyo, o sube el nivel de toda la escuadrilla.
 *
 * Los drones no extraen: le quitan la carga a la mascota en la propia veta y
 * la llevan a su máquina, para que ella no pierda tiempo en el paseo.
 */
export function opBuyDrone(
  player: PlayerState,
  factory: FactoryState,
  args: { upgrade?: boolean; now: number },
): OpOutcome<{ drones: number; level: number; cost: number }> {
  const pet = normalizePet(player.pet, args.now);
  const subir = args.upgrade === true;

  if (!subir && pet.drones >= DRONE.max) return fail('Escuadrilla completa');
  if (subir && pet.drones <= 0) return fail('Primero compra un dron');

  const cost = subir ? droneUpgradeCost(pet.droneLevel) : droneCost(pet.drones);
  if (player.money < cost) return fail('Dinero insuficiente');

  const next = subir
    ? { ...pet, droneLevel: pet.droneLevel + 1 }
    : { ...pet, drones: pet.drones + 1 };

  const events: OpEvent[] = [];
  let p: PlayerState = { ...player, money: player.money - cost, pet: next };
  p = stat(p, { upgradesBought: 1 });
  p = bumpMissions(p, [{ metric: 'upgrade', amount: 1 }], events);

  const contrib = Math.round(cost * UPGRADE_CONTRIB_RATIO);
  const f = addContribution(factory, contrib, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: -cost });
  events.push({
    kind: 'info',
    text: subir ? `Escuadrilla nivel ${next.droneLevel}` : `Dron ${next.drones} desplegado`,
  });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { drones: next.drones, level: next.droneLevel, cost },
  };
}

/**
 * Un dron te vacía a TI la mochila y lleva el material a su máquina.
 *
 * Es la misma idea que con la mascota, pero cogiendo de tu inventario: dejas
 * de tener que hacer el viaje hasta la cinta cada vez que te llenas. No lleva
 * comprobación de posición a propósito — el que ha volado hasta la máquina es
 * el dron, no tú; lo que sí se comprueba es que tengas drones, que la máquina
 * esté abierta y que el material sea el que acepta.
 */
export function opDroneHaul(
  player: PlayerState,
  factory: FactoryState,
  args: { machineId: string; beltId?: string; limit?: number; now: number },
): OpOutcome<{ deposited: Record<string, number> }> {
  const pet = normalizePet(player.pet, args.now);
  if (pet.drones <= 0) return fail('No tienes drones');
  if (!pet.droneTakesPlayer) return fail('Los drones no cogen de tu mochila');

  const def = getMachine(args.machineId);
  const cur = factory.machines[args.machineId];
  if (!cur) return fail('Máquina no encontrada');
  if (factory.level < def.unlockFactoryLevel) return fail('Máquina bloqueada');

  let belt: ReturnType<typeof getBelt> | undefined;
  if (args.beltId) {
    belt = getBelt(args.beltId);
    if (!belt || belt.feeds !== args.machineId) return fail('Cinta inválida');
    if (factory.level < belt.fromLevel) return fail('Cinta sin energía');
  }

  // Nunca más de lo que la escuadrilla puede cargar en un viaje.
  const squad = deriveDrones(pet);
  const pedido =
    typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.max(0, Math.floor(args.limit))
      : squad.carry;
  let room = Math.min(pedido, squad.carry);

  const allowed = belt?.accepts?.length ? belt.accepts : Object.keys(def.input);
  const deposited: Record<string, number> = {};
  let inventory = player.inventory;
  let units = 0;
  for (const item of allowed) {
    if (room <= 0) break;
    const have = Math.max(0, Math.floor(inventory[item] ?? 0));
    if (have <= 0) continue;
    const take = Math.min(have, room);
    inventory = addToInventory(inventory, item, -take);
    deposited[item] = take;
    units += take;
    room -= take;
  }
  if (units === 0) return fail('No llevas material para ahí');

  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  let machine: MachineState = settled.state;
  let belts = factory.belts ?? {};
  for (const [item, qty] of Object.entries(deposited)) {
    if (belt) belts = pushToBelt(belts, belt.id, item, qty, args.now);
    else
      machine = {
        ...machine,
        input: { ...machine.input, [item]: (machine.input[item] ?? 0) + qty },
      };
  }
  if (!belt) machine = settleMachine(machine, args.machineId, factory.level, args.now).state;

  // Mismo premio que llevarlo tú, pero sin gastar estamina: la ha puesto el
  // dron. Es la ventaja de haberlo comprado.
  const events: OpEvent[] = [];
  let p: PlayerState = { ...player, inventory };
  p = stat(p, { deposited: units });
  p = grantXp(p, def.xpPerDeposit * units, events, args.now);
  p = bumpMissions(
    p,
    Object.entries(deposited).map(([item, amount]) => ({
      metric: 'deposit' as const,
      item,
      amount,
    })),
    events,
  );

  for (const [item, n] of Object.entries(deposited)) {
    events.push({ kind: 'item', item, amount: -n });
  }

  return {
    ok: true,
    player: p,
    factory: {
      ...factory,
      machines: { ...factory.machines, [args.machineId]: machine },
      belts,
      updatedAt: args.now,
    },
    events,
    data: { deposited },
  };
}

/** Color, detalles y orden de trabajo. Es configuración: no cuesta nada. */
export function opSetPetLook(
  player: PlayerState,
  factory: FactoryState,
  args: {
    color?: string;
    accent?: string;
    mode?: string;
    zone?: string | null;
    droneTakesPlayer?: boolean;
    now: number;
  },
): OpOutcome<{ ok: true }> {
  const pet = normalizePet(player.pet, args.now);
  const color =
    args.color && PET_COLORS.some((c) => c.id === args.color) ? args.color : pet.color;
  const accent =
    args.accent && PET_ACCENTS.some((c) => c.id === args.accent) ? args.accent : pet.accent;
  const modeDef = args.mode ? PET_MODES.find((m) => m.id === args.mode) : undefined;
  if (args.mode && !modeDef) return fail('Modo desconocido');
  const mode = modeDef?.id ?? pet.mode;

  // Zona de trabajo: null = automática. Sólo se acepta una zona que exista y
  // que ya esté abierta a este nivel de fábrica.
  let zone = pet.zone;
  const events: OpEvent[] = [];
  if (args.zone !== undefined) {
    if (args.zone === null) {
      zone = null;
      events.push({ kind: 'info', text: 'Mascota: zona automática' });
    } else {
      const def = getPetZone(args.zone);
      if (!def) return fail('Zona desconocida');
      if (factory.level < def.fromLevel) return fail(`Requiere fábrica nivel ${def.fromLevel}`);
      zone = def.id;
      events.push({ kind: 'info', text: `Mascota → ${def.label}` });
    }
  }
  if (modeDef) events.push({ kind: 'info', text: `Mascota: ${modeDef.label}` });

  const droneTakesPlayer =
    typeof args.droneTakesPlayer === 'boolean' ? args.droneTakesPlayer : pet.droneTakesPlayer;
  if (typeof args.droneTakesPlayer === 'boolean') {
    events.push({
      kind: 'info',
      text: droneTakesPlayer ? 'Los drones también te vacían a ti' : 'Los drones no te tocan la mochila',
    });
  }

  return {
    ok: true,
    player: { ...player, pet: { ...pet, color, accent, mode, zone, droneTakesPlayer } },
    factory,
    events,
    data: { ok: true },
  };
}

/**
 * Liquida lo que la mascota ha extraído.
 *
 * La extracción se simula en el cliente (cada jugador tiene la suya y no
 * merece la pena sincronizar su posición). Ésta es la frontera de confianza:
 * se acepta material por tandas, pero acotado por el ritmo que de verdad
 * tiene la mascota y por el tiempo transcurrido desde la última liquidación.
 * Un cliente manipulado puede adelantar unos segundos, no fabricar material.
 */
export function opPetMine(
  player: PlayerState,
  factory: FactoryState,
  args: { stationId: string; qty: number; now: number },
): OpOutcome<{ item: string; qty: number }> {
  const station = STATIONS.find((s) => s.id === args.stationId);
  if (!station || !isPetStation(station.id)) return fail('Estación inválida');

  const pet = normalizePet(player.pet, args.now);
  if (pet.mode !== 'gather') return fail('La mascota no está extrayendo');

  // El item lo decide el servidor a partir de la estación: el cliente no elige
  // qué material saca. Y los consumibles no le hacen falta.
  const { item, amount } = stationYield(station);
  if (!petAccepts(item)) return fail('La mascota no recoge ese material');
  const asked = Math.max(0, Math.floor(args.qty || 0));
  if (asked <= 0) return fail('Nada que liquidar');

  const elapsed = args.now - (pet.lastAt || player.createdAt);
  const byTime = petMineCap(pet, elapsed, PET_RATE_TOLERANCE) * amount;
  const qty = Math.min(asked, byTime, petFree(pet));
  if (qty <= 0) {
    return {
      ok: true,
      player: { ...player, pet: { ...pet, lastAt: args.now } },
      factory,
      events: [],
      data: { item, qty: 0 },
    };
  }

  const { inventory, added } = addToPet(pet, item, qty);
  const events: OpEvent[] = [];
  let p: PlayerState = {
    ...player,
    pet: { ...pet, inventory, lastAt: args.now, mined: (pet.mined ?? 0) + added },
  };
  p = stat(p, { gathered: added, petMined: added });
  // La mascota trabaja por ti, así que rinde menos XP que picar tú mismo.
  p = grantXp(p, Math.round(BALANCE.actions.gather.xp * PET_XP_RATIO * added), events, args.now);
  p = bumpMissions(p, [{ metric: 'gather', item, amount: added }], events);

  let f: FactoryState = {
    ...factory,
    stats: { ...factory.stats, gathered: factory.stats.gathered + added },
    updatedAt: args.now,
  };
  f = bumpObjectives(f, 'gathered', added, events);

  return { ok: true, player: p, factory: f, events, data: { item, qty: added } };
}

/**
 * La mascota suelta su carga en la cinta o la máquina que la consume.
 *
 * Es la razón de ser del modo EXTRAER: el material no se queda muerto en su
 * mochila ni depende de que tú tengas hueco, entra directo en la cadena de
 * producción. El destino se valida contra las recetas y los desbloqueos, así
 * que no se puede meter cualquier cosa en cualquier sitio.
 */
export function opPetDeposit(
  player: PlayerState,
  factory: FactoryState,
  args: { machineId: string; beltId?: string; limit?: number; now: number },
): OpOutcome<{ deposited: Record<string, number> }> {
  const pet = normalizePet(player.pet, args.now);
  if (pet.mode !== 'gather') return fail('La mascota no está extrayendo');

  const def = getMachine(args.machineId);
  const cur = factory.machines[args.machineId];
  if (!cur) return fail('Máquina no encontrada');
  if (factory.level < def.unlockFactoryLevel) return fail('Máquina bloqueada');

  // Si va por cinta, la cinta tiene que existir, estar viva y llevar ahí.
  let belt: ReturnType<typeof getBelt> | undefined;
  if (args.beltId) {
    belt = getBelt(args.beltId);
    if (!belt || belt.feeds !== args.machineId) return fail('Cinta inválida');
    if (factory.level < belt.fromLevel) return fail('Cinta sin energía');
  }

  const allowed = belt?.accepts?.length ? belt.accepts : Object.keys(def.input);
  const moving: Record<string, number> = {};
  const inventory = { ...pet.inventory };
  // Un dron se lleva sólo lo que le cabe en el viaje; la mascota, todo.
  let room =
    typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.max(0, Math.floor(args.limit))
      : Number.POSITIVE_INFINITY;
  let units = 0;
  for (const item of allowed) {
    if (room <= 0) break;
    const have = Math.max(0, Math.floor(inventory[item] ?? 0));
    if (have <= 0 || !petAccepts(item)) continue;
    const take = Math.min(have, room);
    moving[item] = take;
    units += take;
    room -= take;
    if (take >= have) delete inventory[item];
    else inventory[item] = have - take;
  }
  if (units <= 0) return fail('La mascota no lleva nada para ahí');

  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  let machine: MachineState = settled.state;
  let belts = factory.belts ?? {};

  for (const [item, qty] of Object.entries(moving)) {
    if (belt) {
      // Por cinta el material tarda en llegar, y se ve viajar.
      belts = pushToBelt(belts, belt.id, item, qty, args.now);
    } else {
      machine = { ...machine, input: { ...machine.input, [item]: (machine.input[item] ?? 0) + qty } };
    }
  }
  // Volver a liquidar arranca el ciclo si con lo entregado ya hay receta.
  if (!belt) machine = settleMachine(machine, args.machineId, factory.level, args.now).state;

  const events: OpEvent[] = [
    {
      kind: 'info',
      text: `${getChassis(pet.chassis).name}: ${units} → ${belt?.label ?? def.short}`,
    },
  ];

  let p: PlayerState = { ...player, pet: { ...pet, inventory } };
  p = stat(p, { deposited: units });
  p = bumpMissions(
    p,
    Object.entries(moving).map(([item, amount]) => ({ metric: 'deposit' as const, item, amount })),
    events,
  );

  return {
    ok: true,
    player: p,
    factory: {
      ...factory,
      machines: { ...factory.machines, [args.machineId]: machine },
      belts,
      updatedAt: args.now,
    },
    events,
    data: { deposited: moving },
  };
}

/**
 * La mascota te entrega su mochila. Lo que no te quepa se lo queda: nunca se
 * destruye material por descargar con el inventario lleno.
 */
export function opPetUnload(
  player: PlayerState,
  factory: FactoryState,
  args: { now: number },
): OpOutcome<{ moved: Record<string, number>; units: number }> {
  const pet = normalizePet(player.pet, args.now);
  if (petUsed(pet) <= 0) return fail('La mascota no lleva nada');

  const free = inventoryFree(player);
  if (free <= 0) return fail('Inventario lleno');

  const out = unloadPet(pet.inventory, player.inventory, free);
  if (out.units <= 0) return fail('Inventario lleno');

  const events: OpEvent[] = Object.entries(out.moved).map(([item, amount]) => ({
    kind: 'item' as const,
    item,
    amount,
  }));

  return {
    ok: true,
    player: {
      ...player,
      inventory: out.player,
      pet: { ...pet, inventory: out.pet },
    },
    factory,
    events,
    data: { moved: out.moved, units: out.units },
  };
}

/* ───────────────────── 13. COMPRAR / MEJORAR ROBOT ───────────────────── */

export function opBuyRobot(
  player: PlayerState,
  factory: FactoryState,
  args: { robotId: string; now: number },
): OpOutcome<{ level: number; cost: number }> {
  const def = getRobot(args.robotId);
  if (!def) return fail('Robot desconocido');
  if (factory.level < def.unlockFactoryLevel)
    return fail(`Requiere fábrica nivel ${def.unlockFactoryLevel}`);

  const cur = factory.robots?.[def.id] ?? {
    level: 0,
    lastRunAt: args.now,
    moved: 0,
    mode: (def.to ? 'belt' : 'sell') as RobotMode,
    sold: 0,
  };
  if (cur.level >= def.maxLevel) return fail('Nivel máximo');

  const cost = robotCost(def, cur.level);
  if (player.money < cost) return fail('Dinero insuficiente');

  const events: OpEvent[] = [];
  let p: PlayerState = { ...player, money: player.money - cost };
  p = grantXp(p, Math.round(cost * 0.05), events, args.now);

  const robots = {
    ...(factory.robots ?? {}),
    [def.id]: {
      ...cur,
      level: cur.level + 1,
      lastRunAt: args.now,
      // Los terminales sólo pueden vender; el resto empieza repartiendo.
      mode: cur.mode ?? (def.to ? 'belt' : 'sell'),
      sold: cur.sold ?? 0,
    },
  };
  let f: FactoryState = { ...factory, robots, updatedAt: args.now };
  const contrib = Math.round(cost * ROBOT_CONTRIB_RATIO);
  f = addContribution(f, contrib, events);
  p = stat(p, { contributed: contrib });

  events.push({ kind: 'money', amount: -cost });
  events.push({
    kind: 'info',
    text: cur.level === 0 ? `${def.name} desplegado` : `${def.name} → nivel ${cur.level + 1}`,
  });
  events.push({ kind: 'contribution', amount: contrib });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { level: cur.level + 1, cost },
  };
}

/* ───────────────────── 12. APLICAR REINICIO DE FÁBRICA ───────────────────── */

/**
 * Cuando un administrador reinicia la fábrica, cada jugador arrastra su propio
 * progreso a cero la próxima vez que entra. Se conservan únicamente identidad
 * y aspecto: nombre, foto y skin, que no forman parte del progreso.
 *
 * Se hace desde el cliente de cada jugador (y no escribiendo el documento de
 * todos desde el admin) para que nadie pueda tocar documentos ajenos.
 */
export function opApplyFactoryReset(
  player: PlayerState,
  factory: FactoryState,
  args: { now: number },
): OpOutcome<{ applied: boolean }> {
  const resetAt = factory.resetAt ?? 0;
  if (resetAt <= (player.resetAckAt ?? 0)) {
    return { ok: true, player, factory, events: [], data: { applied: false } };
  }

  const fresh = createPlayerState(
    {
      uid: player.uid,
      displayName: player.name,
      photoURL: player.photoURL,
      email: null,
    },
    args.now,
  );

  const p: PlayerState = {
    ...fresh,
    // Identidad y aspecto sobreviven; el progreso no.
    name: player.name,
    photoURL: player.photoURL,
    appearance: player.appearance,
    factoryId: player.factoryId,
    createdAt: player.createdAt,
    onboarded: player.onboarded,
    resetAckAt: resetAt,
    lastOfflineClaimAt: args.now,
  };

  return {
    ok: true,
    player: p,
    factory,
    memberDelta: { money: p.money },
    events: [
      {
        kind: 'info',
        text: 'La fábrica se ha reiniciado: todos empezáis de cero',
      },
    ],
    data: { applied: true },
  };
}

/* ───────────────────── 13. TICK DE SESIÓN ───────────────────── */

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
  | 'buyRobot'
  | 'setRobotMode'
  | 'buyPetChassis'
  | 'buyPetStat'
  | 'buyDrone'
  | 'droneHaul'
  | 'setPetLook'
  | 'petMine'
  | 'petDeposit'
  | 'petUnload'
  | 'withdraw'
  | 'dropItem'
  | 'pickupGround'
  | 'trashItem'
  | 'applyFactoryReset'
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
  buyRobot: opBuyRobot,
  setRobotMode: opSetRobotMode,
  buyPetChassis: opBuyPetChassis,
  buyPetStat: opBuyPetStat,
  buyDrone: opBuyDrone,
  droneHaul: opDroneHaul,
  setPetLook: opSetPetLook,
  petMine: opPetMine,
  petDeposit: opPetDeposit,
  petUnload: opPetUnload,
  withdraw: opWithdraw,
  dropItem: opDropItem,
  pickupGround: opPickupGround,
  trashItem: opTrashItem,
  applyFactoryReset: opApplyFactoryReset,
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
    // La fábrica se pone al día ANTES de cualquier operación: primero producen
    // las máquinas, luego los robots reparten, y las máquinas de destino
    // arrancan con lo entregado. Todo se persiste en la misma transacción.
    const now =
      typeof (args as { now?: number })?.now === 'number'
        ? (args as { now: number }).now
        : Date.now();
    // El jugador que actúa se marca como conectado: es lo que decide entre
    // quiénes se reparte el dinero de las ventas automáticas.
    // Se poda a la vez para que el registro no crezca sin fin con jugadores
    // que pasaron por aquí hace semanas.
    const online: Record<string, number> = { [player.uid]: now };
    for (const [uid, at] of Object.entries(factory.online ?? {})) {
      if (uid !== player.uid && now - at < ONLINE_WINDOW_MS * 4) online[uid] = at;
    }
    let base: FactoryState = { ...factory, online };
    const settled = settleFactory(base, now);
    base = settled.factory;

    // Y cobra lo que los robots hayan vendido a su nombre.
    const claimed = claimSaleShare(player, base);
    const actor = claimed.player;
    base = claimed.factory;

    const out = op(actor, base, args as never) as OpOutcome;

    const merge = (o: OpOutcome): OpOutcome => ({
      ...o,
      player: o.player ?? actor,
      factory: o.factory ?? base,
      events: claimed.events.length ? [...claimed.events, ...(o.events ?? [])] : o.events,
      memberDelta: claimed.money
        ? { ...(o.memberDelta ?? {}), money: (o.player ?? actor).money }
        : o.memberDelta,
    });

    // Aunque la operación falle, se conserva el trabajo de los robots y el
    // cobro pendiente: no se pierde dinero por un clic rechazado.
    if (!out.ok) {
      return claimed.money || settled.transfers.length > 0
        ? { ...out, player: actor, factory: base }
        : out;
    }
    return merge(out);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Error interno');
  }
}
