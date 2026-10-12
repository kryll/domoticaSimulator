// Disponibilidad del motor (fallos, desconexiones, baterías agotadas) y ciclo de vida de los
// nodos del lab → topics online/offline. Funciones puras.
import type { Id, Project, SimulationState } from '../../types';
import type { BridgeModel, MqttMessage } from './model';

export interface BridgeAvailability {
  /** El simulador va acoplado en tiempo real (modo en vivo). Si no, todo pasa a offline. */
  live: boolean;
  /** Dispositivos del proyecto no disponibles en el simulador. */
  unavailable: Id[];
}

/** Disponibilidad a partir del estado del motor. */
export function availabilityFromSim(
  project: Pick<Project, 'devices'>,
  sim: Pick<SimulationState, 'offline' | 'failureOffline' | 'batteries'>,
  live = true,
): BridgeAvailability {
  const ids = new Set(project.devices.map((d) => d.id));
  const down = new Set<Id>();
  for (const id of Object.keys(sim.offline ?? {})) if (ids.has(id)) down.add(id);
  for (const id of sim.failureOffline ?? []) if (ids.has(id)) down.add(id);
  for (const [id, level] of Object.entries(sim.batteries ?? {})) if (level <= 0 && ids.has(id)) down.add(id);
  return { live, unavailable: [...down].sort() };
}

/** ¿Está caído el coordinador del Z2M emulado (fallo o nodo parado)? */
export function coordinatorDown(model: BridgeModel, avail: BridgeAvailability, stopped: ReadonlySet<Id> = new Set()): boolean {
  const id = model.coordinator.deviceId;
  return id !== undefined && (avail.unavailable.includes(id) || stopped.has(id));
}

const z2mState = (online: boolean): string => JSON.stringify({ state: online ? 'online' : 'offline' });

/**
 * Mensajes retenidos de disponibilidad: bridge/state de cada perfil y la availability de cada
 * dispositivo. Sin modo en vivo todo va a offline; con el coordinador caído, el bridge/state de
 * Z2M pasa a offline (HA marca no disponibles todos sus dispositivos). Los nodos parados
 * (`stopped`) también van a offline.
 */
export function availabilityMessages(model: BridgeModel, avail: BridgeAvailability, stopped: ReadonlySet<Id> = new Set()): MqttMessage[] {
  const down = new Set(avail.unavailable);
  const out: MqttMessage[] = [
    { topic: model.bridgeStateTopic, payload: avail.live ? 'online' : 'offline', retain: true },
  ];
  if (model.devices.some((d) => d.profile === 'z2m')) {
    out.push({ topic: model.z2mBridgeStateTopic, payload: z2mState(avail.live && !coordinatorDown(model, avail, stopped)), retain: true });
  }
  for (const bdev of model.devices) {
    const online = avail.live && !down.has(bdev.device.id) && !stopped.has(bdev.device.id);
    out.push({ topic: bdev.availabilityTopic, payload: bdev.profile === 'z2m' ? z2mState(online) : online ? 'online' : 'offline', retain: true });
  }
  return out;
}
