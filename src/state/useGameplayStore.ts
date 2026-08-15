import { create } from 'zustand';
import type { ActionOption } from '../game/systems/interaction';
import type { RobotDebug } from '../game/systems/robotBrain';
import type { PetDebug } from '../game/systems/petBrain';

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

  /** Posición del jugador local. La usan los paneles que necesitan validar
   *  dónde estás (vender sólo en el muelle, soltar objetos a tus pies…). */
  x: number;
  y: number;
  /** ¿Estás dentro del muelle de carga? Sólo ahí se puede vender. */
  inSellArea: boolean;

  /** Instantánea para el panel de depuración. Sólo se rellena con DEBUG. */
  debug: {
    robots: RobotDebug[];
    pet: PetDebug | null;
    belts: { id: string; count: number }[];
  };

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
  x: 0,
  y: 0,
  inSellArea: false,
  debug: { robots: [], pet: null, belts: [] },
  publish: (patch) => set(patch),
}));
