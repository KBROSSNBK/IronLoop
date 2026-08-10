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
}

export interface OptionDef {
  id: string;
  name: string;
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
  { id: 'short', name: 'Corto' },
  { id: 'long', name: 'Largo' },
  { id: 'bun', name: 'Moño' },
  { id: 'mohawk', name: 'Cresta' },
  { id: 'bald', name: 'Rapado' },
];

export const HAIR_COLORS: OptionDef[] = [
  { id: '#2b2118', name: 'Negro' },
  { id: '#6b4423', name: 'Castaño' },
  { id: '#c9a227', name: 'Rubio' },
  { id: '#b83227', name: 'Rojo' },
  { id: '#e5e7eb', name: 'Platino' },
  { id: '#22d3ee', name: 'Cian' },
  { id: '#f472b6', name: 'Magenta' },
];

export const OUTFITS: OptionDef[] = [
  { id: 'overall', name: 'Mono de trabajo' },
  { id: 'vest', name: 'Chaleco reflectante' },
  { id: 'jacket', name: 'Chaqueta técnica' },
  { id: 'suit', name: 'Traje de exo' },
];

export const OUTFIT_COLORS: OptionDef[] = [
  { id: '#f59e0b', name: 'Ámbar' },
  { id: '#0ea5e9', name: 'Azul' },
  { id: '#22c55e', name: 'Verde' },
  { id: '#ef4444', name: 'Rojo' },
  { id: '#a855f7', name: 'Violeta' },
  { id: '#e2e8f0', name: 'Blanco' },
  { id: '#334155', name: 'Grafito' },
];

export const ACCENTS: OptionDef[] = [
  { id: '#22d3ee', name: 'Cian' },
  { id: '#fbbf24', name: 'Oro' },
  { id: '#f472b6', name: 'Rosa' },
  { id: '#4ade80', name: 'Lima' },
  { id: '#ffffff', name: 'Blanco' },
];

export const HELMETS: OptionDef[] = [
  { id: 'none', name: 'Ninguno' },
  { id: 'hardhat', name: 'Casco de obra' },
  { id: 'visor', name: 'Visor HUD' },
  { id: 'welder', name: 'Máscara de soldador' },
  { id: 'halo', name: 'Aro holográfico', premium: true },
];

export const SHOES: OptionDef[] = [
  { id: 'boots', name: 'Botas' },
  { id: 'sneakers', name: 'Deportivas' },
  { id: 'servo', name: 'Servo-botas' },
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
];
