import { describe, expect, it } from 'vitest';
import {
  findPath,
  hasLineOfSight,
  invalidatePathGrid,
  isWalkableTile,
} from '../src/game/world/pathfinding';
import { bodyRect, getSolids, rectsOverlap } from '../src/game/world/geometry';
import { SPAWN, STATIONS, TILE, WORLD_COLS, WORLD_ROWS, isOffworld } from '../src/config/world';
import { stationWorkPoint } from '../src/game/logic/pet';
import { MACHINE_LIST } from '../src/config/machines';

function blocked(x: number, y: number): boolean {
  const r = bodyRect(x, y);
  return getSolids().some((s) => rectsOverlap(r, s));
}

/** Recorre el camino punto a punto y comprueba que no atraviesa nada. */
function walkIsClear(sx: number, sy: number, path: { x: number; y: number }[]): boolean {
  let ax = sx;
  let ay = sy;
  for (const p of path) {
    if (!hasLineOfSight(ax, ay, p.x, p.y)) return false;
    ax = p.x;
    ay = p.y;
  }
  return true;
}

describe('rejilla de navegación', () => {
  it('el borde del mapa nunca es transitable', () => {
    invalidatePathGrid();
    expect(isWalkableTile(0, 0)).toBe(false);
    expect(isWalkableTile(WORLD_COLS - 1, 5)).toBe(false);
    expect(isWalkableTile(5, WORLD_ROWS - 1)).toBe(false);
    expect(isWalkableTile(-1, 5)).toBe(false);
  });

  it('el cuerpo de las máquinas no es transitable', () => {
    for (const m of MACHINE_LIST) {
      const tx = Math.floor(m.tx + m.tw / 2);
      const ty = Math.floor(m.ty);
      expect(isWalkableTile(tx, ty), `${m.id} debería bloquear`).toBe(false);
    }
  });

  it('el punto de aparición sí lo es', () => {
    expect(isWalkableTile(Math.floor(SPAWN.x / TILE), Math.floor(SPAWN.y / TILE))).toBe(true);
  });
});

describe('línea de visión', () => {
  it('en campo abierto ve el destino', () => {
    expect(hasLineOfSight(SPAWN.x, SPAWN.y, SPAWN.x + 60, SPAWN.y)).toBe(true);
  });

  it('a través de una máquina no', () => {
    const m = MACHINE_LIST[0];
    const cx = (m.tx + m.tw / 2) * TILE;
    const cy = (m.ty + 0.5) * TILE;
    expect(hasLineOfSight(cx - 200, cy, cx + 200, cy)).toBe(false);
  });
});

describe('cálculo de rutas', () => {
  it('en campo abierto devuelve un único punto: el destino', () => {
    const path = findPath(SPAWN.x, SPAWN.y, SPAWN.x + 70, SPAWN.y + 20);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual({ x: SPAWN.x + 70, y: SPAWN.y + 20 });
  });

  it('llega a todas las zonas de extracción desde la entrada', () => {
    for (const s of STATIONS) {
      if (s.type !== 'oreVein' && s.type !== 'salvage') continue;
      // Al otro planeta se va en nave, no andando: sus vetas no cuentan.
      if (isOffworld(stationWorkPoint(s).y)) continue;
      const goal = stationWorkPoint(s);
      const path = findPath(SPAWN.x, SPAWN.y, goal.x, goal.y);
      expect(path.length, `sin ruta hasta ${s.id}`).toBeGreaterThan(0);
      const last = path[path.length - 1];
      expect(Math.hypot(last.x - goal.x, last.y - goal.y)).toBeLessThan(1);
    }
  });

  it('ninguna ruta atraviesa muros ni máquinas', () => {
    for (const s of STATIONS) {
      if (s.type !== 'oreVein' && s.type !== 'salvage') continue;
      const goal = stationWorkPoint(s);
      const path = findPath(SPAWN.x, SPAWN.y, goal.x, goal.y);
      expect(walkIsClear(SPAWN.x, SPAWN.y, path), `la ruta a ${s.id} atraviesa algo`).toBe(true);
    }
  });

  it('rodea los obstáculos en un trayecto largo de punta a punta', () => {
    const from = stationWorkPoint(STATIONS.find((s) => s.id === 'vein_a')!);
    const to = stationWorkPoint(STATIONS.find((s) => s.id === 'salvage_danger')!);
    expect(blocked(from.x, from.y)).toBe(false);
    expect(blocked(to.x, to.y)).toBe(false);
    // No se ven entre sí: hay media fábrica de por medio.
    expect(hasLineOfSight(from.x, from.y, to.x, to.y)).toBe(false);

    const path = findPath(from.x, from.y, to.x, to.y);
    expect(path.length).toBeGreaterThan(1);
    expect(walkIsClear(from.x, from.y, path)).toBe(true);
  });

  it('un destino dentro de un muro se resuelve al hueco más cercano', () => {
    const m = MACHINE_LIST[0];
    const dentro = { x: (m.tx + m.tw / 2) * TILE, y: (m.ty + 0.2) * TILE };
    expect(blocked(dentro.x, dentro.y)).toBe(true);
    const path = findPath(SPAWN.x, SPAWN.y, dentro.x, dentro.y);
    expect(path.length).toBeGreaterThan(0);
  });

  it('el suavizado no deja puntos redundantes en línea recta', () => {
    const a = STATIONS.find((s) => s.id === 'vein_a')!;
    const b = STATIONS.find((s) => s.id === 'vein_b')!;
    const from = stationWorkPoint(a);
    const to = stationWorkPoint(b);
    const path = findPath(from.x, from.y, to.x, to.y);
    // Dos vetas del mismo yacimiento: como mucho un par de tramos.
    expect(path.length).toBeLessThanOrEqual(4);
  });
});
