/**
 * LAYOUT DE LA FÁBRICA — data driven.
 * Todo el mapa (zonas, estaciones, muros, decoración) se describe aquí.
 * Añadir una zona nueva = añadir una entrada. El renderer y la colisión
 * derivan de estos datos.
 */

export const TILE = 40;
// El mapa creció hacia el este y el sur para alojar la Zona Minera, la
// Tecnológica, la Peligrosa y la Avanzada sin apretar las zonas originales.
export const WORLD_COLS = 48;
export const WORLD_ROWS = 34;
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

  // ── Ampliación: zonas nuevas al este y al sur ──
  { id: 'mine', label: 'ZONA MINERA', icon: '⛏️', tx: 36, ty: 2, tw: 11, th: 10, floor: 'dirt', accent: '#fb923c', liveAtLevel: 3 },
  { id: 'tech', label: 'ZONA TECNOLÓGICA', icon: '🔬', tx: 36, ty: 13, tw: 11, th: 9, floor: 'tech', accent: '#a3e635', liveAtLevel: 6 },
  { id: 'danger', label: 'ZONA PELIGROSA', icon: '☢️', tx: 36, ty: 23, tw: 11, th: 10, floor: 'hazard', accent: '#f87171', liveAtLevel: 8 },
  { id: 'advanced', label: 'ZONA AVANZADA', icon: '💠', tx: 14, ty: 26, tw: 20, th: 7, floor: 'tech', accent: '#22d3ee', liveAtLevel: 10 },
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

  // ── Zona Minera: cobre abundante y una veta profunda de titanio ──
  {
    id: 'vein_copper_a',
    type: 'oreVein',
    label: 'VETA DE COBRE',
    icon: '⛏️',
    tx: 37,
    ty: 4,
    tw: 3,
    th: 2,
    accent: '#fb923c',
    yields: [{ item: 'copper', amount: 1 }],
    desc: 'Cobre para aleaciones y baterías.',
  },
  {
    id: 'vein_copper_b',
    type: 'oreVein',
    label: 'VETA DE COBRE',
    icon: '⛏️',
    tx: 43,
    ty: 7,
    tw: 3,
    th: 2,
    accent: '#fb923c',
    yields: [{ item: 'copper', amount: 1 }],
    desc: 'Cobre para aleaciones y baterías.',
  },
  {
    id: 'vein_titanium',
    type: 'oreVein',
    label: 'VETA PROFUNDA',
    icon: '⛏️',
    tx: 40,
    ty: 9.5,
    tw: 3,
    th: 2,
    accent: '#cbd5e1',
    yields: [{ item: 'titanium', amount: 1 }],
    desc: 'Titanio. Escaso, pesado y necesario para los Núcleos.',
  },

  // ── Zona Peligrosa: mejor material, terreno inestable ──
  {
    id: 'vein_danger',
    type: 'oreVein',
    label: 'FILÓN INESTABLE',
    icon: '☢️',
    tx: 38,
    ty: 26,
    tw: 3,
    th: 2,
    accent: '#f87171',
    yields: [{ item: 'titanium', amount: 2 }],
    desc: 'Rinde el doble. El filón es inestable: gasta más estamina.',
  },
  {
    id: 'salvage_danger',
    type: 'salvage',
    label: 'RESTOS RADIACTIVOS',
    icon: '☢️',
    tx: 43,
    ty: 29,
    tw: 3,
    th: 2,
    accent: '#f87171',
    yields: [{ item: 'crystal', amount: 1 }],
    desc: 'Cristal resonante entre los escombros radiactivos.',
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
  { id: 'c1', tx: 11, ty: 6.5, len: 13, dir: 'right', fromLevel: 2, feeds: 'smelter', label: 'CINTA A FUNDIDORA' },
  { id: 'c2', tx: 29, ty: 9, len: 6, dir: 'down', fromLevel: 2, feeds: 'assembler', label: 'CINTA A ENSAMBLADORA' },
  { id: 'c3', tx: 30, ty: 15.2, len: 3, dir: 'right', fromLevel: 4 },
  { id: 'c4', tx: 18, ty: 16, len: 4, dir: 'down', fromLevel: 4 },
  { id: 'c5', tx: 13, ty: 16.5, len: 10, dir: 'left', fromLevel: 6, feeds: 'lab', label: 'CINTA A LABORATORIO' },
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
    tx: 29.15,
    ty: 19,
    len: 2.8,
    dir: 'up',
    fromLevel: 4,
    feeds: 'assembler',
    label: 'CINTA DE RECICLADO',
  },

  /*
   * ── Cintas de las zonas nuevas ──
   *
   * Regla de trazado: una cinta SIEMPRE termina tocando el borde de la
   * máquina a la que alimenta, y su extremo de carga cae en suelo despejado
   * y cerca de donde nace el material. Antes no era así — la de circuitos
   * moría en mitad de la nave, a cinco tiles de la Planta de Baterías, y la
   * del Reactor pasaba por encima de otra zona— y desde el juego no había
   * manera de entender qué conectaba con qué.
   *
   * Regla de contenido: cada máquina tiene AL MENOS una cinta sin filtro, así
   * que por ella cabe todo lo que pide su receta. Con filtro sólo se dejan
   * las cintas dedicadas (la bajante de cristal), que son un extra.
   */

  // Zona Minera → ALEACIONES. Baja desde las vetas y entra por arriba.
  {
    id: 'c9',
    tx: 40.15,
    ty: 11.2,
    len: 2.8,
    dir: 'down',
    fromLevel: 5,
    feeds: 'alloy',
    label: 'BAJANTE DE LA MINA',
  },
  // Laboratorio → PLANTA DE BATERÍAS: cruza la nave y entra por su izquierda.
  // Sin filtro: por aquí entran tanto los circuitos como el cobre.
  {
    id: 'c10',
    tx: 15,
    ty: 19.6,
    len: 23,
    dir: 'right',
    fromLevel: 7,
    feeds: 'batteryPlant',
    label: 'LÍNEA TRANSVERSAL',
  },
  // RECOLECCIÓN → RECICLADORA. Nace entre los montones de chatarra.
  {
    id: 'c12',
    tx: 29.15,
    ty: 22.15,
    len: 3,
    dir: 'left',
    fromLevel: 4,
    feeds: 'recycler',
    label: 'CINTA DE CHATARRA',
  },
  // Todo lo pesado → REACTOR, por su costado derecho.
  {
    id: 'c11',
    tx: 26.15,
    ty: 28.2,
    len: 4,
    dir: 'left',
    fromLevel: 10,
    feeds: 'reactor',
    label: 'CINTA AL REACTOR',
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
