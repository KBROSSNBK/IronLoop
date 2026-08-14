/**
 * SIMULACIÓN DE MÁQUINAS — determinista y pura.
 *
 * Idea clave (y ahorro principal de costes Firebase):
 * una máquina NO se escribe en cada tick. Se guarda únicamente el instante en
 * que empezó el ciclo actual (`cycleStartAt`) y sus buffers. Cualquier cliente
 * puede derivar el estado exacto en cualquier momento con `settleMachine`.
 *
 * Sólo se escribe cuando alguien interactúa (depositar, recoger, mejorar),
 * dentro de una transacción que vuelve a liquidar la máquina antes de aplicar
 * el cambio. Ver FIREBASE_COSTS.md.
 */

import {
  getMachine,
  machineSpeedMultiplier,
  type MachineDef,
} from '../../config/machines';
import { factoryProductionMultiplier } from '../../config/factoryLevels';
import type { MachineState } from '../../types';

export type BlockedReason = 'locked' | 'no-input' | 'output-full' | null;

export interface SettleResult {
  state: MachineState;
  /** Unidades producidas durante la liquidación. */
  produced: Record<string, number>;
  cyclesDone: number;
  /** Progreso del ciclo en curso, 0..1. */
  progress: number;
  running: boolean;
  blocked: BlockedReason;
  /** Duración efectiva de un ciclo tras multiplicadores, en ms. */
  cycleMs: number;
}

const MAX_CYCLES_PER_SETTLE = 5000;

export function effectiveCycleMs(
  def: MachineDef,
  machineLevel: number,
  factoryLevel: number,
): number {
  const mult =
    machineSpeedMultiplier(machineLevel) * factoryProductionMultiplier(factoryLevel);
  return Math.max(200, def.cycleMs / mult);
}

export function isMachineUnlocked(def: MachineDef, factoryLevel: number): boolean {
  return factoryLevel >= def.unlockFactoryLevel;
}

function hasInputs(state: MachineState, def: MachineDef): boolean {
  for (const [item, need] of Object.entries(def.input)) {
    if ((state.input[item] ?? 0) < (need as number)) return false;
  }
  return true;
}

/**
 * Las máquinas ya NO se atascan por salida llena: aceptan y acumulan sin tope.
 * Se conserva la función para dejar explícito el cambio de diseño y para que
 * el resto del código siga leyéndose igual.
 */
function hasOutputRoom(_state: MachineState, _def: MachineDef): boolean {
  return true;
}

/**
 * Avanza la máquina desde `cycleStartAt` hasta `now`.
 * Es pura: devuelve un estado nuevo, nunca muta el recibido.
 */
export function settleMachine(
  input: MachineState,
  machineId: string,
  factoryLevel: number,
  now: number,
): SettleResult {
  const def = getMachine(machineId);
  const state: MachineState = {
    level: input.level,
    cycles: input.cycles,
    cycleStartAt: input.cycleStartAt,
    input: { ...input.input },
    output: { ...input.output },
  };
  const cycleMs = effectiveCycleMs(def, state.level, factoryLevel);
  const produced: Record<string, number> = {};

  if (!isMachineUnlocked(def, factoryLevel)) {
    return {
      state: { ...state, cycleStartAt: 0 },
      produced,
      cyclesDone: 0,
      progress: 0,
      running: false,
      blocked: 'locked',
      cycleMs,
    };
  }

  let cyclesDone = 0;

  // Consume ciclos completados.
  if (state.cycleStartAt > 0) {
    while (cyclesDone < MAX_CYCLES_PER_SETTLE) {
      const elapsed = now - state.cycleStartAt;
      if (elapsed < cycleMs) break;
      if (!hasInputs(state, def) || !hasOutputRoom(state, def)) break;

      for (const [item, need] of Object.entries(def.input)) {
        state.input[item] = (state.input[item] ?? 0) - (need as number);
        if (state.input[item] <= 0) delete state.input[item];
      }
      for (const [item, amount] of Object.entries(def.output)) {
        state.output[item] = (state.output[item] ?? 0) + (amount as number);
        produced[item] = (produced[item] ?? 0) + (amount as number);
      }
      state.cycles += 1;
      state.cycleStartAt += cycleMs;
      cyclesDone += 1;
    }
  }

  // ¿Puede seguir trabajando?
  const canRun = hasInputs(state, def) && hasOutputRoom(state, def);
  let blocked: BlockedReason = null;
  if (!canRun) {
    blocked = !hasInputs(state, def) ? 'no-input' : 'output-full';
    state.cycleStartAt = 0; // parada: no acumula tiempo mientras está bloqueada
  } else if (state.cycleStartAt === 0) {
    state.cycleStartAt = now; // arranca ahora
  }

  const running = state.cycleStartAt > 0;
  const progress = running
    ? Math.min(1, Math.max(0, (now - state.cycleStartAt) / cycleMs))
    : 0;

  return { state, produced, cyclesDone, progress, running, blocked, cycleMs };
}

/**
 * Cuántas unidades de `item` acepta el buffer de entrada.
 *
 * La capacidad es ILIMITADA por diseño: lo único que importa es que la
 * máquina use ese material en su receta. Devuelve Infinity para que el resto
 * del código (que compara con `Math.min`) siga funcionando sin cambios.
 */
export function inputRoom(
  _state: MachineState,
  machineId: string,
  item: string,
): number {
  const def = getMachine(machineId);
  return item in def.input ? Number.POSITIVE_INFINITY : 0;
}

/** Ratio 0..1 de llenado, sólo para pintar barras. Nunca bloquea nada. */
export function fillRatio(total: number, reference: number): number {
  if (reference <= 0) return 0;
  return Math.min(1, total / reference);
}

/** Todo lo que hay guardado en la máquina (entrada + salida). */
export function machineContents(state: MachineState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.input)) if (v > 0) out[k] = (out[k] ?? 0) + v;
  for (const [k, v] of Object.entries(state.output)) if (v > 0) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Items que esta máquina acepta. */
export function acceptedItems(machineId: string): string[] {
  return Object.keys(getMachine(machineId).input);
}

/** Total de unidades listas para recoger. */
export function totalOutput(state: MachineState): number {
  return Object.values(state.output).reduce((a, b) => a + b, 0);
}

/** Cuántos ciclos más podría hacer con el input actual (para la UI). */
export function pendingCycles(state: MachineState, machineId: string): number {
  const def = getMachine(machineId);
  let min = Infinity;
  for (const [item, need] of Object.entries(def.input)) {
    min = Math.min(min, Math.floor((state.input[item] ?? 0) / (need as number)));
  }
  return Number.isFinite(min) ? min : 0;
}
