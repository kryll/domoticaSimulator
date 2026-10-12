// Reloj simulado. La hora simulada se expresa como "hora de pared" en UTC: así el motor es
// determinista e independiente de la zona horaria del navegador. Usa simNowFromLocalDate
// para arrancar la simulación a la hora local actual.
import { defaultSettings, type Project } from '../types';

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

/** Amanecer y atardecer fijos (configurables) del día que contiene dateMs. */
export function fixedSunTimes(dateMs: number, config: SunConfig = DEFAULT_SUN): { sunrise: number; sunset: number } {
  const day = startOfDay(dateMs);
  return {
    sunrise: day + parseHHMM(config.sunrise) * MINUTE_MS,
    sunset: day + parseHHMM(config.sunset) * MINUTE_MS,
  };
}

// ---------- Sol real (algoritmo de la NOAA) ----------

const RAD = Math.PI / 180;
const sinD = (deg: number): number => Math.sin(deg * RAD);
const cosD = (deg: number): number => Math.cos(deg * RAD);
const tanD = (deg: number): number => Math.tan(deg * RAD);

/** Siglos julianos desde J2000.0. */
function julianCentury(utcMs: number): number {
  const jd = utcMs / DAY_MS + 2440587.5;
  return (jd - 2451545) / 36525;
}

interface SolarPosition {
  declination: number;
  /** Ecuación del tiempo en minutos. */
  eqTime: number;
}

function solarPosition(t: number): SolarPosition {
  const l0 = (((280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = sinD(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sinD(2 * m) * (0.019993 - 0.000101 * t) + sinD(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * sinD(omega);
  const e0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = e0 + 0.00256 * cosD(omega);
  const declination = Math.asin(sinD(obliq) * sinD(lambda)) / RAD;
  const y = tanD(obliq / 2) ** 2;
  const eq =
    y * sinD(2 * l0) -
    2 * e * sinD(m) +
    4 * e * y * sinD(m) * cosD(2 * l0) -
    0.5 * y * y * sinD(4 * l0) -
    1.25 * e * e * sinD(2 * m);
  return { declination, eqTime: (4 * eq) / RAD };
}

/** Ángulo horario (grados) del orto; NaN si el sol no sale o no se pone ese día. */
function hourAngle(latitude: number, declination: number): number {
  const cosH = cosD(90.833) / (cosD(latitude) * cosD(declination)) - tanD(latitude) * tanD(declination);
  return Math.acos(cosH) / RAD;
}

/** Minutos UTC desde la medianoche UTC del día `dayUtc` (orto o ocaso), NaN en día/noche polar. */
function eventUtcMinutes(rise: boolean, dayUtc: number, latitude: number, longitude: number): number {
  let minutes = 720 - 4 * longitude; // primera aproximación: mediodía solar
  for (let i = 0; i < 2; i++) {
    const pos = solarPosition(julianCentury(dayUtc + minutes * MINUTE_MS));
    const ha = hourAngle(latitude, pos.declination);
    minutes = 720 - 4 * (longitude + (rise ? ha : -ha)) - pos.eqTime;
  }
  return minutes;
}

function solarNoonUtcMinutes(dayUtc: number, longitude: number): number {
  const pos = solarPosition(julianCentury(dayUtc + (720 - 4 * longitude) * MINUTE_MS));
  return 720 - 4 * longitude - pos.eqTime;
}

/** Desfase (minutos) de la zona horaria respecto a UTC en un instante real. */
export function timeZoneOffsetMinutes(utcMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / MINUTE_MS);
  } catch {
    return 0;
  }
}

/**
 * Amanecer y atardecer reales (algoritmo de la NOAA, refracción incluida) del día simulado que
 * contiene dateMs, como hora simulada de pared. Con timeZone (IANA) se pasan a hora local; sin
 * ella, se devuelven en UTC. En día polar: 00:00 y 24:00; en noche polar: ambos al mediodía solar.
 */
export function sunTimes(
  dateMs: number,
  latitude: number,
  longitude: number,
  timeZone = 'UTC',
): { sunrise: number; sunset: number } {
  const day = startOfDay(dateMs);
  const lat = Math.max(-89.9, Math.min(89.9, latitude));
  const rise = eventUtcMinutes(true, day, lat, longitude);
  const set = eventUtcMinutes(false, day, lat, longitude);
  const toWall = (minutes: number): number => {
    const utc = day + minutes * MINUTE_MS;
    return Math.round(utc / 1000) * 1000 + timeZoneOffsetMinutes(utc, timeZone) * MINUTE_MS;
  };
  if (Number.isNaN(rise) || Number.isNaN(set)) {
    const noon = solarNoonUtcMinutes(day, longitude);
    const polarDay = solarPosition(julianCentury(day + noon * MINUTE_MS)).declination * lat > 0;
    if (polarDay) return { sunrise: day, sunset: day + DAY_MS };
    const n = toWall(noon);
    return { sunrise: n, sunset: n };
  }
  return { sunrise: toWall(rise), sunset: toWall(set) };
}

/** Ubicación mínima para calcular el sol. */
export interface SunLocation {
  latitude: number;
  longitude: number;
  timeZone?: string;
}

/** Amanecer y atardecer del día simulado para una ubicación (o con horas fijas). */
export function sunTimesAt(dateMs: number, where: SunLocation | SunConfig): { sunrise: number; sunset: number } {
  if ('sunrise' in where) return fixedSunTimes(dateMs, where);
  return sunTimes(dateMs, where.latitude, where.longitude, where.timeZone);
}

/**
 * Hora simulada equivalente a la hora de pared de una fecha real: en la zona horaria indicada
 * (IANA) o, sin ella, en la del navegador.
 */
export function simNowFromLocalDate(date: Date, timeZone?: string): number {
  if (timeZone !== undefined) {
    const utc = Math.floor(date.getTime() / 1000) * 1000;
    return utc + timeZoneOffsetMinutes(utc, timeZone) * MINUTE_MS;
  }
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  );
}

/**
 * Hora simulada de arranque para un proyecto: la hora de pared en su zona horaria (por defecto
 * la de los ajustes por defecto, Madrid; si tiene ajustes sin zona, la del navegador).
 */
export function simNowForProject(project: Pick<Project, 'settings'>, date: Date): number {
  const timeZone = project.settings ? project.settings.timeZone : defaultSettings().timeZone;
  return simNowFromLocalDate(date, timeZone);
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
