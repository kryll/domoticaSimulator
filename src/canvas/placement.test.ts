import type { Device, Point, Project, Room } from '../types';
import { NODE_GAP, NODE_SIZE, placeNewDevices, ROOM_MARGIN, roomAt } from './placement';

const rect = (id: string, x1: number, y1: number, x2: number, y2: number, floorId = 'f'): Room => ({
  id,
  floorId,
  name: id,
  polygon: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
});

const device = (id: string, position: Point, floorId = 'f'): Device => ({ id, definitionId: 'x', name: id, floorId, position, protocol: 'wifi', integration: 'tuya' });

const proj = (rooms: Room[], devices: Device[] = []): Pick<Project, 'rooms' | 'devices'> => ({ rooms, devices });

const overlap = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < NODE_SIZE.width && Math.abs(a.y - b.y) < NODE_SIZE.height;

function noOverlaps(points: Point[]): void {
  points.forEach((a, i) => points.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
}

function insideRoom(p: Point, r: Room): boolean {
  const [a, , c] = r.polygon;
  if (!a || !c) return false;
  return p.x >= a.x + ROOM_MARGIN && p.y >= a.y + ROOM_MARGIN && p.x + NODE_SIZE.width <= c.x - ROOM_MARGIN && p.y + NODE_SIZE.height <= c.y - ROOM_MARGIN;
}

describe('colocación inteligente', () => {
  const salon = rect('salon', 0, 0, 640, 400);

  it('rejilla dentro de la sala respetando el margen', () => {
    const points = placeNewDevices(proj([salon]), 'f', 5, { roomId: 'salon' });
    expect(points).toHaveLength(5);
    for (const p of points) expect(insideRoom(p, salon)).toBe(true);
    noOverlaps(points);
    expect(points[0]).toEqual({ x: ROOM_MARGIN, y: ROOM_MARGIN });
    expect(points[1]).toEqual({ x: ROOM_MARGIN + NODE_SIZE.width + NODE_GAP.x, y: ROOM_MARGIN });
  });

  it('no solapa los nodos que ya hay', () => {
    const existing = [device('a', { x: 20, y: 20 }), device('b', { x: 230, y: 30 })];
    const points = placeNewDevices(proj([salon], existing), 'f', 4, { roomId: 'salon' });
    for (const p of points) {
      expect(insideRoom(p, salon)).toBe(true);
      for (const d of existing) expect(overlap(p, d.position)).toBe(false);
    }
    noOverlaps(points);
  });

  it('solo sale de la sala si no caben', () => {
    const small = rect('aseo', 0, 0, 240, 130);
    const points = placeNewDevices(proj([small]), 'f', 3, { roomId: 'aseo' });
    expect(points).toHaveLength(3);
    expect(insideRoom(points[0] as Point, small)).toBe(true);
    expect(points.slice(1).every((p) => !insideRoom(p, small))).toBe(true);
    noOverlaps(points);
  });

  it('sin sala: zona libre más cercana al centro de la vista', () => {
    const near = { x: 1000, y: 1000 };
    const [first] = placeNewDevices(proj([salon]), 'f', 1, { near });
    expect(first).toEqual({ x: near.x - NODE_SIZE.width / 2, y: near.y - NODE_SIZE.height / 2 });
    const blocked = [device('a', { x: 910, y: 965 })];
    const points = placeNewDevices(proj([salon], blocked), 'f', 3, { near });
    expect(points).toHaveLength(3);
    for (const p of points) expect(overlap(p, { x: 910, y: 965 })).toBe(false);
    noOverlaps(points);
    // Los dispositivos de otra planta no estorban.
    expect(placeNewDevices(proj([], [device('z', { x: 910, y: 965 }, 'g')]), 'f', 1, { near })[0]).toEqual({ x: 910, y: 965 });
  });

  it('casos límite', () => {
    expect(placeNewDevices(proj([salon]), 'f', 0, { roomId: 'salon' })).toEqual([]);
    expect(placeNewDevices(proj([]), 'f', 2)).toHaveLength(2);
    // Sala de otra planta: se ignora y se coloca libre.
    expect(placeNewDevices(proj([rect('x', 0, 0, 640, 400, 'g')]), 'f', 1, { roomId: 'x', near: { x: 0, y: 0 } })).toHaveLength(1);
  });

  it('roomAt', () => {
    const p = proj([salon, rect('armario', 500, 300, 640, 400)]);
    expect(roomAt(p, 'f', { x: 100, y: 100 })?.id).toBe('salon');
    expect(roomAt(p, 'f', { x: 600, y: 350 })?.id).toBe('armario');
    expect(roomAt(p, 'f', { x: 900, y: 900 })).toBeUndefined();
    expect(roomAt(p, 'g', { x: 100, y: 100 })).toBeUndefined();
  });
});
