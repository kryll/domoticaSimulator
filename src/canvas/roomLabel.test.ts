import { roomLabelPosition } from './roomLabel';

const room = { x: 0, y: 0, width: 600, height: 400 };

describe('roomLabelPosition', () => {
  it('por defecto va abajo y centrada', () => {
    expect(roomLabelPosition(room, [])).toEqual({ x: 300, y: 382 });
  });

  it('busca otro hueco si un nodo tapa el centro inferior', () => {
    const p = roomLabelPosition(room, [{ x: 300, y: 370 }]);
    expect(p.y).toBe(382);
    expect(p.x).toBeLessThan(200);
  });

  it('sube arriba si toda la parte inferior está ocupada', () => {
    const p = roomLabelPosition(room, [
      { x: 90, y: 370 },
      { x: 300, y: 370 },
      { x: 510, y: 370 },
    ]);
    expect(p.y).toBe(18);
  });
});
