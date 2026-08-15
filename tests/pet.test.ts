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
  isPetStation,
  nearestStation,
  PET_STATIONS,
  stationWorkPoint,
  stationYield,
  unloadPet,
} from '../src/game/logic/pet';
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
    expect(p.pet.active).toBe(true);
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
      active: true,
      ownerHasRoom: true,
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
      active: true,
      ownerHasRoom: true,
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
      active: true,
      ownerHasRoom: true,
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
      active: true,
      ownerHasRoom: true,
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
      active: false,
      ownerHasRoom: true,
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
        active: true,
        ownerHasRoom: true,
      });
      if (ev.mined) mined = ev.mined;
    }
    expect(mined?.stationId).toBe('vein_a');
    expect(mined!.qty).toBeGreaterThan(0);
    // Nunca acumula más de lo que le cabe.
    expect(b.pending).toBeLessThanOrEqual(derived.capacity);
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
        active: true,
        ownerHasRoom: true,
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

  it('se puede mandar a reposo y volver a desplegar', () => {
    const off = runOp('setPetLook', player(), factory(), { active: false, now: T0 });
    expect(off.player!.pet.active).toBe(false);
    const on = runOp('setPetLook', off.player!, off.factory!, { active: true, now: T0 });
    expect(on.player!.pet.active).toBe(true);
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

  it('en reposo no puede reclamar nada', () => {
    const p = player({ pet: pet({ active: false }) });
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
});
