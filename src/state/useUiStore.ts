import { create } from 'zustand';
import { BALANCE } from '../config/balance';

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
}

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
  pushToast: (t: Omit<Toast, 'id' | 'at'>) => void;
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

  pushToast: (t) => {
    const toast: Toast = { ...t, id: ++toastId, at: Date.now() };
    set({ toasts: [...get().toasts.slice(-4), toast] });
    window.setTimeout(() => get().dismissToast(toast.id), BALANCE.ui.toastMs);
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
