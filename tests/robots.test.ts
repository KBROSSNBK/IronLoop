import { describe, expect, it } from 'vitest';
import { settleFactory, settleRobots, robotStatuses } from '../src/game/logic/robots';
import { beltCount, beltTravelMs, getBelt } from '../src/game/logic/belts';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { runOp } from '../src/services/backend/ops';
import { ROBOTS, robotCarry, robotCost, robotRate, robotTripMs } from '../src/config/robots';
import { MACHINES } from '../src/config/machines';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;
const HAULER = ROBOTS[0]; // smelter → assembler, lingotes
/** Cinta por la que entrega: el material viaja por ella, no se teletransporta. */
const BELT = HAULER.viaConveyor!;

/** Unidades que este robot ha puesto a viajar por su cinta. */
const enCinta = (f: FactoryState, now: number) => beltCount(f.belts?.[BELT], BELT, now);

/** Adelanta hasta que la cinta ha terminado de entregar. */
const trasLaCinta = (f: FactoryState, now: number) =>
  settleFactory(f, now + beltTravelMs(getBelt(BELT)!) + 500);

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
  it('sacan el producto de la máquina y lo suben a SU cinta', () => {
    const f = factoryWithRobot();
    const oneMinute = T0 + 60_000;
    const { factory, transfers } = settleRobots(f, oneMinute);

    expect(transfers).toHaveLength(1);
    expect(transfers[0].amount).toBe(robotRate(HAULER, 1));
    expect(factory.machines.smelter.output.ingot).toBe(50 - robotRate(HAULER, 1));
    // El material está viajando, no ha aparecido por arte de magia al final.
    expect(enCinta(factory, oneMinute)).toBe(robotRate(HAULER, 1));
    expect(factory.machines.assembler.input.ingot).toBeUndefined();
  });

  it('la cinta acaba entregándolo en la máquina de destino', () => {
    const oneMinute = T0 + 60_000;
    const { factory } = settleRobots(factoryWithRobot(), oneMinute);
    const llegada = trasLaCinta(factory, oneMinute);
    expect(
      llegada.deliveries.some((d) => d.beltId === BELT && d.qty === robotRate(HAULER, 1)),
    ).toBe(true);
  });

  it('nunca mueven más de lo que hay disponible', () => {
    const f = factoryWithRobot(1, {
      machines: {
        ...createFactoryState('f1', 1, T0).machines,
        smelter: { ...createFactoryState('f1', 1, T0).machines.smelter, output: { ingot: 3 } },
      },
    });
    const { factory } = settleRobots(f, T0 + 3600_000);
    expect(enCinta(factory, T0 + 3600_000)).toBe(3);
    expect(factory.machines.smelter.output.ingot).toBeUndefined();
  });

  it('la cinta no tiene tope: se lleva todo lo que el robot saque', () => {
    const base = createFactoryState('f1', 1, T0);
    const cap = MACHINES.assembler.inputCap;
    const f: FactoryState = {
      ...base,
      level: 5,
      robots: { [HAULER.id]: { level: 5, lastRunAt: T0, moved: 0 } },
      machines: {
        ...base.machines,
        smelter: { ...base.machines.smelter, output: { ingot: 999 } },
        assembler: { ...base.machines.assembler, input: { ingot: cap } },
      },
    };
    const { factory } = settleRobots(f, T0 + 60_000);
    // Lo que ya había en la máquina se queda donde estaba…
    expect(factory.machines.assembler.input.ingot).toBe(cap);
    // …y lo del robot viaja por la cinta sin límite alguno.
    expect(enCinta(factory, T0 + 60_000)).toBe(robotRate(HAULER, 5));
  });

  it('no crean material de la nada', () => {
    const f = factoryWithRobot();
    const before =
      (f.machines.smelter.output.ingot ?? 0) + (f.machines.assembler.input.ingot ?? 0);
    const now = T0 + 600_000;
    const { factory } = settleRobots(f, now);
    // Cuenta también lo que va por la cinta: ahí es donde está el material.
    const after =
      (factory.machines.smelter.output.ingot ?? 0) +
      (factory.machines.assembler.input.ingot ?? 0) +
      enCinta(factory, now);
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
    const cuando = T0 + 3600_000 + 60_000;
    const after = settleRobots(withStock, cuando).factory;
    expect(enCinta(after, cuando)).toBe(robotRate(HAULER, 1));
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
    const mes = T0 + 30 * 24 * 3600_000;
    const ocho = T0 + 8 * 3600_000;
    const unMes = settleRobots(f, mes).factory;
    const ochoHoras = settleRobots(f, ocho).factory;
    expect(enCinta(unMes, mes)).toBe(enCinta(ochoHoras, ocho));
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
    expect(enCinta(factory, T0 + 3600_000)).toBe(0);
  });

  it('un nivel mayor transporta proporcionalmente más', () => {
    // Stock de sobra: si no, el tope sería el material, no el nivel.
    const conStock = (level: number) => {
      const base = createFactoryState('f1', 1, T0);
      return factoryWithRobot(level, {
        machines: {
          ...base.machines,
          smelter: { ...base.machines.smelter, output: { ingot: 100000 } },
        },
      });
    };
    const uno = settleRobots(conStock(1), T0 + 60_000).transfers[0].amount;
    const tres = settleRobots(conStock(3), T0 + 60_000).transfers[0].amount;
    expect(tres).toBe(uno * 3);
  });

  it('la carga por viaje sube al mejorar el robot', () => {
    const l1 = robotCarry(HAULER, 1);
    const l5 = robotCarry(HAULER, 5);
    expect(l1).toBeGreaterThan(0);
    expect(l5).toBeGreaterThan(l1);
    expect(robotCarry(HAULER, 0)).toBe(0);
  });

  it('la carga por viaje es coherente con el caudal por minuto', () => {
    for (const level of [1, 3, 10]) {
      const viajesPorMin = 60000 / robotTripMs(HAULER);
      const esperado = robotRate(HAULER, level) / viajesPorMin;
      // Redondeo a unidades enteras, con margen de una unidad.
      expect(Math.abs(robotCarry(HAULER, level) - esperado)).toBeLessThanOrEqual(1);
    }
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
  it('el robot ya ha trabajado cuando el jugador interactúa', () => {
    const f = factoryWithRobot();
    const p = createPlayerState({ uid: 'u1', displayName: 'T', photoURL: null, email: null }, T0);
    // El jugador recoge de la fundidora un minuto después: el robot ya habrá
    // puesto material en la cinta aunque nadie estuviera conectado.
    const now = T0 + 60_000;
    const out = runOp('collect', p, f, { machineId: 'smelter', now });
    expect(out.ok).toBe(true);
    expect(enCinta(out.factory!, now)).toBe(robotRate(HAULER, 1));
  });
});
