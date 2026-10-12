// Reloj simulado. La hora simulada se expresa como "hora de pared" en UTC: así el motor es
// determinista e independiente de la zona horaria del navegador. Usa simNowFromLocalDate
// para arrancar la simulación a la hora local actual.

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export interface SunConfig {
  /** "HH:MM" */
  sunrise: string;
  /** "HH:MM" */
  sunset: string;
}

export const DEFAULT_SUN: SunConfig = { sunrise: '07:30', sunset: '20:00' };

const pad = (n: number): string => String(n).padStart(2, '0');

/** "HH:MM" (o "HH:MM:SS" con seconds) de la hora simulada. */
export function formatSimTime(ms: number, opts: { seconds?: boolean } = {}): string {
  const d = new Date(ms);
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return opts.seconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}

/** "DD/MM/AAAA" de la fecha simulada. */
export function formatSimDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Convierte "HH:MM" o "HH:MM:SS" en minutos desde medianoche (con fracción si hay segundos). */
export function parseHHMM(text: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) throw new Error(`Hora no válida: "${text}" (formato esperado HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || sec > 59) throw new Error(`Hora fuera de rango: "${text}"`);
  return h * 60 + min + sec / 60;
}

/** Minutos (enteros) a "HH:MM". */
export function formatHHMM(minutes: number): string {
  const total = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Minutos transcurridos desde la medianoche simulada (con fracción). */
export function minutesOfDay(ms: number): number {
  return (((ms % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS;
}

/** Inicio (00:00) del día simulado que contiene ms. */
export function startOfDay(ms: number): number {
  return ms - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
}

/** Amanecer y atardecer (fijos, configurables) del día que contiene dateMs. */
export function sunTimes(dateMs: number, config: SunConfig = DEFAULT_SUN): { sunrise: number; sunset: number } {
  const day = startOfDay(dateMs);
  return {
    sunrise: day + parseHHMM(config.sunrise) * MINUTE_MS,
    sunset: day + parseHHMM(config.sunset) * MINUTE_MS,
  };
}

/** Hora simulada equivalente a la hora local de pared de una fecha real. */
export function simNowFromLocalDate(date: Date): number {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  );
}

/** ¿Está la hora dentro de [after, before)? Admite rangos que cruzan medianoche. */
export function isTimeBetween(ms: number, after?: string, before?: string): boolean {
  const now = minutesOfDay(ms);
  const a = after === undefined ? undefined : parseHHMM(after);
  const b = before === undefined ? undefined : parseHHMM(before);
  if (a !== undefined && b !== undefined) return a <= b ? now >= a && now < b : now >= a || now < b;
  if (a !== undefined) return now >= a;
  if (b !== undefined) return now < b;
  return true;
}
