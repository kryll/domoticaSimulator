// Opciones del selector de entidades: agrupadas por planta y sala, con estado e icono.
import type { EntityState, Project } from '../types';
import { definitionOf, projectEntities } from '../canvas/analysis';
import { deviceIcon, formatNumber } from '../devices/presentation';
import { foldText } from '../devices/text';
import { disambiguate, entityLabel } from './entityLabel';

export interface EntityFilter {
  /** Dominios admitidos (light, sensor...). */
  domains?: readonly string[];
  /** device_class admitidas (motion, door, temperature...). */
  deviceClasses?: readonly string[];
  /** Solo sensores con estado numérico. */
  numericOnly?: boolean;
  /** Lista cerrada de entity_id admitidos (p. ej. candidatas de una plantilla). */
  allowedIds?: readonly string[];
}

export interface EntityOption {
  entityId: string;
  /** «Dispositivo · Entidad». */
  label: string;
  icon: string;
  /** Estado actual legible («on», «21,5 °C»…). */
  stateText: string;
  domain: string;
  deviceClass?: string;
  deviceId: string;
  /** Texto normalizado para la búsqueda. */
  search: string;
}

export interface EntityGroup {
  /** «Planta baja · Salón». */
  label: string;
  options: EntityOption[];
}

export const NO_ROOM = 'Sin sala';

export function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
}

/** Texto del estado de una entidad para mostrar junto a su nombre. */
export function formatEntityState(st: EntityState | undefined, unit?: string): string {
  if (!st) return '—';
  const v = st.state;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return `${formatNumber(v)}${unit ? ` ${unit}` : ''}`;
  if (isNumericValue(v)) return `${formatNumber(Number(v))}${unit ? ` ${unit}` : ''}`;
  return v;
}

/** Construye los grupos de opciones del selector, ordenados por planta (nivel) y sala. */
export function entityGroups(
  project: Project,
  states: Record<string, EntityState>,
  filter: EntityFilter = {},
): EntityGroup[] {
  const rooms = new Map(project.rooms.map((r) => [r.id, r.name]));
  const floors = new Map(project.floors.map((f) => [f.id, f]));
  const multiFloor = project.floors.length > 1;
  const all = projectEntities(project);
  const perDevice = new Map<string, number>();
  for (const ref of all) perDevice.set(ref.device.id, (perDevice.get(ref.device.id) ?? 0) + 1);

  interface Item extends EntityOption {
    group: string;
    floorLevel: number;
    roomName: string;
  }
  const items: Item[] = [];
  for (const ref of all) {
    const def = ref.definition;
    if (filter.allowedIds && !filter.allowedIds.includes(ref.entityId)) continue;
    if (filter.domains && !filter.domains.includes(def.domain)) continue;
    if (filter.deviceClasses && (!def.deviceClass || !filter.deviceClasses.includes(def.deviceClass))) continue;
    const st = states[ref.entityId];
    if (filter.numericOnly) {
      const value = st?.state ?? def.initialState;
      if (def.domain !== 'sensor' || !isNumericValue(value)) continue;
    }
    const floor = floors.get(ref.device.floorId);
    const roomName = (ref.device.roomId && rooms.get(ref.device.roomId)) || NO_ROOM;
    const group = multiFloor && floor ? `${floor.name} · ${roomName}` : roomName;
    const label = entityLabel(ref.device.name, def.name, perDevice.get(ref.device.id) === 1);
    const deviceDef = definitionOf(ref.device);
    items.push({
      entityId: ref.entityId,
      label,
      icon: deviceDef ? deviceIcon(deviceDef, def.deviceClass) : '❔',
      stateText: formatEntityState(st, def.unit),
      domain: def.domain,
      ...(def.deviceClass ? { deviceClass: def.deviceClass } : {}),
      deviceId: ref.device.id,
      search: '',
      group,
      floorLevel: floor?.level ?? 0,
      roomName,
    });
  }
  const order = new Map<string, [number, string]>();
  const map = new Map<string, EntityOption[]>();
  for (const item of disambiguate(items)) {
    const { group, floorLevel, roomName, ...option } = item;
    option.search = foldText(`${option.label} ${option.entityId} ${group}`);
    const list = map.get(group) ?? [];
    list.push(option);
    map.set(group, list);
    order.set(group, [floorLevel, roomName]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      const [la, ra] = order.get(a) ?? [0, a];
      const [lb, rb] = order.get(b) ?? [0, b];
      if (la !== lb) return la - lb;
      if (ra === NO_ROOM && rb !== NO_ROOM) return 1;
      if (rb === NO_ROOM && ra !== NO_ROOM) return -1;
      return ra.localeCompare(rb, 'es');
    })
    .map(([label, options]) => ({ label, options }));
}

/** Filtra los grupos por texto (sin acentos ni mayúsculas, todas las palabras). */
export function searchGroups(groups: EntityGroup[], query: string): EntityGroup[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((g) => {
      const groupText = foldText(g.label);
      return { ...g, options: g.options.filter((o) => words.every((w) => o.search.includes(w) || groupText.includes(w))) };
    })
    .filter((g) => g.options.length > 0);
}
