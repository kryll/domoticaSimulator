import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { projectEntities } from '../canvas/analysis';
import { stateOptions, type StateOption } from '../devices/stateLabels';

/** Estados traducidos posibles de la entidad (según su dominio, device_class y capacidades). */
export function useStateOptions(entityId: string): StateOption[] {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    if (!entityId) return [];
    const ref = projectEntities(project).find((r) => r.entityId === entityId);
    const domain = ref?.definition.domain ?? entityId.split('.')[0] ?? '';
    return stateOptions(domain, ref?.definition.deviceClass, ref?.definition.capabilities);
  }, [project, entityId]);
}
