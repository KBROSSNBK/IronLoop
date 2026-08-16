/**
 * DRON DE APOYO — cuadricóptero dibujado por capas.
 *
 * Vuela, así que lleva su sombra separada en el suelo: es lo que hace que se
 * lea la altura de un vistazo, sin necesidad de más artificios.
 */

import { DRONE_ALTITUDE, type DroneStateName } from '../systems/droneBrain';

const TAU = Math.PI * 2;

export interface DroneDrawArgs {
  /** Posición del cuerpo (ya en el aire). */
  x: number;
  y: number;
  facing: number;
  /** Balanceo vertical. */
  bob: number;
  t: number;
  state: DroneStateName;
  color: string;
  accent: string;
  /** Unidades colgando y su icono. */
  load: number;
  loadIcon?: string | null;
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

const LED: Record<DroneStateName, string> = {
  ESPERA: '#4ade80',
  AL_PERRO: '#fbbf24',
  CARGANDO: '#f59e0b',
  AL_DESTINO: '#38bdf8',
  SOLTANDO: '#a78bfa',
};

export function drawDrone(ctx: CanvasRenderingContext2D, a: DroneDrawArgs): void {
  const y = a.y + a.bob;
  const suelo = a.y + DRONE_ALTITUDE;

  ctx.save();
  ctx.globalAlpha = a.alpha ?? 1;

  // Sombra en el suelo, pequeña y difusa: está alto.
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(a.x, suelo, 9, 3, 0, 0, TAU);
  ctx.fill();

  // Brazos y hélices
  const spin = a.t * 40;
  for (let i = 0; i < 4; i++) {
    const dx = i % 2 === 0 ? -11 : 11;
    const dy = i < 2 ? -4 : 4;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, y);
    ctx.lineTo(a.x + dx, y + dy);
    ctx.stroke();

    // Disco de la hélice: girando muy rápido se ve como un borrón.
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.strokeStyle = a.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(a.x + dx, y + dy, 6.5, 2 + Math.sin(spin + i) * 0.6, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Cuerpo
  ctx.fillStyle = a.color;
  roundRect(ctx, a.x - 8, y - 5, 16, 10, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,16,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Óptica frontal
  ctx.fillStyle = '#0b1120';
  ctx.beginPath();
  ctx.arc(a.x + a.facing * 5, y + 1, 2.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = a.accent;
  ctx.globalAlpha = (a.alpha ?? 1) * (0.55 + Math.sin(a.t * 5) * 0.35);
  ctx.beginPath();
  ctx.arc(a.x + a.facing * 5, y + 1, 1.3, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = a.alpha ?? 1;

  // LED de estado
  ctx.fillStyle = LED[a.state] ?? '#4ade80';
  ctx.beginPath();
  ctx.arc(a.x - a.facing * 5, y - 3, 1.6, 0, TAU);
  ctx.fill();

  // Carga colgando de un cable
  if (a.load > 0) {
    ctx.strokeStyle = 'rgba(148,163,184,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, y + 5);
    ctx.lineTo(a.x, y + 11);
    ctx.stroke();

    ctx.fillStyle = '#b45309';
    roundRect(ctx, a.x - 6, y + 11, 12, 8, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(2,6,23,0.7)';
    ctx.stroke();

    ctx.font = '800 9px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(2,6,23,0.9)';
    const txt = `${a.loadIcon ?? ''}${a.load}`;
    ctx.strokeText(txt, a.x, y + 24);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(txt, a.x, y + 24);
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}
