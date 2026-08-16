import { describe, expect, it } from 'vitest';
import { beltCount, beltTravelMs, getBelt, pushToBelt } from '../src/game/logic/belts';
import { settleFactory, settleRobots } from '../src/game/logic/robots';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { conveyorLoadPoint, CONVEYORS } from '../src/config/world';
import { ROBOTS, robotRate } from '../src/config/robots';
import { getMachine, MACHINE_LIST } from '../src/config/machines';
import { DEFAULT_PET, DRONE, PACK, derivePet } from '../src/config/pets';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'a', displayName: 'A', photoURL: null, email: null }, T0),
  ...over,
});

/** Todo el material que existe en la fábrica, esté donde esté. */
function totalEnFabrica(f: FactoryState, item: string, now: number): number {
  let n = 0;
  for (const m of Object.values(f.machines)) {
    n += m.input[item] ?? 0;
    n += m.output[item] ?? 0;
  }
  for (const [id, state] of Object.entries(f.belts ?? {})) {
    const def = getBelt(id);
    if (!def) continue;
    // Cuenta TODO lo que hay en la cola, haya llegado o no.
    for (const b of state.queue) if (b.item === item) n += b.qty;
    void beltCount(state, id, now);
  }
  for (const g of Object.values(f.ground ?? {})) if (g.item === item) n += g.qty;
  return n;
}

/* ─────────────── LO QUE ENTRA EN UNA CINTA SE SUMA ─────────────── */

describe('el material se acumula, nunca se pisa', () => {
  const AT = conveyorLoadPoint(getBelt('c1')!);

  const conCinta = (): FactoryState => ({ ...createFactoryState('f1', 1, T0), level: 6 });
  const cargado = (n: number) =>
    player({ inventory: { ore: n }, upgrades: { capacity: 60 } });

  it('dos cargas seguidas en la misma cinta suman', () => {
    const a = runOp('deposit', cargado(100), conCinta(), {
      machineId: 'smelter',
      beltId: 'c1',
      item: 'ore',
      qty: 10,
      at: AT,
      now: T0,
    });
    const b = runOp('deposit', a.player!, a.factory!, {
      machineId: 'smelter',
      beltId: 'c1',
      item: 'ore',
      qty: 34,
      at: AT,
      now: T0 + 1000,
    });
    expect(beltCount(b.factory!.belts.c1, 'c1', T0 + 1100)).toBe(44);
  });

  it('diez cargas seguidas suman las diez', () => {
    let p = cargado(200);
    let f = conCinta();
    for (let i = 0; i < 10; i++) {
      const out = runOp('deposit', p, f, {
        machineId: 'smelter',
        beltId: 'c1',
        item: 'ore',
        qty: 5,
        at: AT,
        now: T0 + i * 100,
      });
      expect(out.ok).toBe(true);
      p = out.player!;
      f = out.factory!;
    }
    expect(beltCount(f.belts.c1, 'c1', T0 + 1000)).toBe(50);
    // Y lo que ha salido de la mochila es exactamente lo que viaja.
    expect(p.inventory.ore).toBe(150);
  });

  it('lo que sale de la mochila entra en la cinta: ni una unidad de más ni de menos', () => {
    const antes = 100;
    const out = runOp('deposit', cargado(antes), conCinta(), {
      machineId: 'smelter',
      beltId: 'c1',
      item: 'ore',
      qty: 37,
      at: AT,
      now: T0,
    });
    const enCinta = beltCount(out.factory!.belts.c1, 'c1', T0 + 10);
    expect((out.player!.inventory.ore ?? 0) + enCinta).toBe(antes);
  });

  it('la cinta entrega en la máquina exactamente lo que llevaba', () => {
    const travel = beltTravelMs(getBelt('c1')!);
    const f: FactoryState = {
      ...conCinta(),
      belts: pushToBelt(pushToBelt({}, 'c1', 'ore', 10, T0), 'c1', 'ore', 34, T0 + 500),
    };
    const llegada = settleFactory(f, T0 + travel + 1000);
    const entregado = llegada.deliveries.reduce((a, d) => a + d.qty, 0);
    expect(entregado).toBe(44);
  });
});

/* ─────────────── ROBOTS: NADA SE PIERDE POR EL CAMINO ─────────────── */

describe('traspaso de los robots', () => {
  const HAULER = ROBOTS[0]; // fundidora → ensambladora, lingotes

  function conStock(stock: number, level = 3): FactoryState {
    const base = createFactoryState('f1', 1, T0);
    return {
      ...base,
      level: 8,
      robots: { [HAULER.id]: { level, lastRunAt: T0, moved: 0, mode: 'belt', sold: 0 } },
      machines: {
        ...base.machines,
        smelter: { ...base.machines.smelter, output: { ingot: stock } },
      },
    };
  }

  it('lo que sale de la máquina es lo que sube a la cinta', () => {
    const now = T0 + 60_000;
    const { factory: after, transfers } = settleRobots(conStock(500), now);
    const movido = transfers[0].amount;
    expect(after.machines.smelter.output.ingot).toBe(500 - movido);
    expect(beltCount(after.belts[HAULER.viaConveyor!], HAULER.viaConveyor!, now)).toBe(movido);
  });

  it('liquidaciones seguidas ACUMULAN en la cinta, no la reemplazan', () => {
    const belt = HAULER.viaConveyor!;
    // Los intervalos son cortos a propósito: así ninguna tanda llega al final
    // durante la prueba y lo que se cuenta es TODO lo que ha subido.
    const travel = beltTravelMs(getBelt(belt)!);
    let f = conStock(500);
    let esperado = 0;
    for (let i = 1; i <= 3; i++) {
      const now = T0 + i * 1000;
      const res = settleRobots(f, now);
      esperado += res.transfers[0]?.amount ?? 0;
      f = res.factory;
      expect(f.belts[belt].queue.length, 'cada tanda es una entrada nueva').toBe(i);
      expect(beltCount(f.belts[belt], belt, now)).toBe(esperado);
    }
    expect(esperado).toBe(3 * (robotRate(HAULER, 3) / 60));
    expect(T0 + 3000 - T0).toBeLessThan(travel);
  });

  it('el balance total de la fábrica no cambia al mover material', () => {
    const now = T0 + 120_000;
    const antes = totalEnFabrica(conStock(500), 'ingot', T0);
    const despues = totalEnFabrica(settleRobots(conStock(500), now).factory, 'ingot', now);
    expect(despues).toBe(antes);
  });

  it('la cadena completa no pierde ni una unidad en varias vueltas', () => {
    let f = conStock(500);
    const antes = totalEnFabrica(f, 'ingot', T0);
    for (let i = 1; i <= 12; i++) {
      f = settleFactory(f, T0 + i * 15_000).factory;
    }
    const t = T0 + 12 * 15_000;
    // Lo que la Ensambladora haya consumido se convierte en engranajes, así
    // que se cuenta la conversión: 2 lingotes = 1 engranaje.
    const lingotes = totalEnFabrica(f, 'ingot', t);
    const engranajes = totalEnFabrica(f, 'gear', t);
    const receta = getMachine('assembler').input.ingot ?? 2;
    expect(lingotes + engranajes * receta).toBe(antes);
  });

  it('cada robot entrega por una cinta que lleva a su máquina destino', () => {
    for (const def of ROBOTS) {
      if (!def.to) continue;
      const belt = CONVEYORS.find((c) => c.id === def.viaConveyor);
      expect(belt, `${def.id} sin cinta`).toBeTruthy();
      expect(belt!.feeds).toBe(def.to);
      // Y la cinta admite lo que ese robot transporta.
      if (belt!.accepts?.length) expect(belt!.accepts).toContain(def.item);
      else expect(Object.keys(getMachine(def.to).input)).toContain(def.item);
    }
  });

  it('la cinta de cada robot está abierta cuando el robot lo está', () => {
    for (const def of ROBOTS) {
      if (!def.viaConveyor) continue;
      const belt = CONVEYORS.find((c) => c.id === def.viaConveyor)!;
      expect(belt.fromLevel).toBeLessThanOrEqual(def.unlockFactoryLevel);
    }
  });

  it('toda máquina que produce algo tiene quien se lo lleve', () => {
    for (const m of MACHINE_LIST) {
      if (Object.keys(m.output).length === 0) continue;
      const robot = ROBOTS.find((r) => r.from === m.id);
      expect(robot, `${m.id} sin robot`).toBeTruthy();
    }
  });
});

/* ─────────────── DRONES ─────────────── */

describe('drones de apoyo', () => {
  const conCarga = (inv: Record<string, number>): PlayerState =>
    player({ pet: { ...DEFAULT_PET, inventory: inv, lastAt: T0, mode: 'gather' } });

  const nivel = (n: number): FactoryState => ({ ...createFactoryState('f1', 1, T0), level: n });

  it('un dron se lleva sólo su carga, el resto se queda en la mascota', () => {
    const out = runOp('petDeposit', conCarga({ ore: 50 }), nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      limit: 18,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.inventory.ore).toBe(32);
    expect(beltCount(out.factory!.belts.c1, 'c1', T0 + 10)).toBe(18);
  });

  it('viajes sucesivos vacían la mochila sin perder nada', () => {
    let p = conCarga({ ore: 50 });
    let f = nivel(6);
    let entregado = 0;
    for (let i = 0; i < 5; i++) {
      const out = runOp('petDeposit', p, f, {
        machineId: 'smelter',
        beltId: 'c1',
        limit: 18,
        now: T0 + i * 200,
      });
      if (!out.ok) break;
      entregado += Object.values(out.data!.deposited).reduce((a, b) => a + b, 0);
      p = out.player!;
      f = out.factory!;
    }
    expect(entregado).toBe(50);
    expect(p.pet.inventory.ore).toBeUndefined();
    expect(beltCount(f.belts.c1, 'c1', T0 + 1200)).toBe(50);
  });

  it('sin límite se lleva todo lo compatible, como hace la mascota', () => {
    const out = runOp('petDeposit', conCarga({ ore: 50 }), nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.player!.pet.inventory.ore).toBeUndefined();
    expect(beltCount(out.factory!.belts.c1, 'c1', T0 + 10)).toBe(50);
  });

  it('también te vacían a TI la mochila y lo llevan a la máquina', () => {
    const p = player({
      inventory: { ore: 40 },
      upgrades: { capacity: 60 },
      pet: { ...DEFAULT_PET, drones: 2, droneLevel: 1, lastAt: T0 },
    });
    const out = runOp('droneHaul', p, nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      limit: 18,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBe(22);
    expect(beltCount(out.factory!.belts.c1, 'c1', T0 + 10)).toBe(18);
    // Ni una unidad de más ni de menos.
    expect((out.player!.inventory.ore ?? 0) + 18).toBe(40);
  });

  it('sin drones comprados no te tocan nada', () => {
    const p = player({ inventory: { ore: 40 }, pet: { ...DEFAULT_PET, lastAt: T0 } });
    expect(
      runOp('droneHaul', p, nivel(6), { machineId: 'smelter', beltId: 'c1', now: T0 }).ok,
    ).toBe(false);
  });

  it('si apagas el interruptor, dejan tu mochila en paz', () => {
    const p = player({
      inventory: { ore: 40 },
      pet: { ...DEFAULT_PET, drones: 2, droneTakesPlayer: false, lastAt: T0 },
    });
    const out = runOp('droneHaul', p, nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/mochila/i);
  });

  it('nunca se llevan más de lo que cabe en un viaje, pidan lo que pidan', () => {
    const p = player({
      inventory: { ore: 500 },
      upgrades: { capacity: 200 },
      pet: { ...DEFAULT_PET, drones: 1, droneLevel: 1, lastAt: T0 },
    });
    const out = runOp('droneHaul', p, nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      limit: 99_999,
      now: T0,
    });
    // El tope real es la carga de la escuadrilla, no lo que pida el cliente.
    expect(beltCount(out.factory!.belts.c1, 'c1', T0 + 10)).toBe(DRONE.carry);
  });

  it('sólo se llevan lo que esa máquina consume', () => {
    const p = player({
      inventory: { copper: 30 },
      upgrades: { capacity: 60 },
      pet: { ...DEFAULT_PET, drones: 2, lastAt: T0 },
    });
    // La Fundidora come mineral, no cobre.
    const out = runOp('droneHaul', p, nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.ok).toBe(false);
    expect(p.inventory.copper).toBe(30);
  });

  it('la jauría multiplica ritmo y mochila, con tope de tres', () => {
    const uno = derivePet({ ...DEFAULT_PET, dogs: 1, lastAt: T0 });
    const tres = derivePet({ ...DEFAULT_PET, dogs: 3, lastAt: T0 });
    expect(tres.dogs).toBe(3);
    expect(tres.minePerSec).toBeCloseTo(uno.minePerSec * 3, 5);
    expect(tres.capacity).toBe(uno.capacity * 3);
    // Ni por documentos manipulados se pasa del tope.
    expect(derivePet({ ...DEFAULT_PET, dogs: 99, lastAt: T0 }).dogs).toBe(PACK.max);
    expect(derivePet({ ...DEFAULT_PET, dogs: 0, lastAt: T0 }).dogs).toBe(1);
  });

  it('sumar perros se cobra y se corta al llegar al máximo', () => {
    let p = player({ money: 10_000_000 });
    let f: FactoryState = createFactoryState('f1', 1, T0);
    for (let i = 1; i < PACK.max; i++) {
      const out = runOp('buyDog', p, f, { now: T0 });
      expect(out.ok).toBe(true);
      expect(out.player!.money).toBeLessThan(p.money);
      p = out.player!;
      f = out.factory!;
    }
    expect(p.pet.dogs).toBe(PACK.max);
    expect(runOp('buyDog', p, f, { now: T0 }).ok).toBe(false);
  });

  it('con más perros el servidor acepta más material por el mismo tiempo', () => {
    const conPerros = (n: number) =>
      player({ pet: { ...DEFAULT_PET, dogs: n, lastAt: T0 } });
    const uno = runOp('petMine', conPerros(1), nivel(6), {
      stationId: 'vein_a',
      qty: 9999,
      now: T0 + 10_000,
    });
    const tres = runOp('petMine', conPerros(3), nivel(6), {
      stationId: 'vein_a',
      qty: 9999,
      now: T0 + 10_000,
    });
    expect(tres.player!.pet.inventory.ore).toBeGreaterThan(uno.player!.pet.inventory.ore!);
  });

  it('un límite absurdo no crea material de la nada', () => {
    const out = runOp('petDeposit', conCarga({ ore: 7 }), nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      limit: 99_999,
      now: T0,
    });
    expect(beltCount(out.factory!.belts.c1, 'c1', T0 + 10)).toBe(7);
  });
});
