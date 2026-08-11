/**
 * EMOTES — data driven.
 * Añadir uno nuevo = añadir una entrada aquí. Si `anim` es 'none' basta con
 * el bocadillo; los demás valores los interpreta el renderer del personaje.
 */

export type EmoteAnim = 'none' | 'dance' | 'wave' | 'jump' | 'shake';

export interface EmoteDef {
  id: string;
  name: string;
  icon: string;
  /** Duración total en ms. */
  durationMs: number;
  anim: EmoteAnim;
  /** Color de las partículas que acompañan al emote (si las tiene). */
  particle?: string;
  /** Tecla numérica de acceso rápido en escritorio. */
  hotkey: string;
}

export const EMOTES: EmoteDef[] = [
  { id: 'dance', name: 'Baile', icon: '🕺', durationMs: 6000, anim: 'dance', particle: '#f472b6', hotkey: '1' },
  { id: 'cheer', name: '¡Bien!', icon: '🎉', durationMs: 2600, anim: 'jump', particle: '#fbbf24', hotkey: '2' },
  { id: 'wave', name: 'Saludo', icon: '👋', durationMs: 2600, anim: 'wave', hotkey: '3' },
  { id: 'laugh', name: 'Risa', icon: '😂', durationMs: 2600, anim: 'shake', hotkey: '4' },
  { id: 'love', name: 'Corazón', icon: '❤️', durationMs: 2600, anim: 'none', particle: '#fb7185', hotkey: '5' },
  { id: 'think', name: 'Pensando', icon: '🤔', durationMs: 2600, anim: 'none', hotkey: '6' },
  { id: 'angry', name: 'Enfado', icon: '😡', durationMs: 2600, anim: 'shake', hotkey: '7' },
  { id: 'gg', name: 'Buen trabajo', icon: '👍', durationMs: 2600, anim: 'none', hotkey: '8' },
];

export const EMOTE_MAP: Record<string, EmoteDef> = Object.fromEntries(
  EMOTES.map((e) => [e.id, e]),
);

export function getEmote(id: string | null | undefined): EmoteDef | null {
  if (!id) return null;
  return EMOTE_MAP[id] ?? null;
}

/** Duración máxima: sirve de tope al validar la presencia. */
export const MAX_EMOTE_MS = Math.max(...EMOTES.map((e) => e.durationMs));

/** ¿Sigue vigente el emote publicado por un jugador? */
export function isEmoteActive(
  emote: string | null | undefined,
  emoteAt: number | undefined,
  now: number,
): boolean {
  const def = getEmote(emote);
  if (!def || !emoteAt) return false;
  return now - emoteAt < def.durationMs;
}
