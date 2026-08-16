/**
 * DRON DE APOYO — cuadricóptero dibujado por capas.
 *
 * Vuela, así que lleva su sombra separada en el suelo: es lo que hace que se
 * lea la altura de un vistazo, sin necesidad de más artificios. El chasis se
 * inclina hacia donde tira y las hélices se difuminan con el giro, que es lo
 * que separa un dron de un icono moviéndose por la pantalla.
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
  /** Inclinación del chasis, en radianes. */
  tilt?: number;
  t: number;
  state: DroneStateName;
  color: string;
  accent: string;
  /** Unidades colgando y su icono. */
  load: number;
  loadIcon?: string | null;
  loadColor?: string | null;
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
  AL_ORIGEN: '#fbbf24',
  CARGANDO: '#f59e0b',
  AL_DESTINO: '#38bdf8',
  SOLTANDO: '#a78bfa',
};

/** Posiciones de los cuatro rotores, en el sistema local del chasis. */
const ROTORES: [number, number][] = [
  [-11, -4.5],
  [11, -4.5],
  [-11, 4.5],
  [11, 4.5],
];

export function drawDrone(ctx: CanvasRenderingContext2D, a: DroneDrawArgs): void {
  const y = a.y + a.bob;
  const suelo = a.y + DRONE_ALTITUDE;
  const alpha = a.alpha ?? 1;
  const tilt = a.tilt ?? 0;

  ctx.save();
  ctx.globalAlpha = alpha;

  /* — sombra: se encoge y se aclara con la altura — */
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.beginPath();
  ctx.ellipse(a.x, suelo, 9.5, 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(a.x, suelo, 14, 4.6, 0, 0, TAU);
  ctx.fill();

  /* — todo el chasis gira con la inclinación — */
  ctx.save();
  ctx.translate(a.x, y);
  ctx.rotate(tilt);

  const spin = a.t * 46;
  for (let i = 0; i < ROTORES.length; i++) {
    const [dx, dy] = ROTORES[i];

    // Brazo con reborde: se lee incluso sobre suelo claro.
    ctx.strokeStyle = 'rgba(8,12,20,0.75)';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dx * 0.92, dy * 0.92);
    ctx.stroke();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dx * 0.92, dy * 0.92);
    ctx.stroke();

    // Góndola del motor.
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.ellipse(dx, dy, 2.6, 2, 0, 0, TAU);
    ctx.fill();

    // Disco de la hélice: dos aros desfasados dan la sensación de borrón.
    const fase = spin + i * 1.7;
    ctx.save();
    ctx.globalAlpha = alpha * 0.42;
    ctx.strokeStyle = a.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 6.8, 2.1 + Math.sin(fase) * 0.5, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.2;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 5.2, 1.5 + Math.cos(fase * 0.8) * 0.4, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* — cuerpo — */
  const grad = ctx.createLinearGradient(0, -6, 0, 6);
  grad.addColorStop(0, a.color);
  grad.addColorStop(1, 'rgba(8,12,22,0.85)');
  ctx.fillStyle = grad;
  roundRect(ctx, -8.5, -5.5, 17, 11, 3.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,16,0.65)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Franja de color del dueño, para distinguir escuadrillas de un vistazo.
  ctx.fillStyle = a.accent;
  ctx.globalAlpha = alpha * 0.85;
  roundRect(ctx, -8.5, -1.2, 17, 2.2, 1);
  ctx.fill();
  ctx.globalAlpha = alpha;

  // Óptica frontal con destello.
  const fx = a.facing * 5.2;
  ctx.fillStyle = '#0b1120';
  ctx.beginPath();
  ctx.arc(fx, 1, 2.8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = a.accent;
  ctx.globalAlpha = alpha * (0.55 + Math.sin(a.t * 5) * 0.35);
  ctx.beginPath();
  ctx.arc(fx, 1, 1.4, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;

  // LED de estado, atrás.
  ctx.fillStyle = LED[a.state] ?? '#4ade80';
  ctx.beginPath();
  ctx.arc(-a.facing * 5.4, -3.2, 1.7, 0, TAU);
  ctx.fill();

  ctx.restore(); // fin de la inclinación

  /* — carga colgando: cuelga en vertical aunque el chasis se incline — */
  if (a.load > 0) {
    const cuelga = Math.sin(a.t * 3.1) * 1.6;
    ctx.strokeStyle = 'rgba(148,163,184,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, y + 5);
    ctx.lineTo(a.x + cuelga * 0.4, y + 12);
    ctx.stroke();

    const cx = a.x + cuelga * 0.4;
    const cy = y + 12;
    ctx.fillStyle = 'rgba(8,12,22,0.9)';
    roundRect(ctx, cx - 8.5, cy, 17, 10, 2.5);
    ctx.fill();
    ctx.strokeStyle = a.loadColor ?? '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = '700 9px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`${a.loadIcon ?? '📦'}${a.load}`, cx, cy + 5.4);
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}
