// Utilidades de color de luces (funciones puras).
//
// Decisión: rgb_color se guarda en los atributos y en Action.data como texto "[r, g, b]"
// (EntityStateValue sigue siendo escalar). callService acepta además una lista numérica, y el
// YAML lo exporta como lista [r, g, b] y lo vuelve a leer como texto.
import type { ServiceDataValue } from '../types';

export type Rgb = [number, number, number];

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Lee un color de [r, g, b], "[r, g, b]", "r,g,b" o "#rrggbb". undefined si no es válido. */
export function parseRgb(v: ServiceDataValue | undefined): Rgb | undefined {
  if (v === undefined || typeof v === 'boolean' || typeof v === 'number') return undefined;
  if (Array.isArray(v)) {
    if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) return undefined;
    return [clampByte(v[0] ?? 0), clampByte(v[1] ?? 0), clampByte(v[2] ?? 0)];
  }
  const text = v.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = text.replace(/^[[(]|[\])]$/g, '').split(',').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => p === '' || !Number.isFinite(Number(p)))) return undefined;
  return parseRgb(parts.map(Number));
}

/** Texto canónico "[r, g, b]" (el formato que se guarda en atributos y en Action.data). */
export function formatRgb(rgb: Rgb): string {
  return `[${rgb.join(', ')}]`;
}

/** Aproximación de Tanner Helland del color de un cuerpo negro (1000-40000 K). */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clampByte(r), clampByte(g), clampByte(b)];
}

export function rgbToCss(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
