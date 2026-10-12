// Historial de estados por entidad (B23): muestras acotadas para gráficas. Funciones puras.
import type { EntityStateValue, HistorySample, SimulationState } from '../types';

/** Muestras máximas que se guardan por entidad (se conservan las más recientes). */
export const MAX_HISTORY_SAMPLES = 500;

/** Valor de una muestra: número si el estado es numérico; texto en otro caso. */
export function sampleValue(v: EntityStateValue): string | number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : v;
}

/**
 * Añade una muestra al historial de una entidad. Si la última muestra tiene la misma hora se
 * sustituye; si tiene el mismo valor no se repite. Sin historial (sim.history undefined) no hace nada.
 */
export function recordSample(
  sim: SimulationState,
  entityId: string,
  value: EntityStateValue,
  limit = MAX_HISTORY_SAMPLES,
): SimulationState {
  if (!sim.history) return sim;
  const v = sampleValue(value);
  const prev = sim.history[entityId] ?? [];
  const last = prev[prev.length - 1];
  if (last && last.v === v) return sim;
  const base = last && last.t === sim.now ? prev.slice(0, -1) : prev;
  const next = [...base, { t: sim.now, v }];
  const bounded = next.length > limit ? next.slice(next.length - limit) : next;
  return { ...sim, history: { ...sim.history, [entityId]: bounded } };
}

/**
 * Serie de una entidad en [fromMs, toMs]. Incluye al principio el valor vigente en fromMs (la
 * última muestra anterior, con t = fromMs) para poder dibujar la línea desde el inicio.
 */
export function historySeries(sim: SimulationState, entityId: string, fromMs: number, toMs: number): HistorySample[] {
  const samples = sim.history?.[entityId] ?? [];
  const result: HistorySample[] = [];
  let before: HistorySample | undefined;
  for (const s of samples) {
    if (s.t < fromMs) before = s;
    else if (s.t <= toMs) result.push(s);
  }
  if (before && (result[0] === undefined || result[0].t > fromMs)) result.unshift({ t: fromMs, v: before.v });
  return result;
}

/** ¿La serie es numérica (todas las muestras son números)? Útil para elegir el tipo de gráfica. */
export function isNumericSeries(samples: HistorySample[]): boolean {
  const values = samples.filter((s) => !isGap(s.v));
  return values.length > 0 && values.every((s) => typeof s.v === 'number');
}

/** Estados que son huecos en una gráfica (sin dato): unavailable y unknown. */
export const GAP_STATES: readonly string[] = ['unavailable', 'unknown'];

export function isGap(v: string | number): boolean {
  return typeof v === 'string' && GAP_STATES.includes(v);
}

/** Entidades con historial, ordenadas. */
export function historyEntities(sim: SimulationState): string[] {
  return Object.keys(sim.history ?? {}).sort();
}

/** Mínimo, máximo y media ponderada en el tiempo de una serie numérica hasta toMs. */
export function seriesStats(samples: HistorySample[], toMs: number): { min: number; max: number; mean: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  let area = 0;
  let span = 0;
  let first: number | undefined;
  samples.forEach((s, i) => {
    // Los huecos (unavailable/unknown) y los textos no cuentan ni para el valor ni para la duración.
    if (typeof s.v !== 'number') return;
    first ??= s.v;
    min = Math.min(min, s.v);
    max = Math.max(max, s.v);
    const end = samples[i + 1]?.t ?? toMs;
    const dt = Math.max(0, end - s.t);
    area += s.v * dt;
    span += dt;
  });
  if (first === undefined) return undefined;
  return { min, max, mean: span > 0 ? area / span : first };
}
