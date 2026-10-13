// Vía ESPHome real (E2): cada dispositivo ESPHome del proyecto es un nodo que habla la API nativa
// de ESPHome (la misma que usa la integración `esphome` de HA). Aquí se decide qué entidades
// ESPHome publica cada nodo (sensor, binary_sensor, switch, light, number, select, text_sensor y
// text), cómo se traducen los estados del simulador y los comandos de HA. Lógica pura: la usan la
// app («Vía hacia HA») y el orquestador (emulator/orchestrator/src/esphome).
import { transportFor, type Device, type DeviceDefinition, type EntityDefinition, type EntityState, type EntityStateValue, type Id, type Project } from '../../types';
import { entitiesForDevice, slugify } from '../../devices/entities';
import { allDefinitions } from '../../devices/catalog';
import type { BridgeCommand } from '../mqtt/commands';
import { fnv1a } from '../hash';
import { kelvinToMired, miredToKelvin, parseRgbText } from '../mqtt/color';

export type EspEntityKind = 'sensor' | 'binary_sensor' | 'switch' | 'light' | 'number' | 'select' | 'text_sensor' | 'text' | 'button';

/** Qué parte de la entidad del simulador representa (media_player y assist_satellite se dividen). */
export type EspRole = 'main' | 'state' | 'power' | 'volume' | 'source' | 'announce';

/** Modos de color de la API de ESPHome (enum ColorMode de api.proto). */
export const ESP_COLOR_MODE = { onoff: 1, brightness: 3, color_temp: 11, rgb: 35 } as const;

export interface EspEntityPlan {
  /** Clave de la entidad en la API (fixed32, única en el nodo). */
  key: number;
  objectId: string;
  name: string;
  kind: EspEntityKind;
  role: EspRole;
  /** entity_id del simulador al que representa. */
  entityId: string;
  /** entity_id que se pide a HA (se alinea tras crearse). */
  haEntityId: string;
  deviceClass?: string;
  unit?: string;
  /** state_class: 1 measurement, 2 total_increasing (enum SensorStateClass). */
  stateClass?: number;
  accuracyDecimals?: number;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** light: modos de color admitidos (enum ColorMode) y rango en mireds. */
  colorModes?: number[];
  minMireds?: number;
  maxMireds?: number;
}

export interface EspNodePlan {
  deviceId: Id;
  /** Nombre ESPHome (hostname): estable aunque se renombre el dispositivo. */
  name: string;
  friendlyName: string;
  /** MAC estable y localmente administrada, «AA:BB:CC:DD:EE:FF». */
  mac: string;
  area?: string;
  model: string;
  manufacturer: string;
  entities: EspEntityPlan[];
}

export type EspSupport = { ok: true } | { ok: false; reason: string };

/** Estado de una entidad en la API nativa. */
export type EspState =
  | { type: 'binary'; state: boolean; missing?: boolean }
  | { type: 'float'; state: number; missing?: boolean }
  | { type: 'text'; state: string; missing?: boolean }
  | { type: 'light'; on: boolean; brightness: number; colorMode: number; rgb?: [number, number, number]; mireds?: number };

/** Comando de HA que llega a un nodo por la API nativa. */
export type EspCommand =
  | { type: 'switch'; key: number; state: boolean }
  | { type: 'light'; key: number; state?: boolean; brightness?: number; rgb?: [number, number, number]; mireds?: number }
  | { type: 'number'; key: number; state: number }
  | { type: 'select'; key: number; state: string }
  | { type: 'text'; key: number; state: string }
  | { type: 'button'; key: number };

/** ¿Va por ESPHome este dispositivo (integración esphome)? */
export function isEsphomeDevice(device: Pick<Device, 'protocol' | 'integration'>, def: Pick<DeviceDefinition, 'integrations'>): boolean {
  return transportFor(device, def) === 'esphome';
}

const SUPPORTED = new Set(['sensor', 'binary_sensor', 'switch', 'light', 'select', 'button', 'media_player', 'assist_satellite']);

const isNumeric = (v: EntityStateValue): boolean => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

export function esphomeSupport(device: Device, def: DeviceDefinition): EspSupport {
  const entities = entitiesForDevice(device, def);
  if (entities.length === 0) return { ok: false, reason: 'no tiene entidades que emular' };
  const bad = entities.find((e) => !SUPPORTED.has(e.definition.domain));
  if (bad) return { ok: false, reason: `el dominio ${bad.definition.domain} no se emula todavía con la API nativa de ESPHome` };
  return { ok: true };
}

/** MAC estable (localmente administrada, unicast) para un dispositivo. */
export function macFor(projectId: Id, deviceId: Id): string {
  const a = fnv1a(`hasim-esp:${projectId}:${deviceId}`);
  const b = fnv1a(`hasim-esp:${deviceId}:${projectId}`, 0x050c5d1f);
  const bytes = [((a >>> 24) & 0xfc) | 0x02, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff, (b >>> 8) & 0xff, b & 0xff];
  return bytes.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** Nombre ESPHome (hostname, como mucho 31 caracteres [a-z0-9-]) a partir del id del dispositivo. */
export function nodeNameFor(deviceId: Id): string {
  const base = `hasim-${slugify(deviceId).replace(/_/g, '-')}`.replace(/-+/g, '-').replace(/-$/, '');
  if (base.length <= 31) return base;
  return `${base.slice(0, 22).replace(/-$/, '')}-${fnv1a(deviceId).toString(16).padStart(8, '0')}`;
}

function sensorStateClass(e: EntityDefinition): number | undefined {
  if (e.deviceClass === 'energy' || e.unit === 'kWh' || e.unit === 'Wh') return 2;
  return e.unit !== undefined ? 1 : undefined;
}

function lightModes(e: EntityDefinition): number[] {
  const modes = e.capabilities?.colorModes ?? ['brightness'];
  const out: number[] = [];
  if (modes.includes('rgb')) out.push(ESP_COLOR_MODE.rgb);
  if (modes.includes('color_temp')) out.push(ESP_COLOR_MODE.color_temp);
  if (out.length === 0) out.push(modes.some((m) => m !== 'onoff') ? ESP_COLOR_MODE.brightness : ESP_COLOR_MODE.onoff);
  return out;
}

type Draft = Omit<EspEntityPlan, 'key'>;

function drafts(entityId: string, e: EntityDefinition, nameOf: (suffix?: string) => string): Draft[] {
  const obj = entityId.slice(entityId.indexOf('.') + 1);
  const base = { entityId, ...(e.deviceClass ? { deviceClass: e.deviceClass } : {}) };
  switch (e.domain) {
    case 'sensor': {
      if (!isNumeric(e.initialState) && e.unit === undefined) {
        return [{ ...base, kind: 'text_sensor', role: 'main', objectId: e.key, name: nameOf(), haEntityId: entityId }];
      }
      const sc = sensorStateClass(e);
      return [
        {
          ...base,
          kind: 'sensor',
          role: 'main',
          objectId: e.key,
          name: nameOf(),
          haEntityId: entityId,
          ...(e.unit !== undefined ? { unit: e.unit } : {}),
          ...(sc !== undefined ? { stateClass: sc } : {}),
          accuracyDecimals: e.unit === '°C' || e.unit === '%' || e.unit === 'kWh' ? 1 : 0,
        },
      ];
    }
    case 'binary_sensor':
      return [{ ...base, kind: 'binary_sensor', role: 'main', objectId: e.key, name: nameOf(), haEntityId: entityId }];
    case 'switch':
      return [{ ...base, kind: 'switch', role: 'main', objectId: e.key, name: nameOf(), haEntityId: entityId }];
    case 'button':
      return [{ ...base, kind: 'button', role: 'main', objectId: e.key, name: nameOf(), haEntityId: entityId }];
    case 'select':
      return [{ ...base, kind: 'select', role: 'main', objectId: e.key, name: nameOf(), haEntityId: entityId, options: e.capabilities?.options ?? [] }];
    case 'light': {
      const min = e.capabilities?.minKelvin ?? 2000;
      const max = e.capabilities?.maxKelvin ?? 6500;
      return [
        {
          entityId,
          kind: 'light',
          role: 'main',
          objectId: e.key,
          name: nameOf(),
          haEntityId: entityId,
          colorModes: lightModes(e),
          minMireds: kelvinToMired(max),
          maxMireds: kelvinToMired(min),
        },
      ];
    }
    case 'media_player': {
      // La API nativa tiene media_player, pero el del simulador no reproduce audio: se publica como
      // en MQTT (estado, encendido, volumen y fuente) para que HA lo controle igual.
      const out: Draft[] = [
        { entityId, kind: 'text_sensor', role: 'state', objectId: `${e.key}_state`, name: nameOf('Estado'), haEntityId: `sensor.${obj}_state` },
        { entityId, kind: 'switch', role: 'power', objectId: `${e.key}_power`, name: nameOf('Encendido'), haEntityId: `switch.${obj}_power` },
        { entityId, kind: 'number', role: 'volume', objectId: `${e.key}_volume`, name: nameOf('Volumen'), haEntityId: `number.${obj}_volume`, min: 0, max: 100, step: 1, unit: '%' },
      ];
      const sources = e.capabilities?.sources ?? [];
      if (sources.length > 0) out.push({ entityId, kind: 'select', role: 'source', objectId: `${e.key}_source`, name: nameOf('Fuente'), haEntityId: `select.${obj}_source`, options: sources });
      return out;
    }
    case 'assist_satellite':
      // voice_assistant necesita micrófono (no existe en la plataforma host): estado + anuncio.
      return [
        { entityId, kind: 'text_sensor', role: 'state', objectId: `${e.key}_state`, name: nameOf('Estado'), haEntityId: `sensor.${obj}_state` },
        { entityId, kind: 'text', role: 'announce', objectId: `${e.key}_announce`, name: nameOf('Anuncio'), haEntityId: `text.${obj}_announce` },
      ];
    default:
      return [];
  }
}

/** Plan del nodo ESPHome de un dispositivo (debe ser compatible: ver esphomeSupport). */
export function esphomeNodePlan(projectId: Id, device: Device, def: DeviceDefinition, area?: string): EspNodePlan {
  const list = entitiesForDevice(device, def);
  const single = list.length === 1;
  const used = new Set<number>();
  const entities: EspEntityPlan[] = [];
  for (const e of list) {
    const label = single ? '' : e.definition.name;
    const nameOf = (suffix?: string): string => (suffix ? (label ? `${label} · ${suffix}` : suffix) : label);
    for (const d of drafts(e.entityId, e.definition, nameOf)) {
      let key = fnv1a(d.objectId);
      while (used.has(key) || key === 0) key = (key + 1) >>> 0;
      used.add(key);
      entities.push({ ...d, key, objectId: d.objectId.replace(/[^a-z0-9_]/gi, '_').toLowerCase() });
    }
  }
  return {
    deviceId: device.id,
    name: nodeNameFor(device.id),
    friendlyName: device.name,
    mac: macFor(projectId, device.id),
    ...(area !== undefined ? { area } : {}),
    model: def.model,
    manufacturer: def.brand,
    entities,
  };
}

/** Nodos ESPHome del proyecto (los dispositivos esphome compatibles). */
export function buildEsphomePlan(project: Project, baseDefs: DeviceDefinition[]): EspNodePlan[] {
  const defs = allDefinitions(project, baseDefs);
  const rooms = new Map(project.rooms.map((r) => [r.id, r.name]));
  const out: EspNodePlan[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def || def.role === 'ha_server' || !isEsphomeDevice(device, def) || !esphomeSupport(device, def).ok) continue;
    out.push(esphomeNodePlan(project.id, device, def, device.roomId ? rooms.get(device.roomId) : undefined));
  }
  return out;
}

const num = (v: EntityStateValue | undefined): number | undefined => {
  if (v === undefined || typeof v === 'boolean' || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const UNKNOWN = new Set(['unavailable', 'unknown']);

/** Estado de una entidad ESPHome a partir del de la entidad del simulador. */
export function espStateOf(entity: EspEntityPlan, st: EntityState | undefined): EspState {
  const missing = !st || UNKNOWN.has(String(st.state));
  const attrs = st?.attributes ?? {};
  const on = st?.state === 'on' || st?.state === true;
  switch (entity.kind) {
    case 'binary_sensor':
      return { type: 'binary', state: on, ...(missing ? { missing } : {}) };
    case 'switch':
      if (entity.role === 'power') return { type: 'binary', state: !missing && st?.state !== 'off', ...(missing ? { missing } : {}) };
      return { type: 'binary', state: on, ...(missing ? { missing } : {}) };
    case 'sensor': {
      const n = num(st?.state);
      return n === undefined ? { type: 'float', state: 0, missing: true } : { type: 'float', state: n };
    }
    case 'number': {
      const n = entity.role === 'volume' ? num(attrs.volume_level) : num(st?.state);
      if (n === undefined) return { type: 'float', state: 0, missing: true };
      return { type: 'float', state: entity.role === 'volume' ? Math.round(n * 100) : n };
    }
    case 'select': {
      const v = entity.role === 'source' ? attrs.source : st?.state;
      return v === undefined || missing ? { type: 'text', state: '', missing: true } : { type: 'text', state: String(v) };
    }
    case 'text': {
      const msg = attrs.last_announcement ?? attrs.announcement;
      return { type: 'text', state: msg === undefined ? '' : String(msg) };
    }
    case 'text_sensor':
      return missing ? { type: 'text', state: '', missing: true } : { type: 'text', state: String(st?.state ?? '') };
    case 'light': {
      const modes = entity.colorModes ?? [ESP_COLOR_MODE.brightness];
      const b = num(attrs.brightness);
      const rgb = parseRgbText(attrs.rgb_color);
      const kelvin = num(attrs.color_temp_kelvin);
      let colorMode: number = modes.includes(ESP_COLOR_MODE.brightness) ? ESP_COLOR_MODE.brightness : (modes[0] ?? ESP_COLOR_MODE.onoff);
      if (rgb && modes.includes(ESP_COLOR_MODE.rgb) && attrs.color_mode !== 'color_temp') colorMode = ESP_COLOR_MODE.rgb;
      else if (kelvin !== undefined && modes.includes(ESP_COLOR_MODE.color_temp)) colorMode = ESP_COLOR_MODE.color_temp;
      return {
        type: 'light',
        on,
        brightness: b === undefined ? (on ? 1 : 0) : Math.max(0, Math.min(1, b / 255)),
        colorMode,
        ...(rgb ? { rgb: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as [number, number, number] } : {}),
        ...(kelvin !== undefined ? { mireds: kelvinToMired(kelvin) } : {}),
      };
    }
    default:
      return { type: 'text', state: '', missing: true };
  }
}

/** Estados de todas las entidades de un nodo, por clave. */
export function espNodeStates(node: EspNodePlan, entities: Readonly<Record<string, EntityState>>): Map<number, EspState> {
  return new Map(node.entities.filter((e) => e.kind !== 'button').map((e) => [e.key, espStateOf(e, entities[e.entityId])]));
}

const cmd = (entityId: string, service: string, data: BridgeCommand['data'] = {}): BridgeCommand => ({ entityId, service, data });

/** Comando de HA por la API nativa → llamada a servicio del simulador. */
export function espCommandToService(node: EspNodePlan, command: EspCommand): BridgeCommand | null {
  const e = node.entities.find((x) => x.key === command.key);
  if (!e) return null;
  const domain = e.entityId.slice(0, e.entityId.indexOf('.'));
  switch (command.type) {
    case 'switch':
      if (e.kind !== 'switch') return null;
      return cmd(e.entityId, `${domain}.${command.state ? 'turn_on' : 'turn_off'}`);
    case 'button':
      return e.kind === 'button' ? cmd(e.entityId, 'button.press') : null;
    case 'number':
      if (e.kind !== 'number') return null;
      if (e.role === 'volume') return cmd(e.entityId, 'media_player.volume_set', { volume_level: Math.max(0, Math.min(100, command.state)) / 100 });
      return cmd(e.entityId, `${domain}.set_value`, { value: command.state });
    case 'select':
      if (e.kind !== 'select') return null;
      if (e.role === 'source') return cmd(e.entityId, 'media_player.select_source', { source: command.state });
      return cmd(e.entityId, 'select.select_option', { option: command.state });
    case 'text':
      if (e.kind !== 'text' || e.role !== 'announce' || command.state.trim() === '') return null;
      return cmd(e.entityId, 'assist_satellite.announce', { message: command.state });
    case 'light': {
      if (e.kind !== 'light') return null;
      if (command.state === false) return cmd(e.entityId, 'light.turn_off');
      const data: Record<string, number | number[]> = {};
      if (command.brightness !== undefined) data.brightness = Math.max(1, Math.min(255, Math.round(command.brightness * 255)));
      if (command.rgb) data.rgb_color = command.rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * 255))));
      if (command.mireds !== undefined && command.mireds > 0) data.color_temp_kelvin = miredToKelvin(command.mireds);
      return cmd(e.entityId, 'light.turn_on', data);
    }
    default:
      return null;
  }
}

/** Resumen de un estado para el inspector de tráfico. */
export function describeEspState(s: EspState): string {
  if (s.type === 'light') return `${s.on ? 'on' : 'off'} brillo=${Math.round(s.brightness * 100)} %`;
  if (s.missing) return 'sin estado';
  return String(s.state);
}
