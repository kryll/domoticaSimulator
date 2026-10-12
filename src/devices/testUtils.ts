// Utilidades de test compartidas por los tests del núcleo (no se usan en producción).
import type { Device, Floor, Integration, Point, Project, Protocol } from '../types';
import { catalog, getDefinition } from './catalog';

export const FLOOR: Floor = { id: 'f0', name: 'Planta baja', level: 0, pixelsPerMeter: 50 };
export const FLOOR_UP: Floor = { id: 'f1', name: 'Primera planta', level: 1, pixelsPerMeter: 50 };

export interface DevOptions {
  protocol?: Protocol;
  integration?: Integration;
  floorId?: string;
  name?: string;
  roomId?: string;
}

/** Dispositivo de prueba a partir de una definición real del catálogo. */
export function dev(id: string, definitionId: string, at: Point = { x: 0, y: 0 }, opts: DevOptions = {}): Device {
  const def = getDefinition(definitionId, catalog);
  const protocol = opts.protocol ?? def?.protocols[0];
  const integration = opts.integration ?? def?.integrations[0];
  if (!def || !protocol || !integration) throw new Error(`Definición desconocida en test: ${definitionId}`);
  const d: Device = {
    id,
    definitionId,
    name: opts.name ?? id,
    floorId: opts.floorId ?? FLOOR.id,
    position: at,
    protocol,
    integration,
  };
  if (opts.roomId) d.roomId = opts.roomId;
  return d;
}

export function project(devices: Device[], extra: Partial<Project> = {}): Project {
  return {
    id: 'p',
    name: 'Test',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    floors: [FLOOR, FLOOR_UP],
    rooms: [],
    devices,
    connections: [],
    automations: [],
    scenes: [],
    scripts: [],
    ...extra,
  };
}

/** Definición del catálogo que debe existir (falla el test si no). */
export function def(id: string) {
  const d = getDefinition(id, catalog);
  if (!d) throw new Error(`Definición desconocida en test: ${id}`);
  return d;
}
