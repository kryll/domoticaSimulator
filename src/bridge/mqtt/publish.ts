// Qué publica el orquestador para un modelo: discovery retenido (bridge Z2M y dispositivos),
// disponibilidad y estados. Funciones puras: el orquestador (emulator/orchestrator/src/lab.ts) las
// usa tal cual y los tests prueban así el mismo camino.
import type { EntityState, Id } from '../../types';
import type { BridgeDevice, BridgeModel, MqttMessage } from './model';
import { genericDiscovery, z2mBridgeDiscovery, z2mBridgeMessages, z2mDiscovery } from './discovery';
import { entityStateToPayload, z2mDevicePayload } from './state';
import { availabilityMessages, type BridgeAvailability } from './availability';

/** Discovery de un dispositivo (Z2M: uno por entidad; genérico: uno por dispositivo). */
export function deviceDiscovery(model: BridgeModel, bdev: BridgeDevice): MqttMessage[] {
  return bdev.profile === 'z2m' ? z2mDiscovery(model, bdev) : [genericDiscovery(model, bdev)];
}

/** bridge/info, bridge/devices y el discovery del bridge del Z2M emulado (si hay dispositivos Z2M). */
export function bridgeDiscovery(model: BridgeModel): MqttMessage[] {
  return model.devices.some((d) => d.profile === 'z2m') ? [...z2mBridgeMessages(model), z2mBridgeDiscovery(model)] : [];
}

/** Todos los retenidos que deben existir: bridge, discovery y disponibilidad. */
export function desiredRetained(model: BridgeModel, availability: BridgeAvailability, stopped: ReadonlySet<Id> = new Set()): MqttMessage[] {
  return [...bridgeDiscovery(model), ...model.devices.flatMap((d) => deviceDiscovery(model, d)), ...availabilityMessages(model, availability, stopped)];
}

/** Estado de un dispositivo (Z2M: un JSON por dispositivo; genérico: uno por entidad). Sin retener. */
export function deviceStateMessages(model: BridgeModel, bdev: BridgeDevice, entities: Readonly<Record<string, EntityState>>): MqttMessage[] {
  if (bdev.profile === 'z2m') {
    const payload = z2mDevicePayload(bdev, entities);
    return payload === undefined ? [] : [{ topic: `${model.settings.z2mBaseTopic}/${bdev.friendlyName}`, payload, retain: false }];
  }
  const out: MqttMessage[] = [];
  for (const e of bdev.entities) {
    const payload = entityStateToPayload(e, entities[e.entityId]);
    if (payload !== undefined) out.push({ topic: e.stateTopic, payload, retain: false });
  }
  return out;
}

/** Estados de los dispositivos en marcha (los parados no publican). */
export function stateMessages(model: BridgeModel, entities: Readonly<Record<string, EntityState>>, stopped: ReadonlySet<Id> = new Set()): MqttMessage[] {
  return model.devices.filter((d) => !stopped.has(d.device.id)).flatMap((d) => deviceStateMessages(model, d, entities));
}
