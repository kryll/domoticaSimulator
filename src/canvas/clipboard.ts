// Selección múltiple: copiar, pegar, duplicar, mover, asignar sala y borrar varios dispositivos.
// Funciones puras e inmutables (sin React ni stores); la interfaz está en selectionActions.ts.
import type { Connection, Device, DeviceDefinition, Id, Point, Project } from '../types';
import { catalog } from '../devices/catalog';
import { entityIdsForDevice } from '../devices/entities';
import { uniqueDeviceName } from '../devices/factory';
import { collectEntityRefs } from '../devices/renaming';
import { parseConnection, parseDevice } from '../store/projectSchema';
import { resolveRoomId } from './geometry';

/** Contenido del portapapeles: dispositivos y las conexiones entre ellos. */
export interface ClipboardPayload {
  version: 1;
  devices: Device[];
  /** Solo las conexiones internas (con los dos extremos entre los dispositivos copiados). */
  connections: Connection[];
  /** Planta de origen ('' si no hay dispositivos). */
  sourceFloorId: Id;
}

/** Marca del texto del portapapeles para reconocer lo que copia el simulador. */
export const CLIPBOARD_TYPE = 'ha-simulator/devices';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Dispositivos del proyecto con esos ids, en el orden del proyecto. */
function pick(project: Project, ids: readonly Id[]): Device[] {
  const set = new Set(ids);
  return project.devices.filter((d) => set.has(d.id));
}

/** Copia los dispositivos y sus conexiones internas (copia profunda, no comparte objetos con el proyecto). */
export function copyDevices(project: Project, deviceIds: readonly Id[]): ClipboardPayload {
  const devices = pick(project, deviceIds);
  const set = new Set(devices.map((d) => d.id));
  const connections = project.connections.filter((c) => set.has(c.sourceId) && set.has(c.targetId));
  return { version: 1, devices: clone(devices), connections: clone(connections), sourceFloorId: devices[0]?.floorId ?? '' };
}

/** Sala de un dispositivo en `position` de la planta: la que lo contiene; si no, su sala manual de esa planta. */
function roomFor(project: Project, floorId: Id, position: Point, current: Id | undefined): Id | undefined {
  const roomId = resolveRoomId(project.rooms, floorId, position, current);
  if (roomId === undefined) return undefined;
  return project.rooms.find((r) => r.id === roomId)?.floorId === floorId ? roomId : undefined;
}

/**
 * Clona dispositivos en el proyecto con ids y nombres nuevos (únicos), la planta y la posición
 * que da `place`, la sala según esa posición y las conexiones internas remapeadas.
 */
function cloneInto(
  project: Project,
  devices: readonly Device[],
  connections: readonly Connection[],
  defs: readonly DeviceDefinition[],
  place: (d: Device) => { floorId: Id; position: Point },
): { project: Project; newIds: Id[] } {
  const known = new Set(defs.map((d) => d.id));
  const names: string[] = project.devices.map((d) => d.name);
  const idMap = new Map<Id, Id>();
  const created: Device[] = [];
  for (const original of devices) {
    // Sin definición en el catálogo no se puede simular: se omite.
    if (!known.has(original.definitionId)) continue;
    const { floorId, position } = place(original);
    if (!project.floors.some((f) => f.id === floorId)) continue;
    const name = uniqueDeviceName(original.name, names);
    names.push(name);
    const copy: Device = { ...clone(original), id: crypto.randomUUID(), name, floorId, position: { x: position.x, y: position.y } };
    const roomId = roomFor(project, floorId, position, original.roomId);
    if (roomId === undefined) delete copy.roomId;
    else copy.roomId = roomId;
    idMap.set(original.id, copy.id);
    created.push(copy);
  }
  if (created.length === 0) return { project, newIds: [] };
  const newConnections: Connection[] = [];
  for (const c of connections) {
    const sourceId = idMap.get(c.sourceId);
    const targetId = idMap.get(c.targetId);
    if (sourceId !== undefined && targetId !== undefined) newConnections.push({ ...c, id: crypto.randomUUID(), sourceId, targetId });
  }
  return {
    project: { ...project, devices: [...project.devices, ...created], connections: [...project.connections, ...newConnections] },
    newIds: created.map((d) => d.id),
  };
}

export interface PasteOptions {
  /** Planta de destino. */
  floorId: Id;
  /** Desplazamiento respecto a la posición original. */
  offset: Point;
  defs: readonly DeviceDefinition[];
}

/** Pega el portapapeles en la planta indicada, desplazado `offset`. */
export function pasteDevices(project: Project, payload: ClipboardPayload, opts: PasteOptions): { project: Project; newIds: Id[] } {
  return cloneInto(project, payload.devices, payload.connections, opts.defs, (d) => ({
    floorId: opts.floorId,
    position: { x: d.position.x + opts.offset.x, y: d.position.y + opts.offset.y },
  }));
}

/** Desplazamiento por defecto de un duplicado respecto al original. */
export const DUPLICATE_OFFSET: Point = { x: 40, y: 40 };

export interface DuplicateOptions {
  defs: readonly DeviceDefinition[];
  offset?: Point;
}

/**
 * Duplica los dispositivos en su misma planta, desplazados (por defecto 40 px), con sus
 * conexiones internas. Acepta el catálogo directamente o { defs, offset }.
 */
export function duplicateDevices(
  project: Project,
  ids: readonly Id[],
  defsOrOpts: readonly DeviceDefinition[] | DuplicateOptions,
): { project: Project; newIds: Id[] } {
  const opts: DuplicateOptions = isDefsList(defsOrOpts) ? { defs: defsOrOpts } : defsOrOpts;
  const offset = opts.offset ?? DUPLICATE_OFFSET;
  const payload = copyDevices(project, ids);
  return cloneInto(project, payload.devices, payload.connections, opts.defs, (d) => ({
    floorId: d.floorId,
    position: { x: d.position.x + offset.x, y: d.position.y + offset.y },
  }));
}

function isDefsList(v: readonly DeviceDefinition[] | DuplicateOptions): v is readonly DeviceDefinition[] {
  return Array.isArray(v);
}

/** Mueve los dispositivos `delta` y recalcula su sala según la nueva posición. */
export function moveDevices(project: Project, ids: readonly Id[], delta: Point): Project {
  if (ids.length === 0 || (delta.x === 0 && delta.y === 0)) return project;
  const set = new Set(ids);
  let changed = false;
  const devices = project.devices.map((d) => {
    if (!set.has(d.id)) return d;
    changed = true;
    const position = { x: d.position.x + delta.x, y: d.position.y + delta.y };
    const next: Device = { ...d, position };
    const roomId = roomFor(project, d.floorId, position, d.roomId);
    if (roomId === undefined) delete next.roomId;
    else next.roomId = roomId;
    return next;
  });
  return changed ? { ...project, devices } : project;
}

/**
 * Asigna la sala a los dispositivos (undefined: sin sala). Solo a los de la misma planta que la
 * sala; los de otras plantas no cambian.
 */
export function assignRoom(project: Project, ids: readonly Id[], roomId: Id | undefined): Project {
  const room = roomId === undefined ? undefined : project.rooms.find((r) => r.id === roomId);
  if (roomId !== undefined && !room) return project;
  const set = new Set(ids);
  let changed = false;
  const devices = project.devices.map((d) => {
    if (!set.has(d.id) || d.roomId === roomId || (room && room.floorId !== d.floorId)) return d;
    changed = true;
    const next: Device = { ...d };
    if (roomId === undefined) delete next.roomId;
    else next.roomId = roomId;
    return next;
  });
  return changed ? { ...project, devices } : project;
}

// ---------- Referencias ----------

export type ReferenceKind = 'automation' | 'scene' | 'script' | 'group';

/** Elemento del proyecto que usa entidades de los dispositivos. */
export interface DeviceReference {
  kind: ReferenceKind;
  id: Id;
  name: string;
  /** entity_id de los dispositivos que usa. */
  entityIds: string[];
}

const KIND_LABEL: Record<ReferenceKind, string> = {
  automation: 'Automatización',
  scene: 'Escena',
  script: 'Script',
  group: 'Grupo',
};

/** Automatizaciones, escenas, scripts y grupos que usan entidades de esos dispositivos. */
export function deviceReferences(project: Project, deviceIds: readonly Id[], defs: readonly DeviceDefinition[] = catalog): DeviceReference[] {
  const entities = new Set<string>();
  for (const d of pick(project, deviceIds)) {
    const def = defs.find((x) => x.id === d.definitionId);
    if (def) for (const id of entityIdsForDevice(d, def)) entities.add(id);
  }
  if (entities.size === 0) return [];
  const byOwner = new Map<string, DeviceReference>();
  const add = (kind: ReferenceKind, id: Id, name: string, entityId: string): void => {
    if (!entities.has(entityId)) return;
    const key = `${kind}:${id}`;
    const ref = byOwner.get(key) ?? { kind, id, name, entityIds: [] };
    if (!ref.entityIds.includes(entityId)) ref.entityIds.push(entityId);
    byOwner.set(key, ref);
  };
  for (const r of collectEntityRefs(project)) add(r.kind, r.ownerId, r.ownerName, r.entityId);
  for (const g of project.groups ?? []) for (const id of g.entityIds) add('group', g.id, g.name, id);
  return [...byOwner.values()];
}

/**
 * Líneas para el diálogo de confirmación al borrar: «Automatización «Luz al entrar» (light.salon)».
 * Vacío si nada usa esos dispositivos.
 */
export function referencesTo(project: Project, deviceIds: readonly Id[], defs: readonly DeviceDefinition[] = catalog): string[] {
  return deviceReferences(project, deviceIds, defs).map((r) => `${KIND_LABEL[r.kind]} «${r.name}» (${r.entityIds.join(', ')})`);
}

/**
 * Borra los dispositivos y sus conexiones. Las automatizaciones, escenas, scripts y grupos que
 * los usan no se tocan (se puede deshacer); quedan como avisos (y el validador las marcará).
 */
export function removeDevicesDetailed(
  project: Project,
  ids: readonly Id[],
  defs: readonly DeviceDefinition[] = catalog,
): { project: Project; warnings: string[] } {
  const set = new Set(pick(project, ids).map((d) => d.id));
  if (set.size === 0) return { project, warnings: [] };
  const warnings = referencesTo(project, [...set], defs).map((line) => `${line} usa un dispositivo eliminado`);
  return {
    project: {
      ...project,
      devices: project.devices.filter((d) => !set.has(d.id)),
      connections: project.connections.filter((c) => !set.has(c.sourceId) && !set.has(c.targetId)),
    },
    warnings,
  };
}

/** Como removeDevicesDetailed, solo el proyecto (para usar en projectStore.update). */
export function removeDevices(project: Project, ids: readonly Id[]): Project {
  return removeDevicesDetailed(project, ids).project;
}

// ---------- Texto del portapapeles ----------

export function serializeClipboard(payload: ClipboardPayload): string {
  return JSON.stringify({ type: CLIPBOARD_TYPE, ...payload });
}

/** Lee el texto del portapapeles; null si no es del simulador o no es válido. */
export function parseClipboard(text: string): ClipboardPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== CLIPBOARD_TYPE || o.version !== 1 || !Array.isArray(o.devices) || !Array.isArray(o.connections)) return null;
  try {
    const devices = o.devices.map((d, i) => parseDevice(d, `devices[${i}]`));
    const ids = new Set(devices.map((d) => d.id));
    if (ids.size !== devices.length) return null;
    const connections = o.connections
      .map((c, i) => parseConnection(c, `connections[${i}]`))
      .filter((c) => ids.has(c.sourceId) && ids.has(c.targetId));
    const sourceFloorId = typeof o.sourceFloorId === 'string' ? o.sourceFloorId : (devices[0]?.floorId ?? '');
    return { version: 1, devices, connections, sourceFloorId };
  } catch {
    return null;
  }
}
