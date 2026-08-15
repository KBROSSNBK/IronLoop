/**
 * Lógica pura de la mascota: qué zona le toca y cuánto puede meter en su
 * mochila. Sin canvas, sin React y sin Firebase, para poder testearla y para
 * que el servidor use exactamente las mismas reglas que el cliente.
 */

import { STATIONS, TILE, type StationDef } from '../../config/world';
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
