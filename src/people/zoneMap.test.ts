import { formatMeters, niceScale, offsetKm, projectCircles } from './zoneMap';

describe('zoneMap', () => {
  it('desplaza 5 km al norte y al este', () => {
    const n = offsetKm(40, -3, 5, 'N');
    expect(n.latitude).toBeCloseTo(40.0449, 3);
    expect(n.longitude).toBe(-3);
    const e = offsetKm(40, -3, 5, 'E');
    expect(e.longitude).toBeCloseTo(-3 + 5000 / (111320 * Math.cos((40 * Math.PI) / 180)), 5);
  });

  it('proyecta a escala: dos zonas separadas, radios proporcionales', () => {
    const { circles, metersPerPx } = projectCircles(
      [
        { id: 'a', name: 'Casa', latitude: 40, longitude: -3, radius: 100 },
        { id: 'b', name: 'Trabajo', latitude: 40.01, longitude: -3, radius: 200 },
      ],
      200,
    );
    const [a, b] = circles;
    expect(b!.r).toBeCloseTo(a!.r * 2, 5);
    expect(a!.cy).toBeGreaterThan(b!.cy); // el norte queda arriba
    expect(Math.abs(a!.cy - b!.cy) * metersPerPx).toBeCloseTo(1113.2, 0);
  });

  it('escala redonda y formato', () => {
    expect(niceScale(730)).toBe(500);
    expect(formatMeters(2500)).toBe('2,5 km');
    expect(formatMeters(80)).toBe('80 m');
  });
});
