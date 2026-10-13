// Tanda 3: importar desde una instalación real de Home Assistant: automations.yaml,
// scenes.yaml, scripts.yaml y los registros .storage/core.device_registry, core.area_registry y
// core.entity_registry. Funciones puras: devuelven una propuesta que la interfaz revisa y aplica
// con applyImportPlan.
import type {
  Action,
  Automation,
  Brand,
  Connection,
  Device,
  DeviceCategory,
  DeviceDefinition,
  EntityDefinition,
  EntityDomain,
  EntityState,
  EntityStateValue,
  Floor,
  Id,
  Integration,
  NetworkRole,
  Project,
  Protocol,
  Room,
  Scene,
  Script,
} from '../types';
import { allDefinitions, catalog, CUSTOM_PREFIX } from '../devices/catalog';
import { ENTITY_DOMAINS, INTEGRATION_IOT_CLASS, INTEGRATIONS } from '../devices/labels';
import { entitiesForDevice, slugify } from '../devices/entities';
import { foldText } from '../devices/text';
import { uniqueDeviceName } from '../devices/factory';
import { collectEntityRefs } from '../devices/renaming';
import { mapActionEntities, mapConditionEntities, mapTriggerEntities } from '../automations/walk';
import { collectYamlWarnings } from '../automations/yaml-warnings';
import { parseAction, parseAutomationObject, parseYaml } from '../automations/yaml-parse';
import { isYamlMap, type YamlContext, type YamlMap, type YamlValue } from '../export/yaml';
import { findScene, findScript } from '../simulation/engine';
import { groupEntityId, peopleEntities } from '../simulation/logic';
import { helperEntityIds } from '../simulation/helpers';
import { suggestConnections } from '../network/connections';

export interface ImportWarning {
  /** Dónde: "[2].triggers[0].attribute", "dispositivo «Luz salón»"... */
  path: string;
  message: string;
}

export interface ImportedAutomations {
  automations: Automation[];
  warnings: ImportWarning[];
  /** entity_id que usan y que no existen en el proyecto (tras aplicar el mapeo). */
  unknownEntities: string[];
}

export interface ImportedScenes {
  scenes: Scene[];
  warnings: ImportWarning[];
  unknownEntities: string[];
}

export interface ImportedScripts {
  scripts: Script[];
  warnings: ImportWarning[];
  unknownEntities: string[];
}

/** Mapeo entity_id de HA → entity_id del simulador. */
export type EntityMap = Record<string, string>;

// ---------- Utilidades ----------

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

const mapper = (map: EntityMap) => (id: string): string => map[id] ?? id;

function mapAutomation(a: Automation, map: EntityMap): Automation {
  const m = mapper(map);
  return {
    ...a,
    triggers: a.triggers.map((t) => mapTriggerEntities(t, m)),
    conditions: a.conditions.map((c) => mapConditionEntities(c, m)),
    actions: a.actions.map((x) => mapActionEntities(x, m)),
  };
}

/** Escenas y scripts citados por clave (scene.<x>, script.<x>) que se resuelven contra el proyecto. */
function resolveRefs(actions: Action[], project: Pick<Project, 'scenes' | 'scripts'>, missing: Set<string>): Action[] {
  return actions.map((a) => {
    if (a.type === 'scene') {
      const scene = findScene(project, a.sceneId);
      if (!scene) missing.add(`scene.${a.sceneId}`);
      return scene ? { ...a, sceneId: scene.id } : a;
    }
    if (a.type === 'script') {
      const script = findScript(project, a.scriptId);
      if (!script) missing.add(`script.${a.scriptId}`);
      return script ? { ...a, scriptId: script.id } : a;
    }
    if (a.type === 'choose') return { ...a, choices: a.choices.map((o) => ({ ...o, sequence: resolveRefs(o.sequence, project, missing) })), ...(a.default ? { default: resolveRefs(a.default, project, missing) } : {}) };
    if (a.type === 'if') return { ...a, then: resolveRefs(a.then, project, missing), ...(a.else ? { else: resolveRefs(a.else, project, missing) } : {}) };
    if (a.type === 'repeat') return { ...a, sequence: resolveRefs(a.sequence, project, missing) };
    if (a.type === 'parallel') return { ...a, branches: a.branches.map((b) => resolveRefs(b, project, missing)) };
    return a;
  });
}

/** entity_id que existen en el proyecto (dispositivos, helpers, personas, zonas y grupos). */
export function projectEntityIds(project: Project, defs: DeviceDefinition[]): Set<string> {
  const all = allDefinitions(project, defs);
  const ids = new Set<string>();
  for (const d of project.devices) {
    const def = all.find((x) => x.id === d.definitionId);
    if (def) for (const e of entitiesForDevice(d, def)) ids.add(e.entityId);
  }
  for (const id of Object.keys(peopleEntities(project))) ids.add(id);
  for (const g of project.groups ?? []) ids.add(groupEntityId(g));
  for (const id of helperEntityIds(project)) ids.add(id);
  return ids;
}

function unknownRefs(project: Project, defs: DeviceDefinition[], extra: Partial<Pick<Project, 'automations' | 'scenes' | 'scripts'>>): string[] {
  const known = projectEntityIds(project, defs);
  const probe: Project = { ...project, automations: extra.automations ?? [], scenes: extra.scenes ?? [], scripts: extra.scripts ?? [] };
  const out = new Set<string>();
  for (const ref of collectEntityRefs(probe)) {
    const id = ref.entityId;
    if (id === '' || known.has(id)) continue;
    if (id.startsWith('scene.') && findScene({ scenes: [...project.scenes, ...(extra.scenes ?? [])] }, id)) continue;
    if (id.startsWith('script.') && findScript({ scripts: [...project.scripts, ...(extra.scripts ?? [])] }, id)) continue;
    out.add(id);
  }
  return [...out].sort();
}

function yamlCtx(project: Project): YamlContext {
  // Sin escenas ni scripts: se guardan por su clave y se resuelven después (resolveRefs).
  const ctx: YamlContext = { rooms: project.rooms };
  if (project.people) ctx.people = project.people;
  if (project.zones) ctx.zones = project.zones;
  return ctx;
}

function parseRootList(text: string): YamlValue[] {
  const root = parseYaml(text);
  if (root === null) return [];
  return Array.isArray(root) ? root : [root];
}

// ---------- automations.yaml / scenes.yaml / scripts.yaml ----------

/**
 * Importa automations.yaml (lista completa o una sola automatización). Las que no se pueden
 * leer se saltan con un aviso; `map` reescribe los entity_id de HA a los del simulador. Los ids
 * que ya existen en el proyecto reciben un sufijo.
 */
export function importAutomationsYaml(text: string, project: Project, defs: DeviceDefinition[] = catalog, map: EntityMap = {}): ImportedAutomations {
  const warnings: ImportWarning[] = [];
  const automations: Automation[] = [];
  const taken = new Set(project.automations.map((a) => a.id));
  const missing = new Set<string>();
  const ctx = yamlCtx(project);
  let items: YamlValue[];
  try {
    items = parseRootList(text);
  } catch (e) {
    return { automations: [], warnings: [{ path: '', message: e instanceof Error ? e.message : String(e) }], unknownEntities: [] };
  }
  items.forEach((item, i) => {
    const where = `[${i}]`;
    if (!isYamlMap(item)) {
      warnings.push({ path: where, message: 'No es una automatización (se esperaba un mapa)' });
      return;
    }
    try {
      const parsed = parseAutomationObject(item, ctx, `importada_${i + 1}`);
      const id = uniqueId(item.id === undefined || item.id === null ? `importada_${i + 1}` : String(item.id), taken);
      const mapped = mapAutomation({ ...parsed, id }, map);
      automations.push({ ...mapped, actions: resolveRefs(mapped.actions, project, missing) });
      warnings.push(...collectYamlWarnings(item, where, ctx));
    } catch (e) {
      const alias = typeof item.alias === 'string' ? ` «${item.alias}»` : '';
      warnings.push({ path: where, message: `Automatización${alias} no importada: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
  const unknownEntities = [...new Set([...unknownRefs(project, defs, { automations }), ...missing])].sort();
  return { automations, warnings, unknownEntities };
}

function attrValue(v: YamlValue): EntityStateValue | undefined {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number')) return `[${v.join(', ')}]`;
  return undefined;
}

/** Importa scenes.yaml: lista de {id, name, entities: {entity_id: estado | {state, atributos}}}. */
export function importScenesYaml(text: string, project: Project, defs: DeviceDefinition[] = catalog, map: EntityMap = {}): ImportedScenes {
  const warnings: ImportWarning[] = [];
  const scenes: Scene[] = [];
  const taken = new Set(project.scenes.map((s) => s.id));
  let items: YamlValue[];
  try {
    items = parseRootList(text);
  } catch (e) {
    return { scenes: [], warnings: [{ path: '', message: e instanceof Error ? e.message : String(e) }], unknownEntities: [] };
  }
  items.forEach((item, i) => {
    const where = `[${i}]`;
    if (!isYamlMap(item) || !isYamlMap(item.entities ?? null)) {
      warnings.push({ path: where, message: 'Escena no importada: falta «entities»' });
      return;
    }
    const entities: Record<string, EntityState> = {};
    for (const [rawId, value] of Object.entries(item.entities as YamlMap)) {
      const entityId = map[rawId] ?? rawId;
      if (isYamlMap(value)) {
        const state = attrValue(value.state ?? null);
        if (state === undefined) {
          warnings.push({ path: `${where}.entities.${rawId}`, message: 'Sin «state»: se ignora la entidad' });
          continue;
        }
        const attributes: Record<string, EntityStateValue> = {};
        for (const [k, v] of Object.entries(value)) {
          if (k === 'state') continue;
          const a = attrValue(v);
          if (a === undefined) warnings.push({ path: `${where}.entities.${rawId}.${k}`, message: `Atributo «${k}» ignorado: valor no admitido` });
          else attributes[k] = a;
        }
        entities[entityId] = Object.keys(attributes).length > 0 ? { state, attributes } : { state };
      } else {
        const state = attrValue(value);
        if (state === undefined) warnings.push({ path: `${where}.entities.${rawId}`, message: 'Estado no válido: se ignora la entidad' });
        else entities[entityId] = { state };
      }
    }
    for (const key of Object.keys(item)) {
      if (!['id', 'name', 'entities', 'icon', 'metadata'].includes(key)) warnings.push({ path: `${where}.${key}`, message: `Clave «${key}» ignorada: el simulador no la admite` });
    }
    const name = typeof item.name === 'string' ? item.name : `Escena ${i + 1}`;
    scenes.push({ id: uniqueId(item.id === undefined || item.id === null ? slugify(name) : String(item.id), taken), name, entities });
  });
  return { scenes, warnings, unknownEntities: unknownRefs(project, defs, { scenes }) };
}

/** Importa scripts.yaml: mapa clave → {alias, sequence, ...}. La clave pasa a ser el id del script. */
export function importScriptsYaml(text: string, project: Project, defs: DeviceDefinition[] = catalog, map: EntityMap = {}): ImportedScripts {
  const warnings: ImportWarning[] = [];
  const scripts: Script[] = [];
  const taken = new Set(project.scripts.map((s) => s.id));
  const missing = new Set<string>();
  let root: YamlValue;
  try {
    root = parseYaml(text);
  } catch (e) {
    return { scripts: [], warnings: [{ path: '', message: e instanceof Error ? e.message : String(e) }], unknownEntities: [] };
  }
  if (root === null) return { scripts: [], warnings: [], unknownEntities: [] };
  if (!isYamlMap(root)) return { scripts: [], warnings: [{ path: '', message: 'scripts.yaml debe ser un mapa clave → script' }], unknownEntities: [] };
  const ctx = yamlCtx(project);
  const m = mapper(map);
  for (const [key, value] of Object.entries(root)) {
    if (!isYamlMap(value)) {
      warnings.push({ path: key, message: 'Script no importado: se esperaba un mapa' });
      continue;
    }
    try {
      const sequence = (Array.isArray(value.sequence) ? value.sequence : value.sequence === undefined || value.sequence === null ? [] : [value.sequence]).map((a, i) => parseAction(a, i, ctx));
      const mapped = resolveRefs(sequence.map((a) => mapActionEntities(a, m)), project, missing);
      scripts.push({ id: uniqueId(key, taken), name: typeof value.alias === 'string' ? value.alias : key, sequence: mapped });
      for (const k of Object.keys(value)) {
        if (!['alias', 'sequence', 'icon', 'description'].includes(k)) warnings.push({ path: `${key}.${k}`, message: `Clave «${k}» ignorada: el simulador no la admite` });
      }
      const actions = Array.isArray(value.sequence) ? value.sequence : [];
      warnings.push(...collectYamlWarnings({ actions }, key, ctx).filter((w) => w.path !== key));
    } catch (e) {
      warnings.push({ path: key, message: `Script no importado: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  const unknownEntities = [...new Set([...unknownRefs(project, defs, { scripts }), ...missing])].sort();
  return { scripts, warnings, unknownEntities };
}

// ---------- Registros (.storage) ----------

export interface HaRegistryDevice {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  areaId?: string;
  integration?: string;
  entryType?: string;
  viaDeviceId?: string;
}

export interface HaRegistryEntity {
  entityId: string;
  deviceId?: string;
  platform?: string;
  name?: string;
  deviceClass?: string;
  unit?: string;
  areaId?: string;
  disabled: boolean;
}

export interface HaRegistryArea {
  id: string;
  name: string;
  floorId?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Lista de un registro de .storage ({data: {<key>: [...]}}) o la lista suelta. */
function registryList(raw: string | undefined, key: string, label: string): Obj[] {
  if (raw === undefined || raw.trim() === '') return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: no es un JSON válido`);
  }
  const list = Array.isArray(json) ? json : isObj(json) && isObj(json.data) ? json.data[key] : undefined;
  if (!Array.isArray(list)) throw new Error(`${label}: no se encuentra la lista «data.${key}»`);
  return list.filter(isObj);
}

/** Integración de HA del dispositivo (primer identificador: ["zha", "00:15:8d..."]). */
function deviceIntegration(o: Obj): string | undefined {
  const ids = o.identifiers;
  if (Array.isArray(ids)) {
    for (const pair of ids) if (Array.isArray(pair) && typeof pair[0] === 'string') return pair[0];
  }
  return undefined;
}

export function parseDeviceRegistry(raw: string | undefined): HaRegistryDevice[] {
  return registryList(raw, 'devices', 'core.device_registry').map((o) => {
    const d: HaRegistryDevice = { id: String(o.id ?? ''), name: text(o.name_by_user) ?? text(o.name) ?? 'Dispositivo' };
    const manufacturer = text(o.manufacturer);
    const model = text(o.model) ?? text(o.model_id);
    const areaId = text(o.area_id);
    const integration = deviceIntegration(o);
    const entryType = text(o.entry_type);
    const via = text(o.via_device_id);
    if (manufacturer) d.manufacturer = manufacturer;
    if (model) d.model = model;
    if (areaId) d.areaId = areaId;
    if (integration) d.integration = integration;
    if (entryType) d.entryType = entryType;
    if (via) d.viaDeviceId = via;
    return d;
  });
}

export function parseAreaRegistry(raw: string | undefined): HaRegistryArea[] {
  return registryList(raw, 'areas', 'core.area_registry').map((o) => {
    const a: HaRegistryArea = { id: String(o.id ?? ''), name: text(o.name) ?? String(o.id ?? 'Área') };
    const floor = text(o.floor_id);
    if (floor) a.floorId = floor;
    return a;
  });
}

export function parseEntityRegistry(raw: string | undefined): HaRegistryEntity[] {
  return registryList(raw, 'entities', 'core.entity_registry')
    .filter((o) => typeof o.entity_id === 'string')
    .map((o) => {
      const e: HaRegistryEntity = { entityId: String(o.entity_id), disabled: o.disabled_by !== null && o.disabled_by !== undefined };
      const deviceId = text(o.device_id);
      const platform = text(o.platform);
      const name = text(o.name) ?? text(o.original_name);
      const deviceClass = text(o.device_class) ?? text(o.original_device_class);
      const unit = text(o.unit_of_measurement) ?? (isObj(o.options) && isObj(o.options.sensor) ? text(o.options.sensor.unit_of_measurement) : undefined);
      const areaId = text(o.area_id);
      if (deviceId) e.deviceId = deviceId;
      if (platform) e.platform = platform;
      if (name) e.name = name;
      if (deviceClass) e.deviceClass = deviceClass;
      if (unit) e.unit = unit;
      if (areaId) e.areaId = areaId;
      return e;
    });
}

// ---------- Asociación con el catálogo ----------

/** Fabricantes tal como los escribe HA → marca del catálogo. */
export const MANUFACTURER_ALIASES: Record<string, Brand> = {
  ikea: 'IKEA',
  'ikea of sweden': 'IKEA',
  sonoff: 'SONOFF',
  itead: 'SONOFF',
  ewelink: 'SONOFF',
  aqara: 'Aqara',
  lumi: 'Aqara',
  'xiaomi aqara': 'Aqara',
  xiaomi: 'Xiaomi',
  'xiaomi home': 'Xiaomi',
  shelly: 'Shelly',
  'allterco robotics': 'Shelly',
  'shelly europe': 'Shelly',
  philips: 'Philips Hue',
  'philips hue': 'Philips Hue',
  signify: 'Philips Hue',
  'signify netherlands b.v.': 'Philips Hue',
  amazon: 'Amazon',
  google: 'Google',
  'google inc.': 'Google',
  'google nest': 'Google',
  tuya: 'Tuya',
  'smart life': 'Tuya',
  'tp-link': 'TP-Link',
  tapo: 'TP-Link',
  netatmo: 'Netatmo',
  legrand: 'Netatmo',
  reolink: 'Reolink',
  sonos: 'Sonos',
  samsung: 'Samsung',
  'samsung electronics': 'Samsung',
  lg: 'LG',
  'lg electronics': 'LG',
  'nabu casa': 'Home Assistant',
  'home assistant': 'Home Assistant',
  eve: 'Eve',
  'eve systems': 'Eve',
  nanoleaf: 'Nanoleaf',
  heiman: 'Heiman',
  daikin: 'Daikin',
  sensibo: 'Sensibo',
  meross: 'Meross',
  roborock: 'Roborock',
  ecovacs: 'Ecovacs',
  aeotec: 'Aeotec',
  'aeon labs': 'Aeotec',
  fibaro: 'Fibaro',
  fibargroup: 'Fibaro',
  zooz: 'Zooz',
  espressif: 'ESPHome',
  esphome: 'ESPHome',
};

/** Modelos tal como los publican ZHA, Zigbee2MQTT y otras integraciones → id del catálogo. */
export const MODEL_ALIASES: Record<string, Id> = {
  'lumi.sensor_magnet.aq2': 'aqara-door-window',
  mccgq11lm: 'aqara-door-window',
  'lumi.motion.ac02': 'aqara-motion-p1',
  rtcgq14lm: 'aqara-motion-p1',
  'lumi.weather': 'aqara-temp-hum',
  wsdcgq11lm: 'aqara-temp-hum',
  'lumi.sensor_wleak.aq1': 'aqara-water-leak',
  'lumi.remote.b1acn01': 'aqara-wireless-mini-switch',
  wxkg11lm: 'aqara-wireless-mini-switch',
  'lumi.sensor_smoke.acn03': 'aqara-smoke-detector',
  'lumi.airmonitor.acn01': 'aqara-tvoc',
  'tradfri bulb e27 ws opal 980lm': 'ikea-tradfri-e27-ws',
  'tradfri bulb e27 ws globe 1055lm': 'ikea-tradfri-e27-ws',
  'tradfri bulb gu10 ws 400lm': 'ikea-tradfri-gu10',
  'remote control n2': 'ikea-styrbar',
  'rodret dimmer': 'ikea-rodret',
  'vindstyrka': 'ikea-vindstyrka',
  'tradfri open/close remote': 'ikea-styrbar',
  lca001: 'hue-white-color-e27',
  'hue white and color ambiance e27': 'hue-white-color-e27',
  lwa001: 'hue-white-e27',
  'hue white e27': 'hue-white-e27',
  rwl022: 'hue-dimmer-switch',
  'hue dimmer switch': 'hue-dimmer-switch',
  'snzb-02d': 'sonoff-snzb-02d',
  'snzb-03p': 'sonoff-snzb-03p',
  'snzb-04p': 'sonoff-snzb-04p',
  'zbminil2': 'sonoff-zbminil2',
  's26r2zb': 'sonoff-s26r2zb',
  swv: 'sonoff-swv',
  'shelly plug s gen3': 'shelly-plug-s-gen3',
  's3pl-00112eu': 'shelly-plug-s-gen3',
  's3sw-001p16eu': 'shelly-1pm-gen3',
  'shelly 1pm gen3': 'shelly-1pm-gen3',
  'shelly 2pm gen3': 'shelly-2pm-gen3',
  'shelly pro 3em': 'shelly-pro-3em',
  'spem-003cebeu': 'shelly-pro-3em',
  shem: 'shelly-em',
  p110: 'tapo-p110',
  p110m: 'tapo-p110m',
  lywsd03mmc: 'xiaomi-lywsd03mmc',
  'smart thermostat': 'netatmo-thermostat',
  nth01: 'netatmo-thermostat',
  'rlc-810a': 'reolink-rlc-810a',
  'era 100': 'sonos-era-100',
  'beam (gen 2)': 'sonos-beam-gen2',
  'google nest mini': 'google-nest-mini',
  'google nest hub (2nd gen)': 'google-nest-hub-2',
  'echo dot (5th gen)': 'amazon-echo-dot-5',
  'eve energy': 'eve-energy-matter',
  'eve door & window': 'eve-door-window',
  'roborock s8': 'roborock-s8',
  'zwa024': 'aeotec-multisensor-7',
  'multisensor 7': 'aeotec-multisensor-7',
  'fgwpe/f-102 zw5': 'fibaro-wall-plug',
  'wall plug': 'fibaro-wall-plug',
  'zen71': 'zooz-zen71',
  'home assistant green': 'ha-green',
  cc2652p: 'sonoff-zbdongle-p',
  'sonoff zigbee 3.0 usb dongle plus': 'sonoff-zbdongle-p',
  efr32mg21: 'sonoff-zbdongle-e',
  ezsp: 'sonoff-zbdongle-e',
};

/** Integración de HA → integración del simulador ("mqtt" de Zigbee2MQTT, etc.). */
export const INTEGRATION_ALIASES: Record<string, Integration> = {
  mqtt: 'zigbee2mqtt',
  zigbee2mqtt: 'zigbee2mqtt',
  homekit_controller: 'homekit_device',
  xiaomi_aqara: 'homekit_device',
  sonoff: 'ewelink',
  tplink_tapo: 'tplink',
  cast: 'google_cast',
  alexa_media: 'alexa_media_player',
  meross_cloud: 'meross_lan',
  hassio: 'homeassistant',
};

export function normalizeIntegration(raw: string | undefined): Integration | undefined {
  if (raw === undefined) return undefined;
  const key = raw.toLowerCase();
  return INTEGRATION_ALIASES[key] ?? INTEGRATIONS.find((i) => i === key);
}

export function brandOf(manufacturer: string | undefined): Brand | undefined {
  if (!manufacturer) return undefined;
  const key = foldText(manufacturer).trim();
  if (MANUFACTURER_ALIASES[key]) return MANUFACTURER_ALIASES[key];
  if (/^_tz[0-9a-z]+_/.test(key) || key.startsWith('tz')) return 'Tuya';
  const first = Object.keys(MANUFACTURER_ALIASES).find((k) => key.startsWith(`${k} `) || key === k);
  return first ? MANUFACTURER_ALIASES[first] : undefined;
}

const norm = (s: string): string => foldText(s).replace(/[^a-z0-9]+/g, ' ').trim();

function bigrams(s: string): string[] {
  const t = norm(s).replace(/ /g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Similitud de Sørensen-Dice entre dos textos (0 a 1), sin acentos ni signos. */
export function textSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.length === 0 || y.length === 0) return norm(a) === norm(b) && norm(a) !== '' ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of x) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of y) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      hits++;
      counts.set(g, n - 1);
    }
  }
  return (2 * hits) / (x.length + y.length);
}

export interface CatalogMatch {
  definition: DeviceDefinition;
  /** 0 a 1: 1 es coincidencia exacta del modelo o de la tabla de alias. */
  score: number;
  reason: 'alias' | 'modelo' | 'similitud';
}

/** Puntuación mínima para aceptar una coincidencia por similitud. */
export const MATCH_THRESHOLD = 0.55;

/**
 * Busca la definición del catálogo que corresponde a un dispositivo de HA por fabricante, modelo
 * e integración: primero la tabla de alias y el modelo exacto; si no, similitud de texto (con
 * ventaja si coincide la marca y la integración). undefined si nada supera MATCH_THRESHOLD.
 */
export function matchCatalog(manufacturer: string | undefined, model: string | undefined, integration: string | undefined, defs: DeviceDefinition[] = catalog): CatalogMatch | undefined {
  if (!model && !manufacturer) return undefined;
  const brand = brandOf(manufacturer);
  const integ = normalizeIntegration(integration);
  const key = foldText(model ?? '').trim();
  const aliased = MODEL_ALIASES[key];
  const byAlias = aliased ? defs.find((d) => d.id === aliased) : undefined;
  if (byAlias) return { definition: byAlias, score: 1, reason: 'alias' };
  const exact = defs.find((d) => norm(d.model) === norm(model ?? '') && norm(model ?? '') !== '' && (brand === undefined || d.brand === brand));
  if (exact) return { definition: exact, score: 1, reason: 'modelo' };
  let best: CatalogMatch | undefined;
  for (const d of defs) {
    if (d.id.startsWith(CUSTOM_PREFIX)) continue;
    if (brand !== undefined && d.brand !== brand) continue;
    const target = `${manufacturer ?? ''} ${model ?? ''}`;
    let score = Math.max(textSimilarity(model ?? '', d.model), textSimilarity(target, d.name), textSimilarity(model ?? '', d.name.replace(d.brand, '')));
    if (brand !== undefined) score += 0.1;
    if (integ !== undefined && d.integrations.includes(integ)) score += 0.05;
    score = Math.min(0.99, score);
    if (!best || score > best.score) best = { definition: d, score, reason: 'similitud' };
  }
  return best && best.score >= MATCH_THRESHOLD ? best : undefined;
}

// ---------- Propuesta de proyecto a partir de los registros ----------

export interface ImportDeviceMatch {
  haDeviceId: string;
  name: string;
  manufacturer?: string;
  model?: string;
  /** Dispositivo creado en el simulador. */
  deviceId: Id;
  definitionId: Id;
  /** true si no estaba en el catálogo y se creó un dispositivo personalizado. */
  custom: boolean;
  score: number;
  roomId?: Id;
}

export interface RegistryProposal {
  floors: Floor[];
  rooms: Room[];
  devices: Device[];
  customDefinitions: DeviceDefinition[];
  /** entity_id de HA → entity_id del simulador. */
  entityMap: EntityMap;
  matches: ImportDeviceMatch[];
  warnings: ImportWarning[];
}

const DOMAIN_INITIAL: Partial<Record<EntityDomain, EntityStateValue>> = {
  light: 'off',
  switch: 'off',
  fan: 'off',
  siren: 'off',
  binary_sensor: 'off',
  cover: 'closed',
  valve: 'closed',
  lock: 'locked',
  climate: 'off',
  media_player: 'off',
  vacuum: 'docked',
  camera: 'idle',
  button: 'unknown',
  alarm_control_panel: 'disarmed',
};

const CATEGORY_BY_DOMAIN: Partial<Record<EntityDomain, DeviceCategory>> = {
  light: 'light',
  switch: 'switch',
  cover: 'cover',
  climate: 'climate',
  lock: 'lock',
  camera: 'camera',
  media_player: 'speaker',
  vacuum: 'vacuum',
  valve: 'switch',
  alarm_control_panel: 'hub',
};

const PROTOCOL_BY_INTEGRATION: Partial<Record<Integration, Protocol>> = {
  zha: 'zigbee',
  zigbee2mqtt: 'zigbee',
  hue: 'zigbee',
  zwave_js: 'zwave',
  matter: 'thread',
  xiaomi_ble: 'ble',
};

function asDomain(entityId: string): EntityDomain | undefined {
  const d = entityId.slice(0, entityId.indexOf('.'));
  // select y assist_satellite necesitan opciones y un dispositivo de voz: no se importan sueltos.
  if (d === 'select' || d === 'assist_satellite') return undefined;
  return ENTITY_DOMAINS.find((x) => x === d);
}

/** Entidades del dispositivo de HA para una definición personalizada (claves únicas). */
function customEntities(device: HaRegistryDevice, entities: HaRegistryEntity[], warnings: ImportWarning[]): { defs: EntityDefinition[]; haIds: string[] } {
  const base = slugify(device.name);
  const used = new Set<string>();
  const defs: EntityDefinition[] = [];
  const haIds: string[] = [];
  for (const e of entities) {
    const domain = asDomain(e.entityId);
    if (!domain) {
      warnings.push({ path: e.entityId, message: `Entidad del dominio «${e.entityId.split('.')[0] ?? ''}» no simulada: se omite` });
      continue;
    }
    const object = e.entityId.slice(e.entityId.indexOf('.') + 1);
    const raw = object.startsWith(`${base}_`) ? object.slice(base.length + 1) : object === base ? domain : object;
    const key = uniqueId(raw.replace(/[^a-z0-9_]/g, '_') || domain, used);
    const def: EntityDefinition = {
      key,
      domain,
      name: e.name ?? key.replace(/_/g, ' '),
      initialState: domain === 'sensor' ? (e.unit !== undefined || e.deviceClass !== undefined ? 0 : 'unknown') : (DOMAIN_INITIAL[domain] ?? 'unknown'),
    };
    if (e.deviceClass) def.deviceClass = e.deviceClass;
    if (e.unit) def.unit = e.unit;
    defs.push(def);
    haIds.push(e.entityId);
  }
  return { defs, haIds };
}

function customDefinition(device: HaRegistryDevice, entities: EntityDefinition[], integration: Integration, taken: Set<string>): DeviceDefinition {
  const brand = brandOf(device.manufacturer) ?? 'Home Assistant';
  const model = device.model ?? 'Desconocido';
  const primary = entities.find((e) => CATEGORY_BY_DOMAIN[e.domain]);
  const battery = entities.some((e) => e.deviceClass === 'battery');
  const protocol = PROTOCOL_BY_INTEGRATION[integration] ?? 'wifi';
  const role: NetworkRole = 'end_device';
  return {
    id: uniqueId(`${CUSTOM_PREFIX}${slugify(`${device.manufacturer ?? 'ha'} ${model}`).replace(/_/g, '-')}`, taken),
    brand,
    model,
    name: `${device.manufacturer ?? 'Dispositivo'} ${model}`.trim(),
    category: primary ? (CATEGORY_BY_DOMAIN[primary.domain] ?? 'sensor') : 'sensor',
    protocols: [protocol],
    integrations: [integration],
    iotClass: INTEGRATION_IOT_CLASS[integration],
    role,
    power: battery ? 'battery' : 'mains',
    entities,
  };
}

/**
 * Asocia las entidades de HA con las del simulador de un dispositivo del catálogo: por dominio
 * y device_class y, a igualdad, en orden.
 */
function mapCatalogEntities(simDevice: Device, def: DeviceDefinition, entities: HaRegistryEntity[], map: EntityMap, warnings: ImportWarning[]): void {
  const sim = entitiesForDevice(simDevice, def);
  const free = [...sim];
  for (const e of entities) {
    const domain = e.entityId.split('.')[0];
    // Primero la misma device_class; después una sin clase; por último cualquiera del dominio
    // (window → door, opening → door...).
    const candidates = [
      (x: (typeof free)[number]) => x.definition.domain === domain && x.definition.deviceClass !== undefined && x.definition.deviceClass === e.deviceClass,
      (x: (typeof free)[number]) => x.definition.domain === domain && (e.deviceClass === undefined || x.definition.deviceClass === undefined),
      (x: (typeof free)[number]) => x.definition.domain === domain && (domain !== 'sensor' || x.definition.deviceClass !== 'battery'),
    ];
    const i = candidates.map((f) => free.findIndex(f)).find((n) => n !== -1) ?? -1;
    const target = free[i];
    if (!target) {
      warnings.push({ path: e.entityId, message: `Sin equivalente en «${simDevice.name}» (${def.name}): las referencias a ${e.entityId} quedarán sin resolver` });
      continue;
    }
    free.splice(i, 1);
    if (target.entityId !== e.entityId) map[e.entityId] = target.entityId;
  }
}

/** Polígono rectangular de la sala n (rejilla de 4 columnas de 400 × 300 px). */
function roomPolygon(n: number): Room['polygon'] {
  const x = (n % 4) * 400;
  const y = Math.floor(n / 4) * 300;
  return [
    { x, y },
    { x: x + 400, y },
    { x: x + 400, y: y + 300 },
    { x, y: y + 300 },
  ];
}

export interface RegistryInput {
  deviceRegistry?: string;
  areaRegistry?: string;
  entityRegistry?: string;
}

/**
 * Parsea core.device_registry, core.area_registry y core.entity_registry y propone un proyecto:
 * una sala por área (las que ya existen por nombre se reutilizan), un dispositivo por cada
 * dispositivo de HA (del catálogo si encaja con matchCatalog; si no, uno personalizado con sus
 * entidades reales) y el mapeo de entity_id. Lanza Error si un JSON no es válido.
 */
export function importRegistries(input: RegistryInput, defs: DeviceDefinition[] = catalog, project?: Project): RegistryProposal {
  const devicesHa = parseDeviceRegistry(input.deviceRegistry);
  const areas = parseAreaRegistry(input.areaRegistry);
  const entitiesHa = parseEntityRegistry(input.entityRegistry);
  const warnings: ImportWarning[] = [];
  const floors: Floor[] = [];
  const existingFloor = project?.floors[0];
  const floorId = existingFloor?.id ?? 'importada-planta';
  if (!existingFloor) floors.push({ id: floorId, name: 'Planta baja', level: 0, pixelsPerMeter: 50 });
  const rooms: Room[] = [];
  const roomByArea = new Map<string, Id>();
  const roomCount = project?.rooms.length ?? 0;
  for (const a of areas) {
    const existing = project?.rooms.find((r) => foldText(r.name) === foldText(a.name));
    if (existing) {
      roomByArea.set(a.id, existing.id);
      continue;
    }
    const room: Room = { id: `area-${slugify(a.id)}`, floorId, name: a.name, polygon: roomPolygon(roomCount + rooms.length) };
    rooms.push(room);
    roomByArea.set(a.id, room.id);
  }
  const allRooms = [...(project?.rooms ?? []), ...rooms];
  const allDefs = project ? allDefinitions(project, defs) : defs;
  const customDefinitions: DeviceDefinition[] = [];
  const takenDefIds = new Set([...allDefs.map((d) => d.id)]);
  const devices: Device[] = [];
  const matches: ImportDeviceMatch[] = [];
  const entityMap: EntityMap = {};
  const names: string[] = (project?.devices ?? []).map((d) => d.name);
  const perRoom = new Map<string, number>();
  for (const hd of devicesHa) {
    const own = entitiesHa.filter((e) => e.deviceId === hd.id && !e.disabled);
    if (hd.entryType === 'service') {
      warnings.push({ path: `dispositivo «${hd.name}»`, message: 'Es un servicio de HA (no un dispositivo físico): se omite' });
      continue;
    }
    if (own.length === 0 && hd.integration !== undefined && !['zha', 'mqtt', 'zwave_js', 'hue', 'matter'].includes(hd.integration)) {
      warnings.push({ path: `dispositivo «${hd.name}»`, message: 'No tiene entidades activas: se omite' });
      continue;
    }
    const integration = normalizeIntegration(hd.integration) ?? normalizeIntegration(own[0]?.platform);
    const match = matchCatalog(hd.manufacturer, hd.model, hd.integration, allDefs);
    let def: DeviceDefinition;
    let custom = false;
    let customHaIds: string[] = [];
    if (match) {
      def = match.definition;
    } else {
      const built = customEntities(hd, own, warnings);
      def = customDefinition(hd, built.defs, integration ?? 'homeassistant', takenDefIds);
      customDefinitions.push(def);
      customHaIds = built.haIds;
      custom = true;
      warnings.push({ path: `dispositivo «${hd.name}»`, message: `${hd.manufacturer ?? 'Fabricante desconocido'} ${hd.model ?? ''} no está en el catálogo: se crea el dispositivo personalizado «${def.name}»`.replace(/\s+:/, ':') });
    }
    const name = uniqueDeviceName(hd.name, names);
    names.push(name);
    const areaId = hd.areaId ?? own.find((e) => e.areaId)?.areaId;
    const roomId = areaId ? roomByArea.get(areaId) : undefined;
    if (areaId && !roomId) warnings.push({ path: `dispositivo «${hd.name}»`, message: `El área «${areaId}» no está en core.area_registry: queda sin sala` });
    const room = allRooms.find((r) => r.id === roomId);
    const slot = perRoom.get(roomId ?? '') ?? 0;
    perRoom.set(roomId ?? '', slot + 1);
    const origin = room?.polygon[0] ?? { x: 0, y: 1200 };
    const protocol = def.protocols.find((p) => p === PROTOCOL_BY_INTEGRATION[integration ?? 'homeassistant']) ?? def.protocols[0] ?? 'wifi';
    const device: Device = {
      id: `ha-${slugify(hd.id)}`,
      definitionId: def.id,
      name,
      floorId: room?.floorId ?? floorId,
      position: { x: origin.x + 20 + (slot % 2) * 190, y: origin.y + 20 + Math.floor(slot / 2) * 80 },
      protocol,
      integration: integration && def.integrations.includes(integration) ? integration : (def.integrations[0] ?? 'homeassistant'),
    };
    if (roomId) device.roomId = roomId;
    devices.push(device);
    if (custom) {
      const sim = entitiesForDevice(device, def);
      customHaIds.forEach((haId, i) => {
        const simId = sim[i]?.entityId;
        if (simId !== undefined && simId !== haId) entityMap[haId] = simId;
      });
    } else {
      mapCatalogEntities(device, def, own, entityMap, warnings);
    }
    const m: ImportDeviceMatch = { haDeviceId: hd.id, name, deviceId: device.id, definitionId: def.id, custom, score: match?.score ?? 0 };
    if (hd.manufacturer) m.manufacturer = hd.manufacturer;
    if (hd.model) m.model = hd.model;
    if (roomId) m.roomId = roomId;
    matches.push(m);
  }
  const orphans = entitiesHa.filter((e) => !e.disabled && e.deviceId === undefined && asDomain(e.entityId) !== undefined && !e.entityId.startsWith('sensor.sun'));
  if (orphans.length > 0) {
    warnings.push({ path: 'core.entity_registry', message: `${orphans.length} entidades sin dispositivo (${orphans.slice(0, 5).map((e) => e.entityId).join(', ')}${orphans.length > 5 ? '…' : ''}): no se importan` });
  }
  return { floors, rooms, devices, customDefinitions, entityMap, matches, warnings };
}

// ---------- Plan completo ----------

export interface ImportInput extends RegistryInput {
  automationsYaml?: string;
  scenesYaml?: string;
  scriptsYaml?: string;
}

export interface ImportPlan extends RegistryProposal {
  automations: Automation[];
  scenes: Scene[];
  scripts: Script[];
  /** entity_id citados que no existen ni en el proyecto ni en la propuesta. */
  unknownEntities: string[];
}

/** Proyecto tal como quedaría con la propuesta de los registros (para resolver referencias). */
function withProposal(project: Project, p: RegistryProposal): Project {
  return {
    ...project,
    floors: [...project.floors, ...p.floors],
    rooms: [...project.rooms, ...p.rooms],
    devices: [...project.devices, ...p.devices],
    customDefinitions: [...(project.customDefinitions ?? []), ...p.customDefinitions],
  };
}

/**
 * Plan de importación completo: registros (salas, dispositivos, personalizados y mapeo) y, con
 * ese mapeo, automatizaciones, escenas y scripts. Los errores de lectura de un registro se
 * devuelven como aviso.
 */
export function buildImportPlan(project: Project, defs: DeviceDefinition[], input: ImportInput): ImportPlan {
  let proposal: RegistryProposal;
  try {
    proposal = importRegistries(input, defs, project);
  } catch (e) {
    proposal = { floors: [], rooms: [], devices: [], customDefinitions: [], entityMap: {}, matches: [], warnings: [{ path: 'registros', message: e instanceof Error ? e.message : String(e) }] };
  }
  const target = withProposal(project, proposal);
  const warnings = [...proposal.warnings];
  const scenes = input.scenesYaml ? importScenesYaml(input.scenesYaml, target, defs, proposal.entityMap) : undefined;
  const scripts = input.scriptsYaml ? importScriptsYaml(input.scriptsYaml, target, defs, proposal.entityMap) : undefined;
  const withRefs: Project = { ...target, scenes: [...target.scenes, ...(scenes?.scenes ?? [])], scripts: [...target.scripts, ...(scripts?.scripts ?? [])] };
  const automations = input.automationsYaml ? importAutomationsYaml(input.automationsYaml, withRefs, defs, proposal.entityMap) : undefined;
  const prefix = (label: string, ws: ImportWarning[]): ImportWarning[] => ws.map((w) => ({ ...w, path: `${label}${w.path.startsWith('[') || w.path === '' ? '' : ':'}${w.path}` }));
  if (scenes) warnings.push(...prefix('scenes.yaml', scenes.warnings));
  if (scripts) warnings.push(...prefix('scripts.yaml', scripts.warnings));
  if (automations) warnings.push(...prefix('automations.yaml', automations.warnings));
  const unknownEntities = [...new Set([...(automations?.unknownEntities ?? []), ...(scenes?.unknownEntities ?? []), ...(scripts?.unknownEntities ?? [])])].sort();
  return {
    ...proposal,
    warnings,
    automations: automations?.automations ?? [],
    scenes: scenes?.scenes ?? [],
    scripts: scripts?.scripts ?? [],
    unknownEntities,
  };
}

/**
 * Aplica el plan: añade plantas, salas, dispositivos, definiciones personalizadas,
 * automatizaciones, escenas y scripts, y conecta los dispositivos nuevos a su red. Función pura.
 */
export function applyImportPlan(project: Project, plan: ImportPlan): Project {
  const merged: Project = {
    ...withProposal(project, plan),
    automations: [...project.automations, ...plan.automations],
    scenes: [...project.scenes, ...plan.scenes],
    scripts: [...project.scripts, ...plan.scripts],
  };
  if ((merged.customDefinitions ?? []).length === 0) delete merged.customDefinitions;
  const connections: Connection[] = suggestConnections(merged, catalog);
  return { ...merged, connections: [...merged.connections, ...connections] };
}
