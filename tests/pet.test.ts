import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PET,
  PET_BASE,
  PET_CHASSIS,
  PET_RATE_TOLERANCE,
  derivePet,
  getChassis,
  normalizePet,
  petFree,
  petStatCost,
  PET_STATS,
  type PetState,
} from '../src/config/pets';
import {
  addToPet,
  dropOffFor,
  getPetZone,
  heaviestItem,
  isPetStation,
  nearestStation,
  petAccepts,
  PET_STATIONS,
  PET_ZONES,
  stationWorkPoint,
  stationYield,
  unloadPet,
} from '../src/game/logic/pet';
import { beltCount } from '../src/game/logic/belts';
import { MACHINE_LIST } from '../src/config/machines';
import { ITEM_LIST } from '../src/config/items';
import { PetBrain } from '../src/game/systems/petBrain';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { inventoryCapacity } from '../src/game/logic/progression';
import { STATIONS } from '../src/config/world';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

const pet = (over: Partial<PetState> = {}): PetState => ({
  ...DEFAULT_PET,
  owned: [...DEFAULT_PET.owned],
  stats: {},
  inventory: {},
  lastAt: T0,
  ...over,
});

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'a', displayName: 'A', photoURL: null, email: null }, T0),
  pet: pet(),
  ...over,
});

const factory = (): FactoryState => createFactoryState('f1', 1, T0);

/* ───────────────────────── CONFIGURACIÓN ───────────────────────── */

describe('configuración de la mascota', () => {
  it('todo jugador nuevo tiene el chasis de serie', () => {
    const p = createPlayerState({ uid: 'x', displayName: 'X', photoURL: null, email: null }, T0);
    expect(p.pet.owned).toContain('spot');
    expect(p.pet.chassis).toBe('spot');
    expect(p.pet.mode).toBe('gather');
  });

  it('el chasis de serie es gratis y el resto se desbloquea por nivel', () => {
    expect(PET_CHASSIS[0].cost).toBe(0);
    for (const c of PET_CHASSIS.slice(1)) {
      expect(c.cost).toBeGreaterThan(0);
      expect(c.unlockLevel).toBeGreaterThan(1);
    }
  });

  it('cada mejora sube su estadística y el coste crece', () => {
    for (const def of PET_STATS) {
      expect(petStatCost(def, 3)).toBeGreaterThan(petStatCost(def, 0));
    }
    const base = derivePet(pet());
    expect(derivePet(pet({ stats: { capacity: 4 } })).capacity).toBeGreaterThan(base.capacity);
    expect(derivePet(pet({ stats: { mining: 4 } })).minePerSec).toBeGreaterThan(base.minePerSec);
    expect(derivePet(pet({ stats: { speed: 4 } })).speed).toBeGreaterThan(base.speed);
    expect(derivePet(pet({ stats: { radius: 4 } })).radius).toBeGreaterThan(base.radius);
  });

  it('un chasis mejor multiplica las estadísticas', () => {
    const serie = derivePet(pet({ chassis: 'spot' }));
    const tope = derivePet(pet({ chassis: 'hound' }));
    expect(tope.minePerSec).toBeGreaterThan(serie.minePerSec);
    expect(tope.capacity).toBeGreaterThan(serie.capacity);
  });

  it('repara documentos viejos sin perder el chasis de serie', () => {
    const fixed = normalizePet({ chassis: 'inventado' as never }, T0);
    expect(fixed.chassis).toBe('spot');
    expect(fixed.owned).toEqual(['spot']);
    expect(getChassis('inventado').id).toBe('spot');
  });
});

/* ───────────────────────── MOCHILA PROPIA ───────────────────────── */

describe('mochila de la mascota', () => {
  it('no admite más de su capacidad', () => {
    const p = pet();
    const cap = derivePet(p).capacity;
    const { inventory, added } = addToPet(p, 'ore', cap + 500);
    expect(added).toBe(cap);
    expect(inventory.ore).toBe(cap);
    expect(petFree({ ...p, inventory })).toBe(0);
  });

  it('descargar respeta el hueco del jugador y no destruye nada', () => {
    const out = unloadPet({ ore: 30, copper: 10 }, {}, 12);
    const entregado = Object.values(out.moved).reduce((a, b) => a + b, 0);
    const quedan = Object.values(out.pet).reduce((a, b) => a + b, 0);
    expect(entregado).toBe(12);
    expect(out.units).toBe(12);
    // 40 unidades antes, 40 después: ni se crean ni se pierden.
    expect(entregado + quedan).toBe(40);
  });

  it('con hueco de sobra entrega todo y se queda vacía', () => {
    const out = unloadPet({ ore: 5, scrap: 3 }, { ore: 1 }, 100);
    expect(out.pet).toEqual({});
    expect(out.player).toEqual({ ore: 6, scrap: 3 });
  });

  it('sin hueco no mueve nada', () => {
    const out = unloadPet({ ore: 5 }, {}, 0);
    expect(out.units).toBe(0);
    expect(out.pet).toEqual({ ore: 5 });
  });
});

/* ───────────────────── DETECCIÓN DE ZONAS ───────────────────── */

describe('detección de zonas de extracción', () => {
  it('sólo son válidas las vetas y los montones de chatarra', () => {
    for (const s of PET_STATIONS) {
      expect(['oreVein', 'salvage']).toContain(s.type);
    }
    expect(isPetStation('dock_sell')).toBe(false);
    expect(isPetStation('vein_a')).toBe(true);
    expect(PET_STATIONS.length).toBeGreaterThan(4);
  });

  it('encuentra la más cercana dentro del radio', () => {
    const a = STATIONS.find((s) => s.id === 'vein_a')!;
    const p = stationWorkPoint(a);
    const found = nearestStation(p.x + 10, p.y, 400);
    expect(found?.station.id).toBe('vein_a');
  });

  it('fuera del radio no detecta nada', () => {
    const a = STATIONS.find((s) => s.id === 'vein_a')!;
    const p = stationWorkPoint(a);
    expect(nearestStation(p.x + 900, p.y + 900, 60)).toBeNull();
  });

  it('el material lo dicta la estación, no el cliente', () => {
    expect(stationYield(STATIONS.find((s) => s.id === 'vein_copper_a')!).item).toBe('copper');
    expect(stationYield(STATIONS.find((s) => s.id === 'salvage_a')!).item).toBe('scrap');
    expect(stationYield(STATIONS.find((s) => s.id === 'vein_danger')!).amount).toBe(2);
  });
});

/* ──────────────── ZONA DE TRABAJO ELEGIDA ──────────────── */

describe('zona de extracción asignada', () => {
  it('las zonas salen del mapa, no de una lista escrita a mano', () => {
    expect(PET_ZONES.length).toBeGreaterThan(2);
    for (const z of PET_ZONES) {
      expect(z.stations.length).toBeGreaterThan(0);
      expect(z.items.length).toBeGreaterThan(0);
      // Toda estación listada pertenece de verdad a esa zona del mapa.
      for (const s of z.stations) expect(isPetStation(s.id)).toBe(true);
    }
  });

  it('cada zona conocida aparece con su material', () => {
    const yacimiento = PET_ZONES.find((z) => z.id === 'resources')!;
    expect(yacimiento.items).toContain('ore');
    const minera = PET_ZONES.find((z) => z.id === 'mine')!;
    expect(minera.items).toEqual(expect.arrayContaining(['copper', 'titanium']));
    const recoleccion = PET_ZONES.find((z) => z.id === 'salvage')!;
    expect(recoleccion.items).toContain('scrap');
  });

  it('ninguna estación se asigna a dos zonas a la vez', () => {
    const vistas = new Set<string>();
    for (const z of PET_ZONES) {
      for (const s of z.stations) {
        expect(vistas.has(s.id), `${s.id} está en dos zonas`).toBe(false);
        vistas.add(s.id);
      }
    }
    // Y todas las estaciones trabajables tienen zona.
    expect(vistas.size).toBe(PET_STATIONS.length);
  });

  it('sin zona elegida sólo mira dentro de su radio', () => {
    const lejos = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_copper_a')!);
    expect(nearestStation(lejos.x, lejos.y, 40, null)?.station.id).toBe('vein_copper_a');
    // Desde el yacimiento, la zona minera queda fuera del sensor.
    const cerca = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    expect(nearestStation(cerca.x, cerca.y, 60, null)?.station.id).toBe('vein_a');
  });

  it('con zona elegida cruza el mapa, sin importar el radio', () => {
    const cerca = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    const elegida = nearestStation(cerca.x, cerca.y, 10, 'mine');
    expect(elegida).not.toBeNull();
    expect(PET_ZONES.find((z) => z.id === 'mine')!.stations).toContainEqual(elegida!.station);
  });

  it('una zona inventada no manda: no devuelve nada de otra parte', () => {
    expect(getPetZone('atlantida')).toBeNull();
    const p = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    // Sin zona válida cae al comportamiento automático (por radio).
    expect(nearestStation(p.x, p.y, 10_000, 'atlantida')?.station.id).toBe('vein_a');
  });

  it('el cerebro respeta la zona asignada aunque tenga al dueño lejos', () => {
    const derived = derivePet(pet());
    const b = new PetBrain();
    const start = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    b.reset(start.x, start.y);
    b.x = start.x;
    b.y = start.y;
    b.update(T0, {
      dt: 0.016,
      ownerX: start.x,
      ownerY: start.y,
      derived,
      storedUnits: 0,
      mode: 'gather',
      zone: 'mine',
      ownerHasRoom: true,
      dropOff: null,
    });
    // Tiene una veta debajo, pero la suya está en la Zona Minera.
    expect(b.state).toBe('IR_A_VETA');
    expect(b.station?.id).not.toBe('vein_a');
  });

  it('se puede asignar y volver a automática', () => {
    const f: FactoryState = { ...factory(), level: 14 };
    const asignada = runOp('setPetLook', player(), f, { zone: 'mine', now: T0 });
    expect(asignada.ok).toBe(true);
    expect(asignada.player!.pet.zone).toBe('mine');

    const auto = runOp('setPetLook', asignada.player!, f, { zone: null, now: T0 });
    expect(auto.player!.pet.zone).toBeNull();
  });

  it('rechaza zonas inventadas o aún bloqueadas por nivel', () => {
    const f: FactoryState = { ...factory(), level: 14 };
    expect(runOp('setPetLook', player(), f, { zone: 'atlantida', now: T0 }).ok).toBe(false);
    // La Zona Minera abre a nivel 3: con la fábrica a 1 no se puede elegir.
    expect(runOp('setPetLook', player(), factory(), { zone: 'mine', now: T0 }).ok).toBe(false);
  });
});

/* ──────────────── A DÓNDE VA CADA MATERIAL ──────────────── */

describe('destino del material', () => {
  const origen = { x: 800, y: 600 };

  it('cada material que la mascota puede extraer tiene destino', () => {
    for (const s of PET_STATIONS) {
      const { item } = stationYield(s);
      // Nivel 12: fábrica madura, todo desbloqueado.
      expect(dropOffFor(item, 12, origen), `${item} no tiene dónde ir`).not.toBeNull();
    }
  });

  it('el destino es una máquina que de verdad consume ese material', () => {
    for (const item of ['ore', 'copper', 'scrap', 'titanium', 'crystal']) {
      const bay = dropOffFor(item, 12, origen)!;
      const def = MACHINE_LIST.find((m) => m.id === bay.machineId)!;
      expect(Object.keys(def.input), `${item} → ${bay.machineId}`).toContain(item);
    }
  });

  it('el mineral siempre acaba en la Fundidora', () => {
    expect(dropOffFor('ore', 12, origen)!.machineId).toBe('smelter');
  });

  it('desde el yacimiento entra por la cinta, que es lo que pilla más cerca', () => {
    const veta = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    const bay = dropOffFor('ore', 12, veta)!;
    expect(bay.machineId).toBe('smelter');
    expect(bay.beltId).toBe('c1');
  });

  it('lo que no tiene cinta se lleva a la máquina directamente', () => {
    const bay = dropOffFor('scrap', 12, origen)!;
    expect(bay.machineId).toBe('recycler');
    expect(bay.beltId).toBeUndefined();
  });

  it('con la fábrica recién empezada sólo existe el destino del mineral', () => {
    expect(dropOffFor('ore', 1, origen)).not.toBeNull();
    // La Recicladora abre a nivel 4: antes, la chatarra no tiene a dónde ir.
    expect(dropOffFor('scrap', 1, origen)).toBeNull();
    expect(dropOffFor('copper', 1, origen)).toBeNull();
  });

  it('los consumibles no le interesan y no tienen destino', () => {
    const consumibles = ITEM_LIST.filter((i) => i.category === 'consumable');
    expect(consumibles.length).toBeGreaterThan(0);
    for (const c of consumibles) {
      expect(petAccepts(c.id)).toBe(false);
      expect(dropOffFor(c.id, 12, origen)).toBeNull();
    }
    expect(petAccepts('ore')).toBe(true);
  });

  it('decide con el material del que más lleva, ignorando consumibles', () => {
    expect(heaviestItem({ ore: 3, copper: 9 })).toBe('copper');
    expect(heaviestItem({ energyDrink: 99, ore: 1 })).toBe('ore');
    expect(heaviestItem({})).toBeNull();
  });
});

/* ─────────────────────── PRIORIDADES DE LA IA ─────────────────────── */

describe('prioridades de la mascota', () => {
  const derived = derivePet(pet());
  const at = (id: string) => stationWorkPoint(STATIONS.find((s) => s.id === id)!);

  function brainAt(x: number, y: number): PetBrain {
    const b = new PetBrain();
    b.reset(x, y);
    b.x = x;
    b.y = y;
    return b;
  }

  it('con veta cerca y hueco, la minería gana siempre', () => {
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    b.update(T0, {
      dt: 0.016,
      ownerX: p.x + 20,
      ownerY: p.y,
      derived,
      storedUnits: 5, // lleva material, pero minar tiene prioridad
      mode: 'gather',
      zone: null,
      ownerHasRoom: true,
      dropOff: null,
    });
    expect(b.state).toBe('MINAR');
  });

  it('con la mochila llena deja de minar y va a entregar', () => {
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    b.update(T0, {
      dt: 0.016,
      ownerX: p.x + 300,
      ownerY: p.y,
      derived,
      storedUnits: derived.capacity,
      mode: 'gather',
      zone: null,
      ownerHasRoom: true,
      dropOff: null,
    });
    expect(b.state).toBe('VOLVER');
  });

  it('sin veta en el radio prioriza depositar el material', () => {
    const b = brainAt(50, 50);
    b.update(T0, {
      dt: 0.016,
      ownerX: 300,
      ownerY: 300,
      derived: { ...derived, radius: 1 },
      storedUnits: 4,
      mode: 'gather',
      zone: null,
      ownerHasRoom: true,
      dropOff: null,
    });
    expect(b.state).toBe('VOLVER');
  });

  it('sin veta y sin carga, simplemente te sigue', () => {
    const b = brainAt(50, 50);
    b.update(T0, {
      dt: 0.016,
      ownerX: 300,
      ownerY: 300,
      derived: { ...derived, radius: 1 },
      storedUnits: 0,
      mode: 'gather',
      zone: null,
      ownerHasRoom: true,
      dropOff: null,
    });
    expect(b.state).toBe('SEGUIR');
  });

  it('en reposo no mina aunque esté sobre la veta', () => {
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    b.update(T0, {
      dt: 0.016,
      ownerX: p.x,
      ownerY: p.y,
      derived,
      storedUnits: 0,
      mode: 'follow',
      zone: null,
      ownerHasRoom: true,
      dropOff: null,
    });
    expect(b.state).toBe('SEGUIR');
  });

  it('minando acumula material y pide liquidarlo', () => {
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    let mined: { stationId: string; qty: number } | null = null;
    for (let i = 0; i < 400; i++) {
      const ev = b.update(T0 + i * 50, {
        dt: 0.05,
        ownerX: p.x,
        ownerY: p.y,
        derived,
        storedUnits: 0,
        mode: 'gather',
        zone: null,
        ownerHasRoom: true,
        dropOff: null,
      });
      if (ev.mined) mined = ev.mined;
    }
    expect(mined?.stationId).toBe('vein_a');
    expect(mined!.qty).toBeGreaterThan(0);
    // Nunca acumula más de lo que le cabe.
    expect(b.pending).toBeLessThanOrEqual(derived.capacity);
  });

  it('llena y con destino, va a la cinta en vez de a su dueño', () => {
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    const bay = dropOffFor('ore', 10, { x: p.x, y: p.y })!;
    b.update(T0, {
      dt: 0.016,
      ownerX: p.x,
      ownerY: p.y,
      derived,
      storedUnits: derived.capacity,
      mode: 'gather',
      zone: null,
      ownerHasRoom: true,
      dropOff: bay,
    });
    expect(b.state).toBe('IR_A_CINTA');
    expect(b.bay?.machineId).toBe('smelter');
  });

  it('al llegar a la cinta pide soltar la carga', () => {
    const bay = dropOffFor('ore', 10, { x: 0, y: 0 })!;
    const b = brainAt(bay.x, bay.y);
    const ev = b.update(T0, {
      dt: 0.016,
      ownerX: bay.x,
      ownerY: bay.y,
      derived: { ...derived, radius: 1 },
      storedUnits: 10,
      mode: 'gather',
      zone: null,
      ownerHasRoom: true,
      dropOff: bay,
    });
    expect(ev.deposit?.machineId).toBe('smelter');
    expect(b.state).toBe('DESCARGAR');
  });

  it('en modo SEGUIR no reparte por la fábrica: te lo entrega a ti', () => {
    const bay = dropOffFor('ore', 10, { x: 0, y: 0 })!;
    const b = brainAt(bay.x, bay.y);
    const ev = b.update(T0, {
      dt: 0.016,
      ownerX: bay.x + 400,
      ownerY: bay.y,
      derived,
      storedUnits: 10,
      mode: 'follow',
      zone: null,
      ownerHasRoom: true,
      dropOff: bay,
    });
    expect(ev.deposit).toBeNull();
    expect(b.state).toBe('VOLVER');
  });

  it('nunca se sale del mundo ni atraviesa el mapa de golpe', () => {
    const b = brainAt(600, 400);
    for (let i = 0; i < 300; i++) {
      const before = { x: b.x, y: b.y };
      b.update(T0 + i * 16, {
        dt: 0.016,
        ownerX: 1200,
        ownerY: 800,
        derived,
        storedUnits: 0,
        mode: 'gather',
        zone: null,
        ownerHasRoom: true,
        dropOff: null,
      });
      expect(Math.hypot(b.x - before.x, b.y - before.y)).toBeLessThan(12);
    }
  });
});

/* ──────────────────────── OPERACIONES ──────────────────────── */

describe('operaciones de la mascota', () => {
  it('sube una mejora y cobra su coste', () => {
    const cost = petStatCost(PET_STATS[0], 0);
    const out = runOp('buyPetStat', player({ money: cost }), factory(), {
      stat: 'capacity',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.stats.capacity).toBe(1);
    expect(out.player!.money).toBe(0);
  });

  it('rechaza mejoras inventadas y sin dinero', () => {
    expect(runOp('buyPetStat', player({ money: 1e9 }), factory(), { stat: 'volar', now: T0 }).ok)
      .toBe(false);
    expect(runOp('buyPetStat', player({ money: 0 }), factory(), { stat: 'capacity', now: T0 }).ok)
      .toBe(false);
  });

  it('un chasis bloqueado por nivel no se puede comprar', () => {
    const caro = PET_CHASSIS[2];
    const out = runOp('buyPetChassis', player({ money: 1e9, level: 1 }), factory(), {
      chassis: caro.id,
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('comprado una vez, equiparlo después es gratis', () => {
    const c = PET_CHASSIS[1];
    const p = player({ money: c.cost, level: c.unlockLevel });
    const first = runOp('buyPetChassis', p, factory(), { chassis: c.id, now: T0 });
    expect(first.ok).toBe(true);
    expect(first.player!.money).toBe(0);

    const volver = runOp('buyPetChassis', first.player!, first.factory!, {
      chassis: 'spot',
      now: T0,
    });
    const otra = runOp('buyPetChassis', volver.player!, volver.factory!, {
      chassis: c.id,
      now: T0,
    });
    expect(otra.ok).toBe(true);
    expect(otra.player!.money).toBe(0);
    expect(otra.player!.pet.chassis).toBe(c.id);
  });

  it('el color sólo acepta valores de la paleta', () => {
    const bueno = runOp('setPetLook', player(), factory(), { color: '#ef4444', now: T0 });
    expect(bueno.player!.pet.color).toBe('#ef4444');
    const malo = runOp('setPetLook', player(), factory(), { color: 'javascript:1', now: T0 });
    expect(malo.player!.pet.color).toBe(DEFAULT_PET.color);
  });

  it('se le puede cambiar la orden de trabajo', () => {
    const seguir = runOp('setPetLook', player(), factory(), { mode: 'follow', now: T0 });
    expect(seguir.player!.pet.mode).toBe('follow');
    const reposo = runOp('setPetLook', seguir.player!, seguir.factory!, { mode: 'off', now: T0 });
    expect(reposo.player!.pet.mode).toBe('off');
    expect(runOp('setPetLook', player(), factory(), { mode: 'turbo', now: T0 }).ok).toBe(false);
  });

  it('liquida lo minado y lo mete en SU mochila, no en la del jugador', () => {
    const out = runOp('petMine', player(), factory(), {
      stationId: 'vein_a',
      qty: 3,
      now: T0 + 60_000,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.inventory.ore).toBe(3);
    expect(out.player!.inventory.ore).toBeUndefined();
    expect(out.player!.stats.petMined).toBe(3);
  });

  it('el material lo decide el servidor a partir de la estación', () => {
    const out = runOp('petMine', player(), factory(), {
      stationId: 'vein_copper_a',
      qty: 2,
      now: T0 + 60_000,
    });
    expect(out.player!.pet.inventory.copper).toBe(2);
    expect(out.player!.pet.inventory.ore).toBeUndefined();
  });

  it('no se puede reclamar más de lo que da el tiempo transcurrido', () => {
    const elapsed = 10_000;
    const techo = Math.floor(PET_BASE.mining * (elapsed / 1000) * PET_RATE_TOLERANCE) + 1;
    const out = runOp('petMine', player(), factory(), {
      stationId: 'vein_a',
      qty: 99_999,
      now: T0 + elapsed,
    });
    expect(out.player!.pet.inventory.ore).toBe(techo);
  });

  it('nunca supera la capacidad de la mochila por mucho tiempo que pase', () => {
    const p = player();
    const cap = derivePet(p.pet).capacity;
    const out = runOp('petMine', p, factory(), {
      stationId: 'vein_a',
      qty: 99_999,
      now: T0 + 3600_000,
    });
    expect(out.player!.pet.inventory.ore).toBe(cap);
  });

  it('rechaza estaciones que no son de extracción', () => {
    expect(
      runOp('petMine', player(), factory(), { stationId: 'dock_sell', qty: 5, now: T0 + 60_000 }).ok,
    ).toBe(false);
    expect(
      runOp('petMine', player(), factory(), { stationId: 'inventada', qty: 5, now: T0 + 60_000 }).ok,
    ).toBe(false);
  });

  it('si no está extrayendo no puede reclamar nada', () => {
    const p = player({ pet: pet({ mode: 'follow' }) });
    expect(runOp('petMine', p, factory(), { stationId: 'vein_a', qty: 5, now: T0 + 60_000 }).ok)
      .toBe(false);
  });

  it('entregar pasa el material de la mascota al jugador', () => {
    const p = player({ pet: pet({ inventory: { ore: 6 } }) });
    const out = runOp('petUnload', p, factory(), { now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBe(6);
    expect(out.player!.pet.inventory.ore).toBeUndefined();
  });

  it('con el inventario lleno se queda el material: no se pierde', () => {
    const p = player();
    const cap = inventoryCapacity(p);
    const lleno = player({ inventory: { ore: cap }, pet: pet({ inventory: { copper: 5 } }) });
    const out = runOp('petUnload', lleno, factory(), { now: T0 });
    expect(out.ok).toBe(false);
    // El estado no cambia: la mascota sigue con sus 5.
    const sigue = runOp('petUnload', lleno, factory(), { now: T0 });
    expect(sigue.ok).toBe(false);
    expect(lleno.pet.inventory.copper).toBe(5);
  });

  it('entrega sólo lo que cabe y conserva el resto', () => {
    const p = player();
    const cap = inventoryCapacity(p);
    const casi = player({
      inventory: { ore: cap - 2 },
      pet: pet({ inventory: { copper: 9 } }),
    });
    const out = runOp('petUnload', casi, factory(), { now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.copper).toBe(2);
    expect(out.player!.pet.inventory.copper).toBe(7);
  });

  it('sin nada encima no hay nada que entregar', () => {
    expect(runOp('petUnload', player(), factory(), { now: T0 }).ok).toBe(false);
  });

  it('la mascota nunca recibe consumibles, ni en su mochila', () => {
    const p = player({ pet: pet({ inventory: {} }) });
    expect(addToPet(p.pet, 'energyDrink', 5).added).toBe(0);
  });
});

/* ───────────── DEJAR EL MATERIAL DONDE SIRVE ───────────── */

describe('descarga en cinta o máquina', () => {
  const conCarga = (inv: Record<string, number>, mode: PetState['mode'] = 'gather') =>
    player({ pet: pet({ inventory: inv, mode }) });

  const nivel = (n: number): FactoryState => ({ ...factory(), level: n });

  it('por cinta el material viaja: no aparece de golpe en la máquina', () => {
    const out = runOp('petDeposit', conCarga({ ore: 12 }), nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.inventory.ore).toBeUndefined();
    expect(beltCount(out.factory!.belts.c1, 'c1', T0)).toBe(12);
    expect(out.factory!.machines.smelter.input.ore ?? 0).toBe(0);
  });

  it('sin cinta entra directo en la máquina y arranca el ciclo', () => {
    const out = runOp('petDeposit', conCarga({ scrap: 20 }), nivel(6), {
      machineId: 'recycler',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.inventory.scrap).toBeUndefined();
    expect(out.factory!.machines.recycler.cycleStartAt).toBeGreaterThan(0);
  });

  it('sólo se lleva lo que la máquina admite; el resto se queda encima', () => {
    const out = runOp('petDeposit', conCarga({ ore: 5, copper: 7 }), nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.inventory.copper).toBe(7);
    expect(out.player!.pet.inventory.ore).toBeUndefined();
  });

  it('respeta el filtro de la cinta', () => {
    // La bajante c6 sólo admite cristal, aunque el Laboratorio coma engranajes.
    const out = runOp('petDeposit', conCarga({ crystal: 3, gear: 4 }), nivel(8), {
      machineId: 'lab',
      beltId: 'c6',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.inventory.gear).toBe(4);
    expect(beltCount(out.factory!.belts.c6, 'c6', T0)).toBe(3);
  });

  it('rechaza máquinas y cintas bloqueadas por nivel', () => {
    expect(
      runOp('petDeposit', conCarga({ scrap: 5 }), nivel(1), { machineId: 'recycler', now: T0 }).ok,
    ).toBe(false);
    expect(
      runOp('petDeposit', conCarga({ ore: 5 }), nivel(1), {
        machineId: 'smelter',
        beltId: 'c1',
        now: T0,
      }).ok,
    ).toBe(false);
  });

  it('rechaza una cinta que no lleva a esa máquina', () => {
    expect(
      runOp('petDeposit', conCarga({ ore: 5 }), nivel(8), {
        machineId: 'smelter',
        beltId: 'c5',
        now: T0,
      }).ok,
    ).toBe(false);
  });

  it('en modo SEGUIR no reparte por la fábrica', () => {
    expect(
      runOp('petDeposit', conCarga({ ore: 5 }, 'follow'), nivel(6), {
        machineId: 'smelter',
        beltId: 'c1',
        now: T0,
      }).ok,
    ).toBe(false);
  });

  it('sin material compatible no hace nada', () => {
    expect(
      runOp('petDeposit', conCarga({ copper: 5 }), nivel(6), {
        machineId: 'smelter',
        beltId: 'c1',
        now: T0,
      }).ok,
    ).toBe(false);
  });
});
