import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  formatHHMM,
  formatSimDate,
  formatSimTime,
  HOUR_MS,
  isTimeBetween,
  minutesOfDay,
  parseHHMM,
  simNowFromLocalDate,
  startOfDay,
  sunTimes,
} from './clock';

const T0 = Date.UTC(2026, 9, 12, 0, 0, 0); // 12/10/2026 00:00 (hora simulada)

describe('reloj', () => {
  it('formatSimTime y formatSimDate', () => {
    expect(formatSimTime(T0 + 7 * HOUR_MS + 5 * 60_000 + 9000)).toBe('07:05');
    expect(formatSimTime(T0 + 7 * HOUR_MS + 5 * 60_000 + 9000, { seconds: true })).toBe('07:05:09');
    expect(formatSimDate(T0)).toBe('12/10/2026');
  });

  it('parseHHMM', () => {
    expect(parseHHMM('07:30')).toBe(450);
    expect(parseHHMM('7:05')).toBe(425);
    expect(parseHHMM('00:00:30')).toBe(0.5);
    expect(() => parseHHMM('24:00')).toThrow(/fuera de rango/);
    expect(() => parseHHMM('mediodía')).toThrow(/Hora no válida/);
  });

  it('formatHHMM normaliza el día', () => {
    expect(formatHHMM(450)).toBe('07:30');
    expect(formatHHMM(1440 + 61)).toBe('01:01');
    expect(formatHHMM(-30)).toBe('23:30');
  });

  it('minutesOfDay y startOfDay', () => {
    expect(minutesOfDay(T0 + 90 * 60_000)).toBe(90);
    expect(startOfDay(T0 + 5 * HOUR_MS)).toBe(T0);
    expect(startOfDay(T0 - 1)).toBe(T0 - DAY_MS);
  });

  it('sunTimes por defecto y configurable', () => {
    expect(sunTimes(T0 + 12 * HOUR_MS)).toEqual({ sunrise: T0 + 7.5 * HOUR_MS, sunset: T0 + 20 * HOUR_MS });
    expect(sunTimes(T0, { sunrise: '06:00', sunset: '21:30' })).toEqual({ sunrise: T0 + 6 * HOUR_MS, sunset: T0 + 21.5 * HOUR_MS });
  });

  it('simNowFromLocalDate conserva la hora de pared local', () => {
    const local = new Date(2026, 9, 12, 18, 45, 10);
    expect(formatSimTime(simNowFromLocalDate(local), { seconds: true })).toBe('18:45:10');
  });

  it('isTimeBetween con y sin cruce de medianoche', () => {
    const at = (h: number) => T0 + h * HOUR_MS;
    expect(isTimeBetween(at(10), '08:00', '12:00')).toBe(true);
    expect(isTimeBetween(at(12), '08:00', '12:00')).toBe(false);
    expect(isTimeBetween(at(23), '20:00', '07:30')).toBe(true);
    expect(isTimeBetween(at(3), '20:00', '07:30')).toBe(true);
    expect(isTimeBetween(at(12), '20:00', '07:30')).toBe(false);
    expect(isTimeBetween(at(9), '08:00')).toBe(true);
    expect(isTimeBetween(at(9), undefined, '08:00')).toBe(false);
    expect(isTimeBetween(at(9))).toBe(true);
  });
});
