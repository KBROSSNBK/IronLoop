/**
 * SIMULACIÓN DE ROBOTS LOGÍSTICOS — determinista y pura.
 *
 * Misma idea que las máquinas: no se escribe nada mientras trabajan. Cada
 * robot guarda `lastRunAt` y el trabajo pendiente se deriva del tiempo
 * transcurrido. Se liquida al principio de cualquier operación sobre la
 * fábrica, así que lo que ves y lo que se guarda coinciden siempre.
 *
 * Reglas que evitan que el sistema se descontrole:
 *  · Nunca crean material: sólo mueven lo que existe en la salida de origen.
 *  · Respetan la capacidad del buffer de destino.
 *  · Si están bloqueados (sin material o destino lleno) NO acumulan tiempo:
 *    de lo contrario, al desbloquearse soltarían un golpe enorme de golpe.
 *  · El tiempo recuperable está limitado por ROBOT_MAX_CATCHUP_MS.
 */

import {
  ROBOTS,
  ROBOT_MAX_CATCHUP_MS,
  ROBOT_TRIP,
  getRobot,
  robotRate,
  type RobotDef,
} from '../../config/robots';
import { getMachine } from '../../config/machines';
import type { FactoryState, MachineState, RobotState } from '../../types';

export interface RobotTransfer {
  robotId: string;
  item: string;
  amount: number;
}

export interface RobotSettleResult {
  factory: FactoryState;
  transfers: RobotTransfer[];
}

function machineUnlocked(factory: FactoryState, machineId: string): boolean {
  return factory.level >= getMachine(machineId).unlockFactoryLevel;
}

/** Cuántas unidades acepta la entrada de `to`. Sin tope: sólo importa la receta. */
function inputRoomFor(_state: MachineState, machineId: string, item: string): number {
  return item in getMachine(machineId).input ? Number.POSITIVE_INFINITY : 0;
}

function moveItems(
  from: MachineState,
  to: MachineState,
  item: string,
  amount: number,
): { from: MachineState; to: MachineState } {
  const out = { ...from.output };
  out[item] = (out[item] ?? 0) - amount;
  if (out[item] <= 0) delete out[item];
  return {
    from: { ...from, output: out },
    to: { ...to, input: { ...to.input, [item]: (to.input[item] ?? 0) + amount } },
  };
}

/** Trabajo que un robot puede hacer con el tiempo acumulado. */
function pendingCapacity(def: RobotDef, state: RobotState, now: number): number {
  const elapsed = Math.min(Math.max(0, now - state.lastRunAt), ROBOT_MAX_CATCHUP_MS);
  return Math.floor((elapsed / 60000) * robotRate(def, state.level));
}

/**
 * Avanza todos los robots de la fábrica hasta `now`.
 * Es pura: devuelve una fábrica nueva.
 */
export function settleRobots(factory: FactoryState, now: number): RobotSettleResult {
  const owned = Object.entries(factory.robots ?? {}).filter(([, r]) => r.level > 0);
  if (owned.length === 0) return { factory, transfers: [] };

  const machines: Record<string, MachineState> = { ...factory.machines };
  const robots: Record<string, RobotState> = { ...factory.robots };
  const transfers: RobotTransfer[] = [];
  let changed = false;

  for (const [id, state] of owned) {
    const def = getRobot(id);
    if (!def) continue;

    const from = machines[def.from];
    const to = machines[def.to];
    // Un robot sin sus dos máquinas desbloqueadas simplemente no trabaja.
    if (!from || !to || !machineUnlocked(factory, def.from) || !machineUnlocked(factory, def.to)) {
      robots[id] = { ...state, lastRunAt: now };
      changed = true;
      continue;
    }

    const capacity = pendingCapacity(def, state, now);
    const available = from.output[def.item] ?? 0;
    const room = inputRoomFor(to, def.to, def.item);
    const moved = Math.min(capacity, available, room);

    if (moved > 0) {
      const res = moveItems(from, to, def.item, moved);
      machines[def.from] = res.from;
      machines[def.to] = res.to;
      // Consume sólo el tiempo que costó lo transportado: si va a tope,
      // el resto del tiempo sigue disponible en la siguiente liquidación.
      const usedMs = (moved / robotRate(def, state.level)) * 60000;
      robots[id] = {
        ...state,
        lastRunAt: Math.min(now, state.lastRunAt + usedMs),
        moved: state.moved + moved,
      };
      transfers.push({ robotId: id, item: def.item, amount: moved });
      changed = true;
    } else if (available <= 0 || room <= 0) {
      // Bloqueado: no se guarda tiempo, así no hay avalancha al desbloquear.
      robots[id] = { ...state, lastRunAt: now };
      changed = true;
    }
  }

  if (!changed) return { factory, transfers: [] };
  return { factory: { ...factory, machines, robots }, transfers };
}

/* ─────────────────────── movimiento visual del robot ─────────────────────── */

export type RobotPhase = 'idle' | 'loading' | 'outbound' | 'unloading' | 'returning';

export interface RobotVisual {
  x: number;
  y: number;
  /** Dirección de avance, para orientar el sensor. */
  dx: number;
  dy: number;
  phase: RobotPhase;
  /** Lleva carga encima (ida cargada, vuelta vacío). */
  carrying: boolean;
}

function pathLength(path: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/** Punto a distancia `d` desde el inicio del recorrido. */
function pointAt(path: { x: number; y: number }[], d: number): RobotVisual {
  let remaining = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= seg || i === path.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        dx: Math.sign(b.x - a.x),
        dy: Math.sign(b.y - a.y),
        phase: 'outbound',
        carrying: true,
      };
    }
    remaining -= seg;
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y, dx: 0, dy: 0, phase: 'outbound', carrying: true };
}

/**
 * Posición del robot en su viaje de ida y vuelta.
 *
 * Es puramente visual, pero HONESTA: sólo se mueve si de verdad hay material
 * que transportar (`hasWork`). Si no lo hay, espera parado en la máquina de
 * origen, que es donde tiene sentido esperar.
 */
export function robotVisual(def: RobotDef, hasWork: boolean, timeSec: number): RobotVisual {
  const origin = def.path[0];
  if (!hasWork) {
    return { x: origin.x, y: origin.y, dx: 0, dy: 0, phase: 'idle', carrying: false };
  }

  const len = pathLength(def.path);
  const travelMs = (len / ROBOT_TRIP.speed) * 1000;
  const total = ROBOT_TRIP.loadMs + travelMs * 2 + ROBOT_TRIP.unloadMs;
  const t = ((timeSec * 1000) % total + total) % total;

  if (t < ROBOT_TRIP.loadMs) {
    return { x: origin.x, y: origin.y, dx: 0, dy: 0, phase: 'loading', carrying: false };
  }
  const afterLoad = t - ROBOT_TRIP.loadMs;
  if (afterLoad < travelMs) {
    const p = pointAt(def.path, (afterLoad / travelMs) * len);
    return { ...p, phase: 'outbound', carrying: true };
  }
  const afterOut = afterLoad - travelMs;
  if (afterOut < ROBOT_TRIP.unloadMs) {
    const end = def.path[def.path.length - 1];
    return { x: end.x, y: end.y, dx: 0, dy: 0, phase: 'unloading', carrying: true };
  }
  const back = afterOut - ROBOT_TRIP.unloadMs;
  const p = pointAt(def.path, (1 - back / travelMs) * len);
  return { ...p, dx: -p.dx, dy: -p.dy, phase: 'returning', carrying: false };
}

/** ¿Tiene el robot material que mover ahora mismo? */
export function robotHasWork(factory: FactoryState, def: RobotDef): boolean {
  const from = factory.machines[def.from];
  const to = factory.machines[def.to];
  if (!from || !to) return false;
  if (!machineUnlocked(factory, def.from) || !machineUnlocked(factory, def.to)) return false;
  return (from.output[def.item] ?? 0) > 0;
}

/** ¿Está el robot listo para comprarse o mejorarse en este nivel de fábrica? */
export function robotAvailable(factory: FactoryState, def: RobotDef): boolean {
  return factory.level >= def.unlockFactoryLevel;
}

/** Estado de un robot para pintar el Taller. */
export interface RobotStatus {
  def: RobotDef;
  state: RobotState;
  owned: boolean;
  available: boolean;
  /** Qué está haciendo ahora mismo. */
  status: 'locked' | 'idle' | 'working' | 'no-source' | 'dest-full';
}

export function robotStatuses(factory: FactoryState): RobotStatus[] {
  return ROBOTS.map((def) => {
    const state = factory.robots?.[def.id] ?? { level: 0, lastRunAt: 0, moved: 0 };
    const owned = state.level > 0;
    const available = robotAvailable(factory, def);
    let status: RobotStatus['status'] = 'locked';
    if (!available) status = 'locked';
    else if (!owned) status = 'idle';
    else {
      const from = factory.machines[def.from];
      const to = factory.machines[def.to];
      const available2 = from?.output[def.item] ?? 0;
      const room = to ? inputRoomFor(to, def.to, def.item) : 0;
      if (available2 <= 0) status = 'no-source';
      else if (room <= 0) status = 'dest-full';
      else status = 'working';
    }
    return { def, state, owned, available, status };
  });
}
