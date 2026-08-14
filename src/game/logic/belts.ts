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
import { getMachine } from '../../config/machines';
import type { BeltBatch, BeltState, FactoryState, MachineState } from '../../types';

/** Velocidad de la banda, en píxeles de mundo por segundo. */
export const BELT_SPEED = 52;

/** Separación entre bultos consecutivos de una misma tanda, en píxeles. */
export const BELT_ITEM_GAP = 26;

/** Cuántos bultos como máximo se dibujan por tanda (rendimiento). */
const MAX_DRAWN_PER_BATCH = 24;

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

    const travel = beltTravelMs(def);
    const pending: BeltBatch[] = [];
    for (const batch of queue) {
      if (!batch || batch.qty <= 0) {
        changed = true;
        continue;
      }
      if (now - batch.at >= travel) {
        const target = machines[def.feeds];
        if (target) {
          machines[def.feeds] = {
            ...target,
            input: {
              ...target.input,
              [batch.item]: (target.input[batch.item] ?? 0) + batch.qty,
            },
          };
          deliveries.push({
            beltId: id,
            machineId: def.feeds,
            item: batch.item,
            qty: batch.qty,
          });
        }
        changed = true;
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

/** Añade material a la cola de una cinta. */
export function pushToBelt(
  belts: Record<string, BeltState>,
  beltId: string,
  item: string,
  qty: number,
  now: number,
): Record<string, BeltState> {
  const cur = belts[beltId]?.queue ?? [];
  return { ...belts, [beltId]: { queue: [...cur, { item, qty, at: now }] } };
}

/* ─────────────────────────── consultas ─────────────────────────── */

/** Unidades que hay ahora mismo viajando por una cinta. */
export function beltCount(state: BeltState | undefined, beltId: string, now: number): number {
  const def = getBelt(beltId);
  if (!def || !state) return 0;
  const travel = beltTravelMs(def);
  let total = 0;
  for (const b of state.queue) {
    if (now - b.at < travel) total += b.qty;
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
}

/**
 * Posiciones reales de los bultos que hay en la cinta. Un lote de N unidades
 * se dibuja como una hilera de bultos separados, de modo que una cinta
 * saturada se ve saturada y una con poca carga se ve casi vacía.
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
    if (age < 0 || age >= travel) continue;
    const head = (age / travel) * len;
    const drawn = Math.min(batch.qty, MAX_DRAWN_PER_BATCH);
    for (let i = 0; i < drawn; i++) {
      const d = head - i * BELT_ITEM_GAP;
      if (d < 0 || d > len) continue;
      const t = d / len;
      const p = beltPointAt(def, t);
      out.push({ x: p.x, y: p.y, item: batch.item, t });
    }
  }
  return out;
}

/** ¿Está la cinta operativa con el nivel de fábrica actual? */
export function beltActive(def: ConveyorDef, factoryLevel: number): boolean {
  if (factoryLevel < def.fromLevel) return false;
  if (!def.feeds) return false;
  return factoryLevel >= getMachine(def.feeds).unlockFactoryLevel;
}
