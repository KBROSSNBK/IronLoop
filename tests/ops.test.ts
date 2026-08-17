import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/config/world';
import { runOp } from '../src/services/backend/ops';
import {
  createFactoryState,
  createPlayerState,
} from '../src/game/logic/defaults';
import { BALANCE } from '../src/config/balance';
import { MACHINES, machineUpgradeCost, getMachine } from '../src/config/machines';
import { UPGRADES, upgradeCost } from '../src/config/upgrades';
import { getItem } from '../src/config/items';
import type { FactoryState, PlayerState } from '../src/types';

/** Punto en el que se pica una estación. */
const EN_VETA = (id: string) => {
  const s = STATIONS.find((x) => x.id === id)!;
  return { x: (s.tx + s.tw / 2) * 40, y: (s.ty + s.th + 0.4) * 40 };
};

/** Punto justo delante de una máquina: cargar y retirar exigen estar ahí. */
const AT = (id: string) => {
  const m = getMachine(id);
  return { x: (m.tx + m.tw / 2) * 40, y: (m.ty + m.th + 0.4) * 40 };
};

const T0 = 1_700_000_000_000;
const user = (uid: string) => ({ uid, displayName: uid, photoURL: null, email: null });

function world(overrides: Partial<PlayerState> = {}) {
  const player: PlayerState = { ...createPlayerState(user('u1'), T0), ...overrides };
  const factory: FactoryState = createFactoryState('f1', 1, T0);
  return { player, factory };
}

/** Determinista: sin hallazgos raros. */
const noLuck = () => 0.99;

/** Centro del muelle de carga (dock_sell: tx17 ty21 tw6 th3). */
const AT_DOCK = { x: 800, y: 900 };
/** Punto claramente fuera de la zona de venta. */
const FAR_AWAY = { x: 200, y: 240 };

describe('opGather — recolección', () => {
  it('añade material, gasta estamina y da XP', () => {
    const { player, factory } = world();
    const out = runOp('gather', player, factory, {
      stationId: 'vein_a', at: EN_VETA('vein_a'),
      now: T0,
      rand: noLuck,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ore).toBe(1);
    expect(out.player!.stamina).toBeLessThan(player.stamina);
    expect(out.player!.xp).toBe(BALANCE.actions.gather.xp);
    expect(out.factory!.stats.gathered).toBe(1);
  });

  it('rechaza si no queda estamina', () => {
    const { player, factory } = world({ stamina: 0, staminaAt: T0 });
    const out = runOp('gather', player, factory, { stationId: 'vein_a', at: EN_VETA('vein_a'), now: T0, rand: noLuck });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/estamina/i);
  });

  it('rechaza si el inventario está lleno', () => {
    const { player, factory } = world({ inventory: { ore: 10 } });
    const out = runOp('gather', player, factory, { stationId: 'vein_a', at: EN_VETA('vein_a'), now: T0, rand: noLuck });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/lleno/i);
  });

  it('rechaza estaciones inventadas por el cliente', () => {
    const { player, factory } = world();
    const out = runOp('gather', player, factory, {
      stationId: 'veta_falsa',
      at: { x: 200, y: 300 },
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('la fuerza aumenta las unidades por acción', () => {
    const { player, factory } = world({ upgrades: { strength: 3 } });
    const out = runOp('gather', player, factory, { stationId: 'vein_a', at: EN_VETA('vein_a'), now: T0, rand: noLuck });
    expect(out.player!.inventory.ore).toBe(4);
  });

  it('la suerte puede entregar un hallazgo raro', () => {
    const { player, factory } = world({ upgrades: { luck: 20, capacity: 2 } });
    const out = runOp('gather', player, factory, {
      stationId: 'vein_a', at: EN_VETA('vein_a'),
      now: T0,
      rand: () => 0, // fuerza el hallazgo y el primer item de la tabla
    });
    expect(out.player!.inventory.crystal).toBe(1);
  });
});

describe('opDeposit / opCollect — cadena de producción', () => {
  it('deposita sólo material compatible y arranca la máquina', () => {
    const { player, factory } = world({ inventory: { ore: 6, gear: 3 } });
    const out = runOp('deposit', player, factory, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    expect(out.ok).toBe(true);
    expect(out.factory!.machines.smelter.input.ore).toBe(5);
    expect(out.player!.inventory.gear).toBe(3); // los engranajes no entran
    expect(out.factory!.machines.smelter.cycleStartAt).toBe(T0);
  });

  it('rechaza depositar si no llevas material compatible', () => {
    const { player, factory } = world({ inventory: { gear: 5 } });
    const out = runOp('deposit', player, factory, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    expect(out.ok).toBe(false);
  });

  it('no permite usar una máquina bloqueada por nivel de fábrica', () => {
    const { player, factory } = world({ inventory: { ingot: 10 } });
    const out = runOp('deposit', player, factory, { machineId: 'assembler', at: AT('assembler'), now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/nivel 3/i);
  });

  it('una acción de carga descarga un lote, no la mochila entera', () => {
    // El lote por acción es `gatherAmount * 5`; con fuerza 0 son 5 unidades.
    const { player, factory } = world({ inventory: { ore: 12 } });
    const out = runOp('deposit', player, factory, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    expect(out.factory!.machines.smelter.input.ore).toBe(5);
    expect(out.player!.inventory.ore).toBe(7);
  });

  it('recoge el producto y aporta contribución a la fábrica', () => {
    const { player, factory } = world({ inventory: { ore: 6 } });
    const dep = runOp('deposit', player, factory, {
      machineId: 'smelter', at: AT('smelter'),
      qty: 6,
      now: T0,
    });
    expect(dep.factory!.machines.smelter.input.ore).toBe(6);
    const later = T0 + MACHINES.smelter.cycleMs * 3 + 10;
    const col = runOp('collect', dep.player!, dep.factory!, {
      machineId: 'smelter', at: AT('smelter'),
      now: later,
    });
    expect(col.ok).toBe(true);
    expect(col.player!.inventory.ingot).toBe(3);
    expect(col.factory!.stats.produced).toBe(3);
    expect(col.factory!.contribution).toBeCloseTo(
      3 * BALANCE.factory.contribPerProduced,
      5,
    );
  });

  it('no deja recoger si el inventario está lleno', () => {
    const { player, factory } = world({ inventory: { scrap: 10 } });
    const f: FactoryState = {
      ...factory,
      machines: {
        ...factory.machines,
        smelter: { ...factory.machines.smelter, output: { ingot: 5 } },
      },
    };
    const out = runOp('collect', player, f, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/lleno/i);
  });

  it('no crea producto de la nada si no hay salida lista', () => {
    const { player, factory } = world();
    const out = runOp('collect', player, factory, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    expect(out.ok).toBe(false);
  });
});

describe('opSell — economía individual', () => {
  it('convierte inventario en dinero y contribución', () => {
    const { player, factory } = world({ inventory: { ingot: 4 } });
    const out = runOp('sell', player, factory, { at: AT_DOCK, now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(player.money + 4 * getItem('ingot').sellPrice);
    expect(out.player!.inventory.ingot).toBeUndefined();
    expect(out.factory!.stats.sold).toBe(4 * getItem('ingot').sellPrice);
    expect(out.factory!.contribution).toBeGreaterThan(0);
  });

  it('no permite vender lo que no se tiene', () => {
    const { player, factory } = world({ inventory: { ingot: 1 } });
    const out = runOp('sell', player, factory, {
      items: { ingot: 9999 },
      at: AT_DOCK,
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(player.money + getItem('ingot').sellPrice);
  });

  it('rechaza vender con la mochila vacía', () => {
    const { player, factory } = world();
    const out = runOp('sell', player, factory, { at: AT_DOCK, now: T0 });
    expect(out.ok).toBe(false);
  });

  it('BLOQUEA la venta fuera del muelle de carga', () => {
    const { player, factory } = world({ inventory: { ingot: 10 } });
    const out = runOp('sell', player, factory, { at: FAR_AWAY, now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/muelle/i);
    expect(out.player).toBeUndefined();
  });

  it('BLOQUEA la venta si el cliente no envía posición', () => {
    const { player, factory } = world({ inventory: { ingot: 10 } });
    const out = runOp('sell', player, factory, { now: T0 });
    expect(out.ok).toBe(false);
  });
});

describe('opBuyUpgrade — mejoras personales', () => {
  it('cobra el precio correcto y sube el nivel de la rama', () => {
    const { player, factory } = world({ money: 100000 });
    const cost = upgradeCost(UPGRADES.speed, 0);
    const out = runOp('buyUpgrade', player, factory, { upgradeId: 'speed', now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(100000 - cost);
    expect(out.player!.upgrades.speed).toBe(1);
  });

  it('parte del gasto alimenta el progreso de la fábrica', () => {
    const { player, factory } = world({ money: 100000 });
    const out = runOp('buyUpgrade', player, factory, { upgradeId: 'speed', now: T0 });
    expect(out.factory!.contribution).toBeGreaterThan(0);
  });

  it('rechaza si no hay dinero suficiente', () => {
    const { player, factory } = world({ money: 0 });
    const out = runOp('buyUpgrade', player, factory, { upgradeId: 'speed', now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/dinero/i);
  });

  it('respeta el nivel mínimo de jugador de cada rama', () => {
    const { player, factory } = world({ money: 10 ** 9, level: 1 });
    const out = runOp('buyUpgrade', player, factory, { upgradeId: 'luck', now: T0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/nivel/i);
  });

  it('respeta el nivel máximo', () => {
    const def = UPGRADES.speed;
    const { player, factory } = world({
      money: 10 ** 12,
      upgrades: { speed: def.maxLevel },
    });
    const out = runOp('buyUpgrade', player, factory, { upgradeId: 'speed', now: T0 });
    expect(out.ok).toBe(false);
  });

  it('rechaza mejoras inexistentes', () => {
    const { player, factory } = world({ money: 10 ** 9 });
    const out = runOp('buyUpgrade', player, factory, { upgradeId: 'god_mode', now: T0 });
    expect(out.ok).toBe(false);
  });
});

describe('opContribute — núcleo de la fábrica', () => {
  it('convierte dinero en progreso compartido', () => {
    // Nivel alto para que la XP de la donación no dispare una subida de nivel
    // (que añadiría dinero de recompensa y enmascararía el descuento).
    const { player, factory } = world({ money: 5000, level: 30 });
    const out = runOp('contribute', player, factory, { money: 1000, now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(4000);
    // 900 puntos completan justo el nivel 1 → la contribución acumulada se
    // consume al subir de nivel, pero el histórico total la conserva.
    expect(out.factory!.totalContribution).toBe(
      Math.round(1000 * BALANCE.factory.contribPerMoney),
    );
    expect(out.factory!.level).toBe(2);
  });

  it('donar también da XP al jugador que dona', () => {
    const { player, factory } = world({ money: 5000, level: 30 });
    const out = runOp('contribute', player, factory, { money: 1000, now: T0 });
    expect(out.player!.xp).toBeGreaterThan(player.xp);
  });

  it('rechaza donar más de lo que se tiene', () => {
    const { player, factory } = world({ money: 100 });
    const out = runOp('contribute', player, factory, { money: 100000, now: T0 });
    expect(out.ok).toBe(false);
  });

  it('rechaza donaciones por debajo del mínimo', () => {
    const { player, factory } = world({ money: 5000 });
    const out = runOp('contribute', player, factory, { money: 1, now: T0 });
    expect(out.ok).toBe(false);
  });

  it('acepta materiales y los descuenta del inventario', () => {
    const { player, factory } = world({ inventory: { ingot: 5 } });
    const out = runOp('contribute', player, factory, {
      items: { ingot: 5 },
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.inventory.ingot).toBeUndefined();
    expect(out.factory!.contribution).toBe(5 * getItem('ingot').contribValue);
  });

  it('sube el nivel de la fábrica al superar el umbral', () => {
    const { player, factory } = world({ money: 10 ** 7 });
    const out = runOp('contribute', player, factory, { money: 2000, now: T0 });
    expect(out.factory!.level).toBe(2);
    expect(out.events.some((e) => e.kind === 'factoryLevelUp')).toBe(true);
  });
});

describe('opUpgradeMachine — mejora compartida', () => {
  it('acelera la máquina para todos y cobra a quien la paga', () => {
    const { player, factory } = world({ money: 10 ** 6 });
    const cost = machineUpgradeCost(0);
    const out = runOp('upgradeMachine', player, factory, {
      machineId: 'smelter', at: AT('smelter'),
      now: T0,
    });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBe(10 ** 6 - cost);
    expect(out.factory!.machines.smelter.level).toBe(1);
  });

  it('no se puede mejorar una máquina bloqueada', () => {
    const { player, factory } = world({ money: 10 ** 9 });
    const out = runOp('upgradeMachine', player, factory, {
      machineId: 'assembler', at: AT('assembler'),
      now: T0,
    });
    expect(out.ok).toBe(false);
  });
});

describe('misiones y consumibles', () => {
  it('no deja reclamar una misión incompleta', () => {
    const { player, factory } = world();
    const out = runOp('claimMission', player, factory, {
      missionId: player.missions[0].id,
      now: T0,
    });
    expect(out.ok).toBe(false);
  });

  it('al reclamar paga la recompensa y repone la misión', () => {
    const { player, factory } = world();
    const id = player.missions[0].id;
    const ready: PlayerState = {
      ...player,
      missions: player.missions.map((m) =>
        m.id === id ? { ...m, progress: 10 ** 6 } : m,
      ),
    };
    const out = runOp('claimMission', ready, factory, { missionId: id, now: T0 });
    expect(out.ok).toBe(true);
    expect(out.player!.money).toBeGreaterThan(player.money);
    expect(out.player!.missions).toHaveLength(player.missions.length);
    expect(out.player!.missions.find((m) => m.id === id)?.progress ?? 0).toBe(0);
  });

  /*
   * Ya no hay bebidas ni ningún otro consumible: la estamina se recupera sola
   * con el tiempo. Lo que sigue vivo es la REGLA — nada que no sea consumible
   * se puede "usar", ni siquiera teniéndolo en la mochila.
   */
  it('no se puede usar un material que no es consumible', () => {
    const { player, factory } = world({ inventory: { ingot: 3 } });
    const out = runOp('useItem', player, factory, { itemId: 'ingot', now: T0 });
    expect(out.ok).toBe(false);
    expect(out.player).toBeUndefined();
  });

  it('no se puede usar un objeto que no se tiene', () => {
    const { player, factory } = world();
    const out = runOp('useItem', player, factory, { itemId: 'crystal', now: T0 });
    expect(out.ok).toBe(false);
  });
});

describe('opTick — latido de sesión', () => {
  it('acumula tiempo jugado con tope por llamada', () => {
    const { player, factory } = world();
    const out = runOp('tick', player, factory, { seconds: 10_000, now: T0 });
    expect(out.player!.stats.playtime).toBe(300);
  });

  it('no permite al cliente inflar su estamina', () => {
    const { player, factory } = world({ stamina: 5, staminaAt: T0 });
    const out = runOp('tick', player, factory, {
      seconds: 60,
      stamina: 99999,
      now: T0,
    });
    expect(out.player!.stamina).toBeLessThanOrEqual(5.001);
  });
});

describe('concurrencia — dos jugadores sobre la misma fábrica', () => {
  it('el segundo depósito ve el estado del primero', () => {
    const factory = createFactoryState('f1', 1, T0);
    const a: PlayerState = { ...createPlayerState(user('a'), T0), inventory: { ore: 4 } };
    const b: PlayerState = { ...createPlayerState(user('b'), T0), inventory: { ore: 4 } };

    const first = runOp('deposit', a, factory, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    const second = runOp('deposit', b, first.factory!, { machineId: 'smelter', at: AT('smelter'), now: T0 });

    expect(second.factory!.machines.smelter.input.ore).toBe(8);
    // Cada jugador conserva SU inventario: no se mezclan.
    expect(first.player!.inventory.ore).toBeUndefined();
    expect(second.player!.inventory.ore).toBeUndefined();
  });

  it('sólo uno de los dos puede recoger el mismo producto', () => {
    const base = createFactoryState('f1', 1, T0);
    const factory: FactoryState = {
      ...base,
      machines: {
        ...base.machines,
        smelter: { ...base.machines.smelter, output: { ingot: 2 } },
      },
    };
    const a = createPlayerState(user('a'), T0);
    const b = createPlayerState(user('b'), T0);

    const first = runOp('collect', a, factory, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    const second = runOp('collect', b, first.factory!, { machineId: 'smelter', at: AT('smelter'), now: T0 });

    expect(first.ok).toBe(true);
    expect(first.player!.inventory.ingot).toBe(2);
    expect(second.ok).toBe(false); // ya no queda nada
  });

  it('el dinero es estrictamente individual', () => {
    const factory = createFactoryState('f1', 1, T0);
    const a: PlayerState = { ...createPlayerState(user('a'), T0), inventory: { ingot: 10 } };
    const b = createPlayerState(user('b'), T0);

    const sale = runOp('sell', a, factory, { at: AT_DOCK, now: T0 });
    expect(sale.player!.money).toBeGreaterThan(b.money);
    expect(b.money).toBe(BALANCE.player.startingMoney);
    // …pero la fábrica sí es compartida
    expect(sale.factory!.contribution).toBeGreaterThan(0);
  });

  it('dos compras del mismo upgrade de máquina suben dos niveles', () => {
    const factory = createFactoryState('f1', 1, T0);
    const a: PlayerState = { ...createPlayerState(user('a'), T0), money: 10 ** 6 };
    const b: PlayerState = { ...createPlayerState(user('b'), T0), money: 10 ** 6 };

    const first = runOp('upgradeMachine', a, factory, { machineId: 'smelter', at: AT('smelter'), now: T0 });
    const second = runOp('upgradeMachine', b, first.factory!, {
      machineId: 'smelter', at: AT('smelter'),
      now: T0,
    });

    expect(second.factory!.machines.smelter.level).toBe(2);
    // El segundo paga el precio del nivel 2, no el del 1.
    expect(b.money - second.player!.money).toBe(machineUpgradeCost(1));
  });
});

describe('resistencia a entradas maliciosas', () => {
  it('una operación desconocida no rompe nada', () => {
    const { player, factory } = world();
    const out = runOp('hack' as never, player, factory, {});
    expect(out.ok).toBe(false);
  });

  it('cantidades negativas no generan dinero', () => {
    const { player, factory } = world({ inventory: { ingot: 5 } });
    const out = runOp('sell', player, factory, { items: { ingot: -100 }, now: T0 });
    expect(out.ok).toBe(false);
  });

  it('depositar cantidades absurdas se acota al inventario real', () => {
    const { player, factory } = world({ inventory: { ore: 3 } });
    const out = runOp('deposit', player, factory, {
      machineId: 'smelter', at: AT('smelter'),
      item: 'ore',
      qty: 10 ** 9,
      now: T0,
    });
    expect(out.factory!.machines.smelter.input.ore).toBe(3);
    expect(out.player!.inventory.ore).toBeUndefined();
  });

  it('contribuir materiales que no se tienen no da progreso', () => {
    const { player, factory } = world();
    const out = runOp('contribute', player, factory, {
      items: { circuit: 10 ** 6 },
      now: T0,
    });
    expect(out.ok).toBe(false);
    expect(factory.contribution).toBe(0);
  });
});

/* ─────────────── LOTE DE OPERACIONES: LA CUOTA ─────────────── */

/**
 * Firestore cobra por ESCRITURA: 20.000 al día en el plan gratuito. Con la
 * automatización mandando cada recado por su cuenta eso se agota en una tarde
 * y la partida muere con «Quota exceeded». El lote mete muchos recados en una
 * sola escritura — sin cambiar ni una regla del juego.
 */
describe('opBulk — muchos recados, una escritura', () => {
  it('aplica todas las operaciones en orden sobre el mismo estado', () => {
    const { player, factory } = world({ inventory: {} });
    const p: PlayerState = {
      ...player,
      pet: { ...player.pet, mode: 'gather', bags: [{ ore: 20 }, {}, {}] },
    };
    const f: FactoryState = { ...factory, level: 6 };

    const out = runOp('bulk', p, f, {
      ops: [
        { name: 'petDeposit', args: { machineId: 'smelter', dog: 0, limit: 5 } },
        { name: 'petDeposit', args: { machineId: 'smelter', dog: 0, limit: 7 } },
      ],
      now: T0,
    });

    expect(out.ok).toBe(true);
    // Las dos entregas se acumulan: la segunda ve el estado que dejó la primera.
    expect(out.factory!.machines.smelter.input.ore).toBe(12);
    expect(out.player!.pet.bags[0].ore).toBe(8);
    const res = (out.data as { results: { ok: boolean }[] }).results;
    expect(res.map((r) => r.ok)).toEqual([true, true]);
  });

  it('una operación que falla no tumba el lote', () => {
    const { player, factory } = world();
    const p: PlayerState = {
      ...player,
      pet: { ...player.pet, mode: 'gather', bags: [{ ore: 10 }, {}, {}] },
    };
    const out = runOp('bulk', p, { ...factory, level: 6 }, {
      ops: [
        { name: 'petDeposit', args: { machineId: 'inventada', dog: 0 } },
        { name: 'petDeposit', args: { machineId: 'smelter', dog: 0, limit: 4 } },
      ],
      now: T0,
    });
    expect(out.ok).toBe(true);
    const res = (out.data as { results: { ok: boolean }[] }).results;
    expect(res[0].ok).toBe(false);
    expect(res[1].ok).toBe(true);
    expect(out.factory!.machines.smelter.input.ore).toBe(4);
  });

  it('sólo admite operaciones de fondo: nada de vender ni comprar', () => {
    const { player, factory } = world({ money: 10 ** 6, inventory: { ingot: 5 } });
    const out = runOp('bulk', player, factory, {
      ops: [
        { name: 'sell', args: { at: AT_DOCK } },
        { name: 'buyUpgrade', args: { upgradeId: 'speed' } },
      ],
      now: T0,
    });
    const res = (out.data as { results: { ok: boolean }[] }).results;
    expect(res.every((r) => !r.ok)).toBe(true);
    // Ni un euro se ha movido.
    expect(out.player!.money).toBe(player.money);
  });

  it('un lote vacío se rechaza sin tocar nada', () => {
    const { player, factory } = world();
    expect(runOp('bulk', player, factory, { ops: [], now: T0 }).ok).toBe(false);
  });
});
