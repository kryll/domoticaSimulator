import { nextSunEvent, nextTimeOfDay } from './sunJump';

const day = Date.UTC(2026, 9, 12);
const H = 3600_000;
const sun = (d: number) => ({ sunrise: d + 8 * H, sunset: d + 19 * H });

describe('sunJump', () => {
  it('nextTimeOfDay: hoy si aún no ha pasado, si no mañana', () => {
    expect(nextTimeOfDay(day + 10 * H, '12:30')).toBe(day + 12.5 * H);
    expect(nextTimeOfDay(day + 10 * H, '09:00')).toBe(day + 33 * H);
    expect(nextTimeOfDay(day + 10 * H, '10:00')).toBe(day + 34 * H);
  });

  it('nextSunEvent: el atardecer de hoy o el de mañana', () => {
    expect(nextSunEvent(day + 10 * H, 'sunset', sun)).toBe(day + 19 * H);
    expect(nextSunEvent(day + 20 * H, 'sunset', sun)).toBe(day + 43 * H);
    expect(nextSunEvent(day + 10 * H, 'sunrise', sun)).toBe(day + 32 * H);
  });
});
