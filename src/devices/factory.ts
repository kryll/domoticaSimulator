import type { Device, DeviceDefinition, Id, Point } from '../types';
import { slugify } from './entities';

export interface CreateDeviceOptions {
  floorId: Id;
  position: Point;
  name?: string;
  roomId?: Id;
}

/** Crea un dispositivo a partir de una definición; protocolo e integración por defecto: los primeros. */
export function createDevice(def: DeviceDefinition, opts: CreateDeviceOptions): Device {
  const protocol = def.protocols[0];
  const integration = def.integrations[0];
  if (protocol === undefined || integration === undefined) {
    throw new Error(`La definición "${def.id}" no tiene protocolos o integraciones`);
  }
  const device: Device = {
    id: crypto.randomUUID(),
    definitionId: def.id,
    name: opts.name ?? def.name,
    floorId: opts.floorId,
    position: { ...opts.position },
    protocol,
    integration,
  };
  if (opts.roomId !== undefined) device.roomId = opts.roomId;
  return device;
}

/**
 * Devuelve un nombre no usado: "base", "base 2", "base 3"...
 * Compara por slug para que no colisionen los entity_id.
 */
export function uniqueDeviceName(base: string, existing: readonly (string | { name: string })[]): string {
  const taken = new Set(existing.map((e) => slugify(typeof e === 'string' ? e : e.name)));
  if (!taken.has(slugify(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(slugify(candidate))) return candidate;
  }
}
