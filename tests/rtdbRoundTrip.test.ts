/**
 * IDA Y VUELTA POR LA REALTIME DATABASE.
 *
 * Guardar el estado en la RTDB no es guardar un JSON: la base de datos tiene
 * manías propias que han costado partidas en otros juegos. Borra los objetos
 * vacíos, borra las listas vacías, convierte una lista con huecos en un mapa de
 * números y rechaza `undefined`. Si el estado no sobrevive a eso, se pierden
 * items — que es justo lo que no puede pasar.
 *
 * Aquí se simula ese comportamiento de verdad y se hacen pasar operaciones
 * reales del juego por el circuito completo: operación → diff de rutas →
 * escritura multi-ruta → lo que la RTDB devolvería → normalización. Al final se
 * compara con ejecutar lo mismo en memoria. Si algo se pierde por el camino,
 * estas pruebas se caen.
 */

import { describe, expect, it } from 'vitest';

import { STATIONS } from '../src/config/world';
import { runOp } from '../src/services/backend/ops';
import {
  createFactoryState,
  createPlayerState,
  normalizeFactory,
  normalizePlayer,
} from '../src/game/logic/defaults';
import { getMachine } from '../src/config/machines';
import { beltCount } from '../src/game/logic/belts';
import { diffRutas, limpiar, sinRev } from '../src/services/backend/rtdb/paths';
import type { FactoryState, PlayerState } from '../src/types';

const T0 = 1_700_000_000_000;
const user = (uid: string) => ({ uid, displayName: uid, photoURL: null, email: null });
const noLuck = () => 0.99;

const EN_VETA = (id: string) => {
  const s = STATIONS.find((x) => x.id === id)!;
  return { x: (s.tx + s.tw / 2) * 40, y: (s.ty + s.th + 0.4) * 40 };
};
const AT = (id: string) => {
  const m = getMachine(id);
  return { x: (m.tx + m.tw / 2) * 40, y: (m.ty + m.th + 0.4) * 40 };
};

/* ────────────── simulación de la Realtime Database ────────────── */

type Nodo = Record<string, unknown>;

/**
 * Lo que la RTDB devuelve al leer, con todas sus manías:
 *  · un objeto sin hijos no existe → `undefined`
 *  · una lista se guarda como mapa de índices; si algún elemento se poda, al
 *    leerla vuelven huecos `null` (o directamente un mapa, si es muy dispersa)
 *  · `null` es lo mismo que no estar
 */
function comoLoDevuelve(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const podados = v.map(comoLoDevuelve);
    if (podados.every((x) => x === undefined)) return undefined;
    // Los huecos vuelven como null, igual que hace Firebase.
    return podados.map((x) => (x === undefined ? null : x));
  }
  if (typeof v === 'object') {
    const out: Nodo = {};
    for (const [k, val] of Object.entries(v as Nodo)) {
      const limpio = comoLoDevuelve(val);
      if (limpio !== undefined) out[k] = limpio;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return v;
}

/** `update()` multi-ruta: escribe cada ruta absoluta; `null` borra. */
function aplicarUpdate(raiz: Nodo, cambios: Record<string, unknown>): void {
  for (const [ruta, valor] of Object.entries(cambios)) {
    const partes = ruta.split('/');
    let nodo = raiz;
    for (const p of partes.slice(0, -1)) {
      if (typeof nodo[p] !== 'object' || nodo[p] === null || Array.isArray(nodo[p])) {
        nodo[p] = {};
      }
      nodo = nodo[p] as Nodo;
    }
    const hoja = partes[partes.length - 1];
    if (valor === null) delete nodo[hoja];
    else nodo[hoja] = structuredClone(valor);
  }
}

/** Base de datos de mentira que se comporta como la de verdad. */
class RtdbFalsa {
  private raiz: Nodo = {};

  escribir(cambios: Record<string, unknown>): void {
    // Igual que el backend: nada de `undefined` ni claves prohibidas.
    const listo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cambios)) listo[k] = limpiar(v);
    aplicarUpdate(this.raiz, listo);
  }

  leer<T>(ruta: string): T | undefined {
    let nodo: unknown = this.raiz;
    for (const p of ruta.split('/')) {
      if (typeof nodo !== 'object' || nodo === null) return undefined;
      nodo = (nodo as Nodo)[p];
    }
    return comoLoDevuelve(nodo) as T | undefined;
  }
}

/**
 * Espejo del backend: guarda con diff de rutas y relee como haría el cliente.
 * Es deliberadamente la MISMA estrategia que `RtdbBackend.planear`.
 */
class Espejo {
  db = new RtdbFalsa();
  private revF = 0;

  /** Con nombres, no por posición: confundir prev con next no se ve venir. */
  guardar(c: {
    uid: string;
    fid: string;
    prevP?: PlayerState;
    nextP?: PlayerState;
    prevF?: FactoryState;
    nextF?: FactoryState;
  }): void {
    const cambios: Record<string, unknown> = {};
    if (c.nextP) this.planear(`users/${c.uid}`, c.prevP, c.nextP, cambios, false);
    if (c.nextF) {
      this.planear(`factories/${c.fid}/state`, c.prevF, c.nextF, cambios, true);
    }
    if (Object.keys(cambios).length > 0) this.db.escribir(cambios);
  }

  private planear(
    base: string,
    prev: unknown,
    next: object,
    cambios: Record<string, unknown>,
    conRev: boolean,
  ): void {
    const d = diffRutas(prev, next, base);
    if (d === null || d[base] !== undefined) {
      cambios[base] = conRev ? { ...next, rev: ++this.revF } : next;
      return;
    }
    if (Object.keys(d).length === 0) return;
    Object.assign(cambios, d);
    if (conRev) cambios[`${base}/rev`] = ++this.revF;
  }

  jugador(uid: string): PlayerState {
    return normalizePlayer(sinRev(this.db.leer<Partial<PlayerState>>(`users/${uid}`) ?? {}));
  }

  fabrica(fid: string): FactoryState {
    return normalizeFactory(
      sinRev(this.db.leer<Partial<FactoryState>>(`factories/${fid}/state`) ?? {}),
      fid,
    );
  }
}

/* ─────────────────────────── pruebas ─────────────────────────── */

function mundo() {
  const player = createPlayerState(user('u1'), T0);
  const factory = createFactoryState('f1', 1, T0);
  return { player, factory };
}

describe('el estado sobrevive a la ida y vuelta por la RTDB', () => {
  it('guarda una partida nueva y la devuelve intacta', () => {
    const { player, factory } = mundo();
    const e = new Espejo();
    e.db.escribir({ 'users/u1': player, 'factories/f1/state': { ...factory, rev: 0 } });

    expect(e.jugador('u1')).toEqual(normalizePlayer(player));
    expect(e.fabrica('f1')).toEqual(normalizeFactory(factory, 'f1'));
  });

  it('una cadena de operaciones acaba en el mismo estado que en memoria', () => {
    let { player, factory } = mundo();
    const e = new Espejo();
    e.db.escribir({ 'users/u1': player, 'factories/f1/state': { ...factory, rev: 0 } });

    // Picar, picar, cargar la fundidora: el recorrido normal de una partida.
    const pasos: { op: string; args: Record<string, unknown> }[] = [
      { op: 'gather', args: { stationId: 'vein_a', at: EN_VETA('vein_a'), now: T0, rand: noLuck } },
      { op: 'gather', args: { stationId: 'vein_a', at: EN_VETA('vein_a'), now: T0 + 2000, rand: noLuck } },
      { op: 'gather', args: { stationId: 'vein_a', at: EN_VETA('vein_a'), now: T0 + 4000, rand: noLuck } },
      { op: 'deposit', args: { machineId: 'smelter', at: AT('smelter'), item: 'ore', now: T0 + 5000 } },
    ];

    for (const paso of pasos) {
      // Se ejecuta sobre lo que devuelve la base de datos, no sobre la copia
      // en memoria: así se comprueba el circuito entero.
      const desdeDb = { p: e.jugador('u1'), f: e.fabrica('f1') };
      const out = runOp(paso.op as never, desdeDb.p, desdeDb.f, paso.args as never);
      expect(out.ok, `${paso.op}: ${out.reason}`).toBe(true);
      e.guardar({ uid: 'u1', fid: 'f1', prevP: desdeDb.p, prevF: desdeDb.f, nextP: out.player, nextF: out.factory });

      // Y lo mismo en memoria pura, para comparar al final.
      const puro = runOp(paso.op as never, player, factory, paso.args as never);
      player = puro.player ?? player;
      factory = puro.factory ?? factory;
    }

    const finalP = e.jugador('u1');
    const finalF = e.fabrica('f1');
    expect(finalP.inventory).toEqual(normalizePlayer(player).inventory);
    expect(finalP.xp).toBe(player.xp);
    expect(finalP.money).toBe(player.money);
    expect(finalF.machines.smelter.input).toEqual(factory.machines.smelter.input);
    expect(finalF.stats).toEqual(factory.stats);
  });

  it('no pierde el material de una cinta al vaciarse y volver a llenarse', () => {
    const { player, factory } = mundo();
    const e = new Espejo();
    const conCarga: FactoryState = {
      ...factory,
      belts: { c1: { queue: [{ item: 'ore', qty: 128, at: T0 }] } },
    };
    e.db.escribir({ 'users/u1': player, 'factories/f1/state': { ...conCarga, rev: 0 } });
    expect(e.fabrica('f1').belts.c1.queue[0].qty).toBe(128);

    // La cinta entrega y queda vacía: la RTDB borra la lista entera.
    const vacia: FactoryState = { ...conCarga, belts: { c1: { queue: [] } } };
    e.guardar({ uid: 'u1', fid: 'f1', prevF: conCarga, nextF: vacia });
    // La RTDB no guarda listas vacías: poda la cinta entera. Lo que importa es
    // que leerla no reviente y que cuente cero, no que quede un hueco con forma.
    const vaciada = e.fabrica('f1');
    expect(() => beltCount(vaciada.belts.c1, 'c1', T0 + 1)).not.toThrow();
    expect(beltCount(vaciada.belts.c1, 'c1', T0 + 1)).toBe(0);

    // Y vuelve a cargarse sin arrastrar restos de la tanda anterior.
    const otra: FactoryState = {
      ...vacia,
      belts: { c1: { queue: [{ item: 'copper', qty: 7, at: T0 + 9000 }] } },
    };
    e.guardar({ uid: 'u1', fid: 'f1', prevF: vacia, nextF: otra });
    expect(e.fabrica('f1').belts.c1.queue).toEqual([
      { item: 'copper', qty: 7, at: T0 + 9000 },
    ]);
  });

  it('las mochilas de los perros no se mezclan al vaciarse una', () => {
    const { player, factory } = mundo();
    const e = new Espejo();
    const conBolsas: PlayerState = {
      ...player,
      pet: { ...player.pet, bags: [{ ore: 4 }, { copper: 2 }, {}] },
    };
    e.db.escribir({ 'users/u1': conBolsas, 'factories/f1/state': { ...factory, rev: 0 } });
    expect(e.jugador('u1').pet.bags[0]).toEqual({ ore: 4 });
    expect(e.jugador('u1').pet.bags[1]).toEqual({ copper: 2 });

    // El primer perro descarga: su mochila queda vacía y la RTDB la poda. El
    // segundo NO puede heredar su contenido ni cambiar de posición.
    const tras: PlayerState = {
      ...conBolsas,
      pet: { ...conBolsas.pet, bags: [{}, { copper: 2 }, {}] },
    };
    e.guardar({ uid: 'u1', fid: 'f1', prevP: conBolsas, nextP: tras });
    const leido = e.jugador('u1');
    expect(leido.pet.bags[0]).toEqual({});
    expect(leido.pet.bags[1]).toEqual({ copper: 2 });
  });

  it('borrar un objeto del suelo no arrastra a los demás', () => {
    const { player, factory } = mundo();
    const e = new Espejo();
    const conSuelo: FactoryState = {
      ...factory,
      ground: {
        g1: { id: 'g1', item: 'ore', qty: 3, x: 10, y: 20, by: 'u1', droppedAt: T0 },
        g2: { id: 'g2', item: 'copper', qty: 1, x: 30, y: 40, by: 'u1', droppedAt: T0 },
      },
    };
    e.db.escribir({ 'users/u1': player, 'factories/f1/state': { ...conSuelo, rev: 0 } });

    const tras: FactoryState = { ...conSuelo, ground: { g2: conSuelo.ground.g2 } };
    e.guardar({ uid: 'u1', fid: 'f1', prevF: conSuelo, nextF: tras });

    const leido = e.fabrica('f1');
    expect(leido.ground.g1).toBeUndefined();
    expect(leido.ground.g2).toEqual(conSuelo.ground.g2);
  });

  it('el inventario que llega a cero desaparece en vez de quedarse a medias', () => {
    const { player, factory } = mundo();
    const e = new Espejo();
    const lleno: PlayerState = { ...player, inventory: { ore: 5, copper: 2 } };
    e.db.escribir({ 'users/u1': lleno, 'factories/f1/state': { ...factory, rev: 0 } });

    const gastado: PlayerState = { ...lleno, inventory: { copper: 2 } };
    e.guardar({ uid: 'u1', fid: 'f1', prevP: lleno, nextP: gastado });
    expect(e.jugador('u1').inventory).toEqual({ copper: 2 });
  });

  it('la rev de la fábrica avanza de uno en uno para que las reglas la acepten', () => {
    const { player, factory } = mundo();
    const e = new Espejo();
    e.db.escribir({ 'users/u1': player, 'factories/f1/state': { ...factory, rev: 0 } });

    let anterior = factory;
    for (let i = 1; i <= 3; i++) {
      const siguiente: FactoryState = { ...anterior, contribution: i * 10 };
      e.guardar({ uid: 'u1', fid: 'f1', prevF: anterior, nextF: siguiente });
      expect(e.db.leer<number>('factories/f1/state/rev')).toBe(i);
      anterior = siguiente;
    }
  });

  it('una operación que no cambia nada no escribe nada', () => {
    const { player, factory } = mundo();
    const e = new Espejo();
    e.db.escribir({ 'users/u1': player, 'factories/f1/state': { ...factory, rev: 0 } });

    e.guardar({ uid: 'u1', fid: 'f1', prevP: player, nextP: player, prevF: factory, nextF: factory });
    // La rev no se ha movido: no ha habido escritura.
    expect(e.db.leer<number>('factories/f1/state/rev')).toBe(0);
  });
});
