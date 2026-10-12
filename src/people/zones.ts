import { useMemo } from 'react';
import type { Person, Zone } from '../types';
import { useProjectStore } from '../store/projectStore';
import { projectZones } from '../simulation/logic';

const EMPTY_PEOPLE: Person[] = [];

export function usePeople(): Person[] {
  return useProjectStore((s) => s.project.people ?? EMPTY_PEOPLE);
}

/** Zonas del proyecto; «Casa» está siempre aunque el proyecto no la declare. */
export function useZones(): Zone[] {
  const zones = useProjectStore((s) => s.project.zones);
  return useMemo(() => projectZones({ zones }), [zones]);
}
