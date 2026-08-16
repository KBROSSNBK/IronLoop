/**
 * Personaje modular dibujado por capas — sin sprites externos.
 * Añadir una skin nueva = añadir un caso aquí + una opción en config/cosmetics.
 * Origen (x, y) = cadera; los pies quedan en y + 15.
 */

import type { Appearance, ActivityKind, FacingDir } from '../../types';
import { getEmote } from '../../config/emotes';

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
  /** Emote en curso (id de config/emotes). */
  emote?: string | null;
  /** Segundos transcurridos desde que empezó el emote. */
  emoteElapsed?: number;
}

/** Deformaciones que aplica un emote al cuerpo. */
interface EmotePose {
  hop: number;
  tilt: number;
  shakeX: number;
  armL: number;
  armR: number;
  legSpread: number;
}

const NO_POSE: EmotePose = { hop: 0, tilt: 0, shakeX: 0, armL: 0, armR: 0, legSpread: 0 };

/** Postura del golpe de recolección. */
interface MiningPose {
  active: boolean;
  /** Ángulo del pico en radianes: negativo = levantado. */
  swing: number;
  /** Inclinación del torso al acompañar el golpe. */
  lean: number;
  /** 0..1, intensidad del destello de impacto. */
  impact: number;
}

function miningPose(active: boolean, progress: number, t: number): MiningPose {
  if (!active) return { active: false, swing: 0, lean: 0, impact: 0 };
  // Si no hay progreso (acción muy corta), se usa un ciclo por tiempo.
  const p = progress > 0 ? Math.min(1, progress) : (t * 1.4) % 1;

  if (p < 0.45) {
    // Preparación: el pico sube con desaceleración.
    const k = p / 0.45;
    const ease = 1 - Math.pow(1 - k, 2);
    return { active: true, swing: -1.15 * ease, lean: -0.06 * ease, impact: 0 };
  }
  if (p < 0.6) {
    // Golpe: baja rápido y acelerando.
    const k = (p - 0.45) / 0.15;
    const ease = k * k;
    return { active: true, swing: -1.15 + 1.85 * ease, lean: -0.06 + 0.2 * ease, impact: ease };
  }
  // Recuperación: vuelve a la guardia.
  const k = (p - 0.6) / 0.4;
  const ease = 1 - Math.pow(1 - k, 3);
  return {
    active: true,
    swing: 0.7 * (1 - ease),
    lean: 0.14 * (1 - ease),
    impact: Math.max(0, 1 - k * 4),
  };
}

function emotePose(anim: string, t: number): EmotePose {
  switch (anim) {
    case 'dance': {
      // Cadera que se balancea, salto en contratiempo y brazos alternos:
      // simple de calcular pero muy legible desde lejos.
      const beat = t * 7.2;
      return {
        hop: Math.abs(Math.sin(beat)) * 4.5,
        tilt: Math.sin(beat * 0.5) * 0.2,
        shakeX: Math.sin(beat * 0.5) * 2.5,
        armL: Math.max(0, Math.sin(beat)) * 11,
        armR: Math.max(0, Math.sin(beat + Math.PI)) * 11,
        legSpread: Math.abs(Math.sin(beat * 0.5)) * 2.5,
      };
    }
    case 'jump':
      return { ...NO_POSE, hop: Math.max(0, Math.sin(t * 6.5)) * 11, armL: 9, armR: 9 };
    case 'wave':
      return { ...NO_POSE, armR: 12 + Math.sin(t * 13) * 3, tilt: 0.05 };
    case 'shake':
      return { ...NO_POSE, shakeX: Math.sin(t * 26) * 2.2, tilt: Math.sin(t * 26) * 0.05 };
    default:
      return NO_POSE;
  }
}

/**
 * Cuña en el suelo que apunta a donde mira el personaje.
 * Se dibuja antes que el cuerpo para que quede debajo, como parte de la sombra.
 */
function drawFacingWedge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: FacingDir,
  accent: string,
  moving: boolean,
): void {
  const ang: Record<FacingDir, number> = {
    right: 0,
    down: Math.PI / 2,
    left: Math.PI,
    up: -Math.PI / 2,
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang[dir]);
  ctx.globalAlpha *= moving ? 0.85 : 0.55;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(6, -3.4);
  ctx.lineTo(6, 3.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
  heavy: '#4b5563',
  rocket: '#334155',
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
  const tired = c.act === 'tired';

  /**
   * Golpe de pico en tres tiempos en lugar de un temblor continuo:
   * levantar (0–45%), impactar (45–60%) y recuperarse (60–100%).
   * El progreso viene de la acción real, así que el golpe cae justo cuando
   * se obtiene el material.
   */
  const mine = miningPose(c.act === 'gather', c.actionProgress ?? 0, c.t);
  const workSwing = c.act === 'work' ? Math.sin(c.t * 14) : 0;

  const emoteDef = getEmote(c.emote);
  const emoteT = c.emoteElapsed ?? 0;
  const emoting = !!emoteDef && emoteT < emoteDef.durationMs / 1000;
  const pose = emoting ? emotePose(emoteDef.anim, emoteT) : NO_POSE;

  ctx.save();
  ctx.globalAlpha = c.alpha ?? 1;
  // Escalado alrededor de la cadera: el resto del dibujo usa coordenadas de mundo.
  ctx.translate(x, y);
  ctx.scale(CHARACTER_SCALE, CHARACTER_SCALE);
  ctx.translate(-x, -y);

  // Sombra: se queda en el suelo aunque el personaje salte.
  ctx.fillStyle = `rgba(0,0,0,${0.38 - pose.hop * 0.015})`;
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 10 - pose.hop * 0.2, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // El aura va DEBAJO del cuerpo: nunca tapa la cara ni lo que estás haciendo.
  drawAura(ctx, x, y, ap, c.t, false);

  // Cuña de orientación pegada a los pies. Es la señal más barata y más
  // legible de hacia dónde miras: en vista cenital el cuerpo apenas cambia
  // entre izquierda y derecha, y sin esto no se sabe a qué vas a interactuar.
  // Mirando hacia arriba iría justo debajo del cuerpo, tapada, así que en ese
  // caso se pinta al final y por encima de la cabeza.
  const wedgeArriba = c.dir === 'up';
  if (!wedgeArriba) drawFacingWedge(ctx, x, y + 16, c.dir, ap.accent, moving);

  // El emote inclina, sacude y levanta el cuerpo (la sombra ya está pintada).
  if (emoting) {
    ctx.translate(x + pose.shakeX, y - pose.hop);
    ctx.rotate(pose.tilt);
    ctx.translate(-x, -y);
  } else if (mine.active) {
    // Al picar, el cuerpo acompaña el golpe en vez de deslizarse.
    ctx.translate(x, y);
    ctx.rotate(mine.lean);
    ctx.translate(-x, -y);
  }

  const bodyY = y - 8 - bob;
  const headY = y - 15 - bob;
  const faceLeft = c.dir === 'left';
  const back = c.dir === 'up';
  const perfil = c.dir === 'left' || c.dir === 'right';

  /**
   * De perfil el cuerpo se dibuja MIRANDO A LA DERECHA y se espeja cuando toca.
   * Así izquierda y derecha son de verdad simétricas —el brazo adelantado, el
   * sombreado y el pico cambian de lado— en vez de ser el mismo dibujo con
   * los ojos movidos dos píxeles.
   */
  if (faceLeft) {
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    ctx.translate(-x, 0);
  }

  // Piernas
  const legColor = ap.outfit === 'suit' ? shade(ap.outfitColor, -50) : '#26303f';
  ctx.fillStyle = legColor;
  const legOffset = swing * 3;
  const sp = pose.legSpread;
  roundRect(ctx, x - 6 - sp, y + 4 - bob, 5, 11 + legOffset * 0.3, 2);
  ctx.fill();
  roundRect(ctx, x + 1 + sp, y + 4 - bob, 5, 11 - legOffset * 0.3, 2);
  ctx.fill();

  // Calzado
  ctx.fillStyle = SHOE_COLORS[ap.shoes] ?? '#3b2a1d';
  roundRect(ctx, x - 7 - sp, y + 13 - bob + legOffset * 0.25, 6.5, 4, 1.6);
  ctx.fill();
  roundRect(ctx, x + 0.5 + sp, y + 13 - bob - legOffset * 0.25, 6.5, 4, 1.6);
  ctx.fill();
  if (ap.shoes === 'servo') {
    ctx.fillStyle = ap.accent;
    ctx.fillRect(x - 7 - sp, y + 16 - bob, 6.5, 1);
    ctx.fillRect(x + 0.5 + sp, y + 16 - bob, 6.5, 1);
  } else if (ap.shoes === 'heavy') {
    // Puntera reforzada: se ve pesada aunque ocupe cuatro píxeles.
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(x - 7.5 - sp, y + 13 - bob, 2.4, 4);
    ctx.fillRect(x + 5.5 + sp, y + 13 - bob, 2.4, 4);
  } else if (ap.shoes === 'rocket') {
    // Llama de los propulsores; parpadea con el paso.
    const f = 2.5 + Math.abs(Math.sin(c.t * 14)) * 2.5;
    ctx.fillStyle = '#fbbf24';
    ctx.globalAlpha = (c.alpha ?? 1) * 0.85;
    ctx.beginPath();
    ctx.ellipse(x - 4 - sp, y + 18 - bob, 2, f, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 4 + sp, y + 18 - bob, 2, f, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ap.accent;
    ctx.globalAlpha = (c.alpha ?? 1) * 0.6;
    ctx.beginPath();
    ctx.ellipse(x - 4 - sp, y + 17 - bob, 1.1, f * 0.6, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 4 + sp, y + 17 - bob, 1.1, f * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = c.alpha ?? 1;
  }

  // Brazo del lado LEJANO: de perfil va detrás del torso y más oscuro, que
  // es lo que hace que se lea la profundidad y hacia dónde mira.
  const armYFar = bodyY + 2 + (moving ? -swing * 3.5 * 0.35 : 0);
  if (perfil) {
    ctx.fillStyle = shade(ap.outfitColor, -55);
    roundRect(ctx, x - 5, armYFar, 4, 10, 2);
    ctx.fill();
  }

  // Torso — de perfil es más estrecho.
  const torsoW = perfil ? 13 : 17;
  ctx.fillStyle = ap.outfitColor;
  roundRect(ctx, x - torsoW / 2, bodyY, torsoW, 14, 4);
  ctx.fill();
  // Sombreado lateral para dar volumen
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(ctx, x + 2, bodyY, torsoW / 2 - 2, 14, 4);
  ctx.fill();

  // Mochila: sólo se ve por detrás, y es lo que distingue "de espaldas" de
  // "de frente" sin tener que fijarse en la cara.
  if (back) {
    ctx.fillStyle = shade(ap.outfitColor, -45);
    roundRect(ctx, x - 6.5, bodyY + 1.5, 13, 10, 3);
    ctx.fill();
    ctx.fillStyle = ap.accent;
    ctx.fillRect(x - 4.5, bodyY + 4.5, 9, 1.6);
  }

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
  } else if (ap.outfit === 'hazmat') {
    // Capucha sellada y ventana de visor: el traje se reconoce al instante.
    ctx.fillStyle = shade(ap.outfitColor, 22);
    roundRect(ctx, x - torsoW / 2 - 1, bodyY - 2, torsoW + 2, 6, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(15,23,42,0.55)';
    roundRect(ctx, x - 5, bodyY + 5, 10, 5, 2);
    ctx.fill();
    ctx.fillStyle = ap.accent;
    ctx.fillRect(x - 5, bodyY + 5, 10, 1.2);
    // Franjas de peligro en el pecho
    ctx.fillStyle = 'rgba(250,204,21,0.85)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 6 + i * 4.5, bodyY + 11, 2.4, 2.4);
  } else if (ap.outfit === 'armor') {
    // Placas: hombreras, peto y remaches.
    ctx.fillStyle = shade(ap.outfitColor, 30);
    roundRect(ctx, x - torsoW / 2 - 2, bodyY - 1, 6, 6, 2);
    ctx.fill();
    roundRect(ctx, x + torsoW / 2 - 4, bodyY - 1, 6, 6, 2);
    ctx.fill();
    ctx.fillStyle = shade(ap.outfitColor, -25);
    roundRect(ctx, x - 6, bodyY + 4, 12, 8, 2);
    ctx.fill();
    ctx.fillStyle = ap.accent;
    for (const px of [-4.5, 0, 4.5]) {
      ctx.beginPath();
      ctx.arc(x + px, bodyY + 8, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (ap.outfit === 'hoodie') {
    // Capucha caída por la espalda y cordones.
    ctx.fillStyle = shade(ap.outfitColor, -22);
    ctx.beginPath();
    ctx.ellipse(x, bodyY + 1, torsoW / 2 + 1, 4, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = ap.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 2, bodyY + 3);
    ctx.lineTo(x - 2.6, bodyY + 9);
    ctx.moveTo(x + 2, bodyY + 3);
    ctx.lineTo(x + 2.6, bodyY + 9);
    ctx.stroke();
    // Bolsillo central
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(ctx, x - 5, bodyY + 8, 10, 4.5, 2);
    ctx.fill();
  }

  // Brazos
  const armY = bodyY + 2;
  const armSwing = working ? workSwing * 5 : swing * 3.5;
  // Al picar, ambos brazos suben juntos siguiendo el mango del pico.
  const mineLift = mine.active ? -mine.swing * 5 : 0;
  const armLY = armY + armSwing * 0.35 - pose.armL - mineLift;
  const armRY = armY - armSwing * 0.35 + (working ? 2 : 0) - pose.armR - mineLift;
  ctx.fillStyle = shade(ap.outfitColor, -28);
  if (perfil) {
    // De perfil sólo se ve el brazo cercano, y va por delante del torso.
    roundRect(ctx, x + 1, armRY, 4.4, 10, 2);
    ctx.fill();
    ctx.fillStyle = ap.body;
    ctx.beginPath();
    ctx.arc(x + 3.2, armRY + 10, 2.1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    roundRect(ctx, x - torsoW / 2 - 3.4, armLY, 4, 10, 2);
    ctx.fill();
    roundRect(ctx, x + torsoW / 2 - 0.6, armRY, 4, 10, 2);
    ctx.fill();
    // Manos
    ctx.fillStyle = ap.body;
    ctx.beginPath();
    ctx.arc(x - torsoW / 2 - 1.4, armLY + 10, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + torsoW / 2 + 1.4, armRY + 10, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cabeza
  ctx.fillStyle = ap.body;
  ctx.beginPath();
  ctx.arc(x, headY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.arc(x + 2, headY, 6, 0, Math.PI * 2);
  ctx.fill();

  // Cara (sólo si no está de espaldas). De perfil se ve un ojo y la nariz.
  if (!back) {
    ctx.fillStyle = 'rgba(20,16,12,0.85)';
    if (perfil) {
      ctx.beginPath();
      ctx.arc(x + 2.2, headY - 0.6, 1, 0, Math.PI * 2);
      ctx.fill();
      // Perfil de la nariz: remata la silueta y deja claro el lado.
      ctx.fillStyle = shade(ap.body, -22);
      ctx.beginPath();
      ctx.moveTo(x + 6, headY - 1.6);
      ctx.lineTo(x + 8.4, headY + 0.4);
      ctx.lineTo(x + 6, headY + 1.8);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x - 2.4, headY - 0.6, 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 2.4, headY - 0.6, 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
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

  // Pico: se dibuja después del cuerpo para que quede en primer plano.
  if (mine.active) {
    // El cuerpo ya está espejado si mira a la izquierda, así que aquí el pico
    // siempre va al lado derecho del dibujo.
    const side = 1;
    const px = x + side * 9;
    const py = armY + 3;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(side * (mine.swing - 0.5));
    // Mango
    ctx.strokeStyle = '#8a5522';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 15);
    ctx.stroke();
    // Cabeza del pico
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-5.5, 1.5);
    ctx.quadraticCurveTo(0, -2.5, 5.5, 1.5);
    ctx.stroke();
    ctx.restore();

    // Destello de impacto en el punto de golpe
    if (mine.impact > 0.05) {
      ctx.save();
      ctx.globalAlpha = mine.impact * 0.9;
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 1.6;
      const ix = x + side * 17;
      const iy = y + 6;
      for (let i = 0; i < 4; i++) {
        const a = -0.9 + i * 0.5 + side * 0.2;
        ctx.beginPath();
        ctx.moveTo(ix, iy);
        ctx.lineTo(ix + Math.cos(a) * (6 + mine.impact * 7), iy + Math.sin(a) * (6 + mine.impact * 7));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // La parte del aura que va por delante (satélites cercanos, interferencia).
  drawAura(ctx, x, y, ap, c.t, true);

  // Mirando hacia arriba, la cuña va sobre la cabeza: en el suelo quedaría
  // detrás del propio cuerpo y no se vería.
  if (wedgeArriba) drawFacingWedge(ctx, x, headY - 16, 'up', ap.accent, moving);

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
    case 'ponytail':
      ctx.beginPath();
      ctx.arc(x, hy - 1.5, 7, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - 7, hy - 2, 14, 2);
      // La coleta cae por detrás y se mueve un poco al andar.
      ctx.beginPath();
      ctx.moveTo(x - 6, hy - 3);
      ctx.quadraticCurveTo(x - 11, hy + 3, x - 8.5, hy + 10);
      ctx.quadraticCurveTo(x - 6, hy + 4, x - 4, hy - 2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'afro':
      ctx.beginPath();
      ctx.arc(x, hy - 3, 9.6, 0, Math.PI * 2);
      ctx.fill();
      // Un par de mordiscos para que no sea un círculo perfecto.
      ctx.fillStyle = shade(ap.hairColor, 18);
      ctx.beginPath();
      ctx.arc(x - 4, hy - 6, 3.6, 0, Math.PI * 2);
      ctx.arc(x + 4.5, hy - 5, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'spiky':
      ctx.beginPath();
      ctx.arc(x, hy - 1.5, 7, Math.PI, 0);
      ctx.fill();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 3 - 1.6, hy - 4);
        ctx.lineTo(x + i * 3 + Math.sign(i) * 1.5, hy - 11 + Math.abs(i) * 1.6);
        ctx.lineTo(x + i * 3 + 1.6, hy - 4);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'braids':
      ctx.beginPath();
      ctx.arc(x, hy - 1.5, 7.2, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - 7.2, hy - 2, 14.4, 2);
      // Dos trenzas a los lados, con sus nudos.
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x + s * 7.6, hy + 1 + i * 3.4, 2 - i * 0.25, 0, Math.PI * 2);
          ctx.fill();
        }
      }
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
    case 'cap':
      ctx.fillStyle = ap.accent;
      ctx.beginPath();
      ctx.arc(x, hy - 2, 7.2, Math.PI, 0);
      ctx.fill();
      // Visera hacia delante (el cuerpo ya está espejado si mira a la izq.).
      ctx.beginPath();
      ctx.ellipse(x + 4, hy - 2, 6.5, 2, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x - 7, hy - 3.4, 14, 1.4);
      break;
    case 'headset':
      // Diadema + almohadillas: silueta muy reconocible desde lejos.
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x, hy - 1, 8, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      roundRect(ctx, x - 9.6, hy - 3, 3.6, 6, 1.6);
      ctx.fill();
      roundRect(ctx, x + 6, hy - 3, 3.6, 6, 1.6);
      ctx.fill();
      ctx.fillStyle = ap.accent;
      ctx.beginPath();
      ctx.arc(x + 7.8, hy, 1.1, 0, Math.PI * 2);
      ctx.fill();
      // Micrófono
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 7.8, hy + 2.6);
      ctx.quadraticCurveTo(x + 7, hy + 6, x + 3, hy + 5.6);
      ctx.stroke();
      break;
    case 'crown': {
      const brillo = 0.75 + Math.sin(t * 4) * 0.25;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(x - 7, hy - 4);
      ctx.lineTo(x - 7, hy - 10);
      ctx.lineTo(x - 3.5, hy - 6.5);
      ctx.lineTo(x, hy - 11.5);
      ctx.lineTo(x + 3.5, hy - 6.5);
      ctx.lineTo(x + 7, hy - 10);
      ctx.lineTo(x + 7, hy - 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ap.accent;
      ctx.globalAlpha *= brillo;
      ctx.beginPath();
      ctx.arc(x, hy - 6, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha /= brillo;
      break;
    }
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

/**
 * AURA — el efecto que envuelve al personaje.
 *
 * Se dibuja DEBAJO del cuerpo (salvo las que deben verse por delante) para
 * que nunca tape la cara ni lo que estás haciendo. Todo se deriva del tiempo:
 * no guarda partículas, así que no cuesta memoria ni se desincroniza entre
 * jugadores.
 */
function drawAura(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ap: Appearance,
  t: number,
  front: boolean,
): void {
  const TAU = Math.PI * 2;
  const cy = y - 8;

  switch (ap.aura) {
    case 'sparks': {
      if (front) return;
      for (let i = 0; i < 7; i++) {
        const a = t * 1.6 + i * (TAU / 7);
        const r = 13 + Math.sin(t * 3 + i) * 3;
        const px = x + Math.cos(a) * r;
        const py = cy + Math.sin(a) * (r * 0.42);
        ctx.globalAlpha = 0.45 + Math.abs(Math.sin(t * 4 + i)) * 0.55;
        ctx.fillStyle = ap.accent;
        ctx.fillRect(px - 1.1, py - 1.1, 2.2, 2.2);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'embers': {
      if (front) return;
      // Brasas que suben y se apagan; el ciclo se deriva del tiempo.
      for (let i = 0; i < 9; i++) {
        const k = (t * 0.55 + i / 9) % 1;
        const px = x + Math.sin(i * 3.1 + t * 1.4) * 9;
        const py = y + 12 - k * 30;
        ctx.globalAlpha = (1 - k) * 0.75;
        ctx.fillStyle = k < 0.4 ? '#fbbf24' : '#f87171';
        ctx.beginPath();
        ctx.arc(px, py, 1.5 * (1 - k * 0.6), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'ring': {
      if (front) return;
      const pulse = (t * 0.7) % 1;
      for (const off of [0, 0.5]) {
        const k = (pulse + off) % 1;
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = ap.accent;
        ctx.lineWidth = 2.8 - k * 1.4;
        ctx.beginPath();
        ctx.ellipse(x, y + 15, 8 + k * 16, 3 + k * 6, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'orbit': {
      // Tres satélites: los de detrás van al fondo y los de delante encima.
      for (let i = 0; i < 3; i++) {
        const a = t * 1.9 + i * (TAU / 3);
        const delante = Math.sin(a) > 0;
        if (delante !== front) continue;
        const px = x + Math.cos(a) * 15;
        const py = cy + Math.sin(a) * 5 - 2;
        ctx.globalAlpha = delante ? 0.95 : 0.45;
        ctx.fillStyle = ap.accent;
        ctx.beginPath();
        ctx.arc(px, py, 2.1, 0, TAU);
        ctx.fill();
        ctx.globalAlpha *= 0.4;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'glitch': {
      if (!front) return;
      // Franjas horizontales desplazadas: parece una señal con interferencia.
      for (let i = 0; i < 3; i++) {
        const yy = cy - 12 + ((t * 26 + i * 13) % 30);
        const w = 8 + Math.sin(t * 20 + i) * 6;
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = i % 2 === 0 ? ap.accent : '#f472b6';
        ctx.fillRect(x - w / 2 + Math.sin(t * 30 + i) * 3, yy, w, 1.6);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'ash': {
      if (front) return;
      for (let i = 0; i < 10; i++) {
        const k = (t * 0.3 + i / 10) % 1;
        const px = x + Math.sin(i * 2.3 + t * 0.6) * 13;
        const py = cy - 16 + k * 34;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.5;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(px, py, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'shadow': {
      if (front) return;
      // Una sombra que respira debajo, más grande y más oscura de lo normal.
      const s = 1 + Math.sin(t * 2) * 0.12;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#0b1120';
      ctx.beginPath();
      ctx.ellipse(x, y + 16, 15 * s, 5.5 * s, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = ap.accent;
      ctx.beginPath();
      ctx.ellipse(x, y + 16, 11 * s, 4 * s, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
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

/**
 * Bocadillo del emote. Se dibuja después de la iluminación, junto a la
 * etiqueta de nombre, para que se lea siempre.
 */
export function drawEmoteBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  emoteId: string,
  elapsed: number,
): void {
  const def = getEmote(emoteId);
  if (!def) return;
  const total = def.durationMs / 1000;
  if (elapsed < 0 || elapsed > total) return;

  // Entrada con rebote y salida desvaneciéndose.
  const inT = Math.min(1, elapsed / 0.22);
  const pop = 1 + Math.sin(inT * Math.PI) * 0.35;
  const fade = elapsed > total - 0.4 ? Math.max(0, (total - elapsed) / 0.4) : 1;
  const float = Math.sin(elapsed * 3) * 2;
  const by = y - 66 + float;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(x, by);
  ctx.scale(pop, pop);

  // Bocadillo
  ctx.fillStyle = 'rgba(8,14,26,0.92)';
  roundRectPath(ctx, -15, -14, 30, 26, 8);
  ctx.fill();
  ctx.strokeStyle = def.particle ?? 'rgba(148,163,184,0.5)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Pico
  ctx.beginPath();
  ctx.moveTo(-4, 11);
  ctx.lineTo(0, 17);
  ctx.lineTo(4, 11);
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,14,26,0.92)';
  ctx.fill();

  ctx.font = '17px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.icon, 0, -1);
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  roundRect(ctx, x, y, w, h, r);
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
