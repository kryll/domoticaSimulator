import type { Device, EntityStateValue, Id, NetworkRole, Point, Trigger } from '../types';
import { catalog, getDefinition } from '../devices/catalog';
import { entitiesForDevice } from '../devices/entities';
import { createDevice, uniqueDeviceName } from '../devices/factory';
import { canConnect, explainUnconnected, suggestConnections } from '../network/connections';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { findFreeSpot } from './geometry';

/** Planta activa (o la primera del proyecto). */
export function activeFloorId(): Id | undefined {
  const { activeFloorId: id } = useUiStore.getState();
  const { floors } = useProjectStore.getState().project;
  if (id && floors.some((f) => f.id === id)) return id;
  return floors[0]?.id;
}

/** Crea un dispositivo del catálogo en la planta activa y lo selecciona. */
export function addDeviceFromDefinition(definitionId: Id, position: Point): Device | null {
  const ui = useUiStore.getState();
  const def = getDefinition(definitionId, catalog);
  const floorId = activeFloorId();
  if (!def || !floorId) {
    ui.notify('No se pudo añadir el dispositivo', 'error');
    return null;
  }
  const store = useProjectStore.getState();
  const name = uniqueDeviceName(
    def.name,
    store.project.devices.map((d) => d.name),
  );
  // B5: integración por defecto según el contexto (coordinador, hub, local antes que nube).
  const device = createDevice(
    def,
    { floorId, position: { x: Math.round(position.x), y: Math.round(position.y) }, name },
    store.project,
    catalog,
  );
  store.addDevice(device);
  ui.select({ kind: 'device', id: device.id });
  return device;
}

/** Jerarquía de papeles de red: el de mayor rango hace de padre (destino) en una conexión. */
const ROLE_RANK: Record<NetworkRole, number> = {
  end_device: 0,
  router: 1,
  access_point: 2,
  border_router: 3,
  hub: 3,
  coordinator: 3,
  ha_server: 4,
};

/** Ordena el par para que sourceId sea el hijo y targetId el padre (infraestructura). */
export function orientConnection(a: Device, b: Device): { sourceId: Id; targetId: Id } {
  const ra = ROLE_RANK[getDefinition(a.definitionId, catalog)?.role ?? 'end_device'];
  const rb = ROLE_RANK[getDefinition(b.definitionId, catalog)?.role ?? 'end_device'];
  return ra > rb ? { sourceId: b.id, targetId: a.id } : { sourceId: a.id, targetId: b.id };
}

/** Intenta conectar dos dispositivos; avisa si no es posible. */
export function connectDevices(sourceId: Id, targetId: Id): boolean {
  const ui = useUiStore.getState();
  const store = useProjectStore.getState();
  const a = store.project.devices.find((d) => d.id === sourceId);
  const b = store.project.devices.find((d) => d.id === targetId);
  if (!a || !b || a.id === b.id) return false;
  const result = canConnect(a, b, catalog);
  if (!result.ok) {
    ui.notify(`No se pueden conectar: ${result.reason}`, 'error');
    return false;
  }
  const created = store.addConnection({ ...orientConnection(a, b), protocol: result.protocol });
  if (!created) {
    ui.notify('Esos dispositivos ya están conectados', 'info');
    return false;
  }
  ui.select({ kind: 'connection', id: created.id });
  return true;
}

/** Añade las conexiones sugeridas por el núcleo de red. */
export function autoConnect(): number {
  const store = useProjectStore.getState();
  const suggested = suggestConnections(store.project, catalog);
  const added = store.addConnections(suggested);
  const ui = useUiStore.getState();
  if (added > 0) {
    ui.notify(added === 1 ? 'Se ha añadido 1 conexión' : `Se han añadido ${added} conexiones`, 'success');
    return added;
  }
  const reasons = explainUnconnected(useProjectStore.getState().project, catalog).map((r) => r.reason);
  ui.notify(
    reasons.length > 0 ? 'No se ha creado ninguna conexión:' : 'Todos los dispositivos ya están conectados',
    'info',
    { details: reasons.slice(0, 6).concat(reasons.length > 6 ? [`… y ${reasons.length - 6} más`] : []) },
  );
  return 0;
}

/** Hueco libre cerca de `point` en la planta activa (para no apilar nodos). */
export function freeSpotNear(point: Point): Point {
  const floorId = activeFloorId();
  const occupied = useProjectStore
    .getState()
    .project.devices.filter((d) => d.floorId === floorId)
    .map((d) => d.position);
  return findFreeSpot(occupied, point);
}

/** Posición aproximada del centro visible del lienzo, en coordenadas de flujo. */
export function canvasCenter(screenToFlow: (p: Point) => Point): Point {
  const el = document.getElementById('ha-canvas');
  if (!el) return { x: 200, y: 200 };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) {
    const n = useProjectStore.getState().project.devices.length;
    return { x: 160 + (n % 6) * 180, y: 120 + Math.floor(n / 6) * 90 };
  }
  return screenToFlow({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

/** Duplica un dispositivo junto al original (misma configuración, nombre nuevo). */
export function duplicateDevice(deviceId: Id): Device | null {
  const store = useProjectStore.getState();
  const original = store.project.devices.find((d) => d.id === deviceId);
  if (!original) return null;
  const name = uniqueDeviceName(original.name, store.project.devices);
  const occupied = store.project.devices.filter((d) => d.floorId === original.floorId).map((d) => d.position);
  const position = findFreeSpot(occupied, { x: original.position.x + 200, y: original.position.y });
  const copy: Device = { ...original, id: crypto.randomUUID(), name, position };
  store.addDevice(copy);
  useUiStore.getState().select({ kind: 'device', id: copy.id });
  return copy;
}

/** Estado «to» sugerido para un disparador sobre la entidad. */
function suggestedTo(domain: string, key: string): EntityStateValue | undefined {
  if (key === 'action') return 'single';
  switch (domain) {
    case 'binary_sensor':
    case 'light':
    case 'switch':
    case 'fan':
      return 'on';
    case 'cover':
      return 'open';
    case 'lock':
      return 'unlocked';
    case 'media_player':
      return 'playing';
    default:
      return undefined;
  }
}

/** Orden de preferencia del disparador: actuadores y binary_sensor antes que los sensores. */
const TRIGGER_PRIORITY = ['binary_sensor', 'lock', 'cover', 'light', 'switch', 'fan', 'media_player', 'climate', 'vacuum', 'camera', 'sensor'];
/** Entidades de diagnóstico que no tienen sentido como disparador por defecto. */
const DIAGNOSTIC = new Set(['battery', 'power', 'energy', 'linkquality', 'voltage', 'current', 'signal_strength']);

function isDiagnostic(e: { definition: { key: string; deviceClass?: string } }): boolean {
  return DIAGNOSTIC.has(e.definition.key) || DIAGNOSTIC.has(e.definition.deviceClass ?? '');
}

/** Entidad que mejor representa al dispositivo como disparador de una automatización. */
export function triggerEntityFor<T extends { definition: { key: string; domain: string; deviceClass?: string } }>(entities: T[]): T | undefined {
  const rank = (e: T): number => {
    if (e.definition.key === 'action') return -1;
    const i = TRIGGER_PRIORITY.indexOf(e.definition.domain);
    return i === -1 ? TRIGGER_PRIORITY.length : i;
  };
  const candidates = entities.filter((e) => !isDiagnostic(e));
  return [...(candidates.length > 0 ? candidates : entities)].sort((a, b) => rank(a) - rank(b))[0];
}

/** Crea una automatización con el dispositivo como disparador y la abre en el editor. */
export function createAutomationForDevice(deviceId: Id): Id | null {
  const store = useProjectStore.getState();
  const device = store.project.devices.find((d) => d.id === deviceId);
  const def = device ? getDefinition(device.definitionId, catalog) : undefined;
  if (!device || !def) return null;
  const main = triggerEntityFor(entitiesForDevice(device, def));
  const trigger: Trigger = { type: 'state', entityId: main?.entityId ?? '' };
  const to = main ? suggestedTo(main.definition.domain, main.definition.key) : undefined;
  if (to !== undefined) trigger.to = to;
  const automation = store.addAutomation({ name: `Cuando ${device.name}…`, triggers: [trigger] });
  const ui = useUiStore.getState();
  ui.selectAutomation(automation.id);
  ui.setBottomTab('automations');
  return automation.id;
}
