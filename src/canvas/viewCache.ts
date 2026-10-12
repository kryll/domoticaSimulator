// Memoización de la presentación de cada dispositivo: deviceView y primaryAction solo se
// recalculan si cambia el propio dispositivo o alguna de sus entidades (no en cada tick).
import type { Device, DeviceDefinition, EntityState, SimulationState } from '../types';
import { entityIdsForDevice } from '../devices/entities';
import { deviceView, primaryAction, stepAction, type DeviceView, type QuickAction } from '../devices/presentation';

interface Entry {
  device: Device;
  def: DeviceDefinition;
  states: Array<EntityState | undefined>;
  offline: unknown;
  view: DeviceView;
  primary: QuickAction | null;
  steppable: boolean;
}

export interface DevicePresentation {
  view: DeviceView;
  primary: QuickAction | null;
  /** ¿Admite subir/bajar nivel (rueda, ↑/↓)? */
  steppable: boolean;
}

const cache = new Map<string, Entry>();
/** Número de cálculos reales (para tests). */
export let presentationComputations = 0;

function sameStates(a: Array<EntityState | undefined>, b: Array<EntityState | undefined>): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Vista y acción principal del dispositivo, reutilizadas mientras sus entidades no cambien. */
export function devicePresentation(device: Device, def: DeviceDefinition, sim: SimulationState): DevicePresentation {
  const states = entityIdsForDevice(device, def).map((id) => sim.entities[id]);
  const offline = sim.offline?.[device.id];
  const hit = cache.get(device.id);
  if (hit && hit.device === device && hit.def === def && hit.offline === offline && sameStates(hit.states, states)) {
    return hit;
  }
  presentationComputations++;
  const view = deviceView(device, def, sim);
  const primary = primaryAction(device, def, sim);
  const steppable = stepAction(device, def, sim, 1) !== null || stepAction(device, def, sim, -1) !== null;
  cache.set(device.id, { device, def, states, offline, view, primary, steppable });
  return { view, primary, steppable };
}

export function clearPresentationCache(): void {
  cache.clear();
}
