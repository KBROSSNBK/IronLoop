/**
 * CINTAS TRANSPORTADORAS — material real en tránsito.
 *
 * Cada cinta guarda una cola de tandas `{ item, qty, at }`. La posición de
 * cada bulto se DERIVA de `at` y de la velocidad de la cinta, así que:
 *
 *  · el número que se ve en pantalla es el número real de items en tránsito;
 *  · todos los jugadores calculan lo mismo a partir del mismo documento;
 *  · no se escribe nada mientras el material viaja, sólo al entrar y al salir.
 *
 * Es la misma idea que las máquinas y la estamina: guardar un instante y
 * derivar el resto.
 */

import { CONVEYORS, conveyorRect, type ConveyorDef } from '../../config/world';
import { MACHINE_LIST, getMachine, type MachineDef } from '../../config/machines';
import type { BeltBatch, BeltState, FactoryState, MachineState } from '../../types';

/** Índice de máquinas tolerante: devuelve undefined en vez de reventar. */
const MACHINE_MAP: Record<string, MachineDef> = Object.fromEntries(
  MACHINE_LIST.map((m) => [m.id, m]),
);

/** Velocidad de la banda, en píxeles de mundo por segundo. */
export const BELT_SPEED = 52;

/** Separación entre bultos consecutivos de una misma tanda, en píxeles. */
export const BELT_ITEM_GAP = 26;

/**
 * Tiempo entre dos bultos consecutivos. Es lo que tarda la banda en recorrer
 * la separación entre ellos, así que un lote entra en la máquina bulto a
 * bulto —igual que se ve en pantalla— en vez de desaparecer de golpe.
 */
export const BELT_ITEM_GAP_MS = (BELT_ITEM_GAP / BELT_SPEED) * 1000;

export const BELT_MAP: Record<string, ConveyorDef> = Object.fromEntries(
  CONVEYORS.map((c) => [c.id, c]),
);

export function getBelt(id: string): ConveyorDef | undefined {
  return BELT_MAP[id];
}

/** Longitud útil de la cinta en píxeles. */
export function beltLength(belt: ConveyorDef): number {
  const r = conveyorRect(belt);
  return belt.dir === 'left' || belt.dir === 'right' ? r.w : r.h;
}

/** Tiempo que tarda un bulto en recorrer la cinta entera. */
export function beltTravelMs(belt: ConveyorDef): number {
  return (beltLength(belt) / BELT_SPEED) * 1000;
}

/** Punto del recorrido a una fracción 0..1 desde la carga hasta la entrega. */
export function beltPointAt(belt: ConveyorDef, t: number): { x: number; y: number } {
  const r = conveyorRect(belt);
  const k = Math.max(0, Math.min(1, t));
  switch (belt.dir) {
    case 'right':
      return { x: r.x + r.w * k, y: r.y + r.h / 2 };
    case 'left':
      return { x: r.x + r.w * (1 - k), y: r.y + r.h / 2 };
    case 'down':
      return { x: r.x + r.w / 2, y: r.y + r.h * k };
    case 'up':
      return { x: r.x + r.w / 2, y: r.y + r.h * (1 - k) };
  }
}

/* ─────────────────────────── liquidación ─────────────────────────── */

/**
 * Unidades de una tanda que YA han llegado al final de la cinta.
 *
 * No llegan todas a la vez: el lote viaja como una hilera de bultos separados
 * y entra en la máquina de uno en uno, exactamente igual que se ve. Antes el
 * lote entero desaparecía en el instante en que el primer bulto tocaba la
 * máquina, y la mitad de la hilera se esfumaba a media cinta.
 */
export function beltArrived(belt: ConveyorDef, batch: BeltBatch, now: number): number {
  const travel = beltTravelMs(belt);
  const age = now - batch.at;
  if (age < travel) return 0;
  return Math.min(batch.qty, Math.floor((age - travel) / BELT_ITEM_GAP_MS) + 1);
}

/** ¿Ha entregado ya la tanda hasta el último bulto? */
function batchDone(belt: ConveyorDef, batch: BeltBatch, now: number): boolean {
  return beltArrived(belt, batch, now) >= batch.qty;
}

/**
 * A qué máquinas va lo que sale de esta cinta.
 *
 * Con `splits` el material se reparte a partes iguales entre todas las que de
 * verdad lo consumen. Es lo que mantiene viva la cadena cuando dos máquinas
 * piden el mismo mineral: sin reparto, la primera se lo quedaba todo.
 */
export function beltTargets(
  belt: ConveyorDef,
  item: string,
  factoryLevel: number,
): string[] {
  const ids = [belt.feeds, ...(belt.splits ?? [])].filter((id): id is string => !!id);
  const usan = ids.filter((id) => {
    const def = MACHINE_MAP[id];
    if (!def) return false;
    if (factoryLevel < def.unlockFactoryLevel) return false;
    return item in def.input;
  });
  // Si nadie lo consume, entra igualmente en el destino principal: el
  // material no se pierde nunca por un cambio de receta.
  return usan.length > 0 ? usan : ids.slice(0, 1);
}

/** Reparto a partes iguales; el resto se lo queda el destino principal. */
export function splitUnits(total: number, targets: number): number[] {
  if (targets <= 0) return [];
  const base = Math.floor(total / targets);
  let resto = total - base * targets;
  return Array.from({ length: targets }, () => {
    const extra = resto > 0 ? 1 : 0;
    resto -= extra;
    return base + extra;
  });
}

/**
 * Materiales que admite una cinta: su filtro propio si lo tiene, y si no la
 * unión de las recetas de TODAS las máquinas a las que entrega (contando el
 * repartidor). Es lo que decide qué se puede soltar en su cargador.
 */
export function beltAccepts(belt: ConveyorDef): string[] {
  if (belt.accepts?.length) return belt.accepts;
  const ids = [belt.feeds, ...(belt.splits ?? [])].filter((id): id is string => !!id);
  const set = new Set<string>();
  for (const id of ids) {
    for (const item of Object.keys(MACHINE_MAP[id]?.input ?? {})) set.add(item);
  }
  return [...set];
}

export interface BeltDelivery {
  beltId: string;
  machineId: string;
  item: string;
  qty: number;
}

export interface BeltSettleResult {
  factory: FactoryState;
  deliveries: BeltDelivery[];
}

/**
 * Entrega en las máquinas todo el material que ya ha llegado al final de su
 * cinta. Puro: devuelve una fábrica nueva.
 */
export function settleBelts(factory: FactoryState, now: number): BeltSettleResult {
  const belts = factory.belts ?? {};
  const ids = Object.keys(belts);
  if (ids.length === 0) return { factory, deliveries: [] };

  const nextBelts: Record<string, BeltState> = {};
  const machines: Record<string, MachineState> = { ...factory.machines };
  const deliveries: BeltDelivery[] = [];
  let changed = false;

  for (const id of ids) {
    const def = getBelt(id);
    const state = belts[id];
    const queue = state?.queue ?? [];
    if (!def || !def.feeds) {
      // Cinta desconocida (config cambiada): se conserva tal cual, sin perder
      // material, para no castigar a partidas antiguas.
      if (queue.length > 0) nextBelts[id] = state;
      continue;
    }

    const pending: BeltBatch[] = [];
    for (const batch of queue) {
      if (!batch || batch.qty <= 0) {
        changed = true;
        continue;
      }
      const llegadas = beltArrived(def, batch, now);
      if (llegadas > 0) {
        const destinos = beltTargets(def, batch.item, factory.level);
        const reparto = splitUnits(llegadas, destinos.length);
        let entregado = 0;
        destinos.forEach((machineId, i) => {
          const qty = reparto[i];
          if (qty <= 0) return;
          const target = machines[machineId];
          if (!target) return;
          machines[machineId] = {
            ...target,
            input: {
              ...target.input,
              [batch.item]: (target.input[batch.item] ?? 0) + qty,
            },
          };
          deliveries.push({ beltId: id, machineId, item: batch.item, qty });
          entregado += qty;
        });
        // Lo que no ha tenido destino sigue en la cinta: nunca se evapora.
        const movidas = entregado > 0 ? llegadas : 0;
        const restan = batch.qty - movidas;
        if (restan > 0) {
          // Desplazar `at` en proporción conserva la posición exacta de los
          // bultos que siguen viajando: el de delante ocupa el hueco justo.
          pending.push({
            item: batch.item,
            qty: restan,
            at: batch.at + movidas * BELT_ITEM_GAP_MS,
          });
        }
        if (movidas > 0) changed = true;
      } else {
        pending.push(batch);
      }
    }
    if (pending.length > 0) nextBelts[id] = { queue: pending };
    else if (queue.length > 0) changed = true;
  }

  if (!changed) return { factory, deliveries: [] };
  return { factory: { ...factory, belts: nextBelts, machines }, deliveries };
}

/**
 * Añade material a la cola de una cinta.
 *
 * Si lo último que se cargó es del mismo material y su hilera aún está
 * entrando, la carga nueva se engancha detrás y forma un solo tren continuo.
 * Si es de otro material, se deja el hueco de un bulto para que no se dibujen
 * dos cosas encima. Es lo que hace que la cinta se vea fluir en vez de ir a
 * saltos.
 */
export function pushToBelt(
  belts: Record<string, BeltState>,
  beltId: string,
  item: string,
  qty: number,
  now: number,
): Record<string, BeltState> {
  const cur = belts[beltId]?.queue ?? [];
  if (qty <= 0) return belts;
  const last = cur[cur.length - 1];

  if (last) {
    // Instante en el que el ÚLTIMO bulto de la tanda anterior entró en la cinta.
    const colaAt = last.at + (last.qty - 1) * BELT_ITEM_GAP_MS;
    if (last.item === item && colaAt + BELT_ITEM_GAP_MS >= now) {
      const queue = cur.slice(0, -1);
      queue.push({ item, qty: last.qty + qty, at: last.at });
      return { ...belts, [beltId]: { queue } };
    }
    // Material distinto: entra justo detrás, sin montarse encima.
    const at = Math.min(Math.max(now, colaAt + BELT_ITEM_GAP_MS), now + 2_000);
    return { ...belts, [beltId]: { queue: [...cur, { item, qty, at }] } };
  }

  return { ...belts, [beltId]: { queue: [...cur, { item, qty, at: now }] } };
}

/* ─────────────────────────── consultas ─────────────────────────── */

/** Unidades que hay ahora mismo viajando por una cinta. */
export function beltCount(state: BeltState | undefined, beltId: string, now: number): number {
  const def = getBelt(beltId);
  if (!def || !state) return 0;
  let total = 0;
  for (const b of state.queue) {
    // Lo ya entregado no cuenta aunque la liquidación no haya pasado todavía:
    // el número que se ve es el que de verdad queda encima de la banda.
    total += Math.max(0, b.qty - beltArrived(def, b, now));
  }
  return total;
}

/** Total de unidades en tránsito en toda la fábrica. */
export function beltsInTransit(factory: FactoryState, now: number): number {
  let total = 0;
  for (const [id, state] of Object.entries(factory.belts ?? {})) {
    total += beltCount(state, id, now);
  }
  return total;
}

export interface BeltItemVisual {
  x: number;
  y: number;
  item: string;
  /** 0..1 dentro del recorrido, para efectos de entrada/salida. */
  t: number;
  /** Unidades que van en este bulto. Se pinta como «×128». */
  qty: number;
}

/**
 * Los bultos que hay en la cinta: UNO por tanda, con su cantidad encima.
 *
 * Antes se dibujaba una cajita por unidad y una cinta cargada era una hilera
 * de cien cajas idénticas: bonito un rato y luego imposible saber cuánto
 * material iba de verdad. Con un bulto y un «×128» se lee de un vistazo.
 *
 * La lógica de entrega no cambia ni un ápice: el material sigue entrando en
 * la máquina de unidad en unidad (ver `beltArrived`). Esto es sólo la cara.
 */
export function beltItems(
  beltId: string,
  state: BeltState | undefined,
  now: number,
): BeltItemVisual[] {
  const def = getBelt(beltId);
  if (!def || !state) return [];
  const len = beltLength(def);
  const travel = beltTravelMs(def);
  const out: BeltItemVisual[] = [];

  for (const batch of state.queue) {
    const age = now - batch.at;
    if (age < 0 || batchDone(def, batch, now)) continue;

    // Lo ya entregado no se pinta: el bulto lleva lo que de verdad queda.
    const entregadas = beltArrived(def, batch, now);
    const quedan = batch.qty - entregadas;
    if (quedan <= 0) continue;

    // El bulto va donde está la primera unidad que aún no ha llegado, que es
    // la cabeza del tren que queda por entrar.
    const head = (age / travel) * len;
    const d = Math.max(0, Math.min(len, head - entregadas * BELT_ITEM_GAP));
    const t = d / len;
    const p = beltPointAt(def, t);
    out.push({ x: p.x, y: p.y, item: batch.item, t, qty: quedan });
  }
  return out;
}

/** ¿Está la cinta operativa con el nivel de fábrica actual? */
export function beltActive(def: ConveyorDef, factoryLevel: number): boolean {
  if (factoryLevel < def.fromLevel) return false;
  if (!def.feeds) return false;
  return factoryLevel >= getMachine(def.feeds).unlockFactoryLevel;
}
