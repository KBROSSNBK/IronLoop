/**
 * Genera los iconos PNG de la PWA sin dependencias externas.
 * Dibuja un engranaje sobre fondo industrial y codifica el PNG a mano
 * (IHDR + IDAT con zlib + IEND).
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/icons');

/* ── CRC32 ── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtro None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Dibujo ── */
function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const pad = maskable ? size * 0.1 : 0;
  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const alpha = a / 255;
    buf[i] = Math.round(buf[i] * (1 - alpha) + r * alpha);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - alpha) + g * alpha);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - alpha) + b * alpha);
    buf[i + 3] = Math.max(buf[i + 3], a);
  };

  // Fondo con degradado radial
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      const t = Math.min(1, d);
      put(x, y, Math.round(10 + 6 * (1 - t)), Math.round(16 + 20 * (1 - t)), Math.round(28 + 34 * (1 - t)));
    }
  }

  // Engranaje
  const teeth = 10;
  const rOuter = c - pad - size * 0.06;
  const rInner = rOuter * 0.78;
  const rHole = rOuter * 0.3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const wave = Math.cos(ang * teeth);
      const radius = wave > 0.35 ? rOuter : rInner;
      if (dist <= radius && dist >= rHole) {
        // Degradado cian → azul según la altura
        const t = y / size;
        const r = Math.round(103 - 60 * t);
        const g = Math.round(232 - 90 * t);
        const b = Math.round(249 - 90 * t);
        put(x, y, r, g, b);
      }
      // Anillo interior ámbar
      if (dist <= rHole && dist >= rHole * 0.55) put(x, y, 245, 158, 11);
    }
  }

  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  { size: 192, maskable: false, name: 'icon-192.png' },
  { size: 512, maskable: false, name: 'icon-512.png' },
  { size: 512, maskable: true, name: 'icon-maskable-512.png' },
  { size: 180, maskable: false, name: 'apple-touch-icon.png' },
  { size: 64, maskable: false, name: 'favicon-64.png' },
];

for (const t of targets) {
  const png = encodePng(t.size, t.size, draw(t.size, t.maskable));
  writeFileSync(resolve(OUT_DIR, t.name), png);
  console.log(`✔ ${t.name} (${t.size}×${t.size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
