import type { EntityDefinition } from '../../types';

// Textos de los controles. Tanda 2: salen de la tabla única de estados (devices/stateLabels.ts)
// y de devices/labels.ts, para que el lienzo, las trazas y los controles digan lo mismo.
import { BUTTON_ACTION_LABELS, HVAC_MODE_LABELS, PRESET_LABELS } from '../../devices/labels';
import { DOMAIN_STATE_LABELS } from '../../devices/stateLabels';

export { BUTTON_ACTION_LABELS, PRESET_LABELS };

export const HVAC_LABELS: Record<string, string> = HVAC_MODE_LABELS;

export const LOCK_LABELS: Record<string, string> = DOMAIN_STATE_LABELS.lock ?? {};

export const VACUUM_LABELS: Record<string, string> = DOMAIN_STATE_LABELS.vacuum ?? {};

export function isRemoteEntity(def: EntityDefinition): boolean {
  return def.key === 'action' || (def.capabilities?.buttonActions?.length ?? 0) > 0;
}

