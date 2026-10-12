// Disponibilidad de los dispositivos según la red y los fallos simulados (B1). Funciones puras.
//
// Un dispositivo deja de estar disponible si está caído (fallo simulado, desconectado a mano,
// sin corriente o sin batería), si su integración es de nube y no hay Internet, o si pierde el
// camino hasta el servidor de Home Assistant porque cae un equipo intermedio (coordinador, hub,
// border router, controlador Z-Wave, router de la malla o punto de acceso).
import type { Device, DeviceDefinition, Failures, Id, Project, SimulationState } from '../types';
import { isBleProxy, isInfra } from '../devices/roles';
import { canConnect } from '../network/connections';
import { appendLog, cancelAllRuns } from './engine';
import { setDeviceOfflineRaw } from './events';
import { activeFailures, internetAvailable, isCloudDevice, needsMains } from './connectivity';

export { activeFailures, hasFailures, internetAvailable, isCloudDevice, isHaRestarting, needsMains, NO_FAILURES } from './connectivity';

interface Placed {
  device: Device;
  def: DeviceDefinition;
}

function placedDevices(project: Project, defs: DeviceDefinition[]): Map<Id, Placed> {
  const map = new Map<Id, Placed>();
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def) map.set(device.id, { device, def });
  }
  return map;
}

function relays(def: DeviceDefinition): boolean {
  return isInfra(def) || def.role === 'router' || isBleProxy(def);
}

/** Grafo de enlaces: conexiones del proyecto y, para lo que no tiene ninguna, enlaces compatibles. */
function buildGraph(project: Project, defs: DeviceDefinition[], placed: Map<Id, Placed>): Map<Id, Set<Id>> {
  const graph = new Map<Id, Set<Id>>();
  const link = (a: Id, b: Id): void => {
    if (!placed.has(a) || !placed.has(b) || a === b) return;
    graph.set(a, (graph.get(a) ?? new Set()).add(b));
    graph.set(b, (graph.get(b) ?? new Set()).add(a));
  };
  for (const c of project.connections) link(c.sourceId, c.targetId);
  // Solo los dispositivos sin ninguna conexión dibujada usan enlaces implícitos; se decide antes
  // del bucle para que el resultado no dependa del orden de los dispositivos.
  const explicit = new Set(project.connections.flatMap((c) => [c.sourceId, c.targetId]));
  for (const p of placed.values()) {
    if (explicit.has(p.device.id)) continue;
    for (const other of placed.values()) {
      if (other.device.id === p.device.id || !relays(other.def)) continue;
      if (canConnect(p.device, other.device, defs).ok) link(p.device.id, other.device.id);
    }
  }
  return graph;
}

/** BFS desde los servidores HA no caídos: devuelve el padre de cada dispositivo alcanzado. */
function reach(placed: Map<Id, Placed>, graph: Map<Id, Set<Id>>, down: ReadonlySet<Id>): Map<Id, Id | null> {
  const parent = new Map<Id, Id | null>();
  const queue: Id[] = [];
  for (const p of placed.values()) {
    if (p.def.role === 'ha_server' && !down.has(p.device.id)) {
      parent.set(p.device.id, null);
      queue.push(p.device.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const node = id === undefined ? undefined : placed.get(id);
    if (id === undefined || !node || !relays(node.def)) continue;
    for (const next of graph.get(id) ?? []) {
      if (parent.has(next) || down.has(next)) continue;
      parent.set(next, id);
      queue.push(next);
    }
  }
  return parent;
}

/** ¿Recibe corriente un equipo USB durante un corte? Sí si su anfitrión (servidor) tiene SAI. */
function poweredByHost(p: Placed, project: Project, placed: Map<Id, Placed>): boolean {
  if (p.def.power !== 'usb') return false;
  return project.connections.some((c) => {
    const otherId = c.sourceId === p.device.id ? c.targetId : c.targetId === p.device.id ? c.sourceId : undefined;
    const other = otherId === undefined ? undefined : placed.get(otherId);
    return other !== undefined && other.def.role === 'ha_server' && other.device.ups === true;
  });
}

/** Motivo por el que un dispositivo cae por sí mismo (sin contar la cadena de red). */
function directReasons(
  project: Project,
  defs: DeviceDefinition[],
  failures: Failures,
  extra: ReadonlyMap<Id, string>,
  placed: Map<Id, Placed>,
): Map<Id, string> {
  const reasons = new Map<Id, string>(extra);
  const online = internetAvailable(project, defs, failures);
  for (const id of failures.devicesDown) if (placed.has(id)) reasons.set(id, 'fallo simulado del dispositivo');
  for (const p of placed.values()) {
    const id = p.device.id;
    if (reasons.has(id)) continue;
    if (failures.powerOutage && needsMains(p.def) && p.device.ups !== true && !poweredByHost(p, project, placed)) {
      reasons.set(id, 'sin corriente por el corte de luz');
    } else if (!online && isCloudDevice(p.device, p.def)) {
      reasons.set(id, failures.internet ? 'integración en la nube sin Internet' : 'integración en la nube: el router está sin corriente y no hay Internet');
    }
  }
  return reasons;
}

/**
 * Motivo (en español) de cada dispositivo no disponible: los caídos directamente (`extra`
 * incluye desconexiones a mano o baterías agotadas) y los que pierden el camino hasta Home
 * Assistant por un equipo intermedio caído. Los dispositivos que ya no llegaban a HA sin
 * fallos (problemas de diseño, los señala el validador) no se cuentan.
 */
export function unavailabilityReasons(
  project: Project,
  defs: DeviceDefinition[],
  failures: Failures,
  extra: ReadonlyMap<Id, string> = new Map(),
): Map<Id, string> {
  const placed = placedDevices(project, defs);
  const direct = directReasons(project, defs, failures, extra, placed);
  if (direct.size === 0) return direct;
  const graph = buildGraph(project, defs, placed);
  const baseline = reach(placed, graph, new Set());
  const current = reach(placed, graph, new Set(direct.keys()));
  const result = new Map(direct);
  for (const [id, parentId] of baseline) {
    if (current.has(id) || result.has(id)) continue;
    let culprit: Id | undefined;
    for (let p: Id | null | undefined = parentId; p !== null && p !== undefined; p = baseline.get(p)) {
      if (direct.has(p)) {
        culprit = p;
        break;
      }
    }
    const name = culprit === undefined ? undefined : placed.get(culprit)?.device.name;
    result.set(id, name === undefined ? 'sin camino de red hasta Home Assistant' : `depende de «${name}», que no está disponible`);
  }
  return result;
}

/**
 * Dispositivos no disponibles con estos fallos y los desconectados a mano (`offlineManual`).
 * Sin coordinador, hub, border router o controlador Z-Wave en línea caen sus hijos; sin
 * Internet, las integraciones de nube; con corte de luz, todo lo enchufado (mains, PoE, USB)
 * salvo lo que tiene SAI, y los dispositivos a pilas cuyo coordinador cae.
 */
export function computeUnavailable(
  project: Project,
  defs: DeviceDefinition[],
  failures: Failures,
  offlineManual: Iterable<Id> = [],
): Set<Id> {
  const extra = new Map<Id, string>();
  for (const id of offlineManual) extra.set(id, 'desconectado a mano');
  return new Set(unavailabilityReasons(project, defs, failures, extra).keys());
}

/** Dispositivos con la batería agotada (0 %). */
export function depletedDevices(sim: Pick<SimulationState, 'batteries'>): Id[] {
  return Object.entries(sim.batteries ?? {})
    .filter(([, level]) => level <= 0)
    .map(([id]) => id);
}

/**
 * Aplica la disponibilidad que corresponde a los fallos activos y a las baterías agotadas:
 * pasa a 'unavailable' lo que cae y restaura lo que se recupera (mecanismo de setDeviceOffline).
 * Respeta los dispositivos desconectados a mano.
 */
export function reconcileAvailability(sim: SimulationState, project: Project, defs: DeviceDefinition[]): SimulationState {
  const byFailure = new Set(sim.failureOffline ?? []);
  const manual = Object.keys(sim.offline ?? {}).filter((id) => !byFailure.has(id));
  const extra = new Map<Id, string>();
  for (const id of manual) extra.set(id, 'desconectado a mano');
  for (const id of depletedDevices(sim)) if (!extra.has(id)) extra.set(id, 'batería agotada');
  const reasons = unavailabilityReasons(project, defs, activeFailures(sim), extra);
  const target = new Set([...reasons.keys()].filter((id) => !manual.includes(id)));
  let result: SimulationState = sim;
  for (const id of byFailure) {
    if (!target.has(id)) result = setDeviceOfflineRaw(result, project, id, false, defs);
  }
  const down: Id[] = [];
  for (const id of target) {
    if (!result.offline?.[id]) result = setDeviceOfflineRaw(result, project, id, true, defs);
    if (result.offline?.[id]) down.push(id);
  }
  const unchanged = down.length === byFailure.size && down.every((id) => byFailure.has(id));
  if (unchanged && sim.failureOffline !== undefined) return result;
  return { ...result, failureOffline: down };
}

const FAILURE_LOG: Record<'internet' | 'powerOutage' | 'haRestarting', [string, string]> = {
  internet: ['Fallo simulado: sin conexión a Internet', 'Conexión a Internet restablecida'],
  powerOutage: ['Fallo simulado: corte de luz', 'Vuelve la luz'],
  haRestarting: ['Fallo simulado: Home Assistant se está reiniciando (no se ejecutan automatizaciones)', 'Home Assistant vuelve a estar en marcha'],
};

/**
 * Cambia los fallos simulados: las entidades de los dispositivos afectados pasan a
 * 'unavailable' y, al quitar el fallo, recuperan su estado anterior.
 */
export function setFailures(sim: SimulationState, project: Project, defs: DeviceDefinition[], patch: Partial<Failures>): SimulationState {
  const before = activeFailures(sim);
  const failures: Failures = { ...before, ...patch, devicesDown: [...(patch.devicesDown ?? before.devicesDown)] };
  let result: SimulationState = { ...sim, failures };
  for (const key of ['internet', 'powerOutage', 'haRestarting'] as const) {
    if (before[key] !== failures[key]) result = appendLog(result, failures[key] ? 'warning' : 'info', FAILURE_LOG[key][failures[key] ? 0 : 1]);
  }
  if (failures.haRestarting && !before.haRestarting) result = cancelAllRuns(result);
  const name = (id: Id): string => project.devices.find((d) => d.id === id)?.name ?? id;
  for (const id of failures.devicesDown) {
    if (!before.devicesDown.includes(id)) result = appendLog(result, 'warning', `Fallo simulado: «${name(id)}» deja de funcionar`);
  }
  for (const id of before.devicesDown) {
    if (!failures.devicesDown.includes(id)) result = appendLog(result, 'info', `«${name(id)}» vuelve a funcionar`);
  }
  const previous = new Set(sim.failureOffline ?? []);
  result = reconcileAvailability(result, project, defs);
  const fallen = (result.failureOffline ?? []).filter((id) => !previous.has(id)).length;
  if (fallen > 0) {
    result = appendLog(result, 'warning', `${fallen} dispositivo${fallen === 1 ? '' : 's'} sin disponibilidad por los fallos simulados`);
  }
  return result;
}

/** ¿Está el dispositivo caído por los fallos simulados (no a mano)? */
export function isDownByFailure(sim: Pick<SimulationState, 'failureOffline'>, deviceId: Id): boolean {
  return sim.failureOffline?.includes(deviceId) ?? false;
}

function capitalize(text: string): string {
  return text === '' ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

/**
 * Por qué un dispositivo no puede volver a estar disponible aunque se reconecte a mano
 * («Depende de «Coordinador Zigbee»», «Sin batería», «Sin corriente por el corte de luz»...),
 * o null si nada lo impide. Cuenta los fallos activos, las baterías agotadas y los demás
 * dispositivos desconectados a mano.
 */
export function offlineBlockReason(sim: SimulationState, project: Project, defs: DeviceDefinition[], deviceId: Id): string | null {
  const byFailure = new Set(sim.failureOffline ?? []);
  const extra = new Map<Id, string>();
  for (const id of Object.keys(sim.offline ?? {})) if (id !== deviceId && !byFailure.has(id)) extra.set(id, 'desconectado a mano');
  for (const id of depletedDevices(sim)) extra.set(id, 'batería agotada');
  const reason = unavailabilityReasons(project, defs, activeFailures(sim), extra).get(deviceId);
  if (reason === undefined) return null;
  if (reason === 'batería agotada') return 'Sin batería';
  const parent = /^depende de («.+»), que no está disponible$/.exec(reason);
  if (parent) return `Depende de ${parent[1] ?? ''}`;
  return capitalize(reason);
}
