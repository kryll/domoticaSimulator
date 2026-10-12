import type { Id, Point } from '../types';

export interface Placed {
  id: Id;
  position: Point;
}

/** Alinear: a la izquierda/derecha/centro horizontal (eje x) o arriba/abajo/centro vertical (eje y). */
export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

function pick(values: number[], mode: 'min' | 'mid' | 'max'): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return mode === 'min' ? min : mode === 'max' ? max : Math.round((min + max) / 2);
}

/** Nuevas posiciones al alinear. Solo devuelve los elementos que cambian. */
export function alignPositions(items: Placed[], mode: AlignMode): Placed[] {
  if (items.length < 2) return [];
  const horizontal = mode === 'left' || mode === 'centerX' || mode === 'right';
  const which = mode === 'left' || mode === 'top' ? 'min' : mode === 'right' || mode === 'bottom' ? 'max' : 'mid';
  const target = pick(
    items.map((i) => (horizontal ? i.position.x : i.position.y)),
    which,
  );
  return items
    .filter((i) => (horizontal ? i.position.x : i.position.y) !== target)
    .map((i) => ({ id: i.id, position: horizontal ? { x: target, y: i.position.y } : { x: i.position.x, y: target } }));
}

/**
 * Reparte a la misma distancia entre el primero y el último (por orden en el eje).
 * Hacen falta al menos 3 elementos. Solo devuelve los que cambian.
 */
export function distributePositions(items: Placed[], axis: DistributeAxis): Placed[] {
  if (items.length < 3) return [];
  const key = axis === 'horizontal' ? 'x' : 'y';
  const sorted = [...items].sort((a, b) => a.position[key] - b.position[key] || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [];
  const step = (last.position[key] - first.position[key]) / (sorted.length - 1);
  const out: Placed[] = [];
  sorted.forEach((item, i) => {
    const value = Math.round(first.position[key] + step * i);
    if (value !== item.position[key]) out.push({ id: item.id, position: { ...item.position, [key]: value } });
  });
  return out;
}
