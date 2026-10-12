// Tanda 3: importación desde un Home Assistant real con registros y YAML de ejemplo.
import { describe, expect, it } from 'vitest';
import automationsYaml from './fixtures/automations.yaml?raw';
import scenesYaml from './fixtures/scenes.yaml?raw';
import scriptsYaml from './fixtures/scripts.yaml?raw';
import deviceRegistry from './fixtures/core.device_registry.json?raw';
import areaRegistry from './fixtures/core.area_registry.json?raw';
import entityRegistry from './fixtures/core.entity_registry.json?raw';
import { allDefinitions, catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { validateProject } from '../network/validator';
import { createSimulationState, runAutomation } from '../simulation/engine';
import {
  applyImportPlan,
  brandOf,
  buildImportPlan,
  importAutomationsYaml,
  importRegistries,
  importScenesYaml,
  importScriptsYaml,
  matchCatalog,
  textSimilarity,
} from './haImport';

const base = () => project([dev('srv', 'ha-green', undefined, { name: 'Home Assistant' }), dev('router', 'tplink-deco-x50', undefined, { name: 'Router' })]);

describe('matchCatalog', () => {
  it('reconoce fabricantes y modelos por alias, modelo exacto y similitud', () => {
    expect(brandOf('IKEA of Sweden')).toBe('IKEA');
    expect(brandOf('_TZ3000_kdi2o9m6')).toBe('Tuya');
    expect(brandOf('Signify Netherlands B.V.')).toBe('Philips Hue');
    expect(matchCatalog('LUMI', 'lumi.sensor_magnet.aq2', 'zha')?.definition.id).toBe('aqara-door-window');
    expect(matchCatalog('IKEA of Sweden', 'TRADFRI bulb E27 WS opal 980lm', 'zha')).toMatchObject({ score: 1, reason: 'alias' });
    expect(matchCatalog('Aqara', 'SJCGQ11LM', 'zigbee2mqtt')).toMatchObject({ reason: 'modelo', definition: { id: 'aqara-water-leak' } });
    expect(matchCatalog('Sonos', 'Era 100', 'sonos')?.definition.id).toBe('sonos-era-100');
    expect(matchCatalog('Roborock', 'Roborock S8 Pro Ultra', 'roborock')?.definition.id).toBe('roborock-s8');
    expect(matchCatalog('Xiaomi', 'zhimi.airpurifier.mb3', 'xiaomi_miio')).toBeUndefined();
    expect(matchCatalog('ACME', 'Cosa rara', undefined)).toBeUndefined();
    expect(textSimilarity('Era 100', 'era100')).toBe(1);
  });
});

describe('importRegistries', () => {
  it('propone salas, dispositivos del catálogo, personalizados y el mapeo de entity_id', () => {
    const p = importRegistries({ deviceRegistry, areaRegistry, entityRegistry }, catalog, base());
    expect(p.rooms.map((r) => r.name)).toEqual(['Salón', 'Cocina', 'Dormitorio']);
    const byHa = Object.fromEntries(p.matches.map((m) => [m.haDeviceId, m]));
    expect(byHa['4f1d0c2b9a7e']).toMatchObject({ definitionId: 'ikea-tradfri-e27-ws', custom: false, name: 'Lámpara salón', roomId: 'area-salon' });
    expect(byHa['7a8b9c0d1e2f']?.definitionId).toBe('aqara-door-window');
    expect(byHa.c0c1n4?.definitionId).toBe('shelly-1pm-gen3');
    expect(byHa.sonosera?.definitionId).toBe('sonos-era-100');
    expect(byHa['9c0ffee00001']?.definitionId).toBe('sonoff-zbdongle-p');
    expect(byHa.purif3h?.custom).toBe(true);
    expect(byHa.metno).toBeUndefined();
    const custom = p.customDefinitions[0];
    expect(custom?.id.startsWith('custom:')).toBe(true);
    expect(custom?.entities.map((e) => `${e.domain}:${e.key}`)).toEqual(['fan:fan', 'sensor:pm2_5', 'sensor:humidity']);
    expect(p.warnings.some((w) => w.message.includes('dominio «select»'))).toBe(true);
    expect(p.warnings.some((w) => w.message.includes('servicio de HA'))).toBe(true);
    // HA → simulador: la luz renombrada por el usuario, la ventana (opening → door) y el purificador.
    expect(p.entityMap['light.salon_techo']).toBe('light.lampara_salon');
    expect(p.entityMap['binary_sensor.ventana_salon_opening']).toBe('binary_sensor.ventana_salon_door');
    // Mismo entity_id en los dos lados: no hace falta mapeo.
    expect(p.entityMap['sensor.ventana_salon_battery']).toBeUndefined();
    expect(p.entityMap['switch.luz_cocina']).toBe('switch.luz_cocina_switch');
    expect(p.entityMap['fan.purificador']).toBe('fan.purificador_fan');
    expect(p.entityMap['media_player.altavoz_salon']).toBeUndefined();
  });

  it('un JSON roto lanza un error en español', () => {
    expect(() => importRegistries({ deviceRegistry: '{no' }, catalog)).toThrow('core.device_registry: no es un JSON válido');
    expect(() => importRegistries({ areaRegistry: '{"data": {}}' }, catalog)).toThrow('data.areas');
  });
});

describe('YAML de HA', () => {
  it('importa la lista completa de automations.yaml con avisos y entidades desconocidas', () => {
    const r = importAutomationsYaml(automationsYaml, base(), catalog);
    expect(r.automations.map((a) => a.name)).toEqual(['Ventana abierta apaga el altavoz', 'Luces al atardecer', 'Purificador con polvo', 'Con un dispositivo que ya no existe']);
    expect(r.automations[1]?.conditions[0]).toMatchObject({ type: 'time', weekday: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    expect(r.automations[2]?.triggers[0]).toMatchObject({ type: 'numeric_state', for: 300 });
    expect(r.warnings.find((w) => w.path === '[4]')?.message).toContain('geo_location');
    expect(r.warnings.some((w) => w.path === '[0].description')).toBe(true);
    expect(r.unknownEntities).toContain('binary_sensor.puerta_garaje');
    expect(r.unknownEntities).toContain('scene.cine');
  });

  it('importa scenes.yaml y scripts.yaml', () => {
    const s = importScenesYaml(scenesYaml, base(), catalog);
    expect(s.scenes[0]?.name).toBe('Cine');
    expect(s.scenes[0]?.entities['light.salon_techo']).toEqual({ state: 'on', attributes: { brightness: 60, color_temp_kelvin: 2700, friendly_name: 'Lámpara salón' } });
    expect(s.scenes[0]?.entities['switch.luz_cocina']).toEqual({ state: 'off' });
    const sc = importScriptsYaml(scriptsYaml, base(), catalog);
    expect(sc.scripts[0]).toMatchObject({ id: 'buenas_noches', name: 'Buenas noches' });
    expect(sc.scripts[0]?.sequence).toHaveLength(3);
    expect(sc.warnings.map((w) => w.path)).toEqual(['buenas_noches.mode']);
  });
});

describe('buildImportPlan y applyImportPlan', () => {
  it('reescribe las referencias con el mapeo y el proyecto resultante simula', () => {
    const project0 = base();
    const plan = buildImportPlan(project0, catalog, { deviceRegistry, areaRegistry, entityRegistry, automationsYaml, scenesYaml, scriptsYaml });
    const luces = plan.automations.find((a) => a.name === 'Luces al atardecer');
    expect(luces?.actions[0]).toMatchObject({ entityId: 'light.lampara_salon' });
    expect(luces?.actions[2]).toMatchObject({ type: 'scene', sceneId: '1700000000100' });
    expect(plan.scenes[0]?.entities['light.lampara_salon']?.state).toBe('on');
    expect(plan.scripts[0]?.sequence[0]).toMatchObject({ entityId: 'light.lampara_salon', targets: { entityIds: ['switch.luz_cocina_switch'] } });
    expect(plan.unknownEntities).toEqual(['binary_sensor.puerta_garaje', 'light.garaje']);
    const next = applyImportPlan(project0, plan);
    expect(next.devices).toHaveLength(project0.devices.length + 6);
    expect(next.customDefinitions).toHaveLength(1);
    expect(next.connections.length).toBeGreaterThan(0);
    const issues = validateProject(next, catalog);
    expect(issues.filter((i) => i.code === 'definicion-desconocida')).toEqual([]);
    expect(issues.filter((i) => i.code === 'entidad-desconocida').map((i) => i.ref?.entityId).sort()).toEqual(['binary_sensor.puerta_garaje', 'light.garaje']);
    const sim0 = createSimulationState(next, allDefinitions(next), Date.UTC(2026, 9, 12, 20));
    expect(sim0.entities['fan.purificador_fan']?.state).toBe('off');
    const sim = runAutomation(sim0, next, plan.automations.find((a) => a.name === 'Purificador con polvo')?.id ?? '', { skipConditions: true });
    expect(sim.entities['fan.purificador_fan']?.state).toBe('on');
  });
});
