import { describe, expect, it } from 'vitest';
import { applyService } from './services';
import { isKnownService, serviceName, servicesForDomain } from './serviceCatalog';

const DOMAINS = ['light', 'switch', 'fan', 'cover', 'lock', 'climate', 'media_player', 'vacuum', 'camera', 'button'];

/** Servicios que implementa services.ts (applyService), por dominio. */
const SUPPORTED: Record<string, string[]> = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  fan: ['turn_on', 'turn_off', 'toggle', 'set_percentage'],
  cover: ['open_cover', 'close_cover', 'stop_cover', 'toggle', 'set_cover_position'],
  lock: ['lock', 'unlock', 'open'],
  climate: ['set_temperature', 'set_hvac_mode', 'set_preset_mode', 'turn_on', 'turn_off', 'toggle'],
  media_player: ['turn_on', 'turn_off', 'toggle', 'media_play', 'media_pause', 'media_stop', 'media_play_pause', 'media_next_track', 'media_previous_track', 'play_media', 'volume_set', 'volume_up', 'volume_down', 'volume_mute', 'select_source'],
  vacuum: ['start', 'pause', 'stop', 'start_pause', 'return_to_base'],
  camera: ['turn_on', 'turn_off', 'snapshot', 'record'],
  button: ['press'],
};

describe('serviceCatalog (B6)', () => {
  it.each(DOMAINS)('%s: cubre todo lo que soporta services.ts y nada más', (domain) => {
    const services = servicesForDomain(domain, { presetModes: ['eco'] }).map((s) => s.service);
    expect(services.sort()).toEqual((SUPPORTED[domain] ?? []).map((s) => `${domain}.${s}`).sort());
    for (const full of services) {
      const service = full.split('.')[1] ?? '';
      expect(applyService(domain, service, { state: 'off', attributes: {} }, {}, { now: 0, capabilities: { presetModes: ['eco'] } })).toBeDefined();
    }
  });

  it('nombres en español y sensores sin servicios', () => {
    expect(serviceName('light.turn_on')).toBe('Encender');
    expect(serviceName('cover.set_cover_position')).toBe('Fijar posición');
    expect(serviceName('foo.bar')).toBe('foo.bar');
    expect(servicesForDomain('sensor')).toEqual([]);
    expect(servicesForDomain('binary_sensor')).toEqual([]);
    expect(servicesForDomain('homeassistant').map((s) => s.service)).toEqual(['homeassistant.turn_on', 'homeassistant.turn_off', 'homeassistant.toggle']);
    expect(isKnownService('vacuum.start')).toBe(true);
    expect(isKnownService('vacuum.volar')).toBe(false);
  });

  it('los campos de la luz dependen de sus capacidades', () => {
    const onoff = servicesForDomain('light', { colorModes: ['onoff'] }).find((s) => s.service === 'light.turn_on');
    expect(onoff?.fields).toEqual([]);
    const color = servicesForDomain('light', { colorModes: ['color_temp', 'rgb'], minKelvin: 2200, maxKelvin: 4000 }).find((s) => s.service === 'light.turn_on');
    expect(color?.fields.map((f) => f.key)).toEqual(['brightness_pct', 'brightness_step_pct', 'color_temp_kelvin', 'rgb_color']);
    expect(color?.fields.find((f) => f.key === 'color_temp_kelvin')).toMatchObject({ type: 'kelvin', min: 2200, max: 4000, unit: 'K' });
    expect(color?.fields.find((f) => f.key === 'brightness_pct')).toMatchObject({ type: 'percent', min: 0, max: 100 });
  });

  it('termostato, multimedia y persiana con campos tipados', () => {
    const climate = servicesForDomain('climate', { hvacModes: ['off', 'heat'], minTemp: 5, maxTemp: 30, tempStep: 0.5 });
    expect(climate.find((s) => s.service === 'climate.set_temperature')?.fields[0]).toMatchObject({ key: 'temperature', type: 'temperature', min: 5, max: 30, step: 0.5, unit: '°C' });
    expect(climate.find((s) => s.service === 'climate.set_hvac_mode')?.fields[0]?.options).toEqual([
      { value: 'off', label: 'Apagado' },
      { value: 'heat', label: 'Calefacción' },
    ]);
    expect(climate.some((s) => s.service === 'climate.set_preset_mode')).toBe(false);
    const media = servicesForDomain('media_player', { sources: ['TV', 'HDMI 1'] });
    expect(media.find((s) => s.service === 'media_player.select_source')?.fields[0]).toMatchObject({ type: 'select', options: [{ value: 'TV', label: 'TV' }, { value: 'HDMI 1', label: 'HDMI 1' }] });
    expect(media.find((s) => s.service === 'media_player.volume_mute')?.fields[0]?.type).toBe('boolean');
    expect(servicesForDomain('cover').find((s) => s.service === 'cover.set_cover_position')?.fields[0]).toMatchObject({ key: 'position', type: 'percent' });
  });
});
