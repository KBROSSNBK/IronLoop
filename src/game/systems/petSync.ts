/**
 * SINCRONIZACIÓN DE LA JAURÍA ENTRE JUGADORES.
 *
 * Antes la posición de las mascotas no viajaba: cada cliente simulaba que el
 * perro del vecino le seguía a todas partes. Salía barato, pero era mentira —
 * veías los perros de los demás pegados a su dueño mientras en realidad estaban
 * picando en una veta al otro lado del mapa. Y como saber quién tiene la jauría
 * trabajando es parte de jugar, la mentira estorbaba.
 *
 * Ahora sí viaja, pero apretada: cada mascota son TRES números —x, y, y qué
 * está haciendo— en una lista plana. Una jauría entera con su camión ocupa unos
 * pocos bytes, y se manda a su propio ritmo (más lento que el del jugador,
 * porque un perro trotando no necesita sesenta actualizaciones por segundo).
 * El resto lo pone la interpolación en el cliente que mira.
 *
 * Las coordenadas van redondeadas: medio píxel no lo distingue nadie y en
 * cambio se nota en la factura de una base de datos que cobra por datos.
 */

import type { CaexStateName } from './caexBrain';
import type { PetStateName } from './petBrain';

/** Qué está haciendo, en un solo número. */
export const ACT_ANDAR = 0;
export const ACT_MINAR = 1;
export const ACT_SOLTAR = 2;

/** Números por mascota dentro de la lista plana. */
export const CAMPOS = 3;

export interface MascotaVista {
  x: number;
  y: number;
  act: number;
}

/** Resume el estado del cerebro en el único dato que el vecino necesita ver. */
export function actDesdeEstado(estado: PetStateName): number {
  if (estado === 'MINAR') return ACT_MINAR;
  if (estado === 'DESCARGAR') return ACT_SOLTAR;
  return ACT_ANDAR;
}

/** Lo mismo para el camión, que tiene sus propios nombres de estado. */
export function actDesdeCaex(estado: CaexStateName): number {
  if (estado === 'CARGANDO') return ACT_MINAR;
  if (estado === 'VACIANDO') return ACT_SOLTAR;
  return ACT_ANDAR;
}

/** Y al revés, para que el perro remoto se dibuje picando y no trotando. */
export function estadoDesdeAct(act: number): PetStateName {
  if (act === ACT_MINAR) return 'MINAR';
  if (act === ACT_SOLTAR) return 'DESCARGAR';
  return 'SEGUIR';
}

/** Empaqueta la jauría en la lista plana que viaja por la red. */
export function empaquetar(
  mascotas: { x: number; y: number; state: PetStateName }[],
): number[] {
  const out: number[] = [];
  for (const m of mascotas) {
    out.push(Math.round(m.x), Math.round(m.y), actDesdeEstado(m.state));
  }
  return out;
}

/**
 * Deshace el empaquetado. Tolera lo que devuelve la Realtime Database, que
 * puede entregar una lista como un mapa de índices y colar huecos nulos.
 */
export function desempaquetar(raw: unknown): MascotaVista[] {
  if (!raw) return [];
  const plano: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'object'
      ? Object.keys(raw as object)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0)
          .sort((a, b) => a - b)
          .map((i) => (raw as Record<number, unknown>)[i])
      : [];

  const out: MascotaVista[] = [];
  for (let i = 0; i + CAMPOS - 1 < plano.length; i += CAMPOS) {
    const x = plano[i];
    const y = plano[i + 1];
    const act = plano[i + 2];
    // Una tripleta incompleta se descarta entera: media mascota no se dibuja.
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y, act: typeof act === 'number' ? act : ACT_ANDAR });
  }
  return out;
}

/** ¿Ha cambiado algo que merezca gastar una escritura? */
export function mereceMandar(previo: number[], actual: number[], umbral = 2): boolean {
  if (previo.length !== actual.length) return true;
  for (let i = 0; i < actual.length; i += CAMPOS) {
    // La actividad cambia poco y se ve mucho: cualquier cambio va inmediato.
    if (previo[i + 2] !== actual[i + 2]) return true;
    if (Math.abs(previo[i] - actual[i]) >= umbral) return true;
    if (Math.abs(previo[i + 1] - actual[i + 1]) >= umbral) return true;
  }
  return false;
}

/* ─────────────────── lo que ve el que mira ─────────────────── */

interface Vista {
  x: number;
  y: number;
  desdeX: number;
  desdeY: number;
  haciaX: number;
  haciaY: number;
  desde: number;
  facing: number;
  gait: number;
  act: number;
}

/**
 * La jauría de OTRO jugador, interpolada.
 *
 * Llegan fotos sueltas cada pocas décimas; esto las convierte en movimiento
 * continuo, igual que se hace con el propio jugador remoto. El trote se deriva
 * de lo que se recorre, así que las patas van al ritmo del avance real.
 */
export class RemoteHerd {
  private vistas: Vista[] = [];

  /** Llega una foto nueva de dónde están. */
  target(packed: unknown, now: number): void {
    const lista = desempaquetar(packed);
    if (lista.length < this.vistas.length) this.vistas.length = lista.length;
    lista.forEach((m, i) => {
      const v = this.vistas[i];
      if (!v) {
        // Recién aparecida: se planta donde está, sin deslizarse desde el cero.
        this.vistas[i] = {
          x: m.x, y: m.y,
          desdeX: m.x, desdeY: m.y,
          haciaX: m.x, haciaY: m.y,
          desde: now, facing: 1, gait: Math.random() * 10, act: m.act,
        };
        return;
      }
      v.desdeX = v.x;
      v.desdeY = v.y;
      v.haciaX = m.x;
      v.haciaY = m.y;
      v.desde = now;
      v.act = m.act;
    });
  }

  /** Avanza la interpolación. `ventana` es cada cuánto llegan las fotos. */
  update(now: number, ventana: number): void {
    for (const v of this.vistas) {
      const k = ventana > 0 ? Math.min(1, (now - v.desde) / ventana) : 1;
      const x = v.desdeX + (v.haciaX - v.desdeX) * k;
      const y = v.desdeY + (v.haciaY - v.desdeY) * k;
      const avance = Math.hypot(x - v.x, y - v.y);
      if (Math.abs(x - v.x) > 0.6) v.facing = x > v.x ? 1 : -1;
      v.gait += avance / 34;
      v.x = x;
      v.y = y;
    }
  }

  get list(): readonly Vista[] {
    return this.vistas;
  }
}
