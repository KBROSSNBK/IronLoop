/**
 * Personaje modular dibujado por capas — sin sprites externos.
 * Añadir una skin nueva = añadir un caso aquí + una opción en config/cosmetics.
 * Origen (x, y) = cadera; los pies quedan en y + 15.
 */

import type { Appearance, ActivityKind, FacingDir } from '../../types';

export interface CharacterDrawArgs {
  x: number;
  y: number;
  dir: FacingDir;
  act: ActivityKind;
  /** Tiempo acumulado de animación en segundos. */
  t: number;
  appearance: Appearance;
  name: string;
  level: number;
  isLocal: boolean;
  /** 0..1 si está ejecutando una acción sostenida. */
  actionProgress?: number;
  /** Atenúa a jugadores remotos con señal antigua. */
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
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

const SHOE_COLORS: Record<string, string> = {
  boots: '#3b2a1d',
  sneakers: '#e2e8f0',
  servo: '#1e293b',
};

/**
 * Escala del personaje respecto al tile (40px). 1.35 ⇒ ~50px de alto:
 * algo más que un tile, la proporción típica de un top-down legible.
 */
export const CHARACTER_SCALE = 1.35;

export function drawCharacter(ctx: CanvasRenderingContext2D, c: CharacterDrawArgs): void {
  const { x, y, appearance: ap } = c;
  const moving = c.act === 'walk' || c.act === 'run';
  const speed = c.act === 'run' ? 16 : 11;
  const swing = moving ? Math.sin(c.t * speed) : 0;
  const bob = moving ? Math.abs(Math.sin(c.t * speed)) * 1.6 : Math.sin(c.t * 2) * 0.6;
  const working = c.act === 'gather' || c.act === 'work';
  const workSwing = working ? Math.sin(c.t * 18) : 0;
  const tired = c.act === 'tired';

  ctx.save();
  ctx.globalAlpha = c.alpha ?? 1;
  // Escalado alrededor de la cadera: el resto del dibujo usa coordenadas de mundo.
  ctx.translate(x, y);
  ctx.scale(CHARACTER_SCALE, CHARACTER_SCALE);
  ctx.translate(-x, -y);

  // Sombra
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 10, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyY = y - 8 - bob;
  const headY = y - 15 - bob;
  const faceLeft = c.dir === 'left';
  const back = c.dir === 'up';

  // Piernas
  const legColor = ap.outfit === 'suit' ? shade(ap.outfitColor, -50) : '#26303f';
  ctx.fillStyle = legColor;
  const legOffset = swing * 3;
  roundRect(ctx, x - 6, y + 4 - bob, 5, 11 + legOffset * 0.3, 2);
  ctx.fill();
  roundRect(ctx, x + 1, y + 4 - bob, 5, 11 - legOffset * 0.3, 2);
  ctx.fill();

  // Calzado
  ctx.fillStyle = SHOE_COLORS[ap.shoes] ?? '#3b2a1d';
  roundRect(ctx, x - 7, y + 13 - bob + legOffset * 0.25, 6.5, 4, 1.6);
  ctx.fill();
  roundRect(ctx, x + 0.5, y + 13 - bob - legOffset * 0.25, 6.5, 4, 1.6);
  ctx.fill();
  if (ap.shoes === 'servo') {
    ctx.fillStyle = ap.accent;
    ctx.fillRect(x - 7, y + 16 - bob, 6.5, 1);
    ctx.fillRect(x + 0.5, y + 16 - bob, 6.5, 1);
  }

  // Torso
  const torsoW = 17;
  ctx.fillStyle = ap.outfitColor;
  roundRect(ctx, x - torsoW / 2, bodyY, torsoW, 14, 4);
  ctx.fill();
  // Sombreado lateral para dar volumen
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(ctx, x + 2, bodyY, torsoW / 2 - 2, 14, 4);
  ctx.fill();

  // Detalles de la ropa
  ctx.fillStyle = ap.accent;
  if (ap.outfit === 'vest') {
    ctx.fillRect(x - torsoW / 2, bodyY + 4.5, torsoW, 2);
    ctx.fillRect(x - torsoW / 2, bodyY + 9, torsoW, 1.4);
  } else if (ap.outfit === 'overall') {
    ctx.fillRect(x - 4.5, bodyY + 1, 2, 12);
    ctx.fillRect(x + 2.5, bodyY + 1, 2, 12);
  } else if (ap.outfit === 'jacket') {
    ctx.fillRect(x - 0.8, bodyY + 1, 1.6, 13);
    ctx.fillRect(x - torsoW / 2, bodyY + 1.5, 3, 4);
  } else if (ap.outfit === 'suit') {
    ctx.globalAlpha = (c.alpha ?? 1) * 0.85;
    ctx.fillRect(x - torsoW / 2 + 1, bodyY + 3, torsoW - 2, 1.4);
    ctx.beginPath();
    ctx.arc(x, bodyY + 8, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = c.alpha ?? 1;
  }

  // Brazos
  const armY = bodyY + 2;
  const armSwing = working ? workSwing * 5 : swing * 3.5;
  ctx.fillStyle = shade(ap.outfitColor, -28);
  roundRect(ctx, x - torsoW / 2 - 3.4, armY + armSwing * 0.35, 4, 10, 2);
  ctx.fill();
  roundRect(ctx, x + torsoW / 2 - 0.6, armY - armSwing * 0.35 + (working ? 2 : 0), 4, 10, 2);
  ctx.fill();
  // Manos
  ctx.fillStyle = ap.body;
  ctx.beginPath();
  ctx.arc(x - torsoW / 2 - 1.4, armY + 10 + armSwing * 0.35, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + torsoW / 2 + 1.4, armY + 10 - armSwing * 0.35 + (working ? 2 : 0), 2.1, 0, Math.PI * 2);
  ctx.fill();

  // Cabeza
  ctx.fillStyle = ap.body;
  ctx.beginPath();
  ctx.arc(x, headY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.arc(x + 2, headY, 6, 0, Math.PI * 2);
  ctx.fill();

  // Cara (sólo si no está de espaldas)
  if (!back) {
    ctx.fillStyle = 'rgba(20,16,12,0.85)';
    const ex = faceLeft ? -2.6 : c.dir === 'right' ? 2.6 : 0;
    ctx.beginPath();
    ctx.arc(x - 2.4 + ex * 0.4, headY - 0.6, 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 2.4 + ex * 0.4, headY - 0.6, 0.95, 0, Math.PI * 2);
    ctx.fill();
    if (tired) {
      ctx.strokeStyle = 'rgba(20,16,12,0.7)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(x, headY + 3.6, 2, Math.PI, 0);
      ctx.stroke();
    }
  }

  // Pelo
  drawHair(ctx, x, headY, ap);

  // Casco / accesorio
  drawHelmet(ctx, x, headY, ap, c.t);

  // Indicador de actividad
  if (working && c.actionProgress !== undefined) {
    drawActionRing(ctx, x, y - 30, c.actionProgress, ap.accent);
  }
  if (tired) {
    ctx.fillStyle = '#fca5a5';
    ctx.font = '700 9px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💤', x + 9, headY - 6 + Math.sin(c.t * 3) * 1.5);
  }

  ctx.restore();
}

function drawHair(ctx: CanvasRenderingContext2D, x: number, hy: number, ap: Appearance) {
  if (ap.hair === 'bald' || ap.helmet === 'welder') return;
  ctx.fillStyle = ap.hairColor;
  switch (ap.hair) {
    case 'short':
      ctx.beginPath();
      ctx.arc(x, hy - 1.5, 7, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - 7, hy - 2, 14, 2.2);
      break;
    case 'long':
      ctx.beginPath();
      ctx.arc(x, hy - 1.5, 7.4, Math.PI, 0);
      ctx.fill();
      roundRect(ctx, x - 8, hy - 2, 3.2, 12, 1.5);
      ctx.fill();
      roundRect(ctx, x + 4.8, hy - 2, 3.2, 12, 1.5);
      ctx.fill();
      break;
    case 'bun':
      ctx.beginPath();
      ctx.arc(x, hy - 1.5, 7, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, hy - 8.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'mohawk':
      ctx.beginPath();
      ctx.moveTo(x - 1.8, hy - 6);
      ctx.lineTo(x, hy - 12);
      ctx.lineTo(x + 1.8, hy - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 1.8, hy - 7.5, 3.6, 4);
      break;
  }
}

function drawHelmet(
  ctx: CanvasRenderingContext2D,
  x: number,
  hy: number,
  ap: Appearance,
  t: number,
) {
  switch (ap.helmet) {
    case 'hardhat':
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(x, hy - 2, 7.4, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - 9, hy - 2.6, 18, 2.4);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x - 1, hy - 9, 2, 6.4);
      break;
    case 'visor':
      ctx.fillStyle = '#0f172a';
      roundRect(ctx, x - 8, hy - 4.5, 16, 5, 2);
      ctx.fill();
      ctx.fillStyle = ap.accent;
      ctx.globalAlpha *= 0.85;
      ctx.fillRect(x - 6.5, hy - 3.4, 13, 2.4);
      ctx.globalAlpha /= 0.85;
      break;
    case 'welder':
      ctx.fillStyle = '#334155';
      roundRect(ctx, x - 7.5, hy - 8, 15, 13, 3);
      ctx.fill();
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(x - 5, hy - 3, 10, 3.4);
      ctx.fillStyle = ap.accent;
      ctx.globalAlpha *= 0.5;
      ctx.fillRect(x - 5, hy - 3, 10, 1);
      ctx.globalAlpha /= 0.5;
      break;
    case 'halo': {
      const pulse = 0.6 + Math.sin(t * 3) * 0.25;
      ctx.strokeStyle = ap.accent;
      ctx.globalAlpha *= pulse;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(x, hy - 11, 7, 2.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha /= pulse;
      break;
    }
  }
}

function drawActionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  color: string,
) {
  ctx.save();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = 'rgba(2,6,23,0.65)';
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();
  ctx.restore();
}

/** Etiqueta con nombre y nivel. Se dibuja aparte para quedar sobre todo. */
export function drawNameTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  name: string,
  level: number,
  isLocal: boolean,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '700 9px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = name.length > 12 ? `${name.slice(0, 11)}…` : name;
  const badge = `${level}`;
  const textW = ctx.measureText(label).width;
  const w = textW + 22;
  const ty = y - 32 * CHARACTER_SCALE;

  ctx.fillStyle = isLocal ? 'rgba(34,211,238,0.16)' : 'rgba(2,6,23,0.62)';
  roundRect(ctx, x - w / 2, ty - 7, w, 13, 6);
  ctx.fill();
  ctx.strokeStyle = isLocal ? 'rgba(34,211,238,0.85)' : 'rgba(148,163,184,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Insignia de nivel
  ctx.fillStyle = isLocal ? '#22d3ee' : '#94a3b8';
  ctx.beginPath();
  ctx.arc(x - w / 2 + 8, ty - 0.5, 5.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#04121a';
  ctx.font = '800 8px "Rajdhani", system-ui, sans-serif';
  ctx.fillText(badge, x - w / 2 + 8, ty);

  ctx.fillStyle = isLocal ? '#e0fbff' : '#cbd5e1';
  ctx.font = '700 9px "Rajdhani", system-ui, sans-serif';
  ctx.fillText(label, x + 5, ty);
  ctx.restore();
}
