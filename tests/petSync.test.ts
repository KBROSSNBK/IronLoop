/**
 * Las mascotas de los demás tienen que verse donde de verdad están. Esto
 * cubre el viaje completo: empaquetar, sobrevivir a la Realtime Database
 * —que devuelve las listas a su manera— y volver a salir enteras.
 */

import { describe, expect, it } from 'vitest';

import {
  ACT_ANDAR,
  ACT_MINAR,
  ACT_SOLTAR,
  RemoteHerd,
  actDesdeCaex,
  actDesdeEstado,
  desempaquetar,
  empaquetar,
  estadoDesdeAct,
  mereceMandar,
} from '../src/game/systems/petSync';

describe('empaquetado de la jauría', () => {
  it('mete cada perro en tres números y los saca igual', () => {
    const jauria = [
      { x: 100.4, y: 200.6, state: 'MINAR' as const },
      { x: 300, y: 410, state: 'SEGUIR' as const },
    ];
    const packed = empaquetar(jauria);
    expect(packed).toEqual([100, 201, ACT_MINAR, 300, 410, ACT_ANDAR]);
    expect(desempaquetar(packed)).toEqual([
      { x: 100, y: 201, act: ACT_MINAR },
      { x: 300, y: 410, act: ACT_ANDAR },
    ]);
  });

  it('traduce los estados que se ven distintos', () => {
    expect(actDesdeEstado('MINAR')).toBe(ACT_MINAR);
    expect(actDesdeEstado('DESCARGAR')).toBe(ACT_SOLTAR);
    for (const s of ['SEGUIR', 'IR_A_VETA', 'IR_A_CINTA', 'VOLVER'] as const) {
      expect(actDesdeEstado(s)).toBe(ACT_ANDAR);
    }
    // Un perro que pica se dibuja picando, no trotando: ese era el fallo.
    expect(estadoDesdeAct(ACT_MINAR)).toBe('MINAR');
    expect(estadoDesdeAct(ACT_SOLTAR)).toBe('DESCARGAR');
    expect(estadoDesdeAct(ACT_ANDAR)).toBe('SEGUIR');
  });

  it('el camión tiene sus propios nombres de estado', () => {
    expect(actDesdeCaex('CARGANDO')).toBe(ACT_MINAR);
    expect(actDesdeCaex('VACIANDO')).toBe(ACT_SOLTAR);
    expect(actDesdeCaex('EN_RUTA')).toBe(ACT_ANDAR);
    expect(actDesdeCaex('PARADO')).toBe(ACT_ANDAR);
  });

  it('aguanta que la RTDB devuelva la lista como mapa de índices', () => {
    // Es lo que hace cuando la lista le parece dispersa.
    const comoMapa = { 0: 10, 1: 20, 2: 1, 3: 30, 4: 40, 5: 0 };
    expect(desempaquetar(comoMapa)).toEqual([
      { x: 10, y: 20, act: ACT_MINAR },
      { x: 30, y: 40, act: ACT_ANDAR },
    ]);
  });

  it('no dibuja media mascota si llega una tripleta a medias', () => {
    expect(desempaquetar([10, 20, 1, 30])).toEqual([{ x: 10, y: 20, act: ACT_MINAR }]);
    expect(desempaquetar([10, 20])).toEqual([]);
  });

  it('descarta basura sin tumbar el dibujado', () => {
    expect(desempaquetar(null)).toEqual([]);
    expect(desempaquetar(undefined)).toEqual([]);
    expect(desempaquetar([])).toEqual([]);
    expect(desempaquetar('lo que sea')).toEqual([]);
    expect(desempaquetar([NaN, 5, 0])).toEqual([]);
    expect(desempaquetar(['a', 'b', 'c'])).toEqual([]);
  });

  it('sin jauría no manda nada', () => {
    expect(empaquetar([])).toEqual([]);
  });
});

describe('cuándo merece la pena gastar una escritura', () => {
  it('un tembleque de un píxel no se manda', () => {
    expect(mereceMandar([100, 200, 0], [101, 200, 0])).toBe(false);
  });

  it('un movimiento de verdad sí', () => {
    expect(mereceMandar([100, 200, 0], [140, 200, 0])).toBe(true);
    expect(mereceMandar([100, 200, 0], [100, 260, 0])).toBe(true);
  });

  it('ponerse a picar se manda al instante aunque no se haya movido', () => {
    // Es el dato que más se nota y el que motivó todo esto.
    expect(mereceMandar([100, 200, ACT_ANDAR], [100, 200, ACT_MINAR])).toBe(true);
  });

  it('un perro que aparece o desaparece se manda', () => {
    expect(mereceMandar([], [100, 200, 0])).toBe(true);
    expect(mereceMandar([100, 200, 0, 5, 5, 0], [100, 200, 0])).toBe(true);
  });
});

describe('la jauría ajena, interpolada', () => {
  it('la primera foto la planta donde está, sin deslizarse desde el cero', () => {
    const h = new RemoteHerd();
    h.target([500, 600, ACT_MINAR], 0);
    h.update(0, 320);
    expect(h.list[0].x).toBe(500);
    expect(h.list[0].y).toBe(600);
    expect(h.list[0].act).toBe(ACT_MINAR);
  });

  it('se desliza hacia la foto nueva en vez de saltar', () => {
    const h = new RemoteHerd();
    h.target([0, 0, ACT_ANDAR], 0);
    h.update(0, 320);
    h.target([320, 0, ACT_ANDAR], 1000);

    h.update(1160, 320); // a mitad de ventana
    expect(h.list[0].x).toBeGreaterThan(100);
    expect(h.list[0].x).toBeLessThan(240);

    h.update(1320, 320); // ventana cumplida
    expect(h.list[0].x).toBe(320);
  });

  it('mira hacia donde camina', () => {
    const h = new RemoteHerd();
    h.target([0, 0, ACT_ANDAR], 0);
    h.update(0, 320);
    h.target([200, 0, ACT_ANDAR], 0);
    h.update(320, 320);
    expect(h.list[0].facing).toBe(1);
    h.target([-200, 0, ACT_ANDAR], 320);
    h.update(640, 320);
    expect(h.list[0].facing).toBe(-1);
  });

  it('el trote avanza sólo cuando se recorre distancia', () => {
    const h = new RemoteHerd();
    h.target([0, 0, ACT_ANDAR], 0);
    h.update(0, 320);
    const quieto = h.list[0].gait;
    h.update(320, 320);
    expect(h.list[0].gait).toBe(quieto);

    h.target([340, 0, ACT_ANDAR], 320);
    h.update(640, 320);
    expect(h.list[0].gait).toBeGreaterThan(quieto);
  });

  it('si el dueño se queda con menos perros, los sobrantes desaparecen', () => {
    const h = new RemoteHerd();
    h.target([0, 0, 0, 50, 50, 0, 90, 90, 0], 0);
    expect(h.list).toHaveLength(3);
    h.target([0, 0, 0], 100);
    expect(h.list).toHaveLength(1);
  });

  it('sin datos no inventa mascotas', () => {
    const h = new RemoteHerd();
    h.target(null, 0);
    h.update(100, 320);
    expect(h.list).toHaveLength(0);
  });
});
