// Entidades de Home Assistant generadas a partir de los dispositivos del proyecto.
import type { Device, DeviceDefinition, EntityDefinition, EntityState, EntityStateValue, Project } from '../types';
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

function initialAttributes(entity: DeviceEntity): Record<string, EntityStateValue> {
  const attrs: Record<string, EntityStateValue> = { friendly_name: entity.friendlyName };
  const { unit, deviceClass, domain } = entity.definition;
  if (unit !== undefined) attrs.unit_of_measurement = unit;
  if (deviceClass !== undefined) attrs.device_class = deviceClass;
  if (domain === 'climate') attrs.temperature = 21;
  if (domain === 'media_player') attrs.volume_level = 0.3;
  return attrs;
}

/** Estado inicial de todas las entidades del proyecto (entity_id -> estado). */
export function initialEntityStates(project: Project, defs: DeviceDefinition[]): Record<string, EntityState> {
  const states: Record<string, EntityState> = {};
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    for (const entity of entitiesForDevice(device, def)) {
      states[entity.entityId] = { state: entity.definition.initialState, attributes: initialAttributes(entity) };
    }
  }
  return states;
}

/** Dominio de un entity_id ("light.salon" -> "light"). */
export function entityDomain(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot === -1 ? '' : entityId.slice(0, dot);
}
