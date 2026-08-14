/**
 * COMBATE AUTOMÁTICO — simulación local.
 *
 * El arma dispara sola a lo más cercano dentro de su alcance. Los enemigos
 * persiguen al jugador y le drenan estamina al tocarlo. Nada de esto viaja
 * por red: cada jugador tiene sus propios enemigos, así que no hay entidades
 * que sincronizar ni dos jugadores disputándose el mismo objetivo.
 *
 * Lo único que sí es autoritativo es la XP, que se acumula aquí y se envía
 * al servidor por tandas (`opCombatReward`), con tope por envío.
 */

import { COMBAT, enemyHp, rollEnemy, type EnemyDef } from '../../config/enemies';
import type { DerivedWeapon } from '../../config/weapons';
import { getSolids, rectsOverlap } from '../world/geometry';
import { WORLD_H, WORLD_W } from '../../config/world';

export interface Enemy {
  id: number;
  def: EnemyDef;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Para la animación: patas, alas, etc. */
  phase: number;
  /** Destello al recibir un impacto. */
  hitFlash: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  color: string;
  kind: DerivedWeapon['def']['bullet'];
}

export interface CombatEvents {
  /** Enemigos destruidos en este tick. */
  kills: { x: number; y: number; xp: number; color: string }[];
  /** Impactos, para chispas. */
  hits: { x: number; y: number; color: string }[];
  /** Estamina drenada en este tick. */
  drain: number;
  /** Ha disparado el arma (para el sonido). */
  fired: boolean;
}

const EMPTY: CombatEvents = { kills: [], hits: [], drain: 0, fired: false };

/** ¿Ese punto está dentro de un muro o máquina? */
function blocked(x: number, y: number, r: number): boolean {
  const box = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
  return getSolids().some((s) => rectsOverlap(box, s));
}

export class Combat {
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  /** XP ganada y aún no enviada al servidor. */
  pendingXp = 0;
  /** Enemigos destruidos en total (para métricas y misiones futuras). */
  kills = 0;

  private nextId = 1;
  private spawnTimer = 0;
  private fireTimer = 0;

  reset(): void {
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.spawnTimer = 0;
    this.fireTimer = 0;
  }

  /** Vacía la XP acumulada para enviarla. */
  takeXp(): number {
    const xp = Math.min(this.pendingXp, COMBAT.maxXpPerFlush);
    this.pendingXp = Math.max(0, this.pendingXp - xp);
    return Math.floor(xp);
  }

  private spawn(px: number, py: number, playerLevel: number): void {
    if (this.enemies.length >= COMBAT.maxAlive) return;
    const def = rollEnemy(playerLevel);
    // Aparece en un anillo alrededor del jugador, buscando un hueco libre.
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = COMBAT.spawnDistance * (0.8 + Math.random() * 0.5);
      const x = px + Math.cos(a) * d;
      const y = py + Math.sin(a) * d;
      if (x < 60 || y < 60 || x > WORLD_W - 60 || y > WORLD_H - 60) continue;
      if (blocked(x, y, def.radius)) continue;
      const hp = enemyHp(def, playerLevel);
      this.enemies.push({
        id: this.nextId++,
        def,
        x,
        y,
        hp,
        maxHp: hp,
        phase: Math.random() * Math.PI * 2,
        hitFlash: 0,
      });
      return;
    }
  }

  /**
   * Avanza la simulación.
   * @param gathering si el jugador está recolectando (aparecen más).
   */
  update(
    dt: number,
    px: number,
    py: number,
    playerLevel: number,
    weapon: DerivedWeapon,
    gathering: boolean,
    enabled: boolean,
  ): CombatEvents {
    if (!enabled || playerLevel < COMBAT.fromPlayerLevel) {
      if (this.enemies.length > 0 || this.bullets.length > 0) this.reset();
      return EMPTY;
    }

    // Un frame muy largo (pestaña en segundo plano, tirón de CPU) no debe
    // teletransportar a nadie ni atravesar paredes: se acota el paso.
    dt = Math.min(dt, 0.05);

    const events: CombatEvents = { kills: [], hits: [], drain: 0, fired: false };

    /* ── aparición ── */
    this.spawnTimer += dt * 1000;
    const every = COMBAT.spawnEveryMs * (gathering ? 1 : COMBAT.idleSpawnMultiplier);
    if (this.spawnTimer >= every) {
      this.spawnTimer = 0;
      this.spawn(px, py, playerLevel);
    }

    /* ── enemigos ── */
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.phase += dt * 6;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 4);

      const dx = px - e.x;
      const dy = py - e.y;
      const dist = Math.hypot(dx, dy) || 1;

      if (dist > COMBAT.despawnDistance) {
        this.enemies.splice(i, 1);
        continue;
      }

      const touching = dist < e.def.radius + 14;
      if (touching) {
        events.drain += e.def.drain * dt;
      } else {
        // Avance simple con deslizamiento: si el eje principal choca,
        // prueba el otro. Suficiente para no quedarse clavado en una esquina.
        const step = e.def.speed * dt;
        const nx = e.x + (dx / dist) * step;
        const ny = e.y + (dy / dist) * step;
        if (!blocked(nx, e.y, e.def.radius)) e.x = nx;
        else if (!blocked(e.x, ny, e.def.radius)) e.y = ny;
        if (!blocked(e.x, ny, e.def.radius)) e.y = ny;
        else if (!blocked(nx, e.y, e.def.radius)) e.x = nx;
      }
    }

    /* ── disparo automático ── */
    this.fireTimer -= dt * 1000;
    if (this.fireTimer <= 0) {
      let best: Enemy | null = null;
      let bestD = weapon.range;
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - px, e.y - py);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      if (best) {
        this.fireTimer = weapon.fireRateMs;
        events.fired = true;
        const base = Math.atan2(best.y - py, best.x - px);
        const n = weapon.projectiles;
        for (let i = 0; i < n; i++) {
          const offset = n === 1 ? 0 : (i / (n - 1) - 0.5) * weapon.spread;
          const a = base + offset + (Math.random() - 0.5) * 0.03;
          this.bullets.push({
            x: px,
            y: py - 6,
            vx: Math.cos(a) * weapon.speed,
            vy: Math.sin(a) * weapon.speed,
            life: weapon.range / weapon.speed,
            damage: weapon.damage,
            color: weapon.def.color,
            kind: weapon.def.bullet,
          });
        }
      }
    }

    /* ── proyectiles ── */
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.bullets.splice(i, 1);
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (blocked(b.x, b.y, 2)) {
        this.bullets.splice(i, 1);
        continue;
      }

      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (Math.hypot(e.x - b.x, e.y - b.y) > e.def.radius) continue;
        e.hp -= b.damage;
        e.hitFlash = 1;
        events.hits.push({ x: b.x, y: b.y, color: b.color });
        this.bullets.splice(i, 1);
        if (e.hp <= 0) {
          this.enemies.splice(j, 1);
          this.kills += 1;
          this.pendingXp += e.def.xp;
          events.kills.push({ x: e.x, y: e.y, xp: e.def.xp, color: e.def.accent });
        }
        break;
      }
    }

    return events;
  }
}
