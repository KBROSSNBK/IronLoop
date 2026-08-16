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
  /** Recetas que salen en CADA ciclo. Con la máquina muy mejorada, varias. */
  batch: number;
}

const MAX_CYCLES_PER_SETTLE = 5000;

/**
 * DURACIÓN MÍNIMA DE UN CICLO VISIBLE.
 *
 * Por debajo de esto la barra de progreso deja de ser información y pasa a ser
 * un parpadeo: a fábrica nivel 12 la Fundidora ya bajaba a 728 ms y con
 * mejoras se clavaba en 200, o sea cinco barras por segundo. Ilegible y
 * molesto.
 */
const MIN_CYCLE_MS = 900;

/** Duración de UNA receta, sin agrupar. Es lo que dicta la velocidad real. */
export function recipeMs(
  def: MachineDef,
  machineLevel: number,
  factoryLevel: number,
): number {
  const mult =
    machineSpeedMultiplier(machineLevel) * factoryProductionMultiplier(factoryLevel);
  return Math.max(1, def.cycleMs / mult);
}

/**
 * RECETAS POR CICLO.
 *
 * Cuando la máquina va tan rápida que un ciclo no se vería, en vez de acortar
 * más el ciclo se hace MÁS GRANDE EL LOTE: cuatro lingotes de una tacada en
 * vez de cuatro ciclos de 200 ms. El caudal es exactamente el mismo y la
 * barra vuelve a leerse.
 *
 * De paso arregla un fallo de balance serio: antes había un suelo duro de
 * 200 ms, así que a partir de cierto punto mejorar una máquina NO PRODUCÍA
 * NADA —pagabas mejoras que no hacían nada— y el Reactor acababa rindiendo
 * igual que la Fundidora. Con lotes, mejorar siempre rinde.
 */
export function machineBatch(
  def: MachineDef,
  machineLevel: number,
  factoryLevel: number,
): number {
  const raw = recipeMs(def, machineLevel, factoryLevel);
  return Math.max(1, Math.ceil(MIN_CYCLE_MS / raw));
}

/** Duración del ciclo que se ve en la barra: el lote entero. */
export function effectiveCycleMs(
  def: MachineDef,
  machineLevel: number,
  factoryLevel: number,
): number {
  return (
    recipeMs(def, machineLevel, factoryLevel) *
    machineBatch(def, machineLevel, factoryLevel)
  );
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

/** Recetas completas que salen con lo que hay ahora mismo en la entrada. */
function recipesAvailable(state: MachineState, def: MachineDef): number {
  let min = Infinity;
  for (const [item, need] of Object.entries(def.input)) {
    min = Math.min(min, Math.floor((state.input[item] ?? 0) / (need as number)));
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
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
  const raw = recipeMs(def, state.level, factoryLevel);
  const batch = machineBatch(def, state.level, factoryLevel);
  const cycleMs = raw * batch;
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
      batch,
    };
  }

  let cyclesDone = 0;

  /*
   * Consume los ciclos completados.
   *
   * Cada ciclo saca un LOTE de hasta `batch` recetas. Si no hay material para
   * el lote entero se hacen las que salgan, y el reloj avanza SÓLO lo que ha
   * costado hacerlas (`raw` por receta): así ni se regala tiempo ni se pierde,
   * y el material que falta espera al siguiente en vez de evaporarse.
   */
  if (state.cycleStartAt > 0) {
    while (cyclesDone < MAX_CYCLES_PER_SETTLE) {
      const elapsed = now - state.cycleStartAt;
      if (elapsed < cycleMs) break;
      if (!hasOutputRoom(state, def)) break;

      const n = Math.min(batch, recipesAvailable(state, def));
      if (n <= 0) break;

      for (const [item, need] of Object.entries(def.input)) {
        state.input[item] = (state.input[item] ?? 0) - (need as number) * n;
        if (state.input[item] <= 0) delete state.input[item];
      }
      for (const [item, amount] of Object.entries(def.output)) {
        state.output[item] = (state.output[item] ?? 0) + (amount as number) * n;
        produced[item] = (produced[item] ?? 0) + (amount as number) * n;
      }
      state.cycles += n;
      state.cycleStartAt += raw * n;
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

  return { state, produced, cyclesDone, progress, running, blocked, cycleMs, batch };
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
