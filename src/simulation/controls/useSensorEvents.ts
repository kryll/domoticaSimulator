import { useMemo } from 'react';
import { useSimulationStore } from '../../store/simulationStore';
import type { SensorEvents } from './types';

/** Eventos físicos conectados al store de simulación. */
export function useSensorEvents(): SensorEvents {
  const motionPulse = useSimulationStore((s) => s.motionPulse);
  const setBinary = useSimulationStore((s) => s.setBinary);
  const setValue = useSimulationStore((s) => s.setSensorValue);
  const press = useSimulationStore((s) => s.pressButton);
  const jam = useSimulationStore((s) => s.jamLock);
  return useMemo(
    () => ({ motionPulse: (id: string) => motionPulse(id), setBinary, setValue, press, jam }),
    [motionPulse, setBinary, setValue, press, jam],
  );
}

