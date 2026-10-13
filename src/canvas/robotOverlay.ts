// Robots aspiradores en el plano: un marcador que recorre la sala que limpian. Lógica pura: los
// datos solo cambian cuando cambia la sala, el estado, el progreso o la batería (no en cada tick).
import type { DeviceDefinition, Project, SimulationState } from '../types';
import { entitiesForDevice } from '../devices/entities';
import { polygonBounds } from './geometry';

export interface RobotMarker {
  deviceId: string;
  name: string;
  roomId: string;
  bounds: { x: number; y: number; width: number; height: number };
  state: string;
  progress?: number;
  battery?: number;
  error?: string;
}

const SHOWN = new Set(['cleaning', 'paused', 'error', 'returning', 'idle']);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Marcadores de los robots fuera de la base en las salas de la planta `floorId`. */
export function robotMarkers(project: Pick<Project, 'devices' | 'rooms'>, floorId: string, sim: Pick<SimulationState, 'entities'>, defOf: (definitionId: string) => DeviceDefinition | undefined): RobotMarker[] {
  const out: RobotMarker[] = [];
  for (const device of project.devices) {
    const def = defOf(device.definitionId);
    if (!def || def.category !== 'vacuum') continue;
    const refs = entitiesForDevice(device, def);
    const vac = refs.find((r) => r.definition.domain === 'vacuum');
    const st = vac ? sim.entities[vac.entityId] : undefined;
    const state = st ? String(st.state) : '';
    if (!st || !SHOWN.has(state)) continue;
    const roomId = st.attributes?.current_room;
    const room = typeof roomId === 'string' ? project.rooms.find((r) => r.id === roomId && r.floorId === floorId) : undefined;
    if (!room) continue;
    const batteryRef = refs.find((r) => r.definition.deviceClass === 'battery');
    const battery = batteryRef ? num(sim.entities[batteryRef.entityId]?.state) : undefined;
    const marker: RobotMarker = { deviceId: device.id, name: device.name, roomId: room.id, bounds: polygonBounds(room.polygon), state };
    const progress = num(st.attributes?.progress);
    if (progress !== undefined) marker.progress = progress;
    if (battery !== undefined) marker.battery = Math.round(battery);
    if (st.attributes?.error !== undefined) marker.error = String(st.attributes.error);
    out.push(marker);
  }
  return out;
}
