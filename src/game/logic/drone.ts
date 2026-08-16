/**
 * CARGA DE UN DRON — lógica pura.
 *
 * Un dron no lleva "un material": llena la bodega con TODO lo que sirva y
 * hace la ruta de reparto que haga falta. Es la diferencia entre una cadena
 * que fluye y una en la que los cristales se quedaban criando polvo en la
 * mochila del perro porque el dron sólo sabía mover el montón más grande.
 *
 * Dos reglas mandan aquí:
 *  1. AL MENOS UNA UNIDAD DE CADA MATERIAL que tenga destino. Aunque lleves
 *     un solo diamante entre trescientas piedras, ese diamante sale.
 *  2. El resto del hueco se reparte en proporción a lo que hay, así que los
 *     montones gordos también bajan rápido.
 */

import { dropOffFor, petAccepts, type DropOff } from './pet';

/** Una parada de la ruta: dónde se suelta y qué se suelta ahí. */
export interface DroneStop {
  bay: DropOff;
  items: Record<string, number>;
  units: number;
}

/** Clave de agrupación: la misma cinta (o la misma máquina) es una parada. */
function bayKey(bay: DropOff): string {
  return `${bay.beltId ?? '-'}|${bay.machineId}`;
}

/**
 * Reparte `carry` unidades entre los materiales disponibles: primero una de
 * cada uno, después el hueco que quede en proporción al montón.
 */
export function shareCarry(
  stacks: { item: string; qty: number }[],
  carry: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let room = Math.max(0, Math.floor(carry));
  if (room <= 0 || stacks.length === 0) return out;

  // Los montones más grandes primero: si el dron es pequeño y no llega para
  // todos, al menos alivia lo que más aprieta.
  const orden = [...stacks].sort((a, b) => b.qty - a.qty);

  // 1) Una unidad de cada material. Esto es lo que garantiza que nada se
  //    quede atrás por ser poca cantidad.
  for (const s of orden) {
    if (room <= 0) break;
    if (s.qty <= 0) continue;
    out[s.item] = 1;
    room -= 1;
  }

  // 2) El resto, a prorrata de lo que sigue pendiente.
  const resto = orden
    .filter((s) => (out[s.item] ?? 0) > 0)
    .map((s) => ({ item: s.item, left: s.qty - out[s.item] }))
    .filter((s) => s.left > 0);
  const total = resto.reduce((a, s) => a + s.left, 0);
  if (room <= 0 || total <= 0) return out;

  if (total <= room) {
    for (const s of resto) out[s.item] += s.left;
    return out;
  }

  const dado: Record<string, number> = {};
  let repartido = 0;
  for (const s of resto) {
    const parte = Math.min(s.left, Math.floor((room * s.left) / total));
    dado[s.item] = parte;
    repartido += parte;
  }
  // Las unidades sueltas del redondeo, a los montones más grandes.
  let sobra = room - repartido;
  for (const s of resto) {
    if (sobra <= 0) break;
    const hueco = s.left - dado[s.item];
    if (hueco <= 0) continue;
    const extra = Math.min(hueco, sobra);
    dado[s.item] += extra;
    sobra -= extra;
  }
  for (const s of resto) out[s.item] += dado[s.item];
  return out;
}

/**
 * Ruta completa de un viaje: qué coge y en qué orden lo reparte.
 * Devuelve una lista vacía si no hay nada que mover.
 */
export function planHaul(
  available: Record<string, number>,
  carry: number,
  factoryLevel: number,
  from: { x: number; y: number },
): DroneStop[] {
  const stacks: { item: string; qty: number }[] = [];
  const bays = new Map<string, DropOff>();

  for (const [item, raw] of Object.entries(available)) {
    const qty = Math.max(0, Math.floor(raw));
    if (qty <= 0 || !petAccepts(item)) continue;
    const bay = dropOffFor(item, factoryLevel, from);
    if (!bay) continue;
    stacks.push({ item, qty });
    bays.set(item, bay);
  }
  if (stacks.length === 0) return [];

  const reparto = shareCarry(stacks, carry);

  // Agrupado por destino: una parada por cinta o máquina, no una por material.
  const porDestino = new Map<string, DroneStop>();
  for (const [item, qty] of Object.entries(reparto)) {
    if (qty <= 0) continue;
    const bay = bays.get(item)!;
    const key = bayKey(bay);
    const stop = porDestino.get(key);
    if (stop) {
      stop.items[item] = (stop.items[item] ?? 0) + qty;
      stop.units += qty;
    } else {
      porDestino.set(key, { bay, items: { [item]: qty }, units: qty });
    }
  }

  // Ruta por cercanía: se encadena siempre la parada más próxima a la
  // anterior, que es como volaría cualquiera que no quiera dar vueltas.
  const pendientes = [...porDestino.values()];
  const ruta: DroneStop[] = [];
  let x = from.x;
  let y = from.y;
  while (pendientes.length > 0) {
    let mejor = 0;
    let mejorD = Infinity;
    for (let i = 0; i < pendientes.length; i++) {
      const d = Math.hypot(pendientes[i].bay.x - x, pendientes[i].bay.y - y);
      if (d < mejorD) {
        mejorD = d;
        mejor = i;
      }
    }
    const [stop] = pendientes.splice(mejor, 1);
    ruta.push(stop);
    x = stop.bay.x;
    y = stop.bay.y;
  }
  return ruta;
}

/** Unidades totales de un manifiesto de carga. */
export function manifestUnits(items: Record<string, number>): number {
  return Object.values(items).reduce((a, b) => a + Math.max(0, b), 0);
}

/** El material del que más lleva un manifiesto: es el icono que se ve colgando. */
export function manifestTop(items: Record<string, number>): string | null {
  let top: string | null = null;
  let qty = 0;
  for (const [item, n] of Object.entries(items)) {
    if (n > qty) {
      qty = n;
      top = item;
    }
  }
  return top;
}
