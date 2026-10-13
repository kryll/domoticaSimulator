// Dispositivos personalizados en el proyecto (funciones puras sobre Project).
import type { DeviceDefinition, EntityDefinition, EntityStateValue, Project } from '../types';
import { CUSTOM_PREFIX, catalog, isCustomDefinitionId } from '../devices/catalog';
import { foldText } from '../devices/text';

/** Definición en blanco para «+ Dispositivo personalizado». */
export function blankDefinition(): DeviceDefinition {
  return {
    id: `${CUSTOM_PREFIX}nuevo`,
    brand: 'Tuya',
    model: '',
    name: '',
    category: 'switch',
    protocols: ['wifi'],
    integrations: ['tuya'],
    iotClass: 'cloud_polling',
    role: 'end_device',
    power: 'mains',
    entities: [{ key: 'switch', domain: 'switch', name: 'Interruptor', initialState: 'off' }],
  };
}

/** Id «custom:<marca>-<modelo>» que no choca con el catálogo ni con otras personalizadas. */
export function customIdFor(def: Pick<DeviceDefinition, 'brand' | 'model' | 'name' | 'id'>, project: Pick<Project, 'customDefinitions'>): string {
  const slug = foldText(`${def.brand} ${def.model || def.name}`).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dispositivo';
  const taken = new Set([...catalog.map((d) => d.id), ...(project.customDefinitions ?? []).filter((d) => d.id !== def.id).map((d) => d.id)]);
  let id = `${CUSTOM_PREFIX}${slug}`;
  for (let i = 2; taken.has(id); i++) id = `${CUSTOM_PREFIX}${slug}-${i}`;
  return id;
}

/** Añade o sustituye una definición personalizada. */
export function saveCustomDefinition(project: Project, def: DeviceDefinition, replaceId?: string): Project {
  const list = project.customDefinitions ?? [];
  const exists = replaceId !== undefined && list.some((d) => d.id === replaceId);
  const customDefinitions = exists ? list.map((d) => (d.id === replaceId ? def : d)) : [...list, def];
  // Si cambia el id, los dispositivos que la usan siguen apuntando a ella.
  const devices =
    exists && replaceId !== def.id ? project.devices.map((d) => (d.definitionId === replaceId ? { ...d, definitionId: def.id } : d)) : project.devices;
  return { ...project, customDefinitions, devices };
}

export function removeCustomDefinition(project: Project, id: string): Project {
  return { ...project, customDefinitions: (project.customDefinitions ?? []).filter((d) => d.id !== id) };
}

/** Dispositivos del plano que usan esa definición. */
export function definitionInUse(project: Project, id: string): number {
  return project.devices.filter((d) => d.definitionId === id).length;
}

export function isCustom(def: DeviceDefinition): boolean {
  return isCustomDefinitionId(def.id);
}

/** Texto del estado inicial → valor (números y on/off/true/false como en HA). */
export function parseInitialState(text: string): EntityStateValue {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t.replace(',', '.')))) return Number(t.replace(',', '.'));
  return t;
}

/** Estado inicial típico de cada dominio. */
export const DOMAIN_INITIAL: Record<string, EntityStateValue> = {
  light: 'off',
  switch: 'off',
  fan: 'off',
  siren: 'off',
  sensor: 0,
  binary_sensor: 'off',
  climate: 'off',
  cover: 'closed',
  lock: 'locked',
  camera: 'idle',
  media_player: 'off',
  vacuum: 'docked',
  button: 'unknown',
  alarm_control_panel: 'disarmed',
  valve: 'closed',
  select: '',
  assist_satellite: 'idle',
};

export function blankEntity(index: number): EntityDefinition {
  return { key: `entidad_${index + 1}`, domain: 'sensor', name: `Entidad ${index + 1}`, initialState: 0 };
}
