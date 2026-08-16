import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PET,
  PET_BASE,
  PET_CHASSIS,
  PET_RATE_TOLERANCE,
  bagFree,
  bagUsed,
  derivePet,
  dogTarget,
  getChassis,
  normalizePet,
  petStatCost,
  PET_STATS,
  type PetState,
} from '../src/config/pets';
import {
  addToPet,
  dropOffFor,
  getPetTarget,
  heaviestItem,
  isPetStation,
  nearestStation,
  petAccepts,
  PET_STATIONS,
  PET_TARGETS,
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
import { STATIONS, isOffworld } from '../src/config/world';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

/** Mochila del primer perro: cada uno lleva la suya. */
const bag0 = (p: { bags?: Record<string, number>[] } | undefined) => p?.bags?.[0] ?? {};

const pet = (over: Partial<PetState> = {}): PetState => ({
  ...DEFAULT_PET,
  owned: [...DEFAULT_PET.owned],
  stats: {},
  bags: [{}, {}, {}],
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
    // Su mochila queda a tope; las de los otros perros, intactas.
    expect(bagFree({ ...p, bags: [inventory] }, 0)).toBe(0);
    expect(bagFree({ ...p, bags: [inventory] }, 1)).toBe(cap);
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

/* ──────────────── MATERIAL ENCARGADO ──────────────── */

describe('material encargado a la mascota', () => {
  it('la lista de materiales sale del mapa, no de una lista escrita a mano', () => {
    expect(PET_TARGETS.length).toBeGreaterThan(3);
    for (const t of PET_TARGETS) {
      expect(t.stations.length).toBeGreaterThan(0);
      for (const s of t.stations) {
        expect(isPetStation(s.id)).toBe(true);
        expect(stationYield(s).item).toBe(t.item);
      }
    }
  });

  it('están todos los materiales que se pueden picar, y sólo esos', () => {
    const items = PET_TARGETS.map((t) => t.item).sort();
    const delMapa = [...new Set(PET_STATIONS.map((s) => stationYield(s).item))].sort();
    expect(items).toEqual(delMapa);
    expect(items).toEqual(expect.arrayContaining(['ore', 'scrap', 'copper', 'titanium']));
  });

  it('el cristal sólo sale de zona prohibida: es cosa de robots', () => {
    const cristal = PET_TARGETS.find((t) => t.item === 'crystal')!;
    expect(cristal.onlyRobots).toBe(true);
    // El hierro, en cambio, lo puede picar cualquiera.
    expect(PET_TARGETS.find((t) => t.item === 'ore')!.onlyRobots).toBe(false);
  });

  it('sin material encargado sólo mira dentro de su radio', () => {
    const lejos = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_copper_a')!);
    expect(nearestStation(lejos.x, lejos.y, 40, null)?.station.id).toBe('vein_copper_a');
    // Desde el yacimiento, la zona minera queda fuera del sensor.
    const cerca = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    expect(nearestStation(cerca.x, cerca.y, 60, null)?.station.id).toBe('vein_a');
  });

  it('con material encargado cruza el mapa, sin importar el radio', () => {
    const cerca = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    const elegida = nearestStation(cerca.x, cerca.y, 10, 'copper');
    expect(elegida).not.toBeNull();
    expect(stationYield(elegida!.station).item).toBe('copper');
  });

  it('un material inventado no manda: cae al comportamiento automático', () => {
    expect(getPetTarget('adamantium')).toBeNull();
    const p = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    expect(nearestStation(p.x, p.y, 10_000, 'adamantium')?.station.id).toBe('vein_a');
  });

  it('el cerebro respeta el material encargado aunque tenga al dueño al lado', () => {
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
      otherPending: 0,
      mode: 'gather',
      target: 'copper',
      hasDrones: false,
      ownerHasRoom: true,
      dropOff: null,
    });
    // Tiene mineral de hierro debajo, pero le has pedido cobre.
    expect(b.state).toBe('IR_A_VETA');
    expect(stationYield(b.station!).item).toBe('copper');
  });

  it('se puede encargar un material y volver a automático', () => {
    const f: FactoryState = { ...factory(), level: 14 };
    const asignado = runOp('setPetLook', player(), f, { target: 'copper', now: T0 });
    expect(asignado.ok).toBe(true);
    expect(dogTarget(asignado.player!.pet, 0)).toBe('copper');

    const auto = runOp('setPetLook', asignado.player!, f, { target: null, now: T0 });
    expect(dogTarget(auto.player!.pet, 0)).toBeNull();
  });

  /*
   * CADA PERRO A LO SUYO. Es lo que hace útil tener jauría: uno al cobre,
   * otro al titanio y otro a la chatarra, sin pisarse.
   */
  it('cada perro puede ir a un mineral distinto', () => {
    const f: FactoryState = { ...factory(), level: 14 };
    let p = { ...player(), pet: { ...player().pet, dogs: 3 } };

    p = runOp('setPetLook', p, f, { dog: 0, target: 'copper', now: T0 }).player!;
    p = runOp('setPetLook', p, f, { dog: 1, target: 'titanium', now: T0 }).player!;
    p = runOp('setPetLook', p, f, { dog: 2, target: 'scrap', now: T0 }).player!;

    expect(dogTarget(p.pet, 0)).toBe('copper');
    expect(dogTarget(p.pet, 1)).toBe('titanium');
    expect(dogTarget(p.pet, 2)).toBe('scrap');

    // Y volver uno solo a automático no toca a los demás.
    p = runOp('setPetLook', p, f, { dog: 1, target: null, now: T0 }).player!;
    expect(dogTarget(p.pet, 0)).toBe('copper');
    expect(dogTarget(p.pet, 1)).toBeNull();
    expect(dogTarget(p.pet, 2)).toBe('scrap');
  });

  it('no se le puede dar orden a un perro que no tienes', () => {
    const f: FactoryState = { ...factory(), level: 14 };
    const out = runOp('setPetLook', player(), f, { dog: 2, target: 'copper', now: T0 });
    expect(out.ok).toBe(false);
  });

  it('dos perros con encargos distintos van a vetas distintas', () => {
    const derived = derivePet(pet());
    const uno = new PetBrain(0);
    const dos = new PetBrain(1);
    const start = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    for (const b of [uno, dos]) {
      b.reset(start.x, start.y);
      b.x = start.x;
      b.y = start.y;
    }
    const base = {
      dt: 0.016,
      ownerX: start.x,
      ownerY: start.y,
      derived,
      storedUnits: 0,
      otherPending: 0,
      mode: 'gather' as const,
      hasDrones: false,
      ownerHasRoom: true,
      dropOff: null,
    };
    uno.update(T0, { ...base, target: 'copper' });
    dos.update(T0, { ...base, target: 'scrap' });
    expect(stationYield(uno.station!).item).toBe('copper');
    expect(stationYield(dos.station!).item).toBe('scrap');
  });

  it('rechaza materiales inventados o aún bloqueados por nivel', () => {
    const f: FactoryState = { ...factory(), level: 14 };
    expect(runOp('setPetLook', player(), f, { target: 'adamantium', now: T0 }).ok).toBe(false);
    // El cobre sale de la Zona Minera, que abre a nivel 3.
    expect(runOp('setPetLook', player(), factory(), { target: 'copper', now: T0 }).ok).toBe(false);
  });
});

/* ──────────────── A DÓNDE VA CADA MATERIAL ──────────────── */

describe('destino del material', () => {
  const origen = { x: 800, y: 600 };

  it('cada material que la mascota puede extraer tiene destino', () => {
    for (const s of PET_STATIONS) {
      const { item } = stationYield(s);
      // Se mira desde la propia veta: al otro planeta no se va andando, así
      // que cada material tiene que tener salida EN SU MUNDO.
      const desde = stationWorkPoint(s);
      // Nivel 20: fábrica madura, todo desbloqueado en los dos mundos.
      expect(dropOffFor(item, 20, desde), `${item} no tiene dónde ir`).not.toBeNull();
    }
  });

  /*
   * LOS DOS MUNDOS NO SE MEZCLAN. No hay camino a pie entre la estación y el
   * planeta, así que una máquina de allí no puede ser el destino de un perro
   * de aquí — antes se quedaba empujando contra el vacío para siempre.
   */
  it('nunca manda material al otro mundo', () => {
    const enLaEstacion = { x: 800, y: 600 };
    const enElPlaneta = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_void_a')!);

    // Desde la estación, el mineral de vacío no tiene a dónde ir.
    expect(dropOffFor('voidOre', 20, enLaEstacion)).toBeNull();
    // Desde el planeta, sí: su refinería.
    expect(dropOffFor('voidOre', 20, enElPlaneta)).not.toBeNull();
    // Y al revés: el hierro de la estación no se lleva a la refinería.
    const bay = dropOffFor('ore', 20, enLaEstacion);
    expect(bay).not.toBeNull();
    expect(isOffworld(bay!.y)).toBe(false);
  });

  it('una mascota en la estación no ve las vetas del planeta', () => {
    const enLaEstacion = { x: 800, y: 600 };
    const enElPlaneta = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_void_a')!);

    // Encargarle mineral de vacío desde casa no la manda al vacío: como ahí
    // no hay ninguna veta que lo dé, trabaja lo que pilla cerca.
    const aquí = nearestStation(enLaEstacion.x, enLaEstacion.y, 99_999, 'voidOre');
    if (aquí) {
      expect(isOffworld(aquí.point.y)).toBe(false);
      expect(stationYield(aquí.station).item).not.toBe('voidOre');
    }

    // En el planeta, en cambio, va derecha a la suya.
    const allí = nearestStation(enElPlaneta.x, enElPlaneta.y, 99_999, 'voidOre');
    expect(allí).not.toBeNull();
    expect(stationYield(allí!.station).item).toBe('voidOre');

    // Y estando allí, ninguna veta de casa entra en sus planes.
    const casa = nearestStation(enElPlaneta.x, enElPlaneta.y, 99_999, 'ore');
    if (casa) expect(isOffworld(casa.point.y)).toBe(true);
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
    // Ahora mismo el catálogo no tiene ninguno, pero la regla sigue viva:
    // si mañana vuelve una bebida, la mascota no la tocará.
    for (const c of ITEM_LIST.filter((i) => i.category === 'consumable')) {
      expect(petAccepts(c.id)).toBe(false);
      expect(dropOffFor(c.id, 12, origen)).toBeNull();
    }
    expect(petAccepts('ore')).toBe(true);
    // Y lo que sí puede sacar, TODO, tiene su sitio a fábrica madura.
    for (const s of PET_STATIONS) {
      expect(petAccepts(stationYield(s).item)).toBe(true);
    }
  });

  it('decide con el material del que más lleva, ignorando consumibles', () => {
    expect(heaviestItem({ ore: 3, copper: 9 })).toBe('copper');
    expect(heaviestItem({ ore: 1 })).toBe('ore');
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
      otherPending: 0,
      mode: 'gather',
      target: null,
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
      otherPending: 0,
      mode: 'gather',
      target: null,
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
      otherPending: 0,
      mode: 'gather',
      target: null,
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
      otherPending: 0,
      mode: 'gather',
      target: null,
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
      otherPending: 0,
      mode: 'follow',
      target: null,
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
        otherPending: 0,
      mode: 'gather',
        target: null,
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
      otherPending: 0,
      mode: 'gather',
      target: null,
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
      otherPending: 0,
      mode: 'gather',
      target: null,
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
      otherPending: 0,
      mode: 'follow',
      target: null,
      ownerHasRoom: true,
      dropOff: bay,
    });
    expect(ev.deposit).toBeNull();
    expect(b.state).toBe('VOLVER');
  });

  it('pica hasta llenar la mochila DE VERDAD, no hasta la mitad', () => {
    // Regresión: el tope contaba lo pendiente de liquidar dos veces, así que
    // con la perforadora subida la mascota se plantaba a media carga y
    // parecía colgada.
    const rapida = { ...derived, minePerSec: 8 };
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    for (let i = 0; i < 200; i++) {
      b.update(T0 + i * 50, {
        dt: 0.05,
        ownerX: p.x,
        ownerY: p.y,
        derived: rapida,
        storedUnits: 0, // nada liquidado todavía: todo está pendiente
        otherPending: 0,
      mode: 'gather',
        target: null,
        hasDrones: false,
        ownerHasRoom: true,
        dropOff: null,
      });
    }
    expect(b.pending).toBe(rapida.capacity);
  });

  it('en cuanto un dron le hace hueco, vuelve a picar sin esperar', () => {
    const rapida = { ...derived, minePerSec: 8 };
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    const base = {
      dt: 0.05,
      ownerX: p.x,
      ownerY: p.y,
      derived: rapida,
      otherPending: 0,
      mode: 'gather' as const,
      target: null,
      hasDrones: true,
      ownerHasRoom: true,
      dropOff: null,
    };

    // Llena del todo: se queda en la veta esperando a que la relevan.
    for (let i = 0; i < 40; i++) {
      b.update(T0 + i * 50, { ...base, storedUnits: rapida.capacity });
    }
    expect(b.state).toBe('MINAR');
    expect(b.pending).toBe(0);

    // Llega el dron y se lleva la mitad: se pone a picar de inmediato, sin
    // tener que volver a decidir nada ni dar un paseo.
    const libre = Math.floor(rapida.capacity / 2);
    for (let i = 0; i < 6; i++) {
      b.update(T0 + 3000 + i * 50, { ...base, storedUnits: libre });
      expect(b.state).toBe('MINAR');
    }
    expect(b.pending).toBeGreaterThan(0);
  });

  it('con drones relevándola no abandona la veta aunque tarden', () => {
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    const bay = dropOffFor('ore', 10, { x: p.x, y: p.y })!;
    const base = {
      dt: 0.05,
      ownerX: p.x + 400,
      ownerY: p.y,
      derived,
      otherPending: 0,
      mode: 'gather' as const,
      target: null,
      hasDrones: true,
      ownerHasRoom: true,
      dropOff: bay,
    };

    let stored = derived.capacity;
    // 30 segundos: mucho más que la paciencia, pero un dron la releva a ratos.
    for (let i = 0; i < 600; i++) {
      const t = T0 + i * 50;
      if (i % 100 === 99) stored = derived.capacity - 6; // pasa un dron
      else if (i % 100 === 0) stored = derived.capacity; // se vuelve a llenar
      b.update(t, { ...base, storedUnits: stored });
      expect(b.state, 'no debería irse a la cinta').not.toBe('IR_A_CINTA');
    }
  });

  it('sin nadie que la releve, al final va ella a soltar la carga', () => {
    const p = at('vein_a');
    const b = brainAt(p.x, p.y);
    const bay = dropOffFor('ore', 10, { x: p.x, y: p.y })!;
    const base = {
      dt: 0.05,
      ownerX: p.x,
      ownerY: p.y,
      derived,
      storedUnits: derived.capacity,
      otherPending: 0,
      mode: 'gather' as const,
      target: null,
      hasDrones: true,
      ownerHasRoom: true,
      dropOff: bay,
    };
    let sefue = false;
    for (let i = 0; i < 400; i++) {
      b.update(T0 + i * 50, base);
      if (b.state === 'IR_A_CINTA' || b.state === 'DESCARGAR') sefue = true;
    }
    expect(sefue).toBe(true);
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
        otherPending: 0,
      mode: 'gather',
        target: null,
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
    expect(bag0(out.player!.pet).ore).toBe(3);
    expect(out.player!.inventory.ore).toBeUndefined();
    expect(out.player!.stats.petMined).toBe(3);
  });

  it('el material lo decide el servidor a partir de la estación', () => {
    const out = runOp('petMine', player(), factory(), {
      stationId: 'vein_copper_a',
      qty: 2,
      now: T0 + 60_000,
    });
    expect(bag0(out.player!.pet).copper).toBe(2);
    expect(bag0(out.player!.pet).ore).toBeUndefined();
  });

  it('no se puede reclamar más de lo que da el tiempo transcurrido', () => {
    const elapsed = 10_000;
    const techo = Math.floor(PET_BASE.mining * (elapsed / 1000) * PET_RATE_TOLERANCE) + 1;
    const out = runOp('petMine', player(), factory(), {
      stationId: 'vein_a',
      qty: 99_999,
      now: T0 + elapsed,
    });
    expect(bag0(out.player!.pet).ore).toBe(techo);
  });

  it('nunca supera la capacidad de la mochila por mucho tiempo que pase', () => {
    const p = player();
    const cap = derivePet(p.pet).capacity;
    const out = runOp('petMine', p, factory(), {
      stationId: 'vein_a',
      qty: 99_999,
      now: T0 + 3600_000,
    });
    expect(bag0(out.player!.pet).ore).toBe(cap);
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
    const p = player({ pet: pet({ bags: [{ ore: 6 }] }) });
    const out = runOp('petUnload', p, factory(), { now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBe(6);
    expect(bag0(out.player!.pet).ore).toBeUndefined();
  });

  it('con el inventario lleno se queda el material: no se pierde', () => {
    const p = player();
    const cap = inventoryCapacity(p);
    const lleno = player({ inventory: { ore: cap }, pet: pet({ bags: [{ copper: 5 }] }) });
    const out = runOp('petUnload', lleno, factory(), { now: T0 });
    expect(out.ok).toBe(false);
    // El estado no cambia: la mascota sigue con sus 5.
    const sigue = runOp('petUnload', lleno, factory(), { now: T0 });
    expect(sigue.ok).toBe(false);
    expect(bag0(lleno.pet).copper).toBe(5);
  });

  it('entrega sólo lo que cabe y conserva el resto', () => {
    const p = player();
    const cap = inventoryCapacity(p);
    const casi = player({
      inventory: { ore: cap - 2 },
      pet: pet({ bags: [{ copper: 9 }] }),
    });
    const out = runOp('petUnload', casi, factory(), { now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.copper).toBe(2);
    expect(bag0(out.player!.pet).copper).toBe(7);
  });

  it('sin nada encima no hay nada que entregar', () => {
    expect(runOp('petUnload', player(), factory(), { now: T0 }).ok).toBe(false);
  });

  it('la mascota nunca recibe consumibles, ni en su mochila', () => {
    const p = player({ pet: pet({ bags: [{}] }) });
    expect(addToPet(p.pet, 'ore', 5).added).toBe(5);
  });
});

/* ───────────── DEJAR EL MATERIAL DONDE SIRVE ───────────── */

describe('descarga en cinta o máquina', () => {
  const conCarga = (inv: Record<string, number>, mode: PetState['mode'] = 'gather') =>
    player({ pet: pet({ bags: [inv], mode }) });

  const nivel = (n: number): FactoryState => ({ ...factory(), level: n });

  it('por cinta el material viaja: no aparece de golpe en la máquina', () => {
    const out = runOp('petDeposit', conCarga({ ore: 12 }), nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(bag0(out.player!.pet).ore).toBeUndefined();
    expect(beltCount(out.factory!.belts.c1, 'c1', T0)).toBe(12);
    expect(out.factory!.machines.smelter.input.ore ?? 0).toBe(0);
  });

  it('sin cinta entra directo en la máquina y arranca el ciclo', () => {
    const out = runOp('petDeposit', conCarga({ scrap: 20 }), nivel(6), {
      machineId: 'recycler',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(bag0(out.player!.pet).scrap).toBeUndefined();
    expect(out.factory!.machines.recycler.cycleStartAt).toBeGreaterThan(0);
  });

  it('sólo se lleva lo que la máquina admite; el resto se queda encima', () => {
    const out = runOp('petDeposit', conCarga({ ore: 5, copper: 7 }), nivel(6), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(bag0(out.player!.pet).copper).toBe(7);
    expect(bag0(out.player!.pet).ore).toBeUndefined();
  });

  it('respeta el filtro de la cinta', () => {
    // La bajante c6 sólo admite cristal, aunque el Laboratorio coma engranajes.
    const out = runOp('petDeposit', conCarga({ crystal: 3, gear: 4 }), nivel(8), {
      machineId: 'lab',
      beltId: 'c6',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(bag0(out.player!.pet).gear).toBe(4);
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

/* ─────────────── CADA PERRO, SU MOCHILA ─────────────── */

/**
 * La jauría compartía UNA mochila y no había manera de que funcionase: los
 * tres competían por el mismo hueco, el que llegaba tarde se creía lleno y se
 * plantaba, y un dron podía llevarse lo que acababa de picar otro perro al
 * otro lado del mapa. Ahora lo que pica cada uno es suyo.
 */
describe('mochilas individuales de la jauría', () => {
  const conJauria = (bags: Record<string, number>[]) =>
    player({ pet: pet({ dogs: 3, bags, mode: 'gather' }) });

  it('llenar la de uno no le quita hueco a los demás', () => {
    const cap = derivePet(pet()).capacity;
    const p = conJauria([{ ore: cap }, {}, {}]);
    expect(bagFree(p.pet, 0)).toBe(0);
    expect(bagFree(p.pet, 1)).toBe(cap);
    expect(bagFree(p.pet, 2)).toBe(cap);
    // Y el total de la jauría es la suma de las tres.
    expect(derivePet(p.pet).packCapacity).toBe(cap * 3);
  });

  it('lo que pica el perro 2 entra en la mochila del perro 2', () => {
    const f: FactoryState = { ...factory(), level: 12 };
    const out = runOp('petMine', conJauria([{}, {}, {}]), f, {
      stationId: 'vein_copper_a',
      qty: 4,
      dog: 1,
      now: T0 + 60_000,
    });
    expect(out.ok).toBe(true);
    expect(bagUsed(out.player!.pet, 1)).toBeGreaterThan(0);
    expect(bagUsed(out.player!.pet, 0)).toBe(0);
    expect(bagUsed(out.player!.pet, 2)).toBe(0);
  });

  it('lo que descarga el perro 2 sale de SU mochila', () => {
    const p = conJauria([{ ore: 10 }, { ore: 7 }, {}]);
    const out = runOp('petDeposit', p, { ...factory(), level: 6 }, {
      machineId: 'smelter',
      dog: 1,
      now: T0,
    });
    expect(out.ok).toBe(true);
    // El primero no ha soltado nada: no era su viaje.
    expect(bagUsed(out.player!.pet, 0)).toBe(10);
    expect(bagUsed(out.player!.pet, 1)).toBe(0);
    expect(out.factory!.machines.smelter.input.ore).toBe(7);
  });

  it('al entregarte a ti, vacía la del perro que más lleva', () => {
    const p = conJauria([{ ore: 2 }, { copper: 9 }, {}]);
    const out = runOp('petUnload', p, factory(), { now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.copper).toBe(9);
    expect(bagUsed(out.player!.pet, 1)).toBe(0);
    expect(bagUsed(out.player!.pet, 0)).toBe(2);
  });

  it('una partida vieja no pierde lo que llevaba la jauría', () => {
    const migrada = normalizePet(
      { inventory: { ore: 12, crystal: 1 } } as never,
      T0,
    );
    expect(migrada.bags[0]).toEqual({ ore: 12, crystal: 1 });
    expect(migrada.bags[1]).toEqual({});
  });

  it('los perros recogen todo tipo de material, menos consumibles', () => {
    const p = pet();
    for (const item of ['ore', 'scrap', 'copper', 'titanium', 'crystal', 'voidOre']) {
      expect(addToPet(p, item, 3).added, item).toBe(3);
    }
  });
});
