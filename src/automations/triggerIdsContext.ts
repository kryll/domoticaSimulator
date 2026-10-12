import { createContext, useContext } from 'react';

/** ids de los disparadores de la automatización que se está editando (para «Disparado por»). */
export const TriggerIdsContext = createContext<readonly string[]>([]);

export function useTriggerIds(): readonly string[] {
  return useContext(TriggerIdsContext);
}
