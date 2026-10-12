import { activeSegments, gapSegments, isNumericWithGaps, numericPath } from './sparkline';

describe('sparkline', () => {
  const box = { width: 100, height: 20, pad: 0 };

  it('dibuja una ruta escalonada hasta el final de la ventana', () => {
    const r = numericPath(
      [
        { t: 0, v: 10 },
        { t: 50, v: 20 },
      ],
      0,
      100,
      box,
    );
    expect(r?.d).toBe('M0.0,20.0H50.0V0.0H100.0');
    expect(r?.min).toBe(10);
    expect(r?.max).toBe(20);
  });

  it('sin números no hay ruta', () => {
    expect(numericPath([{ t: 0, v: 'on' }], 0, 100, box)).toBeNull();
  });

  it('calcula los tramos activos', () => {
    const segs = activeSegments(
      [
        { t: 0, v: 'off' },
        { t: 20, v: 'on' },
        { t: 60, v: 'off' },
        { t: 90, v: 'on' },
      ],
      0,
      100,
      100,
    );
    expect(segs).toEqual([
      { x: 20, w: 40 },
      { x: 90, w: 10 },
    ]);
  });

  it('corta la línea y marca los huecos de no disponible', () => {
    const samples = [
      { t: 0, v: 10 },
      { t: 40, v: 'unavailable' },
      { t: 60, v: 20 },
    ];
    expect(isNumericWithGaps(samples)).toBe(true);
    expect(numericPath(samples, 0, 100, box)?.d).toBe('M0.0,20.0H40.0M60.0,0.0H100.0');
    expect(gapSegments(samples, 0, 100, 100)).toEqual([{ x: 40, w: 20 }]);
  });
});
