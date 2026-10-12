// Cobertura radio aproximada sobre el plano.
import type { Device, DeviceDefinition, Floor, Point, Protocol } from '../types';

/** Altura aproximada de una planta, en metros. */
export const FLOOR_HEIGHT_METERS = 3;
/** Fracción del alcance que se conserva al atravesar cada forjado. */
export const FLOOR_ATTENUATION = 0.7;

/** Alcance por defecto (m) cuando la definición no indica rangeMeters. */
export const DEFAULT_RANGE_METERS: Record<Protocol, number> = {
  wifi: 30,
  ethernet: 0,
  zigbee: 20,
  zwave: 30,
  thread: 20,
  matter: 30,
  ble: 10,
  rf433: 40,
};

/** Distancia en metros entre dos puntos de la misma planta. */
export function distanceMeters(a: Point, b: Point, floor: Floor): number {
  const ppm = floor.pixelsPerMeter > 0 ? floor.pixelsPerMeter : 1;
  return Math.hypot(a.x - b.x, a.y - b.y) / ppm;
}

/** Alcance en metros de una definición (0 si solo es cableada). */
export function rangeMeters(def: DeviceDefinition): number {
  if (def.rangeMeters !== undefined) return def.rangeMeters;
  return Math.max(0, ...def.protocols.map((p) => DEFAULT_RANGE_METERS[p]));
}

export function coverageRadiusPx(def: DeviceDefinition, floor: Floor): number {
  return rangeMeters(def) * floor.pixelsPerMeter;
}

/**
 * Distancia 3D aproximada entre dos dispositivos (plantas separadas FLOOR_HEIGHT_METERS por nivel).
 * Devuelve undefined si falta alguna planta.
 */
export function deviceDistanceMeters(a: Device, b: Device, floors: Floor[]): number | undefined {
  const fa = floors.find((f) => f.id === a.floorId);
  const fb = floors.find((f) => f.id === b.floorId);
  if (!fa || !fb) return undefined;
  const ppm = (fa.pixelsPerMeter + fb.pixelsPerMeter) / 2;
  const horizontal = distanceMeters(a.position, b.position, { ...fa, pixelsPerMeter: ppm });
  const vertical = Math.abs(fa.level - fb.level) * FLOOR_HEIGHT_METERS;
  return Math.hypot(horizontal, vertical);
}

/**
 * Alcance de una definición para un protocolo concreto: si no es su radio principal
 * (p. ej. el BLE de un Shelly Wi-Fi) se usa el alcance por defecto de ese protocolo.
 */
export function rangeForProtocol(def: DeviceDefinition, protocol?: Protocol): number {
  if (protocol === undefined || def.protocols[0] === protocol) return rangeMeters(def);
  return DEFAULT_RANGE_METERS[protocol];
}

/**
 * ¿Están a alcance radio? Se usa el mayor de los dos alcances (para el protocolo del enlace,
 * si se indica), atenuado un 30 % por cada planta de diferencia.
 */
export function isInRange(a: Device, b: Device, defs: DeviceDefinition[], floors: Floor[], protocol?: Protocol): boolean {
  const da = defs.find((d) => d.id === a.definitionId);
  const db = defs.find((d) => d.id === b.definitionId);
  if (!da || !db) return false;
  const fa = floors.find((f) => f.id === a.floorId);
  const fb = floors.find((f) => f.id === b.floorId);
  const distance = deviceDistanceMeters(a, b, floors);
  if (!fa || !fb || distance === undefined) return false;
  const levels = Math.abs(fa.level - fb.level);
  const range = Math.max(rangeForProtocol(da, protocol), rangeForProtocol(db, protocol)) * FLOOR_ATTENUATION ** levels;
  return distance <= range;
}
