/**
 * CEREBRO DEL CAEX.
 *
 * No se le manda a ningún sitio: hace LA RONDA. Recorre todas las zonas de
 * recolección de su mundo, una detrás de otra y siempre en el mismo orden, y
 * en cada parada carga lo que esa veta dé hasta que se le acaba el turno o se
 * le llena la tolva. Cuando está lleno va a vaciar y vuelve a la ronda por
 * donde la dejó.
 *
 * Es a propósito aburrido y predecible: eso es lo que lo hace útil de fondo.
 * Lo que decides tú es cuánto mejora, no a dónde va.
 */

import { moveWithCollision } from '../world/geometry';
import { findPath, hasLineOfSight, type Point } from '../world/pathfinding';
import { PET_STATIONS, stationWorkPoint, stationYield, type DropOff } from '../logic/pet';
import { sameRealm } from '../../config/world';
import type { StationDef } from '../../config/world';
import type { DerivedCaex } from '../../config/caex';

export type CaexStateName = 'EN_RUTA' | 'CARGANDO' | 'A_DESCARGAR' | 'VACIANDO' | 'PARADO';

/** Distancia a la que se considera que ha llegado. */
const ARRIVE = 18;
/** Sin avanzar durante esto, se recalcula el camino desde cero. */
const STUCK_MS = 900;
const WAYPOINT_REACHED = 14;
const REPATH_MS = 420;
/** Lo que tarda en bascular la tolva. */
const DUMP_MS = 900;
/**
 * Con dron, al llenarse espera a que venga en vez de dejar la ronda. Si tarda
 * más que esto, va él: más vale un viaje que quedarse parado.
 */
const DRONE_WAIT_MS = 8000;

export interface CaexTickInput {
  dt: number;
  derived: DerivedCaex;
  /** Unidades confirmadas en su tolva. */
  storedUnits: number;
  mode: 'route' | 'off';
  /** ¿Tiene dron? Entonces no abandona la ronda al llenarse. */
  hasDrone: boolean;
  /** Dónde vaciar lo que lleva. */
  dropOff: DropOff | null;
  /** Segundos que se queda en cada parada. */
  dwellMs: number;
}

export interface CaexTickResult {
  /** Ha cargado unidades que conviene liquidar. */
  mined: { stationId: string; item: string; qty: number } | null;
  /** Ha llegado al punto de descarga: toca soltar. */
  deposit: DropOff | null;
  /** Una cucharada, para polvo y sonido. */
  scoop: { x: number; y: number; color: string } | null;
}

const NOTHING: CaexTickResult = { mined: null, deposit: null, scoop: null };

/**
 * La ronda: todas las estaciones del mismo mundo, en un orden estable que
 * dibuja un circuito razonable en vez de dar saltos por el mapa.
 */
export function caexRoute(y: number): StationDef[] {
  const mias = PET_STATIONS.filter((s) => sameRealm(stationWorkPoint(s).y, y));
  // Ordenadas por ángulo alrededor del centro de todas: sale un anillo, que es
  // lo que hace un camión de mina de verdad.
  const pts = mias.map((s) => ({ s, p: stationWorkPoint(s) }));
  const cx = pts.reduce((a, v) => a + v.p.x, 0) / Math.max(1, pts.length);
  const cy = pts.reduce((a, v) => a + v.p.y, 0) / Math.max(1, pts.length);
  return pts
    .sort((a, b) => Math.atan2(a.p.y - cy, a.p.x - cx) - Math.atan2(b.p.y - cy, b.p.x - cx))
    .map((v) => v.s);
}

export class CaexBrain {
  x = 0;
  y = 0;
  /** 1 derecha, -1 izquierda. */
  facing = 1;
  /** Vuelta de rueda acumulada, para animar. */
  roll = 0;
  speed = 0;
  state: CaexStateName = 'EN_RUTA';
  /** Unidades cargadas sin liquidar. */
  pending = 0;
  /** Parada actual de la ronda. */
  station: StationDef | null = null;
  bay: DropOff | null = null;
  /** Balanceo de la suspensión. */
  tilt = 0;

  private route: StationDef[] = [];
  private idx = 0;
  private fraction = 0;
  private dwellUntil = 0;
  private dumpUntil = 0;
  private scoopAt = 0;
  private stuckMs = 0;
  private lastX = 0;
  private lastY = 0;
  private spawned = false;
  private path: Point[] = [];
  private pathGoal: Point | null = null;
  private repathAt = 0;
  private fullSince = 0;
  private lastStored = 0;

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y + 26;
    this.lastX = this.x;
    this.lastY = this.y;
    this.spawned = true;
    this.pending = 0;
    this.fraction = 0;
    this.path = [];
    this.pathGoal = null;
    this.route = caexRoute(this.y);
    this.idx = 0;
    this.state = 'EN_RUTA';
  }

  /** Unidades que se le ven en la tolva. */
  carried(stored: number): number {
    return stored + Math.floor(this.pending);
  }

  update(now: number, input: CaexTickInput): CaexTickResult {
    const { dt, derived, storedUnits, mode, hasDrone, dropOff, dwellMs } = input;
    if (!this.spawned) return { ...NOTHING };
    if (mode !== 'route') {
      this.state = 'PARADO';
      this.speed = 0;
      return { ...NOTHING };
    }

    // Si cambia de mundo (te lo llevas al planeta) la ronda se rehace.
    if (this.route.length === 0 || !sameRealm(stationWorkPoint(this.route[0]).y, this.y)) {
      this.route = caexRoute(this.y);
      this.idx = 0;
    }

    let result: CaexTickResult = { ...NOTHING };
    const carried = this.carried(storedUnits);
    const full = carried >= derived.capacity;

    // Si la carga confirmada BAJA es que el dron ha pasado: la paciencia se
    // renueva y el camión no abandona la ronda.
    if (storedUnits < this.lastStored) this.fullSince = now;
    this.lastStored = storedUnits;
    if (!full) this.fullSince = 0;
    else if (this.fullSince === 0) this.fullSince = now;
    const esperandoDron =
      hasDrone && full && this.fullSince > 0 && now - this.fullSince < DRONE_WAIT_MS;

    /* ── 1. Decisión ── */
    if (this.state === 'VACIANDO') {
      if (now >= this.dumpUntil) this.state = 'EN_RUTA';
    } else if (full && !esperandoDron && dropOff) {
      this.bay = dropOff;
      this.state = 'A_DESCARGAR';
    } else {
      this.bay = null;
      this.station = this.route[this.idx % Math.max(1, this.route.length)] ?? null;
      if (this.state !== 'CARGANDO') this.state = 'EN_RUTA';
    }

    /* ── 2. A dónde va ── */
    let goalX = this.x;
    let goalY = this.y;
    if (this.state === 'A_DESCARGAR' && this.bay) {
      goalX = this.bay.x;
      goalY = this.bay.y;
    } else if (this.station) {
      const p = stationWorkPoint(this.station);
      goalX = p.x;
      // Aparca un poco más abajo que los perros: es mucho más grande.
      goalY = p.y + 16;
    }

    const dist = Math.hypot(goalX - this.x, goalY - this.y);

    /* ── 3. Marcha ── */
    if (this.state !== 'CARGANDO' && this.state !== 'VACIANDO' && dist > ARRIVE) {
      this.ensurePath(now, goalX, goalY);
      while (
        this.path.length > 1 &&
        Math.hypot(this.path[0].x - this.x, this.path[0].y - this.y) < WAYPOINT_REACHED
      ) {
        this.path.shift();
      }
      const aim = this.path[0] ?? { x: goalX, y: goalY };
      const step = derived.speed * dt;
      const ax = aim.x - this.x;
      const ay = aim.y - this.y;
      const len = Math.hypot(ax, ay) || 1;
      const res = moveWithCollision(this.x, this.y, (ax / len) * step, (ay / len) * step);
      this.x = res.x;
      this.y = res.y;
      if (Math.abs(ax) > 4) this.facing = ax > 0 ? 1 : -1;

      const progress = Math.hypot(this.x - this.lastX, this.y - this.lastY);
      this.speed = progress / Math.max(dt, 0.001);
      this.roll += progress / 14;
      // Cabecea al arrancar y al frenar: se le nota el peso.
      this.tilt += (Math.min(0.06, this.speed / 2600) - this.tilt) * Math.min(1, dt * 3);
      if (progress < step * 0.35) this.stuckMs += dt * 1000;
      else this.stuckMs = 0;
      if (this.stuckMs > STUCK_MS) {
        this.stuckMs = 0;
        this.path = [];
        this.pathGoal = null;
        this.repathAt = 0;
        // Si de verdad no puede llegar, se salta la parada en vez de empotrarse.
        if (this.state === 'EN_RUTA') this.idx = (this.idx + 1) % Math.max(1, this.route.length);
      }
    } else {
      this.speed = 0;
      this.stuckMs = 0;
      this.path = [];
      this.pathGoal = null;
      this.tilt *= Math.max(0, 1 - dt * 4);
      if (this.state === 'A_DESCARGAR' && this.bay) {
        // Ha llegado a la máquina: bascula.
        this.state = 'VACIANDO';
        this.dumpUntil = now + DUMP_MS;
        result = { ...result, deposit: this.bay };
      } else if (this.state === 'EN_RUTA' && this.station) {
        this.state = 'CARGANDO';
        this.dwellUntil = now + dwellMs;
      }
    }
    this.lastX = this.x;
    this.lastY = this.y;

    /* ── 4. Carga ── */
    if (this.state === 'CARGANDO' && this.station) {
      const y = stationYield(this.station);
      if (storedUnits + this.pending < derived.capacity) {
        this.fraction += derived.minePerSec * y.amount * dt;
        while (this.fraction >= 1 && storedUnits + this.pending < derived.capacity) {
          this.fraction -= 1;
          this.pending += 1;
        }
        if (this.fraction >= 1) this.fraction = 0;
        if (now - this.scoopAt > 620) {
          this.scoopAt = now;
          result = {
            ...result,
            scoop: { x: this.x + this.facing * 26, y: this.y - 6, color: this.station.accent },
          };
        }
      }
      if (this.pending >= 1) {
        result = {
          ...result,
          mined: {
            stationId: this.station.id,
            item: y.item,
            qty: Math.floor(this.pending),
          },
        };
      }
      // Se acabó el turno, o ya no cabe más: a la siguiente parada.
      if (now >= this.dwellUntil || storedUnits + this.pending >= derived.capacity) {
        this.state = 'EN_RUTA';
        this.idx = (this.idx + 1) % Math.max(1, this.route.length);
      }
    }

    return result;
  }

  private ensurePath(now: number, goalX: number, goalY: number): void {
    const drifted =
      !this.pathGoal || Math.hypot(this.pathGoal.x - goalX, this.pathGoal.y - goalY) > 50;
    if (!drifted && this.path.length > 0 && now < this.repathAt) return;
    if (hasLineOfSight(this.x, this.y, goalX, goalY)) {
      this.path = [{ x: goalX, y: goalY }];
      this.pathGoal = { x: goalX, y: goalY };
      this.repathAt = now + REPATH_MS;
      return;
    }
    const route = findPath(this.x, this.y, goalX, goalY);
    this.path = route.length > 0 ? route : [{ x: goalX, y: goalY }];
    this.pathGoal = { x: goalX, y: goalY };
    this.repathAt = now + REPATH_MS;
  }

  confirmMined(qty: number): void {
    this.pending = Math.max(0, this.pending - qty);
  }

  dropPending(): void {
    this.pending = 0;
    this.fraction = 0;
  }

  /** Etiqueta de la parada actual, para el HUD. */
  get where(): string {
    if (this.state === 'A_DESCARGAR' || this.state === 'VACIANDO') {
      return this.bay?.label ?? 'descargando';
    }
    return this.station?.label ?? 'en ruta';
  }
}
