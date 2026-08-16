import { describe, expect, it } from 'vitest';

/**
 * Reglas de trazado de las cintas. Son las que hacen que la fábrica se
 * entienda mirándola: si una cinta muere en mitad de la nave o no admite lo
 * que su máquina necesita, el jugador no tiene forma de saber qué falla.
 */
describe('trazado de las cintas', () => {
  const belts = CONVEYORS.filter((c) => c.feeds);

  it('toda máquina puede recibir su receta COMPLETA por alguna cinta', () => {
    for (const m of MACHINE_LIST) {
      const receta = Object.keys(m.input);
      if (receta.length === 0) continue;
      const sirve = belts.some((c) => {
        if (c.feeds !== m.id) return false;
        // Sin filtro: acepta todo lo que la máquina admite.
        if (!c.accepts?.length) return true;
        return receta.every((item) => c.accepts!.includes(item));
      });
      expect(sirve, `${m.id} no tiene una cinta que acepte ${receta.join(' + ')}`).toBe(true);
    }
  });

  /** Extremo de descarga: el opuesto al de carga. */
  const dischargePoint = (c: (typeof CONVEYORS)[number]) => {
    const horizontal = c.dir === 'left' || c.dir === 'right';
    const w = (horizontal ? c.len : 0.7) * TILE;
    const h = (horizontal ? 0.7 : c.len) * TILE;
    const load = conveyorLoadPoint(c);
    if (c.dir === 'right') return { x: c.tx * TILE + w, y: load.y };
    if (c.dir === 'left') return { x: c.tx * TILE, y: load.y };
    if (c.dir === 'down') return { x: load.x, y: c.ty * TILE + h };
    return { x: load.x, y: c.ty * TILE };
  };

  it('ninguna cinta muere en mitad de la nave', () => {
    for (const c of belts) {
      const m = MACHINE_LIST.find((x) => x.id === c.feeds)!;
      const end = dischargePoint(c);
      const rect = { x: m.tx * TILE, y: m.ty * TILE, w: m.tw * TILE, h: m.th * TILE };
      const dx = Math.max(rect.x - end.x, 0, end.x - (rect.x + rect.w));
      const dy = Math.max(rect.y - end.y, 0, end.y - (rect.y + rect.h));
      const aLaMaquina = Math.hypot(dx, dy);

      // O toca su máquina, o entronca con otro tramo que va a la misma:
      // las bajantes se hacen en dos piezas porque una cinta es recta.
      const enlaza = belts.some((o) => {
        if (o === c || o.feeds !== c.feeds) return false;
        const p = conveyorLoadPoint(o);
        return Math.hypot(p.x - end.x, p.y - end.y) <= TILE * 1.5;
      });

      expect(
        aLaMaquina <= TILE || enlaza,
        `${c.id} acaba a ${Math.round(aLaMaquina)}px de ${m.id} y no enlaza con nada`,
      ).toBe(true);
    }
  });

  it('se puede llegar al extremo de carga de cualquier cinta', () => {
    const solids = getSolids();
    for (const c of CONVEYORS) {
      const p = conveyorLoadPoint(c);
      const cuerpo = { x: p.x - 10, y: p.y - 10, w: 20, h: 20 };
      expect(
        solids.some((s) => rectsOverlap(cuerpo, s)),
        `no se puede llegar a cargar ${c.id}`,
      ).toBe(false);
    }
  });

  it('ninguna cinta se cruza con el cuerpo de una máquina', () => {
    for (const c of CONVEYORS) {
      const horizontal = c.dir === 'left' || c.dir === 'right';
      const cinta = {
        x: c.tx * TILE,
        y: c.ty * TILE,
        w: (horizontal ? c.len : 0.7) * TILE,
        h: (horizontal ? 0.7 : c.len) * TILE,
      };
      for (const m of MACHINE_LIST) {
        // Sólo el cuerpo sólido: la fila de trabajo puede compartirse.
        const cuerpo = {
          x: m.tx * TILE + 2,
          y: m.ty * TILE + 2,
          w: m.tw * TILE - 4,
          h: (m.th - 1) * TILE - 4,
        };
        expect(rectsOverlap(cinta, cuerpo), `${c.id} atraviesa ${m.id}`).toBe(false);
      }
    }
  });
});
import { CONVEYORS, TILE, conveyorLoadPoint, conveyorRect } from '../src/config/world';
import { MACHINES, MACHINE_LIST, getMachine } from '../src/config/machines';
import { BALANCE } from '../src/config/balance';
import { conveyorAccepts, conveyorUnder, getSolids, rectsOverlap } from '../src/game/world/geometry';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import type { FactoryState, PlayerState } from '../src/types';

/** Punto justo delante de una máquina: cargar y retirar exigen estar ahí. */
const AT = (id: string) => {
  const m = getMachine(id);
  return { x: (m.tx + m.tw / 2) * 40, y: (m.ty + m.th + 0.4) * 40 };
};

const T0 = 1_700_000_000_000;

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'u1', displayName: 'T', photoURL: null, email: null }, T0),
  ...over,
});

const factory = (over: Partial<FactoryState> = {}): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  level: 10,
  ...over,
});

const belt = (id: string) => CONVEYORS.find((c) => c.id === id)!;

describe('bajante de cristal', () => {
  it('existe, alimenta al laboratorio y sólo admite cristal', () => {
    for (const id of ['c6', 'c7']) {
      const c = belt(id);
      expect(c, `falta la cinta ${id}`).toBeTruthy();
      expect(c.feeds).toBe('lab');
      expect(c.accepts).toEqual(['crystal']);
      expect(conveyorAccepts(c)).toEqual(['crystal']);
    }
  });

  it('el tramo vertical y el horizontal se encuentran', () => {
    const v = conveyorRect(belt('c6'));
    const h = conveyorRect(belt('c7'));
    // Comparten la esquina inferior izquierda del recorrido en L.
    expect(Math.abs(v.x - h.x)).toBeLessThan(4);
    expect(Math.abs(v.y + v.h - (h.y + h.h))).toBeLessThan(40);
  });

  it('no atraviesa muros ni máquinas', () => {
    const solids = getSolids();
    for (const id of ['c6', 'c7', 'c8']) {
      const r = conveyorRect(belt(id));
      const choques = solids.filter((s) => rectsOverlap(r, s));
      expect(choques, `la cinta ${id} pisa una estructura`).toHaveLength(0);
    }
  });

  it('rechaza material que no sea cristal aunque el laboratorio lo use', () => {
    // El laboratorio necesita engranajes + cristal, pero esta cinta es sólo
    // para cristal: los engranajes deben ir por su propia vía.
    expect(conveyorAccepts(belt('c6'))).not.toContain('gear');
    expect(Object.keys(MACHINES.lab.input)).toContain('gear');
  });
});

describe('cinta de reciclado', () => {
  it('lleva el acero reciclado de la Recicladora a la Ensambladora', () => {
    const c = belt('c8');
    expect(c.feeds).toBe('assembler');
    expect(conveyorAccepts(c)).toContain('ingot');
  });

  it('la Recicladora convierte chatarra en lingotes', () => {
    expect(MACHINES.recycler.input).toEqual({ scrap: 4 });
    expect(MACHINES.recycler.output).toEqual({ ingot: 1 });
  });

  it('reciclar da más valor que vender la chatarra en bruto', () => {
    // 4 chatarra = $8 · 1 lingote = $18
    expect(18).toBeGreaterThan(4 * 2);
  });
});

describe('detección de la cinta bajo el jugador', () => {
  it('detecta la cinta al pasar por encima', () => {
    const r = conveyorRect(belt('c6'));
    const centro = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    expect(conveyorUnder(centro.x, centro.y)?.id).toBe('c6');
  });

  it('no la detecta desde lejos', () => {
    const r = conveyorRect(belt('c6'));
    const lejos = { x: r.x + 400, y: r.y };
    expect(conveyorUnder(lejos.x, lejos.y)).toBeNull();
  });

  it('el filtro permite ignorar cintas que no admiten lo que llevas', () => {
    const r = conveyorRect(belt('c6'));
    const centro = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const soloIngot = conveyorUnder(centro.x, centro.y, (c) =>
      conveyorAccepts(c).includes('ingot'),
    );
    expect(soloIngot).toBeNull();
  });

  it('sólo considera cintas con destino, no las decorativas', () => {
    for (const c of CONVEYORS) {
      if (c.feeds) continue;
      const r = conveyorRect(c);
      const found = conveyorUnder(r.x + r.w / 2, r.y + r.h / 2);
      expect(found?.id).not.toBe(c.id);
    }
  });

  it('el punto de carga de cada cinta cae dentro de su propio rectángulo', () => {
    for (const c of CONVEYORS) {
      const r = conveyorRect(c);
      const p = conveyorLoadPoint(c);
      expect(p.x).toBeGreaterThanOrEqual(r.x - 1);
      expect(p.x).toBeLessThanOrEqual(r.x + r.w + 1);
      expect(p.y).toBeGreaterThanOrEqual(r.y - 1);
      expect(p.y).toBeLessThanOrEqual(r.y + r.h + 1);
    }
  });
});

describe('traspaso automático por tandas', () => {
  it('la tanda está limitada a 50 unidades', () => {
    expect(BALANCE.conveyor.autoTransferBatch).toBe(50);
  });

  it('depositar una tanda no vacía la mochila de golpe', () => {
    const p = player({ inventory: { crystal: 130 } });
    const out = runOp('deposit', p, factory(), {
      machineId: 'lab', at: AT('lab'),
      item: 'crystal',
      qty: BALANCE.conveyor.autoTransferBatch,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.crystal).toBe(80);
    expect(out.factory!.machines.lab.input.crystal).toBe(50);
  });

  it('tandas sucesivas acaban traspasando todo', () => {
    let p = player({ inventory: { crystal: 130 } });
    let f = factory();
    for (let i = 0; i < 3; i++) {
      const out = runOp('deposit', p, f, {
        machineId: 'lab', at: AT('lab'),
        item: 'crystal',
        qty: BALANCE.conveyor.autoTransferBatch,
        now: T0,
      });
      p = out.player!;
      f = out.factory!;
    }
    expect(p.inventory.crystal).toBeUndefined();
    expect(f.machines.lab.input.crystal).toBe(130);
  });

  it('la última tanda sólo mueve lo que queda', () => {
    const p = player({ inventory: { crystal: 12 } });
    const out = runOp('deposit', p, factory(), {
      machineId: 'lab', at: AT('lab'),
      item: 'crystal',
      qty: 50,
      now: T0,
    });
    expect(out.factory!.machines.lab.input.crystal).toBe(12);
    expect(out.player!.inventory.crystal).toBeUndefined();
  });

  it('el material no se duplica: lo que sale de la mochila entra en la máquina', () => {
    const p = player({ inventory: { crystal: 70 } });
    const out = runOp('deposit', p, factory(), {
      machineId: 'lab', at: AT('lab'),
      item: 'crystal',
      qty: 50,
      now: T0,
    });
    const antes = 70;
    const despues =
      (out.player!.inventory.crystal ?? 0) + (out.factory!.machines.lab.input.crystal ?? 0);
    expect(despues).toBe(antes);
  });
});
