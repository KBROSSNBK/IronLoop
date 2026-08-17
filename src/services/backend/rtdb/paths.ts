/**
 * DE UN ESTADO NUEVO A LAS RUTAS MÍNIMAS QUE HAY QUE ESCRIBIR.
 *
 * La Realtime Database no cobra por operaciones, cobra por DATOS que bajan a
 * los clientes. Escribir la fábrica entera en cada recado (unos 10 KB) haría
 * que los diez tripulantes se descargasen 10 KB cada vez: el mismo problema
 * que teníamos con Firestore, sólo que con otra factura.
 *
 * Así que en vez de mandar el documento completo se compara el estado viejo
 * con el nuevo y se manda SÓLO lo que ha cambiado, como un puñado de rutas
 * sueltas: `factories/f1/state/machines/smelter/cycles`. Un `update()` con
 * varias rutas es atómico —o entran todas o no entra ninguna—, así que no se
 * pierde la garantía que daba la transacción de Firestore.
 *
 * Todo esto es puro y sin dependencias: se puede probar sin tocar la red.
 */

/** La RTDB prohíbe estos caracteres en las claves de una ruta. */
const CLAVE_MALA = /[.$#[\]/]/;

export function claveValida(k: string): boolean {
  return k.length > 0 && k.length <= 700 && !CLAVE_MALA.test(k);
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Tope de rutas antes de rendirse y mandar el subárbol entero. Un cambio que
 * toca doscientas hojas ya no es un retoque: sale más barato reescribirlo.
 */
export const MAX_RUTAS = 160;

/** Igualdad profunda. Sólo hay datos de juego: números, textos, listas y mapas. */
export function igual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => igual(v, b[i]));
  }
  if (esObjeto(a) && esObjeto(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in b && igual(a[k], b[k]));
  }
  return false;
}

/**
 * Deja el valor listo para la RTDB: sin `undefined` (lo rechaza) y sin claves
 * con caracteres prohibidos. Un `undefined` dentro de una lista pasa a `null`
 * para no descolocar el resto de posiciones.
 */
export function limpiar<T>(v: T): T {
  if (Array.isArray(v)) {
    return v.map((x) => (x === undefined ? null : limpiar(x))) as unknown as T;
  }
  if (esObjeto(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined || !claveValida(k)) continue;
      out[k] = limpiar(val);
    }
    return out as unknown as T;
  }
  return v;
}

function recorrer(
  prev: unknown,
  next: unknown,
  base: string,
  out: Record<string, unknown>,
): boolean {
  // Desaparece: en la RTDB borrar es escribir `null`.
  if (next === undefined || next === null) {
    if (prev !== undefined && prev !== null) out[base] = null;
    return true;
  }

  // Hoja, lista, o cambio de forma (mapa que pasa a número, etc.): se manda
  // entero. Las listas de este juego son cortas —mochilas, misiones, la cola
  // de una cinta— y trocearlas por índice daría más problemas que ahorro.
  if (!esObjeto(prev) || !esObjeto(next)) {
    if (!igual(prev, next)) out[base] = limpiar(next);
    return true;
  }

  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!claveValida(k)) return false;
    const a = prev[k];
    const b = next[k];
    if (b === undefined) {
      // Una clave que estaba y ya no está: se borra explícitamente.
      if (a !== undefined) out[`${base}/${k}`] = null;
      continue;
    }
    if (igual(a, b)) continue;
    if (!recorrer(a, b, `${base}/${k}`, out)) return false;
    if (Object.keys(out).length > MAX_RUTAS) return false;
  }
  return true;
}

/**
 * Rutas que hay que escribir para pasar de `prev` a `next`, colgando de `base`.
 *
 * Devuelve `null` cuando no compensa (demasiadas rutas) o cuando alguna clave
 * no es válida para la RTDB: el llamante escribe entonces el subárbol entero,
 * que siempre es correcto aunque cueste más.
 */
export function diffRutas(
  prev: unknown,
  next: unknown,
  base: string,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (!recorrer(prev, next, base, out)) return null;
  if (Object.keys(out).length > MAX_RUTAS) return null;
  return out;
}

/**
 * Quita el `rev` con el que la fábrica lleva la cuenta de sus versiones. Es
 * contabilidad del backend, no estado de juego: el resto del código no debe
 * verlo ni arrastrarlo a otros sitios.
 */
export function sinRev<T extends object>(raw: T): T {
  if (!('rev' in raw)) return raw;
  const { rev: _rev, ...resto } = raw as T & { rev?: number };
  return resto as T;
}

/**
 * Tamaño aproximado en bytes de lo que va a viajar. Se usa para el medidor de
 * consumo: no es la factura de Google, pero sigue el mismo ritmo.
 */
export function pesoAprox(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}
