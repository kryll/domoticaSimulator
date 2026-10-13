// Vía Z-Wave real (E2): qué nodo mock de zwave-js se crea para cada dispositivo Z-Wave del
// proyecto, con qué command classes (CC), y cómo se traducen los estados del simulador a valores
// Z-Wave y los comandos de HA (Set) a llamadas a servicio. Lógica pura: la usan la app («Vía
// hacia HA») y el orquestador (emulator/orchestrator/src/zwave), que es quien habla con zwave-js.
import { transportFor, type Device, type DeviceDefinition, type EntityDefinition, type EntityState, type EntityStateValue, type Id, type Project } from '../../types';
import { entitiesForDevice } from '../../devices/entities';
import { allDefinitions } from '../../devices/catalog';
import type { BridgeCommand } from '../mqtt/commands';
import { fnv1a } from '../hash';

/** Command classes que emula el laboratorio (nombres de zwave-js). */
export type ZwaveCcName =
  | 'Binary Switch'
  | 'Multilevel Switch'
  | 'Meter'
  | 'Multilevel Sensor'
  | 'Notification'
  | 'Binary Sensor'
  | 'Door Lock'
  | 'Battery'
  | 'Wake Up';

/** Qué valor Z-Wave representa una entidad del simulador (como mucho uno de cada tipo por nodo). */
export type ZwaveValueKey =
  | 'binarySwitch'
  | 'multilevelSwitch'
  | 'meterW'
  | 'meterKwh'
  | 'temperature'
  | 'humidity'
  | 'illuminance'
  | 'motion'
  | 'door'
  | 'water'
  | 'smoke'
  | 'binarySensor'
  | 'locked'
  | 'battery';

/** Valores de un nodo (los del simulador traducidos a Z-Wave). Multilevel Switch: 0-99. */
export type ZwaveNodeValues = Partial<Record<ZwaveValueKey, number | boolean>>;

export interface ZwaveBinding {
  entityId: string;
  key: string;
  domain: string;
  value: ZwaveValueKey;
}

export interface ZwaveNodePlan {
  deviceId: Id;
  /** Id de nodo Z-Wave (2-232, estable por dispositivo). */
  nodeId: number;
  name: string;
  location?: string;
  /** Alimentado a la red: siempre escucha. A pilas: duerme y despierta con Wake Up. */
  listening: boolean;
  /** Clase de dispositivo Z-Wave (genérica y específica): HA elige la plataforma con ella. */
  genericDeviceClass: number;
  specificDeviceClass: number;
  /** Para persianas: Multilevel Switch como cubierta; para luces, como regulador. */
  multilevelAs?: 'light' | 'cover';
  ccs: ZwaveCcName[];
  bindings: ZwaveBinding[];
}

export interface ZwaveNetworkPlan {
  /** Dispositivo del proyecto que hace de controlador (antena Z-Wave), si lo hay. */
  controllerDeviceId?: Id;
  nodes: ZwaveNodePlan[];
}

export type ZwaveSupport = { ok: true } | { ok: false; reason: string };

/** Comando que llega al nodo mock desde el controlador (es decir, desde HA por Z-Wave JS). */
export type ZwaveCommand =
  | { kind: 'binarySwitch'; value: boolean }
  /** 0-99; 255 = volver al último nivel (encender). */
  | { kind: 'multilevelSwitch'; value: number }
  | { kind: 'doorLock'; locked: boolean };

const NOTIFICATION_BINARY: Record<string, ZwaveValueKey> = {
  motion: 'motion',
  occupancy: 'motion',
  presence: 'motion',
  door: 'door',
  window: 'door',
  opening: 'door',
  garage_door: 'door',
  moisture: 'water',
  smoke: 'smoke',
};

const SENSOR_VALUES: Record<string, ZwaveValueKey> = {
  power: 'meterW',
  energy: 'meterKwh',
  temperature: 'temperature',
  humidity: 'humidity',
  illuminance: 'illuminance',
  battery: 'battery',
};

/** Valor Z-Wave de una entidad, o el motivo por el que no se puede emular. */
function valueFor(e: EntityDefinition): ZwaveValueKey | string {
  switch (e.domain) {
    case 'switch':
      return 'binarySwitch';
    case 'light':
    case 'cover':
      return 'multilevelSwitch';
    case 'lock':
      return 'locked';
    case 'binary_sensor':
      return NOTIFICATION_BINARY[e.deviceClass ?? ''] ?? 'binarySensor';
    case 'sensor': {
      const v = SENSOR_VALUES[e.deviceClass ?? ''] ?? SENSOR_VALUES[e.key];
      return v ?? `el sensor «${e.name}» no tiene CC equivalente en el mock`;
    }
    default:
      return `el dominio ${e.domain} no se emula con el mock de Z-Wave`;
  }
}

const CC_OF: Record<ZwaveValueKey, ZwaveCcName> = {
  binarySwitch: 'Binary Switch',
  multilevelSwitch: 'Multilevel Switch',
  meterW: 'Meter',
  meterKwh: 'Meter',
  temperature: 'Multilevel Sensor',
  humidity: 'Multilevel Sensor',
  illuminance: 'Multilevel Sensor',
  motion: 'Notification',
  door: 'Notification',
  water: 'Notification',
  smoke: 'Notification',
  binarySensor: 'Binary Sensor',
  locked: 'Door Lock',
  battery: 'Battery',
};

/** ¿Va por Z-Wave este dispositivo (protocolo Z-Wave o integración zwave_js)? */
export function isZwaveDevice(device: Pick<Device, 'protocol' | 'integration'>, def: Pick<DeviceDefinition, 'integrations'>): boolean {
  return transportFor(device, def) === 'zwave_js';
}

/** ¿Se puede emular el dispositivo con el mock de zwave-js? Si no, sigue por MQTT con el motivo. */
export function zwaveSupport(device: Device, def: DeviceDefinition): ZwaveSupport {
  if (def.role === 'coordinator') return { ok: true };
  const entities = entitiesForDevice(device, def);
  if (entities.length === 0) return { ok: false, reason: 'no tiene entidades que emular' };
  const used = new Set<ZwaveValueKey>();
  for (const e of entities) {
    const v = valueFor(e.definition);
    if (!(v in CC_OF)) return { ok: false, reason: v };
    const key = v as ZwaveValueKey;
    if (used.has(key)) return { ok: false, reason: `dos entidades necesitan el mismo valor Z-Wave (${CC_OF[key]}); harían falta endpoints` };
    if ((key === 'binarySwitch' && used.has('multilevelSwitch')) || (key === 'multilevelSwitch' && used.has('binarySwitch'))) {
      return { ok: false, reason: 'un interruptor y un regulador en el mismo nodo necesitarían endpoints' };
    }
    used.add(key);
  }
  return { ok: true };
}

/**
 * Home ID del controlador mock: fijo para todo el laboratorio (la entrada zwave_js de HA va ligada a
 * él; si cambiara con cada proyecto, HA lo vería como otra red).
 */
export const LAB_HOME_ID = 0xe2c0de01;

export const MIN_NODE_ID = 2;
export const MAX_NODE_ID = 232;

/**
 * Ids de nodo estables: cada dispositivo prueba primero el hueco de su hash y, si está ocupado,
 * el siguiente (en el orden de los ids). Añadir un dispositivo no mueve a los demás salvo colisión.
 */
export function allocateNodeIds(deviceIds: readonly Id[]): Map<Id, number> {
  const span = MAX_NODE_ID - MIN_NODE_ID + 1;
  const used = new Set<number>();
  const out = new Map<Id, number>();
  for (const id of [...deviceIds].sort()) {
    if (out.size >= span) break;
    let n = fnv1a(`node:${id}`) % span;
    while (used.has(MIN_NODE_ID + n)) n = (n + 1) % span;
    used.add(MIN_NODE_ID + n);
    out.set(id, MIN_NODE_ID + n);
  }
  return out;
}

function deviceClassOf(values: ReadonlySet<ZwaveValueKey>, multilevelAs: 'light' | 'cover' | undefined): [number, number] {
  if (values.has('locked')) return [0x40, 0x03]; // Entry Control · Secure Keypad Door Lock
  if (values.has('multilevelSwitch')) return multilevelAs === 'cover' ? [0x11, 0x06] : [0x11, 0x01]; // Motor Control Class B · Multilevel Power Switch
  if (values.has('binarySwitch')) return [0x10, 0x01]; // Binary Switch · Binary Power Switch
  if (['motion', 'door', 'water', 'smoke'].some((k) => values.has(k as ZwaveValueKey))) return [0x07, 0x01]; // Notification Sensor
  if (values.has('binarySensor')) return [0x20, 0x01]; // Binary Sensor · Routing Binary Sensor
  return [0x21, 0x01]; // Multilevel Sensor · Routing Multilevel Sensor
}

const CC_ORDER: ZwaveCcName[] = ['Binary Switch', 'Multilevel Switch', 'Door Lock', 'Meter', 'Multilevel Sensor', 'Notification', 'Binary Sensor', 'Battery', 'Wake Up'];

/** Plan de un nodo (el dispositivo debe ser compatible: ver zwaveSupport). */
export function zwaveNodePlan(device: Device, def: DeviceDefinition, nodeId: number, location?: string): ZwaveNodePlan {
  const bindings: ZwaveBinding[] = [];
  let multilevelAs: 'light' | 'cover' | undefined;
  for (const e of entitiesForDevice(device, def)) {
    const v = valueFor(e.definition);
    if (!(v in CC_OF)) continue;
    const value = v as ZwaveValueKey;
    if (bindings.some((b) => b.value === value)) continue;
    if (value === 'multilevelSwitch') multilevelAs = e.definition.domain === 'cover' ? 'cover' : 'light';
    bindings.push({ entityId: e.entityId, key: e.definition.key, domain: e.definition.domain, value });
  }
  const listening = def.power !== 'battery';
  const values = new Set(bindings.map((b) => b.value));
  const ccs = new Set<ZwaveCcName>(bindings.map((b) => CC_OF[b.value]));
  if (!listening) {
    ccs.add('Battery');
    ccs.add('Wake Up');
  }
  const [genericDeviceClass, specificDeviceClass] = deviceClassOf(values, multilevelAs);
  return {
    deviceId: device.id,
    nodeId,
    name: device.name,
    ...(location !== undefined ? { location } : {}),
    listening,
    genericDeviceClass,
    specificDeviceClass,
    ...(multilevelAs ? { multilevelAs } : {}),
    ccs: CC_ORDER.filter((c) => ccs.has(c)),
    bindings,
  };
}

/** Red Z-Wave del proyecto: controlador y un nodo mock por cada dispositivo Z-Wave compatible. */
export function buildZwavePlan(project: Project, baseDefs: DeviceDefinition[]): ZwaveNetworkPlan {
  const defs = allDefinitions(project, baseDefs);
  const rooms = new Map(project.rooms.map((r) => [r.id, r.name]));
  const candidates: Array<{ device: Device; def: DeviceDefinition }> = [];
  let controllerDeviceId: Id | undefined;
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def || def.role === 'ha_server' || !isZwaveDevice(device, def)) continue;
    if (def.role === 'coordinator') {
      controllerDeviceId ??= device.id;
      continue;
    }
    if (zwaveSupport(device, def).ok) candidates.push({ device, def });
  }
  const ids = allocateNodeIds(candidates.map((c) => c.device.id));
  const nodes = candidates
    .filter((c) => ids.has(c.device.id))
    .map((c) => zwaveNodePlan(c.device, c.def, ids.get(c.device.id) ?? MIN_NODE_ID, c.device.roomId ? rooms.get(c.device.roomId) : undefined))
    .sort((a, b) => a.nodeId - b.nodeId);
  return { ...(controllerDeviceId ? { controllerDeviceId } : {}), nodes };
}

const num = (v: EntityStateValue | undefined): number | undefined => {
  if (v === undefined || typeof v === 'boolean' || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const UNKNOWN = new Set(['unavailable', 'unknown']);

/** Brillo 0-255 → nivel Z-Wave 1-99 (0 solo si está apagada). */
export function brightnessToLevel(brightness: number): number {
  return Math.max(1, Math.min(99, Math.round((Math.max(0, Math.min(255, brightness)) * 99) / 255)));
}

export function levelToBrightness(level: number): number {
  return Math.max(1, Math.min(255, Math.round((Math.max(0, Math.min(99, level)) * 255) / 99)));
}

/** Posición 0-100 → nivel 0-99 (100 = 99, abierta del todo). */
export function positionToLevel(position: number): number {
  return Math.max(0, Math.min(99, Math.round((Math.max(0, Math.min(100, position)) * 99) / 100)));
}

export function levelToPosition(level: number): number {
  return level >= 99 ? 100 : Math.max(0, Math.round((Math.max(0, level) * 100) / 99));
}

/** Valor Z-Wave de una entidad a partir de su estado en el simulador (undefined: no se publica). */
export function zwaveValueOf(node: Pick<ZwaveNodePlan, 'multilevelAs'>, binding: ZwaveBinding, st: EntityState | undefined): number | boolean | undefined {
  if (!st || UNKNOWN.has(String(st.state))) return undefined;
  const on = st.state === 'on' || st.state === true;
  const attrs = st.attributes ?? {};
  switch (binding.value) {
    case 'binarySwitch':
    case 'motion':
    case 'door':
    case 'water':
    case 'smoke':
    case 'binarySensor':
      return on;
    case 'multilevelSwitch': {
      if (node.multilevelAs === 'cover') {
        const pos = num(attrs.current_position);
        if (pos !== undefined) return positionToLevel(pos);
        return st.state === 'open' || st.state === 'opening' ? 99 : 0;
      }
      if (!on) return 0;
      const b = num(attrs.brightness);
      return b === undefined ? 99 : brightnessToLevel(b);
    }
    case 'locked':
      if (st.state === 'locked' || st.state === 'locking') return true;
      if (st.state === 'unlocked' || st.state === 'unlocking' || st.state === 'open' || st.state === 'opening') return false;
      return undefined;
    default:
      return num(st.state);
  }
}

/** Todos los valores de un nodo a partir de los estados del simulador. */
export function zwaveNodeValues(node: ZwaveNodePlan, entities: Readonly<Record<string, EntityState>>): ZwaveNodeValues {
  const out: ZwaveNodeValues = {};
  for (const b of node.bindings) {
    const v = zwaveValueOf(node, b, entities[b.entityId]);
    if (v !== undefined) out[b.value] = v;
  }
  return out;
}

const cmd = (entityId: string, service: string, data: BridgeCommand['data'] = {}): BridgeCommand => ({ entityId, service, data });

/** Comando Z-Wave recibido por un nodo mock → llamada a servicio del simulador. */
export function zwaveCommandToService(node: ZwaveNodePlan, command: ZwaveCommand): BridgeCommand | null {
  switch (command.kind) {
    case 'binarySwitch': {
      const b = node.bindings.find((x) => x.value === 'binarySwitch');
      return b ? cmd(b.entityId, `${b.domain}.${command.value ? 'turn_on' : 'turn_off'}`) : null;
    }
    case 'multilevelSwitch': {
      const b = node.bindings.find((x) => x.value === 'multilevelSwitch');
      if (!b) return null;
      if (node.multilevelAs === 'cover') {
        if (command.value === 255) return cmd(b.entityId, 'cover.open_cover');
        return cmd(b.entityId, 'cover.set_cover_position', { position: levelToPosition(command.value) });
      }
      if (command.value === 0) return cmd(b.entityId, 'light.turn_off');
      if (command.value === 255) return cmd(b.entityId, 'light.turn_on');
      return cmd(b.entityId, 'light.turn_on', { brightness: levelToBrightness(command.value) });
    }
    case 'doorLock': {
      const b = node.bindings.find((x) => x.value === 'locked');
      return b ? cmd(b.entityId, command.locked ? 'lock.lock' : 'lock.unlock') : null;
    }
    default:
      return null;
  }
}

/** Resumen de un valor para el inspector de tráfico («Binary Switch · currentValue = true»). */
export function describeZwaveValue(key: ZwaveValueKey, value: number | boolean): string {
  return `${CC_OF[key]} · ${key} = ${String(value)}`;
}

export function ccOfValue(key: ZwaveValueKey): ZwaveCcName {
  return CC_OF[key];
}
