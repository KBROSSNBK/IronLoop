/**
 * BÚSQUEDA DE CAMINOS SOBRE LA REJILLA DEL MUNDO.
 *
 * Los robots logísticos siguen rutas escritas a mano porque su recorrido es
 * siempre el mismo. La mascota no: persigue a su dueño, que va donde le da la
 * gana, así que necesita calcular el camino de verdad. A* sobre 48×34 casillas
 * es instantáneo y evita el clásico bicho que se queda empotrado contra un
 * muro intentando ir en línea recta.
 *
 * La rejilla se construye una sola vez desde los mismos sólidos que usa la
 * colisión, así que nunca puede desincronizarse del mapa.
 */

import { TILE, WORLD_COLS, WORLD_ROWS } from '../../config/world';
import { bodyRect, getSolids, rectsOverlap } from './geometry';

export interface Point {
  x: number;
  y: number;
}

let grid: Uint8Array | null = null;

/** 1 = no se puede estar ahí. */
function buildGrid(): Uint8Array {
  if (grid) return grid;
  const g = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  const solids = getSolids();
  for (let ty = 0; ty < WORLD_ROWS; ty++) {
    for (let tx = 0; tx < WORLD_COLS; tx++) {
      const r = bodyRect(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
      g[ty * WORLD_COLS + tx] = solids.some((s) => rectsOverlap(r, s)) ? 1 : 0;
    }
  }
  grid = g;
  return g;
}

/** Sólo para tests: obliga a reconstruir la rejilla. */
export function invalidatePathGrid(): void {
  grid = null;
}

export function isWalkableTile(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= WORLD_COLS || ty >= WORLD_ROWS) return false;
  return buildGrid()[ty * WORLD_COLS + tx] === 0;
}

/** ¿Se puede ir en línea recta de A a B sin tocar nada? */
export function hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
  const solids = getSolids();
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 9));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const r = bodyRect(ax + (bx - ax) * k, ay + (by - ay) * k);
    if (solids.some((s) => rectsOverlap(r, s))) return false;
  }
  return true;
}

/** Casilla libre más cercana a una dada (para objetivos dentro de un muro). */
function nearestFreeTile(tx: number, ty: number): { tx: number; ty: number } | null {
  if (isWalkableTile(tx, ty)) return { tx, ty };
  for (let radius = 1; radius <= 6; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (isWalkableTile(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
      }
    }
  }
  return null;
}

/** Montículo binario mínimo: mantiene A* en tiempo razonable sin dependencias. */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < this.keys.length && this.keys[l] < this.keys[best]) best = l;
        if (r < this.keys.length && this.keys[r] < this.keys[best]) best = r;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Camino de (sx,sy) a (gx,gy) en píxeles de mundo.
 * Devuelve los puntos intermedios ya suavizados, terminando en el destino.
 * Si no hay ruta posible, devuelve una lista vacía.
 */
export function findPath(sx: number, sy: number, gx: number, gy: number): Point[] {
  // Atajo: si se ve el destino, no hace falta calcular nada.
  if (hasLineOfSight(sx, sy, gx, gy)) return [{ x: gx, y: gy }];

  const start = nearestFreeTile(Math.floor(sx / TILE), Math.floor(sy / TILE));
  const goal = nearestFreeTile(Math.floor(gx / TILE), Math.floor(gy / TILE));
  if (!start || !goal) return [];

  const W = WORLD_COLS;
  const total = W * WORLD_ROWS;
  const startIdx = start.ty * W + start.tx;
  const goalIdx = goal.ty * W + goal.tx;
  if (startIdx === goalIdx) return [{ x: gx, y: gy }];

  const g = buildGrid();
  const cost = new Float32Array(total).fill(Infinity);
  const from = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heap = new MinHeap();

  const h = (idx: number) => {
    const dx = Math.abs((idx % W) - goal.tx);
    const dy = Math.abs(Math.floor(idx / W) - goal.ty);
    // Distancia octil: admisible con movimiento en 8 direcciones.
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  cost[startIdx] = 0;
  heap.push(startIdx, h(startIdx));

  let found = false;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= WORLD_ROWS) continue;
      const nIdx = ny * W + nx;
      if (g[nIdx] === 1 || closed[nIdx]) continue;
      // En diagonal, los dos lados deben estar libres: nada de colarse por
      // la esquina exacta entre dos muros.
      if (dx !== 0 && dy !== 0) {
        if (g[cy * W + nx] === 1 || g[ny * W + cx] === 1) continue;
      }
      const next = cost[cur] + step;
      if (next >= cost[nIdx]) continue;
      cost[nIdx] = next;
      from[nIdx] = cur;
      heap.push(nIdx, next + h(nIdx));
    }
  }

  if (!found) return [];

  // Reconstrucción, del destino hacia atrás.
  const raw: Point[] = [];
  for (let idx = goalIdx; idx !== -1 && idx !== startIdx; idx = from[idx]) {
    raw.push({ x: (idx % W) * TILE + TILE / 2, y: Math.floor(idx / W) * TILE + TILE / 2 });
  }
  raw.reverse();
  raw.push({ x: gx, y: gy });

  return smooth(sx, sy, raw);
}

/**
 * Quita los puntos intermedios innecesarios: si desde donde estoy veo un punto
 * más adelante, los de en medio sobran. Sin esto el movimiento sale a escalones.
 */
function smooth(sx: number, sy: number, points: Point[]): Point[] {
  const out: Point[] = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < points.length) {
    let best = i;
    for (let j = points.length - 1; j > i; j--) {
      if (hasLineOfSight(ax, ay, points[j].x, points[j].y)) {
        best = j;
        break;
      }
    }
    out.push(points[best]);
    ax = points[best].x;
    ay = points[best].y;
    i = best + 1;
  }
  return out;
}
