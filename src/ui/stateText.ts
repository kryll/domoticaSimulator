// Texto legible del estado de una entidad para la interfaz: números con unidad y coma decimal,
// y el resto traducido con stateLabel (nada de «on», «heat» o «frost_guard» crudos).
import type { EntityDefinition, EntityState } from '../types';
import { stateLabel } from '../devices/stateLabels';
import { formatNumber } from '../devices/presentation';

function isNumericValue(v: string): boolean {
  return v.trim() !== '' && Number.isFinite(Number(v));
}

export function entityStateText(entityId: string, state: EntityState | undefined, definition?: Pick<EntityDefinition, 'unit' | 'deviceClass'>): string {
  if (!state) return '—';
  const v = state.state;
  const unitAttr = state.attributes?.unit_of_measurement;
  const unit = definition?.unit ?? (typeof unitAttr === 'string' ? unitAttr : undefined);
  if (typeof v === 'number' || (typeof v === 'string' && isNumericValue(v) && !entityId.startsWith('person.'))) {
    return `${formatNumber(Number(v))}${unit ? ` ${unit}` : ''}`;
  }
  const dcAttr = state.attributes?.device_class;
  const deviceClass = definition?.deviceClass ?? (typeof dcAttr === 'string' ? dcAttr : undefined);
  return stateLabel(entityId, v, deviceClass);
}
