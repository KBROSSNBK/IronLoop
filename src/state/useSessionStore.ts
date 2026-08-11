import { create } from 'zustand';
import { getBackend } from '../services/backend';
import type { Backend, Unsub } from '../services/backend/types';
import type { OpName, OpEvent, OpOutcome } from '../services/backend/ops';
import { emit } from '../services/bus';
import { getItem } from '../config/items';
import { getMissionDef } from '../config/missions';
import { BALANCE } from '../config/balance';
import { BACKEND_KIND, DEBUG_ENABLED } from '../config/env';
import type {
  AuthUser,
  FactoryMember,
  FactoryState,
  OfflineReport,
  PlayerState,
  PresenceState,
} from '../types';
import { useUiStore } from './useUiStore';

export type Phase = 'boot' | 'signedOut' | 'loading' | 'ready' | 'error';

interface SessionState {
  phase: Phase;
  error: string | null;
  backendKind: typeof BACKEND_KIND;
  backendLabel: string;

  user: AuthUser | null;
  player: PlayerState | null;
  factory: FactoryState | null;
  members: FactoryMember[];
  presence: PresenceState[];
  offlineReport: OfflineReport | null;
  busy: boolean;

  boot: () => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInGuest: (nickname?: string) => Promise<void>;
  signOut: () => Promise<void>;
  suggestName: () => string;
  op: (op: OpName, args?: Record<string, unknown>) => Promise<OpOutcome>;
  publishPresence: (state: PresenceState) => void;
  dismissOfflineReport: () => void;
}

let backend: Backend | null = null;
let booted = false;
const subs: Unsub[] = [];
let lastPresenceWrite = 0;
let tickTimer: number | null = null;
let sessionSeconds = 0;

function cleanup() {
  while (subs.length) subs.pop()?.();
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** Traduce los eventos de una operación en feedback visual/sonoro. */
function dispatchOpEvents(events: OpEvent[]) {
  const ui = useUiStore.getState();
  for (const ev of events) {
    switch (ev.kind) {
      case 'money':
        if (!ev.amount) break;
        emit('float', {
          text: `${ev.amount > 0 ? '+' : '−'}$${Math.abs(ev.amount).toLocaleString('es')}`,
          kind: ev.amount > 0 ? 'money' : 'bad',
        });
        emit('sfx', { name: ev.amount > 0 ? 'coin' : 'spend' });
        break;
      case 'xp':
        if (!ev.amount) break;
        emit('float', { text: `+${Math.round(ev.amount)} XP`, kind: 'xp' });
        break;
      case 'item': {
        if (!ev.item || !ev.amount) break;
        const def = getItem(ev.item);
        emit('float', {
          text: `${ev.amount > 0 ? '+' : ''}${ev.amount} ${def.icon}`,
          kind: 'item',
          color: def.color,
        });
        if (ev.amount > 0) emit('sfx', { name: 'pickup' });
        break;
      }
      case 'levelUp':
        emit('levelUp', { level: ev.level ?? 1, money: ev.amount ?? 0 });
        emit('sfx', { name: 'levelup' });
        emit('shake', { power: 6 });
        ui.pushToast({
          title: `¡NIVEL ${ev.level}!`,
          body: `Recompensa: $${(ev.amount ?? 0).toLocaleString('es')}`,
          icon: '⭐',
          tone: 'epic',
        });
        break;
      case 'factoryLevelUp':
        emit('factoryLevelUp', { level: ev.level ?? 1 });
        emit('sfx', { name: 'factory' });
        emit('shake', { power: 12 });
        useUiStore.getState().celebrateFactory(ev.level ?? 1);
        ui.pushToast({
          title: `¡FÁBRICA NIVEL ${ev.level}!`,
          body: 'Toda la nave se ha actualizado.',
          icon: '🏭',
          tone: 'epic',
        });
        break;
      case 'missionComplete': {
        const def = ev.text ? getMissionDef(ev.text) : undefined;
        emit('sfx', { name: 'mission' });
        ui.pushToast({
          title: '¡MISIÓN COMPLETADA!',
          body: def?.title ?? 'Recoge tu recompensa',
          icon: '✅',
          tone: 'good',
        });
        break;
      }
      case 'contribution':
        if (!ev.amount || ev.amount < 1) break;
        emit('float', {
          text: `+${Math.round(ev.amount).toLocaleString('es')} 🏭`,
          kind: 'item',
          color: '#22d3ee',
        });
        break;
      case 'info':
        if (ev.text) ui.pushToast({ title: ev.text, icon: '⚡', tone: 'good' });
        break;
      case 'error':
        if (ev.text) {
          ui.pushToast({ title: ev.text, icon: '⛔', tone: 'bad' });
          emit('sfx', { name: 'error' });
        }
        break;
    }
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  phase: 'boot',
  error: null,
  backendKind: BACKEND_KIND,
  backendLabel: BACKEND_KIND === 'firebase' ? 'Firebase' : 'Modo local',

  user: null,
  player: null,
  factory: null,
  members: [],
  presence: [],
  offlineReport: null,
  busy: false,

  async boot() {
    // React StrictMode ejecuta los efectos dos veces en desarrollo: sin este
    // guard se registrarían dos listeners de auth y dos temporizadores de tick.
    if (booted) return;
    booted = true;
    try {
      backend = await getBackend();
      set({ backendLabel: backend.label });
      backend.onAuthChanged(async (user) => {
        cleanup();
        if (!user) {
          set({ phase: 'signedOut', user: null, player: null, factory: null, members: [], presence: [] });
          return;
        }
        set({ phase: 'loading', user, error: null });
        try {
          await enterGame(backend!, user, set, get);
        } catch (e) {
          console.error(e);
          set({ phase: 'error', error: e instanceof Error ? e.message : 'Error al entrar' });
        }
      });
    } catch (e) {
      set({ phase: 'error', error: e instanceof Error ? e.message : 'No se pudo iniciar' });
    }
  },

  async signInGoogle() {
    set({ error: null });
    try {
      await (await getBackend()).signInWithGoogle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error de autenticación';
      set({ error: msg });
      useUiStore.getState().pushToast({ title: msg, icon: '⛔', tone: 'bad' });
    }
  },

  async signInGuest(nickname) {
    set({ error: null });
    try {
      await (await getBackend()).signInAsGuest(nickname);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Error de autenticación' });
    }
  },

  async signOut() {
    const { player } = get();
    if (backend && player?.factoryId) {
      await backend.leaveFactory(player.factoryId, player.uid).catch(() => {});
    }
    cleanup();
    await (await getBackend()).signOut();
  },

  suggestName() {
    const b = backend as unknown as { suggestName?: () => string } | null;
    return b?.suggestName?.() ?? 'Operario';
  },

  async op(op, args = {}) {
    const { player, factory } = get();
    if (!backend || !player || !factory) {
      return { ok: false, reason: 'Sesión no lista', events: [] };
    }
    set({ busy: true });
    try {
      const out = await backend.runOp(player.uid, factory.id, op, {
        ...args,
        now: Date.now(),
      });
      // Actualización optimista inmediata: el listener confirmará después.
      if (out.ok) {
        if (out.player) set({ player: out.player });
        if (out.factory) set({ factory: out.factory });
      }
      dispatchOpEvents(out.events ?? []);
      if (!out.ok && out.reason && !(out.events ?? []).some((e) => e.kind === 'error')) {
        useUiStore.getState().pushToast({ title: out.reason, icon: '⛔', tone: 'bad' });
      }
      return out;
    } finally {
      set({ busy: false });
    }
  },

  publishPresence(state) {
    const { factory } = get();
    if (!backend || !factory) return;
    const now = Date.now();
    if (now - lastPresenceWrite < BALANCE.net.positionThrottleMs) return;
    lastPresenceWrite = now;
    backend.publishPresence(factory.id, state);
  },

  dismissOfflineReport() {
    set({ offlineReport: null });
    useUiStore.getState().setOfflineReportOpen(false);
  },
}));

/* ─────────────────── Arranque de partida ─────────────────── */

async function enterGame(
  b: Backend,
  user: AuthUser,
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
) {
  const player = await b.loadPlayer(user);
  set({ player });

  const factoryId = await b.joinFactory(player);
  set({ player: { ...player, factoryId } });

  subs.push(
    b.watchPlayer(user.uid, (p) => set({ player: p })),
    b.watchFactory(factoryId, (f) => {
      const prev = get().factory;
      set({ factory: f });
      if (prev && f.level > prev.level) {
        useUiStore.getState().celebrateFactory(f.level);
        emit('factoryLevelUp', { level: f.level });
      }
      void maybeApplyFactoryReset(b, get, set);
    }),
    b.watchMembers(factoryId, (m) => set({ members: m })),
    b.watchPresence(factoryId, user.uid, (list) => set({ presence: list })),
  );

  // Espera al primer snapshot de fábrica antes de declarar la sesión lista.
  await waitFor(() => get().factory !== null, 6000);

  // Si un administrador reinició la fábrica mientras no estabas, tu progreso
  // se pone a cero aquí, antes de mostrar nada.
  await maybeApplyFactoryReset(b, get, set);

  set({ phase: 'ready' });

  // Producción offline acumulada.
  const res = await b.runOp(user.uid, factoryId, 'claimOffline', { now: Date.now() });
  if (res.ok && res.data) {
    set({ offlineReport: res.data as OfflineReport });
    useUiStore.getState().setOfflineReportOpen(true);
  }
  if (res.ok && res.player) set({ player: res.player });

  // Latido de sesión: 1 escritura/minuto (tiempo jugado + misiones de tipo playtime).
  sessionSeconds = 0;
  tickTimer = window.setInterval(() => {
    sessionSeconds += 60;
    const st = get();
    if (!st.player || !st.factory) return;
    b.runOp(st.player.uid, st.factory.id, 'tick', {
      seconds: 60,
      stamina: staminaOverride(),
      now: Date.now(),
    })
      .then((out) => {
        if (out.ok && out.player) set({ player: out.player });
        dispatchOpEvents(out.events ?? []);
      })
      .catch(() => {});
  }, 60000);

  // Libera la presencia al cerrar la pestaña.
  const bye = () => {
    b.clearPresence(factoryId, user.uid);
  };
  window.addEventListener('pagehide', bye);
  window.addEventListener('beforeunload', bye);
  subs.push(() => {
    window.removeEventListener('pagehide', bye);
    window.removeEventListener('beforeunload', bye);
  });
}

/**
 * Aplica el reinicio de fábrica al progreso propio si aún no se ha aplicado.
 * Idempotente: la operación fija `resetAckAt`, así que sólo corre una vez.
 */
let applyingReset = false;
async function maybeApplyFactoryReset(
  b: Backend,
  get: () => SessionState,
  set: (partial: Partial<SessionState>) => void,
): Promise<void> {
  if (applyingReset) return;
  const { player, factory } = get();
  if (!player || !factory) return;
  if ((factory.resetAt ?? 0) <= (player.resetAckAt ?? 0)) return;

  applyingReset = true;
  try {
    const out = await b.runOp(player.uid, factory.id, 'applyFactoryReset', {
      now: Date.now(),
    });
    if (out.ok && out.player) set({ player: out.player, offlineReport: null });
    if (out.ok && (out.data as { applied?: boolean } | undefined)?.applied) {
      useUiStore.getState().pushToast({
        title: 'FÁBRICA REINICIADA',
        body: 'Todos los operarios empezáis de cero.',
        icon: '♻️',
        tone: 'epic',
      });
    }
  } catch (e) {
    console.error('[reset] no se pudo aplicar', e);
  } finally {
    applyingReset = false;
  }
}

/** El bucle de juego registra aquí la estamina gastada por sprint. */
let staminaClaim: number | undefined;
export function reportSprintStamina(value: number) {
  staminaClaim = value;
}
function staminaOverride(): number | undefined {
  const v = staminaClaim;
  staminaClaim = undefined;
  return v;
}

/**
 * Espera activa con temporizador, NO con requestAnimationFrame: en una pestaña
 * en segundo plano el navegador congela los frames y la carga se quedaría
 * colgada para siempre en la pantalla de "Sincronizando maquinaria".
 */
function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pred()) return resolve();
    const start = Date.now();
    const id = window.setInterval(() => {
      if (pred() || Date.now() - start > timeoutMs) {
        window.clearInterval(id);
        resolve();
      }
    }, 50);
  });
}

export function getSessionSeconds(): number {
  return sessionSeconds;
}

// Handle de depuración: permite inspeccionar y manipular la sesión desde la
// consola del navegador. Sólo con DEBUG_ENABLED.
if (DEBUG_ENABLED) {
  (window as unknown as { __ironloopSession?: unknown }).__ironloopSession =
    useSessionStore;
}
