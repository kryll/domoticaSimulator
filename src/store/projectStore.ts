import { create } from 'zustand';
import type {
  Automation,
  Connection,
  Device,
  Floor,
  Id,
  Point,
  Project,
  Room,
  Scene,
  Script,
} from '../types';
import { createEmptyProject, saveProject } from './persistence';
import { reassignRooms, resolveRoomId, translatePolygon } from '../canvas/geometry';
import { newId } from '../ui/ids';
import { catalog, getDefinition } from '../devices/catalog';
import { uniqueDeviceName } from '../devices/factory';
import { entityIdMappingForRename, renameEntityRefs } from '../devices/renaming';

/** Número máximo de pasos de deshacer. */
export const HISTORY_LIMIT = 100;
/** Ventana para agrupar ediciones consecutivas del mismo elemento. */
const COALESCE_MS = 1500;

type Patch<T> = Partial<Omit<T, 'id'>>;

export interface ProjectState {
  project: Project;
  past: Project[];
  future: Project[];
  /** true cuando hay cambios aún no guardados en IndexedDB. */
  dirty: boolean;
  lastSavedAt: string | null;

  /** Sustituye el proyecto completo (abrir, nuevo, importar). Limpia el historial. */
  loadProject: (project: Project) => void;
  /** Aplica un cambio arbitrario con historial. */
  update: (mutator: (p: Project) => Project) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (at: string) => void;

  renameProject: (name: string) => void;

  addFloor: (name: string) => Floor;
  updateFloor: (id: Id, patch: Patch<Floor>) => void;
  removeFloor: (id: Id) => void;

  addRoom: (room: Omit<Room, 'id'>) => Room;
  updateRoom: (id: Id, patch: Patch<Room>) => void;
  moveRoom: (id: Id, dx: number, dy: number) => void;
  removeRoom: (id: Id) => void;

  addDevice: (device: Device) => void;
  updateDevice: (id: Id, patch: Patch<Device>) => void;
  moveDevice: (id: Id, position: Point) => void;
  removeDevices: (ids: Id[]) => void;

  /** Borra dispositivos, salas y conexiones en un único paso de deshacer. */
  removeElements: (ids: { deviceIds?: Id[]; roomIds?: Id[]; connectionIds?: Id[] }) => void;

  addConnection: (connection: Omit<Connection, 'id'>) => Connection | null;
  addConnections: (connections: Connection[]) => number;
  updateConnection: (id: Id, patch: Patch<Connection>) => void;
  removeConnections: (ids: Id[]) => void;

  addAutomation: (automation?: Partial<Automation>) => Automation;
  updateAutomation: (id: Id, automation: Automation) => void;
  removeAutomation: (id: Id) => void;

  addScene: (scene: Omit<Scene, 'id'>) => Scene;
  updateScene: (id: Id, patch: Patch<Scene>) => void;
  removeScene: (id: Id) => void;

  addScript: (script?: Partial<Omit<Script, 'id'>>) => Script;
  updateScript: (id: Id, patch: Patch<Script>) => void;
  removeScript: (id: Id) => void;
}

function touch(p: Project): Project {
  return { ...p, updatedAt: new Date().toISOString() };
}

function samePair(c: Pick<Connection, 'sourceId' | 'targetId'>, a: Id, b: Id): boolean {
  return (c.sourceId === a && c.targetId === b) || (c.sourceId === b && c.targetId === a);
}

export const useProjectStore = create<ProjectState>()((set, get) => {
  // Agrupa en un único paso de deshacer las ediciones seguidas del mismo elemento (p. ej. teclear un nombre).
  let lastCoalesce: { key: string; at: number } | null = null;
  const commit = (mutator: (p: Project) => Project, coalesceKey?: string) => {
    const current = get().project;
    const next = mutator(current);
    if (next === current) return;
    const now = Date.now();
    const merge = coalesceKey !== undefined && lastCoalesce?.key === coalesceKey && now - lastCoalesce.at < COALESCE_MS;
    lastCoalesce = coalesceKey !== undefined ? { key: coalesceKey, at: now } : null;
    set((s) => ({
      project: touch(next),
      past: merge ? s.past : [...s.past, current].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    }));
  };

  return {
    project: createEmptyProject('Proyecto sin título'),
    past: [],
    future: [],
    dirty: false,
    lastSavedAt: null,

    loadProject: (project) => {
      lastCoalesce = null;
      set({ project, past: [], future: [], dirty: false });
    },
    update: (mutator) => commit(mutator),
    undo: () => {
      lastCoalesce = null;
      const { past, project, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future].slice(0, HISTORY_LIMIT), dirty: true });
    },
    redo: () => {
      lastCoalesce = null;
      const { past, project, future } = get();
      const next = future[0];
      if (!next) return;
      set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: future.slice(1), dirty: true });
    },
    markSaved: (at) => set({ dirty: false, lastSavedAt: at }),

    renameProject: (name) => commit((p) => (p.name === name ? p : { ...p, name })),

    addFloor: (name) => {
      const level = get().project.floors.reduce((max, f) => Math.max(max, f.level + 1), 0);
      const floor: Floor = { id: newId('floor'), name, level, pixelsPerMeter: 50 };
      commit((p) => ({ ...p, floors: [...p.floors, floor] }));
      return floor;
    },
    updateFloor: (id, patch) =>
      commit((p) => ({ ...p, floors: p.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
    removeFloor: (id) =>
      commit((p) => {
        if (p.floors.length <= 1) return p;
        const removedDevices = new Set(p.devices.filter((d) => d.floorId === id).map((d) => d.id));
        return {
          ...p,
          floors: p.floors.filter((f) => f.id !== id),
          rooms: p.rooms.filter((r) => r.floorId !== id),
          devices: p.devices.filter((d) => !removedDevices.has(d.id)),
          connections: p.connections.filter((c) => !removedDevices.has(c.sourceId) && !removedDevices.has(c.targetId)),
        };
      }),

    addRoom: (room) => {
      const created: Room = { ...room, id: newId('room') };
      commit((p) => reassignRooms({ ...p, rooms: [...p.rooms, created] }, created.floorId));
      return created;
    },
    updateRoom: (id, patch) =>
      commit((p) => {
        const room = p.rooms.find((r) => r.id === id);
        if (!room) return p;
        const next = { ...p, rooms: p.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
        return patch.polygon ? reassignRooms(next, room.floorId) : next;
      }),
    moveRoom: (id, dx, dy) =>
      commit((p) => {
        const room = p.rooms.find((r) => r.id === id);
        if (!room || (dx === 0 && dy === 0)) return p;
        const next = {
          ...p,
          rooms: p.rooms.map((r) => (r.id === id ? { ...r, polygon: translatePolygon(r.polygon, dx, dy) } : r)),
        };
        return reassignRooms(next, room.floorId);
      }),
    removeRoom: (id) =>
      commit((p) => ({
        ...p,
        rooms: p.rooms.filter((r) => r.id !== id),
        devices: p.devices.map((d) => (d.roomId === id ? { ...d, roomId: undefined } : d)),
      })),

    addDevice: (device) =>
      commit((p) => {
        const roomId = resolveRoomId(p.rooms, device.floorId, device.position, device.roomId);
        return { ...p, devices: [...p.devices, { ...device, roomId }] };
      }),
    updateDevice: (id, patch) =>
      commit((p) => {
        const current = p.devices.find((d) => d.id === id);
        if (!current) return p;
        let next: Device = { ...current, ...patch };
        let mapping: Record<string, string> = {};
        if (patch.name !== undefined && patch.name !== current.name) {
          // Nombre único (sin contar el propio dispositivo) y referencias de entity_id actualizadas.
          const others = p.devices.filter((d) => d.id !== id).map((d) => d.name);
          next = { ...next, name: uniqueDeviceName(patch.name.trim() || current.name, others) };
          const def = getDefinition(current.definitionId, catalog);
          if (def) mapping = entityIdMappingForRename(current, def, next.name);
        }
        const updated = { ...p, devices: p.devices.map((d) => (d.id === id ? next : d)) };
        return Object.keys(mapping).length > 0 ? renameEntityRefs(updated, mapping) : updated;
      }),
    moveDevice: (id, position) =>
      commit((p) => {
        const current = p.devices.find((d) => d.id === id);
        if (!current) return p;
        if (current.position.x === position.x && current.position.y === position.y) return p;
        const roomId = resolveRoomId(p.rooms, current.floorId, position, current.roomId);
        return { ...p, devices: p.devices.map((d) => (d.id === id ? { ...d, position, roomId } : d)) };
      }),
    removeDevices: (ids) =>
      commit((p) => {
        if (ids.length === 0) return p;
        const set = new Set(ids);
        return {
          ...p,
          devices: p.devices.filter((d) => !set.has(d.id)),
          connections: p.connections.filter((c) => !set.has(c.sourceId) && !set.has(c.targetId)),
        };
      }),

    removeElements: ({ deviceIds = [], roomIds = [], connectionIds = [] }) =>
      commit((p) => {
        if (deviceIds.length + roomIds.length + connectionIds.length === 0) return p;
        const devices = new Set(deviceIds);
        const rooms = new Set(roomIds);
        const conns = new Set(connectionIds);
        return {
          ...p,
          rooms: p.rooms.filter((r) => !rooms.has(r.id)),
          devices: p.devices
            .filter((d) => !devices.has(d.id))
            .map((d) => (d.roomId && rooms.has(d.roomId) ? { ...d, roomId: undefined } : d)),
          connections: p.connections.filter(
            (c) => !conns.has(c.id) && !devices.has(c.sourceId) && !devices.has(c.targetId),
          ),
        };
      }),
    addConnection: (connection) => {
      const { project } = get();
      if (connection.sourceId === connection.targetId) return null;
      if (project.connections.some((c) => samePair(c, connection.sourceId, connection.targetId))) return null;
      const created: Connection = { ...connection, id: newId('conn') };
      commit((p) => ({ ...p, connections: [...p.connections, created] }));
      return created;
    },
    addConnections: (connections) => {
      const existing = get().project.connections;
      const fresh: Connection[] = [];
      for (const c of connections) {
        if (c.sourceId === c.targetId) continue;
        if ([...existing, ...fresh].some((e) => samePair(e, c.sourceId, c.targetId))) continue;
        fresh.push(c.id ? c : { ...c, id: newId('conn') });
      }
      if (fresh.length > 0) commit((p) => ({ ...p, connections: [...p.connections, ...fresh] }));
      return fresh.length;
    },
    updateConnection: (id, patch) =>
      commit((p) => ({ ...p, connections: p.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    removeConnections: (ids) =>
      commit((p) => {
        if (ids.length === 0) return p;
        const set = new Set(ids);
        return { ...p, connections: p.connections.filter((c) => !set.has(c.id)) };
      }),

    addAutomation: (automation) => {
      const count = get().project.automations.length;
      const created: Automation = {
        name: `Automatización ${count + 1}`,
        enabled: true,
        triggers: [],
        conditions: [],
        actions: [],
        mode: 'single',
        ...automation,
        id: newId('auto'),
      };
      commit((p) => ({ ...p, automations: [...p.automations, created] }));
      return created;
    },
    updateAutomation: (id, automation) =>
      commit((p) => ({
        ...p,
        automations: p.automations.map((a) => (a.id === id ? { ...automation, id } : a)),
      }), `automation:${id}`),
    removeAutomation: (id) => commit((p) => ({ ...p, automations: p.automations.filter((a) => a.id !== id) })),

    addScene: (scene) => {
      const created: Scene = { ...scene, id: newId('scene') };
      commit((p) => ({ ...p, scenes: [...p.scenes, created] }));
      return created;
    },
    updateScene: (id, patch) =>
      commit((p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), `scene:${id}`),
    removeScene: (id) => commit((p) => ({ ...p, scenes: p.scenes.filter((s) => s.id !== id) })),

    addScript: (script) => {
      const count = get().project.scripts.length;
      const created: Script = { name: `Script ${count + 1}`, sequence: [], ...script, id: newId('script') };
      commit((p) => ({ ...p, scripts: [...p.scripts, created] }));
      return created;
    },
    updateScript: (id, patch) =>
      commit((p) => ({ ...p, scripts: p.scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), `script:${id}`),
    removeScript: (id) => commit((p) => ({ ...p, scripts: p.scripts.filter((s) => s.id !== id) })),
  };
});

/** Atajo para leer el proyecto fuera de React. */
export function getProject(): Project {
  return useProjectStore.getState().project;
}

/**
 * Guarda automáticamente el proyecto en IndexedDB tras `delayMs` sin cambios.
 * Devuelve una función para cancelar la suscripción.
 */
export function startAutosave(delayMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    const { project, markSaved } = useProjectStore.getState();
    try {
      await saveProject(project);
      markSaved(new Date().toISOString());
    } catch (err) {
      console.error('No se pudo guardar el proyecto', err);
    }
  };
  const unsubscribe = useProjectStore.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
