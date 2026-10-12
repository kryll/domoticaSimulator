// Genera los iconos de la PWA (SVG y PNG) sin dependencias: dibuja una casa sobre fondo azul y
// codifica los PNG con zlib de Node. Uso: npm run icons (escribe en public/icons/).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BG = [3, 105, 161]; // sky-700
const FG = [255, 255, 255];
const ACCENT = [250, 204, 21]; // amber-400 (ventana encendida)

// Formas en coordenadas 0..1. `inset` reduce el dibujo (zona segura de los iconos «maskable»).
function shapes(inset) {
  const s = (x, y) => [inset + x * (1 - 2 * inset), inset + y * (1 - 2 * inset)];
  return {
    roof: [s(0.5, 0.16), s(0.88, 0.5), s(0.12, 0.5)],
    body: [s(0.22, 0.46), s(0.78, 0.46), s(0.78, 0.84), s(0.22, 0.84)],
    door: [s(0.42, 0.6), s(0.58, 0.6), s(0.58, 0.84), s(0.42, 0.84)],
    window: [s(0.62, 0.54), s(0.72, 0.54), s(0.72, 0.64), s(0.62, 0.64)],
  };
}

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function colorAt(sh, x, y, rounded) {
  if (rounded) {
    // Esquinas redondeadas (radio 18 %): fuera, transparente.
    const r = 0.18;
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  if (inside(sh.window, x, y)) return ACCENT;
  if (inside(sh.door, x, y)) return BG;
  if (inside(sh.roof, x, y) || inside(sh.body, x, y)) return FG;
  return BG;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, { inset = 0, rounded = false } = {}) {
  const sh = shapes(inset);
  const SS = 4; // supermuestreo para suavizar los bordes
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filtro «None»
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt(sh, (px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, rounded);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const n = SS * SS;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const sh = shapes(0);
  const pts = (p) => p.map(([x, y]) => `${Math.round(x * 512)},${Math.round(y * 512)}`).join(' ');
  const rgb = (c) => `rgb(${c.join(',')})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="92" fill="${rgb(BG)}"/>
  <polygon points="${pts(sh.roof)}" fill="${rgb(FG)}"/>
  <polygon points="${pts(sh.body)}" fill="${rgb(FG)}"/>
  <polygon points="${pts(sh.door)}" fill="${rgb(BG)}"/>
  <polygon points="${pts(sh.window)}" fill="${rgb(ACCENT)}"/>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), svg());
writeFileSync(join(OUT, 'icon-192.png'), png(192, { rounded: true }));
writeFileSync(join(OUT, 'icon-512.png'), png(512, { rounded: true }));
writeFileSync(join(OUT, 'maskable-512.png'), png(512, { inset: 0.1 }));
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(180, { inset: 0.04 }));
console.log(`Iconos generados en ${OUT}`);
