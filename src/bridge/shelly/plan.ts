// Vía Shelly real (E3): cada dispositivo Shelly Gen2+ (Plus, Pro, Gen3, Gen4) del proyecto es un
// Shelly emulado que habla su API RPC (HTTP GET /shelly + WebSocket /rpc con JSON-RPC 2.0), la
// misma que usa la integración `shelly` de HA (biblioteca aioshelly, RpcDevice). Aquí se decide qué
// componentes RPC tiene cada dispositivo (switch:N, cover:0, light:N, em:0, temperature:0...), cómo
// se traducen los estados del simulador a su `Shelly.GetStatus` y las llamadas RPC de HA a servicios
// del simulador. Lógica pura: la usan la app («Vía hacia HA») y el orquestador
// (emulator/orchestrator/src/shelly).
import { transportFor, type Device, type DeviceDefinition, type EntityState, type EntityStateValue, type Id, type Project } from '../../types';
import { entitiesForDevice } from '../../devices/entities';
import { allDefinitions } from '../../devices/catalog';
import type { BridgeCommand } from '../mqtt/commands';
import { fnv1a } from '../hash';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type ShellyComponentType = 'switch' | 'cover' | 'light' | 'em' | 'emdata' | 'temperature' | 'humidity' | 'devicepower';

export interface ShellyComponent {
  /** Clave RPC, p. ej. «switch:0». */
  key: string;
  type: ShellyComponentType;
  id: number;
  /** Nombre del canal en su configuración (null: el del dispositivo). */
  name: string | null;
  /** Entidad del simulador que lo maneja (salida, persiana, luz, sensor...). */
  entityId?: string;
}

/** Entidad que crea HA para un valor del simulador (para alinear su entity_id). */
export interface ShellyEntityPlan {
  /** entity_id del simulador. */
  entityId: string;
  /** Dominio de la entidad que crea HA (switch, cover, light, sensor). */
  haDomain: string;
  /** unique_id de HA sin la MAC: «switch:0», «switch:0-power», «em:0-total_act_power»... */
  uniqueSuffix: string;
}

export interface ShellyNodePlan {
  deviceId: Id;
  /** Nombre del dispositivo (sys.device.name): HA lo usa como nombre. */
  friendlyName: string;
  /** Id del Shelly (hostname), p. ej. «shelly1pmg3-aabbccddeeff». */
  hostname: string;
  /** MAC en el formato de Shelly: 12 cifras hexadecimales en mayúsculas, sin separadores. */
  mac: string;
  model: string;
  gen: number;
  /** Aplicación del firmware (campo app de /shelly). */
  app: string;
  /** Perfil de los equipos con dos modos (2PM: switch o cover). */
  profile?: 'switch' | 'cover';
  area?: string;
  manufacturer: string;
  components: ShellyComponent[];
  /** Medida eléctrica del dispositivo (una entidad del simulador para todos los canales). */
  meter: { power?: string; energy?: string; energyUnit?: string; voltage?: string; phases?: Array<string | undefined> };
  entities: ShellyEntityPlan[];
}

export type ShellySupport = { ok: true } | { ok: false; reason: string };

/** Firmware que anuncia el Shelly emulado (fecha de compilación posterior a la mínima de aioshelly). */
export const SHELLY_FW_ID = '20250924-062729/1.7.1-gd336f31';
export const SHELLY_FW_VERSION = '1.7.1';
/** Tensión nominal (V) cuando el simulador no la mide (la red del simulador va a 230 V). */
export const NOMINAL_VOLTAGE = 230;

interface ModelInfo {
  app: string;
  prefix: string;
  gen: number;
}

/** Modelos conocidos (los del catálogo y algunos habituales): app y prefijo del hostname reales. */
const MODELS: Record<string, ModelInfo> = {
  'S3PL-00112EU': { app: 'PlugSG3', prefix: 'shellyplugsg3', gen: 3 },
  'S3SW-001P16EU': { app: 'S1PMG3', prefix: 'shelly1pmg3', gen: 3 },
  'S3SW-002P16EU': { app: 'S2PMG3', prefix: 'shelly2pmg3', gen: 3 },
  'S3SW-001X16EU': { app: 'S1G3', prefix: 'shelly1g3', gen: 3 },
  'S3SN-0U12A': { app: 'HTG3', prefix: 'shellyhtg3', gen: 3 },
  'S3DM-0A101WWL': { app: 'DimmerG3', prefix: 'shellydimmerg3', gen: 3 },
  'SPEM-003CEBEU': { app: 'Pro3EM', prefix: 'shellypro3em', gen: 2 },
  'SNSW-001P16EU': { app: 'Plus1PM', prefix: 'shellyplus1pm', gen: 2 },
  'SNSW-001X16EU': { app: 'Plus1', prefix: 'shellyplus1', gen: 2 },
  'SNSW-002P16EU': { app: 'Plus2PM', prefix: 'shellyplus2pm', gen: 2 },
  'SNPL-00112EU': { app: 'PlusPlugS', prefix: 'shellyplusplugs', gen: 2 },
  // Relés del catálogo ampliado (modelos de aioshelly; app y prefijo siguen el patrón de cada gama).
  'S3SW-001X8EU': { app: 'Mini1G3', prefix: 'shelly1minig3', gen: 3 },
  'S3SW-001P8EU': { app: 'Mini1PMG3', prefix: 'shelly1pmminig3', gen: 3 },
  'S4SW-001X16EU': { app: 'S1G4', prefix: 'shelly1g4', gen: 4 },
  'S4SW-001P16EU': { app: 'S1PMG4', prefix: 'shelly1pmg4', gen: 4 },
  'S4SW-002P16EU': { app: 'S2PMG4', prefix: 'shelly2pmg4', gen: 4 },
  'SPSW-001PE16EU': { app: 'Pro1PM', prefix: 'shellypro1pm', gen: 2 },
  'SPSW-002PE16EU': { app: 'Pro2PM', prefix: 'shellypro2pm', gen: 2 },
};

/** Modelo Shelly de una definición del catálogo («S3SW-002P16EU (modo persiana)» → «S3SW-002P16EU»). */
export function shellyModelOf(def: Pick<DeviceDefinition, 'model'>): string {
  return def.model.trim().split(/\s+/)[0] ?? '';
}

/** Generación por el modelo: Gen1 (SH…) usa CoIoT y no se emula; S3 → Gen3, S4 → Gen4, SN/SP → Gen2. */
export function shellyGenOf(model: string): number {
  const known = MODELS[model];
  if (known) return known.gen;
  const m = model.toUpperCase();
  if (m.startsWith('SH')) return 1;
  if (m.startsWith('S4')) return 4;
  if (m.startsWith('S3')) return 3;
  return 2;
}

/** ¿Va por Shelly este dispositivo (integración shelly)? */
export function isShellyDevice(device: Pick<Device, 'protocol' | 'integration'>, def: Pick<DeviceDefinition, 'integrations'>): boolean {
  return transportFor(device, def) === 'shelly';
}

const POWER_CLASSES = new Set(['power', 'energy', 'voltage']);
const PHASE_KEYS: Record<string, number> = { power_a: 0, power_b: 1, power_c: 2 };

export function shellySupport(device: Device, def: DeviceDefinition): ShellySupport {
  const gen = shellyGenOf(shellyModelOf(def));
  if (gen < 2) return { ok: false, reason: 'es un Shelly Gen1 (CoIoT): solo se emulan los Gen2+ con la API RPC' };
  const entities = entitiesForDevice(device, def);
  if (entities.length === 0) return { ok: false, reason: 'no tiene entidades que emular' };
  let outputs = 0;
  let covers = 0;
  for (const e of entities) {
    const d = e.definition;
    if (d.domain === 'switch' || d.domain === 'light') outputs += 1;
    else if (d.domain === 'cover') {
      if (d.deviceClass === 'garage' || d.deviceClass === 'gate') return { ok: false, reason: 'una puerta de garaje con relé no tiene equivalente directo en la integración shelly' };
      covers += 1;
    } else if (d.domain === 'sensor') {
      const cls = d.deviceClass ?? '';
      if (!POWER_CLASSES.has(cls) && cls !== 'temperature' && cls !== 'humidity' && cls !== 'battery') {
        return { ok: false, reason: `el sensor «${d.name}» no tiene equivalente en los componentes RPC de Shelly` };
      }
    } else return { ok: false, reason: `el dominio ${d.domain} no se emula todavía con el emulador Shelly` };
  }
  if (covers > 1 || (covers === 1 && outputs > 0)) return { ok: false, reason: 'combinación de persiana y salidas no emulada' };
  if (outputs > 4) return { ok: false, reason: 'más de 4 canales' };
  return { ok: true };
}

/** MAC estable (12 cifras hex en mayúsculas, localmente administrada) para un dispositivo. */
export function shellyMacFor(projectId: Id, deviceId: Id): string {
  const a = fnv1a(`hasim-shelly:${projectId}:${deviceId}`);
  const b = fnv1a(`hasim-shelly:${deviceId}:${projectId}`, 0x5e11c0de);
  const bytes = [((a >>> 24) & 0xfc) | 0x02, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff, (b >>> 8) & 0xff, b & 0xff];
  return bytes.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** Plan del Shelly emulado de un dispositivo (debe ser compatible: ver shellySupport). */
export function shellyNodePlan(projectId: Id, device: Device, def: DeviceDefinition, area?: string): ShellyNodePlan {
  const model = shellyModelOf(def);
  const info = MODELS[model] ?? { app: 'Shelly', prefix: 'shelly', gen: shellyGenOf(model) };
  const mac = shellyMacFor(projectId, device.id);
  const list = entitiesForDevice(device, def);
  const components: ShellyComponent[] = [];
  const meter: ShellyNodePlan['meter'] = {};
  const sensors: Array<{ entityId: string; cls: string; key: string }> = [];
  const counters: Partial<Record<ShellyComponentType, number>> = {};
  const add = (type: ShellyComponentType, name: string | null, entityId?: string): ShellyComponent => {
    const id = counters[type] ?? 0;
    counters[type] = id + 1;
    const c: ShellyComponent = { key: `${type}:${id}`, type, id, name, ...(entityId ? { entityId } : {}) };
    components.push(c);
    return c;
  };
  const outputs = list.filter((e) => e.definition.domain === 'switch' || e.definition.domain === 'light' || e.definition.domain === 'cover');
  const multi = outputs.length > 1;
  for (const e of outputs) add(e.definition.domain as 'switch' | 'light' | 'cover', multi ? e.definition.name : null, e.entityId);
  for (const e of list) {
    if (e.definition.domain !== 'sensor') continue;
    const cls = e.definition.deviceClass ?? '';
    const phase = PHASE_KEYS[e.definition.key];
    if (phase !== undefined) {
      meter.phases = meter.phases ?? [undefined, undefined, undefined];
      meter.phases[phase] = e.entityId;
    } else if (cls === 'power' && !meter.power) meter.power = e.entityId;
    else if (cls === 'energy' && !meter.energy) {
      meter.energy = e.entityId;
      if (e.definition.unit) meter.energyUnit = e.definition.unit;
    }
    else if (cls === 'voltage' && !meter.voltage) meter.voltage = e.entityId;
    else sensors.push({ entityId: e.entityId, cls, key: e.definition.key });
  }
  const entities: ShellyEntityPlan[] = [];
  for (const c of components) if (c.entityId) entities.push({ entityId: c.entityId, haDomain: c.type, uniqueSuffix: c.key });
  // Medida eléctrica: en la salida si hay una sola; en un medidor (em:0 + emdata:0) si no hay salidas.
  const host = outputs.length === 1 ? components[0] : undefined;
  if (host) {
    const sfx = host.type === 'light' ? '_light' : '';
    if (meter.power) entities.push({ entityId: meter.power, haDomain: 'sensor', uniqueSuffix: `${host.key}-power${sfx}` });
    if (meter.energy) entities.push({ entityId: meter.energy, haDomain: 'sensor', uniqueSuffix: `${host.key}-energy${sfx}` });
    if (meter.voltage) entities.push({ entityId: meter.voltage, haDomain: 'sensor', uniqueSuffix: `${host.key}-voltage${sfx}` });
  } else if (outputs.length === 0 && (meter.power || meter.energy || meter.voltage || meter.phases)) {
    add('em', null);
    if (meter.energy) add('emdata', null);
    if (meter.power) entities.push({ entityId: meter.power, haDomain: 'sensor', uniqueSuffix: 'em:0-total_act_power' });
    meter.phases?.forEach((id, i) => {
      if (id) entities.push({ entityId: id, haDomain: 'sensor', uniqueSuffix: `em:0-${'abc'[i]}_act_power` });
    });
    if (meter.voltage) entities.push({ entityId: meter.voltage, haDomain: 'sensor', uniqueSuffix: 'em:0-a_voltage' });
    if (meter.energy) entities.push({ entityId: meter.energy, haDomain: 'sensor', uniqueSuffix: 'emdata:0-total_act' });
  }
  for (const s of sensors) {
    if (s.cls === 'temperature') {
      const c = add('temperature', null, s.entityId);
      entities.push({ entityId: s.entityId, haDomain: 'sensor', uniqueSuffix: `${c.key}-temperature_tc` });
    } else if (s.cls === 'humidity') {
      const c = add('humidity', null, s.entityId);
      entities.push({ entityId: s.entityId, haDomain: 'sensor', uniqueSuffix: `${c.key}-humidity_rh` });
    } else if (s.cls === 'battery' && !counters.devicepower) {
      const c = add('devicepower', null, s.entityId);
      entities.push({ entityId: s.entityId, haDomain: 'sensor', uniqueSuffix: `${c.key}-battery` });
    }
  }
  const covers = components.some((c) => c.type === 'cover');
  const twoModes = model === 'S3SW-002P16EU' || model === 'SNSW-002P16EU' || model === 'SNSW-102P16EU';
  return {
    deviceId: device.id,
    friendlyName: device.name,
    hostname: `${info.prefix}-${mac.toLowerCase()}`,
    mac,
    model,
    gen: info.gen,
    app: info.app,
    ...(twoModes ? { profile: covers ? ('cover' as const) : ('switch' as const) } : {}),
    ...(area !== undefined ? { area } : {}),
    manufacturer: def.brand,
    components,
    meter,
    entities,
  };
}

/** Shellys emulados del proyecto (los dispositivos shelly compatibles). */
export function buildShellyPlan(project: Project, baseDefs: DeviceDefinition[]): ShellyNodePlan[] {
  const defs = allDefinitions(project, baseDefs);
  const rooms = new Map(project.rooms.map((r) => [r.id, r.name]));
  const out: ShellyNodePlan[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def || def.role === 'ha_server' || !isShellyDevice(device, def) || !shellySupport(device, def).ok) continue;
    out.push(shellyNodePlan(project.id, device, def, device.roomId ? rooms.get(device.roomId) : undefined));
  }
  return out;
}

// ---------- Estado (Shelly.GetStatus) ----------

type Entities = Readonly<Record<string, EntityState>>;

const num = (v: EntityStateValue | undefined): number | undefined => {
  if (v === undefined || typeof v === 'boolean' || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const round = (n: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

const isOn = (st: EntityState | undefined): boolean => st?.state === 'on' || st?.state === true;

/** Energía del simulador (kWh o Wh) en Wh, como la cuenta Shelly (aenergy.total). */
function energyWh(plan: ShellyNodePlan, entities: Entities): number | undefined {
  const id = plan.meter.energy;
  if (!id) return undefined;
  const n = num(entities[id]?.state);
  if (n === undefined) return undefined;
  return round(plan.meter.energyUnit === 'Wh' ? n : n * 1000, 3);
}

/** Posición (0-100) de una persiana del simulador. */
function coverPos(st: EntityState | undefined): number {
  const p = num(st?.attributes?.current_position);
  if (p !== undefined) return Math.max(0, Math.min(100, Math.round(p)));
  return st?.state === 'closed' ? 0 : 100;
}

/** Estado de una persiana Shelly: open/closed en los extremos, stopped a medias, opening/closing. */
export function shellyCoverState(st: EntityState | undefined): 'open' | 'closed' | 'opening' | 'closing' | 'stopped' {
  const s = String(st?.state ?? '');
  if (s === 'opening' || s === 'closing') return s;
  const pos = coverPos(st);
  if (s === 'closed' || pos === 0) return pos === 0 ? 'closed' : 'stopped';
  return pos === 100 ? 'open' : 'stopped';
}

/** Reparto de la medida de un dispositivo entre sus salidas (la potencia, entre las encendidas). */
function meterShare(plan: ShellyNodePlan, entities: Entities, c: ShellyComponent): { apower?: number; energy?: number; voltage: number } {
  const outputs = plan.components.filter((x) => x.type === 'switch' || x.type === 'light' || x.type === 'cover');
  const voltage = num(plan.meter.voltage ? entities[plan.meter.voltage]?.state : undefined) ?? NOMINAL_VOLTAGE;
  const power = num(plan.meter.power ? entities[plan.meter.power]?.state : undefined);
  const energy = energyWh(plan, entities);
  if (outputs.length <= 1) return { ...(power !== undefined ? { apower: power } : {}), ...(energy !== undefined ? { energy } : {}), voltage };
  const active = outputs.filter((x) => x.type === 'cover' || isOn(x.entityId ? entities[x.entityId] : undefined));
  const mine = active.some((x) => x.key === c.key);
  return {
    ...(power !== undefined ? { apower: mine ? round(power / active.length, 1) : 0 } : {}),
    ...(energy !== undefined ? { energy: round(energy / outputs.length, 3) } : {}),
    voltage,
  };
}

/** Campos eléctricos comunes de una salida (solo los que el simulador mide; la intensidad se deriva). */
function electrical(plan: ShellyNodePlan, entities: Entities, c: ShellyComponent): JsonObject {
  const m = meterShare(plan, entities, c);
  if (m.apower === undefined && m.energy === undefined) return {};
  const out: JsonObject = {};
  if (m.apower !== undefined) {
    out.apower = round(m.apower, 1);
    out.voltage = round(m.voltage, 1);
    out.current = round(m.voltage > 0 ? m.apower / m.voltage : 0, 3);
  }
  if (m.energy !== undefined) out.aenergy = { total: m.energy, by_minute: [0, 0, 0], minute_ts: 0 };
  return out;
}

/** Estado RPC de un componente a partir de los estados del simulador. */
export function shellyComponentStatus(plan: ShellyNodePlan, c: ShellyComponent, entities: Entities): JsonObject {
  const st = c.entityId ? entities[c.entityId] : undefined;
  switch (c.type) {
    case 'switch':
      return { id: c.id, source: 'init', output: isOn(st), ...electrical(plan, entities, c) };
    case 'light': {
      const b = num(st?.attributes?.brightness);
      return { id: c.id, source: 'init', output: isOn(st), brightness: b === undefined ? (isOn(st) ? 100 : 0) : Math.round((b / 255) * 100), ...electrical(plan, entities, c) };
    }
    case 'cover': {
      const state = shellyCoverState(st);
      const pos = coverPos(st);
      return {
        id: c.id,
        source: 'init',
        state,
        ...electrical(plan, entities, c),
        current_pos: pos,
        pos_control: true,
        last_direction: state === 'opening' ? 'open' : state === 'closing' ? 'close' : pos === 0 ? 'close' : 'open',
      };
    }
    case 'em': {
      const power = num(plan.meter.power ? entities[plan.meter.power]?.state : undefined) ?? 0;
      const voltage = num(plan.meter.voltage ? entities[plan.meter.voltage]?.state : undefined) ?? NOMINAL_VOLTAGE;
      const phases = [0, 1, 2].map((i) => {
        const id = plan.meter.phases?.[i];
        const p = id ? num(entities[id]?.state) : undefined;
        return p ?? (plan.meter.phases ? 0 : round(power / 3, 1));
      });
      const out: JsonObject = { id: c.id };
      ['a', 'b', 'c'].forEach((ph, i) => {
        const p = phases[i] ?? 0;
        out[`${ph}_act_power`] = round(p, 1);
        out[`${ph}_aprt_power`] = round(p, 1);
        out[`${ph}_voltage`] = round(voltage, 1);
        out[`${ph}_current`] = round(voltage > 0 ? p / voltage : 0, 3);
        out[`${ph}_pf`] = 1;
      });
      out.total_act_power = round(power, 1);
      out.total_aprt_power = round(power, 1);
      out.total_current = round(voltage > 0 ? power / voltage : 0, 3);
      return out;
    }
    case 'emdata': {
      const total = energyWh(plan, entities) ?? 0;
      return { id: c.id, total_act: total, total_act_ret: 0, a_total_act_energy: round(total / 3, 3), b_total_act_energy: round(total / 3, 3), c_total_act_energy: round(total / 3, 3) };
    }
    case 'temperature': {
      const t = num(st?.state);
      return t === undefined ? { id: c.id, tC: null, tF: null, errors: ['read'] } : { id: c.id, tC: round(t, 1), tF: round((t * 9) / 5 + 32, 1) };
    }
    case 'humidity': {
      const h = num(st?.state);
      return h === undefined ? { id: c.id, rh: null, errors: ['read'] } : { id: c.id, rh: round(h, 1) };
    }
    case 'devicepower': {
      const p = num(st?.state);
      const percent = p === undefined ? 0 : Math.max(0, Math.min(100, Math.round(p)));
      return { id: c.id, battery: { V: round(2.4 + (percent / 100) * 0.9, 2), percent }, external: { present: false } };
    }
    default:
      return { id: c.id };
  }
}

/** Estado de todos los componentes del Shelly (sin sys ni wifi), por clave. */
export function shellyComponentsStatus(plan: ShellyNodePlan, entities: Entities): Record<string, JsonObject> {
  return Object.fromEntries(plan.components.map((c) => [c.key, shellyComponentStatus(plan, c, entities)]));
}

export interface ShellyRuntime {
  /** Segundos en marcha. */
  uptime: number;
  /** Hora real (s). */
  unixtime: number;
  /** IP en la que escucha (wifi.sta_ip). */
  ip?: string;
}

function hhmm(unixtime: number): string {
  const d = new Date(unixtime * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Shelly.GetStatus completo. */
export function shellyStatus(plan: ShellyNodePlan, entities: Entities, rt: ShellyRuntime): JsonObject {
  return {
    ble: {},
    cloud: { connected: false },
    mqtt: { connected: false },
    sys: {
      mac: plan.mac,
      restart_required: false,
      time: hhmm(rt.unixtime),
      unixtime: Math.floor(rt.unixtime),
      uptime: Math.floor(rt.uptime),
      ram_size: 262144,
      ram_free: 140000,
      fs_size: 458752,
      fs_free: 200000,
      cfg_rev: 1,
      kvs_rev: 0,
      schedule_rev: 0,
      webhook_rev: 0,
      available_updates: {},
      reset_reason: 3,
    },
    wifi: { sta_ip: rt.ip ?? '127.0.0.1', status: 'got ip', ssid: 'hasim-lab' },
    ws: { connected: false },
    ...shellyComponentsStatus(plan, entities),
  };
}

/** /shelly y Shelly.GetDeviceInfo. */
export function shellyDeviceInfo(plan: ShellyNodePlan): JsonObject {
  return {
    name: plan.friendlyName,
    id: plan.hostname,
    mac: plan.mac,
    slot: 0,
    model: plan.model,
    gen: plan.gen,
    fw_id: SHELLY_FW_ID,
    ver: SHELLY_FW_VERSION,
    app: plan.app,
    auth_en: false,
    auth_domain: null,
    ...(plan.profile ? { profile: plan.profile } : {}),
  };
}

function componentConfig(c: ShellyComponent): JsonObject {
  switch (c.type) {
    case 'switch':
      return { id: c.id, name: c.name, in_mode: 'follow', initial_state: 'match_input', auto_on: false, auto_on_delay: 60, auto_off: false, auto_off_delay: 60, power_limit: 4480, voltage_limit: 280, autorecover_voltage_errors: false, current_limit: 16 };
    case 'light':
      return { id: c.id, name: c.name, initial_state: 'restore_last', auto_on: false, auto_on_delay: 60, auto_off: false, auto_off_delay: 60, transition_duration: 1, min_brightness_on_toggle: 3, night_mode: { enable: false, brightness: 50, active_between: [] } };
    case 'cover':
      return {
        id: c.id,
        name: c.name,
        motor: { idle_power_thr: 2, idle_confirm_period: 0.25 },
        maxtime_open: 60,
        maxtime_close: 60,
        initial_state: 'stopped',
        invert_directions: false,
        in_mode: 'dual',
        swap_inputs: false,
        safety_switch: { enable: false, direction: 'both', action: 'stop', allowed_move: null },
        power_limit: 2800,
        voltage_limit: 280,
        current_limit: 10,
        obstruction_detection: { enable: false, direction: 'both', action: 'stop', power_thr: 1000, holdoff: 1 },
        slat: { enable: false, open_time: 1.5, close_time: 1.5, step: 20, retain_pos: false, precise_ctl: false },
      };
    case 'em':
      return { id: c.id, name: null, blink_mode_selector: 'active_energy', phase_selector: 'all', monitor_phase_sequence: false, ct_type: '120A' };
    case 'temperature':
      return { id: c.id, name: null, report_thr_C: 0.5, offset_C: 0 };
    case 'humidity':
      return { id: c.id, name: null, report_thr: 1, offset: 0 };
    default:
      return { id: c.id };
  }
}

/** Shelly.GetConfig. */
export function shellyConfig(plan: ShellyNodePlan): JsonObject {
  const components = Object.fromEntries(plan.components.map((c) => [c.key, componentConfig(c)]));
  return {
    ble: { enable: false, rpc: { enable: false } },
    cloud: { enable: false, server: null },
    mqtt: { enable: false, server: null, client_id: plan.hostname, user: null, topic_prefix: plan.hostname, rpc_ntf: true, status_ntf: false, enable_control: true },
    sys: {
      device: { name: plan.friendlyName, mac: plan.mac, fw_id: SHELLY_FW_ID, discoverable: false, eco_mode: false, addon_type: null, ...(plan.profile ? { profile: plan.profile } : {}) },
      location: { tz: 'Europe/Madrid', lat: null, lon: null },
      debug: { level: 2, file_level: null, mqtt: { enable: false }, websocket: { enable: false }, udp: { addr: null } },
      ui_data: {},
      rpc_udp: { dst_addr: null, listen_port: null },
      sntp: { server: 'time.google.com' },
      cfg_rev: 1,
    },
    wifi: {
      ap: { ssid: plan.hostname, is_open: false, enable: false, range_extender: { enable: false } },
      sta: { ssid: 'hasim-lab', is_open: false, enable: true, ipv4mode: 'dhcp', ip: null, netmask: null, gw: null, nameserver: null },
      sta1: { ssid: null, is_open: true, enable: false, ipv4mode: 'dhcp', ip: null, netmask: null, gw: null, nameserver: null },
      roam: { rssi_thr: -80, interval: 60 },
    },
    ws: { enable: false, server: null, ssl_ca: 'ca.pem' },
    ...components,
  };
}

/** Métodos RPC que responde el Shelly emulado (Shelly.ListMethods). */
export function shellyMethods(plan: ShellyNodePlan): string[] {
  const out = ['Shelly.GetDeviceInfo', 'Shelly.GetStatus', 'Shelly.GetConfig', 'Shelly.GetComponents', 'Shelly.ListMethods', 'Shelly.CheckForUpdate', 'Sys.GetStatus', 'Sys.GetConfig', 'WiFi.GetStatus', 'WiFi.GetConfig'];
  const types = new Set(plan.components.map((c) => c.type));
  if (types.has('switch')) out.push('Switch.Set', 'Switch.Toggle', 'Switch.GetStatus', 'Switch.GetConfig');
  if (types.has('cover')) out.push('Cover.Open', 'Cover.Close', 'Cover.Stop', 'Cover.GoToPosition', 'Cover.GetStatus', 'Cover.GetConfig');
  if (types.has('light')) out.push('Light.Set', 'Light.Toggle', 'Light.GetStatus', 'Light.GetConfig');
  if (types.has('em')) out.push('EM.GetStatus', 'EM.GetConfig');
  if (types.has('emdata')) out.push('EMData.GetStatus');
  if (types.has('temperature')) out.push('Temperature.GetStatus', 'Temperature.GetConfig');
  if (types.has('humidity')) out.push('Humidity.GetStatus', 'Humidity.GetConfig');
  if (types.has('devicepower')) out.push('DevicePower.GetStatus');
  return out;
}

// ---------- Llamadas RPC (Switch.Set, Cover.Open...) ----------

export interface RpcError {
  code: number;
  message: string;
}

export interface RpcOutcome {
  /** Resultado JSON-RPC (null es un resultado válido, como Cover.Open del firmware real). */
  result?: Json;
  error?: RpcError;
  /** Llamadas a servicio del simulador que provoca (comandos de HA). */
  commands: BridgeCommand[];
}

const cmd = (entityId: string, service: string, data: BridgeCommand['data'] = {}): BridgeCommand => ({ entityId, service, data });

const COMPONENT_OF: Record<string, ShellyComponentType> = {
  switch: 'switch',
  cover: 'cover',
  light: 'light',
  em: 'em',
  emdata: 'emdata',
  temperature: 'temperature',
  humidity: 'humidity',
  devicepower: 'devicepower',
};

/**
 * Atiende una llamada RPC de HA. Las de lectura devuelven el estado; las de mando devuelven el
 * resultado del firmware real (Switch.Set → was_on) y los comandos para el simulador.
 */
export function handleShellyRpc(plan: ShellyNodePlan, method: string, params: JsonObject | undefined, entities: Entities, rt: ShellyRuntime): RpcOutcome {
  const ok = (result: Json, commands: BridgeCommand[] = []): RpcOutcome => ({ result, commands });
  const fail = (code: number, message: string): RpcOutcome => ({ error: { code, message }, commands: [] });
  const p = params ?? {};
  switch (method) {
    case 'Shelly.GetDeviceInfo':
      return ok(shellyDeviceInfo(plan));
    case 'Shelly.GetStatus':
      return ok(shellyStatus(plan, entities, rt));
    case 'Shelly.GetConfig':
      return ok(shellyConfig(plan));
    case 'Shelly.GetComponents':
      // Solo componentes estáticos: no hay componentes dinámicos (virtuales ni BLU).
      return ok({ components: [], cfg_rev: 1, offset: 0, total: 0 });
    case 'Shelly.ListMethods':
      return ok({ methods: shellyMethods(plan) });
    case 'Shelly.CheckForUpdate':
      return ok({});
    case 'Sys.GetStatus':
      return ok(shellyStatus(plan, entities, rt).sys ?? null);
    case 'Sys.GetConfig':
      return ok(shellyConfig(plan).sys ?? null);
    case 'WiFi.GetStatus':
      return ok(shellyStatus(plan, entities, rt).wifi ?? null);
    case 'WiFi.GetConfig':
      return ok(shellyConfig(plan).wifi ?? null);
    default:
      break;
  }
  const dot = method.indexOf('.');
  const type = COMPONENT_OF[method.slice(0, dot).toLowerCase()];
  const action = method.slice(dot + 1);
  if (dot < 0 || !type) return fail(404, `No handler for ${method}`);
  const id = typeof p.id === 'number' ? p.id : 0;
  const c = plan.components.find((x) => x.type === type && x.id === id);
  if (!c) return fail(-105, `Argument 'id', value ${String(p.id ?? id)} not found!`);
  if (action === 'GetStatus') return ok(shellyComponentStatus(plan, c, entities));
  if (action === 'GetConfig') return ok(componentConfig(c));
  const target = c.entityId;
  if (!target) return fail(404, `No handler for ${method}`);
  const st = entities[target];
  const domain = target.slice(0, target.indexOf('.'));
  if (type === 'switch') {
    const wasOn = isOn(st);
    if (action === 'Set') {
      if (typeof p.on !== 'boolean') return fail(-103, "Missing required argument 'on'!");
      return ok({ was_on: wasOn }, [cmd(target, `${domain}.${p.on ? 'turn_on' : 'turn_off'}`)]);
    }
    if (action === 'Toggle') return ok({ was_on: wasOn }, [cmd(target, `${domain}.toggle`)]);
  }
  if (type === 'cover') {
    if (action === 'Open') return ok(null, [cmd(target, 'cover.open_cover')]);
    if (action === 'Close') return ok(null, [cmd(target, 'cover.close_cover')]);
    if (action === 'Stop') return ok(null, [cmd(target, 'cover.stop_cover')]);
    if (action === 'GoToPosition') {
      if (typeof p.pos !== 'number') return fail(-103, "Missing required argument 'pos'!");
      return ok(null, [cmd(target, 'cover.set_cover_position', { position: Math.max(0, Math.min(100, Math.round(p.pos))) })]);
    }
  }
  if (type === 'light') {
    const wasOn = isOn(st);
    if (action === 'Toggle') return ok({ was_on: wasOn }, [cmd(target, 'light.toggle')]);
    if (action === 'Set') {
      if (p.on === false) return ok(null, [cmd(target, 'light.turn_off')]);
      const data: Record<string, number> = {};
      if (typeof p.brightness === 'number') data.brightness = Math.max(1, Math.min(255, Math.round((p.brightness / 100) * 255)));
      if (p.on !== true && data.brightness === undefined) return fail(-103, "Missing required argument 'on'!");
      return ok(null, [cmd(target, 'light.turn_on', data)]);
    }
  }
  return fail(404, `No handler for ${method}`);
}

/** Componentes cuyo estado cambia entre dos lecturas (para NotifyStatus). */
export function changedComponents(before: Record<string, JsonObject>, after: Record<string, JsonObject>): Record<string, JsonObject> {
  const out: Record<string, JsonObject> = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) out[key] = value;
  }
  return out;
}

/** Resumen de un componente para el inspector de tráfico. */
export function describeShellyStatus(key: string, s: JsonObject): string {
  const parts: string[] = [];
  if (typeof s.output === 'boolean') parts.push(s.output ? 'on' : 'off');
  if (typeof s.state === 'string') parts.push(s.state);
  if (typeof s.current_pos === 'number') parts.push(`pos=${s.current_pos}`);
  if (typeof s.brightness === 'number') parts.push(`brillo=${s.brightness} %`);
  if (typeof s.apower === 'number') parts.push(`${s.apower} W`);
  if (typeof s.total_act_power === 'number') parts.push(`${s.total_act_power} W`);
  if (typeof s.tC === 'number') parts.push(`${s.tC} °C`);
  if (typeof s.rh === 'number') parts.push(`${s.rh} %`);
  const battery = s.battery;
  if (battery && typeof battery === 'object' && !Array.isArray(battery) && typeof battery.percent === 'number') parts.push(`batería ${battery.percent} %`);
  return `${key}: ${parts.join(' ') || 'cambio'}`;
}
