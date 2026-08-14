/**
 * Dibujo de enemigos y proyectiles. Estilo coherente con el resto: formas
 * simples, contorno oscuro y un color de acento que identifica al bicho.
 */

import type { Bullet, Enemy } from '../systems/combat';

function roundRect(
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

export function drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[]): void {
  for (const e of enemies) {
    const r = e.def.radius;
    const hover = Math.sin(e.phase) * 2;

    ctx.save();
    // Sombra en el suelo
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + r * 0.9, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    const cy = e.y + (e.def.shape === 'crawler' ? 0 : hover);

    switch (e.def.shape) {
      case 'drone': {
        // Rotores
        ctx.strokeStyle = 'rgba(226,232,240,0.35)';
        ctx.lineWidth = 1.4;
        const blade = r * 1.15 + Math.sin(e.phase * 6) * 1.5;
        ctx.beginPath();
        ctx.moveTo(e.x - blade, cy - r * 0.5);
        ctx.lineTo(e.x + blade, cy - r * 0.5);
        ctx.stroke();
        ctx.fillStyle = e.def.color;
        ctx.beginPath();
        ctx.arc(e.x, cy, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'crawler': {
        // Patas que se mueven
        ctx.strokeStyle = e.def.color;
        ctx.lineWidth = 2.2;
        for (let i = -1; i <= 1; i += 2) {
          for (let k = 0; k < 3; k++) {
            const a = Math.sin(e.phase * 2 + k) * 0.4;
            ctx.beginPath();
            ctx.moveTo(e.x + i * r * 0.5, cy);
            ctx.lineTo(e.x + i * (r + 5), cy + 5 + a * 4);
            ctx.stroke();
          }
        }
        ctx.fillStyle = e.def.color;
        roundRect(ctx, e.x - r, cy - r * 0.7, r * 2, r * 1.4, r * 0.5);
        ctx.fill();
        break;
      }
      case 'brute': {
        ctx.fillStyle = e.def.color;
        roundRect(ctx, e.x - r, cy - r, r * 2, r * 2, r * 0.35);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, e.x - r * 0.2, cy - r, r * 1.2, r * 2, r * 0.35);
        ctx.fill();
        // Placas de chatarra
        ctx.strokeStyle = e.def.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(e.x - r * 0.7, cy - r * 0.2);
        ctx.lineTo(e.x + r * 0.7, cy - r * 0.5);
        ctx.stroke();
        break;
      }
    }

    // Ojo / sensor
    ctx.fillStyle = e.def.accent;
    ctx.beginPath();
    ctx.arc(e.x, cy - r * 0.1, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // Destello al recibir impacto
    if (e.hitFlash > 0) {
      ctx.globalAlpha = e.hitFlash * 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(e.x, cy, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Barra de vida, sólo si está tocado
    if (e.hp < e.maxHp) {
      const w = r * 2.2;
      ctx.fillStyle = 'rgba(2,6,23,0.8)';
      ctx.fillRect(e.x - w / 2, cy - r - 8, w, 3.4);
      ctx.fillStyle = e.def.accent;
      ctx.fillRect(e.x - w / 2, cy - r - 8, w * Math.max(0, e.hp / e.maxHp), 3.4);
    }
    ctx.restore();
  }
}

export function drawBullets(ctx: CanvasRenderingContext2D, bullets: Bullet[]): void {
  ctx.save();
  for (const b of bullets) {
    const speed = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / speed;
    const uy = b.vy / speed;

    switch (b.kind) {
      case 'beam': {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2.6;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(b.x - ux * 16, b.y - uy * 16);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case 'plasma': {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 8);
        g.addColorStop(0, b.color);
        g.addColorStop(1, `${b.color}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'pellet': {
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - ux * 7, b.y - uy * 7);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
