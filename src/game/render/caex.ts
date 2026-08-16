/**
 * CAEX — camión minero, dibujado por capas.
 *
 * Misma estética que el resto de mascotas: silueta plana, sombra propia y
 * detalles en el color que elijas. Lo que le da carácter es el TAMAÑO —al
 * lado de un perro parece un edificio— y que la tolva se llena a la vista:
 * cuanto más carga lleva, más alta se ve la montaña de material.
 */

import { getCaexSkin, type CaexState } from '../../config/caex';
import type { CaexStateName } from '../systems/caexBrain';

const TAU = Math.PI * 2;

export interface CaexDrawArgs {
  x: number;
  y: number;
  facing: number;
  /** Vuelta de rueda acumulada. */
  roll: number;
  /** Cabeceo de la suspensión, en radianes. */
  tilt: number;
  t: number;
  state: CaexStateName;
  skin: CaexState['skin'];
  color: string;
  accent: string;
  /** Carga actual y tope, para la montaña de la tolva y el contador. */
  carried: number;
  capacity: number;
  carryIcon?: string | null;
  carryColor?: string | null;
  alpha?: number;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, roll: number) {
  ctx.fillStyle = '#11161f';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a323f';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, TAU);
  ctx.fill();
  // Tacos: giran con el avance, que es lo que vende que rueda.
  ctx.strokeStyle = 'rgba(148,163,184,0.55)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 6; i++) {
    const a = roll + (i / 6) * TAU;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55);
    ctx.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95);
    ctx.stroke();
  }
}

export function drawCaex(ctx: CanvasRenderingContext2D, a: CaexDrawArgs): void {
  const def = getCaexSkin(a.skin);
  const L = def.build.body;
  const H = def.build.height;
  const R = def.build.wheel;
  const alpha = a.alpha ?? 1;
  const f = a.facing >= 0 ? 1 : -1;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Sombra: larga, que pesa 200 toneladas.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(a.x, a.y + R * 0.75, L * 0.52, R * 0.55, 0, 0, TAU);
  ctx.fill();

  ctx.translate(a.x, a.y);
  ctx.scale(f, 1);
  ctx.rotate(-a.tilt);

  const x0 = -L / 2;

  /* — ruedas traseras (dobles) y delantera — */
  wheel(ctx, x0 + L * 0.24, 0, R, a.roll);
  wheel(ctx, x0 + L * 0.41, 0, R, a.roll);
  wheel(ctx, x0 + L * 0.84, 0, R * 0.92, a.roll);

  /* — chasis — */
  ctx.fillStyle = '#1b2230';
  roundRect(ctx, x0 + 4, -H * 0.42, L - 8, H * 0.42, 3);
  ctx.fill();

  /* — tolva: la caja grande de atrás — */
  const tolvaW = L * 0.62;
  const tolvaH = H;
  const tolvaX = x0 + 2;
  const tolvaY = -H - H * 0.36;
  ctx.fillStyle = a.color;
  ctx.beginPath();
  ctx.moveTo(tolvaX, tolvaY + tolvaH);
  ctx.lineTo(tolvaX - 3, tolvaY + 3);
  ctx.lineTo(tolvaX + tolvaW, tolvaY);
  ctx.lineTo(tolvaX + tolvaW - 4, tolvaY + tolvaH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,16,0.6)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Nervios de la tolva
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1.2;
  for (let i = 1; i < 4; i++) {
    const px = tolvaX + (tolvaW / 4) * i;
    ctx.beginPath();
    ctx.moveTo(px, tolvaY + 2);
    ctx.lineTo(px, tolvaY + tolvaH - 2);
    ctx.stroke();
  }
  // Brillo superior
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, tolvaX, tolvaY + 1, tolvaW - 4, 4, 2);
  ctx.fill();

  /* — la montaña de material, que sube con la carga — */
  const llenado = a.capacity > 0 ? Math.max(0, Math.min(1, a.carried / a.capacity)) : 0;
  if (llenado > 0.02) {
    const alto = 3 + llenado * (H * 0.75);
    ctx.fillStyle = a.carryColor ?? '#8b7d6b';
    ctx.beginPath();
    ctx.moveTo(tolvaX + 2, tolvaY + 3);
    ctx.quadraticCurveTo(tolvaX + tolvaW * 0.5, tolvaY + 3 - alto, tolvaX + tolvaW - 6, tolvaY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(tolvaX + 2, tolvaY + 3);
    ctx.quadraticCurveTo(tolvaX + tolvaW * 0.35, tolvaY + 3 - alto * 0.8, tolvaX + tolvaW * 0.5, tolvaY + 3);
    ctx.closePath();
    ctx.fill();
  }

  /* — cabina — */
  const cabX = x0 + L * 0.66;
  const cabY = -H * 0.95;
  ctx.fillStyle = a.color;
  roundRect(ctx, cabX, cabY, L * 0.26, H * 0.62, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,16,0.6)';
  ctx.stroke();
  // Cristal
  ctx.fillStyle = '#0b1120';
  roundRect(ctx, cabX + 3, cabY + 3, L * 0.26 - 8, H * 0.3, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(148,197,255,0.35)';
  roundRect(ctx, cabX + 4, cabY + 4, L * 0.13, H * 0.12, 1);
  ctx.fill();
  // Escalerilla
  ctx.strokeStyle = a.accent;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cabX - 3, cabY + H * 0.62 - i * 4 - 2);
    ctx.lineTo(cabX + 1, cabY + H * 0.62 - i * 4 - 2);
    ctx.stroke();
  }

  /* — faros y baliza — */
  const trabajando = a.state === 'CARGANDO' || a.state === 'VACIANDO';
  ctx.fillStyle = '#fde68a';
  ctx.globalAlpha = alpha * 0.9;
  roundRect(ctx, x0 + L - 6, -H * 0.34, 4, 4, 1);
  ctx.fill();
  ctx.globalAlpha = alpha;
  // Baliza giratoria: parpadea sólo cuando trabaja.
  const baliza = trabajando ? 0.45 + Math.sin(a.t * 9) * 0.45 : 0.18;
  ctx.fillStyle = a.accent;
  ctx.globalAlpha = alpha * baliza;
  ctx.beginPath();
  ctx.arc(cabX + L * 0.13, cabY - 2, 3, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;

  ctx.restore();

  /* — contador de carga, en horizontal aunque el camión mire al revés — */
  if (a.carried > 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const txt = `${a.carryIcon ?? '📦'}${a.carried}/${a.capacity}`;
    ctx.font = '800 11px "Rajdhani", system-ui, sans-serif';
    const w = ctx.measureText(txt).width + 14;
    const by = a.y - H * 2 - 12;
    ctx.fillStyle = 'rgba(6,11,20,0.9)';
    roundRect(ctx, a.x - w / 2, by - 9, w, 18, 7);
    ctx.fill();
    ctx.strokeStyle = a.accent;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(txt, a.x, by);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}
