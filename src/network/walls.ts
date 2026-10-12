// Cobertura con paredes (B21): pérdidas por trayecto (log-distancia) y atenuación por material.
// El modelo está calibrado para que, sin paredes, el alcance coincida con el de coverage.ts.
import type { Device, DeviceDefinition, Floor, Id, Point, Project, Protocol, Wall, WallMaterial } from '../types';
import { canConnect, isWiredLink } from './connections';
import { DEFAULT_RANGE_METERS, distanceMeters, FLOOR_ATTENUATION, FLOOR_HEIGHT_METERS, isInRange, rangeForProtocol } from './coverage';
import { analyzeMesh } from './mesh';
import { isInfra, MESH_PROTOCOLS } from '../devices/roles';
import { allDefinitions } from '../devices/catalog';

/** Atenuación por pared en dB según el material. */
export const WALL_ATTENUATION_DB: Record<WallMaterial, number> = {
  drywall: 3,
  glass: 2,
  brick: 8,
  concrete: 15,
};

export const WALL_MATERIAL_LABELS: Record<WallMaterial, string> = {
  drywall: 'Pladur',
  glass: 'Cristal',
  brick: 'Ladrillo',
  concrete: 'Hormigón',
};

/** Pérdida a 1 m (dB) y exponente de trayecto en interiores. */
export const PATH_LOSS_1M_DB = 40;
export const PATH_LOSS_EXPONENT = 2.5;
/** Pérdida equivalente de un forjado (la misma reducción de alcance que FLOOR_ATTENUATION). */
export const FLOOR_LOSS_DB = -10 * PATH_LOSS_EXPONENT * Math.log10(FLOOR_ATTENUATION);

/** Potencia de emisión típica por protocolo (dBm). */
export const TX_POWER_DBM: Record<Protocol, number> = {
  wifi: 20,
  ethernet: 0,
  zigbee: 8,
  zwave: 4,
  thread: 8,
  matter: 20,
  ble: 4,
  rf433: 10,
};

/** Pérdida de trayecto en espacio interior (dB) a `meters` (mínimo 1 m). */
export function pathLossDb(meters: number): number {
  return PATH_LOSS_1M_DB + 10 * PATH_LOSS_EXPONENT * Math.log10(Math.max(1, meters));
}

/** Sensibilidad equivalente: la RSSI a la distancia de alcance sin obstáculos. */
export function sensitivityDbm(protocol: Protocol, rangeMeters: number): number {
  return TX_POWER_DBM[protocol] - pathLossDb(rangeMeters);
}

/** ¿Se cortan los segmentos p1-p2 y q1-q2? (los extremos que solo se tocan no cuentan). */
export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(q1, q2, p1);
  const d2 = d(q1, q2, p2);
  const d3 = d(p1, p2, q1);
  const d4 = d(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Paredes de la planta que cruza el segmento a-b. */
export function wallsCrossed(a: Point, b: Point, walls: readonly Wall[]): Wall[] {
  return walls.filter((w) => segmentsIntersect(a, b, w.a, w.b));
}

export function wallLossDb(walls: readonly Wall[]): number {
  return walls.reduce((acc, w) => acc + WALL_ATTENUATION_DB[w.material], 0);
}

/** Calidad de enlace (LQI 0-255) a partir del margen sobre la sensibilidad: 0 dB → 0, 40 dB o más → 255. */
export function lqiFromMargin(marginDb: number): number {
  return Math.max(0, Math.min(255, Math.round((marginDb / 40) * 255)));
}

export interface LinkQuality {
  protocol: Protocol;
  distanceMeters: number;
  /** RSSI estimada (dBm). */
  rssi: number;
  /** LQI estimado (0-255). */
  lqi: number;
  /** Paredes atravesadas y su pérdida total. */
  walls: number;
  wallLossDb: number;
  /** Margen sobre la sensibilidad (dB). */
  marginDb: number;
  inRange: boolean;
  /** Enlace cableado: no depende de la radio (RSSI y LQI máximos). */
  wired: boolean;
}

function floorOf(project: Pick<Project, 'floors'>, id: Id): Floor | undefined {
  return project.floors.find((f) => f.id === id);
}

/** ¿Hay paredes en alguna de las plantas de los dispositivos? */
export function hasWalls(project: Pick<Project, 'floors'>, a: Device, b: Device): boolean {
  return [a.floorId, b.floorId].some((id) => (floorOf(project, id)?.walls?.length ?? 0) > 0);
}

/**
 * RSSI y LQI estimados entre dos dispositivos: log-distancia con el alcance de la pareja
 * (el mayor de los dos para el protocolo del enlace), pérdidas por paredes de sus plantas y por
 * forjados. Devuelve undefined si falta alguna definición o planta.
 */
export function linkQuality(a: Device, b: Device, project: Pick<Project, 'floors'>, defs: DeviceDefinition[]): LinkQuality | undefined {
  const da = defs.find((d) => d.id === a.definitionId);
  const db = defs.find((d) => d.id === b.definitionId);
  const fa = floorOf(project, a.floorId);
  const fb = floorOf(project, b.floorId);
  if (!da || !db || !fa || !fb) return undefined;
  const r = canConnect(a, b, defs);
  const protocol = r.ok ? r.protocol : a.protocol;
  const ppm = (fa.pixelsPerMeter + fb.pixelsPerMeter) / 2;
  const horizontal = distanceMeters(a.position, b.position, { ...fa, pixelsPerMeter: ppm });
  const levels = Math.abs(fa.level - fb.level);
  const distance = Math.hypot(horizontal, levels * FLOOR_HEIGHT_METERS);
  if (r.ok && isWiredLink(a, b, defs, protocol)) {
    return { protocol, distanceMeters: distance, rssi: 0, lqi: 255, walls: 0, wallLossDb: 0, marginDb: Infinity, inRange: true, wired: true };
  }
  const crossed = fa.id === fb.id ? wallsCrossed(a.position, b.position, fa.walls ?? []) : [...wallsCrossed(a.position, b.position, fa.walls ?? []), ...wallsCrossed(a.position, b.position, fb.walls ?? [])];
  const wallLoss = wallLossDb(crossed);
  const range = Math.max(rangeForProtocol(da, protocol), rangeForProtocol(db, protocol));
  const rssi = TX_POWER_DBM[protocol] - pathLossDb(distance) - wallLoss - levels * FLOOR_LOSS_DB;
  const margin = rssi - sensitivityDbm(protocol, range);
  return {
    protocol,
    distanceMeters: distance,
    rssi: Math.round(rssi * 10) / 10,
    lqi: lqiFromMargin(margin),
    walls: crossed.length,
    wallLossDb: wallLoss,
    marginDb: Math.round(margin * 10) / 10,
    inRange: range > 0 && margin >= 0,
    wired: false,
  };
}

/**
 * ¿Están a alcance teniendo en cuenta las paredes? Si ninguna de sus plantas tiene paredes se usa
 * el modelo sin paredes (isInRange) para no cambiar los resultados de los proyectos existentes.
 */
export function isInRangeWithWalls(a: Device, b: Device, defs: DeviceDefinition[], project: Pick<Project, 'floors'>, protocol?: Protocol): boolean {
  if (!hasWalls(project, a, b)) return isInRange(a, b, defs, project.floors, protocol);
  return linkQuality(a, b, project, defs)?.inRange ?? false;
}

// ---------- Mapa de calor ----------

export interface HeatSource {
  position: Point;
  protocol: Protocol;
  /** Alcance sin obstáculos (m). */
  rangeMeters: number;
}

export interface HeatGrid {
  /** Esquina superior izquierda y tamaño del área (px del lienzo). */
  x0: number;
  y0: number;
  width: number;
  height: number;
  /** Tamaño de celda (px). */
  step: number;
}

export interface Heatmap {
  grid: HeatGrid;
  cols: number;
  rows: number;
  /** values[fila][columna]: mejor margen en dB sobre la sensibilidad (≥ 0 = hay cobertura). */
  values: number[][];
  /** rssi[fila][columna]: mejor RSSI estimada (dBm). */
  rssi: number[][];
}

/** Mapa de RSSI en el centro de cada celda: la mejor fuente, con las paredes de la planta. */
export function rssiHeatmap(floor: Floor, sources: readonly HeatSource[], grid: HeatGrid): Heatmap {
  const step = Math.max(1, grid.step);
  const cols = Math.max(1, Math.ceil(grid.width / step));
  const rows = Math.max(1, Math.ceil(grid.height / step));
  const walls = floor.walls ?? [];
  const values: number[][] = [];
  const rssi: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const rowM: number[] = [];
    const rowR: number[] = [];
    for (let c = 0; c < cols; c++) {
      const p = { x: grid.x0 + (c + 0.5) * step, y: grid.y0 + (r + 0.5) * step };
      let bestMargin = -Infinity;
      let bestRssi = -Infinity;
      for (const s of sources) {
        const loss = pathLossDb(distanceMeters(s.position, p, floor)) + wallLossDb(wallsCrossed(s.position, p, walls));
        const value = TX_POWER_DBM[s.protocol] - loss;
        bestRssi = Math.max(bestRssi, value);
        bestMargin = Math.max(bestMargin, value - sensitivityDbm(s.protocol, s.rangeMeters));
      }
      rowM.push(Math.round(bestMargin * 10) / 10);
      rowR.push(Math.round(bestRssi * 10) / 10);
    }
    values.push(rowM);
    rssi.push(rowR);
  }
  return { grid: { ...grid, step }, cols, rows, values, rssi };
}

/** Fuentes de una planta para el mapa: infraestructura y routers que emiten en ese protocolo. */
export function heatSourcesFor(project: Project, defs: DeviceDefinition[], floorId: Id, protocol: Protocol): HeatSource[] {
  defs = allDefinitions(project, defs);
  const sources: HeatSource[] = [];
  for (const d of project.devices) {
    const def = defs.find((x) => x.id === d.definitionId);
    if (!def || d.floorId !== floorId || !def.protocols.includes(protocol)) continue;
    if (!isInfra(def) && def.role !== 'router') continue;
    const range = rangeForProtocol(def, protocol);
    if (range > 0) sources.push({ position: d.position, protocol, rangeMeters: range });
  }
  return sources;
}

// ---------- Sugerencias de routers ----------

export interface RouterSuggestion {
  floorId: Id;
  /** Posición propuesta (px del lienzo). */
  position: Point;
  protocol: Protocol;
  /** Dispositivos que quedarían cubiertos. */
  deviceIds: Id[];
  reason: string;
}

/**
 * Propone dónde poner un router de malla (Zigbee, Thread o Z-Wave) para cada dispositivo de malla
 * fuera de cobertura: el punto del segmento hacia el nodo alcanzable más cercano de su misma
 * planta y protocolo que maximiza el peor de los dos enlaces. Agrupa propuestas a menos de 2 m.
 */
export function suggestRouterPlacement(project: Project, defs: DeviceDefinition[]): RouterSuggestion[] {
  defs = allDefinitions(project, defs);
  const mesh = analyzeMesh(project, defs);
  const suggestions: RouterSuggestion[] = [];
  for (const id of mesh.unreachable) {
    const device = project.devices.find((d) => d.id === id);
    const def = device ? defs.find((d) => d.id === device.definitionId) : undefined;
    const floor = device ? floorOf(project, device.floorId) : undefined;
    if (!device || !def || !floor || !MESH_PROTOCOLS.includes(device.protocol)) continue;
    const anchors = project.devices.filter((o) => {
      if (o.id === device.id || !mesh.reachable.has(o.id) || o.floorId !== device.floorId) return false;
      const od = defs.find((x) => x.id === o.definitionId);
      return od !== undefined && od.protocols.includes(device.protocol) && (isInfra(od) || od.role === 'router');
    });
    const anchor = anchors.sort((x, y) => distanceMeters(x.position, device.position, floor) - distanceMeters(y.position, device.position, floor))[0];
    if (!anchor) continue;
    const routerRange = DEFAULT_RANGE_METERS[device.protocol];
    const anchorDef = defs.find((x) => x.id === anchor.definitionId);
    const anchorRange = Math.max(routerRange, anchorDef ? rangeForProtocol(anchorDef, device.protocol) : 0);
    const deviceRange = Math.max(routerRange, rangeForProtocol(def, device.protocol));
    const walls = floor.walls ?? [];
    const margin = (p: Point, q: Point, range: number): number =>
      TX_POWER_DBM[device.protocol] - pathLossDb(distanceMeters(p, q, floor)) - wallLossDb(wallsCrossed(p, q, walls)) - sensitivityDbm(device.protocol, range);
    let best = { x: (anchor.position.x + device.position.x) / 2, y: (anchor.position.y + device.position.y) / 2 };
    let bestScore = -Infinity;
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      const p = { x: anchor.position.x + (device.position.x - anchor.position.x) * t, y: anchor.position.y + (device.position.y - anchor.position.y) * t };
      const score = Math.min(margin(anchor.position, p, anchorRange), margin(p, device.position, deviceRange));
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const position = { x: Math.round(best.x), y: Math.round(best.y) };
    const near = suggestions.find((s) => s.floorId === floor.id && s.protocol === device.protocol && distanceMeters(s.position, position, floor) < 2);
    if (near) {
      near.deviceIds.push(device.id);
      continue;
    }
    const reason =
      bestScore >= 0
        ? `Un router aquí conectaría «${device.name}» con «${anchor.name}»`
        : `Ni con un router intermedio llega bien: «${device.name}» necesita más de un repetidor o un camino con menos paredes`;
    suggestions.push({ floorId: floor.id, position, protocol: device.protocol, deviceIds: [device.id], reason });
  }
  return suggestions;
}
