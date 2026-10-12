import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { parseProject } from '../store/projectSchema';
import { validateProject } from '../network/validator';
import { projectToPackages } from '../export/packages';
import { parseYaml } from '../automations/yaml-parse';
import { isYamlMap } from '../export/yaml';
import type { Project } from '../types';
import { DEFAULT_ZONE_RADIUS, zoneConflicts, zoneDistanceMeters, zoneGeo } from './zones';

const MADRID = { latitude: 40.4168, longitude: -3.7038 };
const BARCELONA = { latitude: 41.3874, longitude: 2.1686 };

describe('zonas con coordenadas', () => {
  it('distancia haversine', () => {
    expect(zoneDistanceMeters(MADRID, MADRID)).toBe(0);
    const d = zoneDistanceMeters(MADRID, BARCELONA);
    expect(d).toBeGreaterThan(495_000);
    expect(d).toBeLessThan(510_000);
    expect(zoneDistanceMeters(MADRID, BARCELONA)).toBeCloseTo(zoneDistanceMeters(BARCELONA, MADRID), 6);
  });

  it('la zona home toma los ajustes y radio 100', () => {
    const p = { settings: { ...createDemoProject().settings!, latitude: 37.39, longitude: -5.98 } };
    expect(zoneGeo({ id: 'h', name: 'Casa', kind: 'home' }, p)).toEqual({ latitude: 37.39, longitude: -5.98, radius: DEFAULT_ZONE_RADIUS });
    expect(zoneGeo({ id: 'w', name: 'Trabajo', kind: 'work' }, p)).toBeUndefined();
    expect(zoneGeo({ id: 'w', name: 'Trabajo', kind: 'work', ...BARCELONA, radius: 250 }, p)).toEqual({ ...BARCELONA, radius: 250 });
  });

  it('detecta solapes y zonas sin coordenadas; el validador los informa', () => {
    const demo = createDemoProject();
    const p: Project = {
      ...demo,
      settings: { ...demo.settings!, ...MADRID },
      zones: [
        { id: 'cerca', name: 'Vecino', kind: 'other', latitude: MADRID.latitude + 0.0005, longitude: MADRID.longitude, radius: 50 },
        { id: 'lejos', name: 'Oficina', kind: 'work', ...BARCELONA },
        { id: 'sin', name: 'Gimnasio', kind: 'other' },
      ],
    };
    const conflicts = zoneConflicts(p);
    expect(conflicts.find((c) => c.kind === 'overlap')?.zoneIds).toEqual(['home', 'cerca']);
    expect(conflicts.filter((c) => c.kind === 'overlap')).toHaveLength(1);
    expect(conflicts.find((c) => c.kind === 'missing_coordinates')?.zoneIds).toEqual(['sin']);
    const codes = validateProject(p, catalog).map((i) => `${i.severity}:${i.code}`);
    expect(codes).toContain('warning:zona-solapada');
    expect(codes).toContain('info:zona-sin-coordenadas');
  });

  it('packages: activas con coordenadas, pasivas con TODO sin ellas; la guía se adapta', () => {
    const demo = createDemoProject();
    const p: Project = { ...demo, zones: [{ id: 'lejos', name: 'Oficina', kind: 'work', ...BARCELONA, radius: 300 }, { id: 'sin', name: 'Gimnasio', kind: 'other' }] };
    const files = new Map(projectToPackages(p, catalog).map((f) => [f.path, f.content]));
    const general = files.get('packages/general.yaml') ?? '';
    const root = parseYaml(general);
    const zones = isYamlMap(root) && Array.isArray(root.zone) ? root.zone : [];
    expect(zones[0]).toEqual({ name: 'Oficina', latitude: BARCELONA.latitude, longitude: BARCELONA.longitude, radius: 300, icon: 'mdi:briefcase' });
    expect(zones[1]).toMatchObject({ name: 'Gimnasio', passive: true });
    expect(general).toContain('TODO: coordenadas reales de «Gimnasio»');
    expect(general).not.toContain('«Oficina» (ahora');
    const guide = files.get('GUIA_EMPAREJAMIENTO.md') ?? '';
    expect(guide).toContain('**Oficina** ya tienen coordenadas');
    expect(guide).toContain('Ajusta las coordenadas de **Gimnasio**');
  });

  it('projectSchema valida los rangos', () => {
    const base = createDemoProject();
    const withZone = (z: object) => ({ ...base, zones: [{ id: 'z', name: 'Z', kind: 'other', ...z }] });
    expect(parseProject(withZone({ ...BARCELONA, radius: 200 })).zones?.[0]).toMatchObject({ ...BARCELONA, radius: 200 });
    expect(() => parseProject(withZone({ latitude: 91, longitude: 0 }))).toThrow(/latitude debe estar entre -90 y 90/);
    expect(() => parseProject(withZone({ latitude: 0, longitude: 181 }))).toThrow(/longitude debe estar entre -180 y 180/);
    expect(() => parseProject(withZone({ radius: 5 }))).toThrow(/radius debe estar entre 10 y 50000/);
    expect(() => parseProject(withZone({ latitude: 10 }))).toThrow(/latitud y longitud a la vez/);
  });
});
