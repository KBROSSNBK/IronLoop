import { describe, expect, it } from 'vitest';
import { factoryNeeds, shareNeeds } from '../src/game/logic/needs';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { PetBrain } from '../src/game/systems/petBrain';
import { derivePet, DEFAULT_PET } from '../src/config/pets';
import { stationWorkPoint, stationYield } from '../src/game/logic/pet';
import { STATIONS, isOffworld } from '../src/config/world';
import { MACHINES } from '../src/config/machines';
import type { FactoryState, MachineState } from '../src/types';

const T0 = 1_700_000_000_000;

const vacia = (): MachineState => ({
  level: 0,
  cycles: 0,
  cycleStartAt: 0,
  input: {},
  output: {},
});

const factory = (over: Partial<FactoryState> = {}): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  level: 12,
  ...over,
});

/* ─────────────────── QUÉ ESTÁ ESPERANDO LA FÁBRICA ─────────────────── */

describe('lo que le falta a la fábrica', () => {
  it('sólo propone materiales que salgan de una veta', () => {
    const needs = factoryNeeds(factory(), T0);
    expect(needs.length).toBeGreaterThan(0);
    // Lingotes o circuitos hacen falta, pero no se pican: los fabrica otra
    // máquina, así que mandar allí a un perro no serviría de nada.
    for (const n of needs) {
      expect(['ore', 'scrap', 'copper', 'titanium', 'crystal']).toContain(n.item);
    }
  });

  it('primero lo que desatasca una máquina de golpe', () => {
    const base = createFactoryState('f1', 1, T0);
    const f = factory({
      machines: {
        ...base.machines,
        // A la Fundidora le falta UN mineral: dárselo la pone a producir ya.
        smelter: { ...vacia(), input: { ore: 1 } },
        // Al Reactor le falta de todo: darle una pieza no cambia nada.
        reactor: { ...vacia(), input: {} },
      },
    });
    const needs = factoryNeeds(f, T0);
    expect(needs[0].item).toBe('ore');
    expect(needs[0].machineId).toBe('smelter');
    expect(needs[0].otherMissing).toBe(0);
  });

  it('una máquina servida deja de pedir', () => {
    const base = createFactoryState('f1', 1, T0);
    const lleno: Record<string, MachineState> = {};
    for (const [id, def] of Object.entries(MACHINES)) {
      lleno[id] = { ...vacia(), input: { ...def.input } };
    }
    const f = factory({ machines: { ...base.machines, ...lleno } });
    expect(factoryNeeds(f, T0)).toHaveLength(0);
  });

  it('no pide material del otro mundo, ni al revés', () => {
    const f = factory({ level: 20 });
    const enLaEstacion = factoryNeeds(f, T0, 200);
    expect(enLaEstacion.some((n) => n.item === 'voidOre')).toBe(false);
    expect(enLaEstacion.some((n) => n.item === 'ore')).toBe(true);

    const enElPlaneta = factoryNeeds(f, T0, stationWorkPoint(
      STATIONS.find((s) => s.id === 'vein_void_a')!,
    ).y);
    expect(enElPlaneta.every((n) => ['voidOre', 'stellarGas'].includes(n.item))).toBe(true);
  });

  it('las máquinas bloqueadas por nivel no piden nada', () => {
    const needs = factoryNeeds(factory({ level: 1 }), T0);
    // A nivel 1 sólo existe la Fundidora: nada de cobre ni titanio.
    expect(needs.every((n) => n.item === 'ore')).toBe(true);
  });
});

/* ─────────────────── REPARTO ENTRE LOS PERROS ─────────────────── */

describe('reparto de encargos automáticos', () => {
  it('cada perro coge una necesidad distinta mientras haya', () => {
    const needs = factoryNeeds(factory(), T0);
    const reparto = shareNeeds(needs, 3);
    expect(reparto).toHaveLength(3);
    expect(new Set(reparto).size).toBeGreaterThan(1);
  });

  it('sin nada que hacer, nadie recibe encargo', () => {
    expect(shareNeeds([], 3)).toEqual([null, null, null]);
  });

  it('con una sola necesidad, van todos a ella', () => {
    const una = [{ item: 'ore', machineId: 'smelter', missing: 2, otherMissing: 0 }];
    expect(shareNeeds(una, 2)).toEqual(['ore', 'ore']);
  });
});

/* ─────────────────── EL PERRO OBEDECE EL ENCARGO ─────────────────── */

describe('la mascota extrae lo que se le pide', () => {
  const derived = derivePet(DEFAULT_PET);
  const base = {
    dt: 0.016,
    derived,
    storedUnits: 0,
    otherPending: 0,
    mode: 'gather' as const,
    hasDrones: false,
    ownerHasRoom: true,
    dropOff: null,
  };

  const enVeta = (id: string) => stationWorkPoint(STATIONS.find((s) => s.id === id)!);

  it('va a una veta que dé EXACTAMENTE el material encargado', () => {
    for (const item of ['ore', 'scrap', 'copper', 'titanium']) {
      const b = new PetBrain(0);
      const start = enVeta('vein_a');
      b.reset(start.x, start.y);
      b.x = start.x;
      b.y = start.y;
      b.update(T0, {
        ...base,
        ownerX: start.x,
        ownerY: start.y,
        target: item,
        autoTarget: null,
      });
      expect(b.station, `sin veta para ${item}`).not.toBeNull();
      expect(stationYield(b.station!).item).toBe(item);
    }
  });

  it('en automático va a por lo que la fábrica está esperando', () => {
    const b = new PetBrain(0);
    // Plantada en la veta de hierro, pero lo que hace falta es cobre.
    const start = enVeta('vein_a');
    b.reset(start.x, start.y);
    b.x = start.x;
    b.y = start.y;
    b.update(T0, {
      ...base,
      ownerX: start.x,
      ownerY: start.y,
      target: null,
      autoTarget: 'copper',
    });
    expect(stationYield(b.station!).item).toBe('copper');
  });

  it('sin encargo ni necesidad, pica lo que tiene al lado', () => {
    const b = new PetBrain(0);
    const start = enVeta('vein_a');
    b.reset(start.x, start.y);
    b.x = start.x;
    b.y = start.y;
    b.update(T0, {
      ...base,
      ownerX: start.x,
      ownerY: start.y,
      target: null,
      autoTarget: null,
    });
    expect(stationYield(b.station!).item).toBe('ore');
  });

  it('lo que pide liquidar es lo que da esa veta, no otra cosa', () => {
    const b = new PetBrain(0);
    const start = enVeta('vein_copper_a');
    b.reset(start.x, start.y);
    b.x = start.x;
    b.y = start.y;
    let minado: { stationId: string; item: string; qty: number } | null = null;
    for (let i = 0; i < 400 && !minado; i++) {
      const ev = b.update(T0 + i * 50, {
        ...base,
        dt: 0.05,
        ownerX: start.x,
        ownerY: start.y,
        target: 'copper',
        autoTarget: null,
      });
      if (ev.mined) minado = ev.mined;
    }
    expect(minado).not.toBeNull();
    expect(minado!.item).toBe('copper');
    expect(minado!.stationId).toBe('vein_copper_a');
    expect(isOffworld(start.y)).toBe(false);
  });
});
