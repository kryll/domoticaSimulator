import type { EntityState, EntityStateValue } from '../../types';

export function num(v: EntityStateValue | undefined, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function attr(state: EntityState | undefined, key: string): EntityStateValue | undefined {
  return state?.attributes?.[key];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1] ?? 'ff', 16), parseInt(m[2] ?? 'ff', 16), parseInt(m[3] ?? 'ff', 16)];
}

/** Formato español con coma decimal. */
export function fmt(n: number, decimals = 1): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

export function isOn(state: EntityState | undefined): boolean {
  const v = state?.state;
  return v === 'on' || v === true;
}

export function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
}
