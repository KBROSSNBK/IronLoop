/**
 * MASCOTA CUADRÚPEDA — dibujada por capas, sin sprites.
 *
 * El movimiento es el de un cuadrúpedo de verdad: trote diagonal (pata
 * delantera izquierda con trasera derecha), rodillas de dos segmentos con
 * cinemática inversa y el cuerpo bombeando con el paso. Las patas del lado
 * lejano se pintan primero y más oscuras, que es lo que da la sensación de
 * volumen sin salir del canvas 2D.
 *
 * Añadir un chasis nuevo = añadir un caso en `drawShell` + una entrada en
 * `config/pets.ts`.
 */

import { getChassis, type PetChassisDef } from '../../config/pets';
import type { PetStateName } from '../systems/petBrain';

const TAU = Math.PI * 2;

export interface PetDrawArgs {
  /** Punto de apoyo: los pies quedan justo aquí. */
  x: number;
  y: number;
  facing: number;
  /** Fase del paso en vueltas completas. */
  gait: number;
  /** Tiempo global en segundos (para luces y detalles). */
  t: number;
  state: PetStateName;
  chassis: string;
  color: string;
  accent: string;
  /** Unidades que lleva encima y capacidad total. */
  carried: number;
  capacity: number;
  /** Item predominante en su mochila. */
  carryIcon?: string | null;
  carryColor?: string | null;
  alpha?: number;
  /** Nombre del dueño, para las mascotas ajenas. */
  label?: string | null;
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

function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `rgb(${r},${g},${b})`;
}

/** Rodilla de una pata de dos segmentos. `bend` = hacia dónde se dobla. */
function kneePoint(
  hx: number,
  hy: number,
  fx: number,
  fy: number,
  seg: number,
  bend: number,
): { x: number; y: number } {
  const dx = fx - hx;
  const dy = fy - hy;
  const raw = Math.hypot(dx, dy) || 0.001;
  // Nunca se estira del todo: una pata perfectamente recta parece rota.
  const d = Math.min(raw, seg * 1.94);
  const ux = dx / raw;
  const uy = dy / raw;
  const h = Math.sqrt(Math.max(0, seg * seg - (d / 2) * (d / 2)));
  const mx = hx + ux * (d / 2);
  const my = hy + uy * (d / 2);
  return { x: mx - uy * h * bend, y: my + ux * h * bend };
}

interface LegPose {
  /** Posición del pie en coordenadas locales. */
  fx: number;
  fy: number;
  /** Altura sobre el suelo, 0..1 (para la sombra del pie). */
  lift: number;
}

function legPose(restX: number, phase: number, stride: number, lift: number, planted: boolean): LegPose {
  if (planted) return { fx: restX, fy: 0, lift: 0 };
  const ph = phase * TAU;
  const up = Math.max(0, Math.sin(ph));
  return {
    fx: restX - Math.cos(ph) * stride,
    fy: -up * lift,
    lift: up,
  };
}

/** Una pata completa: cadera, fémur, tibia y pie. */
function drawLeg(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  pose: LegPose,
  seg: number,
  bend: number,
  metal: string,
  joint: string,
  far: boolean,
) {
  const knee = kneePoint(hipX, hipY, pose.fx, pose.fy, seg, bend);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Fémur: barra gruesa. Tibia: más fina, como en los cuadrúpedos reales.
  ctx.strokeStyle = metal;
  ctx.lineWidth = far ? 4 : 4.8;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(knee.x, knee.y);
  ctx.stroke();

  ctx.lineWidth = far ? 2.8 : 3.4;
  ctx.beginPath();
  ctx.moveTo(knee.x, knee.y);
  ctx.lineTo(pose.fx, pose.fy);
  ctx.stroke();

  // Rodilla y pezuña de goma.
  ctx.fillStyle = joint;
  ctx.beginPath();
  ctx.arc(knee.x, knee.y, far ? 2.1 : 2.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0b1120';
  ctx.beginPath();
  ctx.ellipse(pose.fx, pose.fy, far ? 2.4 : 3, far ? 1.5 : 1.9, 0, 0, TAU);
  ctx.fill();
}

/** Carcasa del cuerpo. Cada chasis tiene su silueta. */
function drawShell(
  ctx: CanvasRenderingContext2D,
  def: PetChassisDef,
  color: string,
  accent: string,
  bodyY: number,
  t: number,
) {
  const L = def.build.body;
  const H = def.build.height;
  const r = 2 + def.build.round * (H / 2 - 1);
  const dark = shade(color, -58);
  const light = shade(color, 34);

  // Sombra interna bajo el chasis: separa el cuerpo de las patas.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, -L / 2 + 1, bodyY + H - 3, L - 2, 4, 2);
  ctx.fill();

  // Cuerpo principal.
  const grad = ctx.createLinearGradient(0, bodyY, 0, bodyY + H);
  grad.addColorStop(0, light);
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  roundRect(ctx, -L / 2, bodyY, L, H, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,16,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  switch (def.id) {
    case 'spot': {
      // Franja negra del costado y rejilla de ventilación: la silueta de obra.
      ctx.fillStyle = def.accent;
      roundRect(ctx, -L / 2 + 2, bodyY + H * 0.52, L - 4, H * 0.4, 1.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-L / 2 + 5 + i * 3.2, bodyY + H * 0.6, 1.4, H * 0.22);
      }
      // Asa superior.
      ctx.strokeStyle = shade(color, -30);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, bodyY + 0.5);
      ctx.lineTo(-4, bodyY - 2.5);
      ctx.lineTo(5, bodyY - 2.5);
      ctx.lineTo(5, bodyY + 0.5);
      ctx.stroke();
      break;
    }
    case 'go2': {
      // Carcasa lisa con un corte diagonal y la matrícula "02".
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, -L / 2 + 3, bodyY + 1.5, L * 0.55, H * 0.3, 1.5);
      ctx.fill();
      ctx.fillStyle = def.accent;
      roundRect(ctx, -L / 2 + 2.5, bodyY + H * 0.58, L * 0.34, H * 0.3, 1.2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(L * 0.16, bodyY + H * 0.35, L * 0.2, 1.6);
      ctx.globalAlpha = 1;
      break;
    }
    case 'hound': {
      // Aleta dorsal y tira luminosa que late.
      ctx.fillStyle = shade(color, -20);
      ctx.beginPath();
      ctx.moveTo(-L * 0.22, bodyY);
      ctx.lineTo(-L * 0.02, bodyY - 5);
      ctx.lineTo(L * 0.2, bodyY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.6 + Math.sin(t * 3.4) * 0.3;
      roundRect(ctx, -L / 2 + 3, bodyY + H * 0.45, L - 6, 2, 1);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
  }
}

/** Cabeza-sensor, al frente del cuerpo. */
function drawHead(
  ctx: CanvasRenderingContext2D,
  def: PetChassisDef,
  color: string,
  accent: string,
  hx: number,
  hy: number,
  dip: number,
  t: number,
  led: string,
) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(dip);

  const w = def.id === 'hound' ? 11 : 10;
  const h = def.build.height * 0.82;

  ctx.fillStyle = shade(color, 18);
  roundRect(ctx, -w * 0.4, -h / 2, w, h, def.id === 'go2' ? h / 2 : 2.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(4,8,16,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Placa frontal oscura con la óptica.
  ctx.fillStyle = def.accent;
  roundRect(ctx, w * 0.18, -h / 2 + 1, w * 0.42, h - 2, 1.8);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.55 + Math.sin(t * 4) * 0.35;
  ctx.beginPath();
  ctx.arc(w * 0.39, 0, 1.9, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // LED de estado: se lee de un vistazo qué está haciendo.
  ctx.fillStyle = led;
  ctx.globalAlpha = 0.6 + Math.sin(t * 7) * 0.35;
  roundRect(ctx, -w * 0.3, -h / 2 + 1.2, 3.6, 1.6, 0.8);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (def.id === 'go2') {
    // Cúpula de lidar.
    ctx.fillStyle = shade(color, -34);
    ctx.beginPath();
    ctx.arc(0, -h / 2, 2.6, Math.PI, TAU);
    ctx.fill();
  }
  if (def.id === 'spot') {
    // Antena corta, como el mástil del modelo de obra.
    ctx.strokeStyle = shade(color, -40);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-w * 0.2, -h / 2);
    ctx.lineTo(-w * 0.32, -h / 2 - 4.5);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(-w * 0.32, -h / 2 - 5, 1.2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

const LED_BY_STATE: Record<PetStateName, string> = {
  SEGUIR: '#4ade80',
  IR_A_VETA: '#38bdf8',
  MINAR: '#fbbf24',
  VOLVER: '#22d3ee',
  DESCARGAR: '#a78bfa',
};

export function drawPet(ctx: CanvasRenderingContext2D, a: PetDrawArgs): void {
  const def = getChassis(a.chassis);
  const color = a.color || def.color;
  const accent = a.accent || '#22d3ee';
  const seg = def.build.leg;
  const H = def.build.height;
  const L = def.build.body;

  const moving = a.state === 'IR_A_VETA' || a.state === 'VOLVER' || a.state === 'SEGUIR';
  const mining = a.state === 'MINAR';
  const gait = a.gait;

  // Altura de reposo: las patas nunca se estiran del todo.
  const stand = seg * 1.62;
  // El cuerpo sube y baja dos veces por ciclo: es lo que "vende" el trote.
  const bob = moving ? Math.sin(gait * TAU * 2) * 1.1 : Math.sin(a.t * 1.8) * 0.35;
  // Cabeceo: se inclina hacia donde va.
  const pitch = moving ? Math.sin(gait * TAU) * 0.045 : 0;
  const bodyTop = -stand - H + bob;

  // Golpe de perforadora: el morro baja y el cuerpo se agacha un poco.
  const strike = mining ? Math.max(0, Math.sin(a.t * 7.5)) : 0;
  const crouch = mining ? 1.6 + strike * 1.8 : 0;

  ctx.save();
  ctx.globalAlpha = a.alpha ?? 1;

  // Sombra en el suelo, más difusa cuanto más alto está el cuerpo.
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(a.x, a.y + 1, L * 0.52, 4.4, 0, 0, TAU);
  ctx.fill();

  ctx.translate(a.x, a.y + crouch);
  ctx.scale(a.facing >= 0 ? 1 : -1, 1);

  const stride = moving ? 8.5 : 0;
  const lift = moving ? 6 : 0;
  const hipFront = L * 0.34;
  const hipRear = -L * 0.34;
  const hipY = bodyTop + H - 1;

  // Trote: diagonales en fase (delantera izq. + trasera der.).
  const phFL = gait;
  const phBR = gait;
  const phFR = gait + 0.5;
  const phBL = gait + 0.5;

  // Al minar, la pata delantera cercana rasca el suelo.
  const scratch = mining ? Math.sin(a.t * 7.5) * 3.5 : 0;

  const metalFar = shade(color, -70);
  const metalNear = shade(color, -24);
  const jointFar = shade(def.accent, 10);
  const jointNear = accent;

  /* ── Patas del lado lejano (más oscuras y un pelín arriba) ── */
  ctx.save();
  ctx.translate(-2.2, -2.6);
  drawLeg(ctx, hipFront, hipY, legPose(hipFront, phFR, stride, lift, !moving), seg, 1, metalFar, jointFar, true);
  drawLeg(ctx, hipRear, hipY, legPose(hipRear, phBL, stride, lift, !moving), seg, -1, metalFar, jointFar, true);
  ctx.restore();

  /* ── Cadera: los actuadores cilíndricos que tienen estos bichos ── */
  ctx.fillStyle = shade(color, -46);
  ctx.beginPath();
  ctx.ellipse(hipFront, hipY - 1, 3.4, 3.9, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hipRear, hipY - 1, 3.4, 3.9, 0, 0, TAU);
  ctx.fill();

  /* ── Cuerpo ── */
  ctx.save();
  ctx.rotate(pitch);
  drawShell(ctx, def, color, accent, bodyTop, a.t);

  // Carga a la espalda: sólo si de verdad lleva algo.
  if (a.carried > 0) {
    const ratio = Math.max(0, Math.min(1, a.carried / Math.max(1, a.capacity)));
    // Bancada: la caja va atornillada al lomo, no flotando encima.
    ctx.fillStyle = shade(color, -52);
    roundRect(ctx, -7.5, bodyTop - 1.5, 15, 3, 1);
    ctx.fill();
    ctx.fillStyle = '#b45309';
    roundRect(ctx, -6.5, bodyTop - 7, 13, 6.5, 1.6);
    ctx.fill();
    ctx.fillStyle = a.carryColor ?? '#e2e8f0';
    ctx.fillRect(-6.5, bodyTop - 4.6, 13 * ratio, 2.1);
    ctx.strokeStyle = 'rgba(2,6,23,0.7)';
    ctx.lineWidth = 1;
    roundRect(ctx, -6.5, bodyTop - 7, 13, 6.5, 1.6);
    ctx.stroke();
  }
  ctx.restore();

  /* ── Cabeza ── */
  drawHead(
    ctx,
    def,
    color,
    accent,
    L * 0.5 + 2,
    bodyTop + H * 0.42 + (mining ? 2.5 + strike * 1.5 : 0),
    pitch + (mining ? 0.42 + strike * 0.18 : 0),
    a.t,
    LED_BY_STATE[a.state] ?? '#4ade80',
  );

  /* ── Patas del lado cercano ── */
  const front = legPose(hipFront, phFL, stride, lift, !moving);
  drawLeg(
    ctx,
    hipFront,
    hipY,
    mining ? { fx: front.fx + 4 + scratch, fy: -Math.abs(scratch) * 0.5, lift: 0 } : front,
    seg,
    1,
    metalNear,
    jointNear,
    false,
  );
  drawLeg(ctx, hipRear, hipY, legPose(hipRear, phBR, stride, lift, !moving), seg, -1, metalNear, jointNear, false);

  ctx.restore();

  /* ── Números y etiquetas: fuera del scale, para no salir del revés ── */
  if (a.carried > 0) {
    ctx.save();
    ctx.font = '800 9px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const text = `${a.carryIcon ?? ''}${a.carried}/${a.capacity}`;
    const ty = a.y - stand - H - 12;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(2,6,23,0.9)';
    ctx.strokeText(text, a.x, ty);
    ctx.fillStyle = a.carried >= a.capacity ? '#fbbf24' : '#e2e8f0';
    ctx.fillText(text, a.x, ty);
    ctx.restore();
  }

  if (a.label) {
    ctx.save();
    ctx.font = '700 8.5px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(148,163,184,0.75)';
    ctx.fillText(a.label, a.x, a.y + 12);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}
