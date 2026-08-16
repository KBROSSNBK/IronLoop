/**
 * CEREBRO DE LA MASCOTA CUADRÚPEDA.
 *
 * En modo EXTRAER, sus prioridades son estas y en este orden:
 *   1. Si detecta una zona de extracción en su radio Y le queda hueco en la
 *      mochila → va y pica. La minería siempre gana.
 *   2. Si está llena, o no hay zona en el radio → lleva lo que tiene a la
 *      cinta o máquina que le corresponde. Nunca se queda con carga muerta.
 *   3. Si no hay dónde dejarlo, te lo entrega a ti.
 *
 * En modo SEGUIR sólo te acompaña; si le quedó material encima, te lo da y
 * deja de trabajar.
 *
 * El movimiento es autónomo: la mascota decide su propio camino. Lo único que
 * pide al servidor son operaciones acotadas (`petMine`, `petDeposit`,
 * `petUnload`), que se validan allí contra el tiempo transcurrido.
 */

import { moveWithCollision } from '../world/geometry';
import { findPath, hasLineOfSight, type Point } from '../world/pathfinding';
import { nearestStation, stationYield, type DropOff } from '../logic/pet';
import type { StationDef } from '../../config/world';
import type { DerivedPet, PetMode } from '../../config/pets';

export type PetStateName =
  | 'SEGUIR'
  | 'IR_A_VETA'
  | 'MINAR'
  | 'IR_A_CINTA'
  | 'VOLVER'
  | 'DESCARGAR';

/** Distancia a la que se considera que ha llegado a un punto. */
const ARRIVE = 12;
/** Distancia a la que se planta a tu lado en modo seguimiento. */
const FOLLOW_GAP = 46;
/** A partir de aquí corre para alcanzarte. */
const SPRINT_GAP = 210;
/**
 * Correa: por muy buena que sea la veta, si te alejas más de esto lo deja y
 * viene. Sin esto la mascota se queda picando al otro lado del mapa y parece
 * que te ha abandonado.
 */
const LEASH = 560;
/** Sin avanzar durante esto, se recalcula el camino desde cero. */
const STUCK_MS = 700;
/** Duración de la animación de descarga. */
const UNLOAD_MS = 620;
/**
 * Con drones, al llenarse espera a que vengan a por la carga en vez de dejar
 * la veta. Si tardan más que esto (escuadrilla corta o muy lenta), va ella:
 * más vale un paseo que quedarse plantada para siempre.
 */
const DRONE_WAIT_MS = 7000;
/** Distancia a la que se da por alcanzado un punto del camino. */
const WAYPOINT_REACHED = 10;
/** Pausa mínima entre cálculos de ruta. */
const REPATH_MS = 380;
/** Si el destino se mueve más que esto, el camino ya no sirve. */
const GOAL_DRIFT = 46;

export interface PetDebug {
  state: PetStateName;
  target: string;
  carried: number;
  capacity: number;
  pending: number;
  distance: number;
  stuckMs: number;
}

export interface PetTickInput {
  dt: number;
  /** Posición del dueño. */
  ownerX: number;
  ownerY: number;
  /** Stats derivadas (capacidad, velocidad, ritmo de minado, radio). */
  derived: DerivedPet;
  /** Unidades ya confirmadas por el servidor en la mochila COMPARTIDA. */
  storedUnits: number;
  /**
   * Lo que los OTROS perros llevan picado y sin liquidar. La mochila es de la
   * jauría entera, así que sin esto cada uno se creería que le queda todo el
   * hueco libre y liquidarían de más.
   */
  otherPending: number;
  /** Qué le has mandado hacer. */
  mode: PetMode;
  /** Material encargado a ESTE perro, o null para modo automático. */
  target: string | null;
  /**
   * MODO AUTOMÁTICO. Material que la fábrica está esperando ahora mismo.
   *
   * Sin esto, «automático» era «pica lo que pilles al lado», que acaba con
   * tres montañas de hierro y la cadena parada por falta de un cristal. Con
   * esto, el perro mira qué máquina está a punto de arrancar, ve qué le falta
   * y se va a por ello. Lo calcula quien conoce el estado de la fábrica.
   */
  autoTarget: string | null;
  /** ¿Hay drones de apoyo? Entonces no interrumpe la extracción para el paseo. */
  hasDrones: boolean;
  /** ¿Cabe algo en el inventario del dueño? Si no, no tiene sentido entregárselo. */
  ownerHasRoom: boolean;
  /**
   * Dónde dejar lo que lleva: la cinta o máquina que consume ese material.
   * Lo calcula quien la actualiza, que es quien conoce el nivel de fábrica.
   */
  dropOff: DropOff | null;
}

export interface PetTickResult {
  /** Ha acumulado unidades minadas que conviene liquidar. */
  mined: { stationId: string; item: string; qty: number } | null;
  /** Ha llegado a la cinta/máquina: toca soltar la carga ahí. */
  deposit: DropOff | null;
  /** Está pegada al dueño con carga: toca entregársela. */
  unload: boolean;
  /** Un golpe de perforadora, para chispas y sonido. */
  strike: { x: number; y: number; color: string } | null;
}

const NOTHING: PetTickResult = { mined: null, deposit: null, unload: false, strike: null };

export class PetBrain {
  x = 0;
  y = 0;
  /** Dirección a la que mira: 1 derecha, -1 izquierda. */
  facing = 1;
  /** Fase del paso, en vueltas completas. La usa el renderer para el trote. */
  gait = 0;
  /** Velocidad real del último frame, para escalar la animación. */
  speed = 0;
  state: PetStateName = 'SEGUIR';
  /** Unidades minadas aún no confirmadas por el servidor. */
  pending = 0;
  /** Estación en la que está trabajando. */
  station: StationDef | null = null;
  /** Punto de descarga elegido para lo que lleva encima. */
  bay: DropOff | null = null;

  private fraction = 0;
  private unloadUntil = 0;
  private strikeAt = 0;
  private stuckMs = 0;
  private lastX = 0;
  private lastY = 0;
  private spawned = false;
  /** Camino calculado hasta el objetivo actual. */
  private path: Point[] = [];
  private pathGoal: Point | null = null;
  private repathAt = 0;
  /** Desde cuándo está llena esperando a un dron. */
  private fullSince = 0;
  /** Última carga confirmada vista, para detectar cuándo la relevan. */
  private lastStored = 0;

  /**
   * Puesto en la jauría. Separa el sitio de trabajo de cada perro para que no
   * se monten unos encima de otros picando en la misma piedra.
   */
  private readonly slot: number;

  constructor(slot = 0) {
    this.slot = slot;
  }

  /** Desvío lateral de este perro respecto al punto de trabajo común. */
  private get lateral(): number {
    return this.slot === 0 ? 0 : this.slot % 2 === 1 ? -27 : 27;
  }

  /** Coloca la mascota junto a su dueño sin animación (al entrar al juego). */
  reset(x: number, y: number): void {
    this.x = x - 34 + this.lateral;
    this.y = y + 8 + this.slot * 6;
    this.lastX = this.x;
    this.lastY = this.y;
    this.state = 'SEGUIR';
    this.pending = 0;
    this.fraction = 0;
    this.station = null;
    this.spawned = true;
    this.path = [];
    this.pathGoal = null;
  }

  /** Unidades que se le ven encima (confirmadas + pendientes de liquidar). */
  carried(stored: number): number {
    return stored + Math.floor(this.pending);
  }

  update(now: number, input: PetTickInput): PetTickResult {
    const {
      dt,
      ownerX,
      ownerY,
      derived,
      storedUnits,
      otherPending,
      mode,
      target,
      autoTarget,
      ownerHasRoom,
      dropOff,
      hasDrones,
    } = input;
    if (!this.spawned) this.reset(ownerX, ownerY);

    /*
     * Lo que va a buscar: tu encargo manda, y si lo has dejado en automático,
     * lo que la fábrica esté esperando. Sólo si no hace falta nada en ninguna
     * máquina se dedica a picar lo que tenga al lado.
     */
    const encargo = target ?? autoTarget;

    // La mochila es de la jauría: cuenta lo suyo, lo de los demás y lo que ya
    // está confirmado.
    const carried = this.carried(storedUnits) + Math.floor(otherPending);
    const full = carried >= derived.capacity;
    const working = mode === 'gather';
    let result: PetTickResult = { ...NOTHING };

    /* ── 1. Decisión: minar manda; soltar la carga es el plan B ── */
    // Con material encargado no hay correa: se lo has pedido tú y cruza el mapa.
    // Con encargo no hay correa: se lo has pedido tú (o hace falta en una
    // máquina) y cruza el mapa si toca.
    const leashed = !encargo && Math.hypot(ownerX - this.x, ownerY - this.y) > LEASH;
    const found =
      working && !full && !leashed
        ? nearestStation(this.x, this.y, derived.radius, encargo)
        : null;

    // Sitio al que llevar lo que carga. En modo SEGUIR no reparte por la
    // fábrica: te lo da a ti y se acabó.
    // Con drones esperando a recoger, la mascota NO abandona la veta: se
    // queda picando (o esperando un momento) y son ellos los que reparten.
    // Si la carga confirmada BAJA es que alguien se la ha llevado: mientras
    // los drones sigan viniendo, la paciencia se renueva y no abandona la
    // veta. El plazo sólo corre cuando de verdad no la releva nadie.
    if (storedUnits < this.lastStored) this.fullSince = now;
    this.lastStored = storedUnits;

    if (!full) this.fullSince = 0;
    else if (this.fullSince === 0) this.fullSince = now;
    const esperandoDron =
      hasDrones && full && this.fullSince > 0 && now - this.fullSince < DRONE_WAIT_MS;

    const bay = working && storedUnits > 0 && !esperandoDron ? dropOff : null;
    this.bay = bay;

    if (this.state === 'DESCARGAR') {
      if (now >= this.unloadUntil) this.state = 'SEGUIR';
    } else if (found) {
      /*
       * Hay veta y hay hueco: la minería siempre tiene prioridad.
       *
       * La distancia se mide a SU hueco de la veta, no al centro. Cada perro
       * pica desplazado a un lado para no montarse encima del de al lado, y
       * medir al centro los dejaba clavados: ya estaban en su sitio —así que
       * dejaban de andar— pero seguían creyendo que no habían llegado, y no
       * empezaban a picar nunca.
       */
      this.station = found.station;
      const mio = Math.hypot(
        found.point.x + this.lateral - this.x,
        found.point.y - this.y,
      );
      this.state = mio <= ARRIVE + 6 ? 'MINAR' : 'IR_A_VETA';
    } else if (bay) {
      // Llena, o sin veta cerca: el material va a su cinta o máquina.
      this.station = null;
      this.state = 'IR_A_CINTA';
    } else if (esperandoDron) {
      // Llena pero con drones de apoyo: se queda en la veta a que la releven.
      const p = nearestStation(this.x, this.y, derived.radius, encargo);
      this.station = p?.station ?? null;
      this.state = p ? 'MINAR' : 'SEGUIR';
    } else if (carried > 0 && ownerHasRoom) {
      // No hay dónde dejarlo (o no está trabajando): te lo entrega.
      this.station = null;
      this.state = 'VOLVER';
    } else {
      this.station = null;
      this.state = 'SEGUIR';
    }

    /* ── 2. A dónde va ── */
    let goalX = ownerX;
    let goalY = ownerY;
    let stopAt = FOLLOW_GAP;

    if (this.state === 'IR_A_VETA' || this.state === 'MINAR') {
      const p = found ?? nearestStation(this.x, this.y, derived.radius, encargo);
      if (p) {
        // Cada perro pica en su hueco de la veta, no encima del de al lado.
        goalX = p.point.x + this.lateral;
        goalY = p.point.y;
        stopAt = ARRIVE;
      }
    } else if (this.state === 'IR_A_CINTA' && bay) {
      goalX = bay.x + this.lateral * 0.6;
      goalY = bay.y;
      stopAt = ARRIVE + 8;
    } else if (this.state === 'VOLVER') {
      stopAt = 26;
    } else {
      goalX = ownerX + this.lateral;
      goalY = ownerY + this.slot * 5;
    }

    /* ── 3. Movimiento siguiendo un camino calculado ── */
    const dist = Math.hypot(goalX - this.x, goalY - this.y);
    let moving = false;

    if (this.state !== 'MINAR' && this.state !== 'DESCARGAR' && dist > stopAt) {
      this.ensurePath(now, goalX, goalY);

      // Se descartan los puntos ya alcanzados (o que ya se ven superados).
      while (
        this.path.length > 1 &&
        Math.hypot(this.path[0].x - this.x, this.path[0].y - this.y) < WAYPOINT_REACHED
      ) {
        this.path.shift();
      }
      const aim = this.path[0] ?? { x: goalX, y: goalY };

      // Al quedarse muy atrás aprieta el paso: nunca se pierde de vista.
      const urgency = dist > SPRINT_GAP ? 1.55 : dist > FOLLOW_GAP * 2 ? 1.18 : 1;
      const step = derived.speed * urgency * dt;
      const ax = aim.x - this.x;
      const ay = aim.y - this.y;
      const len = Math.hypot(ax, ay) || 1;
      const res = moveWithCollision(this.x, this.y, (ax / len) * step, (ay / len) * step);
      this.x = res.x;
      this.y = res.y;
      moving = true;
      if (Math.abs(ax) > 3) this.facing = ax > 0 ? 1 : -1;

      const progress = Math.hypot(this.x - this.lastX, this.y - this.lastY);
      this.speed = progress / Math.max(dt, 0.001);
      // Si el camino no la lleva a ninguna parte, se tira y se calcula otro.
      if (progress < step * 0.35) this.stuckMs += dt * 1000;
      else this.stuckMs = 0;
      if (this.stuckMs > STUCK_MS) {
        this.stuckMs = 0;
        this.path = [];
        this.pathGoal = null;
        this.repathAt = 0;
      }
    } else {
      this.speed = 0;
      this.stuckMs = 0;
      this.path = [];
      this.pathGoal = null;
      // Mirando a lo que hace: la veta, la cinta o su dueño.
      const look =
        (this.state === 'MINAR' || this.state === 'IR_A_CINTA' ? goalX : ownerX) - this.x;
      if (Math.abs(look) > 4) this.facing = look > 0 ? 1 : -1;
    }
    this.lastX = this.x;
    this.lastY = this.y;

    // El trote se anima con la velocidad real, así el paso "agarra" el suelo.
    this.gait += (moving ? this.speed / 34 : 0) * dt;

    /* ── 4. Trabajo ── */
    if (this.state === 'MINAR' && this.station) {
      const y = stationYield(this.station);
      const room = derived.capacity - carried;
      if (room > 0) {
        this.fraction += derived.minePerSec * y.amount * dt;
        // Un golpe de perforadora cada media unidad, para que se vea el esfuerzo.
        if (now - this.strikeAt > 420) {
          this.strikeAt = now;
          result = { ...result, strike: { x: this.x + this.facing * 15, y: this.y - 2, color: this.station.accent } };
        }
        /*
         * El tope es lo que hay confirmado MÁS lo que lleva sin liquidar, ni
         * un gramo más. Antes se comparaba contra `carried`, que ya incluía lo
         * pendiente, así que lo contaba dos veces: con la perforadora subida
         * la mascota se plantaba a media mochila y parecía que se colgaba,
         * cuando en realidad se creía llena.
         */
        while (
          this.fraction >= 1 &&
          storedUnits + otherPending + this.pending < derived.capacity
        ) {
          this.fraction -= 1;
          this.pending += 1;
        }
        if (this.fraction >= 1) this.fraction = 0; // llena: no acumula deuda
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
    }

    if (this.state === 'IR_A_CINTA' && bay && dist <= stopAt) {
      this.state = 'DESCARGAR';
      this.unloadUntil = now + UNLOAD_MS;
      result = { ...result, deposit: bay };
    }

    if (this.state === 'VOLVER' && dist <= stopAt && storedUnits > 0 && ownerHasRoom) {
      this.state = 'DESCARGAR';
      this.unloadUntil = now + UNLOAD_MS;
      result = { ...result, unload: true };
    }

    return result;
  }

  /**
   * Recalcula la ruta sólo cuando hace falta: si el destino se ha movido, si
   * el camino se ha agotado, o si toca refrescarlo. En campo abierto ni
   * siquiera se llama a A*, basta con ver el objetivo.
   */
  private ensurePath(now: number, goalX: number, goalY: number): void {
    const drifted =
      !this.pathGoal || Math.hypot(this.pathGoal.x - goalX, this.pathGoal.y - goalY) > GOAL_DRIFT;
    if (!drifted && this.path.length > 0 && now < this.repathAt) return;

    // Atajo barato para el caso habitual: si se ve el objetivo, línea recta.
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

  /** El servidor ha confirmado `qty` unidades: dejan de estar pendientes. */
  confirmMined(qty: number): void {
    this.pending = Math.max(0, this.pending - qty);
  }

  /** La liquidación ha fallado (mochila llena, por ejemplo): se descarta. */
  dropPending(): void {
    this.pending = 0;
    this.fraction = 0;
  }

  debug(capacity: number, stored: number): PetDebug {
    return {
      state: this.state,
      target: this.station?.label ?? this.bay?.label ?? 'dueño',
      carried: this.carried(stored),
      capacity,
      pending: Math.floor(this.pending),
      distance: Math.round(this.speed),
      stuckMs: Math.round(this.stuckMs),
    };
  }
}

/**
 * Mascota de otro jugador: sólo sigue a su dueño. No mina ni sincroniza
 * posición — es puramente decorativa, así que no cuesta ancho de banda.
 */
export class RemotePet {
  x = 0;
  y = 0;
  facing = 1;
  gait = 0;
  private spawned = false;

  update(dt: number, ownerX: number, ownerY: number, speed = 160): void {
    if (!this.spawned) {
      this.x = ownerX - 34;
      this.y = ownerY + 8;
      this.spawned = true;
      return;
    }
    const dx = ownerX - 34 - this.x;
    const dy = ownerY + 8 - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= 6) return;
    // Se teletransporta si su dueño se ha ido lejísimos (cambio de zona):
    // perseguirlo por medio mapa no aporta nada y sí cuesta CPU.
    if (d > 900) {
      this.x = ownerX - 34;
      this.y = ownerY + 8;
      return;
    }
    const v = speed * (d > SPRINT_GAP ? 1.55 : 1);
    const step = Math.min(d, v * dt);
    const res = moveWithCollision(this.x, this.y, (dx / d) * step, (dy / d) * step);
    this.x = res.x;
    this.y = res.y;
    if (Math.abs(dx) > 3) this.facing = dx > 0 ? 1 : -1;
    this.gait += step / 34;
  }
}
