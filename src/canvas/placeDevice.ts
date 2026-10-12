// Colocación inteligente al añadir dispositivos desde el catálogo o desde un arreglo rápido:
// dentro de la sala seleccionada o, si no hay ninguna, en la última dibujada de la planta.
import type { Device, Id, Point, Project } from '../types';
import { useProjectStore } from '../store/projectStore';
import { primarySelection, useUiStore } from '../store/uiStore';
import { NODE_SIZE, placeNewDevices } from './placement';
import { activeFloorId, addDeviceFromDefinition, canvasCenter, freeSpotNear } from './actions';

/**
 * placeNewDevices trabaja con la esquina superior izquierda de los nodos; el lienzo usa nodeOrigin
 * [0,5, 0,5] (Device.position es el centro). Se pasan las posiciones existentes a esquina y el
 * resultado otra vez a centro.
 */
export function placeDevicesAt(project: Project, floorId: Id, count: number, opts: { roomId?: Id; near?: Point }): Point[] {
  const hw = NODE_SIZE.width / 2;
  const hh = NODE_SIZE.height / 2;
  const devices = project.devices.map((d) => ({ ...d, position: { x: d.position.x - hw, y: d.position.y - hh } }));
  const options = { ...(opts.roomId ? { roomId: opts.roomId } : {}), ...(opts.near ? { near: opts.near } : {}) };
  return placeNewDevices({ rooms: project.rooms, devices }, floorId, count, options).map((p) => ({
    x: Math.round(p.x + NODE_SIZE.width / 2),
    y: Math.round(p.y + NODE_SIZE.height / 2),
  }));
}

/** Sala de destino: la seleccionada, la del dispositivo seleccionado o la última dibujada en la planta. */
export function targetRoomId(project: Project, floorId: Id, selection: ReturnType<typeof primarySelection>): Id | undefined {
  if (selection?.kind === 'room') {
    const room = project.rooms.find((r) => r.id === selection.id && r.floorId === floorId);
    if (room) return room.id;
  }
  if (selection?.kind === 'device') {
    const device = project.devices.find((d) => d.id === selection.id);
    const room = device?.roomId ? project.rooms.find((r) => r.id === device.roomId && r.floorId === floorId) : undefined;
    if (room) return room.id;
  }
  const onFloor = project.rooms.filter((r) => r.floorId === floorId);
  return onFloor[onFloor.length - 1]?.id;
}

/**
 * Añade un dispositivo del catálogo en la planta activa usando placeNewDevices (dentro de la sala
 * de destino, sin solaparse) y le asigna la sala. Sin salas, lo pone en el centro visible.
 */
export function addCatalogDevice(definitionId: Id, screenToFlow?: Parameters<typeof canvasCenter>[0]): Device | null {
  const project = useProjectStore.getState().project;
  const floorId = activeFloorId();
  if (!floorId) return addDeviceFromDefinition(definitionId, { x: 200, y: 200 });
  const roomId = targetRoomId(project, floorId, primarySelection(useUiStore.getState()));
  if (!roomId) {
    const near = screenToFlow ? canvasCenter(screenToFlow) : undefined;
    const [spot] = placeDevicesAt(project, floorId, 1, near ? { near } : {});
    return addDeviceFromDefinition(definitionId, spot ?? freeSpotNear(near ?? { x: 200, y: 200 }));
  }
  const [spot] = placeDevicesAt(project, floorId, 1, { roomId });
  const device = addDeviceFromDefinition(definitionId, spot ?? { x: 200, y: 200 });
  if (device && device.roomId !== roomId) useProjectStore.getState().updateDevice(device.id, { roomId });
  return useProjectStore.getState().project.devices.find((d) => d.id === device?.id) ?? device;
}
