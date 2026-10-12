// Conversión de color entre el simulador (rgb_color, color_temp_kelvin) y MQTT (mireds, CIE xy).
// Funciones puras.

export type Rgb = [number, number, number];

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Kelvin → mireds (redondeado). */
export function kelvinToMired(kelvin: number): number {
  return Math.round(1_000_000 / Math.max(1, kelvin));
}

/** Mireds → kelvin (redondeado). */
export function miredToKelvin(mired: number): number {
  return Math.round(1_000_000 / Math.max(1, mired));
}

/** "[r, g, b]" (formato de los atributos del simulador) → [r, g, b]; undefined si no es válido. */
export function parseRgbText(v: unknown): Rgb | undefined {
  if (Array.isArray(v)) {
    if (v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return undefined;
    return [clampByte(v[0] as number), clampByte(v[1] as number), clampByte(v[2] as number)];
  }
  if (typeof v !== 'string') return undefined;
  const parts = v.replace(/^[[(]|[\])]$/g, '').split(',').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return [clampByte(parts[0] ?? 0), clampByte(parts[1] ?? 0), clampByte(parts[2] ?? 0)];
}

const gammaIn = (c: number): number => {
  const v = c / 255;
  return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
};
const gammaOut = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** RGB → CIE 1931 xy (fórmula de Philips, como Zigbee2MQTT). Redondeado a 4 decimales. */
export function rgbToXy(rgb: Rgb): { x: number; y: number } {
  const [r, g, b] = rgb.map(gammaIn) as Rgb;
  const X = r * 0.4124 + g * 0.3576 + b * 0.1805;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.329 };
  return { x: Math.round((X / sum) * 10000) / 10000, y: Math.round((Y / sum) * 10000) / 10000 };
}

/** CIE xy → RGB a brillo máximo. */
export function xyToRgb(x: number, y: number): Rgb {
  if (y <= 0) return [255, 255, 255];
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  let r = X * 3.2406 - Y * 1.5372 - Z * 0.4986;
  let g = -X * 0.9689 + Y * 1.8758 + Z * 0.0415;
  let b = X * 0.0557 - Y * 0.204 + Z * 1.057;
  const max = Math.max(r, g, b, 1e-9);
  [r, g, b] = [r, g, b].map((c) => Math.max(0, c / max)) as Rgb;
  return [clampByte(gammaOut(r) * 255), clampByte(gammaOut(g) * 255), clampByte(gammaOut(b) * 255)];
}
