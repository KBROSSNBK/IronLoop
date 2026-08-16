import { describe, expect, it } from 'vitest';
import {
  effectiveCycleMs,
  inputRoom,
  machineBatch,
  pendingCycles,
  recipeMs,
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

  it('la salida no tiene tope: sigue produciendo por encima de la referencia', () => {
    const cap = MACHINES.smelter.outputCap;
    const state: MachineState = {
      ...createMachineState(),
      input: { ore: 100 },
      output: { ingot: cap },
      cycleStartAt: T0,
    };
    const r = settleMachine(state, 'smelter', 1, T0 + 1_000_000);
    expect(r.blocked).toBe('no-input'); // se detiene por material, no por espacio
    expect(r.state.output.ingot).toBe(cap + 50); // 100 mineral → 50 lingotes más
    expect(r.cyclesDone).toBe(50);
  });

  it('acepta acumular entrada muy por encima de la referencia visual', () => {
    const cap = MACHINES.smelter.inputCap;
    const r = settleMachine(smelterWith(cap * 10), 'smelter', 1, T0 + 1000);
    expect(r.blocked).toBeNull();
    expect(r.running).toBe(true);
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
  it('inputRoom es ilimitado para lo que la receta acepta, y cero para el resto', () => {
    expect(inputRoom(smelterWith(9999), 'smelter', 'ore')).toBe(Number.POSITIVE_INFINITY);
    expect(inputRoom(smelterWith(5), 'smelter', 'gear')).toBe(0);
  });

  it('pendingCycles cuenta los ciclos que quedan por hacer', () => {
    expect(pendingCycles(smelterWith(7), 'smelter')).toBe(3);
  });
});

/* ───────────── LOTES: BARRA LEGIBLE Y SIN TECHO DE VELOCIDAD ───────────── */

/**
 * A fábrica nivel 12 la Fundidora ya bajaba a 728 ms por ciclo, y con mejoras
 * se clavaba en 200: cinco barras de progreso por segundo, ilegibles. Peor
 * aún, ese suelo de 200 ms era un TECHO DE PRODUCCIÓN encubierto — a partir de
 * ahí mejorar la máquina no producía nada y el Reactor acababa rindiendo lo
 * mismo que la Fundidora.
 *
 * Ahora, cuando el ciclo se haría invisible, lo que crece es el LOTE.
 */
describe('lotes de producción', () => {
  const cadaMaquina = Object.keys(MACHINES);

  it('el ciclo visible nunca se vuelve un parpadeo', () => {
    for (const id of cadaMaquina) {
      const def = MACHINES[id as keyof typeof MACHINES];
      for (const [fl, ml] of [[1, 0], [12, 0], [12, 20], [25, 20], [60, 20]] as const) {
        const ciclo = effectiveCycleMs(def, ml, fl);
        expect(ciclo, `${id} f${fl}/m${ml}`).toBeGreaterThanOrEqual(850);
      }
    }
  });

  it('mejorar la máquina SIEMPRE produce más, sin techo', () => {
    const def = MACHINES.smelter;
    let anterior = 0;
    for (const ml of [0, 5, 10, 20, 40]) {
      const caudal = machineBatch(def, ml, 12) / (effectiveCycleMs(def, ml, 12) / 1000);
      expect(caudal, `nivel ${ml}`).toBeGreaterThan(anterior);
      anterior = caudal;
    }
  });

  it('el lote no cambia el caudal: lo mismo, agrupado', () => {
    const def = MACHINES.smelter;
    for (const [fl, ml] of [[12, 0], [12, 10], [25, 20]] as const) {
      const porReceta = 1000 / recipeMs(def, ml, fl);
      const porLote = machineBatch(def, ml, fl) / (effectiveCycleMs(def, ml, fl) / 1000);
      expect(porLote).toBeCloseTo(porReceta, 6);
    }
  });

  it('produce el lote entero de una tacada', () => {
    const lote = machineBatch(MACHINES.smelter, 20, 12);
    expect(lote).toBeGreaterThan(1);
    const ciclo = effectiveCycleMs(MACHINES.smelter, 20, 12);
    const m: MachineState = {
      ...createMachineState(),
      level: 20,
      input: { ore: 1000 },
      cycleStartAt: T0,
    };
    const r = settleMachine(m, 'smelter', 12, T0 + ciclo + 5);
    expect(r.state.output.ingot).toBe(lote);
    expect(r.state.input.ore).toBe(1000 - lote * 2);
  });
});

/* ─────────────── NI UN ITEM SE PIERDE NI SE INVENTA ─────────────── */

describe('conservación del material en las máquinas', () => {
  it('lo consumido cuadra EXACTAMENTE con lo producido, en cualquier caso', () => {
    for (const [id, def] of Object.entries(MACHINES)) {
      for (const [fl, ml] of [[1, 0], [12, 0], [12, 20], [30, 20]] as const) {
        if (fl < def.unlockFactoryLevel) continue;
        const entrada: Record<string, number> = {};
        for (const [item, need] of Object.entries(def.input)) {
          entrada[item] = (need as number) * 137; // cantidad rara a propósito
        }
        const m: MachineState = {
          ...createMachineState(),
          level: ml,
          input: { ...entrada },
          cycleStartAt: T0,
        };
        const r = settleMachine(m, id, fl, T0 + 3600_000);

        // Recetas hechas según lo que ha desaparecido de la entrada.
        const recetas = Object.entries(def.input).map(
          ([item, need]) =>
            ((entrada[item] ?? 0) - (r.state.input[item] ?? 0)) / (need as number),
        );
        // Todos los ingredientes se han consumido en la misma proporción.
        for (const n of recetas) expect(n).toBe(recetas[0]);
        // Y la salida es exactamente esas recetas por su rendimiento.
        for (const [item, amount] of Object.entries(def.output)) {
          expect(r.state.output[item] ?? 0, `${id} f${fl}/m${ml}`).toBe(
            recetas[0] * (amount as number),
          );
        }
        // Nunca consume de más: lo que sobra sigue ahí.
        for (const [item, need] of Object.entries(def.input)) {
          expect(r.state.input[item] ?? 0).toBe(entrada[item] - recetas[0] * (need as number));
        }
      }
    }
  });

  it('con material para menos de un lote, hace lo que puede y no pierde el resto', () => {
    const lote = machineBatch(MACHINES.smelter, 20, 12);
    expect(lote).toBeGreaterThan(2);
    // Justo para DOS recetas, con un mineral suelto que no llega para otra.
    const m: MachineState = {
      ...createMachineState(),
      level: 20,
      input: { ore: 5 },
      cycleStartAt: T0,
    };
    const r = settleMachine(m, 'smelter', 12, T0 + 3600_000);
    expect(r.state.output.ingot).toBe(2);
    // El mineral que no llegaba para otra receta sigue en la tolva.
    expect(r.state.input.ore).toBe(1);
  });

  it('liquidar mil veces seguidas da lo mismo que liquidar una', () => {
    const base: MachineState = {
      ...createMachineState(),
      level: 6,
      input: { ore: 400 },
      cycleStartAt: T0,
    };
    const fin = T0 + 600_000;

    const deUnaVez = settleMachine(base, 'smelter', 12, fin);
    let poco: MachineState = base;
    for (let t = T0; t <= fin; t += 617) {
      poco = settleMachine(poco, 'smelter', 12, t).state;
    }
    expect(poco.output.ingot).toBe(deUnaVez.state.output.ingot);
    expect(poco.input.ore ?? 0).toBe(deUnaVez.state.input.ore ?? 0);
  });
});
