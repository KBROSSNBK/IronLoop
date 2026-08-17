import { describe, expect, it } from 'vitest';

import {
  MAX_RUTAS,
  claveValida,
  diffRutas,
  igual,
  limpiar,
  pesoAprox,
} from '../src/services/backend/rtdb/paths';

describe('diffRutas', () => {
  it('sólo manda la hoja que cambió, no el documento entero', () => {
    const prev = {
      level: 3,
      machines: { smelter: { level: 2, cycles: 10 }, lab: { level: 1, cycles: 0 } },
    };
    const next = {
      level: 3,
      machines: { smelter: { level: 2, cycles: 11 }, lab: { level: 1, cycles: 0 } },
    };
    expect(diffRutas(prev, next, 'f/state')).toEqual({
      'f/state/machines/smelter/cycles': 11,
    });
  });

  it('no manda nada cuando no ha cambiado nada', () => {
    const a = { level: 1, belts: { c1: { queue: [] } } };
    expect(diffRutas(a, structuredClone(a), 'f/state')).toEqual({});
  });

  it('borra con null la clave que desaparece', () => {
    const prev = { ground: { g1: { item: 'iron' }, g2: { item: 'copper' } } };
    const next = { ground: { g1: { item: 'iron' } } };
    expect(diffRutas(prev, next, 'f/state')).toEqual({
      'f/state/ground/g2': null,
    });
  });

  it('manda las listas enteras, no posición a posición', () => {
    const prev = { queue: [{ item: 'iron', qty: 4, at: 1 }] };
    const next = {
      queue: [
        { item: 'iron', qty: 4, at: 1 },
        { item: 'copper', qty: 2, at: 9 },
      ],
    };
    expect(diffRutas(prev, next, 'b/c1')).toEqual({
      'b/c1/queue': next.queue,
    });
  });

  it('escribe el subárbol entero cuando no había nada antes', () => {
    const next = { level: 1, machines: {} };
    const d = diffRutas(undefined, next, 'f/state');
    expect(d).toEqual({ 'f/state': next });
  });

  it('se rinde y devuelve null si hay demasiadas rutas', () => {
    const prev: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < MAX_RUTAS + 20; i++) {
      prev[`k${i}`] = 0;
      next[`k${i}`] = i + 1;
    }
    expect(diffRutas(prev, next, 'x')).toBeNull();
  });

  it('se rinde si alguna clave no vale para la RTDB', () => {
    // Las claves con punto rompen la ruta: mejor escribir el objeto entero.
    expect(diffRutas({}, { 'a.b': 1 }, 'x')).toBeNull();
  });

  it('trata el cambio de forma como una hoja', () => {
    expect(diffRutas({ v: { a: 1 } }, { v: 7 }, 'x')).toEqual({ 'x/v': 7 });
    expect(diffRutas({ v: 7 }, { v: { a: 1 } }, 'x')).toEqual({ 'x/v': { a: 1 } });
  });

  it('distingue 0 de ausente y no confunde números con textos', () => {
    expect(diffRutas({ n: 0 }, { n: 0 }, 'x')).toEqual({});
    expect(diffRutas({ n: 0 }, { n: '0' }, 'x')).toEqual({ 'x/n': '0' });
  });

  it('aplicado sobre el estado viejo reconstruye el nuevo', () => {
    const prev = {
      money: 100,
      inv: { iron: 3, copper: 1 },
      pet: { bags: [{ iron: 2 }, {}] },
    };
    const next = {
      money: 140,
      inv: { iron: 5 },
      pet: { bags: [{ iron: 2 }, { copper: 1 }] },
    };
    const d = diffRutas(prev, next, 'u/a')!;
    // Se simula lo que hace la RTDB con un update multi-ruta.
    const doc = structuredClone(prev) as Record<string, unknown>;
    for (const [ruta, val] of Object.entries(d)) {
      const partes = ruta.replace('u/a/', '').split('/');
      let nodo = doc as Record<string, unknown>;
      for (const p of partes.slice(0, -1)) nodo = nodo[p] as Record<string, unknown>;
      const hoja = partes[partes.length - 1];
      if (val === null) delete nodo[hoja];
      else nodo[hoja] = val;
    }
    expect(doc).toEqual(next);
  });
});

describe('limpiar', () => {
  it('quita los undefined, que la RTDB rechaza', () => {
    expect(limpiar({ a: 1, b: undefined, c: { d: undefined, e: 2 } })).toEqual({
      a: 1,
      c: { e: 2 },
    });
  });

  it('convierte los huecos de una lista en null para no descolocarla', () => {
    expect(limpiar([1, undefined, 3])).toEqual([1, null, 3]);
  });

  it('descarta claves que la RTDB no admite', () => {
    expect(limpiar({ 'a/b': 1, ok: 2 })).toEqual({ ok: 2 });
  });

  it('deja intactos los valores normales', () => {
    const v = { a: 0, b: '', c: false, d: null, e: [1, 2] };
    expect(limpiar(v)).toEqual(v);
  });
});

describe('claveValida', () => {
  it('acepta los identificadores del juego', () => {
    for (const k of ['ironOre', 'c8', 'smelter', 'uid_123-x']) {
      expect(claveValida(k)).toBe(true);
    }
  });

  it('rechaza lo que rompería una ruta', () => {
    for (const k of ['', 'a.b', 'a/b', 'a$b', 'a#b', 'a[b]']) {
      expect(claveValida(k)).toBe(false);
    }
  });
});

describe('igual', () => {
  it('compara en profundidad', () => {
    expect(igual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(igual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(igual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});

describe('pesoAprox', () => {
  it('mide sin reventar con referencias circulares', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(pesoAprox(a)).toBe(0);
    expect(pesoAprox({ a: 1 })).toBeGreaterThan(0);
  });
});
