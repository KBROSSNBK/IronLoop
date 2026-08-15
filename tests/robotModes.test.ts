import { describe, expect, it } from 'vitest';
import {
  ONLINE_WINDOW_MS,
  onlineUids,
  settleRobots,
  splitSale,
} from '../src/game/logic/robots';
import { runOp } from '../src/services/backend/ops';
import { beltCount } from '../src/game/logic/belts';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { ROBOTS, getRobot, robotRate } from '../src/config/robots';
import { getItem } from '../src/config/items';
import type { FactoryState, PlayerState, RobotState } from '../src/types';

const T0 = 1_700_000_000_000;
const HAULER = ROBOTS[0]; // smelter → assembler, lingotes
const PRICE = getItem(HAULER.item).sellPrice;

const player = (uid: string, over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid, displayName: uid, photoURL: null, email: null }, T0),
  ...over,
});

const robot = (over: Partial<RobotState> = {}): RobotState => ({
  level: 1,
  lastRunAt: T0,
  moved: 0,
  mode: 'belt',
  sold: 0,
  ...over,
});

function factory(mode: RobotState['mode'], online: string[] = [], stock = 500): FactoryState {
  const base = createFactoryState('f1', 1, T0);
  return {
    ...base,
    level: 10,
    robots: { [HAULER.id]: robot({ mode }) },
    machines: {
      ...base.machines,
      smelter: { ...base.machines.smelter, output: { ingot: stock } },
    },
    online: Object.fromEntries(online.map((uid) => [uid, T0])),
  };
}

describe('modos de operación del robot', () => {
  it('por defecto pone el material en su cinta, no lo teletransporta', () => {
    const f = factory('belt');
    const now = T0 + 60_000;
    const { factory: after, transfers } = settleRobots(f, now);
    expect(transfers[0].money).toBeUndefined();
    const belt = HAULER.viaConveyor!;
    expect(beltCount(after.belts?.[belt], belt, now)).toBe(robotRate(HAULER, 1));
    expect(after.machines.assembler.input.ingot).toBeUndefined();
  });

  it('en modo parado no hace absolutamente nada', () => {
    const f = factory('off');
    const { factory: after, transfers } = settleRobots(f, T0 + 3600_000);
    expect(transfers).toHaveLength(0);
    expect(after.machines.assembler.input.ingot).toBeUndefined();
    expect(after.machines.smelter.output.ingot).toBe(500);
  });

  it('parado no acumula trabajo pendiente para soltarlo de golpe', () => {
    const parado = settleRobots(factory('off'), T0 + 3600_000).factory;
    const reactivado: FactoryState = {
      ...parado,
      robots: { [HAULER.id]: { ...parado.robots[HAULER.id], mode: 'belt' } },
    };
    const { transfers } = settleRobots(reactivado, T0 + 3600_000 + 60_000);
    expect(transfers[0].amount).toBe(robotRate(HAULER, 1));
  });

  it('en modo venta saca material y genera dinero', () => {
    const f = factory('sell', ['a']);
    const { factory: after, transfers } = settleRobots(f, T0 + 60_000);
    const movido = robotRate(HAULER, 1);
    expect(transfers[0].money).toBe(PRICE * movido);
    expect(after.machines.smelter.output.ingot).toBe(500 - movido);
    // Vender no alimenta la máquina siguiente.
    expect(after.machines.assembler.input.ingot).toBeUndefined();
  });

  it('vendiendo solo, el 100% es para ti', () => {
    const f = factory('sell', ['a']);
    const { factory: after } = settleRobots(f, T0 + 60_000);
    const total = PRICE * robotRate(HAULER, 1);
    expect(after.saleLedger.a).toBe(total);
  });

  it('con dos conectados el reparto es 50/50', () => {
    const f = factory('sell', ['a', 'b']);
    const { factory: after } = settleRobots(f, T0 + 60_000);
    const total = PRICE * robotRate(HAULER, 1);
    expect(after.saleLedger.a + after.saleLedger.b).toBe(total);
    expect(Math.abs(after.saleLedger.a - after.saleLedger.b)).toBeLessThanOrEqual(1);
  });

  it('sin nadie conectado no se reparte nada, pero tampoco se pierde material', () => {
    const f = factory('sell', []);
    const { factory: after } = settleRobots(f, T0 + 60_000);
    expect(Object.keys(after.saleLedger)).toHaveLength(0);
    // El material sigue en la máquina: no se ha regalado a nadie.
    expect(after.machines.smelter.output.ingot).toBe(500);
  });

  it('el robot terminal sólo puede vender', () => {
    const terminal = ROBOTS.find((r) => !r.to)!;
    const base = createFactoryState('f1', 1, T0);
    const f: FactoryState = {
      ...base,
      level: 14,
      robots: { [terminal.id]: robot({ mode: 'sell' }) },
      machines: {
        ...base.machines,
        [terminal.from]: { ...base.machines[terminal.from], output: { [terminal.item]: 20 } },
      },
      online: { a: T0 },
    };
    const { transfers, factory: after } = settleRobots(f, T0 + 60_000);
    expect(transfers[0].money).toBeGreaterThan(0);
    expect(after.saleLedger.a).toBeGreaterThan(0);
  });
});

describe('reparto de la venta', () => {
  it('reparte exactamente, sin crear ni perder dinero', () => {
    for (const n of [1, 2, 3, 7]) {
      const uids = Array.from({ length: n }, (_, i) => `u${i}`);
      const ledger = splitSale({}, uids, 1000);
      const suma = Object.values(ledger).reduce((a, b) => a + b, 0);
      expect(suma).toBe(1000);
    }
  });

  it('acumula sobre lo que ya hubiera pendiente', () => {
    const ledger = splitSale({ a: 50 }, ['a'], 100);
    expect(ledger.a).toBe(150);
  });

  it('ignora importes cero o sin destinatarios', () => {
    expect(splitSale({}, [], 500)).toEqual({});
    expect(splitSale({}, ['a'], 0)).toEqual({});
  });

  it('sólo cuenta como conectado quien lo esté dentro de la ventana', () => {
    const f: FactoryState = {
      ...createFactoryState('f1', 1, T0),
      online: { reciente: T0, viejo: T0 - ONLINE_WINDOW_MS - 1 },
    };
    expect(onlineUids(f, T0)).toEqual(['reciente']);
  });
});

describe('cobro del reparto', () => {
  it('el jugador cobra su parte al hacer cualquier operación', () => {
    const base = createFactoryState('f1', 1, T0);
    const f: FactoryState = { ...base, saleLedger: { a: 750 } };
    const p = player('a', { money: 100 });
    const out = runOp('tick', p, f, { seconds: 1, now: T0 });
    expect(out.player!.money).toBe(850);
    expect(out.factory!.saleLedger.a).toBeUndefined();
  });

  it('no se puede cobrar dos veces', () => {
    const base = createFactoryState('f1', 1, T0);
    const f: FactoryState = { ...base, saleLedger: { a: 750 } };
    const first = runOp('tick', player('a', { money: 0 }), f, { seconds: 1, now: T0 });
    const second = runOp('tick', first.player!, first.factory!, { seconds: 1, now: T0 + 1000 });
    expect(second.player!.money).toBe(750);
  });

  it('nadie puede cobrar la parte de otro', () => {
    const base = createFactoryState('f1', 1, T0);
    const f: FactoryState = { ...base, saleLedger: { a: 750 } };
    const out = runOp('tick', player('b', { money: 0 }), f, { seconds: 1, now: T0 });
    expect(out.player!.money).toBe(0);
    expect(out.factory!.saleLedger.a).toBe(750);
  });

  it('actuar te marca como conectado para los repartos futuros', () => {
    const out = runOp('tick', player('a'), createFactoryState('f1', 1, T0), {
      seconds: 1,
      now: T0,
    });
    expect(onlineUids(out.factory!, T0)).toContain('a');
  });
});

describe('cambio de modo', () => {
  const desplegado = (): FactoryState => ({
    ...createFactoryState('f1', 1, T0),
    level: 10,
    robots: { [HAULER.id]: robot() },
  });

  it('cambia el modo del robot', () => {
    const out = runOp('setRobotMode', player('a'), desplegado(), {
      robotId: HAULER.id,
      mode: 'sell',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.factory!.robots[HAULER.id].mode).toBe('sell');
  });

  it('al cambiar de modo reinicia el reloj', () => {
    const out = runOp('setRobotMode', player('a'), desplegado(), {
      robotId: HAULER.id,
      mode: 'off',
      now: T0 + 500_000,
    });
    expect(out.factory!.robots[HAULER.id].lastRunAt).toBe(T0 + 500_000);
  });

  it('rechaza poner "a la cinta" un robot sin destino', () => {
    const terminal = ROBOTS.find((r) => !r.to)!;
    const f: FactoryState = {
      ...createFactoryState('f1', 1, T0),
      level: 14,
      robots: { [terminal.id]: robot({ mode: 'sell' }) },
    };
    const out = runOp('setRobotMode', player('a'), f, {
      robotId: terminal.id,
      mode: 'belt',
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('rechaza robots no desplegados y modos inválidos', () => {
    expect(
      runOp('setRobotMode', player('a'), createFactoryState('f1', 1, T0), {
        robotId: HAULER.id,
        mode: 'sell',
        now: T0,
      }).ok,
    ).toBe(false);
    expect(
      runOp('setRobotMode', player('a'), desplegado(), {
        robotId: HAULER.id,
        mode: 'turbo',
        now: T0,
      }).ok,
    ).toBe(false);
  });
});

describe('cada máquina tiene su robot', () => {
  it('todas las máquinas con salida tienen un robot que la vacía', () => {
    const conRobot = new Set(ROBOTS.map((r) => r.from));
    for (const id of ['smelter', 'assembler', 'lab', 'recycler', 'alloy', 'batteryPlant', 'reactor']) {
      expect(conRobot.has(id), `${id} no tiene robot`).toBe(true);
    }
  });

  it('cada robot recoge lo que su máquina de origen produce', () => {
    for (const def of ROBOTS) {
      const from = getRobot(def.id)!;
      expect(from.item).toBeTruthy();
    }
  });

  it('los robots con destino tienen cinta declarada', () => {
    for (const def of ROBOTS) {
      if (def.to) expect(def.viaConveyor, `${def.id} sin cinta`).toBeTruthy();
    }
  });
});
