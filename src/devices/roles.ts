// Utilidades sobre papeles de red y redes lógicas, compartidas por network/ y export/.
import type { Brand, Device, DeviceDefinition, Id, Integration, IotClass, NetworkRole, Protocol } from '../types';
import { INTEGRATION_IOT_CLASS } from './labels';

/** Equipo propuesto para cada hub propietario. */
export const HUB_FOR_BRAND: Partial<Record<Brand, Id>> = { Aqara: 'aqara-hub-m2', IKEA: 'ikea-dirigera', 'Philips Hue': 'hue-bridge-v2' };

const INFRA_ROLES: readonly NetworkRole[] = ['coordinator', 'hub', 'border_router', 'access_point', 'ha_server'];

/** Infraestructura: coordinadores, hubs, border routers, puntos de acceso y servidor HA. */
export function isInfra(def: DeviceDefinition): boolean {
  return INFRA_ROLES.includes(def.role);
}

export const MESH_PROTOCOLS: readonly Protocol[] = ['zigbee', 'thread', 'zwave'];
export const ZIGBEE_COORDINATOR_INTEGRATIONS: readonly Integration[] = ['zha', 'zigbee2mqtt'];

export function isZigbeeCoordinator(def: DeviceDefinition): boolean {
  return def.role === 'coordinator' && def.protocols.includes('zigbee');
}

export function isZwaveController(def: DeviceDefinition): boolean {
  return def.role === 'coordinator' && def.protocols.includes('zwave');
}

/** Border router Thread: rol border_router o hub con radio Thread (Aqara M3, DIRIGERA). */
export function isThreadBorderRouter(def: DeviceDefinition): boolean {
  return (def.role === 'border_router' || def.role === 'hub') && def.protocols.includes('thread');
}

export function isRfBridge(def: DeviceDefinition): boolean {
  return def.role === 'hub' && def.protocols.includes('rf433');
}

/** Proxy Bluetooth: equipo con BLE, alimentado y con IP (Shelly Gen2+/Gen3) o servidor con BLE. */
export function isBleProxy(def: DeviceDefinition): boolean {
  if (!def.protocols.includes('ble') || def.power === 'battery') return false;
  return def.role === 'ha_server' || def.protocols.includes('wifi') || def.protocols.includes('ethernet');
}

/**
 * Red Zigbee lógica a la que pertenece un dispositivo:
 * "coordinator" (ZHA/Zigbee2MQTT) o "hub:<marca>" si usa la integración de su hub propietario.
 */
export function zigbeeNetworkOf(device: Device, def: DeviceDefinition): string {
  if (def.role === 'coordinator') return 'coordinator';
  if (def.role === 'hub') return `hub:${def.brand}`;
  if (ZIGBEE_COORDINATOR_INTEGRATIONS.includes(device.integration)) return 'coordinator';
  return def.requiresHub ? `hub:${def.requiresHub}` : 'coordinator';
}

/** Marca del hub propietario que necesita el dispositivo con su integración actual, si alguna. */
export function requiredHubBrand(device: Device, def: DeviceDefinition): DeviceDefinition['requiresHub'] {
  if (!def.requiresHub || ZIGBEE_COORDINATOR_INTEGRATIONS.includes(device.integration)) return undefined;
  return def.requiresHub;
}

/** Clase IoT efectiva según la integración elegida en el dispositivo. */
export function effectiveIotClass(device: Device, def: DeviceDefinition): IotClass {
  if (device.integration === def.integrations[0]) return def.iotClass;
  return INTEGRATION_IOT_CLASS[device.integration];
}
