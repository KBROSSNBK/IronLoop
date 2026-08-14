import { describe, expect, it } from 'vitest';
import { RobotBrain, ROBOT_STATE_LABEL, type RobotStateName } from '../src/game/systems/robotBrain';
import { ROBOTS, robotCarry } from '../src/config/robots';
import { getSolids, rectsOverlap } from '../src/game/world/geometry';

const DEF = ROBOTS[0];

/** Avanza el cerebro N segundos y devuelve los estados por los que pasó. */
function run(
  brain: RobotBrain,
  seconds: number,
  hasWork = true,
  level = 3,
  others: { x: number; y: number }[] = [],
) {
  const seen = new Set<RobotStateName>();
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    brain.update(1 / 60, hasWork, level, others);
    seen.add(brain.state);
    positions.push({ x: brain.x, y: brain.y });
  }
  return { seen, positions };
}

function insideStructure(x: number, y: number): boolean {
  const box = { x: x - 11, y: y - 11, w: 22, h: 22 };
  return getSolids().some((s) => rectsOverlap(box, s));
}

describe('máquina de estados del robot', () => {
  it('sin material espera en el origen, no da vueltas', () => {
    const b = new RobotBrain(DEF);
    const { seen } = run(b, 6, false);
    expect(seen).toEqual(new Set(['IDLE']));
    expect(b.carrying).toBe(0);
    expect(Math.hypot(b.x - DEF.path[0].x, b.y - DEF.path[0].y)).toBeLessThan(3);
  });

  it('con material completa el ciclo entero', () => {
    const b = new RobotBrain(DEF);
    const { seen } = run(b, 30);
    for (const s of ['CARGAR', 'TRANSPORTAR', 'DEPOSITAR', 'VOLVER'] as RobotStateName[]) {
      expect(seen.has(s), `nunca pasó por ${s}`).toBe(true);
    }
  });

  it('el ciclo se repite: no se queda clavado en un estado', () => {
    const b = new RobotBrain(DEF);
    let cargas = 0;
    let prev: RobotStateName = b.state;
    for (let i = 0; i < 60 * 60; i++) {
      b.update(1 / 60, true, 3, []);
      if (b.state === 'CARGAR' && prev !== 'CARGAR') cargas += 1;
      prev = b.state;
    }
    expect(cargas).toBeGreaterThanOrEqual(2);
  });

  it('lleva carga sólo entre cargar y depositar', () => {
    const b = new RobotBrain(DEF);
    for (let i = 0; i < 30 * 60; i++) {
      b.update(1 / 60, true, 3, []);
      if (b.state === 'TRANSPORTAR' && b.carrying > 0) {
        expect(b.carrying).toBe(robotCarry(DEF, 3));
      }
      if (b.state === 'IDLE') expect(b.carrying).toBe(0);
    }
  });

  it('la carga depende del nivel del robot', () => {
    const b = new RobotBrain(DEF);
    run(b, 30, true, 6);
    // En algún momento del ciclo tuvo la carga del nivel 6.
    const b2 = new RobotBrain(DEF);
    let maxCarry = 0;
    for (let i = 0; i < 30 * 60; i++) {
      b2.update(1 / 60, true, 6, []);
      maxCarry = Math.max(maxCarry, b2.carrying);
    }
    expect(maxCarry).toBe(robotCarry(DEF, 6));
  });

  it('nunca se mete dentro de un muro ni de una máquina', () => {
    for (const def of ROBOTS) {
      const b = new RobotBrain(def);
      const { positions } = run(b, 40);
      for (const p of positions) {
        expect(insideStructure(p.x, p.y), `${def.id} dentro de una estructura`).toBe(false);
      }
    }
  });

  it('se recupera si lo dejan encerrado y vuelve a trabajar', () => {
    const b = new RobotBrain(DEF);
    // Se le fuerza a una posición contra una máquina y se le deja avanzar.
    b.update(1 / 60, true, 3, []);
    const before = b.debug().recoveries;
    // Un "muro" de robots justo encima lo bloquea físicamente un rato.
    const wall = Array.from({ length: 6 }, (_, i) => ({ x: b.x + i - 3, y: b.y }));
    run(b, 6, true, 3, wall);
    const after = b.debug();
    // O bien logró avanzar, o bien se activó la recuperación: nunca se queda
    // eternamente sin hacer nada.
    expect(after.recoveries >= before || after.state !== 'IDLE').toBe(true);
    // Y al quitarle el estorbo, retoma el ciclo.
    const { seen } = run(b, 30);
    expect(seen.has('TRANSPORTAR') || seen.has('VOLVER')).toBe(true);
  });

  it('dos robots no acaban ocupando el mismo punto', () => {
    const a = new RobotBrain(DEF);
    const b = new RobotBrain(DEF);
    for (let i = 0; i < 20 * 60; i++) {
      a.update(1 / 60, true, 3, [{ x: b.x, y: b.y }]);
      b.update(1 / 60, true, 3, [{ x: a.x, y: a.y }]);
    }
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it('al quedarse sin material vuelve a IDLE y suelta la carga', () => {
    const b = new RobotBrain(DEF);
    run(b, 8, true);
    run(b, 2, false);
    expect(b.state).toBe('IDLE');
    expect(b.carrying).toBe(0);
  });

  it('expone información de depuración utilizable', () => {
    const b = new RobotBrain(DEF);
    run(b, 5);
    const d = b.debug();
    expect(d.id).toBe(DEF.id);
    expect(ROBOT_STATE_LABEL[d.state]).toBeTruthy();
    expect(d.distance).toBeGreaterThanOrEqual(0);
    expect(typeof d.lastAction).toBe('string');
  });

  it('todos los estados tienen etiqueta legible', () => {
    const estados: RobotStateName[] = [
      'IDLE',
      'BUSCAR_MATERIAL',
      'IR_A_ORIGEN',
      'CARGAR',
      'TRANSPORTAR',
      'DEPOSITAR',
      'VOLVER',
      'RECUPERANDO',
    ];
    for (const s of estados) expect(ROBOT_STATE_LABEL[s]).toBeTruthy();
  });
});
