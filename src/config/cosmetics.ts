/**
 * PERSONALIZACIÓN DEL PERSONAJE — sistema modular.
 * El personaje se dibuja por capas procedurales (no requiere sprites),
 * así que añadir una skin es añadir una entrada aquí + un caso en el
 * renderer de personajes. Preparado para cosméticos de pago en el futuro.
 */

export interface Appearance {
  body: string;      // tono de piel
  hair: string;      // estilo
  hairColor: string;
  outfit: string;    // estilo de ropa
  outfitColor: string;
  accent: string;    // color secundario / detalles
  helmet: string;    // casco / accesorio de cabeza
  shoes: string;
  /** Efecto que te envuelve. Es puro lucimiento y se ve desde lejos. */
  aura: string;
}

export interface OptionDef {
  id: string;
  name: string;
  /** Icono para el selector: se reconoce antes de leer el nombre. */
  icon?: string;
  /** Coste en monedas; 0 = gratis desde el inicio. */
  cost?: number;
  premium?: boolean;
}

export const SKIN_TONES: OptionDef[] = [
  { id: '#f3c9a2', name: 'Arena' },
  { id: '#e0a878', name: 'Bronce' },
  { id: '#b57b4e', name: 'Cobre' },
  { id: '#7d4f30', name: 'Caoba' },
  { id: '#4e3423', name: 'Ébano' },
  { id: '#a5d8c6', name: 'Sintético', premium: true },
];

export const HAIR_STYLES: OptionDef[] = [
  { id: 'short', name: 'Corto', icon: '💇' },
  { id: 'long', name: 'Largo', icon: '💁' },
  { id: 'bun', name: 'Moño', icon: '🍡' },
  { id: 'mohawk', name: 'Cresta', icon: '🦅' },
  { id: 'ponytail', name: 'Coleta', icon: '🎀' },
  { id: 'afro', name: 'Afro', icon: '☁️' },
  { id: 'spiky', name: 'Pinchos', icon: '⚡' },
  { id: 'braids', name: 'Trenzas', icon: '🧶' },
  { id: 'bald', name: 'Rapado', icon: '🥚' },
];

export const HAIR_COLORS: OptionDef[] = [
  { id: '#2b2118', name: 'Negro' },
  { id: '#6b4423', name: 'Castaño' },
  { id: '#c9a227', name: 'Rubio' },
  { id: '#b83227', name: 'Rojo' },
  { id: '#e5e7eb', name: 'Platino' },
  { id: '#22d3ee', name: 'Cian' },
  { id: '#f472b6', name: 'Magenta' },
  { id: '#4ade80', name: 'Lima' },
  { id: '#a855f7', name: 'Violeta' },
  { id: '#fb923c', name: 'Naranja' },
];

export const OUTFITS: OptionDef[] = [
  { id: 'overall', name: 'Mono de trabajo', icon: '🧑‍🏭' },
  { id: 'vest', name: 'Chaleco reflectante', icon: '🦺' },
  { id: 'jacket', name: 'Chaqueta técnica', icon: '🧥' },
  { id: 'suit', name: 'Traje de exo', icon: '🤖' },
  { id: 'hazmat', name: 'Traje NBQ', icon: '☣️' },
  { id: 'armor', name: 'Placas de aleación', icon: '🛡️' },
  { id: 'hoodie', name: 'Sudadera', icon: '👕' },
];

export const OUTFIT_COLORS: OptionDef[] = [
  { id: '#f59e0b', name: 'Ámbar' },
  { id: '#0ea5e9', name: 'Azul' },
  { id: '#22c55e', name: 'Verde' },
  { id: '#ef4444', name: 'Rojo' },
  { id: '#a855f7', name: 'Violeta' },
  { id: '#e2e8f0', name: 'Blanco' },
  { id: '#334155', name: 'Grafito' },
  { id: '#14b8a6', name: 'Turquesa' },
  { id: '#f472b6', name: 'Rosa' },
  { id: '#facc15', name: 'Amarillo' },
  { id: '#7c3aed', name: 'Índigo' },
  { id: '#0f172a', name: 'Negro' },
];

export const ACCENTS: OptionDef[] = [
  { id: '#22d3ee', name: 'Cian' },
  { id: '#fbbf24', name: 'Oro' },
  { id: '#f472b6', name: 'Rosa' },
  { id: '#4ade80', name: 'Lima' },
  { id: '#ffffff', name: 'Blanco' },
  { id: '#f87171', name: 'Rojo' },
  { id: '#a78bfa', name: 'Violeta' },
  { id: '#fb923c', name: 'Naranja' },
];

export const HELMETS: OptionDef[] = [
  { id: 'none', name: 'Ninguno', icon: '🚫' },
  { id: 'hardhat', name: 'Casco de obra', icon: '⛑️' },
  { id: 'visor', name: 'Visor HUD', icon: '🕶️' },
  { id: 'welder', name: 'Máscara de soldador', icon: '🥽' },
  { id: 'cap', name: 'Gorra', icon: '🧢' },
  { id: 'headset', name: 'Auriculares', icon: '🎧' },
  { id: 'crown', name: 'Corona', icon: '👑' },
  { id: 'halo', name: 'Aro holográfico', icon: '💫', premium: true },
];

export const SHOES: OptionDef[] = [
  { id: 'boots', name: 'Botas', icon: '🥾' },
  { id: 'sneakers', name: 'Deportivas', icon: '👟' },
  { id: 'servo', name: 'Servo-botas', icon: '🦿' },
  { id: 'heavy', name: 'Botas de carga', icon: '🧱' },
  { id: 'rocket', name: 'Propulsores', icon: '🚀' },
];

/**
 * AURAS — el efecto que te envuelve.
 *
 * Es lo único puramente decorativo del juego, y a propósito: en una fábrica
 * donde todos vais de mono de trabajo, es lo que hace que se distinga de lejos
 * quién es quién. No da ninguna ventaja.
 */
export const AURAS: OptionDef[] = [
  { id: 'none', name: 'Ninguna', icon: '🚫' },
  { id: 'sparks', name: 'Chispas', icon: '✨' },
  { id: 'embers', name: 'Brasas', icon: '🔥' },
  { id: 'ring', name: 'Anillo de energía', icon: '⭕' },
  { id: 'orbit', name: 'Satélites', icon: '🛰️' },
  { id: 'glitch', name: 'Interferencia', icon: '📺' },
  { id: 'ash', name: 'Ceniza', icon: '🌫️' },
  { id: 'shadow', name: 'Sombra viva', icon: '🌑' },
];

export const DEFAULT_APPEARANCE: Appearance = {
  body: '#e0a878',
  hair: 'short',
  hairColor: '#2b2118',
  outfit: 'overall',
  outfitColor: '#f59e0b',
  accent: '#22d3ee',
  helmet: 'hardhat',
  shoes: 'boots',
  aura: 'none',
};

const pick = <T,>(arr: T[], rand: () => number) => arr[Math.floor(rand() * arr.length)];

export function randomAppearance(rand: () => number = Math.random): Appearance {
  return {
    body: pick(SKIN_TONES.filter((o) => !o.premium), rand).id,
    hair: pick(HAIR_STYLES, rand).id,
    hairColor: pick(HAIR_COLORS, rand).id,
    outfit: pick(OUTFITS, rand).id,
    outfitColor: pick(OUTFIT_COLORS, rand).id,
    accent: pick(ACCENTS, rand).id,
    helmet: pick(HELMETS.filter((o) => !o.premium), rand).id,
    shoes: pick(SHOES, rand).id,
    aura: pick(AURAS, rand).id,
  };
}

export const APPEARANCE_SLOTS = [
  { key: 'body' as const, label: 'Piel', options: SKIN_TONES, kind: 'color' as const },
  { key: 'hair' as const, label: 'Pelo', options: HAIR_STYLES, kind: 'style' as const },
  { key: 'hairColor' as const, label: 'Color de pelo', options: HAIR_COLORS, kind: 'color' as const },
  { key: 'outfit' as const, label: 'Ropa', options: OUTFITS, kind: 'style' as const },
  { key: 'outfitColor' as const, label: 'Color de ropa', options: OUTFIT_COLORS, kind: 'color' as const },
  { key: 'accent' as const, label: 'Detalles', options: ACCENTS, kind: 'color' as const },
  { key: 'helmet' as const, label: 'Cabeza', options: HELMETS, kind: 'style' as const },
  { key: 'shoes' as const, label: 'Calzado', options: SHOES, kind: 'style' as const },
  { key: 'aura' as const, label: 'Efecto', options: AURAS, kind: 'style' as const },
];
