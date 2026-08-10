/**
 * ITEM REGISTRY — data driven.
 * Añadir un recurso nuevo = añadir una entrada aquí. Nada más.
 */

export type ItemCategory = 'raw' | 'product' | 'consumable' | 'tool' | 'special';

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  category: ItemCategory;
  /** Precio base de venta en el muelle de carga. 0 = no vendible. */
  sellPrice: number;
  /** Valor en puntos de contribución al núcleo de la fábrica. */
  contribValue: number;
  /** Tamaño en huecos de inventario por unidad (siempre 1 en el MVP). */
  weight: number;
  color: string;
  desc: string;
}

export const ITEMS = {
  ore: {
    id: 'ore',
    name: 'Mineral de Hierro',
    // Nota: los iconos se limitan a emoji Unicode ≤ 11.0 para que se vean
    // igual en Windows 10, Android e iOS antiguos (🪨 y 🫁 no existen ahí).
    icon: '⛰️',
    category: 'raw',
    sellPrice: 4,
    contribValue: 3,
    weight: 1,
    color: '#8b7d6b',
    desc: 'Roca cruda extraída de la veta. Se funde en la Fundidora.',
  },
  scrap: {
    id: 'scrap',
    name: 'Chatarra',
    icon: '♻️',
    category: 'raw',
    sellPrice: 2,
    contribValue: 2,
    weight: 1,
    color: '#6b7280',
    desc: 'Restos metálicos. Poco valor, pero todo suma.',
  },
  crystal: {
    id: 'crystal',
    name: 'Cristal Resonante',
    icon: '💎',
    category: 'raw',
    sellPrice: 95,
    contribValue: 70,
    weight: 1,
    color: '#67e8f9',
    desc: 'Hallazgo raro. La suerte decide si aparece.',
  },
  ingot: {
    id: 'ingot',
    name: 'Lingote de Acero',
    icon: '🧱',
    category: 'product',
    sellPrice: 18,
    contribValue: 12,
    weight: 1,
    color: '#f59e0b',
    desc: 'Acero refinado. Materia prima de la Ensambladora.',
  },
  gear: {
    id: 'gear',
    name: 'Engranaje',
    icon: '⚙️',
    category: 'product',
    sellPrice: 58,
    contribValue: 40,
    weight: 1,
    color: '#a3e635',
    desc: 'Componente mecánico de precisión.',
  },
  circuit: {
    id: 'circuit',
    name: 'Circuito Cuántico',
    icon: '🔌',
    category: 'product',
    sellPrice: 190,
    contribValue: 130,
    weight: 1,
    color: '#c084fc',
    desc: 'Alta tecnología. Requiere el Laboratorio.',
  },
  energyDrink: {
    id: 'energyDrink',
    name: 'Bebida Energética',
    icon: '🥤',
    category: 'consumable',
    sellPrice: 0,
    contribValue: 0,
    weight: 1,
    color: '#22d3ee',
    desc: 'Restaura 60 de estamina al instante.',
  },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export const ITEM_LIST = Object.values(ITEMS) as ItemDef[];

export function getItem(id: string): ItemDef {
  const item = (ITEMS as Record<string, ItemDef>)[id];
  if (!item) throw new Error(`Item desconocido: ${id}`);
  return item;
}

export function isItemId(id: string): id is ItemId {
  return id in ITEMS;
}

/** Efectos de consumibles — data driven para poder añadir más sin tocar lógica. */
export const CONSUMABLE_EFFECTS: Record<string, { stamina?: number }> = {
  energyDrink: { stamina: 60 },
};
