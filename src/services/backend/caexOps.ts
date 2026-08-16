/**
 * OPERACIONES DEL CAEX — reductores puros, como el resto.
 *
 * Van aparte de `ops.ts` sólo por tamaño: el fichero de operaciones ya era
 * enorme. Las reglas son las mismas — nada se cree lo que dice el cliente: la
 * carga se acota por el tiempo transcurrido y por la tolva real del camión.
 */

import { BALANCE } from '../../config/balance';
import {
  CAEX,
  CAEX_MODES,
  CAEX_SKIN_MAP,
  CAEX_STATS,
  caexDroneUpgradeCost,
  caexFree,
  caexStatCost,
  deriveCaex,
  normalizeCaex,
} from '../../config/caex';
import { PET_ACCENTS, PET_COLORS, PET_RATE_TOLERANCE } from '../../config/pets';
import { UPGRADE_CONTRIB_RATIO } from '../../config/upgrades';
import { getMachine } from '../../config/machines';
import { STATIONS } from '../../config/world';
import { beltAccepts, getBelt, pushToBelt } from '../../game/logic/belts';
import { isPetStation, petAccepts, stationYield } from '../../game/logic/pet';
import { settleMachine } from '../../game/logic/production';
import type { FactoryState, MachineState, PlayerState } from '../../types';
import {
  addContribution,
  bumpMissions,
  bumpObjectives,
  fail,
  grantXp,
  stat,
  type OpEvent,
  type OpOutcome,
} from './ops';

/** El camión rinde lo mismo que la mascota: material sí, progresión no tanto. */
const CAEX_XP_RATIO = 0.4;

/**
 * Compra el camión, o compra/equipa un chasis suyo.
 */
export function opBuyCaex(
  player: PlayerState,
  factory: FactoryState,
  args: { skin?: string; now: number },
): OpOutcome<{ cost: number }> {
  const caex = normalizeCaex(player.caex, args.now);

  if (!caex.owned) {
    if (factory.level < CAEX.unlockFactoryLevel) {
      return fail(`Requiere fábrica nivel ${CAEX.unlockFactoryLevel}`);
    }
    if (player.money < CAEX.cost) return fail('Dinero insuficiente');
    const events: OpEvent[] = [
      { kind: 'money', amount: -CAEX.cost },
      { kind: 'info', text: '🚚 CAEX en ruta' },
    ];
    let p: PlayerState = {
      ...player,
      money: player.money - CAEX.cost,
      caex: { ...caex, owned: true, lastAt: args.now },
    };
    p = stat(p, { upgradesBought: 1 });
    const contrib = Math.round(CAEX.cost * UPGRADE_CONTRIB_RATIO);
    const f = addContribution(factory, contrib, events);
    p = stat(p, { contributed: contrib });
    return {
      ok: true,
      player: p,
      factory: f,
      memberDelta: { contributed: contrib, money: p.money },
      events,
      data: { cost: CAEX.cost },
    };
  }

  const def = args.skin ? CAEX_SKIN_MAP[args.skin] : undefined;
  if (!def) return fail('Chasis desconocido');
  if (caex.skins.includes(def.id)) {
    return {
      ok: true,
      player: { ...player, caex: { ...caex, skin: def.id } },
      factory,
      events: [{ kind: 'info', text: `${def.name} equipado` }],
      data: { cost: 0 },
    };
  }
  if (player.level < def.unlockLevel) return fail(`Requiere nivel ${def.unlockLevel}`);
  if (player.money < def.cost) return fail('Dinero insuficiente');

  const events: OpEvent[] = [
    { kind: 'money', amount: -def.cost },
    { kind: 'info', text: `${def.name} desbloqueado` },
  ];
  let p: PlayerState = {
    ...player,
    money: player.money - def.cost,
    caex: { ...caex, skin: def.id, skins: [...caex.skins, def.id] },
  };
  p = stat(p, { upgradesBought: 1 });
  const contrib = Math.round(def.cost * UPGRADE_CONTRIB_RATIO);
  const f = addContribution(factory, contrib, events);
  p = stat(p, { contributed: contrib });
  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { cost: def.cost },
  };
}

/** Mejoras del camión (tolva y cuchara, sin tope) y su dron. */
export function opBuyCaexStat(
  player: PlayerState,
  factory: FactoryState,
  args: { stat?: string; drone?: boolean; now: number },
): OpOutcome<{ level: number; cost: number }> {
  const caex = normalizeCaex(player.caex, args.now);
  if (!caex.owned) return fail('Todavía no tienes CAEX');

  if (args.drone) {
    const comprar = !caex.drone;
    const cost = comprar ? CAEX.droneCost : caexDroneUpgradeCost(caex.droneLevel);
    if (player.money < cost) return fail('Dinero insuficiente');
    const next = comprar ? { ...caex, drone: true } : { ...caex, droneLevel: caex.droneLevel + 1 };
    const events: OpEvent[] = [
      { kind: 'money', amount: -cost },
      {
        kind: 'info',
        text: comprar ? '🛸 Dron del CAEX desplegado' : `Dron del CAEX nivel ${next.droneLevel}`,
      },
    ];
    let p: PlayerState = { ...player, money: player.money - cost, caex: next };
    p = stat(p, { upgradesBought: 1 });
    const contrib = Math.round(cost * UPGRADE_CONTRIB_RATIO);
    const f = addContribution(factory, contrib, events);
    p = stat(p, { contributed: contrib });
    return {
      ok: true,
      player: p,
      factory: f,
      memberDelta: { contributed: contrib, money: p.money },
      events,
      data: { level: next.droneLevel, cost },
    };
  }

  const def = CAEX_STATS.find((s) => s.id === args.stat);
  if (!def) return fail('Mejora desconocida');
  const level = Math.max(0, Math.floor(caex.stats?.[def.id] ?? 0));
  const cost = caexStatCost(def, level);
  if (player.money < cost) return fail('Dinero insuficiente');

  const events: OpEvent[] = [
    { kind: 'money', amount: -cost },
    { kind: 'info', text: `${def.name} nivel ${level + 1}` },
  ];
  let p: PlayerState = {
    ...player,
    money: player.money - cost,
    caex: { ...caex, stats: { ...caex.stats, [def.id]: level + 1 } },
  };
  p = stat(p, { upgradesBought: 1 });
  p = bumpMissions(p, [{ metric: 'upgrade', amount: 1 }], events);
  const contrib = Math.round(cost * UPGRADE_CONTRIB_RATIO);
  const f = addContribution(factory, contrib, events);
  p = stat(p, { contributed: contrib });

  return {
    ok: true,
    player: p,
    factory: f,
    memberDelta: { contributed: contrib, money: p.money },
    events,
    data: { level: level + 1, cost },
  };
}

/** Color, detalles y si está en ruta o aparcado. Gratis: es configuración. */
export function opSetCaexLook(
  player: PlayerState,
  factory: FactoryState,
  args: { color?: string; accent?: string; mode?: string; now: number },
): OpOutcome<{ ok: true }> {
  const caex = normalizeCaex(player.caex, args.now);
  const color = args.color && PET_COLORS.some((c) => c.id === args.color) ? args.color : caex.color;
  const accent =
    args.accent && PET_ACCENTS.some((c) => c.id === args.accent) ? args.accent : caex.accent;
  const modeDef = args.mode ? CAEX_MODES.find((m) => m.id === args.mode) : undefined;
  if (args.mode && !modeDef) return fail('Modo desconocido');
  const events: OpEvent[] = [];
  if (modeDef) events.push({ kind: 'info', text: `CAEX: ${modeDef.label}` });

  return {
    ok: true,
    player: { ...player, caex: { ...caex, color, accent, mode: modeDef?.id ?? caex.mode } },
    factory,
    events,
    data: { ok: true },
  };
}

/** Liquida lo que el camión ha cargado en su parada. */
export function opCaexMine(
  player: PlayerState,
  factory: FactoryState,
  args: { stationId: string; qty: number; now: number },
): OpOutcome<{ item: string; qty: number }> {
  const station = STATIONS.find((s) => s.id === args.stationId);
  if (!station || !isPetStation(station.id)) return fail('Estación inválida');

  const caex = normalizeCaex(player.caex, args.now);
  if (!caex.owned) return fail('Todavía no tienes CAEX');
  if (caex.mode !== 'route') return fail('El CAEX está en el taller');

  const { item, amount } = stationYield(station);
  if (!petAccepts(item)) return fail('El CAEX no carga eso');
  const asked = Math.max(0, Math.floor(args.qty || 0));
  if (asked <= 0) return fail('Nada que liquidar');

  const derived = deriveCaex(caex);
  const elapsed = Math.max(0, args.now - (caex.lastAt || player.createdAt));
  // Mismo margen anti-trampas que la mascota: acotado por tiempo, no por fe.
  const byTime =
    (Math.floor((derived.minePerSec * elapsed * PET_RATE_TOLERANCE) / 1000) + 1) * amount;
  const qty = Math.min(asked, byTime, caexFree(caex));
  if (qty <= 0) {
    return {
      ok: true,
      player: { ...player, caex: { ...caex, lastAt: args.now } },
      factory,
      events: [],
      data: { item, qty: 0 },
    };
  }

  const bag = { ...caex.bag, [item]: (caex.bag[item] ?? 0) + qty };
  // El reloj se consume en proporción a lo concedido, como con los perros.
  const usedMs = derived.minePerSec > 0 ? (qty / amount / derived.minePerSec) * 1000 : 0;
  const events: OpEvent[] = [];
  let p: PlayerState = {
    ...player,
    caex: {
      ...caex,
      bag,
      lastAt: Math.min(args.now, (caex.lastAt || player.createdAt) + usedMs),
      mined: (caex.mined ?? 0) + qty,
    },
  };
  p = stat(p, { gathered: qty, petMined: qty });
  p = grantXp(p, Math.round(BALANCE.actions.gather.xp * CAEX_XP_RATIO * qty), events, args.now);
  p = bumpMissions(p, [{ metric: 'gather', item, amount: qty }], events);

  let f: FactoryState = {
    ...factory,
    stats: { ...factory.stats, gathered: factory.stats.gathered + qty },
    updatedAt: args.now,
  };
  f = bumpObjectives(f, 'gathered', qty, events);

  return { ok: true, player: p, factory: f, events, data: { item, qty } };
}

/** El camión bascula la tolva en una cinta o máquina. */
export function opCaexDeposit(
  player: PlayerState,
  factory: FactoryState,
  args: {
    machineId: string;
    beltId?: string;
    limit?: number;
    items?: Record<string, number>;
    now: number;
  },
): OpOutcome<{ deposited: Record<string, number> }> {
  const caex = normalizeCaex(player.caex, args.now);
  if (!caex.owned) return fail('Todavía no tienes CAEX');

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

  const allowed = belt ? beltAccepts(belt) : Object.keys(def.input);
  const pedido = args.items
    ? Object.keys(args.items).filter((i) => allowed.includes(i))
    : allowed;
  const moving: Record<string, number> = {};
  const bag = { ...caex.bag };
  let room =
    typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.max(0, Math.floor(args.limit))
      : Number.POSITIVE_INFINITY;
  let units = 0;
  for (const item of pedido) {
    if (room <= 0) break;
    const have = Math.max(0, Math.floor(bag[item] ?? 0));
    if (have <= 0 || !petAccepts(item)) continue;
    const quiere = args.items ? Math.max(0, Math.floor(args.items[item] ?? 0)) : have;
    const take = Math.min(have, quiere, room);
    if (take <= 0) continue;
    moving[item] = take;
    units += take;
    room -= take;
    if (take >= have) delete bag[item];
    else bag[item] = have - take;
  }
  if (units <= 0) return fail('El CAEX no lleva nada para ahí');

  const settled = settleMachine(cur, args.machineId, factory.level, args.now);
  let machine: MachineState = settled.state;
  let belts = factory.belts ?? {};
  for (const [item, qty] of Object.entries(moving)) {
    if (belt) belts = pushToBelt(belts, belt.id, item, qty, args.now);
    else
      machine = {
        ...machine,
        input: { ...machine.input, [item]: (machine.input[item] ?? 0) + qty },
      };
  }
  if (!belt) machine = settleMachine(machine, args.machineId, factory.level, args.now).state;

  const events: OpEvent[] = [
    { kind: 'info', text: `🚚 CAEX: ${units} → ${belt?.label ?? def.short}` },
  ];
  let p: PlayerState = { ...player, caex: { ...caex, bag } };
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
