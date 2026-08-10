/**
 * Bus de eventos ligero para el "game feel".
 * Desacopla la lógica (operaciones) de sus efectos (partículas, sonidos,
 * números flotantes, toasts) sin pasar callbacks por media aplicación.
 */

export interface GameEvents {
  /** Número flotante sobre el jugador local. */
  float: { text: string; color?: string; kind?: 'money' | 'xp' | 'item' | 'bad' };
  /** Explosión de partículas en coordenadas de mundo. */
  burst: { x: number; y: number; color: string; count?: number; power?: number; kind?: 'spark' | 'smoke' | 'ring' };
  /** Notificación en la esquina. */
  toast: { title: string; body?: string; icon?: string; tone?: 'good' | 'bad' | 'epic' | 'info' };
  /** Sonido. */
  sfx: { name: string; volume?: number };
  /** Sacudida de cámara. */
  shake: { power: number };
  /** El jugador subió de nivel. */
  levelUp: { level: number; money: number };
  /** La fábrica subió de nivel (evento cooperativo). */
  factoryLevelUp: { level: number };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

const handlers = new Map<keyof GameEvents, Set<(payload: never) => void>>();

export function on<K extends keyof GameEvents>(event: K, fn: Handler<K>): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(fn as (payload: never) => void);
  return () => set!.delete(fn as (payload: never) => void);
}

export function emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
  const set = handlers.get(event) as Set<Handler<K>> | undefined;
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[bus] handler de "${String(event)}" falló`, e);
    }
  }
}
