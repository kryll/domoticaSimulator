// Áreas de Home Assistant (salas del proyecto): a qué sala pertenece cada entidad.
import type { Automation, DeviceDefinition, EntityGroup, Id, Project, Room, Scene, Script } from '../types';
import { entitiesForDevice, slugify } from './entities';
import { actionEntityIds, conditionEntityIds, triggerEntityIds } from '../automations/walk';
import { groupEntityId } from '../simulation/logic';

/** Id del área de HA de una sala (slug del nombre). */
export function areaId(room: Pick<Room, 'name'>): string {
  return slugify(room.name);
}

/** entity_id -> id de la sala del dispositivo (solo dispositivos con sala). Incluye los grupos. */
export function entityRoomMap(project: Project, defs: DeviceDefinition[]): Record<string, Id> {
  const map: Record<string, Id> = {};
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def || !device.roomId || !project.rooms.some((r) => r.id === device.roomId)) continue;
    for (const e of entitiesForDevice(device, def)) map[e.entityId] = device.roomId;
  }
  for (const g of project.groups ?? []) {
    const room = majorityRoom(g.entityIds, map, project.rooms);
    if (room) map[groupEntityId(g)] = room;
  }
  return map;
}

/** Sala con más entidades de la lista (empate: la primera en el orden del proyecto). */
export function majorityRoom(entityIds: readonly string[], map: Record<string, Id>, rooms: Room[]): Id | undefined {
  const counts = new Map<Id, number>();
  for (const id of entityIds) {
    const room = map[id];
    if (room !== undefined) counts.set(room, (counts.get(room) ?? 0) + 1);
  }
  let best: Id | undefined;
  let bestCount = 0;
  for (const r of rooms) {
    const c = counts.get(r.id) ?? 0;
    if (c > bestCount) {
      best = r.id;
      bestCount = c;
    }
  }
  return best;
}

export function automationEntityIds(a: Automation): string[] {
  return [...a.triggers.flatMap(triggerEntityIds), ...a.conditions.flatMap(conditionEntityIds), ...actionEntityIds(a.actions)];
}

/** Sala de una automatización: la de la mayoría de sus acciones; si no, la de sus disparadores y condiciones. */
export function automationRoom(a: Automation, map: Record<string, Id>, rooms: Room[]): Id | undefined {
  return majorityRoom(actionEntityIds(a.actions), map, rooms) ?? majorityRoom(automationEntityIds(a), map, rooms);
}

export function sceneRoom(s: Scene, map: Record<string, Id>, rooms: Room[]): Id | undefined {
  return majorityRoom(Object.keys(s.entities), map, rooms);
}

export function scriptRoom(s: Script, map: Record<string, Id>, rooms: Room[]): Id | undefined {
  return majorityRoom(actionEntityIds(s.sequence), map, rooms);
}

export function groupRoom(g: EntityGroup, map: Record<string, Id>, rooms: Room[]): Id | undefined {
  return majorityRoom(g.entityIds, map, rooms);
}
