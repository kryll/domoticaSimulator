// Geometría de la minigráfica de historial (solo interfaz, sin dependencias de React).
import type { HistorySample } from '../types';

export interface SparkBox {
  width: number;
  height: number;
  pad: number;
}

const GAP = new Set(['unavailable', 'unknown']);

/** ¿La muestra es un hueco (entidad no disponible o desconocida)? */
export function isGap(v: string | number): boolean {
  return typeof v === 'string' && GAP.has(v.toLowerCase());
}

/** ¿Serie numérica? Números y, como mucho, huecos de no disponible. */
export function isNumericWithGaps(samples: HistorySample[]): boolean {
  return samples.some((s) => typeof s.v === 'number') && samples.every((s) => typeof s.v === 'number' || isGap(s.v));
}

/**
 * Ruta SVG escalonada (como el historial de HA) de una serie numérica en [from, to]. La línea se
 * corta en los tramos no disponibles.
 */
export function numericPath(samples: HistorySample[], from: number, to: number, box: SparkBox): { d: string; min: number; max: number } | null {
  const nums = samples.filter((s): s is { t: number; v: number } => typeof s.v === 'number');
  if (nums.length === 0 || to <= from) return null;
  const lo = Math.min(...nums.map((s) => s.v));
  const hi = Math.max(...nums.map((s) => s.v));
  const min = lo === hi ? lo - 1 : lo;
  const max = lo === hi ? hi + 1 : hi;
  const x = (t: number) => box.pad + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * (box.width - box.pad * 2);
  const y = (v: number) => box.pad + (1 - (v - min) / (max - min)) * (box.height - box.pad * 2);
  const parts: string[] = [];
  let drawing = false;
  for (const s of samples) {
    const px = x(s.t).toFixed(1);
    if (typeof s.v !== 'number') {
      if (drawing) parts.push(`H${px}`);
      drawing = false;
      continue;
    }
    const py = y(s.v).toFixed(1);
    parts.push(drawing ? `H${px}V${py}` : `M${px},${py}`);
    drawing = true;
  }
  if (drawing) parts.push(`H${x(to).toFixed(1)}`);
  return { d: parts.join(''), min: lo, max: hi };
}

/** Tramos sin datos (no disponible o desconocido), en coordenadas x de 0 a `width`. */
export function gapSegments(samples: HistorySample[], from: number, to: number, width: number): Array<{ x: number; w: number }> {
  if (to <= from) return [];
  const x = (t: number) => ((Math.min(Math.max(t, from), to) - from) / (to - from)) * width;
  const out: Array<{ x: number; w: number }> = [];
  samples.forEach((s, i) => {
    if (!isGap(s.v)) return;
    const x0 = x(s.t);
    const x1 = x(samples[i + 1]?.t ?? to);
    if (x1 > x0) out.push({ x: x0, w: x1 - x0 });
  });
  return out;
}

const ON = new Set(['on', 'open', 'home', 'playing', 'unlocked', 'detected', 'true']);

/** Tramos «activos» (on, open...) de una serie de estados, en coordenadas x. */
export function activeSegments(samples: HistorySample[], from: number, to: number, width: number): Array<{ x: number; w: number }> {
  if (to <= from) return [];
  const x = (t: number) => ((Math.min(Math.max(t, from), to) - from) / (to - from)) * width;
  const out: Array<{ x: number; w: number }> = [];
  samples.forEach((s, i) => {
    if (!ON.has(String(s.v).toLowerCase())) return;
    const end = samples[i + 1]?.t ?? to;
    const x0 = x(s.t);
    const x1 = x(end);
    if (x1 > x0) out.push({ x: x0, w: x1 - x0 });
  });
  return out;
}
