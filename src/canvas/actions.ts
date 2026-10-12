import type { Device, Id, NetworkRole, Point } from '../types';
import { catalog, getDefinition } from '../devices/catalog';
import { createDevice, uniqueDeviceName } from '../devices/factory';
import { canConnect, suggestConnections } from '../network/connections';
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
  const device = createDevice(def, { floorId, position: { x: Math.round(position.x), y: Math.round(position.y) }, name });
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
  useUiStore
    .getState()
    .notify(added > 0 ? `Se han añadido ${added} conexiones` : 'No hay conexiones nuevas que sugerir', added > 0 ? 'success' : 'info');
  return added;
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
