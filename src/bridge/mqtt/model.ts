// Modelo del puente: qué se publica de cada dispositivo del proyecto y por qué topics.
// Lógica pura (sin React ni MQTT): la usan la app y el orquestador (emulator/). Solo importa
// tipos y módulos ligeros; del catálogo, solo allDefinitions (para los dispositivos personalizados).
import {
  effectiveTransport,
  PENDING_TRANSPORTS,
  transportFor,
  type Device,
  type DeviceDefinition,
  type DeviceTransport,
  type EntityCapabilities,
  type EntityDefinition,
  type HaBridgeSettings,
  type Id,
  type NetworkRole,
  type Project,
} from '../../types';
import { entitiesForDevice } from '../../devices/entities';
import { allDefinitions } from '../../devices/catalog';
import { bridgeSettings } from '../schema';
import { radioProfileFor } from '../radio';
import { fnv1a } from '../hash';

/** Perfil MQTT con el que se publica un dispositivo. */
export type MqttProfile = 'z2m' | 'generic';

export interface MqttMessage {
  topic: string;
  /** Texto del mensaje ('' borra un retenido). */
  payload: string;
  retain: boolean;
}

export interface BridgeEntity {
  /** entity_id en el simulador (y el que se pide a HA con default_entity_id). */
  entityId: string;
  key: string;
  domain: string;
  definition: EntityDefinition;
  /** Capacidades con los valores por defecto del dominio. */
  caps: EntityCapabilities;
  /** Nombre de la entidad en HA (null: la entidad lleva el nombre del dispositivo). */
  name: string | null;
  /** unique_id estable: hasim_<proyecto>_<dispositivo>_<clave> (Z2M: <ieee>_<objeto>_zigbee2mqtt). */
  uniqueId: string;
  /** Perfil genérico: topic de estado (JSON) y prefijo de los topics de comando. */
  stateTopic: string;
  commandTopic: string;
  /** Perfil Z2M: propiedad del JSON del dispositivo y object_id del discovery. */
  property: string;
  objectId: string;
}

export interface BridgeDevice {
  device: Device;
  def: DeviceDefinition;
  /** Vía ideal hacia HA y la que se usa en esta tanda. */
  transport: DeviceTransport;
  profile: MqttProfile;
  /** Tanda en la que llegará la vía ideal (los transportes pendientes van por MQTT genérico). */
  pending?: 'E2' | 'E3';
  /** Identificador del dispositivo en HA (perfil genérico) y node_id del discovery. */
  nodeId: string;
  /** Perfil Z2M: dirección IEEE estable y nombre (topic) del dispositivo. */
  ieee: string;
  friendlyName: string;
  areaName?: string;
  /** Perfil genérico: dispositivo simulado (hub, coordinador...) por el que llega a HA. */
  viaDeviceId?: Id;
  /** Equipo de infraestructura sin entidades: se publica con una entidad de conectividad. */
  infra: boolean;
  entities: BridgeEntity[];
  availabilityTopic: string;
}

export interface BridgeModel {
  settings: HaBridgeSettings;
  projectId: Id;
  devices: BridgeDevice[];
  /** Coordinador del Z2M emulado (si el proyecto no tiene, uno virtual). */
  coordinator: { ieee: string; deviceId?: Id };
  /** Disponibilidad global del perfil genérico (LWT del orquestador). */
  bridgeStateTopic: string;
  z2mBridgeStateTopic: string;
  /** Canal Zigbee del perfil de radio del proyecto (lo publica el Z2M emulado en bridge/info). */
  zigbeeChannel: number;
}

/** Valores por defecto de las capacidades (los mismos que src/devices/capabilities.ts). */
const LIGHT_DEFAULTS: EntityCapabilities = { colorModes: ['brightness'], minKelvin: 2000, maxKelvin: 6500 };
const CLIMATE_DEFAULTS: EntityCapabilities = { hvacModes: ['off', 'heat'], minTemp: 7, maxTemp: 35, tempStep: 0.5 };

export function capsWithDefaults(domain: string, caps: EntityCapabilities = {}): EntityCapabilities {
  if (domain === 'light') return { ...LIGHT_DEFAULTS, ...caps };
  if (domain === 'climate') return { ...CLIMATE_DEFAULTS, ...caps };
  return { ...caps };
}

/** Solo [A-Za-z0-9_-] (node_id del discovery y partes de topics). */
export function sanitizeId(text: string): string {
  const clean = text.replace(/[^A-Za-z0-9_-]+/g, '_');
  return clean === '' ? '_' : clean;
}

/** Nombre apto para un topic: sin comodines (+ #) ni barras. */
export function topicName(text: string): string {
  const clean = text.replace(/[+#/]+/g, '_').trim();
  return clean === '' ? 'dispositivo' : clean;
}

/** Hash corto y estable de un texto (8 caracteres hex). */
export function shortHash(text: string): string {
  return fnv1a(text, 0x811c9dc5).toString(16).padStart(8, '0');
}

/** Dirección IEEE estable («0x» + 16 hex) derivada de un id. */
export function ieeeAddress(seed: string): string {
  const hi = fnv1a(seed, 0x811c9dc5).toString(16).padStart(8, '0');
  const lo = fnv1a(`${seed}#ieee`, 0x050c5d1f).toString(16).padStart(8, '0');
  return `0x${hi}${lo}`;
}

export function nodeIdFor(projectId: Id, deviceId: Id): string {
  return sanitizeId(`hasim_${projectId}_${deviceId}`);
}

export function uniqueIdFor(projectId: Id, deviceId: Id, key: string): string {
  return sanitizeId(`hasim_${projectId}_${deviceId}_${key}`);
}

/** Identificador en HA del bridge del Z2M emulado (como Zigbee2MQTT). */
export function z2mBridgeIdentifier(coordinatorIeee: string): string {
  return `zigbee2mqtt_bridge_${coordinatorIeee}`;
}

export function z2mDeviceIdentifier(ieee: string): string {
  return `zigbee2mqtt_${ieee}`;
}

const INFRA_ROLES: readonly NetworkRole[] = ['hub', 'coordinator', 'border_router', 'access_point'];
const VIA_ROLES: readonly NetworkRole[] = ['hub', 'coordinator', 'border_router'];

/** Propiedad Zigbee2MQTT de un sensor binario según su device_class. */
const Z2M_BINARY: Record<string, string> = {
  door: 'contact',
  window: 'contact',
  opening: 'contact',
  garage_door: 'contact',
  motion: 'occupancy',
  occupancy: 'presence',
  presence: 'presence',
  moisture: 'water_leak',
  smoke: 'smoke',
  carbon_monoxide: 'carbon_monoxide',
  vibration: 'vibration',
  tamper: 'tamper',
};

/** Propiedad Zigbee2MQTT de un sensor según su clave en el catálogo. */
const Z2M_SENSOR: Record<string, string> = { noise: 'noise', co2: 'co2' };

/** Propiedad base de una entidad en el JSON del dispositivo Z2M. */
function z2mBaseProperty(e: EntityDefinition): string {
  switch (e.domain) {
    case 'light':
    case 'switch':
    case 'lock':
    case 'cover':
    case 'fan':
      return 'state';
    case 'climate':
      return 'system_mode';
    case 'binary_sensor':
      return Z2M_BINARY[e.deviceClass ?? ''] ?? e.key;
    case 'sensor':
      return Z2M_SENSOR[e.key] ?? e.key;
    default:
      return e.key;
  }
}

/** object_id del discovery de Z2M para una entidad (light, switch_l1, temperature...). */
function z2mObjectId(e: EntityDefinition, property: string): string {
  if (e.domain === 'light' || e.domain === 'cover' || e.domain === 'climate' || e.domain === 'lock' || e.domain === 'fan') {
    return property === 'state' || property === 'system_mode' ? e.domain : `${e.domain}_${property.replace(/^state_/, '')}`;
  }
  if (e.domain === 'switch') return property === 'state' ? 'switch' : `switch_${property.replace(/^state_/, '')}`;
  return sanitizeId(property);
}

/**
 * Propiedades Z2M de las entidades de un dispositivo: si varias comparten la de estado
 * (relés de dos canales), se numeran como en Z2M (state_l1, state_l2).
 */
function z2mProperties(entities: EntityDefinition[]): string[] {
  const base = entities.map(z2mBaseProperty);
  const count = new Map<string, number>();
  for (const p of base) count.set(p, (count.get(p) ?? 0) + 1);
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return base.map((p, i) => {
    let prop = p;
    if ((count.get(p) ?? 0) > 1) {
      const n = (seen.get(p) ?? 0) + 1;
      seen.set(p, n);
      prop = `${p}_l${n}`;
    }
    if (used.has(prop)) prop = `${prop}_${entities[i]?.key ?? i}`;
    used.add(prop);
    return prop;
  });
}

function neighbourIds(project: Pick<Project, 'connections'>, deviceId: Id): Id[] {
  const ids: Id[] = [];
  for (const c of project.connections) {
    if (c.sourceId === deviceId) ids.push(c.targetId);
    else if (c.targetId === deviceId) ids.push(c.sourceId);
  }
  return ids;
}

/**
 * Hub simulado por el que llega el dispositivo a HA (via_device del perfil genérico): un
 * vecino conectado que sea hub, coordinador o border router (el de la marca que requiere
 * primero) o, si no hay conexión dibujada, el hub de la marca que exige el catálogo.
 */
export function viaHubOf(project: Pick<Project, 'devices' | 'connections'>, defs: DeviceDefinition[], device: Device, def: DeviceDefinition): Id | undefined {
  if (VIA_ROLES.includes(def.role) || def.role === 'ha_server' || def.role === 'access_point') return undefined;
  const defOf = (d: Device): DeviceDefinition | undefined => defs.find((x) => x.id === d.definitionId);
  const byId = new Map(project.devices.map((d) => [d.id, d]));
  const candidates = neighbourIds(project, device.id)
    .map((id) => byId.get(id))
    .filter((d): d is Device => d !== undefined)
    .filter((d) => {
      const role = defOf(d)?.role;
      return role !== undefined && VIA_ROLES.includes(role);
    });
  const sameBrand = def.requiresHub ? candidates.find((d) => defOf(d)?.brand === def.requiresHub) : undefined;
  const picked = sameBrand ?? candidates[0];
  if (picked) return picked.id;
  if (def.requiresHub) {
    return project.devices.find((d) => {
      const other = defOf(d);
      return other?.role === 'hub' && other.brand === def.requiresHub;
    })?.id;
  }
  return undefined;
}

/** ¿Es el coordinador del Z2M emulado (no se publica como dispositivo, es el bridge)? */
function isZ2mCoordinator(device: Device, def: DeviceDefinition): boolean {
  return def.role === 'coordinator' && device.protocol === 'zigbee' && transportFor(device, def) === 'z2m_mqtt';
}

/**
 * Construye el modelo del puente MQTT para el proyecto. `exclude`: dispositivos que llegan a HA
 * por una vía real (Z-Wave JS, ESPHome) y no se publican por MQTT.
 */
export function buildBridgeModel(project: Project, baseDefs: DeviceDefinition[], settings: HaBridgeSettings = bridgeSettings(project), exclude: ReadonlySet<Id> = new Set()): BridgeModel {
  // Catálogo + definiciones personalizadas del proyecto: los personalizados también llegan al lab.
  const defs = allDefinitions(project, baseDefs);
  const coordinatorDevice = project.devices.find((d) => {
    const def = defs.find((x) => x.id === d.definitionId);
    return def !== undefined && isZ2mCoordinator(d, def);
  });
  const coordinator = coordinatorDevice
    ? { ieee: ieeeAddress(`${project.id}:${coordinatorDevice.id}`), deviceId: coordinatorDevice.id }
    : { ieee: ieeeAddress(`${project.id}:coordinador-virtual`) };
  const roomNames = new Map(project.rooms.map((r) => [r.id, r.name]));
  const usedFriendly = new Set<string>(['bridge']);
  const devices: BridgeDevice[] = [];
  for (const device of project.devices) {
    const def = defs.find((x) => x.id === device.definitionId);
    if (!def || def.role === 'ha_server' || isZ2mCoordinator(device, def) || exclude.has(device.id)) continue;
    const entityList = entitiesForDevice(device, def);
    const infra = entityList.length === 0;
    if (infra && !INFRA_ROLES.includes(def.role)) continue;
    const transport = transportFor(device, def);
    const profile: MqttProfile = effectiveTransport(transport) === 'z2m_mqtt' ? 'z2m' : 'generic';
    const nodeId = nodeIdFor(project.id, device.id);
    const ieee = ieeeAddress(`${project.id}:${device.id}`);
    let friendlyName = topicName(device.name);
    for (let n = 2; usedFriendly.has(friendlyName.toLowerCase()); n++) friendlyName = `${topicName(device.name)}_${n}`;
    usedFriendly.add(friendlyName.toLowerCase());
    const devTopic = `${settings.baseTopic}/${sanitizeId(device.id)}`;
    const props = z2mProperties(entityList.map((e) => e.definition));
    const entities: BridgeEntity[] = entityList.map((e, i) => {
      const property = props[i] ?? e.definition.key;
      const objectId = z2mObjectId(e.definition, property);
      const name = e.friendlyName === device.name ? null : e.definition.name;
      return {
        entityId: e.entityId,
        key: e.definition.key,
        domain: e.definition.domain,
        definition: e.definition,
        caps: capsWithDefaults(e.definition.domain, e.definition.capabilities),
        name,
        uniqueId: profile === 'z2m' ? `${ieee}_${objectId}_zigbee2mqtt` : uniqueIdFor(project.id, device.id, e.definition.key),
        stateTopic: `${devTopic}/${sanitizeId(e.definition.key)}`,
        commandTopic: `${devTopic}/${sanitizeId(e.definition.key)}`,
        property,
        objectId,
      };
    });
    const pending = PENDING_TRANSPORTS[transport];
    const roomName = device.roomId ? roomNames.get(device.roomId) : undefined;
    const hub = profile === 'generic' ? viaHubOf(project, defs, device, def) : undefined;
    // Un hub que va por una vía real no está en MQTT: no se puede colgar de él.
    const viaDeviceId = hub !== undefined && !exclude.has(hub) ? hub : undefined;
    devices.push({
      device,
      def,
      transport,
      profile,
      ...(pending ? { pending } : {}),
      nodeId,
      ieee,
      friendlyName,
      ...(roomName !== undefined ? { areaName: roomName } : {}),
      ...(viaDeviceId !== undefined ? { viaDeviceId } : {}),
      infra,
      entities,
      availabilityTopic: profile === 'z2m' ? `${settings.z2mBaseTopic}/${friendlyName}/availability` : `${devTopic}/availability`,
    });
  }
  return {
    settings,
    projectId: project.id,
    devices,
    coordinator,
    bridgeStateTopic: `${settings.baseTopic}/bridge/state`,
    zigbeeChannel: radioProfileFor(project, 'zigbee').channel ?? 11,
    z2mBridgeStateTopic: `${settings.z2mBaseTopic}/bridge/state`,
  };
}
