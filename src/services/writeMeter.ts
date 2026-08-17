/**
 * CONTADOR DE ESCRITURAS DEL DÍA.
 *
 * Firestore no cobra por datos, cobra por escrituras: 20.000 al día en el
 * plan gratuito. Cuando se agotan, la partida deja de responder con un
 * «Quota exceeded» y no hay forma de saber por qué ni cuánto queda.
 *
 * Esto lleva la cuenta en el propio navegador y la enseña en pantalla junto a
 * los FPS. No es contabilidad exacta de Google —no tenemos acceso a eso— pero
 * cuenta lo mismo que se manda: un documento tocado, una escritura. Sirve
 * para lo que importa: ver si te queda tarde o si algo está desbocado.
 */

const CUOTA_DIARIA = 20_000;
const CLAVE = 'ironloop:writes';

interface Registro {
  /** Día local en formato AAAA-MM-DD: al cambiar, la cuenta se reinicia. */
  dia: string;
  total: number;
}

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function leer(): Registro {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw) {
      const r = JSON.parse(raw) as Registro;
      if (r?.dia === hoy() && Number.isFinite(r.total)) return r;
    }
  } catch {
    // localStorage lleno o bloqueado: se empieza de cero, no es crítico.
  }
  return { dia: hoy(), total: 0 };
}

let registro = leer();
let guardadoAt = 0;

/** Suma escrituras y devuelve el total del día. */
export function addWrites(n: number): number {
  if (n <= 0) return registro.total;
  if (registro.dia !== hoy()) registro = { dia: hoy(), total: 0 };
  registro.total += n;
  // Se persiste con calma: esto es un contador, no vale la pena escribirlo
  // en disco sesenta veces por segundo.
  const ahora = Date.now();
  if (ahora - guardadoAt > 4000) {
    guardadoAt = ahora;
    try {
      localStorage.setItem(CLAVE, JSON.stringify(registro));
    } catch {
      // Sin sitio para guardarlo: la cuenta sigue viva en memoria.
    }
  }
  return registro.total;
}

export interface WriteBudget {
  /** Escrituras hechas hoy. */
  used: number;
  /** Cuántas quedan del plan gratuito. */
  left: number;
  /** 0..1 de cuota consumida. */
  ratio: number;
  /** Escrituras por minuto de los últimos instantes. */
  perMinute: number;
  /** Minutos que quedan a este ritmo. `Infinity` si no se está escribiendo. */
  minutesLeft: number;
}

/* Ritmo reciente: ventana deslizante de un minuto. */
const marcas: number[] = [];

export function markWrites(n: number): void {
  const ahora = Date.now();
  for (let i = 0; i < n; i++) marcas.push(ahora);
  while (marcas.length > 0 && ahora - marcas[0] > 60_000) marcas.shift();
}

export function writeBudget(): WriteBudget {
  const used = registro.total;
  const left = Math.max(0, CUOTA_DIARIA - used);
  const ahora = Date.now();
  while (marcas.length > 0 && ahora - marcas[0] > 60_000) marcas.shift();
  const perMinute = marcas.length;
  return {
    used,
    left,
    ratio: Math.min(1, used / CUOTA_DIARIA),
    perMinute,
    minutesLeft: perMinute > 0 ? left / perMinute : Infinity,
  };
}

export const WRITE_QUOTA = CUOTA_DIARIA;
