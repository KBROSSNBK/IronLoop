/**
 * RENDER DE MÁQUINAS Y ROBOTS.
 * El estado visual sale de `settleMachine`, así que lo que ves es exactamente
 * lo que hay en la base de datos: si la barra está al 80%, faltan 20% de ciclo.
 */

import { MACHINE_LIST, MACHINE_UPGRADE, type MachineDef } from '../../config/machines';
import { TILE } from '../../config/world';
import { getItem, itemGlyph } from '../../config/items';
import { ROBOTS } from '../../config/robots';
import type { FactoryState, MachineState } from '../../types';
import {settleMachine, type SettleResult } from '../logic/production';
import { ROBOT_STATE_LABEL, type RobotBrain } from '../systems/robotBrain';
import type { Fx } from '../engine/fx';
import { roundRect } from './world';

export interface MachineVisual {
  def: MachineDef;
  state: MachineState;
  settle: SettleResult;
  locked: boolean;
}

export function computeMachineVisuals(
  machines: Record<string, MachineState>,
  factoryLevel: number,
  now: number,
): MachineVisual[] {
  const out: MachineVisual[] = [];
  for (const def of MACHINE_LIST) {
    const state = machines[def.id];
    if (!state) continue;
    const settle = settleMachine(state, def.id, factoryLevel, now);
    out.push({
      def,
      state,
      settle,
      locked: factoryLevel < def.unlockFactoryLevel,
    });
  }
  return out;
}

export function drawMachine(
  ctx: CanvasRenderingContext2D,
  v: MachineVisual,
  time: number,
  fx: Fx,
): void {
  const { def, settle, locked } = v;
  const x = def.tx * TILE;
  const y = def.ty * TILE;
  const w = def.tw * TILE;
  const bodyH = (def.th - 1) * TILE;
  const running = settle.running && !locked;

  ctx.save();
  if (locked) ctx.globalAlpha = 0.38;

  // Sombra proyectada
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, x + 4, y + bodyH - 6, w - 8, 22, 8);
  ctx.fill();

  // Zona de trabajo pintada delante
  ctx.strokeStyle = def.accent;
  ctx.globalAlpha *= locked ? 0.3 : 0.35;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x + 6, y + bodyH + 2, w - 12, TILE - 8);
  ctx.setLineDash([]);
  ctx.globalAlpha /= locked ? 0.3 : 0.35;

  // Cuerpo
  ctx.fillStyle = '#141c2a';
  roundRect(ctx, x, y, w, bodyH, 8);
  ctx.fill();
  ctx.fillStyle = '#212c40';
  roundRect(ctx, x + 3, y + 3, w - 6, bodyH - 6, 6);
  ctx.fill();

  // Paneles
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < def.tw; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * TILE, y + 6);
    ctx.lineTo(x + i * TILE, y + bodyH - 6);
    ctx.stroke();
  }
  // Brillo superior
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, x + 4, y + 4, w - 8, 10, 5);
  ctx.fill();

  // Ventana del núcleo
  const coreX = x + w / 2;
  const coreY = y + bodyH / 2;
  const heat = running ? 0.55 + Math.sin(time * 9) * 0.18 + settle.progress * 0.3 : 0.1;
  ctx.fillStyle = '#05080f';
  roundRect(ctx, coreX - 26, coreY - 16, 52, 30, 5);
  ctx.fill();
  const g = ctx.createRadialGradient(coreX, coreY, 2, coreX, coreY, 30);
  g.addColorStop(0, hexA(def.accent, Math.min(1, heat + 0.25)));
  g.addColorStop(1, hexA(def.accent, 0));
  ctx.fillStyle = g;
  roundRect(ctx, coreX - 26, coreY - 16, 52, 30, 5);
  ctx.fill();

  // Mecanismo animado dentro de la ventana
  ctx.save();
  roundRect(ctx, coreX - 26, coreY - 16, 52, 30, 5);
  ctx.clip();
  if (def.kind === 'smelter') {
    // Llama pulsante
    for (let i = 0; i < 3; i++) {
      const fh = running ? 12 + Math.sin(time * 11 + i * 2) * 6 : 3;
      ctx.fillStyle = hexA(i === 1 ? '#fff1a8' : def.accent, running ? 0.85 : 0.25);
      ctx.beginPath();
      ctx.moveTo(coreX - 12 + i * 12, coreY + 12);
      ctx.quadraticCurveTo(coreX - 16 + i * 12, coreY + 12 - fh, coreX - 6 + i * 12, coreY + 12 - fh);
      ctx.quadraticCurveTo(coreX - 4 + i * 12, coreY + 12 - fh / 2, coreX - 4 + i * 12, coreY + 12);
      ctx.closePath();
      ctx.fill();
    }
  } else if (def.kind === 'assembler') {
    // Engranajes girando
    drawGear(ctx, coreX - 10, coreY, 11, running ? time * 2.4 : 0, def.accent);
    drawGear(ctx, coreX + 12, coreY + 3, 8, running ? -time * 3.2 : 0, '#e2e8f0');
  } else if (def.kind === 'recycler') {
    // Prensa trituradora: dos placas que se juntan y aplastan la chatarra.
    const press = running ? Math.abs(Math.sin(time * 4)) : 0;
    ctx.fillStyle = '#64748b';
    roundRect(ctx, coreX - 20, coreY - 14 + press * 6, 40, 6, 2);
    ctx.fill();
    roundRect(ctx, coreX - 20, coreY + 8 - press * 6, 40, 6, 2);
    ctx.fill();
    // Chatarra aplastándose en medio
    ctx.fillStyle = def.accent;
    ctx.globalAlpha = running ? 0.5 + press * 0.5 : 0.25;
    const squash = 1 - press * 0.6;
    roundRect(ctx, coreX - 12, coreY - 5 * squash, 24, 10 * squash, 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (def.kind === 'fusion') {
    /*
     * Cámara de Singularidad: tres anillos que se cierran sobre un punto
     * blanco y un destello que late. Es la última máquina de la cadena, así
     * que se nota que ahí dentro pasa algo distinto.
     */
    for (let i = 0; i < 3; i++) {
      const cierre = running ? (time * 0.9 + i * 0.33) % 1 : 0.5;
      const r = 24 * (1 - cierre) + 3;
      ctx.strokeStyle = hexA(i === 1 ? '#ffffff' : def.accent, running ? 0.85 - cierre * 0.6 : 0.22);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(coreX, coreY, r, r * 0.55, time * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    const nucleo = running ? 3 + Math.sin(time * 12) * 1.6 : 2;
    const gg = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, nucleo * 4);
    gg.addColorStop(0, hexA('#ffffff', running ? 1 : 0.4));
    gg.addColorStop(0.4, hexA(def.accent, running ? 0.8 : 0.25));
    gg.addColorStop(1, hexA(def.accent, 0));
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(coreX, coreY, nucleo * 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Laboratorio: partículas orbitando
    ctx.strokeStyle = hexA(def.accent, running ? 0.9 : 0.3);
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(coreX, coreY, 20 - i * 5, 9, (time * (0.7 + i * 0.4)) % Math.PI, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (running) {
      const a = time * 3;
      ctx.fillStyle = '#f0abfc';
      ctx.beginPath();
      ctx.arc(coreX + Math.cos(a) * 18, coreY + Math.sin(a) * 8, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Pistón lateral
  const pistonExt = running ? (Math.sin(time * 7) * 0.5 + 0.5) * 8 : 0;
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(x + w - 14, coreY - 4 - pistonExt, 8, 12 + pistonExt);
  ctx.fillStyle = '#475569';
  ctx.fillRect(x + w - 16, coreY + 8, 12, 6);

  // Los buffers muestran el estado SIMULADO (settle), no el último persistido:
  // así el HUD coincide siempre con lo que devolverá la próxima operación.
  const live = settle.state;
  // Una ficha por ingrediente: se ve de un vistazo QUÉ falta y cuánto.
  if (!locked) drawIngredients(ctx, x, y + bodyH - 34, w, def, live);

  // Barra de progreso
  const bw = w - 24;
  ctx.fillStyle = 'rgba(2,6,23,0.8)';
  roundRect(ctx, x + 12, y - 12, bw, 8, 4);
  ctx.fill();
  ctx.fillStyle = running ? def.accent : '#475569';
  roundRect(ctx, x + 13, y - 11, Math.max(2, (bw - 2) * settle.progress), 6, 3);
  ctx.fill();
  if (running) {
    ctx.fillStyle = hexA('#ffffff', 0.55);
    roundRect(ctx, x + 13, y - 11, Math.max(2, (bw - 2) * settle.progress), 2.5, 1.5);
    ctx.fill();
  }

  // Rótulo holográfico
  ctx.font = '800 11px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = locked ? '#64748b' : def.accent;
  ctx.fillText(`${def.icon} ${def.short}`, x + w / 2, y - 22);

  // Receta en una línea: qué entra y qué sale por cada ciclo.
  if (!locked) drawRecipeLine(ctx, x + w / 2, y - 38, def);

  // Nivel de la máquina (pips)
  if (!locked && live.level > 0) {
    const pips = Math.min(live.level, MACHINE_UPGRADE.maxLevel);
    ctx.fillStyle = '#fbbf24';
    for (let i = 0; i < pips; i++) {
      ctx.fillRect(x + 12 + i * 5, y - 30, 3.4, 5);
    }
    ctx.font = '700 9px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Mk${live.level + 1}`, x + 12 + pips * 5 + 4, y - 27);
  }

  // LED de estado
  const led = locked ? '#64748b' : running ? '#4ade80' : settle.blocked === 'output-full' ? '#f87171' : '#fbbf24';
  ctx.fillStyle = led;
  ctx.globalAlpha *= running ? 0.6 + Math.sin(time * 6) * 0.4 : 1;
  ctx.beginPath();
  ctx.arc(x + w - 12, y + 12, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = locked ? 0.38 : 1;

  if (locked) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '800 12px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🔒 NIVEL ${def.unlockFactoryLevel}`, x + w / 2, y + bodyH / 2 + 26);
  }

  ctx.restore();

  // Humo cuando trabaja (fuera del alpha de bloqueo)
  if (running && Math.random() < 0.35) {
    fx.smoke(x + w * 0.28, y - 4, 'rgba(190,200,215,1)');
  }
  if (running && settle.progress > 0.94 && Math.random() < 0.2) {
    fx.burst(coreX, coreY, def.accent, 3, 40, 'spark');
  }
}

/**
 * Receta de un ciclo, en una línea: `2×🧿 + 1×🔋 + 2×⬜ = 1×💠`.
 *
 * Es la pregunta que todo el mundo se hace al plantarse delante de una máquina
 * («¿esto qué come?»), así que se responde ahí mismo y sin abrir ningún panel.
 */
function drawRecipeLine(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  def: MachineDef,
): void {
  const ins = Object.entries(def.input);
  const outs = Object.entries(def.output);
  if (ins.length === 0 || outs.length === 0) return;

  const part = (list: [string, number | undefined][]) =>
    list.map(([id, n]) => `${n ?? 1}×${itemGlyph(id)}`).join(' + ');
  const text = `${part(ins)} = ${part(outs)}`;

  ctx.save();
  ctx.font = '700 10px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const wBox = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(2,6,23,0.72)';
  roundRect(ctx, cx - wBox / 2, y - 9, wBox, 18, 5);
  ctx.fill();
  ctx.strokeStyle = hexA(def.accent, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(text, cx, y + 0.5);
  ctx.restore();
}

/**
 * Una ficha por ingrediente (`icono  tiene/necesita`) y otra por producto.
 *
 * Antes había un único contador con el icono del PRIMER ingrediente y la suma
 * de todos: con el Reactor cargado de titanio ponía «◉ 52», que es justo lo
 * contrario de la verdad — parecía que sobraba aleación cuando lo que faltaba
 * era todo menos titanio. Ahora cada material va por separado y en verde o en
 * rojo según llegue o no para un ciclo.
 */
function drawIngredients(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  def: MachineDef,
  live: MachineState,
): void {
  const ins = Object.entries(def.input);
  const outs = Object.entries(def.output);
  const chipW = 42;
  const gap = 3;
  const arrow = 12;
  const total = ins.length * (chipW + gap) + arrow + outs.length * (chipW + gap);
  let cx = x + Math.max(6, (w - total) / 2);

  ctx.save();
  ctx.textBaseline = 'middle';

  for (const [id, need] of ins) {
    const have = live.input[id] ?? 0;
    const ok = have >= (need ?? 1);
    chip(ctx, cx, y, chipW, itemGlyph(id), `${have}/${need}`, ok ? '#4ade80' : '#f87171', ok);
    cx += chipW + gap;
  }

  ctx.font = '800 12px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(148,163,184,0.75)';
  ctx.fillText('→', cx + arrow / 2, y + 12);
  cx += arrow;

  for (const [id] of outs) {
    const have = live.output[id] ?? 0;
    chip(ctx, cx, y, chipW, itemGlyph(id), String(have), '#38bdf8', have > 0);
    cx += chipW + gap;
  }
  ctx.restore();
}

/** Ficha compacta: icono arriba-izquierda y cifra a la derecha. */
function chip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  icon: string,
  text: string,
  color: string,
  on: boolean,
): void {
  ctx.fillStyle = 'rgba(2,6,23,0.78)';
  roundRect(ctx, x, y, w, 24, 4);
  ctx.fill();
  ctx.strokeStyle = hexA(color, on ? 0.75 : 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '11px "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(icon, x + 3, y + 12.5);

  ctx.font = '800 11px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = on ? '#e2e8f0' : color;
  ctx.fillText(text, x + w - 4, y + 12.5);
}

function drawGear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  color: string,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  const teeth = 8;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.74;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0b1220';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Robots de transporte. Sólo se dibujan los que la fábrica ha comprado de
 * verdad: así ver un robot patrullando significa que alguien lo pagó y que
 * está moviendo material, no que se alcanzó cierto nivel.
 */
export function drawRobots(
  ctx: CanvasRenderingContext2D,
  factory: FactoryState,
  brains: Map<string, RobotBrain>,
  time: number,
): void {
  for (const def of ROBOTS) {
    const state = factory.robots?.[def.id];
    if (!state || state.level <= 0) continue;
    const brain = brains.get(def.id);
    if (!brain) continue;

    const x = brain.x;
    const y = brain.y;
    const moving =
      brain.state === 'TRANSPORTAR' ||
      brain.state === 'VOLVER' ||
      brain.state === 'IR_A_ORIGEN';
    const busy = brain.state === 'CARGAR' || brain.state === 'DEPOSITAR';
    const facingX = brain.state === 'VOLVER' || brain.state === 'IR_A_ORIGEN' ? -1 : 1;
    // Traqueteo al rodar; quieto mientras carga o espera.
    const bob = moving ? Math.sin(time * 18) * 0.8 : 0;
    const py = y + bob;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 13, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Chasis
    ctx.fillStyle = '#2b3648';
    roundRect(ctx, x - 13, py - 8, 26, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#3d4a63';
    roundRect(ctx, x - 11, py - 6, 22, 8, 3);
    ctx.fill();

    // Carga: sólo cuando de verdad lleva algo encima.
    if (brain.carrying > 0) {
      const lift = busy ? Math.abs(Math.sin(time * 9)) * 3 : 0;
      const item = getItem(def.item);
      const carry = brain.carrying;
      ctx.fillStyle = '#b45309';
      roundRect(ctx, x - 7, py - 15 - lift, 14, 9, 2);
      ctx.fill();
      ctx.fillStyle = item.color;
      ctx.fillRect(x - 7, py - 11.5 - lift, 14, 2.4);
      ctx.font = '8px "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.icon, x, py - 16 - lift);

      // Cuántas unidades lleva en este viaje: sube al mejorar el robot.
      ctx.font = '800 9px "Rajdhani", system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(2,6,23,0.9)';
      ctx.strokeText(`×${carry}`, x + 13, py - 12 - lift);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`×${carry}`, x + 13, py - 12 - lift);
    }

    // Brazo elevador durante la carga/descarga
    if (busy) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + facingX * 9, py - 4);
      ctx.lineTo(x + facingX * (13 + Math.abs(Math.sin(time * 9)) * 4), py - 9);
      ctx.stroke();
    }

    // Sensor: ámbar esperando, rojo recalculando, verde trabajando.
    const idle = brain.state === 'IDLE';
    const recovering = brain.state === 'RECUPERANDO';
    ctx.fillStyle = recovering ? '#f87171' : idle ? '#fbbf24' : '#4ade80';
    ctx.globalAlpha = 0.55 + Math.sin(time * (idle ? 2.5 : 8)) * 0.4;
    ctx.beginPath();
    ctx.arc(x + facingX * 8, py - 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Ruedas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 12, py + 8, 7, 4);
    ctx.fillRect(x + 5, py + 8, 7, 4);

    // Estado actual: lo que el robot está haciendo de verdad.
    ctx.fillStyle = recovering
      ? 'rgba(248,113,113,0.9)'
      : idle
        ? 'rgba(251,191,36,0.85)'
        : 'rgba(148,163,184,0.75)';
    ctx.font = '700 8px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ROBOT_STATE_LABEL[brain.state], x, py - 18);
    ctx.restore();
  }
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
