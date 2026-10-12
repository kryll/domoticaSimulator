import { constrainOrthogonal, makeWall, snapPoint, wallLengthMeters } from './wallGeometry';

describe('wallGeometry', () => {
  it('ajusta a la rejilla', () => {
    expect(snapPoint({ x: 14, y: 26 }, [])).toEqual({ x: 10, y: 30 });
  });

  it('ajusta al extremo de una pared cercana antes que a la rejilla', () => {
    const walls = [{ a: { x: 103, y: 47 }, b: { x: 200, y: 47 }, material: 'brick' as const }];
    expect(snapPoint({ x: 108, y: 50 }, walls)).toEqual({ x: 103, y: 47 });
  });

  it('fuerza horizontal o vertical', () => {
    expect(constrainOrthogonal({ x: 0, y: 0 }, { x: 100, y: 20 })).toEqual({ x: 100, y: 0 });
    expect(constrainOrthogonal({ x: 0, y: 0 }, { x: 10, y: 80 })).toEqual({ x: 0, y: 80 });
  });

  it('descarta paredes demasiado cortas', () => {
    expect(makeWall({ x: 0, y: 0 }, { x: 3, y: 3 }, 'glass')).toBeNull();
    expect(makeWall({ x: 0, y: 0 }, { x: 50, y: 0 }, 'glass')).toEqual({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, material: 'glass' });
  });

  it('mide en metros', () => {
    expect(wallLengthMeters({ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }, 50)).toBe(2);
  });
});
