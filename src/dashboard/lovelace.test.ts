import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { parseYaml } from '../automations/yaml-parse';
import { isYamlMap } from '../export/yaml';
import { countCards, dashboardToYaml, generateDashboard, type DashboardCard } from './lovelace';

describe('generateDashboard', () => {
  const demo = { ...createDemoProject(), people: [{ id: 'ana', name: 'Ana' }], groups: [{ id: 'g', name: 'Salón', domain: 'light' as const, entityIds: ['light.luz_salon'] }] };
  const dash = generateDashboard(demo, catalog);
  const cards = (viewIndex: number, room: string): DashboardCard[] =>
    dash.views[viewIndex]?.sections.find((s) => s.cards[0]?.type === 'heading' && s.cards[0].heading === room)?.cards ?? [];

  it('una vista por planta y una sección por sala', () => {
    expect(dash.views.map((v) => v.title)).toEqual(['Planta baja', 'Primera planta']);
    expect(dash.views[0]?.path).toBe('planta-baja');
    expect(cards(0, 'Salón').length).toBeGreaterThan(1);
    expect(cards(1, 'Dormitorio').length).toBeGreaterThan(1);
  });

  it('elige la tarjeta según el dominio', () => {
    const salon = cards(0, 'Salón');
    expect(salon).toContainEqual({ type: 'thermostat', entity: 'climate.termostato_climate' });
    expect(salon).toContainEqual({ type: 'media-control', entity: 'media_player.televisor' });
    expect(salon).toContainEqual({ type: 'tile', entity: 'light.luz_salon' });
    expect(salon).toContainEqual({ type: 'tile', entity: 'light.grupo_salon' });
    const entrada = cards(0, 'Entrada');
    expect(entrada).toContainEqual({ type: 'picture-glance', title: 'Cámara entrada', camera_image: 'camera.camara_entrada_camera', entities: ['binary_sensor.camara_entrada_motion'] });
    const pasillo = cards(0, 'Pasillo');
    expect(pasillo.find((c) => c.type === 'entities')).toMatchObject({ entities: expect.arrayContaining(['binary_sensor.movimiento_pasillo_motion']) });
  });

  it('personas en la primera vista', () => {
    expect(dash.views[0]?.sections[0]?.cards).toContainEqual({ type: 'tile', entity: 'person.ana' });
    expect(countCards(dash)).toBeGreaterThan(10);
  });

  it('dashboardToYaml produce YAML legible por el parser', () => {
    const text = dashboardToYaml(dash);
    const root = parseYaml(text);
    expect(isYamlMap(root)).toBe(true);
    expect(text).toContain('type: sections');
    expect(text).toContain('type: thermostat');
    expect(text).toContain('camera_image: camera.camara_entrada_camera');
  });
});
