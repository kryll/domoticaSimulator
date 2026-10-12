import type { Device, DeviceDefinition, Id, Integration, IotClass, Point, Project, Protocol } from '../types';
import { catalog } from './catalog';
import { slugify } from './entities';
import { INTEGRATION_IOT_CLASS } from './labels';
import {
  isBleProxy,
  isRfBridge,
  isThreadBorderRouter,
  isZigbeeCoordinator,
  isZwaveController,
  ZIGBEE_COORDINATOR_INTEGRATIONS,
} from './roles';

export interface CreateDeviceOptions {
  floorId: Id;
  position: Point;
  name?: string;
  roomId?: Id;
}

export interface DefaultIntegration {
  protocol: Protocol;
  integration: Integration;
}

function projectDefs(project: Pick<Project, 'devices'>, defs: DeviceDefinition[]): { device: Device; def: DeviceDefinition }[] {
  const result: { device: Device; def: DeviceDefinition }[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def) result.push({ device, def });
  }
  return result;
}

function iotClassOf(def: DeviceDefinition, integration: Integration): IotClass {
  return integration === def.integrations[0] ? def.iotClass : INTEGRATION_IOT_CLASS[integration];
}

const isCloudClass = (iot: IotClass): boolean => iot === 'cloud_push' || iot === 'cloud_polling';

/**
 * Integración y protocolo por defecto de un dispositivo nuevo según el proyecto (B5):
 * 1. el hub propietario de su marca si ya está en el proyecto (Hue Bridge, Aqara, DIRIGERA);
 * 2. ZHA o Zigbee2MQTT (la que más se use ya) si hay coordinador Zigbee;
 * 3. Z-Wave JS si hay controlador Z-Wave;
 * 4. entre las demás, local antes que nube (push antes que sondeo), respetando el orden del catálogo.
 * Las integraciones que necesitan infraestructura ausente solo se eligen si no hay alternativa.
 */
export function defaultIntegration(def: DeviceDefinition, project: Pick<Project, 'devices'>, defs: DeviceDefinition[]): DefaultIntegration {
  const fallbackProtocol = def.protocols[0];
  const fallbackIntegration = def.integrations[0];
  if (fallbackProtocol === undefined || fallbackIntegration === undefined) {
    throw new Error(`La definición "${def.id}" no tiene protocolos o integraciones`);
  }
  const present = projectDefs(project, defs);
  const has = (pred: (d: DeviceDefinition) => boolean): boolean => present.some((p) => pred(p.def));
  const hasCoordinator = has(isZigbeeCoordinator);
  const hub = def.requiresHub ? present.find((p) => p.def.role === 'hub' && p.def.brand === def.requiresHub)?.def : undefined;
  const zigbee = def.protocols.includes('zigbee');

  // 1. Hub propietario de la marca: su integración (la que comparten hub y dispositivo).
  if (hub && zigbee) {
    const viaHub = def.integrations.find((i) => !ZIGBEE_COORDINATOR_INTEGRATIONS.includes(i) && hub.integrations.includes(i));
    if (viaHub) return { protocol: 'zigbee', integration: viaHub };
  }
  // 2. Coordinador Zigbee: ZHA o Zigbee2MQTT, la más usada en el proyecto.
  const coordinatorOptions = def.integrations.filter((i) => ZIGBEE_COORDINATOR_INTEGRATIONS.includes(i));
  if (zigbee && hasCoordinator && coordinatorOptions.length > 0) {
    const uses = (i: Integration): number => present.filter((p) => p.def.role !== 'coordinator' && p.device.integration === i).length;
    const best = [...coordinatorOptions].sort((a, b) => uses(b) - uses(a))[0] ?? fallbackIntegration;
    return { protocol: 'zigbee', integration: best };
  }
  // 3. Z-Wave.
  if (def.integrations.includes('zwave_js') && def.protocols.includes('zwave') && has(isZwaveController)) {
    return { protocol: 'zwave', integration: 'zwave_js' };
  }
  // 4. Resto: integraciones que no dependen de un coordinador/hub ausente; local antes que nube.
  const needsMissing = (i: Integration): boolean => {
    if (ZIGBEE_COORDINATOR_INTEGRATIONS.includes(i)) return !hasCoordinator;
    if (i === 'zwave_js') return !has(isZwaveController);
    // integración del hub propietario sobre Zigbee
    return Boolean(def.requiresHub) && zigbee && !hub;
  };
  const rank = (i: Integration): number => {
    const iot = iotClassOf(def, i);
    return (needsMissing(i) ? 4 : 0) + (isCloudClass(iot) ? 2 : 0) + (iot.endsWith('polling') ? 1 : 0);
  };
  const integration = [...def.integrations].sort((a, b) => rank(a) - rank(b))[0] ?? fallbackIntegration;
  return { protocol: protocolFor(def, integration, present.map((p) => p.def)), integration };
}

/** Protocolo para una integración: el radio que exige, o el primero con infraestructura disponible. */
function protocolFor(def: DeviceDefinition, integration: Integration, present: DeviceDefinition[]): Protocol {
  const first = def.protocols[0] ?? 'wifi';
  if (ZIGBEE_COORDINATOR_INTEGRATIONS.includes(integration) && def.protocols.includes('zigbee')) return 'zigbee';
  if (integration === 'zwave_js' && def.protocols.includes('zwave')) return 'zwave';
  if (def.requiresHub && def.protocols.includes('zigbee')) return 'zigbee';
  const available = (p: Protocol): boolean => {
    switch (p) {
      case 'thread':
        return present.some(isThreadBorderRouter);
      case 'wifi':
      case 'matter':
        return present.some((d) => d.role === 'access_point');
      case 'ethernet':
        return present.some((d) => d.role === 'access_point' || d.role === 'ha_server');
      case 'ble':
        return present.some(isBleProxy);
      case 'rf433':
        return present.some(isRfBridge);
      case 'zigbee':
        return present.some(isZigbeeCoordinator);
      case 'zwave':
        return present.some(isZwaveController);
    }
  };
  return def.protocols.find(available) ?? first;
}

/**
 * Crea un dispositivo a partir de una definición. Con `project` (y `defs`), protocolo e
 * integración salen de defaultIntegration; sin él, los primeros del catálogo.
 */
export function createDevice(
  def: DeviceDefinition,
  opts: CreateDeviceOptions,
  project?: Pick<Project, 'devices'>,
  defs: DeviceDefinition[] = catalog,
): Device {
  const chosen = project ? defaultIntegration(def, project, defs) : undefined;
  const protocol = chosen?.protocol ?? def.protocols[0];
  const integration = chosen?.integration ?? def.integrations[0];
  if (protocol === undefined || integration === undefined) {
    throw new Error(`La definición "${def.id}" no tiene protocolos o integraciones`);
  }
  const device: Device = {
    id: crypto.randomUUID(),
    definitionId: def.id,
    name: opts.name ?? def.name,
    floorId: opts.floorId,
    position: { ...opts.position },
    protocol,
    integration,
  };
  if (opts.roomId !== undefined) device.roomId = opts.roomId;
  return device;
}

/**
 * Devuelve un nombre no usado: "base", "base 2", "base 3"...
 * Compara por slug para que no colisionen los entity_id.
 */
export function uniqueDeviceName(base: string, existing: readonly (string | { name: string })[]): string {
  const taken = new Set(existing.map((e) => slugify(typeof e === 'string' ? e : e.name)));
  if (!taken.has(slugify(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(slugify(candidate))) return candidate;
  }
}
