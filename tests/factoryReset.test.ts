import { describe, expect, it } from 'vitest';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { BALANCE } from '../src/config/balance';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

function veteran(): PlayerState {
  const p = createPlayerState({ uid: 'u1', displayName: 'Sebas', photoURL: 'foto', email: null }, T0);
  return {
    ...p,
    level: 27,
    xp: 4200,
    money: 987_654,
    inventory: { ore: 40, ingot: 12, gear: 3 },
    upgrades: { speed: 9, capacity: 6, trading: 4 },
    appearance: { ...p.appearance, outfitColor: '#ef4444', hair: 'mohawk' },
    stats: { ...p.stats, earned: 500_000, produced: 3_000, contributed: 90_000 },
    resetAckAt: 0,
  };
}

const resetFactory = (at: number): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  resetAt: at,
});

describe('reinicio de fábrica del administrador', () => {
  it('pone el progreso del jugador a cero', () => {
    const out = runOp('applyFactoryReset', veteran(), resetFactory(T0 + 1000), {
      now: T0 + 2000,
    });
    expect(out.ok).toBe(true);
    const p = out.player!;
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
    expect(p.money).toBe(BALANCE.player.startingMoney);
    expect(p.inventory).toEqual({});
    expect(p.upgrades).toEqual({});
    expect(p.stats.earned).toBe(0);
    expect(p.stats.produced).toBe(0);
    expect(p.stats.contributed).toBe(0);
  });

  it('conserva identidad y aspecto: no es un borrado de cuenta', () => {
    const before = veteran();
    const out = runOp('applyFactoryReset', before, resetFactory(T0 + 1000), { now: T0 + 2000 });
    const p = out.player!;
    expect(p.uid).toBe(before.uid);
    expect(p.name).toBe(before.name);
    expect(p.photoURL).toBe(before.photoURL);
    expect(p.appearance).toEqual(before.appearance);
    expect(p.createdAt).toBe(before.createdAt);
    expect(p.factoryId).toBe(before.factoryId);
  });

  it('marca el reinicio como aplicado', () => {
    const at = T0 + 1000;
    const out = runOp('applyFactoryReset', veteran(), resetFactory(at), { now: T0 + 2000 });
    expect(out.player!.resetAckAt).toBe(at);
  });

  it('es idempotente: aplicarlo dos veces no vuelve a borrar', () => {
    const at = T0 + 1000;
    const first = runOp('applyFactoryReset', veteran(), resetFactory(at), { now: T0 + 2000 });
    const progressed: PlayerState = { ...first.player!, money: 5000, level: 4 };
    const second = runOp('applyFactoryReset', progressed, resetFactory(at), { now: T0 + 9000 });
    expect((second.data as { applied: boolean }).applied).toBe(false);
    expect(second.player!.money).toBe(5000);
    expect(second.player!.level).toBe(4);
  });

  it('un reinicio posterior sí vuelve a aplicarse', () => {
    const first = runOp('applyFactoryReset', veteran(), resetFactory(T0 + 1000), { now: T0 + 2000 });
    const progressed: PlayerState = { ...first.player!, money: 50_000, level: 9 };
    const second = runOp('applyFactoryReset', progressed, resetFactory(T0 + 50_000), {
      now: T0 + 60_000,
    });
    expect((second.data as { applied: boolean }).applied).toBe(true);
    expect(second.player!.money).toBe(BALANCE.player.startingMoney);
    expect(second.player!.level).toBe(1);
  });

  it('una fábrica sin reinicios no toca nada', () => {
    const before = veteran();
    const out = runOp('applyFactoryReset', before, createFactoryState('f1', 1, T0), {
      now: T0 + 2000,
    });
    expect((out.data as { applied: boolean }).applied).toBe(false);
    expect(out.player!.money).toBe(before.money);
  });

  it('no permite reclamar producción offline acumulada antes del reinicio', () => {
    const out = runOp('applyFactoryReset', veteran(), resetFactory(T0 + 1000), {
      now: T0 + 2000,
    });
    expect(out.player!.lastOfflineClaimAt).toBe(T0 + 2000);
  });
});
