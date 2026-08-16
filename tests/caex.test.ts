import { describe, expect, it } from 'vitest';
import {
  CAEX,
  CAEX_STATS,
  DEFAULT_CAEX,
  caexFree,
  caexUsed,
  deriveCaex,
  normalizeCaex,
  type CaexState,
} from '../src/config/caex';
import { CaexBrain, caexRoute } from '../src/game/systems/caexBrain';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { PET_STATIONS, stationWorkPoint, stationYield } from '../src/game/logic/pet';
import { STATIONS, isOffworld } from '../src/config/world';
import { beltCount } from '../src/game/logic/belts';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

const caex = (over: Partial<CaexState> = {}): CaexState => ({
  ...DEFAULT_CAEX,
  owned: true,
  skins: [...DEFAULT_CAEX.skins],
  stats: {},
  bag: {},
  lastAt: T0,
  ...over,
});

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'a', displayName: 'A', photoURL: null, email: null }, T0),
  ...over,
});

const factory = (over: Partial<FactoryState> = {}): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  level: 12,
  ...over,
});

/* ─────────────────────────── CONFIGURACIÓN ─────────────────────────── */

describe('configuración del CAEX', () => {
  it('un jugador nuevo no lo tiene: hay que comprarlo', () => {
    const p = createPlayerState({ uid: 'x', displayName: 'X', photoURL: null, email: null }, T0);
    expect(p.caex.owned).toBe(false);
    expect(p.caex.mode).toBe('route');
  });

  it('tolva y cuchara suben sin tope y el precio crece', () => {
    for (const def of CAEX_STATS) {
      expect(def.cost(6)).toBeGreaterThan(def.cost(0));
      // Sin tope: al nivel 200 sigue habiendo siguiente.
      expect(def.cost(200)).toBeGreaterThan(0);
    }
    const base = deriveCaex(caex());
    expect(deriveCaex(caex({ stats: { capacity: 5 } })).capacity).toBeGreaterThan(base.capacity);
    expect(deriveCaex(caex({ stats: { mining: 5 } })).minePerSec).toBeGreaterThan(base.minePerSec);
  });

  it('su dron mejora carga y velocidad', () => {
    const uno = deriveCaex(caex({ drone: true, droneLevel: 1 }));
    const cinco = deriveCaex(caex({ drone: true, droneLevel: 5 }));
    expect(cinco.droneCarry).toBeGreaterThan(uno.droneCarry);
    expect(cinco.droneSpeed).toBeGreaterThan(uno.droneSpeed);
    // Mueve bastante más que un dron de perro, que para eso es del camión.
    expect(uno.droneCarry).toBeGreaterThan(20);
  });

  it('repara documentos incompletos sin inventarse nada', () => {
    const fixed = normalizeCaex({ skin: 'inventado' } as never, T0);
    expect(fixed.skin).toBe('srt');
    expect(fixed.owned).toBe(false);
    expect(fixed.bag).toEqual({});
  });
});

/* ─────────────────────────── LA RONDA ─────────────────────────── */

describe('la ronda del CAEX', () => {
  it('pasa por TODAS las zonas de recolección de su mundo', () => {
    const ruta = caexRoute(400);
    const deCasa = PET_STATIONS.filter((s) => !isOffworld(stationWorkPoint(s).y));
    expect(ruta).toHaveLength(deCasa.length);
    expect(new Set(ruta.map((s) => s.id)).size).toBe(deCasa.length);
  });

  it('en el planeta hace la ronda del planeta, no la de casa', () => {
    const alla = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_void_a')!);
    const ruta = caexRoute(alla.y);
    expect(ruta.length).toBeGreaterThan(0);
    for (const s of ruta) expect(isOffworld(stationWorkPoint(s).y)).toBe(true);
  });

  it('carga en la parada y luego sigue a la siguiente', () => {
    const b = new CaexBrain();
    const inicio = stationWorkPoint(PET_STATIONS[0]);
    b.reset(inicio.x, inicio.y - 30);
    const derived = deriveCaex(caex());

    const visitadas = new Set<string>();
    let cargado = 0;
    for (let i = 0; i < 4000; i++) {
      const ev = b.update(T0 + i * 50, {
        dt: 0.05,
        derived,
        storedUnits: cargado,
        mode: 'route',
        hasDrone: false,
        dropOff: null,
        dwellMs: 1500,
      });
      if (b.station) visitadas.add(b.station.id);
      if (ev.mined) {
        cargado += ev.mined.qty;
        b.confirmMined(ev.mined.qty);
      }
      if (visitadas.size >= 3) break;
    }
    // Ha cambiado de parada al menos dos veces y ha cargado por el camino.
    expect(visitadas.size).toBeGreaterThanOrEqual(3);
    expect(cargado).toBeGreaterThan(0);
  });

  it('aparcado en el taller no hace nada', () => {
    const b = new CaexBrain();
    b.reset(500, 500);
    const antes = { x: b.x, y: b.y };
    for (let i = 0; i < 60; i++) {
      b.update(T0 + i * 50, {
        dt: 0.05,
        derived: deriveCaex(caex()),
        storedUnits: 0,
        mode: 'off',
        hasDrone: false,
        dropOff: null,
        dwellMs: 3000,
      });
    }
    expect(b.state).toBe('PARADO');
    expect(b.x).toBe(antes.x);
    expect(b.y).toBe(antes.y);
  });
});

/* ─────────────────────────── OPERACIONES ─────────────────────────── */

describe('operaciones del CAEX', () => {
  it('no se puede comprar antes de tiempo ni sin dinero', () => {
    expect(
      runOp('buyCaex', player({ money: 10 ** 7 }), factory({ level: 1 }), { now: T0 }).ok,
    ).toBe(false);
    expect(runOp('buyCaex', player({ money: 10 }), factory(), { now: T0 }).ok).toBe(false);
  });

  it('comprarlo cuesta dinero y lo deja en ruta', () => {
    const out = runOp('buyCaex', player({ money: 10 ** 7 }), factory(), { now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.caex.owned).toBe(true);
    expect(out.player!.money).toBe(10 ** 7 - CAEX.cost);
    // Y como toda compra, empuja el progreso compartido.
    expect(out.factory!.totalContribution).toBeGreaterThan(0);
  });

  it('carga en SU tolva, acotado por el tiempo transcurrido', () => {
    const p = player({ caex: caex({ lastAt: T0 }) });
    const out = runOp('caexMine', p, factory(), {
      stationId: 'vein_a',
      qty: 5,
      now: T0 + 10_000,
    });
    expect(out.ok).toBe(true);
    expect(caexUsed(out.player!.caex)).toBeGreaterThan(0);
    expect(caexUsed(out.player!.caex)).toBeLessThanOrEqual(5);
    // El inventario del jugador ni se toca: la tolva es del camión.
    expect(Object.keys(out.player!.inventory)).toHaveLength(0);
  });

  it('no se puede reclamar más de lo que da el tiempo', () => {
    const p = player({ caex: caex({ lastAt: T0 }) });
    const out = runOp('caexMine', p, factory(), { stationId: 'vein_a', qty: 9999, now: T0 + 500 });
    expect(out.ok).toBe(true);
    const derived = deriveCaex(p.caex);
    expect(caexUsed(out.player!.caex)).toBeLessThan(derived.minePerSec * 5);
  });

  it('nunca pasa de la tolva por mucho que insista', () => {
    const cap = deriveCaex(caex()).capacity;
    const p = player({ caex: caex({ lastAt: T0 - 10 ** 7 }) });
    const out = runOp('caexMine', p, factory(), { stationId: 'vein_a', qty: 10 ** 6, now: T0 });
    expect(caexUsed(out.player!.caex)).toBe(cap);
    expect(caexFree(out.player!.caex)).toBe(0);
  });

  it('aparcado no carga', () => {
    const p = player({ caex: caex({ mode: 'off' }) });
    expect(
      runOp('caexMine', p, factory(), { stationId: 'vein_a', qty: 3, now: T0 + 5000 }).ok,
    ).toBe(false);
  });

  it('bascula la tolva en la cinta y el material viaja', () => {
    const p = player({ caex: caex({ bag: { ore: 30 } }) });
    const out = runOp('caexDeposit', p, factory({ level: 6 }), {
      machineId: 'smelter',
      beltId: 'c1',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(caexUsed(out.player!.caex)).toBe(0);
    expect(beltCount(out.factory!.belts.c1, 'c1', T0)).toBe(30);
  });

  it('sólo suelta lo que la máquina admite; el resto se queda en la tolva', () => {
    const p = player({ caex: caex({ bag: { ore: 10, copper: 6 } }) });
    const out = runOp('caexDeposit', p, factory({ level: 6 }), {
      machineId: 'smelter',
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.caex.bag.copper).toBe(6);
    expect(out.player!.caex.bag.ore).toBeUndefined();
  });

  it('su dron sólo se lleva lo que le cabe en el viaje', () => {
    const p = player({ caex: caex({ bag: { ore: 40 }, drone: true }) });
    const out = runOp('caexDeposit', p, factory({ level: 6 }), {
      machineId: 'smelter',
      items: { ore: 12 },
      limit: 12,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.caex.bag.ore).toBe(28);
    expect(out.factory!.machines.smelter.input.ore).toBe(12);
  });

  it('carga todo tipo de material, como los perros', () => {
    for (const s of PET_STATIONS.filter((x) => !isOffworld(stationWorkPoint(x).y))) {
      const p = player({ caex: caex({ lastAt: T0 - 60_000 }) });
      const out = runOp('caexMine', p, factory({ level: 12 }), {
        stationId: s.id,
        qty: 2,
        now: T0,
      });
      expect(out.ok, s.id).toBe(true);
      expect(out.player!.caex.bag[stationYield(s).item]).toBeGreaterThan(0);
    }
  });
});
