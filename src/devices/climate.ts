// Lógica pura de climatización compartida por el motor y la presentación.

export type HvacAction = 'heating' | 'cooling' | 'drying' | 'fan' | 'idle' | 'off';

/** Margen (°C) para considerar alcanzada la consigna. */
export const HVAC_TOLERANCE = 0.2;

/**
 * hvac_action derivada del modo, la temperatura actual y la consigna: calienta si está por
 * debajo de la consigna (modos heat/auto/heat_cool), enfría si está por encima (cool/heat_cool).
 */
export function hvacAction(mode: string, current: number | undefined, target: number | undefined): HvacAction {
  if (mode === 'off' || mode === 'unavailable') return 'off';
  // Tanda 3: aire acondicionado en deshumidificación o solo ventilador.
  if (mode === 'dry') return 'drying';
  if (mode === 'fan_only') return 'fan';
  if (current === undefined || target === undefined) return 'idle';
  const heats = mode === 'heat' || mode === 'auto' || mode === 'heat_cool';
  const cools = mode === 'cool' || mode === 'heat_cool';
  if (heats && current < target - HVAC_TOLERANCE) return 'heating';
  if (cools && current > target + HVAC_TOLERANCE) return 'cooling';
  return 'idle';
}
