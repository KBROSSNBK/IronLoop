/**
 * DRONES DE APOYO.
 *
 * Un dron no extrae nada: su único trabajo es quitarle carga al perro en la
 * propia veta y llevarla a la cinta o máquina que la consume. Con eso el
 * perro deja de perder tiempo en el paseo de ida y vuelta y se queda picando,
 * que es lo que sabe hacer.
 *
 * Vuelan, así que van en línea recta: ni colisión ni búsqueda de caminos.
 * Es coherente (están en el aire) y además sale gratis en CPU.
 */

import type { DropOff } from '../logic/pet';

export type DroneStateName = 'ESPERA' | 'AL_PERRO' | 'CARGANDO' | 'AL_DESTINO' | 'SOLTANDO';

/** Altura de vuelo en píxeles sobre el suelo. */
export const DRONE_ALTITUDE = 30;

/** Distancia a la que se considera que ha llegado. */
const ARRIVE = 8;

export interface DroneTickInput {
  dt: number;
  /** Dónde está el perro (de quien coge la carga). */
  dogX: number;
  dogY: number;
  /** Unidades confirmadas que el perro lleva encima. */
  dogUnits: number;
  /** A dónde va el material que carga el perro. */
  dropOff: DropOff | null;
  /** Unidades por viaje y velocidad, según el nivel de la escuadrilla. */
  carry: number;
  speed: number;
  /** Posición del dueño: donde esperan cuando no hay trabajo. */
  ownerX: number;
  ownerY: number;
  /** Instante en ms. */
  now: number;
}

export interface DroneTickResult {
  /** Ha llegado al destino: hay que ejecutar el traspaso de verdad. */
  deliver: { bay: DropOff; units: number } | null;
}

const NOTHING: DroneTickResult = { deliver: null };

export class DroneBrain {
  x = 0;
  y = 0;
  /** Balanceo de vuelo, para que no parezca una chincheta. */
  bob = 0;
  facing = 1;
  state: DroneStateName = 'ESPERA';
  /** Unidades que lleva colgando ahora mismo. */
  load = 0;
  /** Material que lleva, para pintar el icono correcto. */
  item: string | null = null;

  /** Puesto en la formación alrededor del dueño (para no amontonarse). */
  private readonly slot: number;

  constructor(slot: number) {
    this.slot = slot;
  }

  private bay: DropOff | null = null;
  private until = 0;
  private spawned = false;
  private phase = Math.random() * Math.PI * 2;

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y - DRONE_ALTITUDE;
    this.spawned = true;
    this.state = 'ESPERA';
    this.load = 0;
    this.bay = null;
  }

  /** Punto de espera: en formación al lado del dueño. */
  private idlePoint(ownerX: number, ownerY: number): { x: number; y: number } {
    const lado = this.slot % 2 === 0 ? 1 : -1;
    const fila = Math.floor(this.slot / 2);
    return {
      x: ownerX + lado * (26 + fila * 16),
      y: ownerY - DRONE_ALTITUDE - fila * 10,
    };
  }

  /** Vuela recto hacia un punto. Devuelve true al llegar. */
  private flyTo(tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= ARRIVE) return true;
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    if (Math.abs(dx) > 3) this.facing = dx > 0 ? 1 : -1;
    return false;
  }

  update(input: DroneTickInput): DroneTickResult {
    const { dt, dogX, dogY, dogUnits, dropOff, carry, speed, ownerX, ownerY, now } = input;
    if (!this.spawned) this.reset(ownerX, ownerY);

    this.phase += dt * 6;
    this.bob = Math.sin(this.phase) * 2.2;

    switch (this.state) {
      case 'ESPERA': {
        // Sólo arranca si de verdad hay carga que mover Y sitio donde dejarla.
        if (dogUnits > 0 && dropOff) {
          this.bay = dropOff;
          this.state = 'AL_PERRO';
          break;
        }
        const p = this.idlePoint(ownerX, ownerY);
        this.flyTo(p.x, p.y, speed * 0.75, dt);
        break;
      }

      case 'AL_PERRO': {
        if (dogUnits <= 0) {
          // Se lo ha llevado otro dron (o el propio perro): a esperar.
          this.state = 'ESPERA';
          break;
        }
        if (this.flyTo(dogX, dogY - DRONE_ALTITUDE, speed, dt)) {
          this.state = 'CARGANDO';
          this.until = now + 450;
        }
        break;
      }

      case 'CARGANDO': {
        if (now < this.until) break;
        this.load = Math.min(carry, dogUnits);
        this.item = this.bay ? this.bay.machineId : null;
        this.state = this.load > 0 && this.bay ? 'AL_DESTINO' : 'ESPERA';
        break;
      }

      case 'AL_DESTINO': {
        if (!this.bay) {
          this.state = 'ESPERA';
          break;
        }
        if (this.flyTo(this.bay.x, this.bay.y - DRONE_ALTITUDE, speed, dt)) {
          this.state = 'SOLTANDO';
          this.until = now + 400;
          return { deliver: { bay: this.bay, units: this.load } };
        }
        break;
      }

      case 'SOLTANDO': {
        if (now < this.until) break;
        this.load = 0;
        this.item = null;
        this.bay = null;
        this.state = 'ESPERA';
        break;
      }
    }

    return { ...NOTHING };
  }

  /** ¿Está ocupado en un viaje? Sirve para repartir el trabajo. */
  get busy(): boolean {
    return this.state !== 'ESPERA';
  }
}
