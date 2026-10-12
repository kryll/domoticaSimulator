// Rejilla y colores de la capa «Señal» (solo interfaz).
import type { Floor, Point } from '../../types';
import type { HeatGrid } from '../../network/walls';

/** Celdas máximas del mapa (coste: celdas × fuentes × paredes). */
export const MAX_HEAT_CELLS = 4800;

/** Área a cubrir (salas, dispositivos y paredes de la planta con margen) y tamaño de celda. */
export function heatGridFor(floor: Floor, points: Point[], maxCells = MAX_HEAT_CELLS): HeatGrid | null {
  const all = [...points, ...(floor.walls ?? []).flatMap((w) => [w.a, w.b])];
  if (all.length === 0) return null;
  const pad = floor.pixelsPerMeter * 2;
  const minX = Math.min(...all.map((p) => p.x)) - pad;
  const minY = Math.min(...all.map((p) => p.y)) - pad;
  const maxX = Math.max(...all.map((p) => p.x)) + pad;
  const maxY = Math.max(...all.map((p) => p.y)) + pad;
  const width = maxX - minX;
  const height = maxY - minY;
  // Medio metro por celda, o más si el área es grande.
  const step = Math.max(floor.pixelsPerMeter / 2, Math.sqrt((width * height) / maxCells), 4);
  return { x0: Math.floor(minX), y0: Math.floor(minY), width: Math.ceil(width), height: Math.ceil(height), step: Math.ceil(step) };
}

/** Color RGBA para un margen en dB sobre la sensibilidad (≥ 0 = hay cobertura). */
export function marginRgba(margin: number): [number, number, number, number] {
  if (!Number.isFinite(margin) || margin < -6) return [220, 38, 38, 70]; // sin cobertura
  if (margin < 0) return [249, 115, 22, 110]; // al límite
  if (margin < 10) return [234, 179, 8, 120]; // débil
  if (margin < 25) return [132, 204, 22, 110]; // buena
  return [22, 163, 74, 110]; // excelente
}

export const SIGNAL_LEGEND: Array<{ label: string; margin: number }> = [
  { label: 'Excelente', margin: 30 },
  { label: 'Buena', margin: 15 },
  { label: 'Débil', margin: 5 },
  { label: 'Al límite', margin: -3 },
  { label: 'Sin cobertura', margin: -20 },
];
