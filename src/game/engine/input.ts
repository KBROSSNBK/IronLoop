/**
 * ENTRADA UNIFICADA — teclado + joystick virtual + botones táctiles.
 * El bucle de juego lee siempre el mismo objeto, no le importa el dispositivo.
 */

import { EMOTES } from '../../config/emotes';

export type ActionSlot = 'primary' | 'secondary';

interface InputState {
  /** Vector de movimiento normalizado (-1..1). */
  x: number;
  y: number;
  sprint: boolean;
  /** Acciones encoladas desde el último frame (edge-triggered). */
  queue: ActionSlot[];
  /** Se mantiene pulsado el botón principal (para acciones sostenidas). */
  primaryHeld: boolean;
  source: 'keyboard' | 'touch';
}

const keys = new Set<string>();
let joyX = 0;
let joyY = 0;
let touchPrimary = false;

export const input: InputState = {
  x: 0,
  y: 0,
  sprint: false,
  queue: [],
  primaryHeld: false,
  source: 'keyboard',
};

const MOVE_KEYS: Record<string, [number, number]> = {
  keyw: [0, -1],
  arrowup: [0, -1],
  keys: [0, 1],
  arrowdown: [0, 1],
  keya: [-1, 0],
  arrowleft: [-1, 0],
  keyd: [1, 0],
  arrowright: [1, 0],
};

/** Teclas que abren paneles: se publican para que la UI reaccione. */
export type PanelHotkey = 'inventory' | 'upgrades' | 'missions' | 'factory' | 'character' | 'ranking';
const panelListeners = new Set<(p: PanelHotkey) => void>();
export function onPanelHotkey(fn: (p: PanelHotkey) => void): () => void {
  panelListeners.add(fn);
  return () => panelListeners.delete(fn);
}

/* ── Emotes ── */

let pendingEmote: string | null = null;

/** Lanza un emote (desde la rueda táctil o desde una tecla). */
export function triggerEmote(id: string): void {
  pendingEmote = id;
}

/** El bucle de juego lo consume una vez por frame. */
export function consumeEmote(): string | null {
  const e = pendingEmote;
  pendingEmote = null;
  return e;
}

const PANEL_KEYS: Record<string, PanelHotkey> = {
  keyi: 'inventory',
  keyu: 'upgrades',
  keym: 'missions',
  keyf: 'factory',
  keyc: 'character',
  keyr: 'ranking',
};

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  const code = e.code.toLowerCase();
  if (MOVE_KEYS[code]) {
    keys.add(code);
    input.source = 'keyboard';
    e.preventDefault();
  }
  if (code === 'shiftleft' || code === 'shiftright') keys.add('sprint');
  if (code === 'keye' || code === 'space') {
    if (!keys.has('primary')) input.queue.push('primary');
    keys.add('primary');
    e.preventDefault();
  }
  if (code === 'keyq') {
    if (!keys.has('secondary')) input.queue.push('secondary');
    keys.add('secondary');
  }
  const panel = PANEL_KEYS[code];
  if (panel) panelListeners.forEach((fn) => fn(panel));

  // Teclas 1–8: emotes rápidos.
  const digit = /^digit([1-8])$/.exec(code);
  if (digit) {
    const def = EMOTES[Number(digit[1]) - 1];
    if (def) triggerEmote(def.id);
  }
}

function onKeyUp(e: KeyboardEvent) {
  const code = e.code.toLowerCase();
  keys.delete(code);
  if (code === 'shiftleft' || code === 'shiftright') keys.delete('sprint');
  if (code === 'keye' || code === 'space') keys.delete('primary');
  if (code === 'keyq') keys.delete('secondary');
}

function clearAll() {
  keys.clear();
  joyX = 0;
  joyY = 0;
  touchPrimary = false;
}

export function attachInput(): () => void {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearAll);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clearAll);
    clearAll();
  };
}

/** Llamado por el joystick virtual (valores -1..1). */
export function setJoystick(x: number, y: number): void {
  joyX = x;
  joyY = y;
  if (x !== 0 || y !== 0) input.source = 'touch';
}

/** Llamado por los botones táctiles. */
export function pressAction(slot: ActionSlot): void {
  input.queue.push(slot);
  input.source = 'touch';
  if (slot === 'primary') touchPrimary = true;
}

export function releaseAction(slot: ActionSlot): void {
  if (slot === 'primary') touchPrimary = false;
}

export function setTouchSprint(v: boolean): void {
  if (v) keys.add('sprint');
  else keys.delete('sprint');
}

/** Recalcula el estado agregado. Se llama una vez por frame. */
export function pollInput(): void {
  let x = 0;
  let y = 0;
  for (const code of keys) {
    const v = MOVE_KEYS[code];
    if (v) {
      x += v[0];
      y += v[1];
    }
  }
  if (joyX !== 0 || joyY !== 0) {
    x = joyX;
    y = joyY;
  }
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  input.x = x;
  input.y = y;
  input.sprint = keys.has('sprint');
  input.primaryHeld = keys.has('primary') || touchPrimary;
}

/** Vacía la cola de acciones y la devuelve. */
export function consumeActions(): ActionSlot[] {
  if (input.queue.length === 0) return [];
  const out = [...input.queue];
  input.queue.length = 0;
  return out;
}
