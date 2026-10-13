// Vía Matter real (E3): los dispositivos Matter y Thread del proyecto son endpoints de un bridge
// Matter hecho con matter.js (un AggregatorEndpoint con un endpoint «bridged» por dispositivo) que
// se comisiona en el servidor Matter de HA (matterjs-server) y llega a HA por su integración
// `matter`. Aquí se decide qué tipo de dispositivo Matter es cada uno, qué clusters lleva, cómo se
// traducen los estados del simulador a atributos Matter y los comandos de HA a servicios del
// simulador. Lógica pura: la usan la app («Vía hacia HA») y el orquestador
// (emulator/orchestrator/src/matter).
import { transportFor, type Device, type DeviceDefinition, type EntityDefinition, type EntityState, type EntityStateValue, type Id, type Project } from '../../types';
import { entitiesForDevice } from '../../devices/entities';
import { allDefinitions } from '../../devices/catalog';
import type { BridgeCommand } from '../mqtt/commands';
import { fnv1a } from '../hash';
import { kelvinToMired, miredToKelvin, parseRgbText, rgbToXy, xyToRgb, type Rgb } from '../mqtt/color';

/** Tipo de dispositivo Matter del endpoint principal (device types de la especificación). */
export type MatterDeviceKind =
  | 'on_off_light'
  | 'dimmable_light'
  | 'color_temperature_light'
  | 'extended_color_light'
  | 'on_off_plug'
  | 'contact_sensor'
  | 'occupancy_sensor'
  | 'water_leak_detector'
  | 'temperature_sensor'
  | 'humidity_sensor'
  | 'light_sensor'
  | 'pressure_sensor'
  | 'door_lock'
  | 'window_covering';

/** Clusters de aplicación que puede llevar el endpoint de un dispositivo (ids de behavior de matter.js). */
export type MatterCluster =
  | 'onOff'
  | 'levelControl'
  | 'colorControl'
  | 'booleanState'
  | 'occupancySensing'
  | 'temperatureMeasurement'
  | 'relativeHumidityMeasurement'
  | 'illuminanceMeasurement'
  | 'pressureMeasurement'
  | 'powerSource'
  | 'electricalPowerMeasurement'
  | 'electricalEnergyMeasurement'
  | 'doorLock'
  | 'windowCovering';

/** Id de cada cluster en la especificación (HA los usa en el unique_id de sus entidades). */
export const MATTER_CLUSTER_IDS: Readonly<Record<MatterCluster, number>> = {
  onOff: 0x0006,
  levelControl: 0x0008,
  colorControl: 0x0300,
  booleanState: 0x0045,
  occupancySensing: 0x0406,
  temperatureMeasurement: 0x0402,
  relativeHumidityMeasurement: 0x0405,
  illuminanceMeasurement: 0x0400,
  pressureMeasurement: 0x0403,
  powerSource: 0x002f,
  electricalPowerMeasurement: 0x0090,
  electricalEnergyMeasurement: 0x0091,
  doorLock: 0x0101,
  windowCovering: 0x0102,
};

/** Rango de LevelControl para luces (Matter: 1-254). */
export const MATTER_LEVEL_MIN = 1;
export const MATTER_LEVEL_MAX = 254;

export interface MatterEntityPlan {
  /** entity_id del simulador al que representa (y el que se pide en HA tras alinear). */
  entityId: string;
  /** Cluster que lleva su valor. */
  cluster: MatterCluster;
  /** Atributo principal con el que HA forma el unique_id (cluster/atributo). */
  attributeId: number;
  /** Dominio de la entidad que crea la integración matter de HA. */
  haDomain: 'light' | 'switch' | 'sensor' | 'binary_sensor' | 'lock' | 'cover';
}

export interface MatterLightPlan {
  brightness: boolean;
  colorTemp: boolean;
  color: boolean;
  /** Rango de temperatura de color en mireds (mín = más frío). */
  minMireds: number;
  maxMireds: number;
}

export interface MatterDevicePlan {
  deviceId: Id;
  /** Id del endpoint en matter.js: estable por proyecto y dispositivo (matter.js guarda su número). */
  endpointId: string;
  /** UniqueID de BridgedDeviceBasicInformation (como mucho 32 caracteres). */
  uniqueId: string;
  /** NodeLabel: el nombre que ve HA (como mucho 32 caracteres). */
  name: string;
  area?: string;
  vendorName: string;
  productName: string;
  serialNumber: string;
  kind: MatterDeviceKind;
  clusters: MatterCluster[];
  entities: MatterEntityPlan[];
  light?: MatterLightPlan;
}

export type MatterSupport = { ok: true; kind: MatterDeviceKind } | { ok: false; reason: string };

/** Estado de un endpoint en unidades del simulador ya convertidas a Matter. */
export interface MatterState {
  /** BridgedDeviceBasicInformation.Reachable: false = HA lo muestra no disponible. */
  reachable: boolean;
  onOff?: boolean;
  /** LevelControl.CurrentLevel (1-254); null = desconocido. */
  level?: number | null;
  color?: MatterColorState;
  /** BooleanState.StateValue (contacto: true = cerrado; fuga: true = agua). */
  stateValue?: boolean;
  occupied?: boolean;
  /** MeasuredValue en las unidades de cada cluster; null = sin dato. */
  temperature?: number | null;
  humidity?: number | null;
  illuminance?: number | null;
  pressure?: number | null;
  /** PowerSource.BatPercentRemaining (0-200, medios por ciento). */
  battery?: number | null;
  /** ElectricalPowerMeasurement.ActivePower en mW. */
  activePowerMw?: number | null;
  /** ElectricalEnergyMeasurement.CumulativeEnergyImported en mWh. */
  energyMwh?: number | null;
  /** DoorLock.LockState: 0 sin cerrar del todo (atascada), 1 cerrada, 2 abierta. */
  lockState?: 0 | 1 | 2 | null;
  /** WindowCovering: posición en centésimas de % cerrada (0 = abierta del todo) y movimiento. */
  cover?: { closed100ths: number | null; moving: 'opening' | 'closing' | 'stopped' };
}

export interface MatterColorState {
  /** ColorMode: 0 tono y saturación, 1 CIE xy, 2 temperatura de color. */
  mode: 0 | 1 | 2;
  hue?: number;
  saturation?: number;
  x?: number;
  y?: number;
  mireds?: number;
}

/** Comando de HA que llega a un endpoint por Matter (ya decodificado por matter.js). */
export type MatterCommand =
  | { type: 'onOff'; action: 'on' | 'off' | 'toggle' }
  | { type: 'level'; level: number; withOnOff: boolean }
  | { type: 'colorTemperature'; mireds: number }
  | { type: 'hueSaturation'; hue: number; saturation: number }
  | { type: 'xy'; x: number; y: number }
  | { type: 'lock'; action: 'lock' | 'unlock' }
  | { type: 'cover'; action: 'open' | 'close' | 'stop' }
  | { type: 'coverPosition'; closed100ths: number };

/** ¿Va por Matter este dispositivo (protocolo Matter o Thread, o integración matter)? */
export function isMatterDevice(device: Pick<Device, 'protocol' | 'integration'>, def: Pick<DeviceDefinition, 'integrations'>): boolean {
  return transportFor(device, def) === 'matter';
}

type SensorKind = 'temperature' | 'humidity' | 'illuminance' | 'pressure' | 'battery' | 'power' | 'energy';

const SENSOR_CLUSTER: Record<SensorKind, { cluster: MatterCluster; attributeId: number }> = {
  temperature: { cluster: 'temperatureMeasurement', attributeId: 0 },
  humidity: { cluster: 'relativeHumidityMeasurement', attributeId: 0 },
  illuminance: { cluster: 'illuminanceMeasurement', attributeId: 0 },
  pressure: { cluster: 'pressureMeasurement', attributeId: 0 },
  battery: { cluster: 'powerSource', attributeId: 12 },
  power: { cluster: 'electricalPowerMeasurement', attributeId: 8 },
  energy: { cluster: 'electricalEnergyMeasurement', attributeId: 1 },
};

/** Qué mide un sensor del simulador (por device_class y, si falta, por unidad). */
function sensorKind(e: EntityDefinition): SensorKind | undefined {
  switch (e.deviceClass) {
    case 'temperature':
    case 'humidity':
    case 'illuminance':
    case 'pressure':
    case 'battery':
    case 'power':
    case 'energy':
      return e.deviceClass;
    case undefined:
      break;
    default:
      return undefined;
  }
  if (e.unit === '°C') return 'temperature';
  if (e.unit === 'lx') return 'illuminance';
  if (e.unit === 'hPa') return 'pressure';
  if (e.unit === 'W') return 'power';
  if (e.unit === 'kWh') return 'energy';
  return undefined;
}

type BinaryKind = 'contact' | 'occupancy' | 'leak';

function binaryKind(e: EntityDefinition): BinaryKind | undefined {
  switch (e.deviceClass) {
    case 'door':
    case 'window':
    case 'opening':
    case 'garage_door':
      return 'contact';
    case 'motion':
    case 'occupancy':
    case 'presence':
      return 'occupancy';
    case 'moisture':
      return 'leak';
    default:
      return undefined;
  }
}

/** Tipo de luz Matter según sus modos de color. */
function lightPlan(e: EntityDefinition): MatterLightPlan {
  const modes = e.capabilities?.colorModes ?? ['brightness'];
  const minK = e.capabilities?.minKelvin ?? 2000;
  const maxK = e.capabilities?.maxKelvin ?? 6500;
  const color = modes.includes('rgb');
  const colorTemp = modes.includes('color_temp');
  return { brightness: color || colorTemp || modes.some((m) => m !== 'onoff'), colorTemp, color, minMireds: kelvinToMired(maxK), maxMireds: kelvinToMired(minK) };
}

function lightKind(l: MatterLightPlan): MatterDeviceKind {
  if (l.color) return 'extended_color_light';
  if (l.colorTemp) return 'color_temperature_light';
  return l.brightness ? 'dimmable_light' : 'on_off_light';
}

interface Draft {
  kind: MatterDeviceKind;
  clusters: MatterCluster[];
  entities: MatterEntityPlan[];
  light?: MatterLightPlan;
}

/** Decide el tipo de dispositivo y los clusters; o el motivo por el que no se puede emular. */
function draft(device: Device, def: DeviceDefinition): Draft | string {
  const list = entitiesForDevice(device, def);
  if (list.length === 0) return 'no tiene entidades que emular';
  let main: Draft | undefined;
  const extras: Array<{ entityId: string; sensor: SensorKind }> = [];
  for (const { entityId, definition: e } of list) {
    if (e.domain === 'sensor') {
      const kind = sensorKind(e);
      if (!kind) return `el sensor «${e.name}» no tiene cluster Matter emulado (solo temperatura, humedad, luz, presión, batería, potencia y energía)`;
      extras.push({ entityId, sensor: kind });
      continue;
    }
    if (main) return `tiene más de una entidad principal (${main.entities[0]?.entityId ?? '?'} y ${entityId}): el bridge Matter emula un endpoint por dispositivo`;
    switch (e.domain) {
      case 'light': {
        const light = lightPlan(e);
        const clusters: MatterCluster[] = ['onOff'];
        if (light.brightness) clusters.push('levelControl');
        if (light.color || light.colorTemp) clusters.push('colorControl');
        main = { kind: lightKind(light), clusters, light, entities: [{ entityId, cluster: 'onOff', attributeId: 0, haDomain: 'light' }] };
        break;
      }
      case 'switch':
        main = { kind: 'on_off_plug', clusters: ['onOff'], entities: [{ entityId, cluster: 'onOff', attributeId: 0, haDomain: 'switch' }] };
        break;
      case 'lock':
        main = { kind: 'door_lock', clusters: ['doorLock'], entities: [{ entityId, cluster: 'doorLock', attributeId: 0, haDomain: 'lock' }] };
        break;
      case 'cover':
        main = { kind: 'window_covering', clusters: ['windowCovering'], entities: [{ entityId, cluster: 'windowCovering', attributeId: 10, haDomain: 'cover' }] };
        break;
      case 'binary_sensor': {
        const kind = binaryKind(e);
        if (!kind) return `el sensor binario «${e.name}» (${e.deviceClass ?? 'sin clase'}) no se emula todavía por Matter`;
        if (kind === 'occupancy') main = { kind: 'occupancy_sensor', clusters: ['occupancySensing'], entities: [{ entityId, cluster: 'occupancySensing', attributeId: 0, haDomain: 'binary_sensor' }] };
        else main = { kind: kind === 'contact' ? 'contact_sensor' : 'water_leak_detector', clusters: ['booleanState'], entities: [{ entityId, cluster: 'booleanState', attributeId: 0, haDomain: 'binary_sensor' }] };
        break;
      }
      default:
        return `el dominio ${e.domain} no se emula todavía por Matter`;
    }
  }
  if (!main) {
    // Solo sensores: el primero de temperatura, humedad, luz o presión da el tipo de dispositivo.
    const primary = extras.find((x) => x.sensor === 'temperature') ?? extras.find((x) => x.sensor === 'humidity') ?? extras.find((x) => x.sensor === 'illuminance') ?? extras.find((x) => x.sensor === 'pressure');
    if (!primary) return 'solo tiene sensores de batería o energía (no hay un tipo de dispositivo Matter para ellos solos)';
    const kind: MatterDeviceKind = primary.sensor === 'temperature' ? 'temperature_sensor' : primary.sensor === 'humidity' ? 'humidity_sensor' : primary.sensor === 'illuminance' ? 'light_sensor' : 'pressure_sensor';
    main = { kind, clusters: [], entities: [] };
  }
  const seen = new Set<MatterCluster>(main.clusters);
  for (const x of extras) {
    const { cluster, attributeId } = SENSOR_CLUSTER[x.sensor];
    if (seen.has(cluster)) return `tiene dos sensores del mismo tipo (${x.sensor}): un endpoint Matter solo lleva uno`;
    seen.add(cluster);
    main.clusters.push(cluster);
    main.entities.push({ entityId: x.entityId, cluster, attributeId, haDomain: 'sensor' });
  }
  return main;
}

/** ¿Se puede emular este dispositivo como endpoint del bridge Matter? */
export function matterSupport(device: Device, def: DeviceDefinition): MatterSupport {
  const d = draft(device, def);
  return typeof d === 'string' ? { ok: false, reason: d } : { ok: true, kind: d.kind };
}

const clip = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max).trimEnd());
const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

/** Id del endpoint en matter.js (estable por proyecto y dispositivo). */
export function matterEndpointId(projectId: Id, deviceId: Id): string {
  return `hasim-${hex8(fnv1a(`hasim-matter:${projectId}:${deviceId}`))}`;
}

/** UniqueID del dispositivo bridged (estable, 22 caracteres). */
export function matterUniqueId(projectId: Id, deviceId: Id): string {
  return `hasim-${hex8(fnv1a(`hasim-matter:${projectId}:${deviceId}`))}${hex8(fnv1a(`${deviceId}:${projectId}`, 0x6d617474))}`;
}

/** Plan del endpoint Matter de un dispositivo (debe ser compatible: ver matterSupport). */
export function matterDevicePlan(projectId: Id, device: Device, def: DeviceDefinition, area?: string): MatterDevicePlan | undefined {
  const d = draft(device, def);
  if (typeof d === 'string') return undefined;
  return {
    deviceId: device.id,
    endpointId: matterEndpointId(projectId, device.id),
    uniqueId: matterUniqueId(projectId, device.id),
    name: clip(device.name, 32),
    ...(area !== undefined ? { area } : {}),
    vendorName: clip(def.brand, 32),
    productName: clip(def.model, 32),
    serialNumber: hex8(fnv1a(`hasim-serial:${projectId}:${device.id}`)),
    kind: d.kind,
    clusters: d.clusters,
    entities: d.entities,
    ...(d.light ? { light: d.light } : {}),
  };
}

/** Endpoints Matter del proyecto (los dispositivos Matter/Thread compatibles). */
export function buildMatterPlan(project: Project, baseDefs: DeviceDefinition[]): MatterDevicePlan[] {
  const defs = allDefinitions(project, baseDefs);
  const rooms = new Map(project.rooms.map((r) => [r.id, r.name]));
  const out: MatterDevicePlan[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def || def.role === 'ha_server' || !isMatterDevice(device, def)) continue;
    const plan = matterDevicePlan(project.id, device, def, device.roomId ? rooms.get(device.roomId) : undefined);
    if (plan) out.push(plan);
  }
  return out;
}

// ---------- Conversiones ----------

const num = (v: EntityStateValue | undefined): number | undefined => {
  if (v === undefined || typeof v === 'boolean' || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

/** Brillo del simulador (0-255) → CurrentLevel de Matter (1-254), igual que lo invierte HA. */
export function brightnessToLevel(brightness: number): number {
  return clamp(Math.round(MATTER_LEVEL_MIN + (clamp(brightness, 0, 255) / 255) * (MATTER_LEVEL_MAX - MATTER_LEVEL_MIN)), MATTER_LEVEL_MIN, MATTER_LEVEL_MAX);
}

/** CurrentLevel de Matter (1-254) → brillo del simulador (1-255), como lo calcula HA. */
export function levelToBrightness(level: number): number {
  return clamp(Math.round(((clamp(level, MATTER_LEVEL_MIN, MATTER_LEVEL_MAX) - MATTER_LEVEL_MIN) / (MATTER_LEVEL_MAX - MATTER_LEVEL_MIN)) * 255), 1, 255);
}

/** RGB → tono y saturación de Matter (0-254 cada uno). */
export function rgbToMatterHs(rgb: Rgb): { hue: number; saturation: number } {
  const [r, g, b] = rgb.map((c) => c / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { hue: clamp(Math.round((h / 360) * 254), 0, 254), saturation: clamp(Math.round(s * 254), 0, 254) };
}

/** Tono y saturación de Matter (0-254) → RGB a brillo máximo. */
export function matterHsToRgb(hue: number, saturation: number): Rgb {
  const h = (clamp(hue, 0, 254) / 254) * 360;
  const s = clamp(saturation, 0, 254) / 254;
  const c = s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const UNKNOWN = new Set(['unavailable', 'unknown']);

/** Valor medido de un sensor del simulador en las unidades del cluster Matter (null si no hay dato). */
export function matterMeasured(kind: MatterCluster, st: EntityState | undefined): number | null {
  const v = st && !UNKNOWN.has(String(st.state)) ? num(st.state) : undefined;
  if (v === undefined) return null;
  switch (kind) {
    case 'temperatureMeasurement':
      return clamp(Math.round(v * 100), -27315, 32767);
    case 'relativeHumidityMeasurement':
      return clamp(Math.round(v * 100), 0, 10000);
    case 'illuminanceMeasurement':
      // MeasuredValue = 10000 · log10(lux) + 1 (0 = demasiado poca luz para medir).
      return v < 1 ? 0 : clamp(Math.round(10000 * Math.log10(v) + 1), 1, 0xfffe);
    case 'pressureMeasurement':
      // Décimas de kPa = hPa.
      return clamp(Math.round(v), -32767, 32767);
    case 'powerSource':
      return clamp(Math.round(v * 2), 0, 200);
    case 'electricalPowerMeasurement':
      return Math.round(v * 1000);
    case 'electricalEnergyMeasurement':
      return Math.max(0, Math.round(v * 1_000_000));
    default:
      return null;
  }
}

function lightState(plan: MatterDevicePlan, st: EntityState | undefined, out: MatterState): void {
  const light = plan.light;
  out.onOff = st?.state === 'on';
  if (!light) return;
  const attrs = st?.attributes ?? {};
  if (light.brightness) {
    const b = num(attrs.brightness);
    if (b !== undefined && b > 0) out.level = brightnessToLevel(b);
  }
  if (!light.color && !light.colorTemp) return;
  const rgb = light.color ? parseRgbText(attrs.rgb_color) : undefined;
  const kelvin = light.colorTemp ? num(attrs.color_temp_kelvin) : undefined;
  if (rgb && (attrs.color_mode !== 'color_temp' || kelvin === undefined)) {
    const xy = rgbToXy(rgb);
    out.color = { mode: 0, ...rgbToMatterHs(rgb), x: Math.round(xy.x * 65536), y: Math.round(xy.y * 65536) };
  } else if (kelvin !== undefined) {
    out.color = { mode: 2, mireds: clamp(kelvinToMired(kelvin), light.minMireds, light.maxMireds) };
  }
}

function lockState(st: EntityState | undefined): 0 | 1 | 2 | null {
  switch (st?.state) {
    case 'locked':
    case 'locking':
      return 1;
    case 'unlocked':
    case 'unlocking':
    case 'open':
    case 'opening':
      return 2;
    case 'jammed':
      return 0;
    default:
      return null;
  }
}

function coverState(st: EntityState | undefined): NonNullable<MatterState['cover']> {
  const pos = num(st?.attributes?.current_position);
  const moving = st?.state === 'opening' ? 'opening' : st?.state === 'closing' ? 'closing' : 'stopped';
  if (pos !== undefined) return { closed100ths: clamp(Math.round((100 - clamp(pos, 0, 100)) * 100), 0, 10000), moving };
  if (st?.state === 'open') return { closed100ths: 0, moving };
  if (st?.state === 'closed') return { closed100ths: 10000, moving };
  return { closed100ths: null, moving };
}

/** Estado Matter del endpoint de un dispositivo a partir de los estados del simulador. */
export function matterStateOf(plan: MatterDevicePlan, entities: Readonly<Record<string, EntityState>>, reachable: boolean): MatterState {
  const out: MatterState = { reachable };
  for (const e of plan.entities) {
    const st = entities[e.entityId];
    switch (e.cluster) {
      case 'onOff':
        if (e.haDomain === 'light') lightState(plan, st, out);
        else out.onOff = st?.state === 'on';
        break;
      case 'booleanState':
        // Contacto: StateValue true = cerrado (en el simulador «off»); fuga: true = hay agua («on»).
        out.stateValue = plan.kind === 'contact_sensor' ? st?.state !== 'on' : st?.state === 'on';
        break;
      case 'occupancySensing':
        out.occupied = st?.state === 'on';
        break;
      case 'temperatureMeasurement':
        out.temperature = matterMeasured(e.cluster, st);
        break;
      case 'relativeHumidityMeasurement':
        out.humidity = matterMeasured(e.cluster, st);
        break;
      case 'illuminanceMeasurement':
        out.illuminance = matterMeasured(e.cluster, st);
        break;
      case 'pressureMeasurement':
        out.pressure = matterMeasured(e.cluster, st);
        break;
      case 'powerSource':
        out.battery = matterMeasured(e.cluster, st);
        break;
      case 'electricalPowerMeasurement':
        out.activePowerMw = matterMeasured(e.cluster, st);
        break;
      case 'electricalEnergyMeasurement':
        out.energyMwh = matterMeasured(e.cluster, st);
        break;
      case 'doorLock':
        out.lockState = lockState(st);
        break;
      case 'windowCovering':
        out.cover = coverState(st);
        break;
      default:
        break;
    }
  }
  return out;
}

const cmd = (entityId: string, service: string, data: BridgeCommand['data'] = {}): BridgeCommand => ({ entityId, service, data });

/** Comando de HA por Matter → llamada a servicio del simulador. */
export function matterCommandToService(plan: MatterDevicePlan, command: MatterCommand): BridgeCommand | null {
  const main = plan.entities[0];
  if (!main) return null;
  const domain = main.entityId.slice(0, main.entityId.indexOf('.'));
  switch (command.type) {
    case 'onOff':
      if (main.cluster !== 'onOff') return null;
      return cmd(main.entityId, `${domain}.${command.action === 'on' ? 'turn_on' : command.action === 'off' ? 'turn_off' : 'toggle'}`);
    case 'level':
      if (!plan.light?.brightness) return null;
      if (command.level <= 0) return command.withOnOff ? cmd(main.entityId, 'light.turn_off') : null;
      return cmd(main.entityId, 'light.turn_on', { brightness: levelToBrightness(command.level) });
    case 'colorTemperature':
      if (!plan.light?.colorTemp || command.mireds <= 0) return null;
      return cmd(main.entityId, 'light.turn_on', { color_temp_kelvin: miredToKelvin(clamp(command.mireds, plan.light.minMireds, plan.light.maxMireds)) });
    case 'hueSaturation':
      if (!plan.light?.color) return null;
      return cmd(main.entityId, 'light.turn_on', { rgb_color: matterHsToRgb(command.hue, command.saturation) });
    case 'xy':
      if (!plan.light?.color) return null;
      return cmd(main.entityId, 'light.turn_on', { rgb_color: xyToRgb(command.x / 65536, command.y / 65536) });
    case 'lock':
      if (main.cluster !== 'doorLock') return null;
      return cmd(main.entityId, command.action === 'lock' ? 'lock.lock' : 'lock.unlock');
    case 'cover':
      if (main.cluster !== 'windowCovering') return null;
      return cmd(main.entityId, command.action === 'open' ? 'cover.open_cover' : command.action === 'close' ? 'cover.close_cover' : 'cover.stop_cover');
    case 'coverPosition':
      if (main.cluster !== 'windowCovering') return null;
      return cmd(main.entityId, 'cover.set_cover_position', { position: clamp(Math.round(100 - command.closed100ths / 100), 0, 100) });
    default:
      return null;
  }
}

/** Resumen de un estado para el inspector de tráfico. */
export function describeMatterState(s: MatterState): string {
  const parts: string[] = [];
  if (!s.reachable) parts.push('reachable=false');
  if (s.onOff !== undefined) parts.push(`OnOff=${s.onOff ? 'on' : 'off'}`);
  if (s.level !== undefined && s.level !== null) parts.push(`Level=${s.level}`);
  if (s.color?.mode === 2) parts.push(`ColorTemp=${s.color.mireds ?? '?'} mireds`);
  else if (s.color) parts.push(`Hue=${s.color.hue ?? '?'} Sat=${s.color.saturation ?? '?'}`);
  if (s.stateValue !== undefined) parts.push(`BooleanState=${s.stateValue}`);
  if (s.occupied !== undefined) parts.push(`Occupancy=${s.occupied ? 1 : 0}`);
  const measures: Array<[string, number | null | undefined]> = [
    ['Temperature', s.temperature],
    ['Humidity', s.humidity],
    ['Illuminance', s.illuminance],
    ['Pressure', s.pressure],
    ['Battery', s.battery],
    ['ActivePower', s.activePowerMw],
    ['Energy', s.energyMwh],
  ];
  for (const [name, v] of measures) if (v !== undefined) parts.push(`${name}=${v === null ? 'null' : v}`);
  if (s.lockState !== undefined) parts.push(`LockState=${s.lockState ?? 'null'}`);
  if (s.cover) parts.push(`Lift=${s.cover.closed100ths ?? 'null'} ${s.cover.moving}`);
  return parts.join(' ');
}

/** Resumen de un comando para el inspector de tráfico. */
export function describeMatterCommand(c: MatterCommand): string {
  switch (c.type) {
    case 'onOff':
      return `OnOff · ${c.action === 'on' ? 'On' : c.action === 'off' ? 'Off' : 'Toggle'}`;
    case 'level':
      return `LevelControl · MoveToLevel${c.withOnOff ? 'WithOnOff' : ''} · level=${c.level}`;
    case 'colorTemperature':
      return `ColorControl · MoveToColorTemperature · ${c.mireds} mireds`;
    case 'hueSaturation':
      return `ColorControl · MoveToHueAndSaturation · hue=${c.hue} sat=${c.saturation}`;
    case 'xy':
      return `ColorControl · MoveToColor · x=${c.x} y=${c.y}`;
    case 'lock':
      return `DoorLock · ${c.action === 'lock' ? 'LockDoor' : 'UnlockDoor'}`;
    case 'cover':
      return `WindowCovering · ${c.action === 'open' ? 'UpOrOpen' : c.action === 'close' ? 'DownOrClose' : 'StopMotion'}`;
    case 'coverPosition':
      return `WindowCovering · GoToLiftPercentage · ${c.closed100ths}`;
    default:
      return 'desconocido';
  }
}
