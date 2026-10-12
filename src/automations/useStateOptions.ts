import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { projectEntities } from '../canvas/analysis';
import { stateOptions, type StateOption } from '../devices/stateLabels';
import { findHelperByEntity, TIMER_STATE_LABELS } from '../simulation/helpers';
import type { Helper } from '../types';

/** Estados posibles de un helper (Tanda 3): on/off, sus opciones o los estados del temporizador. */
function helperStateOptions(h: Helper): StateOption[] {
  switch (h.type) {
    case 'input_boolean':
      return [
        { value: 'on', label: 'Encendido' },
        { value: 'off', label: 'Apagado' },
      ];
    case 'input_select':
      return h.options.map((o) => ({ value: o, label: o }));
    case 'timer':
      return Object.entries(TIMER_STATE_LABELS).map(([value, label]) => ({ value, label }));
    default:
      return [];
  }
}

/** Estados traducidos posibles de la entidad (según su dominio, device_class y capacidades). */
export function useStateOptions(entityId: string): StateOption[] {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    if (!entityId) return [];
    const helper = findHelperByEntity(project, entityId);
    if (helper) return helperStateOptions(helper);
    const ref = projectEntities(project).find((r) => r.entityId === entityId);
    const domain = ref?.definition.domain ?? entityId.split('.')[0] ?? '';
    return stateOptions(domain, ref?.definition.deviceClass, ref?.definition.capabilities);
  }, [project, entityId]);
}
