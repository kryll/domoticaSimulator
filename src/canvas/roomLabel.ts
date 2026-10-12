import type { Point } from '../types';
import type { Rect } from './geometry';

/** Tamaño aproximado del nodo de dispositivo (centrado en su posición). */
export const DEVICE_BOX = { width: 184, height: 78 };
/** Tamaño aproximado de la etiqueta de sala. */
export const LABEL_BOX = { width: 130, height: 24 };
const MARGIN = 6;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Centro de la etiqueta de una sala: el primer hueco libre de nodos entre abajo-centro,
 * abajo-izquierda, abajo-derecha, arriba-centro, arriba-izquierda y arriba-derecha (C8).
 * Si todos están ocupados, el que menos solapa.
 */
export function roomLabelPosition(bounds: Rect, devices: Point[], labelWidth = LABEL_BOX.width): Point {
  const w = Math.min(labelWidth, Math.max(40, bounds.width - 2 * MARGIN));
  const h = LABEL_BOX.height;
  const left = bounds.x + MARGIN + w / 2;
  const right = bounds.x + bounds.width - MARGIN - w / 2;
  const cx = bounds.x + bounds.width / 2;
  const bottom = bounds.y + bounds.height - MARGIN - h / 2;
  const top = bounds.y + MARGIN + h / 2;
  const candidates: Point[] = [
    { x: cx, y: bottom },
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: cx, y: top },
    { x: left, y: top },
    { x: right, y: top },
  ];
  const boxes: Rect[] = devices.map((d) => ({
    x: d.x - DEVICE_BOX.width / 2,
    y: d.y - DEVICE_BOX.height / 2,
    width: DEVICE_BOX.width,
    height: DEVICE_BOX.height,
  }));
  let best = candidates[0] ?? { x: cx, y: bottom };
  let bestHits = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const rect = { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
    const hits = boxes.filter((b) => overlaps(rect, b)).length;
    if (hits === 0) return c;
    if (hits < bestHits) {
      best = c;
      bestHits = hits;
    }
  }
  return best;
}
