import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { scenesToYaml } from '../export/yaml';
import { callService, captureSceneEntities, createSimulationState, tick } from './engine';

const p = project([
  dev('l', 'hue-white-color-e27', undefined, { name: 'Luz' }),
  dev('c', 'shelly-2pm-gen3-cover', undefined, { name: 'Persiana' }),
  dev('t', 'netatmo-thermostat', undefined, { name: 'Termo' }),
  dev('m', 'sonos-era-100', undefined, { name: 'Altavoz' }),
  dev('k', 'aqara-u200', undefined, { name: 'Cerradura' }),
]);

describe('captureSceneEntities (C7)', () => {
  it('guarda solo estado y atributos relevantes por dominio', () => {
    let sim = createSimulationState(p, catalog, Date.UTC(2026, 0, 1, 12));
    sim = callService(sim, p, 'light.luz', 'light.turn_on', { brightness: 100, rgb_color: [255, 0, 0] });
    sim = callService(sim, p, 'cover.persiana_cover', 'cover.set_cover_position', { position: 30 });
    sim = callService(sim, p, 'media_player.altavoz', 'media_player.volume_set', { volume_level: 0.5 });
    sim = tick(sim, p, 30_000);
    const scene = captureSceneEntities(sim, ['light.luz', 'cover.persiana_cover', 'climate.termo_climate', 'media_player.altavoz', 'lock.cerradura_lock', 'light.nada']);
    expect(scene).toEqual({
      'light.luz': { state: 'on', attributes: { brightness: 100, color_mode: 'rgb', rgb_color: '[255, 0, 0]' } },
      'cover.persiana_cover': { state: 'open', attributes: { current_position: 30 } },
      'climate.termo_climate': { state: 'heat', attributes: { temperature: 21 } },
      'media_player.altavoz': { state: 'idle', attributes: { volume_level: 0.5, is_volume_muted: false, source: 'Line-in' } },
      'lock.cerradura_lock': { state: 'locked' },
    });
    const off = captureSceneEntities(callService(sim, p, 'light.luz', 'light.turn_off'), ['light.luz']);
    expect(off).toEqual({ 'light.luz': { state: 'off' } });
  });

  it('scenesToYaml limpia atributos y exporta rgb_color como lista', () => {
    const yaml = scenesToYaml({
      ...p,
      scenes: [
        {
          id: 's',
          name: 'Cine',
          entities: {
            'light.luz': { state: 'on', attributes: { brightness: 40, color_mode: 'rgb', rgb_color: '[255, 120, 40]', friendly_name: 'Luz', device_class: 'x' } },
            'sensor.x': { state: 3, attributes: { unit_of_measurement: '°C' } },
          },
        },
      ],
    });
    expect(yaml).not.toMatch(/friendly_name|device_class|unit_of_measurement/);
    expect(yaml).toMatch(/rgb_color:\n\s+- 255\n\s+- 120\n\s+- 40/);
  });
});
