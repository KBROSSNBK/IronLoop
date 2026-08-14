import { describe, expect, it } from 'vitest';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { BALANCE } from '../src/config/balance';
import { STATIONS } from '../src/config/world';
import { machineContents } from '../src/game/logic/production';
import type { FactoryState, GroundItem, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;
const AT = { x: 800, y: 900 };

const mkPlayer = (uid: string, over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid, displayName: uid, photoURL: null, email: null }, T0),
  ...over,
});

const mkFactory = (over: Partial<FactoryState> = {}): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  ...over,
});

const groundItem = (over: Partial<GroundItem> = {}): GroundItem => ({
  id: 'g1',
  item: 'ore',
  qty: 10,
  x: AT.x,
  y: AT.y,
  by: 'someone',
  droppedAt: T0,
  ...over,
});

/* ─────────────────────── retirar de una máquina ─────────────────────── */

describe('opWithdraw — extraer material de una máquina', () => {
  const withStock = (input: Record<string, number>, output: Record<string, number> = {}) =>
    mkFactory({
      level: 6,
      machines: {
        ...createFactoryState('f1', 1, T0).machines,
        lab: { level: 0, cycles: 0, cycleStartAt: 0, input, output },
      },
    });

  it('mueve el material de la máquina al inventario', () => {
    const f = withStock({ gear: 20, crystal: 5 });
    const out = runOp('withdraw', mkPlayer('u1'), f, {
      machineId: 'lab',
      item: 'gear',
      qty: 4,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.gear).toBe(4);
    expect(out.factory!.machines.lab.input.gear).toBe(16);
  });

  it('permite recuperar material atascado que la receta no puede usar', () => {
    // Hay engranajes pero falta cristal: la producción no avanza.
    const f = withStock({ gear: 30 });
    const out = runOp('withdraw', mkPlayer('u1'), f, {
      machineId: 'lab',
      item: 'gear',
      qty: 30,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.gear).toBe(10); // limitado por el inventario
    expect(out.factory!.machines.lab.input.gear).toBe(20);
  });

  it('si no cabe todo, retira sólo lo que quepa y no pierde nada', () => {
    const f = withStock({ gear: 50 });
    const p = mkPlayer('u1', { inventory: { ore: 7 } }); // 3 huecos libres de 10
    const out = runOp('withdraw', mkPlayer('u1', p), f, {
      machineId: 'lab',
      item: 'gear',
      qty: 50,
      now: T0,
    });
    expect(out.player!.inventory.gear).toBe(3);
    expect(out.factory!.machines.lab.input.gear).toBe(47);
    const total = 50;
    expect(
      (out.factory!.machines.lab.input.gear ?? 0) + (out.player!.inventory.gear ?? 0),
    ).toBe(total);
  });

  it('rechaza si el inventario está lleno', () => {
    const f = withStock({ gear: 10 });
    const p = mkPlayer('u1', { inventory: { ore: 10 } });
    const out = runOp('withdraw', p, f, { machineId: 'lab', item: 'gear', qty: 1, now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/lleno/i);
  });

  it('rechaza material que la máquina no tiene', () => {
    const f = withStock({ gear: 10 });
    const out = runOp('withdraw', mkPlayer('u1'), f, {
      machineId: 'lab',
      item: 'circuit',
      qty: 1,
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('vacía primero la salida, que es lo que el jugador espera llevarse', () => {
    const f = withStock({ gear: 10 }, { circuit: 3 });
    const out = runOp('withdraw', mkPlayer('u1'), f, {
      machineId: 'lab',
      item: 'circuit',
      qty: 3,
      now: T0,
    });
    expect(out.player!.inventory.circuit).toBe(3);
    expect(out.factory!.machines.lab.output.circuit).toBeUndefined();
  });

  it('rechaza cantidades inválidas', () => {
    const f = withStock({ gear: 10 });
    for (const qty of [0, -5, Number.NaN]) {
      const out = runOp('withdraw', mkPlayer('u1'), f, {
        machineId: 'lab',
        item: 'gear',
        qty,
        now: T0,
      });
      expect(out.ok).toBe(false);
    }
  });

  it('machineContents suma entrada y salida', () => {
    const c = machineContents({ level: 0, cycles: 0, cycleStartAt: 0, input: { gear: 4 }, output: { gear: 2, circuit: 1 } });
    expect(c).toEqual({ gear: 6, circuit: 1 });
  });
});

/* ─────────────────────── soltar al suelo ─────────────────────── */

describe('opDropItem — soltar objetos', () => {
  it('saca el material del inventario y lo deja en el suelo', () => {
    const p = mkPlayer('u1', { inventory: { ore: 8 } });
    const out = runOp('dropItem', p, mkFactory(), { item: 'ore', qty: 5, at: AT, now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBe(3);
    const drops = Object.values(out.factory!.ground);
    expect(drops).toHaveLength(1);
    expect(drops[0].qty).toBe(5);
    expect(drops[0].item).toBe('ore');
  });

  it('soltar todo vacía esa entrada del inventario', () => {
    const p = mkPlayer('u1', { inventory: { ore: 4 } });
    const out = runOp('dropItem', p, mkFactory(), { item: 'ore', qty: 4, at: AT, now: T0 });
    expect(out.player!.inventory.ore).toBeUndefined();
  });

  it('nunca suelta más de lo que se lleva', () => {
    const p = mkPlayer('u1', { inventory: { ore: 3 } });
    const out = runOp('dropItem', p, mkFactory(), { item: 'ore', qty: 999, at: AT, now: T0 });
    expect(Object.values(out.factory!.ground)[0].qty).toBe(3);
    expect(out.player!.inventory.ore).toBeUndefined();
  });

  it('rechaza soltar lo que no se tiene', () => {
    const out = runOp('dropItem', mkPlayer('u1'), mkFactory(), {
      item: 'circuit',
      qty: 1,
      at: AT,
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('varios objetos generan montones distintos', () => {
    let p = mkPlayer('u1', { inventory: { ore: 5, ingot: 5 } });
    let f = mkFactory();
    for (const item of ['ore', 'ingot']) {
      const out = runOp('dropItem', p, f, { item, qty: 2, at: AT, now: T0 });
      p = out.player!;
      f = out.factory!;
    }
    expect(Object.keys(f.ground)).toHaveLength(2);
  });

  it('limita cuántas cosas puede haber tiradas a la vez', () => {
    const ground: Record<string, GroundItem> = {};
    for (let i = 0; i < BALANCE.ground.maxItems; i++) {
      ground[`g${i}`] = groundItem({ id: `g${i}`, droppedAt: T0 });
    }
    const p = mkPlayer('u1', { inventory: { ore: 5 } });
    const out = runOp('dropItem', p, mkFactory({ ground }), {
      item: 'ore',
      qty: 1,
      at: AT,
      now: T0,
    });
    expect(out.ok).toBe(false);
  });
});

/* ─────────────────────── recoger del suelo ─────────────────────── */

describe('opPickupGround — recoger objetos', () => {
  const withGround = (g: Partial<GroundItem> = {}) =>
    mkFactory({ ground: { g1: groundItem(g) } });

  it('pasa el montón entero al inventario si cabe', () => {
    const out = runOp('pickupGround', mkPlayer('u1'), withGround({ qty: 6 }), {
      groundId: 'g1',
      at: AT,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBe(6);
    expect(out.factory!.ground.g1).toBeUndefined();
  });

  it('recoge sólo lo que cabe y deja el resto en el suelo', () => {
    const p = mkPlayer('u1', { inventory: { ingot: 7 } }); // 3 huecos
    const out = runOp('pickupGround', p, withGround({ qty: 10 }), {
      groundId: 'g1',
      at: AT,
      now: T0,
    });
    expect(out.player!.inventory.ore).toBe(3);
    expect(out.factory!.ground.g1.qty).toBe(7);
  });

  it('rechaza si el inventario está lleno', () => {
    const p = mkPlayer('u1', { inventory: { ingot: 10 } });
    const out = runOp('pickupGround', p, withGround(), { groundId: 'g1', at: AT, now: T0 });
    expect(out.ok).toBe(false);
  });

  it('rechaza si el jugador está lejos', () => {
    const out = runOp('pickupGround', mkPlayer('u1'), withGround(), {
      groundId: 'g1',
      at: { x: AT.x + 900, y: AT.y },
      now: T0,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/lejos/i);
  });

  it('dos jugadores no pueden duplicar el mismo montón', () => {
    const f = withGround({ qty: 6 });
    const first = runOp('pickupGround', mkPlayer('a'), f, { groundId: 'g1', at: AT, now: T0 });
    // El segundo actúa sobre el estado YA actualizado por el primero.
    const second = runOp('pickupGround', mkPlayer('b'), first.factory!, {
      groundId: 'g1',
      at: AT,
      now: T0,
    });
    expect(first.ok).toBe(true);
    expect(first.player!.inventory.ore).toBe(6);
    expect(second.ok).toBe(false);
  });

  it('con reparto parcial, entre los dos recogen exactamente el montón', () => {
    const f = withGround({ qty: 12 });
    const a = mkPlayer('a', { inventory: { ingot: 5 } }); // 5 huecos
    const first = runOp('pickupGround', a, f, { groundId: 'g1', at: AT, now: T0 });
    const second = runOp('pickupGround', mkPlayer('b'), first.factory!, {
      groundId: 'g1',
      at: AT,
      now: T0,
    });
    const total =
      (first.player!.inventory.ore ?? 0) +
      (second.player!.inventory.ore ?? 0) +
      (second.factory!.ground.g1?.qty ?? 0);
    expect(total).toBe(12);
  });

  it('rechaza montones inexistentes', () => {
    const out = runOp('pickupGround', mkPlayer('u1'), mkFactory(), {
      groundId: 'fantasma',
      at: AT,
      now: T0,
    });
    expect(out.ok).toBe(false);
  });
});

/* ─────────────────────── basurero ─────────────────────── */

describe('opTrashItem — basurero', () => {
  it('elimina el material sin dar dinero', () => {
    const p = mkPlayer('u1', { inventory: { ore: 25 }, money: 500 });
    const out = runOp('trashItem', p, mkFactory(), { item: 'ore', qty: 25, now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBeUndefined();
    expect(out.player!.money).toBe(500);
  });

  it('elimina sólo la cantidad indicada', () => {
    const p = mkPlayer('u1', { inventory: { ore: 25 } });
    const out = runOp('trashItem', p, mkFactory(), { item: 'ore', qty: 10, now: T0 });
    expect(out.player!.inventory.ore).toBe(15);
  });

  it('no deja tirar más de lo que se lleva', () => {
    const p = mkPlayer('u1', { inventory: { ore: 3 } });
    const out = runOp('trashItem', p, mkFactory(), { item: 'ore', qty: 999, now: T0 });
    expect(out.player!.inventory.ore).toBeUndefined();
  });

  it('rechaza lo que no se tiene y cantidades inválidas', () => {
    expect(runOp('trashItem', mkPlayer('u1'), mkFactory(), { item: 'ore', qty: 1, now: T0 }).ok).toBe(false);
    const p = mkPlayer('u1', { inventory: { ore: 5 } });
    expect(runOp('trashItem', p, mkFactory(), { item: 'ore', qty: 0, now: T0 }).ok).toBe(false);
  });
});

/* ─────────────────────── zona de RECOLECCIÓN ─────────────────────── */

describe('zona de RECOLECCIÓN', () => {
  it('existe con sus estaciones y rinde chatarra', () => {
    const salvage = STATIONS.filter((s) => s.type === 'salvage');
    expect(salvage.length).toBeGreaterThan(0);
    for (const s of salvage) expect(s.yields?.[0].item).toBe('scrap');
  });

  it('usa la misma mecánica de extracción y el mismo inventario', () => {
    const out = runOp('gather', mkPlayer('u1'), mkFactory(), {
      stationId: 'salvage_a',
      now: T0,
      rand: () => 0.99,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.scrap).toBeGreaterThan(0);
    expect(out.factory!.stats.gathered).toBeGreaterThan(0);
  });

  it('rinde más unidades por acción que una veta normal', () => {
    const chatarra = runOp('gather', mkPlayer('u1'), mkFactory(), {
      stationId: 'salvage_a',
      now: T0,
      rand: () => 0.99,
    });
    const mineral = runOp('gather', mkPlayer('u1'), mkFactory(), {
      stationId: 'vein_a',
      now: T0,
      rand: () => 0.99,
    });
    expect(chatarra.player!.inventory.scrap).toBeGreaterThan(mineral.player!.inventory.ore!);
  });
});

/* ───────────────── el ciclo completo no crea ni pierde material ───────────────── */

describe('conservación de material en el ciclo completo', () => {
  it('extraer → soltar → recoger otro jugador → vender conserva las cantidades', () => {
    let f = mkFactory();
    // A extrae
    const gathered = runOp('gather', mkPlayer('a'), f, {
      stationId: 'vein_a',
      now: T0,
      rand: () => 0.99,
    });
    f = gathered.factory!;
    const cantidad = gathered.player!.inventory.ore!;

    // A lo suelta
    const dropped = runOp('dropItem', gathered.player!, f, {
      item: 'ore',
      qty: cantidad,
      at: AT,
      now: T0,
    });
    f = dropped.factory!;
    expect(dropped.player!.inventory.ore).toBeUndefined();

    // B lo recoge
    const gid = Object.keys(f.ground)[0];
    const picked = runOp('pickupGround', mkPlayer('b'), f, { groundId: gid, at: AT, now: T0 });
    f = picked.factory!;
    expect(picked.player!.inventory.ore).toBe(cantidad);
    expect(Object.keys(f.ground)).toHaveLength(0);

    // B lo vende en el muelle
    const sold = runOp('sell', picked.player!, f, { at: AT, now: T0 });
    expect(sold.ok).toBe(true);
    expect(sold.player!.inventory.ore).toBeUndefined();
    expect(sold.player!.money).toBeGreaterThan(picked.player!.money);
  });
});
