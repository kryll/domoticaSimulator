import type { Device, Project } from '../types';
import { catalog } from '../devices/catalog';
import { createDevice } from '../devices/factory';

/** Proyecto mínimo con una planta, para tests de la interfaz. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date(0).toISOString();
  return {
    id: 'p1',
    name: 'Test',
    version: 1,
    createdAt: now,
    updatedAt: now,
    floors: [{ id: 'f1', name: 'Planta baja', level: 0, pixelsPerMeter: 40 }],
    rooms: [],
    devices: [],
    connections: [],
    automations: [],
    scenes: [],
    scripts: [],
    ...overrides,
  };
}

/** Primera definición del catálogo que cumpla el predicado. */
export function findDef(pred: (d: (typeof catalog)[number]) => boolean) {
  const def = catalog.find(pred);
  if (!def) throw new Error('No hay definición en el catálogo que cumpla el filtro');
  return def;
}

export function makeDevice(defId: string, id: string, x = 100, y = 100, name?: string): Device {
  const def = findDef((d) => d.id === defId);
  return { ...createDevice(def, { floorId: 'f1', position: { x, y }, name }), id };
}
