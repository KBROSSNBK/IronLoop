/**
 * MEDIDOR DE CUOTA.
 *
 * El plan gratuito de Firebase cobra cosas distintas según dónde viva la
 * partida, así que aquí se llevan las dos cuentas y se enseña la que toca:
 *
 *   · Firestore → OPERACIONES: 20.000 escrituras al día. Se agotan en una
 *     tarde con la fábrica automatizada y la partida muere sin explicar por qué.
 *   · Realtime Database → DATOS: 10 GB de bajada al mes. Este juego mueve unos
 *     pocos kilobytes por minuto, así que en la práctica no se toca.
 *
 * No es la contabilidad de Google —no tenemos acceso a eso—, es lo mismo que
 * manda y recibe este navegador. Con los bytes se peca de prudente a propósito:
 * se suma también lo que SUBE, que en realidad no se factura. Más vale que el
 * medidor vaya por delante de la factura que por detrás.
 */

const CUOTA_OPS = 20_000;
const CUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB al mes
const CLAVE = 'ironloop:writes';

type Modo = 'ops' | 'data';

interface Registro {
  /** Día local (AAAA-M-D) para las operaciones: al cambiar, a cero. */
  dia: string;
  ops: number;
  /** Mes local (AAAA-M) para los datos. */
  mes: string;
  bytes: number;
}

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function leer(): Registro {
  const limpio: Registro = { dia: hoy(), ops: 0, mes: mesActual(), bytes: 0 };
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return limpio;
    const r = JSON.parse(raw) as Partial<Registro> & { total?: number };
    // `total` es como se llamaba cuando sólo se contaban escrituras.
    const ops = Number.isFinite(r.ops) ? r.ops! : (r.total ?? 0);
    return {
      dia: r.dia === hoy() ? r.dia : hoy(),
      ops: r.dia === hoy() && Number.isFinite(ops) ? ops : 0,
      mes: r.mes === mesActual() ? r.mes : mesActual(),
      bytes: r.mes === mesActual() && Number.isFinite(r.bytes) ? r.bytes! : 0,
    };
  } catch {
    // localStorage lleno o bloqueado: se empieza de cero, no es crítico.
    return limpio;
  }
}

let registro = leer();
let modo: Modo = 'ops';
let guardadoAt = 0;

/** Qué se está midiendo. Lo fija el arranque según el backend elegido. */
export function setMeterMode(m: Modo): void {
  modo = m;
}

function persistir(): void {
  // Se guarda con calma: esto es un contador, no vale la pena escribirlo en
  // disco sesenta veces por segundo.
  const ahora = Date.now();
  if (ahora - guardadoAt < 4000) return;
  guardadoAt = ahora;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(registro));
  } catch {
    // Sin sitio para guardarlo: la cuenta sigue viva en memoria.
  }
}

function rodar(): void {
  if (registro.dia !== hoy()) {
    registro.dia = hoy();
    registro.ops = 0;
  }
  if (registro.mes !== mesActual()) {
    registro.mes = mesActual();
    registro.bytes = 0;
  }
}

/** Suma escrituras (Firestore) y devuelve el total del día. */
export function addWrites(n: number): number {
  if (n <= 0) return registro.ops;
  rodar();
  registro.ops += n;
  persistir();
  return registro.ops;
}

/** Suma bytes movidos (Realtime Database) y devuelve el total del mes. */
export function addBytes(n: number): number {
  if (n <= 0) return registro.bytes;
  rodar();
  registro.bytes += n;
  marcar(n);
  persistir();
  return registro.bytes;
}

export interface Budget {
  /** Qué se está midiendo, para que la UI no tenga que adivinarlo. */
  mode: Modo;
  /** Lo que queda, ya formateado: «19.956» o «9,84 GB». */
  left: string;
  /** 0..1 de cuota consumida. */
  ratio: number;
  /** Minutos que quedan a este ritmo. `Infinity` si no se está gastando. */
  minutesLeft: number;
  /** Texto largo para el tooltip. */
  detail: string;
}

/* Ritmo reciente: ventana deslizante de un minuto. */
const marcas: { t: number; n: number }[] = [];

function marcar(n: number): void {
  const ahora = Date.now();
  marcas.push({ t: ahora, n });
  while (marcas.length > 0 && ahora - marcas[0].t > 60_000) marcas.shift();
}

/** Marca escrituras para el cálculo de ritmo (una entrada por escritura). */
export function markWrites(n: number): void {
  for (let i = 0; i < n; i++) marcar(1);
}

function ritmo(): number {
  const ahora = Date.now();
  while (marcas.length > 0 && ahora - marcas[0].t > 60_000) marcas.shift();
  return marcas.reduce((s, m) => s + m.n, 0);
}

function gigas(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2).replace('.', ',')} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1).replace('.', ',')} MB`;
}

export function writeBudget(): Budget {
  rodar();
  const porMinuto = ritmo();

  if (modo === 'data') {
    const left = Math.max(0, CUOTA_BYTES - registro.bytes);
    const kbMin = porMinuto / 1024;
    return {
      mode: 'data',
      left: gigas(left),
      ratio: Math.min(1, registro.bytes / CUOTA_BYTES),
      minutesLeft: porMinuto > 0 ? left / porMinuto : Infinity,
      detail:
        `${gigas(registro.bytes)} de 10 GB usados este mes · ` +
        `${kbMin.toFixed(1).replace('.', ',')} KB/min`,
    };
  }

  const left = Math.max(0, CUOTA_OPS - registro.ops);
  return {
    mode: 'ops',
    left: left.toLocaleString('es'),
    ratio: Math.min(1, registro.ops / CUOTA_OPS),
    minutesLeft: porMinuto > 0 ? left / porMinuto : Infinity,
    detail:
      `${registro.ops.toLocaleString('es')} de ${CUOTA_OPS.toLocaleString('es')} ` +
      `escrituras usadas hoy · ${porMinuto}/min`,
  };
}

export const WRITE_QUOTA = CUOTA_OPS;
