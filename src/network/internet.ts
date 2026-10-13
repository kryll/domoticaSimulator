// Salida a Internet (fibra de la operadora): ¿llega Home Assistant a Internet? Funciones puras.
//
// Sin ningún nodo «Salida a Internet» en el proyecto se mantiene el modelo de siempre: hay Internet
// salvo que se simule su caída, o durante un corte de luz si ningún router tiene SAI. Con una o más
// salidas, Internet solo llega si hay un camino desde el servidor de Home Assistant hasta una salida
// que pase solo por routers y puntos de acceso que funcionen (no caídos y con corriente).
import type { Device, DeviceDefinition, Failures, Id, Project } from '../types';
import { allDefinitions } from '../devices/catalog';
import { isInternetNode } from '../devices/roles';
import { canConnect } from './connections';

interface Placed {
  device: Device;
  def: DeviceDefinition;
}

type InternetProject = Pick<Project, 'devices' | 'connections' | 'customDefinitions'>;

/** Por qué no hay Internet (o null si lo hay). */
export type InternetLoss =
  /** Se ha simulado la caída de Internet («Internet cae»). */
  | 'cut'
  /** Corte de luz y ningún router con SAI (proyectos sin salida a Internet). */
  | 'power'
  /** El router, un punto de acceso intermedio o la salida a Internet han caído o están sin corriente. */
  | 'path';

const MAINS_LIKE = new Set(['mains', 'poe', 'usb']);

/** Equipos por los que pasa el tráfico hacia Internet: routers y puntos de acceso. */
function carries(def: DeviceDefinition): boolean {
  return def.role === 'access_point';
}

function placedOf(project: InternetProject, defs: DeviceDefinition[]): Placed[] {
  const all = allDefinitions(project, defs);
  const result: Placed[] = [];
  for (const device of project.devices) {
    const def = all.find((d) => d.id === device.definitionId);
    if (def) result.push({ device, def });
  }
  return result;
}

/** ¿Tiene el proyecto alguna salida a Internet? */
export function hasInternetNode(project: InternetProject, defs: DeviceDefinition[]): boolean {
  return placedOf(project, defs).some((p) => isInternetNode(p.def));
}

/**
 * Enlaces entre servidor, routers y salidas a Internet: las conexiones dibujadas y, para los que no
 * tienen ninguna, los enlaces compatibles (como en la disponibilidad de los dispositivos).
 */
function uplinkGraph(project: InternetProject, defs: DeviceDefinition[], placed: Placed[]): Map<Id, Set<Id>> {
  const relevant = new Map(placed.filter((p) => p.def.role === 'ha_server' || carries(p.def) || isInternetNode(p.def)).map((p) => [p.device.id, p]));
  const graph = new Map<Id, Set<Id>>();
  const link = (a: Id, b: Id): void => {
    if (a === b || !relevant.has(a) || !relevant.has(b)) return;
    graph.set(a, (graph.get(a) ?? new Set()).add(b));
    graph.set(b, (graph.get(b) ?? new Set()).add(a));
  };
  const all = allDefinitions(project, defs);
  // Las conexiones no válidas (p. ej. la salida enchufada al servidor) no llevan tráfico: las señala el validador.
  for (const c of project.connections) {
    const a = relevant.get(c.sourceId);
    const b = relevant.get(c.targetId);
    if (a && b && canConnect(a.device, b.device, all).ok) link(c.sourceId, c.targetId);
  }
  const explicit = new Set(project.connections.flatMap((c) => [c.sourceId, c.targetId]));
  for (const p of relevant.values()) {
    if (explicit.has(p.device.id)) continue;
    for (const other of relevant.values()) {
      if (other.device.id === p.device.id || !carries(other.def)) continue;
      if (canConnect(p.device, other.device, all).ok) link(p.device.id, other.device.id);
    }
  }
  return graph;
}

/**
 * ¿Hay camino desde el servidor de HA (o, si no hay servidor, desde cualquier router) hasta una
 * salida a Internet sin pasar por ningún equipo de `down`? El propio servidor cuenta como origen
 * aunque esté caído: su estado se trata aparte.
 */
export function internetPathExists(project: InternetProject, defs: DeviceDefinition[], down: ReadonlySet<Id> = new Set()): boolean {
  const placed = placedOf(project, defs);
  const byId = new Map(placed.map((p) => [p.device.id, p]));
  const servers = placed.filter((p) => p.def.role === 'ha_server');
  const starts = (servers.length > 0 ? servers : placed.filter((p) => carries(p.def) && !down.has(p.device.id))).map((p) => p.device.id);
  const graph = uplinkGraph(project, defs, placed);
  const seen = new Set<Id>(starts);
  const queue = [...starts];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === undefined) continue;
    const node = byId.get(id);
    if (node && isInternetNode(node.def)) return true;
    if (node && node.def.role !== 'ha_server' && !carries(node.def)) continue;
    for (const next of graph.get(id) ?? []) {
      if (seen.has(next) || down.has(next)) continue;
      const nextNode = byId.get(next);
      // El tráfico no atraviesa otro servidor de HA.
      if (nextNode?.def.role === 'ha_server') continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Routers, puntos de acceso y salidas a Internet que no funcionan con estos fallos: los caídos
 * (fallo simulado) y, durante un corte de luz, los enchufados sin SAI. La salida a Internet no se
 * queda sin corriente en un corte de casa (la red de la operadora sigue; el que cae es el router).
 */
export function downUplinkDevices(project: InternetProject, defs: DeviceDefinition[], failures: Failures): Set<Id> {
  const down = new Set<Id>();
  for (const p of placedOf(project, defs)) {
    if (!carries(p.def) && !isInternetNode(p.def)) continue;
    if (failures.devicesDown.includes(p.device.id)) down.add(p.device.id);
    else if (failures.powerOutage && !isInternetNode(p.def) && MAINS_LIKE.has(p.def.power) && p.device.ups !== true) down.add(p.device.id);
  }
  return down;
}

/** Modelo de siempre (sin salida a Internet): sin Internet si cae, o con corte de luz y ningún router con SAI. */
function legacyLoss(placed: Placed[], failures: Failures): InternetLoss | null {
  if (!failures.powerOutage) return null;
  return placed.some((p) => p.device.ups === true && p.def.role === 'access_point') ? null : 'power';
}

/**
 * Por qué no hay Internet con estos fallos, o null si lo hay. Con salida a Internet, si sin fallos
 * ya no había camino (problema de diseño: lo señala el validador) se usa el modelo de siempre para
 * no dejar sin Internet un proyecto a medio montar.
 */
export function internetLoss(project: InternetProject, defs: DeviceDefinition[], failures: Failures): InternetLoss | null {
  if (failures.internet) return 'cut';
  const placed = placedOf(project, defs);
  if (!placed.some((p) => isInternetNode(p.def)) || !internetPathExists(project, defs)) return legacyLoss(placed, failures);
  if (!failures.powerOutage && failures.devicesDown.length === 0) return null;
  return internetPathExists(project, defs, downUplinkDevices(project, defs, failures)) ? null : 'path';
}

/** ¿Pueden estos fallos dejar la casa sin Internet? (atajo antes de calcular el camino). */
export function failuresMayCutInternet(failures: Failures): boolean {
  return failures.internet || failures.powerOutage || failures.devicesDown.length > 0;
}

/** Motivo en español de que una integración en la nube no funcione, según la causa. */
export function cloudLossReason(loss: InternetLoss): string {
  switch (loss) {
    case 'cut':
      return 'integración en la nube sin Internet';
    case 'power':
      return 'integración en la nube: el router está sin corriente y no hay Internet';
    case 'path':
      return 'integración en la nube: el router o la salida a Internet no funcionan y no hay Internet';
  }
}
