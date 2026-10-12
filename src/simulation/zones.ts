// Zonas con coordenadas (B9): distancia, coordenadas efectivas y conflictos. Funciones puras.
import { defaultSettings, type Id, type Project, type Zone } from '../types';
import { projectZones } from './logic';

/** Radio por defecto (m) de la zona home, como en Home Assistant. */
export const DEFAULT_ZONE_RADIUS = 100;
export const MIN_ZONE_RADIUS = 10;
export const MAX_ZONE_RADIUS = 50_000;
const EARTH_RADIUS_M = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ZoneGeo extends GeoPoint {
  radius: number;
}

/** Distancia en metros entre dos puntos (fórmula del semiverseno). */
export function zoneDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** ¿La zona tiene coordenadas propias? */
export function hasCoordinates(zone: Zone): zone is Zone & GeoPoint {
  return zone.latitude !== undefined && zone.longitude !== undefined;
}

/**
 * Centro y radio efectivos de una zona: los suyos; la zona home, si no tiene, los de los ajustes
 * del proyecto y radio 100 m. undefined si una zona que no es home no tiene coordenadas.
 */
export function zoneGeo(zone: Zone, project: Pick<Project, 'settings'>): ZoneGeo | undefined {
  const radius = zone.radius ?? DEFAULT_ZONE_RADIUS;
  if (hasCoordinates(zone)) return { latitude: zone.latitude, longitude: zone.longitude, radius };
  if (zone.kind !== 'home') return undefined;
  const settings = { ...defaultSettings(), ...project.settings };
  return { latitude: settings.latitude, longitude: settings.longitude, radius };
}

export type ZoneConflict =
  | { kind: 'overlap'; zoneIds: [Id, Id]; distanceMeters: number; message: string }
  | { kind: 'missing_coordinates'; zoneIds: [Id]; message: string };

/**
 * Zonas solapadas (con home o entre sí: la distancia entre centros es menor que la suma de los
 * radios) y zonas sin coordenadas (salvo home, que usa las de los ajustes).
 */
export function zoneConflicts(project: Pick<Project, 'zones' | 'settings'>): ZoneConflict[] {
  const zones = projectZones(project);
  const result: ZoneConflict[] = [];
  const located: { zone: Zone; geo: ZoneGeo }[] = [];
  for (const zone of zones) {
    const geo = zoneGeo(zone, project);
    if (geo) located.push({ zone, geo });
    else result.push({ kind: 'missing_coordinates', zoneIds: [zone.id], message: `La zona «${zone.name}» no tiene coordenadas: no se podrá saber cuándo se entra o se sale de ella` });
  }
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i];
      const b = located[j];
      if (!a || !b) continue;
      const d = zoneDistanceMeters(a.geo, b.geo);
      if (d >= a.geo.radius + b.geo.radius) continue;
      result.push({
        kind: 'overlap',
        zoneIds: [a.zone.id, b.zone.id],
        distanceMeters: Math.round(d),
        message: `Las zonas «${a.zone.name}» y «${b.zone.name}» se solapan (centros a ${Math.round(d)} m y radios de ${a.geo.radius} + ${b.geo.radius} m): una persona puede estar en las dos`,
      });
    }
  }
  return result;
}
