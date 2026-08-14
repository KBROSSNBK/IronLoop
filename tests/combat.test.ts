import { describe, expect, it } from 'vitest';
import { Combat } from '../src/game/systems/combat';
import { COMBAT, ENEMIES, enemyHp, rollEnemy } from '../src/config/enemies';
import {
  DEFAULT_WEAPON,
  WEAPONS,
  WEAPON_STATS,
  deriveWeapon,
  weaponStatCost,
} from '../src/config/weapons';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'u1', displayName: 'T', photoURL: null, email: null }, T0),
  ...over,
});
const factory = (): FactoryState => createFactoryState('f1', 1, T0);

/** Avanza la simulación N segundos en pasos de 1/60. */
function run(c: Combat, seconds: number, level = 10, gathering = true) {
  const w = deriveWeapon(DEFAULT_WEAPON);
  let kills = 0;
  let drain = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const ev = c.update(1 / 60, 700, 700, level, w, gathering, true);
    kills += ev.kills.length;
    drain += ev.drain;
  }
  return { kills, drain };
}

describe('armas', () => {
  it('todas tienen id y coste coherentes, y la inicial es gratis', () => {
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
    expect(WEAPONS[0].cost).toBe(0);
    expect(WEAPONS[0].id).toBe(DEFAULT_WEAPON.type);
  });

  it('el DPS sube al mejorar el daño', () => {
    const base = deriveWeapon(DEFAULT_WEAPON);
    const mejor = deriveWeapon({ ...DEFAULT_WEAPON, damage: 5 });
    expect(mejor.damage).toBeGreaterThan(base.damage);
    expect(mejor.dps).toBeGreaterThan(base.dps);
  });

  it('el DPS sube al mejorar la cadencia', () => {
    const base = deriveWeapon(DEFAULT_WEAPON);
    const mejor = deriveWeapon({ ...DEFAULT_WEAPON, rate: 5 });
    expect(mejor.fireRateMs).toBeLessThan(base.fireRateMs);
    expect(mejor.dps).toBeGreaterThan(base.dps);
  });

  it('el multiproyectil añade proyectiles reales', () => {
    const base = deriveWeapon(DEFAULT_WEAPON);
    const mejor = deriveWeapon({ ...DEFAULT_WEAPON, multishot: 3 });
    expect(mejor.projectiles).toBe(base.projectiles + 3);
    expect(mejor.dps).toBeGreaterThan(base.dps);
  });

  it('la cadencia tiene un suelo: no se vuelve instantánea', () => {
    const extremo = deriveWeapon({ ...DEFAULT_WEAPON, rate: 99 });
    expect(extremo.fireRateMs).toBeGreaterThanOrEqual(70);
  });

  it('armas posteriores pegan más que la pistola inicial', () => {
    const pistola = deriveWeapon({ ...DEFAULT_WEAPON, type: 'pistol' });
    const rifle = deriveWeapon({ ...DEFAULT_WEAPON, type: 'rifle' });
    expect(rifle.dps).toBeGreaterThan(pistola.dps);
  });
});

describe('compra de armas y mejoras', () => {
  it('mejorar el daño cuesta dinero y sube el nivel', () => {
    const p = player({ money: 10 ** 6, level: 40 });
    const cost = weaponStatCost(WEAPON_STATS.damage, 0);
    const out = runOp('buyWeaponStat', p, factory(), { stat: 'damage', now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(10 ** 6 - cost);
    expect(out.player!.weapon.damage).toBe(1);
    // Y el efecto es real, no cosmético.
    expect(deriveWeapon(out.player!.weapon).dps).toBeGreaterThan(
      deriveWeapon(p.weapon).dps,
    );
  });

  it('rechaza mejorar sin dinero', () => {
    const out = runOp('buyWeaponStat', player({ money: 0 }), factory(), {
      stat: 'damage',
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('respeta el nivel máximo de cada mejora', () => {
    const def = WEAPON_STATS.multishot;
    const p = player({
      money: 10 ** 12,
      weapon: { ...DEFAULT_WEAPON, multishot: def.maxLevel },
    });
    const out = runOp('buyWeaponStat', p, factory(), { stat: 'multishot', now: T0 });
    expect(out.ok).toBe(false);
  });

  it('comprar un arma la desbloquea y la equipa', () => {
    const p = player({ money: 10 ** 6, level: 40 });
    const out = runOp('buyWeapon', p, factory(), { weaponId: 'smg', now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.weapon.type).toBe('smg');
    expect(out.player!.weapon.owned).toContain('smg');
    expect(out.player!.money).toBeLessThan(p.money);
  });

  it('equipar un arma ya comprada es gratis', () => {
    const p = player({
      money: 500,
      level: 40,
      weapon: { ...DEFAULT_WEAPON, owned: ['pistol', 'smg'], type: 'smg' },
    });
    const out = runOp('buyWeapon', p, factory(), { weaponId: 'pistol', now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(500);
    expect(out.player!.weapon.type).toBe('pistol');
  });

  it('rechaza armas por encima de tu nivel', () => {
    const out = runOp('buyWeapon', player({ money: 10 ** 9, level: 1 }), factory(), {
      weaponId: 'plasma',
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('rechaza armas inexistentes', () => {
    const out = runOp('buyWeapon', player({ money: 10 ** 9 }), factory(), {
      weaponId: 'bfg',
      now: T0,
    });
    expect(out.ok).toBe(false);
  });
});

describe('enemigos', () => {
  it('sólo aparecen los apropiados para tu nivel', () => {
    for (let i = 0; i < 50; i++) {
      expect(rollEnemy(1).fromLevel).toBeLessThanOrEqual(1);
    }
    const alto = new Set(Array.from({ length: 80 }, () => rollEnemy(20).id));
    expect(alto.size).toBeGreaterThan(1);
  });

  it('la vida escala con el nivel del jugador', () => {
    const def = ENEMIES[0];
    expect(enemyHp(def, 10)).toBeGreaterThan(enemyHp(def, 1));
  });

  it('no aparecen por debajo del nivel mínimo', () => {
    const c = new Combat();
    run(c, 20, 1);
    expect(c.enemies).toHaveLength(0);
  });

  it('aparecen mientras recolectas y a distancia, nunca encima', () => {
    const c = new Combat();
    const w = deriveWeapon(DEFAULT_WEAPON);
    // Se avanza a ritmo normal hasta la primera aparición.
    for (let i = 0; i < 600 && c.enemies.length === 0; i++) {
      c.update(1 / 60, 700, 700, 10, w, true, true);
    }
    expect(c.enemies.length).toBeGreaterThan(0);
    for (const e of c.enemies) {
      expect(Math.hypot(e.x - 700, e.y - 700)).toBeGreaterThan(
        COMBAT.spawnDistance * 0.7,
      );
    }
  });

  it('nunca superan el máximo simultáneo', () => {
    const c = new Combat();
    run(c, 120, 20);
    expect(c.enemies.length).toBeLessThanOrEqual(COMBAT.maxAlive);
  });

  it('el arma los detecta y los destruye sola', () => {
    const c = new Combat();
    const { kills } = run(c, 60, 10);
    expect(kills).toBeGreaterThan(0);
    expect(c.pendingXp).toBeGreaterThan(0);
  });

  it('al tocarte drenan estamina', () => {
    const c = new Combat();
    const { drain } = run(c, 60, 10);
    expect(drain).toBeGreaterThan(0);
  });

  it('se desactivan al salir de la partida y limpian el estado', () => {
    const c = new Combat();
    run(c, 30, 10);
    const w = deriveWeapon(DEFAULT_WEAPON);
    c.update(1 / 60, 700, 700, 10, w, false, false);
    expect(c.enemies).toHaveLength(0);
    expect(c.bullets).toHaveLength(0);
  });

  it('takeXp vacía el acumulador y respeta el tope', () => {
    const c = new Combat();
    c.pendingXp = COMBAT.maxXpPerFlush * 3;
    const first = c.takeXp();
    expect(first).toBe(COMBAT.maxXpPerFlush);
    expect(c.pendingXp).toBeGreaterThan(0);
  });
});

describe('recompensa de combate (frontera de confianza)', () => {
  it('concede XP y cuenta las bajas', () => {
    const p = player({ lastCombatAt: T0 - 60_000 });
    const out = runOp('combatReward', p, factory(), { xp: 120, kills: 9, now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.stats.kills).toBe(9);
    expect(out.player!.xp + out.player!.level).toBeGreaterThan(p.xp + p.level);
  });

  it('acota la XP por el tiempo transcurrido', () => {
    // Sólo un segundo desde la última recompensa: no puede reclamar mucho.
    const p = player({ lastCombatAt: T0 - 1000 });
    const out = runOp('combatReward', p, factory(), { xp: 999999, kills: 200, now: T0 });
    const granted = (out.data as { xp: number }).xp;
    expect(granted).toBeLessThanOrEqual(COMBAT.maxXpPerFlush);
    expect(granted).toBeLessThan(999999);
  });

  it('nunca supera el tope por envío', () => {
    const p = player({ lastCombatAt: T0 - 10 * 60_000 });
    const out = runOp('combatReward', p, factory(), { xp: 10 ** 9, kills: 10 ** 6, now: T0 });
    expect((out.data as { xp: number }).xp).toBeLessThanOrEqual(COMBAT.maxXpPerFlush);
  });

  it('ignora peticiones vacías o negativas', () => {
    const p = player();
    for (const args of [
      { xp: 0, kills: 0 },
      { xp: -50, kills: -3 },
    ]) {
      const out = runOp('combatReward', p, factory(), { ...args, now: T0 });
      expect(out.ok).toBe(true);
      expect((out.data as { xp: number }).xp).toBe(0);
    }
  });

  it('marca el instante para que no se pueda cobrar dos veces seguidas', () => {
    const p = player({ lastCombatAt: T0 - 60_000 });
    const first = runOp('combatReward', p, factory(), { xp: 300, kills: 20, now: T0 });
    expect(first.player!.lastCombatAt).toBe(T0);
    // Inmediatamente después, el techo por tiempo deja pasar casi nada.
    const second = runOp('combatReward', first.player!, factory(), {
      xp: 300,
      kills: 20,
      now: T0 + 50,
    });
    expect((second.data as { xp: number }).xp).toBeLessThan(300);
  });
});
