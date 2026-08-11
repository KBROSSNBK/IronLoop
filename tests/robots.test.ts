import { describe, expect, it } from 'vitest';
import { settleRobots, robotStatuses } from '../src/game/logic/robots';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { runOp } from '../src/services/backend/ops';
import { ROBOTS, robotCost, robotRate } from '../src/config/robots';
import { MACHINES } from '../src/config/machines';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;
const HAULER = ROBOTS[0]; // smelter → assembler, lingotes

function factoryWithRobot(level = 1, opts: Partial<FactoryState> = {}): FactoryState {
  const f = createFactoryState('f1', 1, T0);
  return {
    ...f,
    level: 5, // suficiente para desbloquear el robot y la ensambladora
    robots: { [HAULER.id]: { level, lastRunAt: T0, moved: 0 } },
    machines: {
      ...f.machines,
      smelter: { ...f.machines.smelter, output: { ingot: 50 } },
    },
    ...opts,
  };
}

describe('robots logísticos', () => {
  it('mueven producto de la salida de origen a la entrada de destino', () => {
    const f = factoryWithRobot();
    const oneMinute = T0 + 60_000;
    const { factory, transfers } = settleRobots(f, oneMinute);

    expect(transfers).toHaveLength(1);
    expect(transfers[0].amount).toBe(robotRate(HAULER, 1));
    expect(factory.machines.assembler.input.ingot).toBe(robotRate(HAULER, 1));
    expect(factory.machines.smelter.output.ingot).toBe(50 - robotRate(HAULER, 1));
  });

  it('nunca mueven más de lo que hay disponible', () => {
    const f = factoryWithRobot(1, {
      machines: {
        ...createFactoryState('f1', 1, T0).machines,
        smelter: { ...createFactoryState('f1', 1, T0).machines.smelter, output: { ingot: 3 } },
      },
    });
    const { factory } = settleRobots(f, T0 + 3600_000);
    expect(factory.machines.assembler.input.ingot).toBe(3);
    expect(factory.machines.smelter.output.ingot).toBeUndefined();
  });

  it('respetan la capacidad de entrada del destino', () => {
    const base = createFactoryState('f1', 1, T0);
    const cap = MACHINES.assembler.inputCap;
    const f: FactoryState = {
      ...base,
      level: 5,
      robots: { [HAULER.id]: { level: 5, lastRunAt: T0, moved: 0 } },
      machines: {
        ...base.machines,
        smelter: { ...base.machines.smelter, output: { ingot: 999 } },
        assembler: { ...base.machines.assembler, input: { ingot: cap - 2 } },
      },
    };
    const { factory } = settleRobots(f, T0 + 3600_000);
    expect(factory.machines.assembler.input.ingot).toBe(cap);
  });

  it('no crean material de la nada', () => {
    const f = factoryWithRobot();
    const before =
      (f.machines.smelter.output.ingot ?? 0) + (f.machines.assembler.input.ingot ?? 0);
    const { factory } = settleRobots(f, T0 + 600_000);
    const after =
      (factory.machines.smelter.output.ingot ?? 0) +
      (factory.machines.assembler.input.ingot ?? 0);
    expect(after).toBe(before);
  });

  it('un robot bloqueado no acumula tiempo (nada de avalanchas)', () => {
    const base = createFactoryState('f1', 1, T0);
    const sinMaterial: FactoryState = {
      ...base,
      level: 5,
      robots: { [HAULER.id]: { level: 1, lastRunAt: T0, moved: 0 } },
    };
    // Una hora parado sin material…
    const blocked = settleRobots(sinMaterial, T0 + 3600_000).factory;
    expect(blocked.robots[HAULER.id].lastRunAt).toBe(T0 + 3600_000);

    // …y al aparecer material, sólo mueve lo de un minuto, no lo de una hora.
    const withStock: FactoryState = {
      ...blocked,
      machines: {
        ...blocked.machines,
        smelter: { ...blocked.machines.smelter, output: { ingot: 999 } },
      },
    };
    const after = settleRobots(withStock, T0 + 3600_000 + 60_000).factory;
    expect(after.machines.assembler.input.ingot).toBe(robotRate(HAULER, 1));
  });

  it('el tiempo recuperable está limitado (tope anti-inflación)', () => {
    const f = factoryWithRobot(1, {
      machines: {
        ...createFactoryState('f1', 1, T0).machines,
        smelter: {
          ...createFactoryState('f1', 1, T0).machines.smelter,
          output: { ingot: 100000 },
        },
      },
    });
    const unMes = settleRobots(f, T0 + 30 * 24 * 3600_000).factory;
    const ochoHoras = settleRobots(f, T0 + 8 * 3600_000).factory;
    expect(unMes.machines.assembler.input.ingot).toBe(
      ochoHoras.machines.assembler.input.ingot,
    );
  });

  it('un robot de nivel 0 no hace nada', () => {
    const f = factoryWithRobot(0);
    const { transfers } = settleRobots(f, T0 + 3600_000);
    expect(transfers).toHaveLength(0);
  });

  it('no trabaja si su máquina de destino aún está bloqueada', () => {
    const f = factoryWithRobot(1, { level: 1 }); // ensambladora necesita nivel 3
    const { factory, transfers } = settleRobots(f, T0 + 3600_000);
    expect(transfers).toHaveLength(0);
    expect(factory.machines.assembler.input.ingot).toBeUndefined();
  });

  it('un nivel mayor transporta proporcionalmente más', () => {
    const uno = settleRobots(factoryWithRobot(1), T0 + 60_000).transfers[0].amount;
    const tres = settleRobots(factoryWithRobot(3), T0 + 60_000).transfers[0].amount;
    expect(tres).toBe(uno * 3);
  });
});

describe('compra de robots', () => {
  const player = (money: number): PlayerState => ({
    ...createPlayerState({ uid: 'u1', displayName: 'T', photoURL: null, email: null }, T0),
    money,
  });

  it('cobra el precio y despliega el robot', () => {
    const f = { ...createFactoryState('f1', 1, T0), level: 5 };
    const cost = robotCost(HAULER, 0);
    // Nivel alto para que la XP de la compra no dispare una subida de nivel,
    // cuya recompensa en dinero enmascararía el descuento.
    const rich: PlayerState = { ...player(10 ** 6), level: 40 };
    const out = runOp('buyRobot', rich, f, { robotId: HAULER.id, now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(10 ** 6 - cost);
    expect(out.factory!.robots[HAULER.id].level).toBe(1);
  });

  it('aporta al progreso compartido de la fábrica', () => {
    const f = { ...createFactoryState('f1', 1, T0), level: 5 };
    const out = runOp('buyRobot', player(10 ** 6), f, { robotId: HAULER.id, now: T0 });
    expect(out.factory!.totalContribution).toBeGreaterThan(0);
  });

  it('rechaza si la fábrica no tiene nivel suficiente', () => {
    const f = createFactoryState('f1', 1, T0);
    const out = runOp('buyRobot', player(10 ** 9), f, { robotId: HAULER.id, now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/nivel/i);
  });

  it('rechaza sin dinero', () => {
    const f = { ...createFactoryState('f1', 1, T0), level: 5 };
    const out = runOp('buyRobot', player(0), f, { robotId: HAULER.id, now: T0 });
    expect(out.ok).toBe(false);
  });

  it('rechaza robots inexistentes', () => {
    const f = { ...createFactoryState('f1', 1, T0), level: 9 };
    const out = runOp('buyRobot', player(10 ** 9), f, { robotId: 'skynet', now: T0 });
    expect(out.ok).toBe(false);
  });

  it('el segundo nivel cuesta más que el primero', () => {
    expect(robotCost(HAULER, 1)).toBeGreaterThan(robotCost(HAULER, 0));
  });
});

describe('estado para el Taller', () => {
  it('informa de por qué un robot no trabaja', () => {
    const base = createFactoryState('f1', 1, T0);

    const bloqueado = robotStatuses(base).find((r) => r.def.id === HAULER.id)!;
    expect(bloqueado.status).toBe('locked');

    const sinMaterial = robotStatuses({
      ...base,
      level: 5,
      robots: { [HAULER.id]: { level: 1, lastRunAt: T0, moved: 0 } },
    }).find((r) => r.def.id === HAULER.id)!;
    expect(sinMaterial.status).toBe('no-source');

    const trabajando = robotStatuses(factoryWithRobot()).find((r) => r.def.id === HAULER.id)!;
    expect(trabajando.status).toBe('working');
  });
});

describe('integración: los robots se liquidan en cada operación', () => {
  it('el material movido ya está colocado cuando el jugador interactúa', () => {
    const f = factoryWithRobot();
    const p = createPlayerState({ uid: 'u1', displayName: 'T', photoURL: null, email: null }, T0);
    // El jugador recoge de la ensambladora un minuto después: el robot ya
    // habrá llenado su entrada aunque nadie estuviera conectado.
    const out = runOp('collect', p, f, { machineId: 'smelter', now: T0 + 60_000 });
    expect(out.ok).toBe(true);
    expect(out.factory!.machines.assembler.input.ingot).toBe(robotRate(HAULER, 1));
  });
});
