import { create } from 'zustand';
import type { ActionOption } from '../game/systems/interaction';

/**
 * Estado ligero que el bucle de juego publica hacia la UI (~8 veces/segundo).
 * Se mantiene aparte de la sesión para que un cambio de estamina no re-renderice
 * paneles pesados.
 */
interface GameplayState {
  actions: ActionOption[];
  targetLabel: string | null;
  hint: string;
  stamina: number;
  staminaMax: number;
  fps: number;
  onlineCount: number;
  /** Progreso 0..1 de la acción sostenida en curso. */
  actionProgress: number;
  /** Progreso 0..1 de la pulsación mantenida hacia el modo automático. */
  holdProgress: number;
  /** Etiqueta de la acción en modo automático, o null. */
  autoAction: string | null;

  publish: (patch: Partial<GameplayState>) => void;
}

export const useGameplayStore = create<GameplayState>((set) => ({
  actions: [],
  targetLabel: null,
  hint: '',
  stamina: 100,
  staminaMax: 100,
  fps: 0,
  onlineCount: 1,
  actionProgress: 0,
  holdProgress: 0,
  autoAction: null,
  publish: (patch) => set(patch),
}));
