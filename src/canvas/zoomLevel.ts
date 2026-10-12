// Zoom semántico y capa «Conexiones» (lógica pura).
import type { Connection, Id, Project } from '../types';
import type { ConnectionsLayer } from '../store/viewStore';
import type { SelectionKind } from '../store/uiStore';

/** Por debajo de este zoom los nodos se ven compactos (icono + estado). */
export const COMPACT_ZOOM = 0.6;
export const COMPACT_CLASS = 'ha-zoom-compact';

/** ¿El zoom actual pide nodos compactos? */
export function isCompactZoom(zoom: number): boolean {
  return zoom < COMPACT_ZOOM;
}

/** Ids cuyas conexiones se ven con la capa «Solo del seleccionado». */
export function selectedConnectionScope(selection: { ids: ReadonlySet<string>; kind: SelectionKind | null }): Set<Id> {
  if (selection.kind === 'device' || selection.kind === 'connection') return new Set(selection.ids);
  return new Set();
}

/** Conexiones de la planta que se dibujan según la capa «Conexiones». */
export function visibleConnections(
  project: Pick<Project, 'devices' | 'connections'>,
  floorId: Id,
  layer: ConnectionsLayer,
  selection: { ids: ReadonlySet<string>; kind: SelectionKind | null },
): Connection[] {
  if (layer === 'none') return [];
  const onFloor = new Set(project.devices.filter((d) => d.floorId === floorId).map((d) => d.id));
  const focus = layer === 'selected' ? selectedConnectionScope(selection) : null;
  return project.connections
    .filter((c) => onFloor.has(c.sourceId) && onFloor.has(c.targetId))
    .filter((c) => !focus || focus.has(c.sourceId) || focus.has(c.targetId) || focus.has(c.id));
}
