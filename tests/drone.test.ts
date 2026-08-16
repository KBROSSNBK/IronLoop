import { describe, expect, it } from 'vitest';
import { manifestTop, manifestUnits, planHaul, shareCarry } from '../src/game/logic/drone';
import { DRONE, DEFAULT_PET, PACK, deriveDrones, droneSlots } from '../src/config/pets';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { getBelt, beltCount } from '../src/game/logic/belts';
import { DroneBrain } from '../src/game/systems/droneBrain';
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

/* ─────────────── CADA DRON CON SU PAREJA, Y SÓLO CON ELLA ─────────────── */

describe('el dron no se va con otro', () => {
  const base = {
    dt: 0.05,
    carry: 18,
    speed: 210,
    factoryLevel: 12,
    canDeliver: true,
    ownerX: 400,
    ownerY: 400,
    dogX: 1400,
    dogY: 900,
  };

  it('tu escolta ignora lo que lleva el perro', () => {
    const d = new DroneBrain(0);
    d.reset(base.ownerX, base.ownerY);
    for (let i = 0; i < 20; i++) {
      d.update({ ...base, items: {}, source: 'player', now: T0 + i * 50 });
    }
    // El perro está cargadísimo, pero eso no es asunto suyo.
    expect(d.state).toBe('ESPERA');
    expect(d.load).toBe(0);
    // Y se queda pegado a ti, no junto al perro.
    expect(Math.hypot(d.x - base.ownerX, d.y - base.ownerY)).toBeLessThan(90);
  });

  it('el dron de un perro no te vacía a ti la mochila', () => {
    const d = new DroneBrain(1);
    d.reset(base.dogX, base.dogY);
    for (let i = 0; i < 20; i++) {
      d.update({ ...base, items: {}, source: 'pet', now: T0 + i * 50 });
    }
    expect(d.state).toBe('ESPERA');
    // Espera junto a SU perro, al otro lado del mapa.
    expect(Math.hypot(d.x - base.dogX, d.y - base.dogY)).toBeLessThan(90);
  });

  it('con carga de su pareja, arranca el viaje', () => {
    const d = new DroneBrain(1);
    d.reset(base.dogX, base.dogY);
    let out = null;
    for (let i = 0; i < 600 && !out; i++) {
      const r = d.update({
        ...base,
        items: { ore: 12, crystal: 1 },
        source: 'pet',
        now: T0 + i * 50,
      });
      if (r.deliver) out = r.deliver;
    }
    expect(out).not.toBeNull();
    expect(out!.source).toBe('pet');
    expect(out!.units).toBeGreaterThan(0);
  });

  it('si no se puede liquidar, espera sobre la máquina sin soltar', () => {
    const d = new DroneBrain(1);
    d.reset(base.dogX, base.dogY);
    let entregas = 0;
    for (let i = 0; i < 600; i++) {
      const r = d.update({
        ...base,
        canDeliver: false,
        items: { ore: 12 },
        source: 'pet',
        now: T0 + i * 50,
      });
      if (r.deliver) entregas++;
    }
    // Ni una entrega: se queda flotando con la carga puesta.
    expect(entregas).toBe(0);
    expect(d.load).toBeGreaterThan(0);
    expect(d.state).toBe('AL_DESTINO');
  });
});

/* ─────────────── CARGAR SOBRE ALGO QUE SE MUEVE ─────────────── */

/**
 * El CAEX no para: hace su ronda sin descanso. Su dron tenía que poder
 * engancharle la tolva EN MARCHA — y no podía, porque al acercarse frenaba de
 * forma proporcional y su velocidad acababa por debajo de la del propio
 * camión: se quedaba persiguiéndolo eternamente a dos metros.
 */
describe('el dron alcanza a su pareja aunque vaya en marcha', () => {
  const base = {
    dt: 0.05,
    carry: 40,
    speed: 230,
    factoryLevel: 12,
    canDeliver: true,
    source: 'pet' as const,
    items: { ore: 30 },
  };

  /** Simula el dron persiguiendo algo que avanza a `vel` px/s. */
  function persigue(vel: number) {
    const d = new DroneBrain(1);
    d.reset(600, 600);
    let camionX = 600;
    let entrega = null;
    let alcanzado = false;
    for (let i = 0; i < 1200 && !entrega; i++) {
      camionX += vel * base.dt;
      const r = d.update({
        ...base,
        dogX: camionX,
        dogY: 600,
        ownerX: camionX,
        ownerY: 600,
        now: T0 + i * 50,
      });
      if (d.state === 'CARGANDO' || d.load > 0) alcanzado = true;
      if (r.deliver) entrega = r.deliver;
    }
    return { alcanzado, entrega, distanciaFinal: Math.abs(d.x - camionX) };
  }

  it('con la pareja parada, carga y entrega', () => {
    const r = persigue(0);
    expect(r.alcanzado).toBe(true);
    expect(r.entrega).not.toBeNull();
  });

  it('con la pareja rodando como el CAEX, también', () => {
    // 96 px/s es la marcha del camión.
    const r = persigue(96);
    expect(r.alcanzado).toBe(true);
    expect(r.entrega).not.toBeNull();
    expect(r.entrega!.units).toBeGreaterThan(0);
  });

  it('incluso con una pareja rápida, la caza', () => {
    // Un perro con los servos a tope no llega a esto, así que hay margen.
    const r = persigue(180);
    expect(r.alcanzado).toBe(true);
    expect(r.entrega).not.toBeNull();
  });

  it('no la alcanza si corre más que él, y no se cuelga por intentarlo', () => {
    const r = persigue(400);
    // No pasa nada: sigue en su persecución sin romperse ni cargar de la nada.
    expect(r.entrega).toBeNull();
  });
});

/* ─────────────── SIN CERROJOS: NADIE SE QUEDA COLGADO ─────────────── */

/**
 * Había un cerrojo global de entregas: mientras un dron liquidaba la suya,
 * los demás se quedaban flotando sobre su máquina con la carga puesta hasta
 * que el primero terminaba. Con cinco drones eso se veía todo el rato.
 */
describe('varios drones entregan sin esperarse unos a otros', () => {
  it('cuatro drones sueltan su carga en la misma ventana de tiempo', () => {
    const flota = [0, 1, 2, 3].map((i) => {
      const d = new DroneBrain(i);
      d.reset(700 + i * 40, 700);
      return d;
    });
    const entregas = new Set<number>();
    for (let i = 0; i < 1500; i++) {
      flota.forEach((d, idx) => {
        const r = d.update({
          dt: 0.05,
          dogX: 700 + idx * 40,
          dogY: 700,
          items: { ore: 20 },
          source: 'pet',
          canDeliver: true,
          carry: 18,
          speed: 210,
          ownerX: 700,
          ownerY: 700,
          factoryLevel: 12,
          now: T0 + i * 50,
        });
        if (r.deliver) entregas.add(idx);
      });
      if (entregas.size === flota.length) break;
    }
    expect(entregas.size).toBe(4);
  });

  it('esperar turno no pierde la carga: la suelta en cuanto puede', () => {
    const d = new DroneBrain(1);
    d.reset(700, 700);
    const tick = (canDeliver: boolean, i: number) =>
      d.update({
        dt: 0.05,
        dogX: 700,
        dogY: 700,
        items: { ore: 20 },
        source: 'pet',
        canDeliver,
        carry: 18,
        speed: 210,
        ownerX: 700,
        ownerY: 700,
        factoryLevel: 12,
        now: T0 + i * 50,
      });

    // Con el turno cerrado llega, espera arriba y NO suelta.
    let i = 0;
    for (; i < 600; i++) if (tick(false, i).deliver) throw new Error('no debería entregar');
    expect(d.load).toBeGreaterThan(0);
    expect(d.state).toBe('AL_DESTINO');

    // En cuanto se abre, entrega lo mismo que llevaba.
    const llevaba = d.load;
    let entrega = null;
    for (; i < 700 && !entrega; i++) entrega = tick(true, i).deliver;
    expect(entrega).not.toBeNull();
    expect(entrega!.units).toBeLessThanOrEqual(llevaba);
  });
});
