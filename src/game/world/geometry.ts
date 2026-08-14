/**
 * Geometría del mundo: colisión y detección de interacciones.
 * Todo se deriva de la configuración en config/world.ts + config/machines.ts,
 * así que añadir una máquina o una zona actualiza el mapa automáticamente.
 */

import {
  CONVEYORS,
  PROPS,
  STATIONS,
  TILE,
  WALL_RECTS,
  WORLD_COLS,
  WORLD_H,
  WORLD_ROWS,
  WORLD_W,
  conveyorLoadPoint,
  conveyorRect,
  type ConveyorDef,
  type Rect,
  type StationDef,
} from '../../config/world';
import { MACHINE_LIST, getMachine, type MachineDef } from '../../config/machines';
import { BALANCE } from '../../config/balance';

export interface Solid extends Rect {
  kind: 'wall' | 'machine' | 'prop';
  id?: string;
}

let cachedSolids: Solid[] | null = null;

/** Lista de rectángulos sólidos del mapa (en px de mundo). */
export function getSolids(): Solid[] {
  if (cachedSolids) return cachedSolids;
  const solids: Solid[] = [];

  // Bordes exteriores (1 tile de grosor)
  solids.push({ x: 0, y: 0, w: WORLD_W, h: TILE, kind: 'wall' });
  solids.push({ x: 0, y: WORLD_H - TILE, w: WORLD_W, h: TILE, kind: 'wall' });
  solids.push({ x: 0, y: 0, w: TILE, h: WORLD_H, kind: 'wall' });
  solids.push({ x: WORLD_W - TILE, y: 0, w: TILE, h: WORLD_H, kind: 'wall' });

  for (const r of WALL_RECTS) {
    solids.push({ x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE, kind: 'wall' });
  }

  for (const m of MACHINE_LIST) {
    // El cuerpo de la máquina es sólido salvo la fila frontal (zona de trabajo).
    solids.push({
      x: m.tx * TILE,
      y: m.ty * TILE,
      w: m.tw * TILE,
      h: (m.th - 1) * TILE,
      kind: 'machine',
      id: m.id,
    });
  }

  for (const p of PROPS) {
    if (!p.solid) continue;
    solids.push({ x: p.tx * TILE + 4, y: p.ty * TILE + 8, w: TILE - 8, h: TILE - 12, kind: 'prop' });
  }

  cachedSolids = solids;
  return solids;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Caja de colisión del personaje: sólo los pies, para que se sienta ágil. */
export const BODY = { w: 20, h: 14, offsetY: 8 };

export function bodyRect(x: number, y: number): Rect {
  return { x: x - BODY.w / 2, y: y - BODY.h / 2 + BODY.offsetY, w: BODY.w, h: BODY.h };
}

/** Mueve con resolución por ejes; devuelve la posición final válida. */
export function moveWithCollision(
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number; hit: boolean } {
  const solids = getSolids();
  let nx = x;
  let ny = y;
  let hit = false;

  if (dx !== 0) {
    const candidate = nx + dx;
    const r = bodyRect(candidate, ny);
    if (!solids.some((s) => rectsOverlap(r, s))) nx = candidate;
    else hit = true;
  }
  if (dy !== 0) {
    const candidate = ny + dy;
    const r = bodyRect(nx, candidate);
    if (!solids.some((s) => rectsOverlap(r, s))) ny = candidate;
    else hit = true;
  }

  nx = Math.max(TILE, Math.min(WORLD_W - TILE, nx));
  ny = Math.max(TILE, Math.min(WORLD_H - TILE, ny));
  return { x: nx, y: ny, hit };
}

/* ─────────────────────────── INTERACCIÓN ─────────────────────────── */

export type InteractableKind = 'station' | 'machine' | 'conveyor';

export interface Interactable {
  kind: InteractableKind;
  id: string;
  label: string;
  icon: string;
  accent: string;
  /** Centro del punto de interacción (px de mundo). */
  x: number;
  y: number;
  distance: number;
  station?: StationDef;
  machine?: MachineDef;
  conveyor?: ConveyorDef;
}

function centerOfStation(s: StationDef) {
  return { x: (s.tx + s.tw / 2) * TILE, y: (s.ty + s.th / 2) * TILE };
}

/** Punto de trabajo de una máquina: la fila frontal, delante del cuerpo. */
export function machineFrontPoint(m: MachineDef) {
  return { x: (m.tx + m.tw / 2) * TILE, y: (m.ty + m.th - 0.5) * TILE };
}

let cachedInteractables: Omit<Interactable, 'distance'>[] | null = null;

function allInteractables(): Omit<Interactable, 'distance'>[] {
  if (cachedInteractables) return cachedInteractables;
  const list: Omit<Interactable, 'distance'>[] = [];
  for (const s of STATIONS) {
    const c = centerOfStation(s);
    list.push({
      kind: 'station',
      id: s.id,
      label: s.label,
      icon: s.icon,
      accent: s.accent,
      x: c.x,
      y: c.y,
      station: s,
    });
  }
  for (const m of MACHINE_LIST) {
    const c = machineFrontPoint(m);
    list.push({
      kind: 'machine',
      id: m.id,
      label: m.short,
      icon: m.icon,
      accent: m.accent,
      x: c.x,
      y: c.y,
      machine: m,
    });
  }
  // Extremo de carga de las cintas que alimentan una máquina.
  for (const c of CONVEYORS) {
    if (!c.feeds) continue;
    const p = conveyorLoadPoint(c);
    list.push({
      kind: 'conveyor',
      id: c.id,
      label: c.label ?? 'CINTA',
      icon: '🛒',
      accent: '#38bdf8',
      x: p.x,
      y: p.y,
      conveyor: c,
    });
  }
  cachedInteractables = list;
  return list;
}

/** Interactuable más cercano dentro del radio, o null. */
export function findNearestInteractable(
  x: number,
  y: number,
  range: number,
): Interactable | null {
  let best: Interactable | null = null;
  for (const it of allInteractables()) {
    const d = Math.hypot(it.x - x, it.y - y);
    if (d > range) continue;
    if (!best || d < best.distance) best = { ...it, distance: d };
  }
  return best;
}

/**
 * Cinta sobre la que está el jugador (o muy cerca). Se usa para el traspaso
 * automático: basta con pasar por encima, sin pulsar nada.
 */
export function conveyorUnder(
  x: number,
  y: number,
  predicate?: (c: ConveyorDef) => boolean,
): ConveyorDef | null {
  const r = BALANCE.conveyor.range;
  let best: ConveyorDef | null = null;
  let bestD = Infinity;
  for (const c of CONVEYORS) {
    if (!c.feeds) continue;
    if (predicate && !predicate(c)) continue;
    const box = conveyorRect(c);
    const dx = Math.max(box.x - x, 0, x - (box.x + box.w));
    const dy = Math.max(box.y - y, 0, y - (box.y + box.h));
    const d = Math.hypot(dx, dy);
    if (d <= r && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** Items que una cinta admite: su filtro propio, o la receta de destino. */
export function conveyorAccepts(c: ConveyorDef): string[] {
  if (c.accepts && c.accepts.length > 0) return c.accepts;
  if (!c.feeds) return [];
  return Object.keys(getMachine(c.feeds).input);
}

/** Rectángulo del muelle de venta (px de mundo). La venta sólo vale aquí. */
export function sellAreaRect(): Rect | null {
  const dock = STATIONS.find((s) => s.type === 'sell');
  if (!dock) return null;
  return { x: dock.tx * TILE, y: dock.ty * TILE, w: dock.tw * TILE, h: dock.th * TILE };
}

export function isInsideSellArea(x: number, y: number): boolean {
  const r = sellAreaRect();
  if (!r) return false;
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function worldBounds() {
  return { w: WORLD_W, h: WORLD_H, cols: WORLD_COLS, rows: WORLD_ROWS, tile: TILE };
}
