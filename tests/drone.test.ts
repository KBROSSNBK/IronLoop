import { describe, expect, it } from 'vitest';
import { manifestTop, manifestUnits, planHaul, shareCarry } from '../src/game/logic/drone';
import { DRONE, DEFAULT_PET, PACK, deriveDrones, droneSlots } from '../src/config/pets';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { getBelt, beltCount } from '../src/game/logic/belts';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;
const ORIGEN = { x: 800, y: 600 };

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'u1', displayName: 'T', photoURL: null, email: null }, T0),
  ...over,
});

const factory = (over: Partial<FactoryState> = {}): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  level: 12,
  ...over,
});

/* ───────────────────────── REPARTO DE LA BODEGA ───────────────────────── */

describe('qué se lleva un dron en cada viaje', () => {
  it('siempre saca AL MENOS una unidad de cada material', () => {
    // El caso que se rompía: 300 piedras y 1 diamante. Antes el dron sólo
    // movía el montón grande y el diamante se quedaba criando polvo.
    const reparto = shareCarry(
      [
        { item: 'ore', qty: 300 },
        { item: 'crystal', qty: 1 },
        { item: 'copper', qty: 2 },
      ],
      18,
    );
    expect(reparto.crystal).toBe(1);
    expect(reparto.copper).toBeGreaterThanOrEqual(1);
    expect(reparto.ore).toBeGreaterThan(1);
  });

  it('nunca se pasa de lo que puede cargar', () => {
    for (const carry of [1, 2, 5, 18, 97]) {
      const reparto = shareCarry(
        [
          { item: 'ore', qty: 40 },
          { item: 'scrap', qty: 13 },
          { item: 'copper', qty: 7 },
        ],
        carry,
      );
      expect(manifestUnits(reparto)).toBeLessThanOrEqual(carry);
    }
  });

  it('nunca se lleva más de lo que hay', () => {
    const reparto = shareCarry(
      [
        { item: 'ore', qty: 3 },
        { item: 'crystal', qty: 2 },
      ],
      99,
    );
    expect(reparto.ore).toBe(3);
    expect(reparto.crystal).toBe(2);
  });

  it('con hueco de sobra se lleva la mochila entera', () => {
    const stacks = [
      { item: 'ore', qty: 9 },
      { item: 'copper', qty: 4 },
      { item: 'crystal', qty: 1 },
    ];
    expect(manifestUnits(shareCarry(stacks, 500))).toBe(14);
  });

  it('el icono que cuelga es el del material del que más lleva', () => {
    expect(manifestTop({ ore: 2, crystal: 9 })).toBe('crystal');
    expect(manifestTop({})).toBeNull();
  });
});

/* ───────────────────────────── LA RUTA ───────────────────────────── */

describe('ruta de reparto', () => {
  it('agrupa por destino y reparte de TODO, no un solo material', () => {
    const ruta = planHaul({ ore: 30, copper: 10, crystal: 3 }, 40, 12, ORIGEN);
    expect(ruta.length).toBeGreaterThan(1);

    const llevado: Record<string, number> = {};
    for (const stop of ruta) {
      for (const [item, qty] of Object.entries(stop.items)) {
        llevado[item] = (llevado[item] ?? 0) + qty;
      }
      // Cada parada declara bien sus unidades.
      expect(stop.units).toBe(manifestUnits(stop.items));
    }
    // El cristal, que es el montón pequeño, también sale.
    expect(llevado.crystal).toBeGreaterThan(0);
    expect(llevado.ore).toBeGreaterThan(0);
    expect(llevado.copper).toBeGreaterThan(0);
  });

  it('ignora lo que no tiene a dónde ir', () => {
    // A fábrica nivel 1 no hay Recicladora ni Aleaciones: la chatarra y el
    // cobre no tienen destino, pero el mineral sí.
    const ruta = planHaul({ ore: 10, scrap: 10, copper: 10 }, 30, 1, ORIGEN);
    const llevado = ruta.flatMap((s) => Object.keys(s.items));
    expect(llevado).toContain('ore');
    expect(llevado).not.toContain('scrap');
    expect(llevado).not.toContain('copper');
  });

  it('sin nada que mover, no hay viaje', () => {
    expect(planHaul({}, 20, 12, ORIGEN)).toHaveLength(0);
    expect(planHaul({ ore: 0 }, 20, 12, ORIGEN)).toHaveLength(0);
  });

  it('la ruta empieza por la parada más cercana', () => {
    const ruta = planHaul({ ore: 20, crystal: 5, copper: 8 }, 40, 12, ORIGEN);
    if (ruta.length < 2) return;
    const d0 = Math.hypot(ruta[0].bay.x - ORIGEN.x, ruta[0].bay.y - ORIGEN.y);
    for (const stop of ruta.slice(1)) {
      const d = Math.hypot(stop.bay.x - ORIGEN.x, stop.bay.y - ORIGEN.y);
      expect(d0).toBeLessThanOrEqual(d + 1);
    }
  });
});

/* ──────────────────── UN DRON POR PERRO, MÁS EL TUYO ──────────────────── */

describe('la escuadrilla va en dúo', () => {
  it('el tope de drones es un perro + uno, nunca más', () => {
    expect(droneSlots({ ...DEFAULT_PET, dogs: 1 })).toBe(2);
    expect(droneSlots({ ...DEFAULT_PET, dogs: 3 })).toBe(4);
    expect(DRONE.max).toBe(PACK.max + 1);
  });

  it('no se puede comprar el tercer dron con un solo perro', () => {
    let p = player({ money: 10_000_000 });
    const f = factory();
    for (let i = 0; i < 2; i++) {
      const out = runOp('buyDrone', p, f, { now: T0 });
      expect(out.ok).toBe(true);
      p = out.player!;
    }
    const tercero = runOp('buyDrone', p, f, { now: T0 });
    expect(tercero.ok).toBe(false);
    expect(tercero.reason).toMatch(/perro/i);

    // Con otro perro, sí.
    const conPerro = { ...p, pet: { ...p.pet, dogs: 2 } };
    expect(runOp('buyDrone', conPerro, f, { now: T0 }).ok).toBe(true);
  });

  it('subir de nivel da más carga y más velocidad a todos', () => {
    const base = deriveDrones({ ...DEFAULT_PET, drones: 2, droneLevel: 1 });
    const mejor = deriveDrones({ ...DEFAULT_PET, drones: 2, droneLevel: 5 });
    expect(mejor.carry).toBeGreaterThan(base.carry);
    expect(mejor.speed).toBeGreaterThan(base.speed);
  });
});

/* ───────────────── EL TRASPASO NO PIERDE NI UNA UNIDAD ───────────────── */

describe('el dron entrega exactamente lo que carga', () => {
  it('te vacía la mochila material a material, sin perder nada', () => {
    const inicial = { ore: 12, scrap: 8 };
    const p = player({
      inventory: { ...inicial },
      pet: { ...DEFAULT_PET, drones: 1, lastAt: T0 },
    });
    const out = runOp('droneHaul', p, factory(), {
      machineId: 'smelter',
      items: { ore: 5 },
      limit: 5,
      now: T0,
    });
    expect(out.ok).toBe(true);
    // Sale lo pedido y sólo lo pedido: la chatarra ni se toca.
    expect(out.player!.inventory.ore).toBe(7);
    expect(out.player!.inventory.scrap).toBe(8);
    expect(out.factory!.machines.smelter.input.ore).toBe(5);
  });

  it('por cinta el material viaja, no aparece de golpe en la máquina', () => {
    const p = player({
      inventory: { ore: 20 },
      pet: { ...DEFAULT_PET, drones: 1, lastAt: T0 },
    });
    const out = runOp('droneHaul', p, factory(), {
      machineId: 'smelter',
      beltId: 'c1',
      items: { ore: 9 },
      limit: 9,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBe(11);
    expect(out.factory!.machines.smelter.input.ore).toBeUndefined();
    expect(beltCount(out.factory!.belts.c1, 'c1', T0)).toBe(9);
    expect(getBelt('c1')!.feeds).toBe('smelter');
  });

  it('no cuela material que la máquina no admita', () => {
    const p = player({
      inventory: { gear: 10 },
      pet: { ...DEFAULT_PET, drones: 1, lastAt: T0 },
    });
    const out = runOp('droneHaul', p, factory(), {
      machineId: 'smelter',
      items: { gear: 10 },
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('si has apagado que te vacíen, no te tocan la mochila', () => {
    const p = player({
      inventory: { ore: 10 },
      pet: { ...DEFAULT_PET, drones: 1, droneTakesPlayer: false, lastAt: T0 },
    });
    const out = runOp('droneHaul', p, factory(), {
      machineId: 'smelter',
      items: { ore: 5 },
      now: T0,
    });
    expect(out.ok).toBe(false);
    expect(p.inventory.ore).toBe(10);
  });
});
