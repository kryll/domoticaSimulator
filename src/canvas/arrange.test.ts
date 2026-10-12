import { alignPositions, distributePositions } from './arrange';

const items = [
  { id: 'a', position: { x: 0, y: 10 } },
  { id: 'b', position: { x: 100, y: 50 } },
  { id: 'c', position: { x: 400, y: 30 } },
];

describe('alinear y distribuir', () => {
  it('alinea a la izquierda y arriba sin tocar el otro eje', () => {
    expect(alignPositions(items, 'left')).toEqual([
      { id: 'b', position: { x: 0, y: 50 } },
      { id: 'c', position: { x: 0, y: 30 } },
    ]);
    expect(alignPositions(items, 'top').map((i) => i.position.y)).toEqual([10, 10]);
  });

  it('centra en el punto medio del conjunto', () => {
    expect(alignPositions(items, 'centerX').map((i) => i.position.x)).toEqual([200, 200, 200]);
    expect(alignPositions(items, 'bottom').map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('no hace nada con menos de dos', () => {
    expect(alignPositions(items.slice(0, 1), 'left')).toEqual([]);
  });

  it('distribuye a intervalos iguales entre los extremos', () => {
    expect(distributePositions(items, 'horizontal')).toEqual([{ id: 'b', position: { x: 200, y: 50 } }]);
    expect(distributePositions(items, 'vertical')).toEqual([]);
    expect(distributePositions(items.slice(0, 2), 'horizontal')).toEqual([]);
  });
});
