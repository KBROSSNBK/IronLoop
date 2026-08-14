/**
 * MÁQUINA DE ESTADOS DE LOS ROBOTS.
 *
 * Reparto de responsabilidades:
 *  · El TRASLADO de material es autoritativo y determinista (`settleRobots`):
 *    ocurra o no alguien mirando, el balance de la fábrica es el mismo.
 *  · Esta máquina de estados gobierna el COMPORTAMIENTO visible: buscar,
 *    ir, cargar, transportar, depositar y volver, con detección de bloqueo
 *    y recuperación automática.
 *
 * El motivo de separarlo: sincronizar por red la posición de cada robot sería
 * caro e innecesario, pero un robot que "da vueltas" sin relación con lo que
 * de verdad transporta se nota y molesta. Aquí el estado sí depende del
 * trabajo real: sin material en origen, el robot espera; con material, hace
 * el viaje completo.
 */

import {
  ROBOT_TRIP,
  robotCarry,
  type RobotDef,
} from '../../config/robots';
import { getSolids, rectsOverlap } from '../world/geometry';

export type RobotStateName =
  | 'IDLE'
  | 'BUSCAR_MATERIAL'
  | 'IR_A_ORIGEN'
  | 'CARGAR'
  | 'TRANSPORTAR'
  | 'DEPOSITAR'
  | 'VOLVER'
  | 'RECUPERANDO';

/** Cuánto puede estar sin avanzar antes de considerarse bloqueado. */
const STUCK_AFTER_MS = 1400;
/** Avance mínimo para no considerarse bloqueado. */
const STUCK_MIN_PROGRESS = 3;
/** Fallos seguidos antes de reiniciar la IA por completo. */
const MAX_RECOVERIES = 3;
/** Separación mínima entre robots para que no ocupen el mismo punto. */
const ROBOT_SEPARATION = 26;

export interface RobotDebug {
  id: string;
  state: RobotStateName;
  target: string;
  distance: number;
  speed: number;
  stuckMs: number;
  recoveries: number;
  carrying: number;
  lastAction: string;
}

const BODY = 11;

function blocked(x: number, y: number): boolean {
  const box = { x: x - BODY, y: y - BODY, w: BODY * 2, h: BODY * 2 };
  return getSolids().some((s) => rectsOverlap(box, s));
}

/**
 * Un robot. Sigue la ruta configurada como lista de puntos de paso, pero si
 * se atasca busca un desvío lateral; si el desvío tampoco funciona, salta al
 * siguiente punto; y si nada funciona, reinicia su ciclo.
 */
export class RobotBrain {
  x: number;
  y: number;
  state: RobotStateName = 'IDLE';
  /** Índice del punto de paso al que se dirige. */
  private wp = 0;
  /** Sentido del recorrido: +1 hacia el destino, −1 de vuelta. */
  private dir: 1 | -1 = 1;
  private timer = 0;
  private stuckMs = 0;
  private recoveries = 0;
  private lastX: number;
  private lastY: number;
  /** Desvío temporal cuando el camino directo está bloqueado. */
  private detour: { x: number; y: number } | null = null;
  private detourMs = 0;
  private lastAction = 'inicio';
  carrying = 0;
  readonly def: RobotDef;

  constructor(def: RobotDef) {
    this.def = def;
    this.x = def.path[0].x;
    this.y = def.path[0].y;
    this.lastX = this.x;
    this.lastY = this.y;
  }

  private get goal(): { x: number; y: number } {
    return this.detour ?? this.def.path[this.wp];
  }

  /** Reinicio completo: vuelve al origen y empieza de cero. */
  private resetAI(reason: string): void {
    this.state = 'BUSCAR_MATERIAL';
    this.wp = 0;
    this.dir = 1;
    this.detour = null;
    this.stuckMs = 0;
    this.recoveries = 0;
    this.carrying = 0;
    this.x = this.def.path[0].x;
    this.y = this.def.path[0].y;
    this.lastAction = `reset: ${reason}`;
  }

  /** Busca un punto lateral libre para rodear el obstáculo. */
  private findDetour(): boolean {
    const goal = this.def.path[this.wp];
    const ang = Math.atan2(goal.y - this.y, goal.x - this.x);
    for (const side of [1, -1]) {
      for (const dist of [30, 52, 78]) {
        const a = ang + side * (Math.PI / 2);
        const px = this.x + Math.cos(a) * dist;
        const py = this.y + Math.sin(a) * dist;
        if (!blocked(px, py)) {
          this.detour = { x: px, y: py };
          this.detourMs = 1200;
          this.lastAction = 'rodeando obstáculo';
          return true;
        }
      }
    }
    return false;
  }

  /** Escalada de recuperación: desvío → saltar punto → reiniciar IA. */
  private recover(): void {
    this.recoveries += 1;
    this.stuckMs = 0;

    if (this.recoveries >= MAX_RECOVERIES) {
      this.resetAI('bloqueado repetidamente');
      return;
    }
    if (this.findDetour()) return;

    // Sin desvío posible: se salta al siguiente punto de paso.
    const last = this.def.path.length - 1;
    const next = this.wp + this.dir;
    if (next < 0 || next > last) {
      this.resetAI('sin ruta alternativa');
      return;
    }
    this.wp = next;
    this.detour = null;
    this.lastAction = 'saltando punto de paso';
  }

  /**
   * Avanza un paso.
   * @param hasWork si hay material real que transportar.
   * @param others posiciones de los demás robots, para no solaparse.
   */
  update(
    dt: number,
    hasWork: boolean,
    level: number,
    others: { x: number; y: number }[],
  ): void {
    const last = this.def.path.length - 1;

    // Sin trabajo: espera en el origen. Es el único estado "quieto" válido.
    if (!hasWork) {
      if (this.state !== 'IDLE') {
        this.state = 'IDLE';
        this.lastAction = 'esperando material';
        this.carrying = 0;
        this.detour = null;
        this.wp = 0;
        this.dir = 1;
      }
      // Vuelve despacio al punto de espera si se quedó a medias.
      const home = this.def.path[0];
      const d = Math.hypot(home.x - this.x, home.y - this.y);
      if (d > 2) {
        const step = Math.min(d, ROBOT_TRIP.speed * dt);
        this.x += ((home.x - this.x) / d) * step;
        this.y += ((home.y - this.y) / d) * step;
      }
      return;
    }

    if (this.state === 'IDLE') {
      this.state = 'BUSCAR_MATERIAL';
      this.lastAction = 'material detectado';
    }

    /* ── estados con temporizador ── */
    if (this.state === 'CARGAR' || this.state === 'DEPOSITAR') {
      this.timer -= dt * 1000;
      if (this.timer <= 0) {
        if (this.state === 'CARGAR') {
          this.carrying = robotCarry(this.def, level);
          this.state = 'TRANSPORTAR';
          this.dir = 1;
          this.wp = 1;
          this.lastAction = `cargadas ${this.carrying} unidades`;
        } else {
          this.carrying = 0;
          this.state = 'VOLVER';
          this.dir = -1;
          this.wp = last - 1;
          this.lastAction = 'entregado, volviendo';
        }
        this.detour = null;
        this.recoveries = 0;
      }
      return;
    }

    if (this.state === 'BUSCAR_MATERIAL') {
      // El origen es el primer punto de paso.
      this.state = 'IR_A_ORIGEN';
      this.dir = -1;
      this.wp = 0;
      this.lastAction = 'yendo a por material';
    }

    /* ── movimiento hacia el punto activo ── */
    const goal = this.goal;
    let dx = goal.x - this.x;
    let dy = goal.y - this.y;
    let dist = Math.hypot(dx, dy);

    // Separación entre robots: empuje suave para no ocupar el mismo punto.
    for (const o of others) {
      const ox = this.x - o.x;
      const oy = this.y - o.y;
      const od = Math.hypot(ox, oy);
      if (od > 0.001 && od < ROBOT_SEPARATION) {
        const push = (ROBOT_SEPARATION - od) / ROBOT_SEPARATION;
        dx += (ox / od) * push * 40;
        dy += (oy / od) * push * 40;
        dist = Math.hypot(dx, dy);
      }
    }

    if (dist < 3) {
      // Punto alcanzado.
      if (this.detour) {
        this.detour = null;
        this.lastAction = 'obstáculo rodeado';
        return;
      }
      if (this.dir === 1 && this.wp >= last) {
        this.state = 'DEPOSITAR';
        this.timer = ROBOT_TRIP.unloadMs;
        this.lastAction = 'depositando en la cinta';
        return;
      }
      if (this.dir === -1 && this.wp <= 0) {
        this.state = 'CARGAR';
        this.timer = ROBOT_TRIP.loadMs;
        this.lastAction = 'cargando en la máquina';
        return;
      }
      this.wp += this.dir;
      this.state = this.dir === 1 ? 'TRANSPORTAR' : 'VOLVER';
      return;
    }

    const step = ROBOT_TRIP.speed * dt;
    const nx = this.x + (dx / dist) * step;
    const ny = this.y + (dy / dist) * step;

    if (!blocked(nx, ny)) {
      this.x = nx;
      this.y = ny;
    } else if (!blocked(nx, this.y)) {
      this.x = nx;
    } else if (!blocked(this.x, ny)) {
      this.y = ny;
    }

    /* ── detección de bloqueo ── */
    const progress = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    if (progress < STUCK_MIN_PROGRESS * dt) {
      this.stuckMs += dt * 1000;
      if (this.stuckMs >= STUCK_AFTER_MS) {
        this.state = 'RECUPERANDO';
        this.recover();
        if (this.state === 'RECUPERANDO') {
          this.state = this.dir === 1 ? 'TRANSPORTAR' : 'VOLVER';
        }
      }
    } else {
      this.stuckMs = 0;
      this.lastX = this.x;
      this.lastY = this.y;
    }

    if (this.detour) {
      this.detourMs -= dt * 1000;
      if (this.detourMs <= 0) this.detour = null;
    }
  }

  debug(): RobotDebug {
    const goal = this.goal;
    return {
      id: this.def.id,
      state: this.state,
      target: this.detour ? 'desvío' : `wp${this.wp}`,
      distance: Math.round(Math.hypot(goal.x - this.x, goal.y - this.y)),
      speed: ROBOT_TRIP.speed,
      stuckMs: Math.round(this.stuckMs),
      recoveries: this.recoveries,
      carrying: this.carrying,
      lastAction: this.lastAction,
    };
  }
}

/** Etiqueta legible del estado, para el HUD del robot. */
export const ROBOT_STATE_LABEL: Record<RobotStateName, string> = {
  IDLE: 'SIN MATERIAL',
  BUSCAR_MATERIAL: 'BUSCANDO',
  IR_A_ORIGEN: 'AL ORIGEN',
  CARGAR: 'CARGANDO',
  TRANSPORTAR: 'TRANSPORTANDO',
  DEPOSITAR: 'DEPOSITANDO',
  VOLVER: 'VOLVIENDO',
  RECUPERANDO: 'RECALCULANDO',
};
