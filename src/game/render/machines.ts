/**
 * RENDER DE MÁQUINAS Y ROBOTS.
 * El estado visual sale de `settleMachine`, así que lo que ves es exactamente
 * lo que hay en la base de datos: si la barra está al 80%, faltan 20% de ciclo.
 */

import { MACHINE_LIST, MACHINE_UPGRADE, type MachineDef } from '../../config/machines';
import { TILE } from '../../config/world';
import { getItem } from '../../config/items';
import { ROBOTS } from '../../config/robots';
import type { FactoryState, MachineState } from '../../types';
import { fillRatio, settleMachine, type SettleResult } from '../logic/production';
import { robotHasWork, robotVisual } from '../logic/robots';
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
  // Tolva de entrada (izquierda)
  drawBuffer(ctx, x + 8, y + bodyH - 30, def.input, live.input, def.inputCap, '#38bdf8', 'IN');
  // Salida (derecha)
  drawBuffer(
    ctx,
    x + w - 52,
    y + bodyH - 30,
    def.output,
    live.output,
    def.outputCap,
    '#4ade80',
    'OUT',
  );

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

function drawBuffer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  recipe: Partial<Record<string, number>>,
  buffer: Record<string, number>,
  cap: number,
  color: string,
  label: string,
) {
  const items = Object.keys(recipe);
  ctx.save();
  ctx.fillStyle = 'rgba(2,6,23,0.72)';
  roundRect(ctx, x, y, 44, 24, 4);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '700 7px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = hexA(color, 0.8);
  ctx.fillText(label, x + 3, y + 2);

  const total = items.reduce((a, i) => a + (buffer[i] ?? 0), 0);
  const first = items[0];
  ctx.font = '800 11px "Rajdhani", system-ui, sans-serif';
  ctx.fillStyle = total > 0 ? '#e2e8f0' : '#475569';
  ctx.fillText(`${first ? getItem(first).icon : ''}${total}`, x + 3, y + 10);

  // Barra de referencia. La capacidad es ilimitada, así que al pasar de la
  // referencia se muestra llena en color de acento, nunca en rojo de "lleno".
  const ratio = fillRatio(total, cap);
  ctx.fillStyle = 'rgba(148,163,184,0.2)';
  ctx.fillRect(x + 3, y + 20, 38, 2.4);
  ctx.fillStyle = color;
  ctx.fillRect(x + 3, y + 20, 38 * ratio, 2.4);
  ctx.restore();
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
  time: number,
): void {
  for (const def of ROBOTS) {
    const state = factory.robots?.[def.id];
    if (!state || state.level <= 0) continue;

    const hasWork = robotHasWork(factory, def);
    const v = robotVisual(def, hasWork, time);
    const { x, y } = v;
    const facingX = v.dx !== 0 ? v.dx : 1;
    const busy = v.phase === 'loading' || v.phase === 'unloading';
    // Traqueteo al rodar; quieto mientras carga o espera.
    const bob = v.phase === 'outbound' || v.phase === 'returning' ? Math.sin(time * 18) * 0.8 : 0;
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
    if (v.carrying) {
      const lift = busy ? Math.abs(Math.sin(time * 9)) * 3 : 0;
      const item = getItem(def.item);
      ctx.fillStyle = '#b45309';
      roundRect(ctx, x - 7, py - 15 - lift, 14, 9, 2);
      ctx.fill();
      ctx.fillStyle = item.color;
      ctx.fillRect(x - 7, py - 11.5 - lift, 14, 2.4);
      ctx.font = '8px "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.icon, x, py - 16 - lift);
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

    // Sensor: verde trabajando, ámbar esperando material.
    ctx.fillStyle = v.phase === 'idle' ? '#fbbf24' : '#4ade80';
    ctx.globalAlpha = 0.55 + Math.sin(time * (v.phase === 'idle' ? 2.5 : 8)) * 0.4;
    ctx.beginPath();
    ctx.arc(x + facingX * 8, py - 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Ruedas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 12, py + 8, 7, 4);
    ctx.fillRect(x + 5, py + 8, 7, 4);

    if (v.phase === 'idle') {
      ctx.fillStyle = 'rgba(251,191,36,0.85)';
      ctx.font = '700 8px "Rajdhani", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SIN MATERIAL', x, py - 18);
    }
    ctx.restore();
  }
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
