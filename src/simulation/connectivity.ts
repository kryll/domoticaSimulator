// Estado de la conectividad según los fallos simulados (sin dependencias del motor).
import type { Device, DeviceDefinition, Failures, Project, SimulationState } from '../types';
import { isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';
import { failuresMayCutInternet, internetLoss } from '../network/internet';

export { failuresMayCutInternet, internetLoss, cloudLossReason } from '../network/internet';

export const NO_FAILURES: Failures = { internet: false, powerOutage: false, haRestarting: false, devicesDown: [] };

/** Fallos activos de la simulación (sin fallos si no hay ninguno). */
export function activeFailures(sim: Pick<SimulationState, 'failures'>): Failures {
  return sim.failures ?? NO_FAILURES;
}

/** ¿Hay algún fallo simulado activo? */
export function hasFailures(f: Failures): boolean {
  return f.internet || f.powerOutage || f.haRestarting || f.devicesDown.length > 0;
}

/** ¿Está Home Assistant reiniciándose (no se ejecuta ninguna automatización)? */
export function isHaRestarting(sim: Pick<SimulationState, 'failures'>): boolean {
  return sim.failures?.haRestarting === true;
}

const MAINS_LIKE = new Set(['mains', 'poe', 'usb']);

/** ¿Funciona con la red eléctrica (y cae en un corte de luz salvo que tenga SAI)? */
export function needsMains(def: DeviceDefinition): boolean {
  return MAINS_LIKE.has(def.power);
}

/** ¿El dispositivo depende de la nube con su integración actual? */
export function isCloudDevice(device: Device, def: DeviceDefinition): boolean {
  return isCloud(effectiveIotClass(device, def));
}

/**
 * ¿Hay Internet? No si se ha cortado; sin salida a Internet en el proyecto, tampoco con corte de
 * luz si ningún router tiene SAI; con salida a Internet, solo si hay camino desde HA hasta ella
 * por routers que funcionen (ver network/internet.ts).
 */
export function internetAvailable(project: Pick<Project, 'devices' | 'connections' | 'customDefinitions'>, defs: DeviceDefinition[], failures: Failures): boolean {
  if (!failuresMayCutInternet(failures)) return true;
  return internetLoss(project, defs, failures) === null;
}
