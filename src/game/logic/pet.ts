/**
 * Lógica pura de la mascota: qué zona le toca y cuánto puede meter en su
 * mochila. Sin canvas, sin React y sin Firebase, para poder testearla y para
 * que el servidor use exactamente las mismas reglas que el cliente.
 */

import {
  CONVEYORS,
  STATIONS,
  TILE,
  conveyorLoadPoint,
  type ConveyorDef,
  type StationDef,
} from '../../config/world';
import { MACHINE_LIST, getMachine } from '../../config/machines';
import { getItem } from '../../config/items';
import { machineFrontPoint } from '../world/geometry';
import { derivePet, petFree, petUsed, type PetState } from '../../config/pets';

/** Estaciones de las que una mascota puede sacar material. */
export const PET_STATIONS: StationDef[] = STATIONS.filter(
  (s) => s.type === 'oreVein' || s.type === 'salvage',
);

export function isPetStation(id: string): boolean {
  return PET_STATIONS.some((s) => s.id === id);
}

/** Punto en el que la mascota se planta para minar: delante de la estación. */
export function stationWorkPoint(s: StationDef): { x: number; y: number } {
  return { x: (s.tx + s.tw / 2) * TILE, y: (s.ty + s.th + 0.35) * TILE };
}

/**
 * Zona de extracción más cercana dentro del radio del sensor.
 * Devuelve null si no hay ninguna: entonces la mascota deja de ser autónoma y
 * vuelve contigo (o va a descargar, si lleva algo).
 */
export function nearestStation(
  x: number,
  y: number,
  radius: number,
): { station: StationDef; point: { x: number; y: number }; dist: number } | null {
  let best: { station: StationDef; point: { x: number; y: number }; dist: number } | null = null;
  for (const s of PET_STATIONS) {
    const point = stationWorkPoint(s);
    const dist = Math.hypot(point.x - x, point.y - y);
    if (dist > radius) continue;
    if (!best || dist < best.dist) best = { station: s, point, dist };
  }
  return best;
}

/**
 * La mascota no toca consumibles: no bebe, no come y no le hacen falta. Si
 * alguna vez una veta rindiese uno, se queda donde está.
 */
export function petAccepts(item: string): boolean {
  return getItem(item).category !== 'consumable';
}

/**
 * Punto de descarga de un material: la cinta o la máquina donde de verdad
 * sirve para algo.
 *
 * Se deriva de las recetas, no de una tabla escrita a mano: si mañana añades
 * una máquina que consuma titanio, la mascota empieza a llevárselo sola.
 * Se prefiere lo más cercano, y las cintas ganan a igualdad de distancia
 * porque el material entra a la vista de todos.
 */
export interface DropOff {
  machineId: string;
  beltId?: string;
  x: number;
  y: number;
  label: string;
}

/** ¿Admite esta cinta este material, contando su filtro propio? */
function beltTakes(belt: ConveyorDef, item: string): boolean {
  if (!belt.feeds) return false;
  if (belt.accepts?.length) return belt.accepts.includes(item);
  return item in getMachine(belt.feeds).input;
}

export function dropOffFor(
  item: string,
  factoryLevel: number,
  from: { x: number; y: number },
): DropOff | null {
  if (!petAccepts(item)) return null;
  let best: (DropOff & { dist: number }) | null = null;

  const consider = (candidate: DropOff, bonus: number) => {
    const dist = Math.hypot(candidate.x - from.x, candidate.y - from.y) - bonus;
    if (!best || dist < best.dist) best = { ...candidate, dist };
  };

  for (const belt of CONVEYORS) {
    if (!belt.feeds || factoryLevel < belt.fromLevel) continue;
    if (factoryLevel < getMachine(belt.feeds).unlockFactoryLevel) continue;
    if (!beltTakes(belt, item)) continue;
    const p = conveyorLoadPoint(belt);
    consider(
      {
        machineId: belt.feeds,
        beltId: belt.id,
        x: p.x,
        y: p.y,
        label: belt.label ?? getMachine(belt.feeds).short,
      },
      // Empate técnico: la cinta gana, que para eso está.
      40,
    );
  }

  for (const m of MACHINE_LIST) {
    if (factoryLevel < m.unlockFactoryLevel) continue;
    if (!(item in m.input)) continue;
    const p = machineFrontPoint(m);
    consider({ machineId: m.id, x: p.x, y: p.y + 6, label: m.short }, 0);
  }

  if (!best) return null;
  const { dist: _dist, ...out } = best as DropOff & { dist: number };
  return out;
}

/** El material del que más lleva encima: es el que decide a dónde va. */
export function heaviestItem(inventory: Record<string, number>): string | null {
  let top: string | null = null;
  let qty = 0;
  for (const [id, n] of Object.entries(inventory)) {
    if (n > qty && petAccepts(id)) {
      qty = n;
      top = id;
    }
  }
  return top;
}

/** Lo que rinde una estación por unidad extraída. */
export function stationYield(s: StationDef): { item: string; amount: number } {
  const y = s.yields?.[0];
  return { item: y?.item ?? 'ore', amount: Math.max(1, y?.amount ?? 1) };
}

/**
 * Mete unidades en la mochila de la mascota respetando su capacidad.
 * Devuelve el inventario nuevo y cuántas unidades han entrado de verdad.
 */
export function addToPet(
  pet: PetState,
  item: string,
  qty: number,
): { inventory: Record<string, number>; added: number } {
  if (!petAccepts(item)) return { inventory: pet.inventory ?? {}, added: 0 };
  const room = petFree(pet);
  const added = Math.max(0, Math.min(Math.floor(qty), room));
  if (added <= 0) return { inventory: pet.inventory ?? {}, added: 0 };
  return {
    inventory: { ...(pet.inventory ?? {}), [item]: (pet.inventory?.[item] ?? 0) + added },
    added,
  };
}

/**
 * Reparte la mochila de la mascota en el inventario del jugador hasta donde
 * quepa. Lo que no cabe se queda con ella: nunca se destruye material.
 */
export function unloadPet(
  petInventory: Record<string, number>,
  playerInventory: Record<string, number>,
  playerFree: number,
): {
  pet: Record<string, number>;
  player: Record<string, number>;
  moved: Record<string, number>;
  units: number;
} {
  const pet = { ...petInventory };
  const player = { ...playerInventory };
  const moved: Record<string, number> = {};
  let room = Math.max(0, Math.floor(playerFree));
  let units = 0;

  // Orden estable: el resultado no depende de cómo itere el motor.
  for (const item of Object.keys(pet).sort()) {
    if (room <= 0) break;
    const have = Math.max(0, Math.floor(pet[item] ?? 0));
    if (have <= 0) {
      delete pet[item];
      continue;
    }
    const take = Math.min(have, room);
    if (take <= 0) continue;
    player[item] = (player[item] ?? 0) + take;
    moved[item] = take;
    units += take;
    room -= take;
    if (have - take <= 0) delete pet[item];
    else pet[item] = have - take;
  }

  return { pet, player, moved, units };
}

/**
 * Tope de unidades que el servidor acepta para un intervalo dado.
 * El cliente simula la extracción; esto acota lo que puede reclamar.
 */
export function petMineCap(pet: PetState, elapsedMs: number, tolerance: number): number {
  const { minePerSec } = derivePet(pet);
  const seconds = Math.max(0, elapsedMs) / 1000;
  return Math.floor(minePerSec * seconds * tolerance) + 1;
}

export { derivePet, petFree, petUsed };
