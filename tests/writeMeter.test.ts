/**
 * El medidor de cuota es lo único que avisa antes de que la partida se muera
 * con un «Quota exceeded», así que tiene que contar bien y reiniciarse solo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CLAVE = 'ironloop:writes';

// Las pruebas corren en Node, que no tiene localStorage. El medidor ya lo
// aguanta —lee dentro de un try— pero aquí hace falta uno de verdad para
// comprobar que respeta lo guardado entre recargas.
const almacen = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, v),
  removeItem: (k: string) => void almacen.delete(k),
  clear: () => almacen.clear(),
});

/** Se importa fresco en cada prueba: el módulo guarda estado en memoria. */
async function cargar() {
  vi.resetModules();
  return import('../src/services/writeMeter');
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('medidor de escrituras (Firestore)', () => {
  it('descuenta de la cuota diaria', async () => {
    const m = await cargar();
    m.setMeterMode('ops');
    m.addWrites(20);
    m.markWrites(20);
    const b = m.writeBudget();
    expect(b.mode).toBe('ops');
    expect(b.left).toBe((20_000 - 20).toLocaleString('es'));
    expect(b.detail).toMatch(/20 de 20.000/);
  });

  it('estima los minutos que quedan con el ritmo del último minuto', async () => {
    const m = await cargar();
    m.setMeterMode('ops');
    m.addWrites(100);
    m.markWrites(100);
    // 100 por minuto sobre 19.900 restantes → 199 minutos.
    expect(m.writeBudget().minutesLeft).toBeCloseTo(199, 0);
  });

  it('sin escrituras recientes no promete un final', async () => {
    const m = await cargar();
    m.setMeterMode('ops');
    expect(m.writeBudget().minutesLeft).toBe(Infinity);
  });

  it('empieza de cero si lo guardado es de otro día', async () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({ dia: '1999-1-1', ops: 19_000, mes: '1999-1', bytes: 5 }),
    );
    const m = await cargar();
    m.setMeterMode('ops');
    expect(m.writeBudget().left).toBe((20_000).toLocaleString('es'));
  });

  it('respeta lo ya gastado hoy al recargar la página', async () => {
    const hoy = new Date();
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        dia: `${hoy.getFullYear()}-${hoy.getMonth() + 1}-${hoy.getDate()}`,
        ops: 1234,
      }),
    );
    const m = await cargar();
    m.setMeterMode('ops');
    // Sin separador de miles literal: Node y el navegador no formatean igual.
    expect(m.writeBudget().detail).toContain(`${(1234).toLocaleString('es')} de`);
  });

  it('entiende el formato viejo, que sólo guardaba `total`', async () => {
    const hoy = new Date();
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        dia: `${hoy.getFullYear()}-${hoy.getMonth() + 1}-${hoy.getDate()}`,
        total: 500,
      }),
    );
    const m = await cargar();
    m.setMeterMode('ops');
    expect(m.writeBudget().detail).toMatch(/^500 de/);
  });
});

describe('medidor de datos (Realtime Database)', () => {
  it('mide contra los 10 GB del mes, no contra escrituras', async () => {
    const m = await cargar();
    m.setMeterMode('data');
    m.addBytes(50 * 1024 * 1024); // 50 MB
    const b = m.writeBudget();
    expect(b.mode).toBe('data');
    expect(b.left).toMatch(/GB$/);
    expect(b.detail).toMatch(/50 MB de 10 GB/);
    // 50 MB de 10 GB es medio por ciento: el medidor debe seguir en verde.
    expect(b.ratio).toBeLessThan(0.01);
  });

  it('a este ritmo el mes no se acaba: quedan miles de minutos', async () => {
    const m = await cargar();
    m.setMeterMode('data');
    // Ritmo realista medido en el juego: unos pocos KB por minuto.
    m.addBytes(4 * 1024);
    expect(m.writeBudget().minutesLeft).toBeGreaterThan(100_000);
  });

  it('empieza de cero si lo guardado es de otro mes', async () => {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({ dia: '1999-1-1', ops: 0, mes: '1999-1', bytes: 9e9 }),
    );
    const m = await cargar();
    m.setMeterMode('data');
    expect(m.writeBudget().ratio).toBe(0);
  });

  it('aguanta un localStorage roto sin tumbar el juego', async () => {
    localStorage.setItem(CLAVE, 'esto no es json');
    const m = await cargar();
    m.setMeterMode('ops');
    expect(m.writeBudget().ratio).toBe(0);
  });
});
