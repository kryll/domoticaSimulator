// Geometría del modo «Dibujar pared» (solo interfaz): ajuste a la rejilla y a los extremos.
import type { Point, Wall, WallMaterial } from '../../types';

export const WALL_GRID = 10;
export const WALL_SNAP_PX = 12;
export const MIN_WALL_PX = 10;

export { WALL_MATERIAL_LABELS } from '../../network/walls';

export const WALL_MATERIAL_STYLE: Record<WallMaterial, { color: string; width: number; dash?: string }> = {
  drywall: { color: '#94a3b8', width: 4 },
  brick: { color: '#b45309', width: 6 },
  concrete: { color: '#334155', width: 8 },
  glass: { color: '#38bdf8', width: 4, dash: '8 4' },
};

/** Ajusta un punto al extremo de pared más cercano (si está cerca) o a la rejilla. */
export function snapPoint(p: Point, walls: Wall[], snapPx = WALL_SNAP_PX, grid = WALL_GRID): Point {
  let best: Point | null = null;
  let bestD = snapPx;
  for (const w of walls) {
    for (const q of [w.a, w.b]) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) {
        best = q;
        bestD = d;
      }
    }
  }
  if (best) return { x: best.x, y: best.y };
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** Con Mayús: fuerza la pared horizontal o vertical. */
export function constrainOrthogonal(a: Point, b: Point): Point {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}

/** Pared a partir de dos puntos, o null si es demasiado corta. */
export function makeWall(a: Point, b: Point, material: WallMaterial): Wall | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_WALL_PX) return null;
  return { a, b, material };
}

/** Longitud en metros según la escala de la planta. */
export function wallLengthMeters(w: Pick<Wall, 'a' | 'b'>, pixelsPerMeter: number): number {
  if (pixelsPerMeter <= 0) return 0;
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) / pixelsPerMeter;
}
