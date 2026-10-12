// Utilidades puras sobre estados de entidades, compartidas por el motor, las trazas y la energía.
import type { EntityStateValue, SimulationState } from '../types';

/** Estado como texto de HA (true → "on", false → "off"). */
export function normalizeState(v: EntityStateValue): string {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return String(v);
}

/** Compara estados como HA (true ≡ "on", 21 ≡ "21"). */
export function sameState(a: EntityStateValue, b: EntityStateValue): boolean {
  return normalizeState(a) === normalizeState(b);
}

/** Valor numérico de un estado o atributo (undefined si no es un número). */
export function toNumber(v: EntityStateValue | undefined): number | undefined {
  if (v === undefined || typeof v === 'boolean' || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function inNumericRange(v: EntityStateValue | undefined, above?: number, below?: number): boolean {
  const n = toNumber(v);
  if (n === undefined) return false;
  return (above === undefined || n > above) && (below === undefined || n < below);
}

/** Nombre amigable de la entidad (o su entity_id si no tiene). */
export function friendlyName(sim: Pick<SimulationState, 'entities'>, entityId: string): string {
  const name = sim.entities[entityId]?.attributes?.friendly_name;
  return name === undefined ? entityId : String(name);
}
