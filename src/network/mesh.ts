// Análisis de alcanzabilidad de la red (BFS desde la infraestructura).
import type { Device, DeviceDefinition, Id, Project } from '../types';
import { isBleProxy, isInfra } from '../devices/roles';
import { canConnect, isWiredLink } from './connections';
import { isInRangeWithWalls } from './walls';
import { allDefinitions } from '../devices/catalog';

export interface MeshAnalysis {
  reachable: Set<Id>;
  unreachable: Id[];
  /** Saltos desde la raíz más cercana (las raíces tienen 0). */
  hops: Record<Id, number>;
}

function canRelay(def: DeviceDefinition, child: Device): boolean {
  if (isInfra(def) || def.role === 'router') return true;
  return child.protocol === 'ble' && isBleProxy(def);
}

function connected(project: Project, a: Id, b: Id): boolean {
  return project.connections.some(
    (c) => (c.sourceId === a && c.targetId === b) || (c.sourceId === b && c.targetId === a),
  );
}

/** ¿Hay enlace utilizable entre a y b? Radio: a alcance. Cable: debe existir la conexión. */
function linked(project: Project, defs: DeviceDefinition[], a: Device, b: Device): boolean {
  const r = canConnect(a, b, defs);
  if (!r.ok) return false;
  if (isWiredLink(a, b, defs, r.protocol)) return connected(project, a.id, b.id);
  // Fase 3 (B21): con paredes en la planta se usa el modelo de atenuación.
  return isInRangeWithWalls(a, b, defs, project, r.protocol);
}

/**
 * BFS desde coordinadores, hubs, border routers, puntos de acceso y servidor HA.
 * Solo propagan la señal la infraestructura, los routers de malla y los proxies BLE.
 */
export function analyzeMesh(project: Project, defs: DeviceDefinition[]): MeshAnalysis {
  defs = allDefinitions(project, defs);
  const defOf = new Map<Id, DeviceDefinition>();
  for (const d of project.devices) {
    const def = defs.find((x) => x.id === d.definitionId);
    if (def) defOf.set(d.id, def);
  }
  const hops: Record<Id, number> = {};
  const queue: Device[] = [];
  for (const d of project.devices) {
    const def = defOf.get(d.id);
    if (def && isInfra(def)) {
      hops[d.id] = 0;
      queue.push(d);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const cdef = current ? defOf.get(current.id) : undefined;
    if (!current || !cdef) continue;
    const depth = hops[current.id] ?? 0;
    for (const other of project.devices) {
      if (hops[other.id] !== undefined || !defOf.has(other.id)) continue;
      if (!canRelay(cdef, other) || !linked(project, defs, current, other)) continue;
      hops[other.id] = depth + 1;
      queue.push(other);
    }
  }
  const reachable = new Set(Object.keys(hops));
  const unreachable = project.devices.filter((d) => !reachable.has(d.id)).map((d) => d.id);
  return { reachable, unreachable, hops };
}
