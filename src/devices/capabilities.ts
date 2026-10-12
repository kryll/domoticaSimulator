// Capacidades efectivas de una entidad: las del catálogo con valores por defecto por dominio.
import type { Device, DeviceDefinition, EntityCapabilities, Project } from '../types';
import { allDefinitions } from './catalog';
import { entitiesForDevice, entityDomain, type DeviceEntity } from './entities';

export const DEFAULT_MOTION_TIMEOUT_SECONDS = 60;
export const DEFAULT_TRAVEL_SECONDS = 20;
export const DEFAULT_MIN_KELVIN = 2000;
export const DEFAULT_MAX_KELVIN = 6500;
export const DEFAULT_MIN_TEMP = 7;
export const DEFAULT_MAX_TEMP = 35;
export const DEFAULT_TEMP_STEP = 0.5;
export const DEFAULT_HVAC_MODES = ['off', 'heat'];

/** Capacidades con los valores por defecto del dominio rellenos. */
export function withDefaults(domain: string, caps: EntityCapabilities = {}): EntityCapabilities {
  switch (domain) {
    case 'light':
      return { colorModes: ['brightness'], minKelvin: DEFAULT_MIN_KELVIN, maxKelvin: DEFAULT_MAX_KELVIN, ...caps };
    case 'climate':
      return { hvacModes: DEFAULT_HVAC_MODES, minTemp: DEFAULT_MIN_TEMP, maxTemp: DEFAULT_MAX_TEMP, tempStep: DEFAULT_TEMP_STEP, ...caps };
    case 'cover':
      return { travelSeconds: DEFAULT_TRAVEL_SECONDS, ...caps };
    case 'binary_sensor':
      return { motionTimeoutSeconds: DEFAULT_MOTION_TIMEOUT_SECONDS, ...caps };
    case 'alarm_control_panel':
      return { alarmModes: ['armed_home', 'armed_away', 'armed_night'], ...caps };
    default:
      return { ...caps };
  }
}

/** ¿La luz admite regulación de brillo? (cualquier modo salvo onoff). */
export function isDimmable(caps: EntityCapabilities): boolean {
  return (caps.colorModes ?? []).some((m) => m !== 'onoff');
}

export interface EntityOwner {
  device: Device;
  def: DeviceDefinition;
  entity: DeviceEntity;
}

/** Dispositivo, definición y entidad a la que pertenece un entity_id del proyecto. */
export function findEntityOwner(project: Pick<Project, 'devices' | 'customDefinitions'>, entityId: string, defs: DeviceDefinition[] = allDefinitions(project)): EntityOwner | undefined {
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    const entity = entitiesForDevice(device, def).find((e) => e.entityId === entityId);
    if (entity) return { device, def, entity };
  }
  return undefined;
}

/** Capacidades efectivas de una entidad del proyecto (por defecto las del dominio). */
export function entityCapabilities(project: Pick<Project, 'devices' | 'customDefinitions'>, entityId: string, defs: DeviceDefinition[] = allDefinitions(project)): EntityCapabilities {
  return withDefaults(entityDomain(entityId), findEntityOwner(project, entityId, defs)?.entity.definition.capabilities);
}
