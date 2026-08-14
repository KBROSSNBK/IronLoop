/**
 * LAYOUT DE LA FÁBRICA — data driven.
 * Todo el mapa (zonas, estaciones, muros, decoración) se describe aquí.
 * Añadir una zona nueva = añadir una entrada. El renderer y la colisión
 * derivan de estos datos.
 */

export const TILE = 40;
export const WORLD_COLS = 36;
export const WORLD_ROWS = 26;
export const WORLD_W = WORLD_COLS * TILE;
export const WORLD_H = WORLD_ROWS * TILE;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FloorStyle = 'concrete' | 'grate' | 'hazard' | 'tech' | 'dirt';

export interface ZoneDef {
  id: string;
  label: string;
  icon: string;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  floor: FloorStyle;
  accent: string;
  /** Nivel de fábrica en el que la zona se "despierta" visualmente. */
  liveAtLevel?: number;
}

export const ZONES: ZoneDef[] = [
  { id: 'entrance', label: 'ENTRADA', icon: '🚪', tx: 15, ty: 1, tw: 6, th: 3, floor: 'hazard', accent: '#38bdf8' },
  { id: 'resources', label: 'YACIMIENTO', icon: '⛏️', tx: 2, ty: 4, tw: 9, th: 7, floor: 'dirt', accent: '#a78bfa' },
  { id: 'smelting', label: 'FUNDICIÓN', icon: '🔥', tx: 23, ty: 4, tw: 10, th: 7, floor: 'grate', accent: '#ff8a3d' },
  { id: 'core', label: 'NÚCLEO DE FÁBRICA', icon: '🏭', tx: 14, ty: 9, tw: 8, th: 7, floor: 'tech', accent: '#22d3ee' },
  { id: 'assembly', label: 'ENSAMBLAJE', icon: '🤖', tx: 23, ty: 14, tw: 10, th: 6, floor: 'grate', accent: '#8ef04a', liveAtLevel: 3 },
  { id: 'labzone', label: 'INVESTIGACIÓN', icon: '🔬', tx: 6, ty: 14, tw: 10, th: 7, floor: 'tech', accent: '#c084fc', liveAtLevel: 6 },
  { id: 'dock', label: 'MUELLE DE CARGA', icon: '🚚', tx: 16, ty: 20, tw: 8, th: 5, floor: 'hazard', accent: '#fbbf24' },
  { id: 'workshop', label: 'TALLER', icon: '🛠️', tx: 2, ty: 21, tw: 7, th: 4, floor: 'concrete', accent: '#f472b6' },
  { id: 'salvage', label: 'RECOLECCIÓN', icon: '♻️', tx: 23, ty: 20, tw: 12, th: 5, floor: 'dirt', accent: '#34d399' },
];

export type StationType = 'oreVein' | 'sell' | 'core' | 'shop' | 'salvage';

export interface StationDef {
  id: string;
  type: StationType;
  label: string;
  icon: string;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  accent: string;
  /** Si es un yacimiento: qué produce. */
  yields?: { item: string; amount: number }[];
  desc: string;
}

export const STATIONS: StationDef[] = [
  {
    id: 'vein_a',
    type: 'oreVein',
    label: 'VETA DE HIERRO',
    icon: '⛏️',
    tx: 3,
    ty: 5,
    tw: 3,
    th: 2,
    accent: '#a78bfa',
    yields: [{ item: 'ore', amount: 1 }],
    desc: 'Extrae Mineral de Hierro. Consume estamina.',
  },
  {
    id: 'vein_b',
    type: 'oreVein',
    label: 'VETA DE HIERRO',
    icon: '⛏️',
    tx: 7,
    ty: 8,
    tw: 3,
    th: 2,
    accent: '#a78bfa',
    yields: [{ item: 'ore', amount: 1 }],
    desc: 'Extrae Mineral de Hierro. Consume estamina.',
  },
  {
    id: 'dock_sell',
    type: 'sell',
    label: 'MUELLE DE VENTA',
    icon: '🚚',
    tx: 17,
    ty: 21,
    tw: 6,
    th: 3,
    accent: '#fbbf24',
    desc: 'Vende productos terminados. Dinero + XP.',
  },
  {
    id: 'factory_core',
    type: 'core',
    label: 'NÚCLEO',
    icon: '🏭',
    tx: 16,
    ty: 11,
    tw: 4,
    th: 3,
    accent: '#22d3ee',
    desc: 'Contribuye materiales o dinero para subir el nivel de la fábrica.',
  },
  {
    id: 'workbench',
    type: 'shop',
    label: 'TERMINAL DE MEJORAS',
    icon: '🛠️',
    tx: 3,
    ty: 22,
    tw: 4,
    th: 2,
    accent: '#f472b6',
    desc: 'Compra mejoras personales con tu dinero.',
  },
  {
    id: 'salvage_a',
    type: 'salvage',
    label: 'MONTÓN DE CHATARRA',
    icon: '♻️',
    tx: 32,
    ty: 21,
    tw: 2,
    th: 2,
    accent: '#34d399',
    yields: [{ item: 'scrap', amount: 2 }],
    desc: 'Rebusca chatarra. Aliméntala a la Recicladora y se vuelve acero.',
  },
  {
    id: 'salvage_b',
    type: 'salvage',
    label: 'CONTENEDOR DE DESGUACE',
    icon: '♻️',
    tx: 32,
    ty: 23,
    tw: 2,
    th: 2,
    accent: '#34d399',
    yields: [{ item: 'scrap', amount: 2 }],
    desc: 'Rebusca chatarra. Aliméntala a la Recicladora y se vuelve acero.',
  },
];

/** Punto de aparición (centro de la entrada). */
export const SPAWN = { x: 18 * TILE, y: 4.2 * TILE };

/** Muros interiores (además del borde del mapa). En tiles. */
export const WALL_RECTS: Rect[] = [
  // Pilares estructurales
  { x: 12, y: 5, w: 1, h: 1 },
  { x: 12, y: 18, w: 1, h: 1 },
  { x: 21, y: 5, w: 1, h: 1 },
  { x: 21, y: 18, w: 1, h: 1 },
  // Muro de separación de la entrada
  { x: 13, y: 3, w: 2, h: 1 },
  { x: 21, y: 3, w: 2, h: 1 },
];

/** Props decorativos: cajas, barriles, palés, señales. Sólidos si `solid`. */
export interface PropDef {
  kind: 'crate' | 'barrel' | 'pallet' | 'pipe' | 'sign' | 'lamp' | 'cone' | 'terminal';
  tx: number;
  ty: number;
  solid?: boolean;
  variant?: number;
}

export const PROPS: PropDef[] = [
  { kind: 'crate', tx: 13, ty: 6, solid: true },
  { kind: 'crate', tx: 13.9, ty: 6.2, solid: true, variant: 1 },
  { kind: 'barrel', tx: 22.2, ty: 10.5, solid: true },
  { kind: 'barrel', tx: 22.2, ty: 11.4, solid: true, variant: 1 },
  { kind: 'pallet', tx: 24, ty: 11.5 },
  { kind: 'crate', tx: 24.5, ty: 11.2, solid: true },
  { kind: 'cone', tx: 16.5, ty: 19 },
  { kind: 'cone', tx: 23, ty: 19 },
  { kind: 'pallet', tx: 10.5, ty: 22 },
  { kind: 'crate', tx: 10.8, ty: 21.8, solid: true, variant: 1 },
  { kind: 'barrel', tx: 33, ty: 22, solid: true },
  { kind: 'barrel', tx: 33.9, ty: 22.4, solid: true, variant: 1 },
  { kind: 'crate', tx: 2.5, ty: 12.5, solid: true },
  { kind: 'pipe', tx: 12, ty: 12 },
  { kind: 'pipe', tx: 12, ty: 13 },
  { kind: 'pipe', tx: 12, ty: 14 },
  { kind: 'lamp', tx: 8, ty: 3 },
  { kind: 'lamp', tx: 28, ty: 3 },
  { kind: 'lamp', tx: 8, ty: 20 },
  { kind: 'lamp', tx: 28, ty: 20 },
  { kind: 'lamp', tx: 18, ty: 17 },
  { kind: 'sign', tx: 18, ty: 5.5 },
  { kind: 'terminal', tx: 30, ty: 12, solid: true },
  { kind: 'terminal', tx: 5, ty: 18, solid: true },
];

/**
 * Cintas transportadoras. Aparecen visualmente al alcanzar `fromLevel`
 * y son la señal más clara de que la fábrica está creciendo.
 */
export interface ConveyorDef {
  id: string;
  tx: number;
  ty: number;
  len: number;
  dir: 'right' | 'left' | 'up' | 'down';
  fromLevel: number;
  /**
   * Máquina a la que entrega la cinta. Si está definida, la cinta deja de ser
   * decoración: puedes acercarte a su extremo de carga y soltar material, que
   * viaja hasta esa máquina. Ahorra el paseo de ida y vuelta.
   */
  feeds?: string;
  /**
   * Filtro de material. Si está definido, la cinta SÓLO acepta estos items,
   * aunque la máquina de destino admita más cosas en su receta.
   */
  accepts?: string[];
  /** Nombre corto para la UI de interacción. */
  label?: string;
}

export const CONVEYORS: ConveyorDef[] = [
  { id: 'c1', tx: 11, ty: 6.5, len: 12, dir: 'right', fromLevel: 2, feeds: 'smelter', label: 'CINTA A FUNDIDORA' },
  { id: 'c2', tx: 29, ty: 9, len: 5, dir: 'down', fromLevel: 2, feeds: 'assembler', label: 'CINTA A ENSAMBLADORA' },
  { id: 'c3', tx: 23, ty: 16.5, len: 8, dir: 'left', fromLevel: 4 },
  { id: 'c4', tx: 18, ty: 16, len: 4, dir: 'down', fromLevel: 4 },
  { id: 'c5', tx: 16, ty: 16.5, len: 7, dir: 'left', fromLevel: 6, feeds: 'lab', label: 'CINTA A LABORATORIO' },
  // Bajante de cristal: recorre el borde del yacimiento y entra al laboratorio.
  // Sólo admite Cristal Resonante, que es lo escaso de esa receta.
  {
    id: 'c6',
    tx: 5.65,
    ty: 10.8,
    len: 5.6,
    dir: 'down',
    fromLevel: 6,
    feeds: 'lab',
    accepts: ['crystal'],
    label: 'BAJANTE DE CRISTAL',
  },
  {
    id: 'c7',
    tx: 5.65,
    ty: 16.1,
    // Llega justo hasta el borde del Laboratorio, sin montarse encima.
    len: 2.35,
    dir: 'right',
    fromLevel: 6,
    feeds: 'lab',
    accepts: ['crystal'],
    label: 'BAJANTE DE CRISTAL',
  },
  // Salida de la Recicladora hacia la Ensambladora.
  {
    id: 'c8',
    tx: 30,
    ty: 19.4,
    len: 2.4,
    dir: 'up',
    fromLevel: 4,
    feeds: 'assembler',
    label: 'CINTA DE RECICLADO',
  },
];

/** Punto de carga de una cinta: el extremo por el que entra el material. */
export function conveyorLoadPoint(c: ConveyorDef): { x: number; y: number } {
  const w = c.dir === 'left' || c.dir === 'right' ? c.len : 0.7;
  const h = c.dir === 'up' || c.dir === 'down' ? c.len : 0.7;
  switch (c.dir) {
    case 'right':
      return { x: c.tx * TILE, y: (c.ty + h / 2) * TILE };
    case 'left':
      return { x: (c.tx + w) * TILE, y: (c.ty + h / 2) * TILE };
    case 'down':
      return { x: (c.tx + w / 2) * TILE, y: c.ty * TILE };
    case 'up':
      return { x: (c.tx + w / 2) * TILE, y: (c.ty + h) * TILE };
  }
}

/** Puestos de robots — aparecen cuando la automatización sube. */
export const ROBOT_ROUTES: { id: string; points: { x: number; y: number }[]; fromLevel: number }[] = [
  {
    id: 'r1',
    fromLevel: 5,
    points: [
      { x: 12, y: 7 },
      { x: 22, y: 7 },
      { x: 22, y: 12 },
      { x: 12, y: 12 },
    ],
  },
  {
    id: 'r2',
    fromLevel: 7,
    points: [
      { x: 25, y: 19 },
      { x: 19, y: 19 },
      { x: 19, y: 22 },
      { x: 25, y: 22 },
    ],
  },
  {
    id: 'r3',
    fromLevel: 9,
    points: [
      { x: 8, y: 12 },
      { x: 8, y: 20 },
      { x: 14, y: 20 },
      { x: 14, y: 12 },
    ],
  },
];

export function tilesToRect(tx: number, ty: number, tw: number, th: number): Rect {
  return { x: tx * TILE, y: ty * TILE, w: tw * TILE, h: th * TILE };
}

/** Rectángulo que ocupa una cinta en píxeles de mundo. */
export function conveyorRect(c: ConveyorDef): Rect {
  const horizontal = c.dir === 'left' || c.dir === 'right';
  return {
    x: c.tx * TILE,
    y: c.ty * TILE,
    w: (horizontal ? c.len : 0.7) * TILE,
    h: (horizontal ? 0.7 : c.len) * TILE,
  };
}
