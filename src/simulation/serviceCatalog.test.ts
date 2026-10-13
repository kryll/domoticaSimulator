import { describe, expect, it } from 'vitest';
import { applyService } from './services';
import { catalog } from '../devices/catalog';
import { project } from '../devices/testUtils';
import { callService, createSimulationState, runActions } from './engine';
import { notifyAction } from './notify';
import { exclusiveConflicts, isKnownService, missingRequiredFields, serviceName, servicesForDomain } from './serviceCatalog';

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
  vacuum: ['start', 'pause', 'stop', 'start_pause', 'return_to_base', 'locate', 'clean_spot', 'clean_area', 'send_command'],
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

describe('campos excluyentes y obligatorios', () => {
  it('grupos excluyentes de la luz y detección de conflictos', () => {
    const fields = servicesForDomain('light', { colorModes: ['color_temp', 'rgb'] })[0]?.fields ?? [];
    expect(fields.map((f) => [f.key, f.exclusiveGroup])).toEqual([
      ['brightness_pct', 'brightness'],
      ['brightness_step_pct', 'brightness'],
      ['color_temp_kelvin', 'color'],
      ['rgb_color', 'color'],
    ]);
    expect(exclusiveConflicts('light.turn_on', { brightness_pct: 50, brightness_step_pct: 10 }).map((g) => g.map((f) => f.key))).toEqual([['brightness_pct', 'brightness_step_pct']]);
    expect(exclusiveConflicts('light.turn_on', { brightness_pct: 50, rgb_color: '[1, 2, 3]' })).toEqual([]);
  });

  it('campos obligatorios', () => {
    const required = DOMAINS.concat('notify')
      .flatMap((d) => servicesForDomain(d, { presetModes: ['eco'] }))
      .flatMap((s) => s.fields.filter((f) => f.required).map((f) => `${s.service}.${f.key}`));
    expect(required.sort()).toEqual(
      [
        'climate.set_hvac_mode.hvac_mode',
        'climate.set_preset_mode.preset_mode',
        'media_player.volume_set.volume_level',
        'media_player.volume_mute.is_volume_muted',
        'media_player.select_source.source',
        'media_player.play_media.media_content_id',
        'media_player.play_media.media_content_type',
        'cover.set_cover_position.position',
        'fan.set_percentage.percentage',
        'camera.snapshot.filename',
        'camera.record.filename',
        'notify.persistent_notification.message',
        'vacuum.clean_area.cleaning_area_id',
        'vacuum.send_command.command',
      ].sort(),
    );
    expect(missingRequiredFields('fan.set_percentage', {}).map((f) => f.key)).toEqual(['percentage']);
    expect(missingRequiredFields('fan.set_percentage', { percentage: 30 })).toEqual([]);
    expect(missingRequiredFields('desconocido.x', {})).toEqual([]);
  });

  it('notify.persistent_notification deja una notificación en el registro', () => {
    const p = project([]);
    let sim = createSimulationState(p, catalog, 0);
    sim = callService(sim, p, '', 'notify.persistent_notification', { message: 'Hola', title: 'Aviso' });
    expect(sim.log.at(-1)).toMatchObject({ level: 'info', message: 'Notificación: Aviso — Hola', notification: { title: 'Aviso', message: 'Hola' } });
    sim = runActions(sim, p, [notifyAction('Sin título')]);
    expect(sim.log.at(-1)?.notification).toEqual({ message: 'Sin título' });
    sim = callService(sim, p, '', 'notify.persistent_notification', {});
    expect(sim.log.at(-1)).toMatchObject({ level: 'warning', message: 'Servicio notify.persistent_notification: falta el mensaje ("message")' });
    expect(serviceName('notify.persistent_notification')).toBe('Notificación persistente');
  });
});
