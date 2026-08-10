import { describe, expect, it } from 'vitest';
import {
  applyFactoryContribution,
  applyMissionEvents,
  applyXp,
  computeOfflineReport,
  computeSale,
  currentStamina,
  inventoryCapacity,
  inventoryFree,
  spendStamina,
  xpForLevel,
} from '../src/game/logic/progression';
import { createPlayerState } from '../src/game/logic/defaults';
import { BALANCE, deriveStats } from '../src/config/balance';
import { getFactoryLevel } from '../src/config/factoryLevels';
import type { MissionProgress } from '../src/types';

const USER = { uid: 'u1', displayName: 'Test', photoURL: null, email: null };
const T0 = 1_700_000_000_000;

describe('niveles y XP', () => {
  it('sube un nivel al alcanzar la XP necesaria', () => {
    const need = xpForLevel(1);
    const r = applyXp(1, 0, need);
    expect(r.level).toBe(2);
    expect(r.xp).toBe(0);
    expect(r.levelsGained).toBe(1);
    expect(r.moneyReward).toBeGreaterThan(0);
  });

  it('encadena varias subidas de nivel de una sola vez', () => {
    const r = applyXp(1, 0, 100000);
    expect(r.level).toBeGreaterThan(3);
    expect(r.xp).toBeLessThan(xpForLevel(r.level));
  });

  it('no pierde XP sobrante', () => {
    const need = xpForLevel(1);
    const r = applyXp(1, 0, need + 17);
    expect(r.xp).toBe(17);
  });
});

describe('estamina derivada de timestamp', () => {
  it('se regenera con el tiempo sin escribir nada', () => {
    const p = { stamina: 50, staminaAt: T0, upgrades: {} };
    const regen = deriveStats({}).staminaRegen;
    expect(currentStamina(p, T0)).toBe(50);
    expect(currentStamina(p, T0 + 10_000)).toBeCloseTo(50 + regen * 10, 4);
  });

  it('nunca supera el máximo', () => {
    const p = { stamina: 90, staminaAt: T0, upgrades: {} };
    expect(currentStamina(p, T0 + 10 ** 7)).toBe(deriveStats({}).maxStamina);
  });

  it('nunca baja de cero', () => {
    const p = { stamina: 3, staminaAt: T0, upgrades: {} };
    const after = spendStamina(p, T0, 999);
    expect(after.stamina).toBe(0);
    expect(after.staminaAt).toBe(T0);
  });

  it('las mejoras aumentan máximo y regeneración', () => {
    const base = deriveStats({});
    const upgraded = deriveStats({ stamina: 4, regen: 3 });
    expect(upgraded.maxStamina).toBeGreaterThan(base.maxStamina);
    expect(upgraded.staminaRegen).toBeGreaterThan(base.staminaRegen);
  });
});

describe('inventario', () => {
  it('la capacidad crece con la mejora de mochila', () => {
    expect(inventoryCapacity({ upgrades: {} })).toBe(
      BALANCE.player.baseInventorySlots,
    );
    expect(inventoryCapacity({ upgrades: { capacity: 2 } })).toBe(
      BALANCE.player.baseInventorySlots + 10,
    );
  });

  it('el espacio libre nunca es negativo', () => {
    const free = inventoryFree({ upgrades: {}, inventory: { ore: 999 } });
    expect(free).toBe(0);
  });
});

describe('venta', () => {
  it('no vende más de lo que hay en el inventario', () => {
    const sale = computeSale({ ingot: 2 }, { ingot: 50 }, {});
    expect(sale.units).toBe(2);
  });

  it('aplica la mejora de comercio', () => {
    const plain = computeSale({ ingot: 10 }, { ingot: 10 }, {});
    const traded = computeSale({ ingot: 10 }, { ingot: 10 }, { trading: 5 });
    expect(traded.money).toBeGreaterThan(plain.money);
  });

  it('ignora objetos sin precio de venta', () => {
    const sale = computeSale({ energyDrink: 5 }, { energyDrink: 5 }, {});
    expect(sale.units).toBe(0);
    expect(sale.money).toBe(0);
  });
});

describe('misiones', () => {
  const missions: MissionProgress[] = [
    { id: 'm_gather_15', progress: 0, claimed: false, startedAt: T0 },
    { id: 'm_sell_8', progress: 0, claimed: false, startedAt: T0 },
  ];

  it('sólo avanza la métrica correspondiente', () => {
    const r = applyMissionEvents(missions, [
      { metric: 'gather', item: 'ore', amount: 3 },
    ]);
    expect(r.missions[0].progress).toBe(3);
    expect(r.missions[1].progress).toBe(0);
  });

  it('filtra por item cuando la misión lo exige', () => {
    const r = applyMissionEvents(missions, [
      { metric: 'gather', item: 'crystal', amount: 5 },
    ]);
    expect(r.missions[0].progress).toBe(0);
  });

  it('avisa una sola vez al completarse y no se pasa del objetivo', () => {
    const r1 = applyMissionEvents(missions, [
      { metric: 'gather', item: 'ore', amount: 99 },
    ]);
    expect(r1.completed).toContain('m_gather_15');
    expect(r1.missions[0].progress).toBe(15);

    const r2 = applyMissionEvents(r1.missions, [
      { metric: 'gather', item: 'ore', amount: 5 },
    ]);
    expect(r2.completed).toHaveLength(0);
  });
});

describe('progreso de la fábrica', () => {
  it('sube de nivel al superar la contribución requerida', () => {
    const need = getFactoryLevel(1).xpToNext;
    const r = applyFactoryContribution(1, 0, need);
    expect(r.level).toBe(2);
    expect(r.levelsGained).toBe(1);
  });

  it('conserva el resto para el siguiente nivel', () => {
    const need = getFactoryLevel(1).xpToNext;
    const r = applyFactoryContribution(1, 0, need + 25);
    expect(r.contribution).toBe(25);
  });

  it('genera niveles procedimentales más allá de la tabla', () => {
    const l = getFactoryLevel(25);
    expect(l.level).toBe(25);
    expect(l.xpToNext).toBeGreaterThan(0);
    expect(l.productionMult).toBeGreaterThan(4);
  });
});

describe('recompensas offline', () => {
  const player = createPlayerState(USER, T0);

  it('no da nada si la fábrica aún no automatiza (nivel 1)', () => {
    expect(computeOfflineReport(player, 1, T0 + 3600_000)).toBeNull();
  });

  it('no da nada si el jugador vuelve enseguida', () => {
    expect(computeOfflineReport(player, 5, T0 + 10_000)).toBeNull();
  });

  it('recompensa proporcional al tiempo ausente', () => {
    const oneHour = computeOfflineReport(player, 5, T0 + 3600_000)!;
    const twoHours = computeOfflineReport(player, 5, T0 + 7200_000)!;
    expect(oneHour.money).toBeGreaterThan(0);
    expect(twoHours.money).toBeGreaterThan(oneHour.money);
  });

  it('está limitada por el tope anti-inflación', () => {
    const capped = computeOfflineReport(player, 5, T0 + 30 * 24 * 3600_000)!;
    const atCap = computeOfflineReport(
      player,
      5,
      T0 + BALANCE.offline.capSeconds * 1000,
    )!;
    expect(capped.money).toBe(atCap.money);
    expect(capped.seconds).toBe(BALANCE.offline.capSeconds);
  });

  it('una fábrica de más nivel produce más offline', () => {
    const low = computeOfflineReport(player, 3, T0 + 3600_000)!;
    const high = computeOfflineReport(player, 8, T0 + 3600_000)!;
    expect(high.money).toBeGreaterThan(low.money);
  });
});
