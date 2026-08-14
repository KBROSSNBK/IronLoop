import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config/robots';
import { MACHINES } from '../src/config/machines';
import { conveyorLoadPoint, CONVEYORS as BELTS } from '../src/config/world';
import { getSolids, rectsOverlap } from '../src/game/world/geometry';
import { robotVisual } from '../src/game/logic/robots';

/** Caja del robot, para comprobar que no se empotra en nada. */
const BODY = { w: 26, h: 22 };

function collides(x: number, y: number): boolean {
  const r = { x: x - BODY.w / 2, y: y - BODY.h / 2, w: BODY.w, h: BODY.h };
  return getSolids().some((s) => rectsOverlap(r, s));
}

describe('recorridos de los robots', () => {
  it('cada robot arranca en el frente de su máquina de origen', () => {
    for (const def of ROBOTS) {
      const m = MACHINES[def.from as keyof typeof MACHINES];
      const frontY = (m.ty + m.th - 0.5) * 40;
      const start = def.path[0];
      // El punto de carga está justo delante de la máquina, no dentro.
      expect(start.y).toBeGreaterThanOrEqual(frontY - 20);
      expect(start.x).toBeGreaterThan(m.tx * 40 - 40);
      expect(start.x).toBeLessThan((m.tx + m.tw) * 40 + 40);
    }
  });

  it('cada robot termina junto al extremo de carga de su cinta', () => {
    for (const def of ROBOTS) {
      const belt = BELTS.find((c) => c.id === def.viaConveyor);
      expect(belt, `falta la cinta ${def.viaConveyor}`).toBeTruthy();
      const load = conveyorLoadPoint(belt!);
      const end = def.path[def.path.length - 1];
      expect(Math.hypot(end.x - load.x, end.y - load.y)).toBeLessThan(60);
    }
  });

  it('la cinta de cada robot alimenta la máquina de destino', () => {
    for (const def of ROBOTS) {
      const belt = BELTS.find((c) => c.id === def.viaConveyor)!;
      expect(belt.feeds).toBe(def.to);
    }
  });

  it('ningún punto del recorrido atraviesa muros ni máquinas', () => {
    for (const def of ROBOTS) {
      const len = def.path.length;
      for (let i = 1; i < len; i++) {
        const a = def.path[i - 1];
        const b = def.path[i];
        const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          expect(
            collides(x, y),
            `${def.id} choca en (${Math.round(x)}, ${Math.round(y)})`,
          ).toBe(false);
        }
      }
    }
  });

  it('sin material, el robot espera parado en el origen', () => {
    for (const def of ROBOTS) {
      const v = robotVisual(def, false, 12.34);
      expect(v.phase).toBe('idle');
      expect(v.carrying).toBe(false);
      expect(v).toMatchObject({ x: def.path[0].x, y: def.path[0].y });
    }
  });

  it('con material, hace un viaje de ida y vuelta completo', () => {
    const def = ROBOTS[0];
    const phases = new Set<string>();
    let llegóAlFinal = false;
    let volvióAlOrigen = false;
    for (let i = 0; i < 400; i++) {
      const v = robotVisual(def, true, i * 0.05);
      phases.add(v.phase);
      const end = def.path[def.path.length - 1];
      if (Math.hypot(v.x - end.x, v.y - end.y) < 4) llegóAlFinal = true;
      if (v.phase === 'returning' && Math.hypot(v.x - def.path[0].x, v.y - def.path[0].y) < 12) {
        volvióAlOrigen = true;
      }
    }
    expect(phases.has('loading')).toBe(true);
    expect(phases.has('outbound')).toBe(true);
    expect(phases.has('unloading')).toBe(true);
    expect(phases.has('returning')).toBe(true);
    expect(llegóAlFinal).toBe(true);
    expect(volvióAlOrigen).toBe(true);
  });

  it('lleva carga sólo en la ida, nunca en la vuelta', () => {
    const def = ROBOTS[0];
    for (let i = 0; i < 400; i++) {
      const v = robotVisual(def, true, i * 0.05);
      if (v.phase === 'outbound' || v.phase === 'unloading') expect(v.carrying).toBe(true);
      if (v.phase === 'returning' || v.phase === 'loading') expect(v.carrying).toBe(false);
    }
  });

  it('el robot nunca se sale del recorrido definido', () => {
    for (const def of ROBOTS) {
      for (let i = 0; i < 200; i++) {
        const v = robotVisual(def, true, i * 0.07);
        expect(collides(v.x, v.y)).toBe(false);
      }
    }
  });
});

describe('cintas', () => {
  it('las cintas con destino apuntan a máquinas reales', () => {
    for (const belt of BELTS) {
      if (!belt.feeds) continue;
      expect(Object.keys(MACHINES)).toContain(belt.feeds);
    }
  });

  it('el punto de carga cae dentro de la propia cinta', () => {
    for (const belt of BELTS) {
      const p = conveyorLoadPoint(belt);
      const horizontal = belt.dir === 'left' || belt.dir === 'right';
      const w = (horizontal ? belt.len : 0.7) * 40;
      const h = (horizontal ? 0.7 : belt.len) * 40;
      expect(p.x).toBeGreaterThanOrEqual(belt.tx * 40 - 1);
      expect(p.x).toBeLessThanOrEqual(belt.tx * 40 + w + 1);
      expect(p.y).toBeGreaterThanOrEqual(belt.ty * 40 - 1);
      expect(p.y).toBeLessThanOrEqual(belt.ty * 40 + h + 1);
    }
  });
});
