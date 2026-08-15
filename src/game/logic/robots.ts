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
import { getItem } from '../../config/items';
import { settleMachine } from './production';
import type { RobotMode } from '../../config/robots';
import { getBelt, pushToBelt, settleBelts, type BeltDelivery } from './belts';
import type { BeltState, FactoryState, MachineState, RobotState } from '../../types';

export interface RobotTransfer {
  robotId: string;
  item: string;
  amount: number;
  /** Si el robot estaba en modo venta, dinero generado. */
  money?: number;
}

/** Ventana en la que se considera que un jugador sigue conectado. */
export const ONLINE_WINDOW_MS = 90_000;

/** uids conectados ahora mismo, según el registro del documento de fábrica. */
export function onlineUids(factory: FactoryState, now: number): string[] {
  return Object.entries(factory.online ?? {})
    .filter(([, at]) => now - at < ONLINE_WINDOW_MS)
    .map(([uid]) => uid)
    .sort();
}

/**
 * Reparte una venta entre los jugadores conectados.
 *
 * Solo uno → 100% para él. Dos → 50/50. El resto por reparto entero, y los
 * céntimos sobrantes van al primero para que la suma cuadre exactamente con
 * lo vendido: ni se crea ni se pierde dinero.
 */
export function splitSale(
  ledger: Record<string, number>,
  uids: string[],
  amount: number,
): Record<string, number> {
  if (uids.length === 0 || amount <= 0) return ledger;
  const share = Math.floor(amount / uids.length);
  const rest = amount - share * uids.length;
  const next = { ...ledger };
  uids.forEach((uid, i) => {
    next[uid] = (next[uid] ?? 0) + share + (i === 0 ? rest : 0);
  });
  return next;
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

/** Saca material del buffer de salida de una máquina. */
function takeFromOutput(from: MachineState, item: string, amount: number): MachineState {
  const out = { ...from.output };
  out[item] = (out[item] ?? 0) - amount;
  if (out[item] <= 0) delete out[item];
  return { ...from, output: out };
}

/**
 * ¿Puede este robot entregar de verdad por su cinta?
 *
 * Es lo que promete su ficha ("lleva X a Y por la cinta"), así que si la cinta
 * existe, está encendida y admite el material, el material tiene que viajar
 * por ella y verse. Sólo si la cinta no está disponible se entrega a mano
 * directamente en la máquina, para no bloquear la cadena.
 */
function beltFor(factory: FactoryState, def: RobotDef): string | null {
  if (!def.viaConveyor || !def.to) return null;
  const belt = getBelt(def.viaConveyor);
  if (!belt || belt.feeds !== def.to) return null;
  if (factory.level < belt.fromLevel) return null;
  if (belt.accepts?.length && !belt.accepts.includes(def.item)) return null;
  return belt.id;
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
  let belts: Record<string, BeltState> = factory.belts ?? {};
  const transfers: RobotTransfer[] = [];
  let changed = false;

  let ledger = factory.saleLedger ?? {};
  const connected = onlineUids(factory, now);
  let soldTotal = 0;

  for (const [id, state] of owned) {
    const def = getRobot(id);
    if (!def) continue;

    const mode: RobotMode = state.mode ?? 'belt';
    if (mode === 'off') {
      // Parado por decisión del jugador: no acumula tiempo pendiente.
      robots[id] = { ...state, lastRunAt: now };
      changed = true;
      continue;
    }

    const from = machines[def.from];
    const sourceOk = !!from && machineUnlocked(factory, def.from);
    // En modo cinta hace falta destino. Vendiendo hace falta alguien a quien
    // pagarle: sin nadie conectado el robot espera, no malvende el material.
    const to = def.to ? machines[def.to] : undefined;
    const destOk =
      mode === 'sell'
        ? connected.length > 0
        : !!def.to && !!to && machineUnlocked(factory, def.to);

    if (!sourceOk || !destOk) {
      robots[id] = { ...state, lastRunAt: now };
      changed = true;
      continue;
    }

    const capacity = pendingCapacity(def, state, now);
    const available = from!.output[def.item] ?? 0;
    const room =
      mode === 'sell'
        ? Number.POSITIVE_INFINITY
        : inputRoomFor(to!, def.to!, def.item);
    const moved = Math.min(capacity, available, room);

    if (moved > 0) {
      // Consume sólo el tiempo que costó lo transportado: si va a tope,
      // el resto del tiempo sigue disponible en la siguiente liquidación.
      const usedMs = (moved / robotRate(def, state.level)) * 60000;

      if (mode === 'sell') {
        // Sale de la máquina y se convierte en dinero repartido.
        const out = { ...from!.output };
        out[def.item] = available - moved;
        if (out[def.item] <= 0) delete out[def.item];
        machines[def.from] = { ...from!, output: out };

        const money = Math.round(getItem(def.item).sellPrice * moved);
        ledger = splitSale(ledger, connected, money);
        soldTotal += money;
        robots[id] = {
          ...state,
          lastRunAt: Math.min(now, state.lastRunAt + usedMs),
          moved: state.moved + moved,
          sold: (state.sold ?? 0) + money,
        };
        transfers.push({ robotId: id, item: def.item, amount: moved, money });
      } else {
        machines[def.from] = takeFromOutput(from!, def.item, moved);
        const beltId = beltFor(factory, def);
        if (beltId) {
          // Sube a la cinta y tarda en llegar, a la vista de todos.
          belts = pushToBelt(belts, beltId, def.item, moved, now);
        } else {
          // Sin cinta disponible, entrega a mano en la máquina.
          machines[def.to!] = {
            ...to!,
            input: { ...to!.input, [def.item]: (to!.input[def.item] ?? 0) + moved },
          };
        }
        robots[id] = {
          ...state,
          lastRunAt: Math.min(now, state.lastRunAt + usedMs),
          moved: state.moved + moved,
        };
        transfers.push({ robotId: id, item: def.item, amount: moved });
      }
      changed = true;
    } else if (available <= 0) {
      // Sin material en origen: no se guarda tiempo, así no hay avalancha
      // cuando vuelva a haberlo. (El destino ya no tiene tope, así que la
      // única razón real para parar es que no haya nada que llevar.)
      robots[id] = { ...state, lastRunAt: now };
      changed = true;
    }
  }

  if (!changed) return { factory, transfers: [] };

  let next: FactoryState = { ...factory, machines, robots, belts, saleLedger: ledger };
  if (soldTotal > 0) {
    // Vender por robot también empuja el progreso compartido, igual que
    // cuando vende un jugador.
    next = {
      ...next,
      stats: { ...next.stats, sold: next.stats.sold + soldTotal },
    };
  }
  return { factory: next, transfers };
}

/* ───────────────── liquidación completa de la fábrica ───────────────── */

export interface FactorySettleResult {
  factory: FactoryState;
  transfers: RobotTransfer[];
  /** Material que ha llegado al final de su cinta en esta liquidación. */
  deliveries: BeltDelivery[];
  /** robotId → si tiene trabajo ahora mismo (para la animación). */
  working: Record<string, boolean>;
}

/**
 * Pone al día TODA la fábrica en el orden correcto:
 *
 *   0. Las cintas entregan lo que ya ha llegado al final.
 *   1. Las máquinas producen (lo que hicieron desde la última escritura).
 *   2. Los robots reparten lo que acaba de salir.
 *   3. Las máquinas vuelven a arrancar con lo que los robots les han dejado.
 *
 * El orden importa: antes los robots miraban la salida GUARDADA, que no
 * incluía lo producido desde la última interacción. Como para ellos el
 * origen siempre parecía vacío, no movían nada y encima reiniciaban su
 * reloj: se quedaban clavados. Con las máquinas liquidadas primero, ven el
 * material real y siguen trabajando aunque no haya nadie conectado.
 */
export function settleFactory(factory: FactoryState, now: number): FactorySettleResult {
  // 0. Lo que las cintas han terminado de transportar entra en las máquinas.
  const belted = settleBelts(factory, now);
  factory = belted.factory;
  const produce = (f: FactoryState): FactoryState => {
    const machines: Record<string, MachineState> = {};
    let touched = false;
    for (const [id, state] of Object.entries(f.machines)) {
      const next = settleMachine(state, id, f.level, now).state;
      machines[id] = next;
      if (next !== state) touched = true;
    }
    return touched ? { ...f, machines } : f;
  };

  // 1. Producción pendiente.
  const produced = produce(factory);

  // ¿Qué robots tienen material esperando ANTES de que se lo lleven?
  const working: Record<string, boolean> = {};
  for (const def of ROBOTS) {
    const state = produced.robots?.[def.id];
    if (!state || state.level <= 0) {
      working[def.id] = false;
      continue;
    }
    working[def.id] = robotHasWork(produced, def);
  }

  // 2. Reparto.
  const hauled = settleRobots(produced, now);

  // 3. Las máquinas de destino arrancan con lo recién entregado.
  const finalFactory = hauled.transfers.length > 0 ? produce(hauled.factory) : hauled.factory;

  for (const t of hauled.transfers) working[t.robotId] = true;

  return {
    factory: finalFactory,
    transfers: hauled.transfers,
    deliveries: belted.deliveries,
    working,
  };
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
  const state = factory.robots?.[def.id];
  if (!state || state.level <= 0) return false;
  const mode: RobotMode = state.mode ?? 'belt';
  if (mode === 'off') return false;

  const from = factory.machines[def.from];
  if (!from || !machineUnlocked(factory, def.from)) return false;

  if (mode === 'belt') {
    if (!def.to) return false;
    const to = factory.machines[def.to];
    if (!to || !machineUnlocked(factory, def.to)) return false;
  }
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
  status: 'locked' | 'idle' | 'working' | 'no-source' | 'off';
}

export function robotStatuses(factory: FactoryState): RobotStatus[] {
  return ROBOTS.map((def) => {
    const state: RobotState = factory.robots?.[def.id] ?? {
      level: 0,
      lastRunAt: 0,
      moved: 0,
      mode: def.to ? 'belt' : 'sell',
      sold: 0,
    };
    const owned = state.level > 0;
    const available = robotAvailable(factory, def);
    let status: RobotStatus['status'] = 'locked';
    if (!available) status = 'locked';
    else if (!owned) status = 'idle';
    else if ((state.mode ?? 'belt') === 'off') status = 'off';
    else {
      const from = factory.machines[def.from];
      const stock = from?.output[def.item] ?? 0;
      if (stock <= 0) status = 'no-source';
      else status = 'working';
    }
    return { def, state, owned, available, status };
  });
}
