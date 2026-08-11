import { describe, expect, it } from 'vitest';
import {
  EMOTES,
  MAX_EMOTE_MS,
  getEmote,
  isEmoteActive,
} from '../src/config/emotes';

const T0 = 1_700_000_000_000;

describe('catálogo de emotes', () => {
  it('todos tienen id, icono y tecla únicos', () => {
    const ids = EMOTES.map((e) => e.id);
    const keys = EMOTES.map((e) => e.hotkey);
    expect(new Set(ids).size).toBe(EMOTES.length);
    expect(new Set(keys).size).toBe(EMOTES.length);
  });

  it('las teclas rápidas son del 1 al 8, en orden', () => {
    expect(EMOTES.map((e) => e.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('el id cabe en el límite de las reglas de Realtime Database', () => {
    // database.rules.json valida length <= 12
    for (const e of EMOTES) expect(e.id.length).toBeLessThanOrEqual(12);
  });

  it('todas las duraciones son razonables', () => {
    for (const e of EMOTES) {
      expect(e.durationMs).toBeGreaterThan(1000);
      expect(e.durationMs).toBeLessThanOrEqual(MAX_EMOTE_MS);
    }
  });

  it('el baile es el más largo y tiene animación propia', () => {
    const dance = getEmote('dance')!;
    expect(dance.anim).toBe('dance');
    expect(dance.durationMs).toBe(MAX_EMOTE_MS);
  });

  it('devuelve null para ids desconocidos o vacíos', () => {
    expect(getEmote('no_existe')).toBeNull();
    expect(getEmote(null)).toBeNull();
    expect(getEmote(undefined)).toBeNull();
  });
});

describe('vigencia del emote', () => {
  it('está activo justo al lanzarlo', () => {
    expect(isEmoteActive('dance', T0, T0)).toBe(true);
  });

  it('sigue activo antes de que acabe', () => {
    const d = getEmote('dance')!.durationMs;
    expect(isEmoteActive('dance', T0, T0 + d - 100)).toBe(true);
  });

  it('deja de estar activo al cumplirse la duración', () => {
    const d = getEmote('dance')!.durationMs;
    expect(isEmoteActive('dance', T0, T0 + d)).toBe(false);
    expect(isEmoteActive('dance', T0, T0 + d + 5000)).toBe(false);
  });

  it('un emote corto caduca antes que el baile', () => {
    const wave = getEmote('wave')!.durationMs;
    const t = T0 + wave + 10;
    expect(isEmoteActive('wave', T0, t)).toBe(false);
    expect(isEmoteActive('dance', T0, t)).toBe(true);
  });

  it('sin emote o sin timestamp no hay nada activo', () => {
    expect(isEmoteActive(null, T0, T0)).toBe(false);
    expect(isEmoteActive('dance', undefined, T0)).toBe(false);
    expect(isEmoteActive('dance', 0, T0)).toBe(false);
  });
});
