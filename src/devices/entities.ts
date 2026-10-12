// Entidades de Home Assistant generadas a partir de los dispositivos del proyecto.
import type { Device, DeviceDefinition, EntityDefinition, EntityState, EntityStateValue, Project } from '../types';
import { hvacAction } from './climate';
import { foldText } from './text';

/** Minúsculas, sin acentos, solo a-z0-9_ (como los entity_id de HA). */
export function slugify(name: string): string {
  const slug = foldText(name)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug === '' ? 'dispositivo' : slug;
}

export interface DeviceEntity {
  entityId: string;
  definition: EntityDefinition;
  friendlyName: string;
}

/** Entidades de un dispositivo con su entity_id y nombre amigable. */
export function entitiesForDevice(device: Device, def: DeviceDefinition): DeviceEntity[] {
  const base = slugify(device.name);
  const single = def.entities.length === 1;
  return def.entities.map((e) => ({
    entityId: single ? `${e.domain}.${base}` : `${e.domain}.${base}_${e.key}`,
    definition: e,
    friendlyName: single ? device.name : `${device.name} ${e.name}`,
  }));
}

export function entityIdsForDevice(device: Device, def: DeviceDefinition): string[] {
  return entitiesForDevice(device, def).map((e) => e.entityId);
}

/** Temperatura inicial del sensor de temperatura del mismo dispositivo (para climate). */
function siblingTemperature(siblings: DeviceEntity[]): number | undefined {
  const sensor = siblings.find((e) => e.definition.domain === 'sensor' && e.definition.deviceClass === 'temperature');
  const v = sensor ? Number(sensor.definition.initialState) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

export const INITIAL_TARGET_TEMPERATURE = 21;
export const INITIAL_ROOM_TEMPERATURE = 21.5;
export const INITIAL_KELVIN = 2700;

function initialAttributes(entity: DeviceEntity, siblings: DeviceEntity[]): Record<string, EntityStateValue> {
  const attrs: Record<string, EntityStateValue> = { friendly_name: entity.friendlyName };
  const { unit, deviceClass, domain, capabilities: caps = {}, initialState } = entity.definition;
  if (unit !== undefined) attrs.unit_of_measurement = unit;
  if (deviceClass !== undefined) attrs.device_class = deviceClass;
  if (domain === 'light' && caps.colorModes?.includes('color_temp')) {
    const min = caps.minKelvin ?? 2000;
    const max = caps.maxKelvin ?? 6500;
    attrs.min_color_temp_kelvin = min;
    attrs.max_color_temp_kelvin = max;
    attrs.color_temp_kelvin = Math.max(min, Math.min(max, INITIAL_KELVIN));
  }
  if (domain === 'climate') {
    const current = siblingTemperature(siblings) ?? INITIAL_ROOM_TEMPERATURE;
    attrs.temperature = INITIAL_TARGET_TEMPERATURE;
    attrs.current_temperature = current;
    attrs.hvac_action = hvacAction(String(initialState), current, INITIAL_TARGET_TEMPERATURE);
    if (caps.minTemp !== undefined) attrs.min_temp = caps.minTemp;
    if (caps.maxTemp !== undefined) attrs.max_temp = caps.maxTemp;
    if (caps.tempStep !== undefined) attrs.target_temp_step = caps.tempStep;
  }
  if (domain === 'cover') attrs.current_position = initialState === 'open' ? 100 : 0;
  if (domain === 'media_player') {
    attrs.volume_level = 0.3;
    attrs.is_volume_muted = false;
    const source = caps.sources?.[0];
    if (source !== undefined) attrs.source = source;
  }
  return attrs;
}

/** Estado inicial de todas las entidades del proyecto (entity_id -> estado). */
export function initialEntityStates(project: Project, defs: DeviceDefinition[]): Record<string, EntityState> {
  const states: Record<string, EntityState> = {};
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    const entities = entitiesForDevice(device, def);
    for (const entity of entities) {
      states[entity.entityId] = { state: entity.definition.initialState, attributes: initialAttributes(entity, entities) };
    }
  }
  return states;
}

/** Dominio de un entity_id ("light.salon" -> "light"). */
export function entityDomain(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot === -1 ? '' : entityId.slice(0, dot);
}
