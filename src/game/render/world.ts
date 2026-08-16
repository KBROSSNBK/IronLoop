/**
 * RENDER DEL MUNDO.
 *
 * El suelo, los muros y las marcas pintadas son ESTÁTICOS: se rasterizan una
 * sola vez a un canvas offscreen y se re-generan únicamente cuando la fábrica
 * sube de nivel (que es justo cuando debe cambiar de aspecto). Todo lo animado
 * —cintas, luces, hologramas, humo— se dibuja por frame encima.
 */

import {
  CONVEYORS,
  PROPS,
  STATIONS,
  TILE,
  WALL_RECTS,
  WORLD_COLS,
  WORLD_H,
  WORLD_ROWS,
  WORLD_W,
  ZONES,
  type FloorStyle,
  type PropDef,
} from '../../config/world';
import { getFactoryLevel } from '../../config/factoryLevels';
import { getItem } from '../../config/items';
import { getMachine } from '../../config/machines';
import { beltActive, beltCount, beltItems } from '../logic/belts';
import type { FactoryState, GroundItem } from '../../types';

/* ─────────────────────────── utilidades ─────────────────────────── */

function hash(x: number, y: number, seed = 1): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Qué estilo de suelo corresponde a cada tile según las zonas. */
function floorStyleAt(tx: number, ty: number): { style: FloorStyle; accent: string | null } {
  for (const z of ZONES) {
    if (tx >= z.tx && tx < z.tx + z.tw && ty >= z.ty && ty < z.ty + z.th) {
      return { style: z.floor, accent: z.accent };
    }
  }
  return { style: 'concrete', accent: null };
}

/* ─────────────────────── capa estática (offscreen) ─────────────────────── */

let staticCanvas: HTMLCanvasElement | null = null;
let staticLevel = -1;

export function getStaticLayer(factoryLevel: number): HTMLCanvasElement {
  if (staticCanvas && staticLevel === factoryLevel) return staticCanvas;
  staticCanvas = document.createElement('canvas');
  staticCanvas.width = WORLD_W;
  staticCanvas.height = WORLD_H;
  const ctx = staticCanvas.getContext('2d')!;
  paintStatic(ctx, factoryLevel);
  staticLevel = factoryLevel;
  return staticCanvas;
}

export function invalidateStaticLayer(): void {
  staticLevel = -1;
}

function paintStatic(ctx: CanvasRenderingContext2D, factoryLevel: number) {
  const lvlDef = getFactoryLevel(factoryLevel);
  // Cuanto mayor el nivel, más limpia y luminosa se ve la nave.
  const polish = Math.min(1, (factoryLevel - 1) / 9);

  ctx.fillStyle = '#0a0e16';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  for (let ty = 0; ty < WORLD_ROWS; ty++) {
    for (let tx = 0; tx < WORLD_COLS; tx++) {
      paintTile(ctx, tx, ty, polish);
    }
  }

  paintZoneMarkings(ctx, factoryLevel);
  paintWalls(ctx, polish, lvlDef.accent);
}

function paintTile(ctx: CanvasRenderingContext2D, tx: number, ty: number, polish: number) {
  const { style, accent } = floorStyleAt(tx, ty);
  const x = tx * TILE;
  const y = ty * TILE;
  const n = hash(tx, ty);

  switch (style) {
    case 'grate': {
      ctx.fillStyle = `rgb(${18 + n * 6},${23 + n * 6},${32 + n * 8})`;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(5,8,13,0.85)';
      for (let i = 0; i < 5; i++) ctx.fillRect(x + 3 + i * 7, y + 3, 4, TILE - 6);
      ctx.strokeStyle = `rgba(120,140,170,${0.1 + polish * 0.12})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
      break;
    }
    case 'hazard': {
      ctx.fillStyle = `rgb(${24 + n * 5},${26 + n * 5},${34 + n * 6})`;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, TILE, TILE);
      ctx.clip();
      ctx.globalAlpha = 0.16 + polish * 0.1;
      ctx.fillStyle = '#facc15';
      for (let i = -TILE; i < TILE * 2; i += 16) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + 8, y);
        ctx.lineTo(x + i + 8 - TILE, y + TILE);
        ctx.lineTo(x + i - TILE, y + TILE);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case 'tech': {
      ctx.fillStyle = `rgb(${13 + n * 5},${21 + n * 6},${33 + n * 8})`;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = `rgba(34,211,238,${0.08 + polish * 0.16})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      if (n > 0.82) {
        ctx.fillStyle = `rgba(34,211,238,${0.14 + polish * 0.2})`;
        ctx.fillRect(x + TILE / 2 - 3, y + TILE / 2 - 3, 6, 6);
      }
      break;
    }
    case 'dirt': {
      ctx.fillStyle = `rgb(${32 + n * 10},${26 + n * 8},${38 + n * 10})`;
      ctx.fillRect(x, y, TILE, TILE);
      for (let i = 0; i < 5; i++) {
        const r = hash(tx * 7 + i, ty * 3 + i, 9);
        ctx.fillStyle = `rgba(${90 + r * 60},${75 + r * 50},${110 + r * 60},0.35)`;
        const s = 1.5 + r * 3;
        ctx.fillRect(x + r * (TILE - s), y + hash(tx + i, ty * 5, 3) * (TILE - s), s, s);
      }
      break;
    }
    default: {
      ctx.fillStyle = `rgb(${21 + n * 7},${26 + n * 7},${36 + n * 9})`;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      if (n > 0.93) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 8 + n * 10);
        ctx.lineTo(x + TILE - 8, y + 14 + n * 8);
        ctx.stroke();
      }
    }
  }

  if (accent && hash(tx, ty, 77) > 0.965) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
    ctx.globalAlpha = 1;
  }
}

function paintZoneMarkings(ctx: CanvasRenderingContext2D, factoryLevel: number) {
  for (const z of ZONES) {
    const asleep = z.liveAtLevel !== undefined && factoryLevel < z.liveAtLevel;
    const x = z.tx * TILE;
    const y = z.ty * TILE;
    const w = z.tw * TILE;
    const h = z.th * TILE;

    // Línea de seguridad pintada en el suelo
    ctx.save();
    ctx.globalAlpha = asleep ? 0.14 : 0.42;
    ctx.strokeStyle = z.accent;
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 10]);
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.setLineDash([]);

    // Esquinas marcadas
    ctx.globalAlpha = asleep ? 0.2 : 0.75;
    ctx.lineWidth = 4;
    const c = 18;
    const corners: [number, number, number, number][] = [
      [x + 6, y + 6 + c, x + 6, y + 6],
      [x + 6, y + 6, x + 6 + c, y + 6],
      [x + w - 6 - c, y + 6, x + w - 6, y + 6],
      [x + w - 6, y + 6, x + w - 6, y + 6 + c],
      [x + 6, y + h - 6 - c, x + 6, y + h - 6],
      [x + 6, y + h - 6, x + 6 + c, y + h - 6],
      [x + w - 6 - c, y + h - 6, x + w - 6, y + h - 6],
      [x + w - 6, y + h - 6, x + w - 6, y + h - 6 - c],
    ];
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of corners) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    // Rótulo pintado en la esquina INFERIOR izquierda: los nombres de las
    // máquinas van sobre ellas (arriba), así nunca se solapan.
    ctx.globalAlpha = asleep ? 0.18 : 0.5;
    ctx.fillStyle = z.accent;
    ctx.font = '800 13px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${z.icon} ${z.label}`, x + 14, y + h - 14);
    ctx.restore();
  }
}

function paintWalls(ctx: CanvasRenderingContext2D, polish: number, accent: string) {
  const rects = [
    { x: 0, y: 0, w: WORLD_COLS, h: 1 },
    { x: 0, y: WORLD_ROWS - 1, w: WORLD_COLS, h: 1 },
    { x: 0, y: 0, w: 1, h: WORLD_ROWS },
    { x: WORLD_COLS - 1, y: 0, w: 1, h: WORLD_ROWS },
    ...WALL_RECTS,
  ];
  for (const r of rects) {
    const x = r.x * TILE;
    const y = r.y * TILE;
    const w = r.w * TILE;
    const h = r.h * TILE;

    ctx.fillStyle = '#1b2231';
    ctx.fillRect(x, y, w, h);
    // Paneles verticales
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += TILE) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i, y + h);
      ctx.stroke();
    }
    // Canto superior iluminado
    ctx.fillStyle = '#2e3a52';
    ctx.fillRect(x, y, w, 5);
    ctx.fillStyle = `rgba(255,255,255,${0.05 + polish * 0.05})`;
    ctx.fillRect(x, y, w, 2);
    // Sombra proyectada al suelo
    const grad = ctx.createLinearGradient(0, y + h, 0, y + h + 14);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + h, w, 14);
    // Franja de neón (aparece con el pulido de la fábrica)
    if (polish > 0.15 && h >= TILE) {
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.16 + polish * 0.3;
      ctx.fillRect(x, y + h - 3, w, 2);
      ctx.globalAlpha = 1;
    }
  }
}

/* ─────────────────────── capa animada ─────────────────────── */

/**
 * Cintas transportadoras.
 *
 * Lo que se ve es el estado REAL: los bultos que circulan llevan el icono y
 * el color del material que transporta esa cinta, su cantidad depende de lo
 * que hay realmente en cola en la máquina de destino, y un contador en vivo
 * muestra cuánto está esperando. Si no circula nada, la banda gira vacía.
 */
export function drawConveyors(
  ctx: CanvasRenderingContext2D,
  factory: FactoryState,
  time: number,
  now: number,
): void {
  const factoryLevel = factory.level;

  for (const c of CONVEYORS) {
    const active = beltActive(c, factoryLevel);
    const horizontal = c.dir === 'left' || c.dir === 'right';
    const w = horizontal ? c.len * TILE : TILE * 0.7;
    const h = horizontal ? TILE * 0.7 : c.len * TILE;
    const x = c.tx * TILE;
    const y = c.ty * TILE;
    const span = horizontal ? w : h;
    const sign = c.dir === 'left' || c.dir === 'up' ? -1 : 1;

    // Material REAL que hay ahora mismo sobre la cinta.
    const state = factory.belts?.[c.id];
    const cargo = active ? beltItems(c.id, state, now) : [];
    const count = active ? beltCount(state, c.id, now) : 0;
    // Una cinta cargada se mueve un pelín más lenta: sensación de peso.
    const load = Math.min(1, count / 60);
    const bandSpeed = 52 * (1 - load * 0.28);

    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.22;

    // Bastidor
    ctx.fillStyle = '#0d121c';
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 6);
    ctx.fill();

    ctx.save();
    roundRect(ctx, x, y, w, h, 4);
    ctx.clip();
    ctx.fillStyle = '#232e40';
    ctx.fillRect(x, y, w, h);

    // Rodillos girando: dan volumen y marcan la dirección.
    const rollerGap = 9;
    const rollerOffset = active
      ? (((time * bandSpeed * sign) % rollerGap) + rollerGap) % rollerGap
      : 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.5;
    for (let i = -rollerGap; i < span + rollerGap; i += rollerGap) {
      const p = i + rollerOffset;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(x + p, y + 2);
        ctx.lineTo(x + p, y + h - 2);
      } else {
        ctx.moveTo(x + 2, y + p);
        ctx.lineTo(x + w - 2, y + p);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(226,232,240,0.14)';
    ctx.lineWidth = 1;
    for (let i = -rollerGap; i < span + rollerGap; i += rollerGap) {
      const p = i + rollerOffset + 2;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(x + p, y + 3);
        ctx.lineTo(x + p, y + h - 3);
      } else {
        ctx.moveTo(x + 3, y + p);
        ctx.lineTo(x + w - 3, y + p);
      }
      ctx.stroke();
    }

    // Flechas de sentido, muy tenues, sólo si la cinta está viva.
    if (active) {
      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 2;
      const arrowGap = 34;
      const ao = (((time * bandSpeed * sign) % arrowGap) + arrowGap) % arrowGap;
      for (let i = -arrowGap; i < span + arrowGap; i += arrowGap) {
        const p = i + ao;
        ctx.beginPath();
        if (horizontal) {
          const ax = x + p;
          ctx.moveTo(ax, y + 5);
          ctx.lineTo(ax + 6 * sign, y + h / 2);
          ctx.lineTo(ax, y + h - 5);
        } else {
          const ay = y + p;
          ctx.moveTo(x + 5, ay);
          ctx.lineTo(x + w / 2, ay + 6 * sign);
          ctx.lineTo(x + w - 5, ay);
        }
        ctx.stroke();
      }
    }

    // ── Los bultos: uno por unidad real que viaja por la cinta ──
    for (const it of cargo) {
      const def = getItem(it.item);
      // Traqueteo al pasar por los rodillos + entrada/salida suave.
      const jitter = Math.sin((horizontal ? it.x : it.y) * 0.6 + time * 6) * 0.8;
      const fade = Math.min(1, it.t * 12, (1 - it.t) * 12);
      ctx.globalAlpha = (active ? 1 : 0.22) * Math.max(0.15, fade);

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      roundRect(ctx, it.x - 8, it.y - 3 + jitter, 16, 12, 3);
      ctx.fill();
      ctx.fillStyle = '#7c4a1e';
      roundRect(ctx, it.x - 8, it.y - 8 + jitter, 16, 15, 3);
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.fillRect(it.x - 8, it.y - 3 + jitter, 16, 3.5);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, it.x - 8, it.y - 8 + jitter, 16, 4, 3);
      ctx.fill();
      ctx.font = '9px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, it.x, it.y - 5.5 + jitter);
    }
    ctx.globalAlpha = active ? 1 : 0.22;
    ctx.restore();

    // Barandillas
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(148,163,184,0.22)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 3);
    ctx.stroke();

    // Contador en vivo: cuántas unidades hay REALMENTE sobre la cinta.
    if (active) {
      const accepts = c.accepts?.length
        ? c.accepts
        : c.feeds
          ? Object.keys(getMachine(c.feeds).input)
          : [];
      const icon = cargo.length > 0
        ? getItem(cargo[0].item).icon
        : accepts.length > 0
          ? getItem(accepts[0]).icon
          : '📦';
      const label = `${icon} ${count} ITEMS`;
      const bx = x + w / 2;
      const by = y - 13;
      ctx.font = '800 10px "Rajdhani", system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(6,11,20,0.88)';
      roundRect(ctx, bx - tw / 2, by - 8, tw, 15, 7);
      ctx.fill();
      ctx.strokeStyle = count > 0 ? '#38bdf8' : 'rgba(148,163,184,0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = count > 0 ? '#e2e8f0' : '#64748b';
      ctx.fillText(label, bx, by);
    }
    ctx.restore();
  }
}

export function drawProps(ctx: CanvasRenderingContext2D, time: number): void {
  for (const p of PROPS) drawProp(ctx, p, time);
}

function drawProp(ctx: CanvasRenderingContext2D, p: PropDef, time: number) {
  const x = p.tx * TILE;
  const y = p.ty * TILE;
  const v = p.variant ?? 0;
  ctx.save();
  switch (p.kind) {
    case 'crate': {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + 16, y + 30, 14, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = v ? '#7c4a1e' : '#8a5522';
      roundRect(ctx, x + 3, y + 6, 26, 24, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      roundRect(ctx, x + 3, y + 6, 26, 6, 3);
      ctx.fill();
      ctx.strokeStyle = '#5a3315';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 18);
      ctx.lineTo(x + 29, y + 18);
      ctx.moveTo(x + 16, y + 6);
      ctx.lineTo(x + 16, y + 30);
      ctx.stroke();
      break;
    }
    case 'barrel': {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + 16, y + 30, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = v ? '#1e6b52' : '#8a2b2b';
      roundRect(ctx, x + 6, y + 6, 20, 24, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundRect(ctx, x + 8, y + 8, 6, 20, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 14);
      ctx.lineTo(x + 26, y + 14);
      ctx.moveTo(x + 6, y + 23);
      ctx.lineTo(x + 26, y + 23);
      ctx.stroke();
      break;
    }
    case 'pallet': {
      ctx.fillStyle = '#5b4326';
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 2, y + 12 + i * 7, 34, 4);
      ctx.fillRect(x + 2, y + 12, 4, 18);
      ctx.fillRect(x + 32, y + 12, 4, 18);
      break;
    }
    case 'pipe': {
      ctx.fillStyle = '#2b3446';
      ctx.fillRect(x + 10, y, 18, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x + 13, y, 4, TILE);
      ctx.fillStyle = '#1b2130';
      ctx.fillRect(x + 7, y + 14, 24, 8);
      break;
    }
    case 'cone': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + 16, y + 28, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(x + 16, y + 8);
      ctx.lineTo(x + 24, y + 28);
      ctx.lineTo(x + 8, y + 28);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff7ed';
      ctx.fillRect(x + 11, y + 19, 10, 3);
      break;
    }
    case 'sign': {
      ctx.fillStyle = '#0f172a';
      roundRect(ctx, x + 2, y + 4, 36, 18, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(34,211,238,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#22d3ee';
      ctx.globalAlpha = 0.75 + Math.sin(time * 2) * 0.2;
      ctx.font = '800 9px "Rajdhani", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('IRONLOOP', x + 20, y + 16);
      break;
    }
    case 'terminal': {
      ctx.fillStyle = '#111a28';
      roundRect(ctx, x + 4, y + 6, 30, 26, 4);
      ctx.fill();
      ctx.fillStyle = '#0b2b38';
      roundRect(ctx, x + 8, y + 10, 22, 14, 2);
      ctx.fill();
      ctx.fillStyle = '#22d3ee';
      ctx.globalAlpha = 0.5 + Math.sin(time * 3 + x) * 0.3;
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + 10, y + 13 + i * 4, 8 + ((Math.sin(time * 2 + i) + 1) * 5), 2);
      }
      break;
    }
    case 'lamp': {
      // El foco en sí; el halo lo pinta la capa de luces.
      ctx.fillStyle = '#0f1725';
      roundRect(ctx, x + 10, y + 6, 20, 8, 3);
      ctx.fill();
      ctx.fillStyle = '#fde68a';
      ctx.globalAlpha = 0.85;
      roundRect(ctx, x + 12, y + 12, 16, 4, 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** Estaciones interactivas: vetas, muelle, núcleo, terminal de mejoras. */
export function drawStations(
  ctx: CanvasRenderingContext2D,
  time: number,
  factoryLevel: number,
  factoryRatio: number,
): void {
  for (const s of STATIONS) {
    const x = s.tx * TILE;
    const y = s.ty * TILE;
    const w = s.tw * TILE;
    const h = s.th * TILE;
    ctx.save();
    switch (s.type) {
      case 'oreVein':
        drawOreVein(ctx, x, y, w, h, time, s.accent);
        break;
      case 'sell':
        drawDock(ctx, x, y, w, h, time);
        break;
      case 'core':
        drawCore(ctx, x, y, w, h, time, factoryLevel, factoryRatio);
        break;
      case 'shop':
        drawShop(ctx, x, y, w, h, time, s.accent);
        break;
      case 'salvage':
        drawSalvage(ctx, x, y, w, h, time, s.accent);
        break;
    }
    ctx.restore();
  }
}

function drawOreVein(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  time: number,
  accent: string,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h - 4, w / 2 - 4, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  const rocks: [number, number, number][] = [
    [0.22, 0.6, 15],
    [0.5, 0.42, 20],
    [0.78, 0.62, 13],
    [0.36, 0.78, 11],
    [0.66, 0.8, 10],
  ];
  for (const [rx, ry, r] of rocks) {
    const cx = x + rx * w;
    const cy = y + ry * h;
    ctx.fillStyle = '#3b3145';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + r * 0.6);
    ctx.lineTo(cx - r * 0.5, cy - r * 0.8);
    ctx.lineTo(cx + r * 0.55, cy - r * 0.7);
    ctx.lineTo(cx + r, cy + r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4c4058';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy - r * 0.8);
    ctx.lineTo(cx + r * 0.55, cy - r * 0.7);
    ctx.lineTo(cx + r * 0.2, cy);
    ctx.closePath();
    ctx.fill();
    // Vetas brillantes
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55 + Math.sin(time * 1.6 + rx * 9) * 0.3;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.4, cy + r * 0.2);
    ctx.lineTo(cx + r * 0.1, cy - r * 0.3);
    ctx.lineTo(cx + r * 0.5, cy + r * 0.1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawDock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  time: number,
) {
  // Plataforma
  ctx.fillStyle = '#1a2334';
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = '#232f45';
  roundRect(ctx, x + 4, y + 4, w - 8, h - 14, 4);
  ctx.fill();

  // Camión estilizado
  const truckX = x + w - 62;
  ctx.fillStyle = '#334155';
  roundRect(ctx, truckX, y + 8, 54, h - 26, 4);
  ctx.fill();
  ctx.fillStyle = '#475569';
  roundRect(ctx, truckX + 4, y + 12, 46, h - 34, 3);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.globalAlpha = 0.6 + Math.sin(time * 4) * 0.4;
  ctx.fillRect(truckX + 6, y + h - 22, 42, 3);
  ctx.globalAlpha = 1;

  // Báscula de venta
  ctx.fillStyle = '#0f1826';
  roundRect(ctx, x + 8, y + 10, 40, 26, 4);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.font = '800 16px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.75 + Math.sin(time * 3) * 0.25;
  ctx.fillText('$', x + 28, y + 23);
  ctx.globalAlpha = 1;
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  time: number,
  level: number,
  ratio: number,
) {
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Base
  ctx.fillStyle = '#0d1a26';
  roundRect(ctx, x, y + h * 0.3, w, h * 0.7, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(34,211,238,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Columna de energía
  const pulse = 0.6 + Math.sin(time * 2.4) * 0.25;
  const grad = ctx.createLinearGradient(cx, y - 10, cx, cy + h * 0.4);
  grad.addColorStop(0, 'rgba(34,211,238,0)');
  grad.addColorStop(0.5, `rgba(34,211,238,${0.45 * pulse})`);
  grad.addColorStop(1, `rgba(34,211,238,${0.15 * pulse})`);
  ctx.fillStyle = grad;
  ctx.fillRect(cx - 14, y - 14, 28, h * 0.85);

  // Núcleo giratorio
  ctx.save();
  ctx.translate(cx, cy - 4);
  ctx.rotate(time * 0.6);
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 18 - i * 4, 8 - i * 2, (i * Math.PI) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#a5f3fc';
  ctx.globalAlpha = pulse;
  ctx.beginPath();
  ctx.arc(cx, cy - 4, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Holograma con el nivel y la barra de progreso
  ctx.font = '800 15px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#67e8f9';
  ctx.fillText(`NIVEL ${level}`, cx, y + h - 22);
  const bw = w - 26;
  ctx.fillStyle = 'rgba(2,20,28,0.85)';
  roundRect(ctx, cx - bw / 2, y + h - 15, bw, 7, 3.5);
  ctx.fill();
  ctx.fillStyle = '#22d3ee';
  roundRect(ctx, cx - bw / 2 + 1, y + h - 14, Math.max(2, (bw - 2) * ratio), 5, 2.5);
  ctx.fill();
}

function drawShop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  time: number,
  accent: string,
) {
  ctx.fillStyle = '#151d2c';
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Pantalla
  ctx.fillStyle = '#0a1420';
  roundRect(ctx, x + 6, y + 6, w - 12, h - 20, 3);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.55 + Math.sin(time * 2.5) * 0.25;
  ctx.font = '800 18px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🛠️', x + w / 2, y + h / 2 - 4);
  ctx.globalAlpha = 1;

  // Herramientas colgadas
  ctx.strokeStyle = 'rgba(226,232,240,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const hx = x + 12 + i * ((w - 24) / 2.5);
    ctx.beginPath();
    ctx.moveTo(hx, y + h - 12);
    ctx.lineTo(hx, y + h - 4);
    ctx.stroke();
  }
}

/**
 * Objetos tirados en el suelo. Flotan un poco y brillan para que se vean
 * incluso sobre el suelo oscuro; al pasar por encima se recogen solos.
 */
export function drawGroundItems(
  ctx: CanvasRenderingContext2D,
  ground: Record<string, GroundItem>,
  time: number,
): void {
  for (const g of Object.values(ground)) {
    if (!g || g.qty <= 0) continue;
    const def = getItem(g.item);
    const float = Math.sin(time * 2.4 + g.x * 0.05) * 2.5;
    const y = g.y + float;

    ctx.save();
    // Sombra en el suelo, fija
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + 9, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Halo del color del item
    const glow = ctx.createRadialGradient(g.x, y, 0, g.x, y, 20);
    glow.addColorStop(0, `${def.color}55`);
    glow.addColorStop(1, `${def.color}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(g.x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Saco
    ctx.fillStyle = 'rgba(10,16,28,0.9)';
    roundRect(ctx, g.x - 10, y - 9, 20, 18, 5);
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.font = '12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, g.x, y);

    // Cantidad
    ctx.font = '800 9px "Rajdhani", system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(2,6,23,0.9)';
    ctx.strokeText(`×${g.qty}`, g.x, y + 14);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`×${g.qty}`, g.x, y + 14);
    ctx.restore();
  }
}

/** Montón de chatarra de la zona de RECOLECCIÓN. */
function drawSalvage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  time: number,
  accent: string,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h - 6, w / 2 - 4, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Contenedor
  ctx.fillStyle = '#1f3b32';
  roundRect(ctx, x + 4, y + h * 0.32, w - 8, h * 0.6, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, x + 6, y + h * 0.34, w - 12, 6, 3);
  ctx.fill();

  // Chatarra asomando: planchas y tubos desordenados
  const junk: [number, number, number, number, number][] = [
    [0.18, 0.2, 22, 7, -0.5],
    [0.44, 0.12, 26, 6, 0.25],
    [0.68, 0.22, 18, 8, 0.7],
    [0.32, 0.28, 14, 5, 1.1],
    [0.8, 0.14, 12, 6, -0.9],
  ];
  for (const [px, py, jw, jh, rot] of junk) {
    ctx.save();
    ctx.translate(x + px * w, y + py * h + h * 0.22);
    ctx.rotate(rot);
    ctx.fillStyle = '#54606f';
    roundRect(ctx, -jw / 2, -jh / 2, jw, jh, 2);
    ctx.fill();
    ctx.fillStyle = '#6b7787';
    ctx.fillRect(-jw / 2, -jh / 2, jw, 1.6);
    ctx.restore();
  }

  // Símbolo de reciclaje parpadeante
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.55 + Math.sin(time * 2) * 0.25;
  ctx.font = '800 16px "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♻️', x + w / 2, y + h * 0.24);
  ctx.globalAlpha = 1;
}

/* ─────────────────────── luces y atmósfera ─────────────────────── */

interface LightSource {
  x: number;
  y: number;
  radius: number;
  color: string;
  flicker: number;
  /** Multiplicador de intensidad: los focos marcan, las zonas sólo tiñen. */
  intensity: number;
}

let cachedLights: LightSource[] | null = null;

function getLights(): LightSource[] {
  if (cachedLights) return cachedLights;
  const lights: LightSource[] = [];
  for (const p of PROPS) {
    if (p.kind !== 'lamp') continue;
    lights.push({
      x: p.tx * TILE + TILE / 2,
      y: p.ty * TILE + TILE / 2,
      radius: 230,
      color: '255,224,150',
      flicker: 0.06,
      intensity: 1,
    });
  }
  for (const z of ZONES) {
    lights.push({
      x: (z.tx + z.tw / 2) * TILE,
      y: (z.ty + z.th / 2) * TILE,
      radius: Math.max(z.tw, z.th) * TILE * 0.6,
      color: hexToRgbTriplet(z.accent),
      flicker: 0.02,
      // Tinte suave: da color a la zona sin apagar el contraste industrial.
      intensity: 0.34,
    });
  }
  cachedLights = lights;
  return lights;
}

function hexToRgbTriplet(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * Oscurece la escena y recorta halos de luz. Es lo que da el aspecto
 * "nave industrial de noche" en vez de "dibujo plano".
 */
export function drawLighting(
  ctx: CanvasRenderingContext2D,
  view: { x: number; y: number; w: number; h: number },
  factoryLevel: number,
  time: number,
  extra: { x: number; y: number; radius: number; color: string }[] = [],
): void {
  const darkness = Math.max(0.24, 0.62 - (factoryLevel - 1) * 0.035);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(24,28,52,${darkness})`;
  ctx.fillRect(view.x, view.y, view.w, view.h);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const all: LightSource[] = [
    ...getLights(),
    ...extra.map((e) => ({ ...e, flicker: 0, intensity: 0.8 })),
  ];
  for (const l of all) {
    if (
      l.x + l.radius < view.x ||
      l.x - l.radius > view.x + view.w ||
      l.y + l.radius < view.y ||
      l.y - l.radius > view.y + view.h
    )
      continue;
    const f = (1 - l.flicker * (Math.sin(time * 9 + l.x) * 0.5 + 0.5)) * l.intensity;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.radius);
    const color = l.color.includes(',') ? l.color : hexToRgbTriplet(l.color);
    g.addColorStop(0, `rgba(${color},${0.3 * f})`);
    g.addColorStop(0.45, `rgba(${color},${0.1 * f})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(l.x, l.y, l.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Viñeta y ruido sutil sobre el viewport (en píxeles de pantalla). */
let vignette: { w: number; h: number; grad: CanvasGradient } | null = null;

export function drawPostFx(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  // El degradado sólo depende del tamaño de la ventana: se reaprovecha entre
  // fotogramas en vez de reconstruirlo 60 veces por segundo.
  if (!vignette || vignette.w !== w || vignette.h !== h) {
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.32,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.78,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    vignette = { w, h, grad };
  }
  ctx.fillStyle = vignette.grad;
  ctx.fillRect(0, 0, w, h);
}
