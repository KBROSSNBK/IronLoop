/**
 * Partículas y números flotantes.
 * Todo el "jugo" visual pasa por aquí: chispas, humo, anillos de energía,
 * +$ y +XP. Diseñado con arrays planos y reutilización para no generar basura.
 */

export type ParticleKind = 'spark' | 'smoke' | 'ring' | 'shard' | 'glow';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: ParticleKind;
  gravity: number;
  spin: number;
  angle: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
  /** Clave de agrupación: los avisos del mismo grupo se suman en uno solo. */
  group?: string;
  /** Total acumulado del grupo. */
  total?: number;
}

const MAX_PARTICLES = 420;

export class Fx {
  particles: Particle[] = [];
  texts: FloatingText[] = [];

  burst(
    x: number,
    y: number,
    color: string,
    count = 12,
    power = 90,
    kind: ParticleKind = 'spark',
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const s = power * (0.35 + Math.random() * 0.85);
      const max = kind === 'smoke' ? 0.9 + Math.random() * 0.7 : 0.35 + Math.random() * 0.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - (kind === 'smoke' ? 26 : 0),
        life: max,
        max,
        size: kind === 'smoke' ? 4 + Math.random() * 5 : 1.4 + Math.random() * 2.4,
        color,
        kind,
        gravity: kind === 'smoke' ? -22 : 210,
        spin: (Math.random() - 0.5) * 8,
        angle: Math.random() * Math.PI,
      });
    }
  }

  ring(x: number, y: number, color: string, size = 10): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, size, color,
      kind: 'ring', gravity: 0, spin: 0, angle: 0,
    });
  }

  /** Humo continuo de una chimenea/máquina. */
  smoke(x: number, y: number, color = 'rgba(180,190,205,1)'): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const max = 1.2 + Math.random() * 0.8;
    this.particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y,
      vx: (Math.random() - 0.5) * 10,
      vy: -18 - Math.random() * 14,
      life: max,
      max,
      size: 3 + Math.random() * 4,
      color,
      kind: 'smoke',
      gravity: -10,
      spin: 0,
      angle: 0,
    });
  }

  /**
   * Texto flotante.
   *
   * `group` permite que varios avisos del mismo tipo (todo el mineral que vas
   * picando, todo el dinero de una tanda de ventas) se junten en UNO que va
   * sumando, en vez de escupir diez cifras encimadas que no se leen. Los que
   * no se pueden sumar salen en columna, cada uno un poco más arriba que el
   * anterior, para que tampoco se tapen entre ellos.
   */
  float(
    x: number,
    y: number,
    text: string,
    color = '#ffffff',
    size = 13,
    group?: { key: string; amount: number; render: (total: number) => string },
  ): void {
    if (group) {
      const live = this.texts.find((t) => t.group === group.key && t.life > 0.45);
      if (live) {
        live.total = (live.total ?? 0) + group.amount;
        live.text = group.render(live.total);
        live.life = live.max;
        return;
      }
    }

    // Reparto en columna: cada aviso reciente empuja al siguiente hacia arriba.
    const recientes = this.texts.filter((t) => t.life > t.max * 0.72).length;
    const lift = Math.min(recientes, 4) * 15;

    this.texts.push({
      x,
      y: y - lift,
      vy: -42,
      life: 1.15,
      max: 1.15,
      text,
      color,
      size,
      group: group?.key,
      total: group?.amount,
    });
    if (this.texts.length > 40) this.texts.shift();
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 1 - 1.6 * dt;
      p.angle += p.spin * dt;
      if (p.kind === 'ring') p.size += 90 * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= 1 - 1.4 * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'ring') {
        ctx.globalAlpha = a * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5 * a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (p.kind === 'smoke') {
        ctx.globalAlpha = a * 0.26;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * a + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawTexts(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const a = Math.min(1, t.life / t.max * 1.6);
      ctx.globalAlpha = a;
      ctx.font = `800 ${t.size}px "Rajdhani", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(3,7,18,0.9)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
  }
}
