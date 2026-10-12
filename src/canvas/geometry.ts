import type { Id, Point, Project, Room } from '../types';

/** Rectángulo alineado con los ejes. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Punto dentro de polígono (ray casting). */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    const intersects =
      a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonBounds(polygon: Point[]): Rect {
  if (polygon.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function rectToPolygon(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/** Rectángulo normalizado entre dos esquinas cualesquiera. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function translatePolygon(polygon: Point[], dx: number, dy: number): Point[] {
  return polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Sala de la planta que contiene el punto (la más pequeña si se solapan). */
export function roomAt(rooms: Room[], floorId: Id, point: Point): Room | undefined {
  const candidates = rooms.filter((r) => r.floorId === floorId && pointInPolygon(point, r.polygon));
  let best: Room | undefined;
  let bestArea = Infinity;
  for (const r of candidates) {
    const b = polygonBounds(r.polygon);
    const area = b.width * b.height;
    if (area < bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Sala que corresponde a un dispositivo en `point`: la sala que lo contiene; si no
 * cae en ninguna, conserva la sala manual salvo que ésta tenga rectángulo en la
 * planta y el punto haya salido de él.
 */
export function resolveRoomId(
  rooms: Room[],
  floorId: Id,
  point: Point,
  currentRoomId: Id | undefined,
): Id | undefined {
  const hit = roomAt(rooms, floorId, point);
  if (hit) return hit.id;
  if (!currentRoomId) return undefined;
  const current = rooms.find((r) => r.id === currentRoomId);
  if (!current) return undefined;
  if (current.floorId === floorId && current.polygon.length >= 3) return undefined;
  return currentRoomId;
}

/** Recalcula la sala de todos los dispositivos de una planta. */
export function reassignRooms(project: Project, floorId: Id): Project {
  let changed = false;
  const devices = project.devices.map((d) => {
    if (d.floorId !== floorId) return d;
    const roomId = resolveRoomId(project.rooms, floorId, d.position, d.roomId);
    if (roomId === d.roomId) return d;
    changed = true;
    return { ...d, roomId };
  });
  return changed ? { ...project, devices } : project;
}
