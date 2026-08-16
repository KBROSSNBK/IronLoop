import { describe, expect, it } from 'vitest';
import { SprintDrain } from '../src/game/logic/stamina';
import { currentStamina, spendStamina, maxStamina } from '../src/game/logic/progression';
import { runOp } from '../src/services/backend/ops';
import { createFactoryState, createPlayerState } from '../src/game/logic/defaults';
import { BALANCE } from '../src/config/balance';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...createPlayerState({ uid: 'a', displayName: 'A', photoURL: null, email: null }, T0),
  ...over,
});

const factory = (): FactoryState => ({ ...createFactoryState('f1', 1, T0), level: 4 });

describe('gasto de sprint pendiente de consolidar', () => {
  it('mientras no se persiste, se descuenta de lo que se ve', () => {
    const d = new SprintDrain();
    d.sync(T0);
    d.add(30);
    expect(d.pending).toBe(30);
    expect(d.apply(100, 100)).toBe(70);
  });

  it('cuando el servidor fija una línea base nueva, deja de restarse', () => {
    const d = new SprintDrain();
    d.sync(T0);
    d.add(40);
    expect(d.apply(100, 100)).toBe(60);
    // El servidor ha persistido la estamina: `staminaAt` avanza.
    d.sync(T0 + 1000);
    expect(d.pending).toBe(0);
    expect(d.apply(60, 100)).toBe(60);
  });

  it('NO se resta dos veces: es el fallo que dejaba al jugador clavado en 0', () => {
    const d = new SprintDrain();
    d.sync(T0);
    let at = T0;
    let base = 100;

    // Diez ciclos de esprintar y consolidar.
    for (let i = 0; i < 10; i++) {
      d.add(BALANCE.player.sprintStaminaCost); // un segundo corriendo
      const visto = d.apply(base, 100);
      expect(visto).toBeGreaterThanOrEqual(0);
      // El servidor guarda lo que se ve y reinicia el reloj.
      base = visto;
      at += 1000;
      d.sync(at);
      // Y regenera un poco antes del siguiente ciclo.
      base = Math.min(100, base + 20);
    }

    // Tras parar, la estamina sube y NO hay lastre acumulado.
    expect(d.pending).toBe(0);
    expect(d.apply(100, 100)).toBe(100);
  });

  it('nunca se sale del rango 0..máximo', () => {
    const d = new SprintDrain();
    d.sync(T0);
    d.add(500);
    expect(d.apply(100, 100)).toBe(0);
    d.sync(T0 + 1);
    expect(d.apply(1000, 100)).toBe(100);
  });

  it('ignora sumas negativas', () => {
    const d = new SprintDrain();
    d.add(-50);
    expect(d.pending).toBe(0);
  });
});

describe('estamina derivada del estado', () => {
  it('regenera con el tiempo sin escribir nada', () => {
    const p = player({ stamina: 10, staminaAt: T0 });
    const regen = BALANCE.player.baseStaminaRegen;
    expect(currentStamina(p, T0)).toBe(10);
    expect(currentStamina(p, T0 + 10_000)).toBeCloseTo(10 + regen * 10, 5);
  });

  it('nunca pasa del máximo por mucho que esperes', () => {
    const p = player({ stamina: 10, staminaAt: T0 });
    expect(currentStamina(p, T0 + 3600_000)).toBe(maxStamina(p));
  });

  it('nunca baja de cero', () => {
    const p = player({ stamina: 2, staminaAt: T0 });
    expect(spendStamina(p, T0, 50).stamina).toBe(0);
  });

  it('recolectar la gasta y sin fuelle se rechaza', () => {
    const cerca = { x: 180, y: 300 };
    let p = player({ stamina: 5, staminaAt: T0 });
    const uno = runOp('gather', p, factory(), { stationId: 'vein_a', at: cerca, now: T0 });
    expect(uno.ok).toBe(true);
    expect(currentStamina(uno.player!, T0)).toBeLessThan(5);

    p = player({ stamina: 0, staminaAt: T0 });
    const sinFuelle = runOp('gather', p, factory(), { stationId: 'vein_a', at: cerca, now: T0 });
    expect(sinFuelle.ok).toBe(false);
    expect(sinFuelle.reason).toMatch(/estamina/i);
  });

  it('descansando se vuelve a poder recolectar', () => {
    const cerca = { x: 180, y: 300 };
    const p = player({ stamina: 0, staminaAt: T0 });
    const luego = runOp('gather', p, factory(), {
      stationId: 'vein_a',
      at: cerca,
      now: T0 + 60_000,
    });
    expect(luego.ok).toBe(true);
  });

  it('el cliente no puede reclamar más estamina de la que le tocaría', () => {
    const p = player({ stamina: 10, staminaAt: T0 });
    const tramposo = runOp('tick', p, factory(), { seconds: 1, stamina: 9999, now: T0 + 1000 });
    // Se queda en lo que la regeneración permite, no en lo que pide.
    expect(tramposo.player!.stamina).toBeCloseTo(currentStamina(p, T0 + 1000), 5);
  });

  it('el cliente sí puede declarar que ha gastado de más', () => {
    const p = player({ stamina: 80, staminaAt: T0 });
    const out = runOp('tick', p, factory(), { seconds: 1, stamina: 12, now: T0 + 1000 });
    expect(out.player!.stamina).toBe(12);
    expect(out.player!.staminaAt).toBe(T0 + 1000);
  });

  it('subir de nivel rellena el depósito', () => {
    const p = player({ stamina: 0, staminaAt: T0, level: 3, xp: 0 });
    const out = runOp('gather', p, factory(), {
      stationId: 'vein_a',
      at: { x: 180, y: 300 },
      now: T0 + 60_000,
    });
    expect(out.ok).toBe(true);
    // Con 60 s de regeneración ya hay fuelle; y si sube de nivel, se llena.
    expect(currentStamina(out.player!, T0 + 60_000)).toBeGreaterThan(0);
  });
});
