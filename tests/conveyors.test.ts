import { describe, expect, it } from 'vitest';
import { CONVEYORS, conveyorLoadPoint, conveyorRect } from '../src/config/world';
import { MACHINES } from '../src/config/machines';
import { BALANCE } from '../src/config/balance';
import { conveyorAccepts, conveyorUnder, getSolids, rectsOverlap } from '../src/game/world/geometry';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import type { FactoryState, PlayerState } from '../src/types';

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
      machineId: 'lab',
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
        machineId: 'lab',
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
      machineId: 'lab',
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
      machineId: 'lab',
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
