/**
 * QUÉ LE FALTA A LA FÁBRICA — lógica pura.
 *
 * Es el cerebro del modo AUTOMÁTICO de las mascotas. En vez de picar lo que
 * pillen al lado —que acaba con tres montañas de hierro y la cadena parada por
 * falta de un cristal— miran las máquinas, ven cuál está a punto de arrancar y
 * le falta UN material, y se van a por él.
 *
 * El orden importa y no es caprichoso:
 *  1. Primero las máquinas a las que sólo les falta un ingrediente: darles ese
 *     las pone a producir YA. Alimentar una a la que le faltan tres no cambia
 *     nada hasta la tercera entrega.
 *  2. A igualdad, la que esté MÁS CERCA de completar un ciclo: con una unidad
 *     ya arranca, así que se nota enseguida.
 *
 * Sólo se proponen materiales que alguna veta dé de verdad y que estén al
 * alcance: en el planeta no se pide hierro y en la estación no se pide gas.
 */

import { MACHINE_LIST } from '../../config/machines';
import { sameRealm } from '../../config/world';
import { settleMachine } from './production';
import { PET_TARGETS, stationWorkPoint } from './pet';
import type { FactoryState } from '../../types';

export interface FactoryNeed {
  /** Material que hace falta. */
  item: string;
  /** Máquina que lo está esperando. */
  machineId: string;
  /** Unidades que faltan para completar un ciclo. */
  missing: number;
  /** Cuántos OTROS ingredientes le faltan también a esa máquina. */
  otherMissing: number;
}

/** ¿Se puede sacar este material de una veta a la que se llegue desde aquí? */
function alcanzable(item: string, fromY: number | undefined): boolean {
  const target = PET_TARGETS.find((t) => t.item === item);
  if (!target) return false;
  if (fromY === undefined) return true;
  return target.stations.some((s) => sameRealm(stationWorkPoint(s).y, fromY));
}

/**
 * Lista ordenada de lo que la fábrica está esperando, lo primero delante.
 * `fromY` acota a los materiales que se pueden traer desde ese punto del mapa.
 */
export function factoryNeeds(
  factory: FactoryState,
  now: number,
  fromY?: number,
): FactoryNeed[] {
  const out: FactoryNeed[] = [];

  for (const def of MACHINE_LIST) {
    if (factory.level < def.unlockFactoryLevel) continue;
    const state = factory.machines[def.id];
    if (!state) continue;
    const live = settleMachine(state, def.id, factory.level, now).state;

    const faltan: { item: string; missing: number }[] = [];
    for (const [item, need] of Object.entries(def.input)) {
      const have = Math.max(0, Math.floor(live.input[item] ?? 0));
      const missing = (need ?? 1) - have;
      if (missing > 0) faltan.push({ item, missing });
    }
    if (faltan.length === 0) continue;

    for (const f of faltan) {
      if (!alcanzable(f.item, fromY)) continue;
      out.push({
        item: f.item,
        machineId: def.id,
        missing: f.missing,
        otherMissing: faltan.length - 1,
      });
    }
  }

  out.sort((a, b) => a.otherMissing - b.otherMissing || a.missing - b.missing);
  return out;
}

/**
 * Reparto de encargos automáticos entre las mascotas que están en automático.
 *
 * Cada una coge una necesidad distinta mientras haya de sobra: mandar a los
 * tres perros al mismo mineral es tener uno trabajando y dos estorbando.
 * Si la lista se acaba, se reparten las que hay.
 */
export function shareNeeds(needs: FactoryNeed[], count: number): (string | null)[] {
  if (count <= 0) return [];
  const items: string[] = [];
  for (const n of needs) {
    if (!items.includes(n.item)) items.push(n.item);
    if (items.length >= count) break;
  }
  return Array.from({ length: count }, (_, i) => items[i % Math.max(1, items.length)] ?? null);
}
