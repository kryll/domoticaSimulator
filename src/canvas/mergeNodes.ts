import type { AppNode } from './types';

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.length === kb.length && ka.every((k) => ra[k] === rb[k] || (typeof ra[k] !== 'function' && sameValue(ra[k], rb[k])));
  }
  return false;
}

/** ¿Mismos datos? Compara superficialmente (y arrays/objetos pequeños por valor). */
export function sameData(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k] || sameValue(a[k], b[k]));
}

const NODE_KEYS = ['type', 'selected', 'draggable', 'zIndex', 'width', 'height', 'selectable', 'connectable', 'focusable', 'ariaLabel'] as const;

/**
 * Fusiona los nodos derivados conservando medidas y posición durante el arrastre. Si un nodo no
 * ha cambiado se reutiliza el objeto anterior para que React Flow no lo vuelva a pintar.
 */
export function mergeNodes(prev: AppNode[], next: AppNode[]): AppNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const merged = next.map((n, i) => {
    const old = byId.get(n.id);
    if (!old) {
      changed = true;
      return n;
    }
    const position = old.dragging ? old.position : n.position;
    const same =
      prev[i] === old &&
      old.position.x === position.x &&
      old.position.y === position.y &&
      NODE_KEYS.every((k) => old[k] === n[k]) &&
      sameData(old.data as Record<string, unknown>, n.data as Record<string, unknown>);
    if (same) return old;
    changed = true;
    const data = sameData(old.data as Record<string, unknown>, n.data as Record<string, unknown>) ? old.data : n.data;
    return { ...n, data, measured: old.measured, dragging: old.dragging, position } as AppNode;
  });
  return changed ? merged : prev;
}

