import { create } from 'zustand';

export type PanelId =
  | 'inventory'
  | 'upgrades'
  | 'missions'
  | 'factory'
  | 'character'
  | 'ranking'
  | 'settings'
  | 'debug'
  | null;

export interface Toast {
  id: number;
  title: string;
  body?: string;
  icon?: string;
  tone: 'good' | 'bad' | 'epic' | 'info';
  at: number;
  /** Veces que se ha repetido el mismo aviso mientras estaba en pantalla. */
  count: number;
}

/** Cuántos avisos caben a la vez antes de tapar el juego. */
const MAX_TOASTS = 3;

/** Los hitos se quedan más rato; el ruido de fondo se va enseguida. */
const TOAST_MS: Record<Toast['tone'], number> = {
  epic: 3600,
  bad: 2600,
  good: 2000,
  info: 1800,
};

interface UiState {
  panel: PanelId;
  toasts: Toast[];
  muted: boolean;
  musicOn: boolean;
  showFps: boolean;
  isTouch: boolean;
  landscapeHint: boolean;
  offlineReportOpen: boolean;
  /** Overlay de celebración de subida de nivel de fábrica. */
  factoryCelebration: number | null;

  setPanel: (p: PanelId) => void;
  togglePanel: (p: Exclude<PanelId, null>) => void;
  pushToast: (t: Omit<Toast, 'id' | 'at' | 'count'>) => void;
  dismissToast: (id: number) => void;
  setMuted: (v: boolean) => void;
  setMusicOn: (v: boolean) => void;
  setTouch: (v: boolean) => void;
  setLandscapeHint: (v: boolean) => void;
  setOfflineReportOpen: (v: boolean) => void;
  celebrateFactory: (level: number | null) => void;
  toggleFps: () => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  panel: null,
  toasts: [],
  muted: localStorage.getItem('ironloop:muted') === 'true',
  musicOn: localStorage.getItem('ironloop:music') !== 'false',
  showFps: false,
  isTouch: false,
  landscapeHint: false,
  offlineReportOpen: false,
  factoryCelebration: null,

  setPanel: (panel) => set({ panel }),
  togglePanel: (p) => set({ panel: get().panel === p ? null : p }),

  /**
   * Apila un aviso, con dos reglas para que no se conviertan en spam:
   *  · Un aviso REPETIDO no crea otra tarjeta: suma en la que ya está y le
   *    renueva el tiempo. Vender diez veces seguidas sale como «×10».
   *  · Nunca hay más de MAX_TOASTS en pantalla; el más viejo se va.
   */
  pushToast: (t) => {
    const now = Date.now();
    const toasts = get().toasts;
    const same = toasts.find((x) => x.title === t.title && x.body === t.body);
    if (same) {
      set({
        toasts: toasts.map((x) =>
          x.id === same.id ? { ...x, count: x.count + 1, at: now } : x,
        ),
      });
      window.setTimeout(() => {
        // Sólo se retira si nadie lo ha renovado mientras tanto.
        const cur = get().toasts.find((x) => x.id === same.id);
        if (cur && cur.at <= now) get().dismissToast(same.id);
      }, TOAST_MS[t.tone]);
      return;
    }

    const toast: Toast = { ...t, id: ++toastId, at: now, count: 1 };
    set({ toasts: [...toasts.slice(-(MAX_TOASTS - 1)), toast] });
    window.setTimeout(() => {
      const cur = get().toasts.find((x) => x.id === toast.id);
      if (cur && cur.at <= now) get().dismissToast(toast.id);
    }, TOAST_MS[t.tone]);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setMuted: (v) => {
    localStorage.setItem('ironloop:muted', String(v));
    set({ muted: v });
  },
  setMusicOn: (v) => {
    localStorage.setItem('ironloop:music', String(v));
    set({ musicOn: v });
  },
  setTouch: (v) => set({ isTouch: v }),
  setLandscapeHint: (v) => set({ landscapeHint: v }),
  setOfflineReportOpen: (v) => set({ offlineReportOpen: v }),
  celebrateFactory: (level) => set({ factoryCelebration: level }),
  toggleFps: () => set({ showFps: !get().showFps }),
}));
