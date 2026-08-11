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

/** Cuántas unidades puede aceptar el buffer de entrada de `to`. */
function inputRoomFor(state: MachineState, machineId: string, item: string): number {
  const def = getMachine(machineId);
  if (!(item in def.input)) return 0;
  return Math.max(0, def.inputCap - (state.input[item] ?? 0));
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
