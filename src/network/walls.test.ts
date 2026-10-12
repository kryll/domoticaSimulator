import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, FLOOR, project } from '../devices/testUtils';
import type { Floor, Project, Wall } from '../types';
import { isInRange } from './coverage';
import { analyzeMesh } from './mesh';
import {
  heatSourcesFor,
  isInRangeWithWalls,
  linkQuality,
  lqiFromMargin,
  rssiHeatmap,
  segmentsIntersect,
  suggestRouterPlacement,
  WALL_ATTENUATION_DB,
  wallsCrossed,
} from './walls';

const wall = (x: number, material: Wall['material'] = 'concrete'): Wall => ({ a: { x, y: -1000 }, b: { x, y: 1000 }, material });

function withWalls(p: Project, walls: Wall[]): Project {
  return { ...p, floors: p.floors.map((f): Floor => (f.id === FLOOR.id ? { ...f, walls } : f)) };
}

describe('paredes y cobertura', () => {
  it('intersección de segmentos', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 })).toBe(false);
    expect(wallsCrossed({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall(50), wall(150)])).toHaveLength(1);
  });

  it('linkQuality coincide con el alcance sin paredes y empeora con ellas', () => {
    const coord = dev('c', 'sonoff-zbdongle-p', { x: 0, y: 0 });
    const near = dev('l', 'ikea-tradfri-e27-ws', { x: 500, y: 0 }, { integration: 'zha' }); // 10 m
    const p = project([coord, near]);
    const free = linkQuality(near, coord, p, catalog);
    expect(free?.inRange).toBe(true);
    expect(free?.walls).toBe(0);
    expect(free?.lqi).toBeGreaterThan(0);
    const blocked = linkQuality(near, coord, withWalls(p, [wall(100), wall(200), wall(300)]), catalog);
    expect(blocked?.walls).toBe(3);
    expect(blocked?.wallLossDb).toBe(3 * WALL_ATTENUATION_DB.concrete);
    expect(blocked?.rssi).toBeLessThan(free?.rssi ?? 0);
    expect(blocked?.inRange).toBe(false);
    expect(lqiFromMargin(-5)).toBe(0);
    expect(lqiFromMargin(100)).toBe(255);
  });

  it('sin paredes, isInRangeWithWalls equivale a isInRange', () => {
    const a = dev('c', 'sonoff-zbdongle-p', { x: 0, y: 0 });
    for (const x of [100, 900, 990, 1010, 1500]) {
      const b = dev('l', 'ikea-tradfri-e27-ws', { x, y: 0 }, { integration: 'zha' });
      const p = project([a, b]);
      expect(isInRangeWithWalls(a, b, catalog, p, 'zigbee')).toBe(isInRange(a, b, catalog, p.floors, 'zigbee'));
    }
  });

  it('analyzeMesh tiene en cuenta las paredes', () => {
    const server = dev('s', 'ha-green', { x: 0, y: 0 });
    const coord = dev('c', 'sonoff-zbdongle-p', { x: 0, y: 0 });
    const lamp = dev('l', 'ikea-tradfri-e27-ws', { x: 600, y: 0 }, { integration: 'zha' });
    const p = project([server, coord, lamp], { connections: [{ id: 'k', sourceId: 'c', targetId: 's', protocol: 'zigbee' }] });
    expect(analyzeMesh(p, catalog).reachable.has('l')).toBe(true);
    expect(analyzeMesh(withWalls(p, [wall(100), wall(300)]), catalog).reachable.has('l')).toBe(false);
    expect(analyzeMesh(withWalls(p, [wall(100, 'glass')]), catalog).reachable.has('l')).toBe(true);
  });

  it('mapa de calor con paredes', () => {
    const floor: Floor = { ...FLOOR, walls: [wall(250)] };
    const map = rssiHeatmap(floor, [{ position: { x: 0, y: 0 }, protocol: 'zigbee', rangeMeters: 20 }], { x0: 0, y0: 0, width: 500, height: 100, step: 100 });
    expect(map.cols).toBe(5);
    expect(map.rows).toBe(1);
    const row = map.rssi[0] ?? [];
    expect(row[0]).toBeGreaterThan(row[1] ?? 0);
    // salto por la pared entre la columna 2 (x=250 justo en la pared: centro 250 no cruza) y la 3
    const dropAcross = (row[2] ?? 0) - (row[3] ?? 0);
    const dropBefore = (row[1] ?? 0) - (row[2] ?? 0);
    expect(dropAcross).toBeGreaterThan(dropBefore);
    expect(heatSourcesFor(project([dev('c', 'sonoff-zbdongle-p')]), catalog, FLOOR.id, 'zigbee')).toHaveLength(1);
  });

  it('sugiere dónde poner un router', () => {
    const server = dev('s', 'ha-green', { x: 0, y: 0 });
    const coord = dev('c', 'sonoff-zbdongle-p', { x: 0, y: 0 });
    const sensor = dev('t', 'aqara-temp-hum', { x: 2200, y: 0 }, { integration: 'zha' }); // 44 m
    const p = project([server, coord, sensor], { connections: [{ id: 'k', sourceId: 'c', targetId: 's', protocol: 'zigbee' }] });
    const [s] = suggestRouterPlacement(p, catalog);
    expect(s?.deviceIds).toEqual(['t']);
    expect(s?.protocol).toBe('zigbee');
    expect(s?.position.x).toBeGreaterThan(800);
    expect(s?.position.x).toBeLessThan(2200);
    expect(s?.reason).toMatch(/Un router aquí/);
    expect(suggestRouterPlacement(project([server, coord]), catalog)).toEqual([]);
  });
});
