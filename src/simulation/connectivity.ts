// Estado de la conectividad según los fallos simulados (sin dependencias del motor).
import type { Device, DeviceDefinition, Failures, Project, SimulationState } from '../types';
import { isCloud, allDefinitions } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';

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

/** ¿Hay Internet? No si se ha cortado, o si hay corte de luz y ningún router tiene SAI. */
export function internetAvailable(project: Pick<Project, 'devices' | 'customDefinitions'>, defs: DeviceDefinition[], failures: Failures): boolean {
  defs = allDefinitions(project, defs);
  if (failures.internet) return false;
  if (!failures.powerOutage) return true;
  return project.devices.some((d) => d.ups === true && defs.find((x) => x.id === d.definitionId)?.role === 'access_point');
}
