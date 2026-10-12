// «Mostrar como luz» (B19): cambia Device.showAs y actualiza las referencias a la entidad.
import type { Device, Id, Project } from '../../types';
import { catalog, getDefinition } from '../../devices/catalog';
import { entitiesForDevice } from '../../devices/entities';
import { renameEntityRefs } from '../../devices/renaming';

/** Proyecto con el relé mostrado como luz (o como interruptor) y automatizaciones, escenas y grupos al día. */
export function setShowAs(project: Project, deviceId: Id, showAs: Device['showAs']): Project {
  const device = project.devices.find((d) => d.id === deviceId);
  const def = device ? getDefinition(device.definitionId, catalog) : undefined;
  if (!device || !def || (device.showAs ?? undefined) === showAs) return project;
  const next: Device = { ...device };
  if (showAs) next.showAs = showAs;
  else delete next.showAs;
  const before = entitiesForDevice(device, def);
  const after = entitiesForDevice(next, def);
  const mapping: Record<string, string> = {};
  before.forEach((e, i) => {
    const to = after[i]?.entityId;
    if (to && to !== e.entityId) mapping[e.entityId] = to;
  });
  const updated = { ...project, devices: project.devices.map((d) => (d.id === deviceId ? next : d)) };
  if (Object.keys(mapping).length === 0) return updated;
  const renamed = renameEntityRefs(updated, mapping);
  // Los grupos también referencian entidades.
  if (!renamed.groups) return renamed;
  return { ...renamed, groups: renamed.groups.map((g) => ({ ...g, entityIds: g.entityIds.map((id) => mapping[id] ?? id) })) };
}
