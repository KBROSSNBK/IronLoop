/**
 * Lógica pura de la mascota: qué zona le toca y cuánto puede meter en su
 * mochila. Sin canvas, sin React y sin Firebase, para poder testearla y para
 * que el servidor use exactamente las mismas reglas que el cliente.
 */

import {
  CONVEYORS,
  STATIONS,
  TILE,
  ZONES,
  conveyorLoadPoint,
  sameRealm,
  type ConveyorDef,
  type StationDef,
  type ZoneDef,
} from '../../config/world';
import { MACHINE_LIST, getMachine } from '../../config/machines';
import { beltAccepts } from './belts';
import { getItem } from '../../config/items';
import { machineFrontPoint } from '../world/geometry';
import {
  bagFree,
  bagUsed,
  derivePet,
  petBag,
  petFree,
  petUsed,
  type PetState,
} from '../../config/pets';

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

/** ¿Cae esta estación dentro de esta zona del mapa? */
function stationInZone(s: StationDef, z: ZoneDef): boolean {
  const cx = s.tx + s.tw / 2;
  const cy = s.ty + s.th / 2;
  return cx >= z.tx && cx <= z.tx + z.tw && cy >= z.ty && cy <= z.ty + z.th;
}

export interface PetZone {
  id: string;
  label: string;
  icon: string;
  accent: string;
  /** Nivel de fábrica en el que la zona se abre. */
  fromLevel: number;
  /** Estaciones que la mascota puede trabajar ahí. */
  stations: StationDef[];
  /** Materiales que rinde, sin repetir. */
  items: string[];
  /** Sólo pueden entrar máquinas. */
  noHumans: boolean;
}

/**
 * MATERIAL QUE LE ENCARGAS A LA MASCOTA.
 *
 * Se elige el mineral, no la zona: lo que importa es qué te hace falta para
 * la cadena, no en qué esquina del mapa está. Ella ya se busca la vida para
 * encontrar la veta más cercana que lo dé.
 */
export interface PetTarget {
  item: string;
  stations: StationDef[];
  /** Nivel de fábrica en el que se abre la primera veta que lo da. */
  fromLevel: number;
  /** Sólo se saca de zonas donde una persona no puede entrar. */
  onlyRobots: boolean;
}

/**
 * Zonas del mapa en las que hay algo que extraer. Se derivan del layout: no
 * hay lista escrita a mano, así que una zona nueva con vetas aparece sola en
 * el selector del Taller.
 */
export const PET_ZONES: PetZone[] = ZONES.map((z) => {
  const stations = PET_STATIONS.filter((s) => stationInZone(s, z));
  return {
    id: z.id,
    label: z.label,
    icon: z.icon,
    accent: z.accent,
    fromLevel: z.liveAtLevel ?? 1,
    stations,
    items: [...new Set(stations.map((s) => stationYield(s).item))],
    noHumans: z.noHumans === true,
  };
}).filter((z) => z.stations.length > 0);

export function getPetZone(id: string | null | undefined): PetZone | null {
  if (!id) return null;
  return PET_ZONES.find((z) => z.id === id) ?? null;
}

/** Zona a la que pertenece una estación. */
function zoneOf(s: StationDef): PetZone | undefined {
  return PET_ZONES.find((z) => z.stations.includes(s));
}

/**
 * Materiales que se le pueden encargar, derivados del mapa.
 * Añadir una veta nueva añade su material a la lista sola.
 */
export const PET_TARGETS: PetTarget[] = (() => {
  const porItem = new Map<string, StationDef[]>();
  for (const s of PET_STATIONS) {
    const { item } = stationYield(s);
    porItem.set(item, [...(porItem.get(item) ?? []), s]);
  }
  return [...porItem.entries()].map(([item, stations]) => ({
    item,
    stations,
    fromLevel: Math.min(...stations.map((s) => zoneOf(s)?.fromLevel ?? 1)),
    // Si TODAS sus vetas están en zona prohibida, sólo lo saca un robot.
    onlyRobots: stations.every((s) => zoneOf(s)?.noHumans === true),
  }));
})();

export function getPetTarget(item: string | null | undefined): PetTarget | null {
  if (!item) return null;
  return PET_TARGETS.find((t) => t.item === item) ?? null;
}

export interface StationChoice {
  station: StationDef;
  point: { x: number; y: number };
  dist: number;
}

/**
 * A qué veta va la mascota.
 *
 * · Sin material encargado: la más cercana DENTRO del radio de su sensor. Es
 *   el comportamiento automático: trabaja con lo que pilla al lado.
 * · Con material encargado: la veta más cercana QUE DÉ ESE MATERIAL, sin
 *   importar el radio. Se lo has pedido tú, así que cruza el mapa si hace
 *   falta.
 *
 * Devuelve null si no hay nada que trabajar.
 */
export function nearestStation(
  x: number,
  y: number,
  radius: number,
  item: string | null = null,
): StationChoice | null {
  const target = getPetTarget(item);
  // Si le has encargado un material que sólo hay en el OTRO mundo, aquí no
  // puede hacer nada con esa orden: trabaja lo que pille cerca en vez de
  // quedarse plantada. En cuanto te la lleves al planeta, vuelve a lo suyo.
  const alcanzable =
    target && target.stations.some((s) => sameRealm(stationWorkPoint(s).y, y))
      ? target
      : null;
  const pool = alcanzable ? alcanzable.stations : PET_STATIONS;
  let best: StationChoice | null = null;
  for (const s of pool) {
    const point = stationWorkPoint(s);
    // Ni cruzando el mapa: al otro planeta no se va andando. Si la mascota
    // está en la estación, las vetas de allí no existen para ella (y al
    // revés), que si no se quedaba empujando contra el vacío.
    if (!sameRealm(point.y, y)) continue;
    const dist = Math.hypot(point.x - x, point.y - y);
    if (!alcanzable && dist > radius) continue;
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

/** ¿Admite esta cinta este material, contando su filtro y su repartidor? */
function beltTakes(belt: ConveyorDef, item: string): boolean {
  if (!belt.feeds) return false;
  return beltAccepts(belt).includes(item);
}

export function dropOffFor(
  item: string,
  factoryLevel: number,
  from: { x: number; y: number },
): DropOff | null {
  if (!petAccepts(item)) return null;
  let best: (DropOff & { dist: number }) | null = null;

  const consider = (candidate: DropOff, bonus: number) => {
    // Una máquina del otro planeta no es un destino: no hay cómo llegar.
    if (!sameRealm(candidate.y, from.y)) return;
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
  dog = 0,
): { inventory: Record<string, number>; added: number } {
  const bag = petBag(pet, dog);
  if (!petAccepts(item)) return { inventory: bag, added: 0 };
  // El tope es el de SU mochila: lo que lleve otro perro no le quita hueco.
  const room = bagFree(pet, dog);
  const added = Math.max(0, Math.min(Math.floor(qty), room));
  if (added <= 0) return { inventory: bag, added: 0 };
  return {
    inventory: { ...bag, [item]: (bag[item] ?? 0) + added },
    added,
  };
}

/** Deja la mochila `dog` con este contenido, sin tocar las demás. */
export function withBag(
  pet: PetState,
  dog: number,
  bag: Record<string, number>,
): Record<string, number>[] {
  const bags = (pet.bags ?? []).map((b) => ({ ...(b ?? {}) }));
  while (bags.length <= dog) bags.push({});
  bags[dog] = bag;
  return bags;
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
  const { minePerSec, dogs } = derivePet(pet);
  const seconds = Math.max(0, elapsedMs) / 1000;
  // Cuenta la jauría entera: los perros liquidan por separado pero comparten
  // el mismo reloj, así que el cupo también es común.
  return Math.floor(minePerSec * dogs * seconds * tolerance) + 1;
}

export { bagFree, bagUsed, derivePet, petBag, petFree, petUsed };
