/**
 * DRONES DE APOYO.
 *
 * Un dron no extrae nada: su único trabajo es quitar carga —al perro en la
 * propia veta, o a ti mientras andas— y repartirla por las cintas y máquinas
 * que la consumen. Con eso nadie pierde tiempo en el paseo de ida y vuelta.
 *
 * Va en DÚO: cada perro tiene el suyo y tú el tuyo. Y cada viaje se lleva de
 * TODO lo que haya, con una ruta de varias paradas si hace falta, así que no
 * hay material que se quede atrás por ser el montón pequeño.
 *
 * Vuelan, así que van en línea recta: ni colisión ni búsqueda de caminos.
 * Es coherente (están en el aire) y además sale gratis en CPU.
 */

import { planHaul, manifestTop, manifestUnits, type DroneStop } from '../logic/drone';

export type DroneStateName = 'ESPERA' | 'AL_ORIGEN' | 'CARGANDO' | 'AL_DESTINO' | 'SOLTANDO';

/** De quién ha cogido la carga: cambia a qué operación se liquida. */
export type DroneSource = 'pet' | 'player';

/** Altura de vuelo en píxeles sobre el suelo. */
export const DRONE_ALTITUDE = 30;

/** Distancia a la que se considera que ha llegado. */
const ARRIVE = 7;

/**
 * Aceleración del vuelo, en "veces la velocidad punta por segundo". Sin esto
 * el dron cambiaba de dirección en seco y parecía un cursor, no una máquina
 * con inercia.
 */
const ACCEL = 3.2;

/** Distancia a la que empieza a frenar para posarse. */
const BRAKE_DIST = 64;

export interface DroneTickInput {
  dt: number;
  /** Dónde está el perro al que sirve este dron. */
  dogX: number;
  dogY: number;
  /** Lo que el perro lleva encima y aún nadie ha reservado. */
  dogItems: Record<string, number>;
  /** Lo que llevas TÚ y los drones pueden cogerte. */
  playerItems: Record<string, number>;
  /** A quién atiende primero: tu escolta va a lo tuyo, los demás al perro. */
  prefer: DroneSource;
  /** Unidades por viaje y velocidad, según el nivel de la escuadrilla. */
  carry: number;
  speed: number;
  /** Posición del dueño: donde espera cuando no hay trabajo. */
  ownerX: number;
  ownerY: number;
  /** Nivel de fábrica: decide qué cintas y máquinas existen. */
  factoryLevel: number;
  /** Instante en ms. */
  now: number;
}

export interface DroneTickResult {
  /** Ha llegado a una parada: hay que ejecutar el traspaso de verdad. */
  deliver: {
    bay: DroneStop['bay'];
    items: Record<string, number>;
    units: number;
    source: DroneSource;
  } | null;
}

const NOTHING: DroneTickResult = { deliver: null };

function tieneAlgo(items: Record<string, number>): boolean {
  for (const n of Object.values(items)) if (n > 0) return true;
  return false;
}

export class DroneBrain {
  x = 0;
  y = 0;
  /** Balanceo de vuelo, para que no parezca una chincheta. */
  bob = 0;
  facing = 1;
  /** Inclinación del chasis al acelerar, en radianes. Puro game feel. */
  tilt = 0;
  state: DroneStateName = 'ESPERA';
  /** Unidades que lleva colgando ahora mismo. */
  load = 0;
  /** Material predominante de la bodega, para pintar el icono correcto. */
  item: string | null = null;
  /** De dónde ha cogido la carga del viaje actual. */
  source: DroneSource = 'pet';
  /** Bodega: material → unidades. Lo usa el reparto para no duplicar. */
  cargo: Record<string, number> = {};

  /** Puesto en la formación alrededor del dueño (para no amontonarse). */
  private readonly slot: number;

  constructor(slot: number) {
    this.slot = slot;
  }

  private route: DroneStop[] = [];
  private stop = 0;
  private until = 0;
  private spawned = false;
  private phase = Math.random() * Math.PI * 2;
  private vx = 0;
  private vy = 0;

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y - DRONE_ALTITUDE;
    this.spawned = true;
    this.state = 'ESPERA';
    this.load = 0;
    this.cargo = {};
    this.route = [];
    this.vx = 0;
    this.vy = 0;
  }

  /**
   * Punto de espera.
   *
   * El primer dron es tu escolta: se queda contigo pase lo que pase. Los
   * demás esperan junto a SU perro, que es donde va a salir el trabajo, para
   * no perder el viaje de ida cada vez.
   */
  private idlePoint(
    ownerX: number,
    ownerY: number,
    dogX: number,
    dogY: number,
  ): { x: number; y: number } {
    if (this.slot === 0) {
      return { x: ownerX + 26, y: ownerY - DRONE_ALTITUDE - 4 };
    }
    const lado = this.slot % 2 === 1 ? 1 : -1;
    return { x: dogX + lado * 24, y: dogY - DRONE_ALTITUDE - 6 };
  }

  /**
   * Vuelo con inercia: acelera hacia el objetivo y frena al llegar, en vez de
   * teletransportarse en línea recta a velocidad constante. Devuelve true
   * cuando ya está encima del punto.
   */
  private flyTo(tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= ARRIVE) {
      // Amortigua en vez de clavarse: se queda flotando en el sitio.
      this.vx *= Math.max(0, 1 - dt * 6);
      this.vy *= Math.max(0, 1 - dt * 6);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      return true;
    }

    // Freno proporcional a lo que queda: llega suave, no de morros.
    const objetivo = speed * Math.min(1, d / BRAKE_DIST);
    const deseadaX = (dx / d) * objetivo;
    const deseadaY = (dy / d) * objetivo;
    const k = Math.min(1, ACCEL * dt);
    this.vx += (deseadaX - this.vx) * k;
    this.vy += (deseadaY - this.vy) * k;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (Math.abs(this.vx) > 6) this.facing = this.vx > 0 ? 1 : -1;
    // Se inclina hacia donde tira, como un multirrotor de verdad.
    this.tilt += (Math.max(-0.42, Math.min(0.42, this.vx / (speed * 2.6))) - this.tilt) * Math.min(1, dt * 6);
    return false;
  }

  update(input: DroneTickInput): DroneTickResult {
    const {
      dt,
      dogX,
      dogY,
      dogItems,
      playerItems,
      prefer,
      carry,
      speed,
      ownerX,
      ownerY,
      factoryLevel,
      now,
    } = input;
    if (!this.spawned) this.reset(ownerX, ownerY);

    this.phase += dt * 5.5;
    this.bob = Math.sin(this.phase) * 2.4 + Math.sin(this.phase * 0.37) * 0.9;

    switch (this.state) {
      case 'ESPERA': {
        // Cada dron atiende primero a su pareja; sólo si ésta no tiene nada
        // mira lo del otro. Así el trabajo se reparte solo.
        const orden: DroneSource[] = prefer === 'player' ? ['player', 'pet'] : ['pet', 'player'];
        const elegido = orden.find((s) => tieneAlgo(s === 'pet' ? dogItems : playerItems));
        if (elegido) {
          this.source = elegido;
          this.state = 'AL_ORIGEN';
          break;
        }
        const p = this.idlePoint(ownerX, ownerY, dogX, dogY);
        this.flyTo(p.x, p.y, speed * 0.8, dt);
        this.tilt *= Math.max(0, 1 - dt * 3);
        break;
      }

      case 'AL_ORIGEN': {
        const mio = this.source === 'pet';
        const disponible = mio ? dogItems : playerItems;
        if (!tieneAlgo(disponible)) {
          // Se lo ha llevado otro dron (o su dueño): a esperar.
          this.state = 'ESPERA';
          break;
        }
        const ox = mio ? dogX : ownerX;
        const oy = mio ? dogY : ownerY;
        if (this.flyTo(ox, oy - DRONE_ALTITUDE, speed, dt)) {
          this.state = 'CARGANDO';
          this.until = now + 420;
        }
        break;
      }

      case 'CARGANDO': {
        if (now < this.until) break;
        const disponible = this.source === 'pet' ? dogItems : playerItems;
        // La ruta se calcula AQUÍ, con el material que de verdad hay ahora.
        this.route = planHaul(disponible, carry, factoryLevel, { x: this.x, y: this.y });
        this.stop = 0;
        this.cargo = {};
        for (const s of this.route) {
          for (const [item, qty] of Object.entries(s.items)) {
            this.cargo[item] = (this.cargo[item] ?? 0) + qty;
          }
        }
        this.load = manifestUnits(this.cargo);
        this.item = manifestTop(this.cargo);
        this.state = this.load > 0 ? 'AL_DESTINO' : 'ESPERA';
        break;
      }

      case 'AL_DESTINO': {
        const parada = this.route[this.stop];
        if (!parada) {
          this.finish();
          break;
        }
        if (this.flyTo(parada.bay.x, parada.bay.y - DRONE_ALTITUDE, speed, dt)) {
          this.state = 'SOLTANDO';
          this.until = now + 380;
          return {
            deliver: {
              bay: parada.bay,
              items: parada.items,
              units: parada.units,
              source: this.source,
            },
          };
        }
        break;
      }

      case 'SOLTANDO': {
        if (now < this.until) break;
        const parada = this.route[this.stop];
        if (parada) {
          for (const [item, qty] of Object.entries(parada.items)) {
            const queda = (this.cargo[item] ?? 0) - qty;
            if (queda > 0) this.cargo[item] = queda;
            else delete this.cargo[item];
          }
        }
        this.stop += 1;
        this.load = manifestUnits(this.cargo);
        this.item = manifestTop(this.cargo);
        // ¿Quedan paradas? Sigue la ruta; si no, vuelve con su pareja.
        if (this.stop < this.route.length && this.load > 0) this.state = 'AL_DESTINO';
        else this.finish();
        break;
      }
    }

    return { ...NOTHING };
  }

  private finish(): void {
    this.route = [];
    this.stop = 0;
    this.cargo = {};
    this.load = 0;
    this.item = null;
    this.state = 'ESPERA';
  }

  /** ¿Está ocupado en un viaje? Sirve para repartir el trabajo. */
  get busy(): boolean {
    return this.state !== 'ESPERA';
  }
}
