import { heatGridFor, marginRgba, MAX_HEAT_CELLS } from './signalGrid';

const floor = { id: 'f1', name: 'P', level: 0, pixelsPerMeter: 50 };

describe('signalGrid', () => {
  it('sin puntos no hay rejilla', () => {
    expect(heatGridFor(floor, [])).toBeNull();
  });

  it('cubre los puntos con margen y limita el número de celdas', () => {
    const grid = heatGridFor(floor, [
      { x: 0, y: 0 },
      { x: 5000, y: 3000 },
    ]);
    if (!grid) throw new Error('sin rejilla');
    expect(grid.x0).toBeLessThan(0);
    expect(grid.x0 + grid.width).toBeGreaterThan(5000);
    const cells = Math.ceil(grid.width / grid.step) * Math.ceil(grid.height / grid.step);
    expect(cells).toBeLessThanOrEqual(MAX_HEAT_CELLS * 1.1);
  });

  it('colorea según el margen', () => {
    expect(marginRgba(-30)[0]).toBe(220);
    expect(marginRgba(30)).toEqual([22, 163, 74, 110]);
  });
});
