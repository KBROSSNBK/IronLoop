import { describe, expect, it } from 'vitest';
import {
  effectiveCycleMs,
  inputRoom,
  pendingCycles,
  settleMachine,
} from '../src/game/logic/production';
import { createMachineState } from '../src/game/logic/defaults';
import { MACHINES } from '../src/config/machines';
import type { MachineState } from '../src/types';

const T0 = 1_700_000_000_000;

function smelterWith(input: number, at = T0): MachineState {
  return { ...createMachineState(), input: { ore: input }, cycleStartAt: at };
}

describe('settleMachine — simulación determinista', () => {
  it('no produce nada antes de completar un ciclo', () => {
    const r = settleMachine(smelterWith(10), 'smelter', 1, T0 + 4000);
    expect(r.cyclesDone).toBe(0);
    expect(r.state.output.ingot).toBeUndefined();
    expect(r.running).toBe(true);
    expect(r.progress).toBeGreaterThan(0.9);
  });

  it('produce exactamente los ciclos que caben en el tiempo transcurrido', () => {
    const cycle = MACHINES.smelter.cycleMs;
    const r = settleMachine(smelterWith(10), 'smelter', 1, T0 + cycle * 3 + 100);
    expect(r.cyclesDone).toBe(3);
    expect(r.state.output.ingot).toBe(3);
    expect(r.state.input.ore).toBe(4); // 10 - 3*2
  });

  it('es idempotente: liquidar dos veces al mismo instante da lo mismo', () => {
    const cycle = MACHINES.smelter.cycleMs;
    const once = settleMachine(smelterWith(10), 'smelter', 1, T0 + cycle * 2);
    const twice = settleMachine(once.state, 'smelter', 1, T0 + cycle * 2);
    expect(twice.cyclesDone).toBe(0);
    expect(twice.state.output).toEqual(once.state.output);
    expect(twice.state.input).toEqual(once.state.input);
  });

  it('se detiene por falta de material y deja de acumular tiempo', () => {
    const cycle = MACHINES.smelter.cycleMs;
    const r = settleMachine(smelterWith(2), 'smelter', 1, T0 + cycle * 50);
    expect(r.cyclesDone).toBe(1);
    expect(r.blocked).toBe('no-input');
    expect(r.running).toBe(false);
    expect(r.state.cycleStartAt).toBe(0);
  });

  it('se atasca cuando el buffer de salida está lleno', () => {
    const cap = MACHINES.smelter.outputCap;
    const state: MachineState = {
      ...createMachineState(),
      input: { ore: 100 },
      output: { ingot: cap },
      cycleStartAt: T0,
    };
    const r = settleMachine(state, 'smelter', 1, T0 + 1_000_000);
    expect(r.blocked).toBe('output-full');
    expect(r.state.output.ingot).toBe(cap);
    expect(r.cyclesDone).toBe(0);
  });

  it('no produce si la máquina no está desbloqueada por nivel de fábrica', () => {
    const r = settleMachine(
      { ...createMachineState(), input: { ingot: 50 }, cycleStartAt: T0 },
      'assembler',
      1, // assembler requiere nivel 3
      T0 + 1_000_000,
    );
    expect(r.blocked).toBe('locked');
    expect(r.cyclesDone).toBe(0);
  });

  it('arranca sola cuando había material y estaba parada', () => {
    const stopped: MachineState = {
      ...createMachineState(),
      input: { ore: 4 },
      cycleStartAt: 0,
    };
    const r = settleMachine(stopped, 'smelter', 1, T0);
    expect(r.running).toBe(true);
    expect(r.state.cycleStartAt).toBe(T0);
  });

  it('el nivel de fábrica y el de máquina aceleran el ciclo', () => {
    const base = effectiveCycleMs(MACHINES.smelter, 0, 1);
    expect(effectiveCycleMs(MACHINES.smelter, 5, 1)).toBeLessThan(base);
    expect(effectiveCycleMs(MACHINES.smelter, 0, 5)).toBeLessThan(base);
  });

  it('una producción muy larga sigue acotada por el material disponible', () => {
    const r = settleMachine(smelterWith(20), 'smelter', 1, T0 + 10 ** 9);
    expect(r.state.output.ingot).toBe(10);
    expect(r.state.input.ore).toBeUndefined();
  });
});

describe('helpers de buffers', () => {
  it('inputRoom respeta la capacidad', () => {
    expect(inputRoom(smelterWith(5), 'smelter', 'ore')).toBe(
      MACHINES.smelter.inputCap - 5,
    );
    expect(inputRoom(smelterWith(5), 'smelter', 'gear')).toBe(0);
  });

  it('pendingCycles cuenta los ciclos que quedan por hacer', () => {
    expect(pendingCycles(smelterWith(7), 'smelter')).toBe(3);
  });
});
