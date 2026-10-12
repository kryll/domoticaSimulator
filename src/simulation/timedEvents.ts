// Disparadores de hora, sol y patrón de hora que caen en un avance del reloj, y la espera
// pendiente más próxima. Funciones puras.
import type { Automation, PendingAction, Project, SimulationState, Trigger } from '../types';
import { DAY_MS, HOUR_MS, MINUTE_MS, parseHHMM, SECOND_MS, startOfDay, sunTimesAt } from './clock';
import type { SunSource } from './trace';

/** Eventos máximos en un solo avance del reloj. */
export const MAX_TICK_EVENTS = 10_000;
/** Días máximos que recorre un avance del reloj. */
export const MAX_TICK_DAYS = 400;

export interface TimedEvent {
  at: number;
  automation: Automation;
  reason: string;
  triggerIndex: number;
}

export function triggerOffsetsMs(t: Trigger, day: number, sun: SunSource): { at: number; reason: string } | undefined {
  if (t.type === 'time') {
    try {
      return { at: day + parseHHMM(t.at) * MINUTE_MS, reason: `hora ${t.at}` };
    } catch {
      return undefined;
    }
  }
  if (t.type === 'sun') {
    const times = sunTimesAt(day, sun);
    const base = t.event === 'sunrise' ? times.sunrise : times.sunset;
    return { at: base + (t.offsetMinutes ?? 0) * MINUTE_MS, reason: t.event === 'sunrise' ? 'amanecer' : 'atardecer' };
  }
  return undefined;
}

export function collectTimedEvents(project: Project, from: number, to: number, sun: SunSource): TimedEvent[] {
  const events: TimedEvent[] = [];
  const firstDay = startOfDay(from) - DAY_MS; // por si un offset negativo cae en el día anterior
  const lastDay = Math.min(startOfDay(to) + DAY_MS, firstDay + MAX_TICK_DAYS * DAY_MS);
  for (const automation of project.automations) {
    for (const [triggerIndex, t] of automation.triggers.entries()) {
      if (t.enabled === false) continue;
      if (t.type === 'time_pattern') {
        for (const at of timePatternOccurrences(t, from, to, MAX_TICK_EVENTS)) events.push({ at, reason: 'patrón de hora', automation, triggerIndex });
        continue;
      }
      if (t.type !== 'time' && t.type !== 'sun') continue;
      for (let day = firstDay; day <= lastDay; day += DAY_MS) {
        const occ = triggerOffsetsMs(t, day, sun);
        if (occ && occ.at > from && occ.at <= to) events.push({ ...occ, automation, triggerIndex });
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/** Valores (0..max-1) que cumplen un campo de time_pattern ("5", "*", "/5"); undefined si no es válido. */
export function timePatternValues(field: string | undefined, max: number, fallback: 'any' | 'zero'): number[] | undefined {
  const all = Array.from({ length: max }, (_, i) => i);
  if (field === undefined) return fallback === 'any' ? all : [0];
  const f = String(field).trim();
  if (f === '*') return all;
  const every = /^\/(\d+)$/.exec(f);
  if (every) {
    const n = Number(every[1]);
    return n > 0 && n < max ? all.filter((v) => v % n === 0) : undefined;
  }
  if (/^\d+$/.test(f) && Number(f) < max) return [Number(f)];
  return undefined;
}

/** Valores de horas, minutos y segundos de un time_pattern con los valores por defecto de HA. */
export function timePatternSets(t: { hours?: string; minutes?: string; seconds?: string }): { hours: number[]; minutes: number[]; seconds: number[] } | undefined {
  if (t.hours === undefined && t.minutes === undefined && t.seconds === undefined) return undefined;
  // Como HA: si se indica una unidad mayor, las menores sin valor valen 0.
  const hours = timePatternValues(t.hours, 24, 'any');
  const minutes = timePatternValues(t.minutes, 60, t.hours !== undefined ? 'zero' : 'any');
  const seconds = timePatternValues(t.seconds, 60, t.hours !== undefined || t.minutes !== undefined ? 'zero' : 'any');
  return hours && minutes && seconds ? { hours, minutes, seconds } : undefined;
}

/** Horas (ms) en (from, to] en que se cumple un time_pattern, como mucho `limit`. */
export function timePatternOccurrences(t: { hours?: string; minutes?: string; seconds?: string }, from: number, to: number, limit: number): number[] {
  const sets = timePatternSets(t);
  if (!sets) return [];
  const out: number[] = [];
  const lastDay = Math.min(startOfDay(to), startOfDay(from) + MAX_TICK_DAYS * DAY_MS);
  for (let day = startOfDay(from); day <= lastDay; day += DAY_MS) {
    for (const h of sets.hours) {
      const hourStart = day + h * HOUR_MS;
      if (hourStart + HOUR_MS <= from || hourStart > to) continue;
      for (const m of sets.minutes) {
        const minuteStart = hourStart + m * MINUTE_MS;
        if (minuteStart + MINUTE_MS <= from || minuteStart > to) continue;
        for (const sec of sets.seconds) {
          const at = minuteStart + sec * SECOND_MS;
          if (at <= from || at > to) continue;
          out.push(at);
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

export function earliestPending(sim: SimulationState, to: number): PendingAction | undefined {
  let best: PendingAction | undefined;
  for (const p of sim.pending) {
    if (p.dueAt <= to && (!best || p.dueAt < best.dueAt)) best = p;
  }
  return best;
}
