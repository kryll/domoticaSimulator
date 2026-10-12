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
  simNowForProject,
  simNowFromLocalDate,
  startOfDay,
  fixedSunTimes,
  sunTimes,
  timeZoneOffsetMinutes,
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

  it('fixedSunTimes por defecto y configurable', () => {
    expect(fixedSunTimes(T0 + 12 * HOUR_MS)).toEqual({ sunrise: T0 + 7.5 * HOUR_MS, sunset: T0 + 20 * HOUR_MS });
    expect(fixedSunTimes(T0, { sunrise: '06:00', sunset: '21:30' })).toEqual({ sunrise: T0 + 6 * HOUR_MS, sunset: T0 + 21.5 * HOUR_MS });
  });

  describe('sunTimes (NOAA)', () => {
    const MADRID = { lat: 40.4168, lon: -3.7038 };
    const minutes = (ms: number): number => minutesOfDay(ms);
    const near = (ms: number, hhmm: string): void => {
      expect(Math.abs(minutes(ms) - parseHHMM(hhmm))).toBeLessThanOrEqual(3);
    };

    it('Madrid en el solsticio de verano (hora local, CEST)', () => {
      const { sunrise, sunset } = sunTimes(Date.UTC(2025, 5, 21, 12), MADRID.lat, MADRID.lon, 'Europe/Madrid');
      near(sunrise, '06:44');
      near(sunset, '21:48');
    });

    it('Madrid en el solsticio de invierno (hora local, CET)', () => {
      const { sunrise, sunset } = sunTimes(Date.UTC(2025, 11, 21, 3), MADRID.lat, MADRID.lon, 'Europe/Madrid');
      near(sunrise, '08:33');
      near(sunset, '17:51');
    });

    it('sin zona horaria devuelve UTC', () => {
      const { sunrise, sunset } = sunTimes(Date.UTC(2025, 5, 21), MADRID.lat, MADRID.lon);
      near(sunrise, '04:44');
      near(sunset, '19:48');
      expect(startOfDay(sunrise)).toBe(Date.UTC(2025, 5, 21));
    });

    it('día y noche polares', () => {
      const polarDay = sunTimes(Date.UTC(2025, 5, 21), 78, 15);
      expect(polarDay.sunset - polarDay.sunrise).toBe(DAY_MS);
      const polarNight = sunTimes(Date.UTC(2025, 11, 21), 78, 15);
      expect(polarNight.sunset).toBe(polarNight.sunrise);
    });

    it('desfase de la zona horaria', () => {
      expect(timeZoneOffsetMinutes(Date.UTC(2025, 5, 21), 'Europe/Madrid')).toBe(120);
      expect(timeZoneOffsetMinutes(Date.UTC(2025, 0, 21), 'Europe/Madrid')).toBe(60);
      expect(timeZoneOffsetMinutes(Date.UTC(2025, 0, 21), 'Zona/Inventada')).toBe(0);
    });
  });

  it('simNowFromLocalDate con zona horaria y simNowForProject', () => {
    const real = new Date(Date.UTC(2026, 5, 21, 10, 30, 15, 500)); // 10:30:15 UTC
    expect(formatSimTime(simNowFromLocalDate(real, 'Europe/Madrid'), { seconds: true })).toBe('12:30:15');
    expect(formatSimTime(simNowFromLocalDate(real, 'America/New_York'), { seconds: true })).toBe('06:30:15');
    expect(formatSimTime(simNowForProject({}, real))).toBe('12:30');
    expect(formatSimTime(simNowForProject({ settings: { latitude: 0, longitude: 0, electricityPriceEurKwh: 0.1, timeZone: 'Asia/Tokyo' } }, real))).toBe('19:30');
    expect(formatSimDate(simNowForProject({ settings: { latitude: 0, longitude: 0, electricityPriceEurKwh: 0.1, timeZone: 'Pacific/Auckland' } }, real))).toBe('21/06/2026');
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
