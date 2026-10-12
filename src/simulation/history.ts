// Historial de estados por entidad (B23): muestras acotadas para gráficas. Funciones puras.
import type { EntityState, EntityStateValue, HistorySample, SimulationState } from '../types';

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

/** Separador entre el entity_id y el atributo en las claves de sim.history. */
export const ATTRIBUTE_SEPARATOR = '#';

/** Clave de la serie de un atributo («light.salon#brightness»). */
export function attributeKey(entityId: string, attribute: string): string {
  return `${entityId}${ATTRIBUTE_SEPARATOR}${attribute}`;
}

/** Atributos que se guardan en el historial, por dominio (y battery_level en cualquiera). */
export const HISTORY_ATTRIBUTES: Record<string, readonly string[]> = {
  light: ['brightness', 'color_temp_kelvin'],
  cover: ['current_position'],
  climate: ['current_temperature', 'temperature', 'hvac_action'],
  media_player: ['volume_level'],
  '*': ['battery_level'],
};

/** Cambio mínimo de cada atributo numérico para guardar una muestra nueva (los textos, siempre). */
export const ATTRIBUTE_THRESHOLDS: Record<string, number> = {
  brightness: 3,
  color_temp_kelvin: 50,
  current_position: 1,
  current_temperature: 0.1,
  temperature: 0.1,
  volume_level: 0.02,
  battery_level: 1,
};

/** Muestras máximas por serie de atributo. */
export const MAX_ATTRIBUTE_SAMPLES = 300;

function attributesFor(entityId: string): readonly string[] {
  const domain = entityId.slice(0, Math.max(0, entityId.indexOf('.')));
  return [...(HISTORY_ATTRIBUTES[domain] ?? []), ...(HISTORY_ATTRIBUTES['*'] ?? [])];
}

/**
 * Guarda las muestras de los atributos relevantes de una entidad si cambian por encima de su
 * umbral respecto a la última muestra guardada (así una deriva lenta también acaba registrándose).
 * Un atributo que desaparece (luz apagada sin brillo) se guarda como hueco «unknown».
 */
export function recordAttributeSamples(sim: SimulationState, entityId: string, st: EntityState, limit = MAX_ATTRIBUTE_SAMPLES): SimulationState {
  if (!sim.history) return sim;
  let result = sim;
  for (const attr of attributesFor(entityId)) {
    const key = attributeKey(entityId, attr);
    const raw = st.attributes?.[attr];
    const series = result.history?.[key];
    if (raw === undefined && series === undefined) continue;
    const v = raw === undefined ? 'unknown' : sampleValue(raw);
    const last = series?.[series.length - 1];
    if (last && typeof last.v === 'number' && typeof v === 'number' && Math.abs(v - last.v) < (ATTRIBUTE_THRESHOLDS[attr] ?? 0)) continue;
    result = recordSample(result, key, v, limit);
  }
  return result;
}

/** Atributos con historial de una entidad (para elegir qué dibujar). */
export function historyAttributes(sim: SimulationState, entityId: string): string[] {
  const prefix = `${entityId}${ATTRIBUTE_SEPARATOR}`;
  return Object.keys(sim.history ?? {})
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort();
}

/**
 * Serie de una entidad (o de uno de sus atributos) en [fromMs, toMs]. Incluye al principio el
 * valor vigente en fromMs (la última muestra anterior, con t = fromMs) para dibujar desde el inicio.
 */
export function historySeries(sim: SimulationState, entityId: string, fromMs: number, toMs: number, attribute?: string): HistorySample[] {
  const samples = sim.history?.[attribute === undefined ? entityId : attributeKey(entityId, attribute)] ?? [];
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
  return Object.keys(sim.history ?? {})
    .filter((k) => !k.includes(ATTRIBUTE_SEPARATOR))
    .sort();
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
