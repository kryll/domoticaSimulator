import {
  NODE_FOOTPRINT,
  findFreeSpot,
  pointInPolygon,
  polygonBounds,
  reassignRooms,
  rectFromPoints,
  rectToPolygon,
  resolveRoomId,
  roomAt,
  translatePolygon,
} from './geometry';
import { makeDevice, makeProject } from '../test/fixtures';
import type { Room } from '../types';

const square = rectToPolygon({ x: 0, y: 0, width: 100, height: 100 });
const big: Room = { id: 'big', floorId: 'f1', name: 'Grande', polygon: rectToPolygon({ x: 0, y: 0, width: 400, height: 400 }) };
const small: Room = { id: 'small', floorId: 'f1', name: 'Pequeña', polygon: square };
const other: Room = { id: 'other', floorId: 'f2', name: 'Otra planta', polygon: square };

describe('geometry', () => {
  it('pointInPolygon', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 1, y: 1 }, [])).toBe(false);
  });

  it('bounds, rectángulos y traslación', () => {
    expect(polygonBounds(square)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(polygonBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(rectFromPoints({ x: 10, y: 50 }, { x: 0, y: 20 })).toEqual({ x: 0, y: 20, width: 10, height: 30 });
    expect(translatePolygon(square, 5, -5)[0]).toEqual({ x: 5, y: -5 });
  });

  it('roomAt elige la sala más pequeña de la planta', () => {
    expect(roomAt([big, small, other], 'f1', { x: 50, y: 50 })?.id).toBe('small');
    expect(roomAt([big, small, other], 'f1', { x: 300, y: 300 })?.id).toBe('big');
    expect(roomAt([big, small, other], 'f2', { x: 300, y: 300 })).toBeUndefined();
  });

  it('resolveRoomId conserva la sala manual sin rectángulo y la quita al salir del rectángulo', () => {
    const manual: Room = { id: 'manual', floorId: 'f1', name: 'Manual', polygon: [] };
    expect(resolveRoomId([small, manual], 'f1', { x: 500, y: 500 }, 'manual')).toBe('manual');
    expect(resolveRoomId([small, manual], 'f1', { x: 500, y: 500 }, 'small')).toBeUndefined();
    expect(resolveRoomId([small, manual], 'f1', { x: 50, y: 50 }, 'manual')).toBe('small');
  });

  it('reassignRooms devuelve el mismo proyecto si nada cambia', () => {
    const p = makeProject({ rooms: [small], devices: [makeDevice('hue-white-e27', 'd1', 50, 50)] });
    const assigned = reassignRooms(p, 'f1');
    expect(assigned.devices[0]?.roomId).toBe('small');
    expect(reassignRooms(assigned, 'f1')).toBe(assigned);
  });

  it('findFreeSpot evita solaparse con nodos existentes', () => {
    const center = { x: 0, y: 0 };
    expect(findFreeSpot([], center)).toEqual(center);
    const occupied = [center, { x: NODE_FOOTPRINT.width, y: 0 }];
    const spot = findFreeSpot(occupied, center);
    for (const o of occupied) {
      const overlaps = Math.abs(o.x - spot.x) < NODE_FOOTPRINT.width && Math.abs(o.y - spot.y) < NODE_FOOTPRINT.height;
      expect(overlaps).toBe(false);
    }
    expect(Math.hypot(spot.x, spot.y)).toBeLessThanOrEqual(NODE_FOOTPRINT.width * 1.5);
  });
});
