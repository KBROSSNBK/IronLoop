const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac'];

/** Números grandes compactos: 12.4K, 3.2M… Pensado para un incremental. */
export function compact(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  let v = Math.abs(n);
  if (v < 1000) return (neg ? '-' : '') + (Number.isInteger(v) ? String(v) : v.toFixed(digits));
  let i = 0;
  while (v >= 1000 && i < SUFFIXES.length - 1) {
    v /= 1000;
    i++;
  }
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(digits);
  return `${neg ? '-' : ''}${s.replace(/\.0$/, '')}${SUFFIXES[i]}`;
}

export function money(n: number): string {
  return `$${compact(Math.floor(n))}`;
}

export function moneyExact(n: number): string {
  return `$${Math.floor(n).toLocaleString('es-ES')}`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function percent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}
