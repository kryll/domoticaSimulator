// Cálculo de los destinos de «Ir a…» (funciones puras).
import { DAY_MS, MINUTE_MS, parseHHMM, startOfDay } from '../simulation/clock';

/** Próximo atardecer (o amanecer) estrictamente posterior a `now`. */
export function nextSunEvent(now: number, event: 'sunrise' | 'sunset', at: (day: number) => { sunrise: number; sunset: number }): number {
  const today = at(startOfDay(now))[event];
  if (today > now) return today;
  return at(startOfDay(now) + DAY_MS)[event];
}

/** Próxima vez que el reloj marque `hhmm` (hoy si aún no ha pasado, si no mañana). */
export function nextTimeOfDay(now: number, hhmm: string): number {
  const target = startOfDay(now) + Math.round(parseHHMM(hhmm) * MINUTE_MS);
  return target > now ? target : target + DAY_MS;
}
