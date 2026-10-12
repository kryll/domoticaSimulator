import { useEffect, useState } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { energySummary, type EnergySummary } from '../simulation/energy';

/** Intervalo mínimo entre recálculos del panel mientras corre el reloj. */
export const ENERGY_THROTTLE_MS = 500;

function compute(): EnergySummary {
  return energySummary(useSimulationStore.getState().sim, useProjectStore.getState().project, knownDefinitions());
}

/** Resumen de energía recalculado como mucho cada 500 ms (el reloj cambia en cada tick). */
export function useThrottledEnergy(): EnergySummary {
  const [summary, setSummary] = useState(compute);
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      timer = undefined;
      last = performance.now();
      setSummary(compute());
    };
    const schedule = () => {
      if (timer) return;
      const wait = Math.max(0, ENERGY_THROTTLE_MS - (performance.now() - last));
      timer = setTimeout(refresh, wait);
    };
    const unsubSim = useSimulationStore.subscribe((s, prev) => {
      if (s.sim !== prev.sim) schedule();
    });
    const unsubProject = useProjectStore.subscribe((s, prev) => {
      if (s.project !== prev.project) schedule();
    });
    return () => {
      unsubSim();
      unsubProject();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return summary;
}
