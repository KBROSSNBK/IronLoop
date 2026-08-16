/**
 * ITEM REGISTRY — data driven.
 * Añadir un recurso nuevo = añadir una entrada aquí. Nada más.
 */

export type ItemCategory = 'raw' | 'product' | 'consumable' | 'tool' | 'special';

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  /**
   * Versión de un solo glifo del icono, para los sitios donde el ancho manda
   * (bultos en la cinta, mochila de la mascota, chips de receta). Los iconos
   * compuestos —los que se dibujan con varios emoji— necesitan este atajo o
   * se comen el espacio de al lado.
   */
  glyph?: string;
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
    // REGLA DE PRECIOS: un producto vale ~2,5× la suma de lo que consume.
    // Sin esa regla salía más a cuenta vender el mineral en bruto que
    // fabricar, y toda la fábrica sobraba. Ahora cada eslabón multiplica.
    sellPrice: 26,
    contribValue: 18,
    weight: 1,
    color: '#f59e0b',
    desc: 'Acero refinado. Materia prima de la Ensambladora.',
  },
  gear: {
    id: 'gear',
    name: 'Engranaje',
    icon: '⚙️',
    category: 'product',
    sellPrice: 140,
    contribValue: 92,
    weight: 1,
    color: '#a3e635',
    desc: 'Componente mecánico de precisión.',
  },
  circuit: {
    id: 'circuit',
    name: 'Circuito Cuántico',
    icon: '⚡',
    category: 'product',
    sellPrice: 900,
    contribValue: 600,
    weight: 1,
    color: '#c084fc',
    desc: 'Alta tecnología. Requiere el Laboratorio.',
  },
  copper: {
    id: 'copper',
    name: 'Cobre',
    icon: '🟠',
    category: 'raw',
    sellPrice: 9,
    contribValue: 6,
    weight: 1,
    color: '#fb923c',
    desc: 'Conductor blando. Base de aleaciones y de toda la electrónica.',
  },
  titanium: {
    id: 'titanium',
    name: 'Titanio',
    icon: '⬜',
    category: 'raw',
    sellPrice: 42,
    contribValue: 30,
    weight: 1,
    color: '#cbd5e1',
    desc: 'Metal ligero y durísimo. Sólo aparece en la veta profunda.',
  },
  alloy: {
    id: 'alloy',
    name: 'Aleación Reforzada',
    icon: '🧿',
    category: 'product',
    sellPrice: 155,
    contribValue: 100,
    weight: 1,
    color: '#38bdf8',
    desc: 'Acero y cobre fundidos juntos. Estructura de todo lo pesado.',
  },
  battery: {
    id: 'battery',
    name: 'Batería de Alta Carga',
    icon: '🔋',
    category: 'product',
    sellPrice: 2_100,
    contribValue: 1_300,
    weight: 1,
    color: '#a3e635',
    desc: 'Almacena energía suficiente para alimentar un núcleo.',
  },
  core: {
    id: 'core',
    name: 'Núcleo de Energía',
    icon: '💠',
    category: 'special',
    sellPrice: 6_500,
    contribValue: 4_200,
    weight: 1,
    color: '#22d3ee',
    desc: 'Corazón de la Zona Avanzada. Materia prima de la Singularidad.',
  },
  /* ── EXPEDICIÓN: material que sólo existe en el otro planeta ── */
  voidOre: {
    id: 'voidOre',
    name: 'Mineral de Vacío',
    icon: '🌑',
    category: 'raw',
    sellPrice: 70,
    contribValue: 48,
    weight: 1,
    color: '#818cf8',
    desc: 'Roca del planeta exterior. Pesa poco y aguanta muchísimo.',
  },
  stellarGas: {
    id: 'stellarGas',
    name: 'Gas Estelar',
    icon: '💨',
    category: 'raw',
    sellPrice: 110,
    contribValue: 75,
    weight: 1,
    color: '#67e8f9',
    desc: 'Sale a presión de las grietas del planeta. Arde a lo bestia.',
  },
  voidAlloy: {
    id: 'voidAlloy',
    name: 'Aleación de Vacío',
    icon: '🔮',
    category: 'product',
    sellPrice: 700,
    contribValue: 460,
    weight: 1,
    color: '#a78bfa',
    desc: 'Mineral de vacío refinado con gas estelar. Sólo se hace allí.',
  },
  starCell: {
    id: 'starCell',
    name: 'Célula Estelar',
    icon: '⭐',
    category: 'special',
    sellPrice: 4_800,
    contribValue: 3_100,
    weight: 1,
    color: '#fbbf24',
    desc: 'Lo que la expedición manda de vuelta. Se vende para toda la tripulación.',
  },
  singularity: {
    id: 'singularity',
    name: 'Célula de Singularidad',
    // Icono compuesto: marco, detonación y gema. Es la pieza que cierra la
    // fábrica entera, así que se le nota a simple vista.
    icon: '🔳💥🔹',
    glyph: '💥',
    category: 'special',
    sellPrice: 24_000,
    contribValue: 15_000,
    weight: 1,
    color: '#f472b6',
    desc: 'Lo último que sabe fabricar la planta. Nada vale más.',
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

/**
 * Icono de un glifo. En la cinta, en la mochila de la mascota o dentro de un
 * chip de receta no hay sitio para un icono compuesto: ahí se usa este.
 */
export function itemGlyph(id: string): string {
  const def = getItem(id);
  return def.glyph ?? def.icon;
}

/**
 * Efectos de consumibles — data driven para poder añadir más sin tocar lógica.
 * Ahora mismo no hay ninguno: la estamina se recupera sola con el tiempo.
 */
export const CONSUMABLE_EFFECTS: Record<string, { stamina?: number }> = {};
