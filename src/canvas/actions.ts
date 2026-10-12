import type { Device, Id, Point } from '../types';
import { catalog, getDefinition } from '../devices/catalog';
import { createDevice, uniqueDeviceName } from '../devices/factory';
import { canConnect, suggestConnections } from '../network/connections';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

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
  const created = store.addConnection({ sourceId, targetId, protocol: result.protocol });
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
