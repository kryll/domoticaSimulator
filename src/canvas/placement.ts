// Colocación inteligente de dispositivos nuevos (lógica pura, sin React).
// Las posiciones son las de Device.position: la esquina superior izquierda del nodo.
import type { Id, Point, Project, Room } from '../types';
import { pointInPolygon, polygonBounds, roomAt as roomAtInRooms } from './geometry';

/** Tamaño de un nodo de dispositivo en el lienzo (px). */
export const NODE_SIZE = { width: 180, height: 70 } as const;
/** Separación mínima entre nodos (px). */
export const NODE_GAP = { x: 20, y: 30 } as const;
/** Margen interior de la sala que no se ocupa (px). */
export const ROOM_MARGIN = 20;

const STEP_X = NODE_SIZE.width + NODE_GAP.x;
const STEP_Y = NODE_SIZE.height + NODE_GAP.y;
/** Anillos de búsqueda de huecos libres fuera de una sala. */
const MAX_RINGS = 40;

export interface PlacementOptions {
  /** Sala donde colocar los dispositivos. */
  roomId?: Id;
  /** Punto de referencia (centro de la vista, punto de soltado...) en coordenadas del lienzo. */
  near?: Point;
}

/** Sala de la planta que contiene el punto (la más pequeña si se solapan). */
export function roomAt(project: Pick<Project, 'rooms'>, floorId: Id, point: Point): Room | undefined {
  return roomAtInRooms(project.rooms, floorId, point);
}

/** ¿Se solapan dos nodos (con la separación mínima)? */
function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < NODE_SIZE.width + NODE_GAP.x / 2 && Math.abs(a.y - b.y) < NODE_SIZE.height + NODE_GAP.y / 2;
}

function isFree(p: Point, occupied: readonly Point[]): boolean {
  return occupied.every((o) => !overlaps(p, o));
}

/** ¿Cabe el nodo entero (con margen) dentro del polígono de la sala? */
function fitsInRoom(p: Point, room: Room): boolean {
  // Un píxel menos de margen: las esquinas no caen justo en el borde, donde el test es ambiguo.
  const m = ROOM_MARGIN - 1;
  const corners: Point[] = [
    { x: p.x - m, y: p.y - m },
    { x: p.x + NODE_SIZE.width + m, y: p.y - m },
    { x: p.x + NODE_SIZE.width + m, y: p.y + NODE_SIZE.height + m },
    { x: p.x - m, y: p.y + NODE_SIZE.height + m },
    { x: p.x + NODE_SIZE.width / 2, y: p.y + NODE_SIZE.height / 2 },
  ];
  return corners.every((c) => pointInPolygon(c, room.polygon));
}

/** Huecos de la rejilla dentro de la sala, por orden de lectura (o de cercanía a `near`). */
function roomSlots(room: Room, occupied: Point[], count: number, near?: Point): Point[] {
  const b = polygonBounds(room.polygon);
  const x0 = b.x + ROOM_MARGIN;
  const y0 = b.y + ROOM_MARGIN;
  const candidates: Point[] = [];
  for (let y = y0; y + NODE_SIZE.height + ROOM_MARGIN <= b.y + b.height; y += STEP_Y) {
    for (let x = x0; x + NODE_SIZE.width + ROOM_MARGIN <= b.x + b.width; x += STEP_X) {
      const p = { x: Math.round(x), y: Math.round(y) };
      if (fitsInRoom(p, room)) candidates.push(p);
    }
  }
  if (near) {
    const d = (p: Point): number => Math.hypot(p.x + NODE_SIZE.width / 2 - near.x, p.y + NODE_SIZE.height / 2 - near.y);
    candidates.sort((a, c) => d(a) - d(c));
  }
  const chosen: Point[] = [];
  const taken = [...occupied];
  for (const p of candidates) {
    if (chosen.length >= count) break;
    if (!isFree(p, taken)) continue;
    chosen.push(p);
    taken.push(p);
  }
  return chosen;
}

/** Huecos libres más cercanos a `center` (centro de los nodos) en una rejilla alineada con él. */
function freeSlots(center: Point, occupied: Point[], count: number, avoid: (p: Point) => boolean = () => false): Point[] {
  const origin = { x: Math.round(center.x - NODE_SIZE.width / 2), y: Math.round(center.y - NODE_SIZE.height / 2) };
  const chosen: Point[] = [];
  const taken = [...occupied];
  for (let ring = 0; ring <= MAX_RINGS && chosen.length < count; ring++) {
    const ringCells: Point[] = [];
    for (let j = -ring; j <= ring; j++) {
      for (let i = -ring; i <= ring; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        ringCells.push({ x: origin.x + i * STEP_X, y: origin.y + j * STEP_Y });
      }
    }
    // Por cercanía al centro y, a igualdad, por orden de lectura.
    ringCells.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y) || a.y - b.y || a.x - b.x);
    for (const p of ringCells) {
      if (chosen.length >= count) break;
      if (!isFree(p, taken) || avoid(p)) continue;
      chosen.push(p);
      taken.push(p);
    }
  }
  return chosen;
}

/** Centro razonable de la planta si no se da `near`: el de sus salas o el de sus dispositivos. */
function floorCenter(project: Pick<Project, 'rooms' | 'devices'>, floorId: Id): Point {
  const points = [
    ...project.rooms.filter((r) => r.floorId === floorId).flatMap((r) => r.polygon),
    ...project.devices.filter((d) => d.floorId === floorId).map((d) => ({ x: d.position.x + NODE_SIZE.width / 2, y: d.position.y + NODE_SIZE.height / 2 })),
  ];
  if (points.length === 0) return { x: 200, y: 200 };
  const b = polygonBounds(points);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Posiciones (esquina superior izquierda) para `count` dispositivos nuevos en la planta:
 * - con `roomId`: en rejilla dentro de la sala, respetando su margen y sin solapar nodos
 *   (180 × 70); los que no quepan van al hueco libre más cercano fuera de ella;
 * - sin sala: en la zona libre más cercana a `near` (el centro de la vista) o al centro de la planta.
 * Nunca solapa los nodos existentes ni los nuevos entre sí.
 */
export function placeNewDevices(
  project: Pick<Project, 'rooms' | 'devices'>,
  floorId: Id,
  count: number,
  opts: PlacementOptions = {},
): Point[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const occupied = project.devices.filter((d) => d.floorId === floorId).map((d) => d.position);
  const room = opts.roomId ? project.rooms.find((r) => r.id === opts.roomId && r.floorId === floorId && r.polygon.length >= 3) : undefined;
  if (!room) return freeSlots(opts.near ?? floorCenter(project, floorId), occupied, n);
  const inside = roomSlots(room, occupied, n, opts.near);
  if (inside.length >= n) return inside;
  // No caben: el resto, en el hueco libre más cercano a la sala pero fuera de ella.
  const b = polygonBounds(room.polygon);
  const center = opts.near ?? { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const outsideRoom = (p: Point): boolean => {
    const c = { x: p.x + NODE_SIZE.width / 2, y: p.y + NODE_SIZE.height / 2 };
    return pointInPolygon(c, room.polygon);
  };
  return [...inside, ...freeSlots(center, [...occupied, ...inside], n - inside.length, outsideRoom)];
}
