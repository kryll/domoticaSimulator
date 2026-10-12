// Relación entidad -> dispositivo para resaltar en el lienzo lo que toca una automatización.
import type { Id, Project } from '../types';
import { projectEntities } from '../canvas/analysis';
import { collectEntityRefs } from '../devices/renaming';

const byProject = new WeakMap<Project, Map<string, Id>>();

/** entity_id -> id del dispositivo, memorizado por proyecto. */
export function entityOwnerMap(project: Project): Map<string, Id> {
  let map = byProject.get(project);
  if (!map) {
    map = new Map(projectEntities(project).map((r) => [r.entityId, r.device.id]));
    byProject.set(project, map);
  }
  return map;
}

/** Dispositivos (sin repetir) dueños de esas entidades. */
export function devicesOfEntities(project: Project, entityIds: Iterable<string>): Id[] {
  const map = entityOwnerMap(project);
  const out = new Set<Id>();
  for (const id of entityIds) {
    const dev = map.get(id);
    if (dev) out.add(dev);
  }
  return [...out];
}

/** Dispositivos que usa una automatización (disparadores, condiciones y acciones). */
export function automationDeviceIds(project: Project, automationId: Id): Id[] {
  const refs = collectEntityRefs(project).filter((r) => r.kind === 'automation' && r.ownerId === automationId);
  return devicesOfEntities(
    project,
    refs.map((r) => r.entityId),
  );
}

/** Selecciona y centra un dispositivo en el lienzo (cambia de planta si hace falta). */
export function revealDevice(project: Project, deviceId: Id, ui: {
  activeFloorId: Id | null;
  setActiveFloor: (id: Id | null) => void;
  select: (s: { kind: 'device'; id: Id } | null) => void;
  focusDevices: (ids: Id[]) => void;
}): void {
  const device = project.devices.find((d) => d.id === deviceId);
  if (!device) return;
  if (ui.activeFloorId !== device.floorId) ui.setActiveFloor(device.floorId);
  ui.select({ kind: 'device', id: deviceId });
  ui.focusDevices([deviceId]);
}
