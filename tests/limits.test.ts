import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  LEVELUP_TOTAL_MONEY_CAP,
  MAX_MONEY_PER_WRITE,
  OFFLINE_MONEY_CAP,
  OFFLINE_XP_CAP,
  SALE_CLAIM_CAP,
} from '../src/config/balance';
import { applyXp, computeOfflineReport } from '../src/game/logic/progression';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { getMachine } from '../src/config/machines';
import { STATIONS, ZONES, isHumanForbidden } from '../src/config/world';
import { moveWithCollision } from '../src/game/world/geometry';
import { ROBOTS } from '../src/config/robots';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'a', displayName: 'A', photoURL: null, email: null }, T0),
  ...over,
});

const factory = (over: Partial<FactoryState> = {}): FactoryState => ({
  ...createFactoryState('f1', 1, T0),
  ...over,
});

/**
 * Estas pruebas protegen de un fallo real y muy malo: si una recompensa
 * legítima sube el dinero por encima de lo que admiten las reglas de
 * seguridad, Firestore rechaza la escritura y el jugador se queda SIN PODER
 * JUGAR — cada acción vuelve a intentar el mismo pago imposible.
 * Pasó de verdad con la recompensa por subir de nivel a partir del 45.
 */
describe('ninguna recompensa se pasa del techo por escritura', () => {
  it('los topes están por debajo del límite duro', () => {
    expect(LEVELUP_TOTAL_MONEY_CAP).toBeLessThan(MAX_MONEY_PER_WRITE);
    expect(SALE_CLAIM_CAP).toBeLessThan(MAX_MONEY_PER_WRITE);
    expect(OFFLINE_MONEY_CAP).toBeLessThan(MAX_MONEY_PER_WRITE);
    // Ni siquiera sumándolos todos en la misma operación.
    expect(LEVELUP_TOTAL_MONEY_CAP + SALE_CLAIM_CAP + OFFLINE_MONEY_CAP).toBeLessThan(
      MAX_MONEY_PER_WRITE,
    );
  });

  it('subir de nivel nunca reparte de más, ni al nivel 200', () => {
    for (const level of [1, 20, 44, 45, 60, 120, 200]) {
      expect(BALANCE.leveling.moneyPerLevel(level)).toBeLessThanOrEqual(LEVELUP_TOTAL_MONEY_CAP);
    }
  });

  it('encadenar muchísimos niveles de golpe tampoco', () => {
    const res = applyXp(1, 0, 50_000_000);
    expect(res.levelsGained).toBeGreaterThan(10);
    expect(res.moneyReward).toBeLessThanOrEqual(LEVELUP_TOTAL_MONEY_CAP);
  });

  it('la recompensa offline lleva techo en dinero y en XP', () => {
    const rep = computeOfflineReport(
      { level: 200, lastOfflineClaimAt: T0 - 30 * 24 * 3600_000 },
      20,
      T0,
    )!;
    expect(rep.money).toBeLessThanOrEqual(OFFLINE_MONEY_CAP);
    expect(rep.xp).toBeLessThanOrEqual(OFFLINE_XP_CAP);
  });

  it('el cobro de los robots se reparte en tandas y no pierde ni un euro', () => {
    const enorme = SALE_CLAIM_CAP * 3 + 777;
    let p = player({ money: 0 });
    let f = factory({ saleLedger: { a: enorme } });

    let cobrado = 0;
    for (let i = 0; i < 10; i++) {
      const out = runOp('tick', p, f, { seconds: 1, now: T0 + i * 1000 });
      const ganado = out.player!.money - p.money;
      expect(ganado).toBeLessThanOrEqual(SALE_CLAIM_CAP);
      cobrado += ganado;
      p = out.player!;
      f = out.factory!;
      if (!f.saleLedger.a) break;
    }
    expect(cobrado).toBe(enorme);
    expect(f.saleLedger.a).toBeUndefined();
  });

  it('un robot vendiendo ocho horas seguidas no rompe la partida', () => {
    const terminal = ROBOTS.find((r) => !r.to)!;
    const base = createFactoryState('f1', 1, T0);
    let f: FactoryState = {
      ...base,
      level: 14,
      robots: { [terminal.id]: { level: 10, lastRunAt: T0, moved: 0, mode: 'sell', sold: 0 } },
      machines: {
        ...base.machines,
        [terminal.from]: {
          ...base.machines[terminal.from],
          output: { [terminal.item]: 999_999 },
        },
      },
      online: { a: T0 },
    };
    let p = player({ money: 0 });

    // Ocho horas después alguien entra: lo cobrado en esa acción está acotado.
    const out = runOp('tick', p, f, { seconds: 1, now: T0 + 8 * 3600_000 });
    const ganado = out.player!.money - p.money;
    expect(ganado).toBeGreaterThan(0);
    expect(ganado).toBeLessThanOrEqual(SALE_CLAIM_CAP);

    p = out.player!;
    f = out.factory!;
    // Y lo que queda pendiente sigue ahí, no se ha evaporado.
    expect(f.saleLedger.a).toBeGreaterThan(0);
  });
});

/* ─────────────── PROXIMIDAD PARA TOCAR UNA MÁQUINA ─────────────── */

const frente = (id: string) => {
  const m = getMachine(id);
  return { x: (m.tx + m.tw / 2) * 40, y: (m.ty + m.th + 0.4) * 40 };
};
const lejos = { x: 60, y: 60 };

describe('cargar y retirar exige estar junto a la máquina', () => {
  const conMaterial = (): FactoryState => {
    const base = createFactoryState('f1', 1, T0);
    return {
      ...base,
      level: 8,
      machines: {
        ...base.machines,
        smelter: { ...base.machines.smelter, output: { ingot: 40 }, input: { ore: 10 } },
      },
    };
  };

  it('retirar de lejos se rechaza', () => {
    const out = runOp('withdraw', player(), conMaterial(), {
      machineId: 'smelter',
      item: 'ingot',
      qty: 5,
      at: lejos,
      now: T0,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/acércate/i);
  });

  it('retirar delante de la máquina funciona', () => {
    const out = runOp('withdraw', player(), conMaterial(), {
      machineId: 'smelter',
      item: 'ingot',
      qty: 5,
      at: frente('smelter'),
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ingot).toBe(5);
  });

  it('sin mandar posición tampoco cuela', () => {
    const out = runOp('withdraw', player(), conMaterial(), {
      machineId: 'smelter',
      item: 'ingot',
      qty: 5,
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('cargar de lejos se rechaza, delante no', () => {
    const p = player({ inventory: { ore: 10 } });
    expect(
      runOp('deposit', p, conMaterial(), { machineId: 'smelter', at: lejos, now: T0 }).ok,
    ).toBe(false);
    expect(
      runOp('deposit', p, conMaterial(), { machineId: 'smelter', at: frente('smelter'), now: T0 })
        .ok,
    ).toBe(true);
  });

  it('recoger producto de lejos se rechaza, delante no', () => {
    expect(
      runOp('collect', player(), conMaterial(), { machineId: 'smelter', at: lejos, now: T0 }).ok,
    ).toBe(false);
    expect(
      runOp('collect', player(), conMaterial(), {
        machineId: 'smelter',
        at: frente('smelter'),
        now: T0,
      }).ok,
    ).toBe(true);
  });

  it('picar en una veta también exige estar en ella', () => {
    const f: FactoryState = { ...createFactoryState('f1', 1, T0), level: 4 };
    expect(runOp('gather', player(), f, { stationId: 'vein_a', at: lejos, now: T0 }).ok).toBe(
      false,
    );
    expect(
      runOp('gather', player(), f, { stationId: 'vein_a', at: { x: 180, y: 300 }, now: T0 }).ok,
    ).toBe(true);
  });

  it('picar en una zona prohibida se rechaza: es trabajo de robots', () => {
    const f: FactoryState = { ...createFactoryState('f1', 1, T0), level: 12 };
    const veta = STATIONS.find((s) => s.id === 'vein_danger')!;
    const encima = { x: (veta.tx + veta.tw / 2) * 40, y: (veta.ty + veta.th + 0.4) * 40 };
    const out = runOp('gather', player(), f, { stationId: veta.id, at: encima, now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/prohibida/i);
  });

  it('la mascota sí puede sacar material de ahí', () => {
    const f: FactoryState = { ...createFactoryState('f1', 1, T0), level: 12 };
    const out = runOp('petMine', player(), f, {
      stationId: 'vein_danger',
      qty: 3,
      now: T0 + 60_000,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.pet.inventory.titanium).toBeGreaterThan(0);
  });

  it('una persona no puede ni entrar en la zona prohibida', () => {
    const danger = ZONES.find((z) => z.noHumans)!;
    const dentro = { x: (danger.tx + 3) * 40, y: (danger.ty + 3) * 40 };
    const fuera = { x: dentro.x, y: (danger.ty - 2) * 40 };

    // Un humano se queda en el borde por mucho que empuje.
    let p = { ...fuera };
    for (let i = 0; i < 200; i++) p = moveWithCollision(p.x, p.y, 0, 12, { human: true });
    expect(isHumanForbidden(p.x, p.y)).toBe(false);

    // Una máquina entra sin problema.
    let m = { ...fuera };
    for (let i = 0; i < 200; i++) m = moveWithCollision(m.x, m.y, 0, 12);
    expect(isHumanForbidden(m.x, m.y)).toBe(true);
  });

  it('por cinta lo que cuenta es estar junto a la CINTA', () => {
    const base = createFactoryState('f1', 1, T0);
    const f: FactoryState = { ...base, level: 10 };
    const p = player({ inventory: { ore: 20 } });
    // Delante de la Fundidora, pero la cinta c1 está en la otra punta.
    expect(
      runOp('deposit', p, f, {
        machineId: 'smelter',
        beltId: 'c1',
        at: frente('smelter'),
        now: T0,
      }).ok,
    ).toBe(false);
    // En el extremo de carga de la cinta, sí.
    expect(
      runOp('deposit', p, f, {
        machineId: 'smelter',
        beltId: 'c1',
        at: { x: 11 * 40, y: 6.85 * 40 },
        now: T0,
      }).ok,
    ).toBe(true);
  });
});
