import { useSimulationStore } from '../store/simulationStore';
import { isDeviceOffline } from './events';

/** ¿El dispositivo está simulado como desconectado? (se repinta solo cuando cambia). */
export function useDeviceOffline(deviceId: string): boolean {
  return useSimulationStore((s) => isDeviceOffline(s.sim, deviceId));
}

