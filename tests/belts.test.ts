import { describe, expect, it } from 'vitest';
import { getMachine } from '../src/config/machines';
import {
  beltCount,
  beltItems,
  beltTravelMs,
  beltsInTransit,
  getBelt,
  pushToBelt,
  settleBelts,
} from '../src/game/logic/belts';
import { settleFactory } from '../src/game/logic/robots';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { runOp } from '../src/services/backend/ops';
import { conveyorLoadPoint } from '../src/config/world';
import type { FactoryState, PlayerState } from '../src/types';

/** Punto justo delante de una máquina: cargar y retirar exigen estar ahí. */
const AT = (id: string) => {
  const m = getMachine(id);
  return { x: (m.tx + m.tw / 2) * 40, y: (m.ty + m.th + 0.4) * 40 };
};

/** Extremo de carga de una cinta: por ahí se le echa el material. */
const EN_CINTA = (id: string) => conveyorLoadPoint(getBelt(id)!);

const T0 = 1_700_000_000_000;
const BELT = 'c6'; // bajante de cristal → laboratorio

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'u1', displayName: 'T', photoURL: null, email: null }, T0),
  ...over,
});

const factory = (over: Partial<FactoryState> = {}): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  level: 10,
  ...over,
});

describe('material viajando por la cinta', () => {
  it('el material entra en la cinta, no directo en la máquina', () => {
    const p = player({ inventory: { crystal: 30 } });
    const out = runOp('deposit', p, factory(), {
      machineId: 'lab',
      at: EN_CINTA(BELT),
      beltId: BELT,
      item: 'crystal',
      qty: 30,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.crystal).toBeUndefined();
    // Todavía no ha llegado: la máquina sigue vacía.
    expect(out.factory!.machines.lab.input.crystal).toBeUndefined();
    expect(beltCount(out.factory!.belts[BELT], BELT, T0)).toBe(30);
  });

  it('llega a la máquina cuando termina el recorrido', () => {
    const travel = beltTravelMs(getBelt(BELT)!);
    const f = factory({ belts: pushToBelt({}, BELT, 'crystal', 12, T0) });

    const antes = settleBelts(f, T0 + travel - 50);
    expect(antes.deliveries).toHaveLength(0);
    expect(antes.factory.machines.lab.input.crystal).toBeUndefined();

    const despues = settleBelts(f, T0 + travel + 10);
    expect(despues.deliveries).toHaveLength(1);
    expect(despues.factory.machines.lab.input.crystal).toBe(12);
    expect(beltCount(despues.factory.belts[BELT], BELT, T0 + travel + 10)).toBe(0);
  });

  it('el contador refleja el material REAL en tránsito', () => {
    let belts = pushToBelt({}, BELT, 'crystal', 5, T0);
    belts = pushToBelt(belts, BELT, 'crystal', 3, T0 + 200);
    expect(beltCount(belts[BELT], BELT, T0 + 300)).toBe(8);

    // Cuando la primera tanda llega, el contador baja.
    const travel = beltTravelMs(getBelt(BELT)!);
    expect(beltCount(belts[BELT], BELT, T0 + travel + 10)).toBe(3);
  });

  it('dibuja un bulto por unidad, repartidos por la cinta', () => {
    const belts = pushToBelt({}, BELT, 'crystal', 4, T0);
    const travel = beltTravelMs(getBelt(BELT)!);
    const items = beltItems(BELT, belts[BELT], T0 + travel * 0.6);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
    for (const it of items) {
      expect(it.item).toBe('crystal');
      expect(it.t).toBeGreaterThanOrEqual(0);
      expect(it.t).toBeLessThanOrEqual(1);
    }
    // Están separados entre sí, no amontonados en el mismo punto.
    if (items.length > 1) {
      const d = Math.hypot(items[0].x - items[1].x, items[0].y - items[1].y);
      expect(d).toBeGreaterThan(10);
    }
  });

  it('el material avanza con el tiempo', () => {
    const belts = pushToBelt({}, BELT, 'crystal', 1, T0);
    const travel = beltTravelMs(getBelt(BELT)!);
    const a = beltItems(BELT, belts[BELT], T0 + travel * 0.2)[0];
    const b = beltItems(BELT, belts[BELT], T0 + travel * 0.7)[0];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(b.t).toBeGreaterThan(a.t);
  });

  it('no se pierde ni se duplica material en el trayecto', () => {
    const f = factory({ belts: pushToBelt({}, BELT, 'crystal', 25, T0) });
    const travel = beltTravelMs(getBelt(BELT)!);
    const out = settleBelts(f, T0 + travel + 1);
    const total =
      (out.factory.machines.lab.input.crystal ?? 0) +
      beltCount(out.factory.belts[BELT], BELT, T0 + travel + 1);
    expect(total).toBe(25);
  });

  it('la liquidación completa entrega y luego produce', () => {
    const travel = beltTravelMs(getBelt(BELT)!);
    const f = factory({
      belts: pushToBelt({}, BELT, 'crystal', 4, T0),
      machines: {
        ...factory().machines,
        lab: { level: 0, cycles: 0, cycleStartAt: 0, input: { gear: 20 }, output: {} },
      },
    });
    const out = settleFactory(f, T0 + travel + 100);
    expect(out.deliveries.length).toBeGreaterThan(0);
    // Con cristal y engranajes ya puede arrancar.
    expect(out.factory.machines.lab.cycleStartAt).toBeGreaterThan(0);
  });

  it('una cinta con filtro rechaza el material que no le toca', () => {
    const p = player({ inventory: { gear: 20 } });
    const out = runOp('deposit', p, factory(), {
      machineId: 'lab',
      at: EN_CINTA(BELT),
      beltId: BELT, // sólo acepta cristal
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('rechaza una cinta que no lleva a esa máquina', () => {
    const p = player({ inventory: { ore: 20 } });
    const out = runOp('deposit', p, factory(), {
      machineId: 'smelter', at: AT('smelter'),
      beltId: BELT,
      now: T0,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/cinta/i);
  });

  it('el total en tránsito suma todas las cintas', () => {
    let belts = pushToBelt({}, 'c1', 'ore', 6, T0);
    belts = pushToBelt(belts, BELT, 'crystal', 4, T0);
    expect(beltsInTransit(factory({ belts }), T0 + 100)).toBe(10);
  });

  it('una fábrica sin cintas no rompe nada', () => {
    const f = createFactoryState('f1', 1, T0);
    const out = settleBelts(f, T0 + 10_000);
    expect(out.deliveries).toHaveLength(0);
    expect(out.factory).toBe(f);
  });
});
