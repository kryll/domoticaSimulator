// Catálogo de dispositivos: carga data/devices.json con validación en tiempo de ejecución.
import rawDevices from '../../data/devices.json';
import type {
  Brand,
  DeviceCategory,
  ColorMode,
  DeviceDefinition,
  EntityCapabilities,
  EntityDefinition,
  Id,
  IotClass,
  Protocol,
} from '../types';
import {
  BRANDS,
  CATEGORIES,
  ENTITY_DOMAINS,
  INTEGRATIONS,
  IOT_CLASSES,
  POWER_SOURCES,
  PROTOCOLS,
  ROLES,
} from './labels';
import { foldText } from './text';

export {
  CATEGORY_LABELS,
  INTEGRATION_LABELS,
  INTEGRATION_IOT_CLASS,
  IOT_CLASS_LABELS,
  POWER_LABELS,
  PROTOCOL_LABELS,
  ROLE_LABELS,
} from './labels';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(where: string, msg: string): never {
  throw new Error(`Catálogo de dispositivos inválido (${where}): ${msg}`);
}

function reqString(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.trim() === '') fail(where, `"${key}" debe ser un texto no vacío`);
  return v;
}

function optString(o: Obj, key: string, where: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') fail(where, `"${key}" debe ser un texto`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], key: string, where: string): T {
  const found = allowed.find((a) => a === v);
  if (found === undefined) fail(where, `"${key}" tiene un valor no válido: ${JSON.stringify(v)}`);
  return found;
}

function listOf<T extends string>(o: Obj, key: string, allowed: readonly T[], where: string): T[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length === 0) fail(where, `"${key}" debe ser una lista no vacía`);
  return v.map((item) => oneOf(item, allowed, key, where));
}

function isStateValue(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

const COLOR_MODES: readonly ColorMode[] = ['onoff', 'brightness', 'color_temp', 'rgb'];
const CAPABILITY_NUMBERS = ['minKelvin', 'maxKelvin', 'minTemp', 'maxTemp', 'tempStep', 'travelSeconds', 'motionTimeoutSeconds', 'powerWatts'] as const;
const CAPABILITY_LISTS = ['hvacModes', 'presetModes', 'sources', 'buttonActions'] as const;
const CAPABILITY_KEYS: readonly string[] = ['colorModes', ...CAPABILITY_NUMBERS, ...CAPABILITY_LISTS];

function stringList(v: unknown, key: string, where: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x === '')) fail(where, `"capabilities.${key}" debe ser una lista de textos`);
  return v.map(String);
}

/** Valida las capacidades de una entidad (todas opcionales, sin claves desconocidas). */
export function parseCapabilities(raw: unknown, where: string): EntityCapabilities {
  if (!isObj(raw)) fail(where, '"capabilities" debe ser un objeto');
  const unknownKey = Object.keys(raw).find((k) => !CAPABILITY_KEYS.includes(k));
  if (unknownKey !== undefined) fail(where, `capacidad desconocida "${unknownKey}"`);
  const caps: EntityCapabilities = {};
  if (raw.colorModes !== undefined) {
    if (!Array.isArray(raw.colorModes) || raw.colorModes.length === 0) fail(where, '"capabilities.colorModes" debe ser una lista no vacía');
    caps.colorModes = raw.colorModes.map((m) => oneOf(m, COLOR_MODES, 'capabilities.colorModes', where));
  }
  for (const key of CAPABILITY_NUMBERS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(where, `"capabilities.${key}" debe ser un número no negativo`);
    caps[key] = v;
  }
  for (const key of CAPABILITY_LISTS) {
    if (raw[key] !== undefined) caps[key] = stringList(raw[key], key, where);
  }
  if (caps.minKelvin !== undefined && caps.maxKelvin !== undefined && caps.minKelvin > caps.maxKelvin) {
    fail(where, '"capabilities.minKelvin" no puede ser mayor que maxKelvin');
  }
  if (caps.minTemp !== undefined && caps.maxTemp !== undefined && caps.minTemp > caps.maxTemp) {
    fail(where, '"capabilities.minTemp" no puede ser mayor que maxTemp');
  }
  return caps;
}

function parseEntity(raw: unknown, where: string): EntityDefinition {
  if (!isObj(raw)) fail(where, 'cada entidad debe ser un objeto');
  const key = reqString(raw, 'key', where);
  if (!/^[a-z0-9_]+$/.test(key)) fail(where, `la clave de entidad "${key}" solo admite a-z, 0-9 y _`);
  const initialState = raw.initialState;
  if (!isStateValue(initialState)) fail(where, `la entidad "${key}" necesita un estado inicial válido`);
  const entity: EntityDefinition = {
    key,
    domain: oneOf(raw.domain, ENTITY_DOMAINS, 'domain', where),
    name: reqString(raw, 'name', where),
    initialState,
  };
  const deviceClass = optString(raw, 'deviceClass', where);
  const unit = optString(raw, 'unit', where);
  if (deviceClass !== undefined) entity.deviceClass = deviceClass;
  if (unit !== undefined) entity.unit = unit;
  if (raw.capabilities !== undefined) entity.capabilities = parseCapabilities(raw.capabilities, `${where}, entidad "${key}"`);
  return entity;
}

function parseEntities(raw: unknown, where: string): EntityDefinition[] {
  if (!Array.isArray(raw)) fail(where, '"entities" debe ser una lista');
  const entities = raw.map((e) => parseEntity(e, where));
  const keys = new Set<string>();
  for (const e of entities) {
    if (keys.has(e.key)) fail(where, `clave de entidad repetida "${e.key}"`);
    keys.add(e.key);
  }
  return entities;
}

/** Valida una definición suelta del catálogo. Lanza Error en español si no encaja. */
export function parseDefinition(raw: unknown, index = 0): DeviceDefinition {
  const where0 = `posición ${index}`;
  if (!isObj(raw)) fail(where0, 'cada definición debe ser un objeto');
  const id = reqString(raw, 'id', where0);
  const where = `"${id}"`;
  const def: DeviceDefinition = {
    id,
    brand: oneOf(raw.brand, BRANDS, 'brand', where),
    model: reqString(raw, 'model', where),
    name: reqString(raw, 'name', where),
    category: oneOf(raw.category, CATEGORIES, 'category', where),
    protocols: listOf(raw, 'protocols', PROTOCOLS, where),
    integrations: listOf(raw, 'integrations', INTEGRATIONS, where),
    iotClass: oneOf(raw.iotClass, IOT_CLASSES, 'iotClass', where),
    role: oneOf(raw.role, ROLES, 'role', where),
    power: oneOf(raw.power, POWER_SOURCES, 'power', where),
    entities: parseEntities(raw.entities, where),
  };
  if (raw.requiresHub !== undefined) def.requiresHub = oneOf(raw.requiresHub, BRANDS, 'requiresHub', where);
  if (raw.rangeMeters !== undefined) {
    const r = raw.rangeMeters;
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) fail(where, '"rangeMeters" debe ser un número positivo');
    def.rangeMeters = r;
  }
  const icon = optString(raw, 'icon', where);
  if (icon !== undefined) def.icon = icon;
  return def;
}

/** Valida la lista completa (ids únicos incluidos). */
export function parseCatalog(raw: unknown): DeviceDefinition[] {
  if (!Array.isArray(raw)) throw new Error('Catálogo de dispositivos inválido: se esperaba una lista');
  const defs = raw.map((item, i) => parseDefinition(item, i));
  const ids = new Set<Id>();
  for (const d of defs) {
    if (ids.has(d.id)) throw new Error(`Catálogo de dispositivos inválido: id repetido "${d.id}"`);
    ids.add(d.id);
  }
  return defs;
}

export const catalog: DeviceDefinition[] = parseCatalog(rawDevices as unknown);

export function getDefinition(id: Id, defs: DeviceDefinition[] = catalog): DeviceDefinition | undefined {
  return defs.find((d) => d.id === id);
}

export interface CatalogFilter {
  query?: string;
  brands?: Brand[];
  protocols?: Protocol[];
  categories?: DeviceCategory[];
  connectivity?: 'all' | 'local' | 'cloud';
}

export function isCloud(iot: IotClass): boolean {
  return iot === 'cloud_push' || iot === 'cloud_polling';
}

function matchesQuery(def: DeviceDefinition, query: string): boolean {
  const haystack = foldText([def.name, def.model, def.brand, def.id, def.category].join(' '));
  return foldText(query)
    .split(/\s+/)
    .filter((w) => w !== '')
    .every((word) => haystack.includes(word));
}

function matchesFilter(def: DeviceDefinition, f: CatalogFilter): boolean {
  if (f.query && !matchesQuery(def, f.query)) return false;
  if (f.brands?.length && !f.brands.includes(def.brand)) return false;
  if (f.categories?.length && !f.categories.includes(def.category)) return false;
  if (f.protocols?.length && !def.protocols.some((p) => f.protocols?.includes(p))) return false;
  if (f.connectivity === 'cloud' && !isCloud(def.iotClass)) return false;
  if (f.connectivity === 'local' && isCloud(def.iotClass)) return false;
  return true;
}

export function filterCatalog(defs: DeviceDefinition[], filter: CatalogFilter): DeviceDefinition[] {
  return defs.filter((d) => matchesFilter(d, filter));
}
