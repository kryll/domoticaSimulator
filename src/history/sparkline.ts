// Geometría de la minigráfica de historial (solo interfaz, sin dependencias de React).
import type { HistorySample } from '../types';

export interface SparkBox {
  width: number;
  height: number;
  pad: number;
}

/** Ruta SVG escalonada (como el historial de HA) de una serie numérica en [from, to]. */
export function numericPath(samples: HistorySample[], from: number, to: number, box: SparkBox): { d: string; min: number; max: number } | null {
  const nums = samples.filter((s): s is { t: number; v: number } => typeof s.v === 'number');
  if (nums.length === 0 || to <= from) return null;
  let min = Math.min(...nums.map((s) => s.v));
  let max = Math.max(...nums.map((s) => s.v));
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (t: number) => box.pad + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * (box.width - box.pad * 2);
  const y = (v: number) => box.pad + (1 - (v - min) / (max - min)) * (box.height - box.pad * 2);
  const parts: string[] = [];
  nums.forEach((s, i) => {
    const px = x(s.t).toFixed(1);
    const py = y(s.v).toFixed(1);
    parts.push(i === 0 ? `M${px},${py}` : `H${px}V${py}`);
  });
  parts.push(`H${x(to).toFixed(1)}`);
  return { d: parts.join(''), min: Math.min(...nums.map((s) => s.v)), max: Math.max(...nums.map((s) => s.v)) };
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
