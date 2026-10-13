import { describe, expect, it } from 'vitest';
import type { EntityCapabilities, EntityState } from '../types';
import {
  applyService,
  brightnessToPct,
  coverStep,
  coverStepSeconds,
  describeServiceData,
  pctToBrightness,
  sceneServiceCalls,
  updateClimateCurrentTemperature,
  VACUUM_RETURN_SECONDS,
} from './services';

const COLOR: EntityCapabilities = { colorModes: ['brightness', 'color_temp', 'rgb'], minKelvin: 2000, maxKelvin: 6500 };
const WHITE: EntityCapabilities = { colorModes: ['brightness'] };
const TRADFRI: EntityCapabilities = { colorModes: ['brightness', 'color_temp'], minKelvin: 2200, maxKelvin: 4000 };
const ONOFF: EntityCapabilities = { colorModes: ['onoff'] };

const off: EntityState = { state: 'off', attributes: { friendly_name: 'Luz' } };

function light(service: string, current: EntityState, data = {}, capabilities: EntityCapabilities = COLOR) {
  const r = applyService('light', service, current, data, { now: 0, capabilities });
  if (!r) throw new Error('sin resultado');
  return r;
}

describe('light', () => {
  it('brightness, brightness_pct y brightness_step_pct', () => {
    expect(light('turn_on', off, { brightness: 128 }).state.attributes?.brightness).toBe(128);
    expect(light('turn_on', off, { brightness_pct: 60 }).state.attributes?.brightness).toBe(153);
    const on = light('turn_on', off, { brightness_pct: 50 }).state;
    expect(brightnessToPct(Number(light('turn_on', on, { brightness_step_pct: 10 }).state.attributes?.brightness))).toBe(60);
    expect(brightnessToPct(Number(light('turn_on', on, { brightness_step_pct: -20 }).state.attributes?.brightness))).toBe(30);
    // paso por debajo de 0 apaga
    expect(light('turn_on', on, { brightness_step_pct: -80 }).state.state).toBe('off');
    expect(light('turn_on', off, { brightness: 0 }).state.state).toBe('off');
  });

  it('turn_on sin brillo recupera el último; turn_off lo quita pero lo recuerda', () => {
    const on = light('turn_on', off, { brightness_pct: 40 }).state;
    const dark = light('turn_off', on).state;
    expect(dark.state).toBe('off');
    expect(dark.attributes?.brightness).toBeUndefined();
    expect(dark.attributes?.last_brightness).toBe(pctToBrightness(40));
    expect(light('turn_on', dark).state.attributes?.brightness).toBe(pctToBrightness(40));
    expect(light('turn_on', off).state.attributes?.brightness).toBe(255);
  });

  it('toggle', () => {
    const on = light('toggle', off).state;
    expect(on.state).toBe('on');
    expect(light('toggle', on).state.state).toBe('off');
  });

  it('color_temp_kelvin se limita al rango y rgb_color acepta lista o texto', () => {
    const warm = light('turn_on', off, { color_temp_kelvin: 1500 }, TRADFRI);
    expect(warm.state.attributes).toMatchObject({ color_temp_kelvin: 2200, color_mode: 'color_temp' });
    expect(warm.warnings[0]).toMatch(/2200 K/);
    const red = light('turn_on', off, { rgb_color: [255, 0, 0] }).state;
    expect(red.attributes).toMatchObject({ rgb_color: '[255, 0, 0]', color_mode: 'rgb' });
    const blue = light('turn_on', red, { rgb_color: '[0, 0, 255]' }).state;
    expect(blue.attributes?.rgb_color).toBe('[0, 0, 255]');
    const back = light('turn_on', blue, { color_temp_kelvin: 3000 }).state;
    expect(back.attributes?.rgb_color).toBeUndefined();
    expect(back.attributes?.color_mode).toBe('color_temp');
  });

  it('respeta las capacidades', () => {
    const white = light('turn_on', off, { rgb_color: [255, 0, 0], color_temp_kelvin: 3000, brightness_pct: 20 }, WHITE);
    expect(white.state.attributes?.rgb_color).toBeUndefined();
    expect(white.state.attributes?.color_temp_kelvin).toBeUndefined();
    expect(white.state.attributes?.brightness).toBe(pctToBrightness(20));
    expect(white.warnings).toHaveLength(2);
    const relay = light('turn_on', off, { brightness_pct: 20 }, ONOFF);
    expect(relay.state.attributes?.brightness).toBeUndefined();
    expect(relay.state.attributes?.color_mode).toBe('onoff');
    expect(relay.warnings[0]).toMatch(/no admite regulación/);
  });
});

describe('cover', () => {
  const closed: EntityState = { state: 'closed', attributes: { current_position: 0 } };
  const caps: EntityCapabilities = { travelSeconds: 20 };
  const cover = (service: string, current: EntityState, data = {}, c = caps) => applyService('cover', service, current, data, { now: 0, capabilities: c });

  it('open_cover inicia el recorrido; cada paso avanza hasta el destino', () => {
    const r = cover('open_cover', closed);
    expect(r?.state.state).toBe('opening');
    expect(r?.coverTarget).toBe(100);
    expect(coverStepSeconds(0, 100, caps)).toBe(2);
    let st = r?.state ?? closed;
    let steps = 0;
    for (let done = false; !done; steps++) ({ state: st, done } = coverStep(st, 100));
    expect(steps).toBe(10);
    expect(st).toMatchObject({ state: 'open', attributes: { current_position: 100 } });
  });

  it('set_cover_position, stop_cover y toggle', () => {
    const r = cover('set_cover_position', closed, { position: 45 });
    expect(r?.coverTarget).toBe(45);
    const moving = coverStep(r?.state ?? closed, 45).state;
    expect(moving).toMatchObject({ state: 'opening', attributes: { current_position: 10 } });
    expect(cover('stop_cover', moving)?.state).toMatchObject({ state: 'open', attributes: { current_position: 10 } });
    expect(cover('toggle', moving)?.state.state).toBe('open');
    expect(cover('toggle', closed)?.coverTarget).toBe(100);
    expect(cover('set_cover_position', closed)?.warnings[0]).toMatch(/position/);
  });

  it('sin tiempo de recorrido se mueve al instante', () => {
    expect(cover('open_cover', closed, {}, { travelSeconds: 0 })?.state).toMatchObject({ state: 'open', attributes: { current_position: 100 } });
  });
});

describe('climate', () => {
  const caps: EntityCapabilities = { hvacModes: ['off', 'heat', 'auto'], presetModes: ['eco', 'away'], minTemp: 7, maxTemp: 30, tempStep: 0.5 };
  const base: EntityState = { state: 'heat', attributes: { temperature: 21, current_temperature: 21.5, hvac_action: 'idle' } };
  const climate = (service: string, current: EntityState, data = {}) => applyService('climate', service, current, data, { now: 0, capabilities: caps });

  it('set_temperature con límites y paso; hvac_action derivada', () => {
    const r = climate('set_temperature', base, { temperature: 23 });
    expect(r?.state.attributes).toMatchObject({ temperature: 23, hvac_action: 'heating' });
    const capped = climate('set_temperature', base, { temperature: 40 });
    expect(capped?.state.attributes?.temperature).toBe(30);
    expect(capped?.warnings[0]).toMatch(/30 °C/);
    expect(climate('set_temperature', base, { temperature: 21.3 })?.state.attributes?.temperature).toBe(21.5);
  });

  it('set_hvac_mode validado, presets y turn_on recupera el último modo', () => {
    expect(climate('set_hvac_mode', base, { hvac_mode: 'cool' })?.warnings[0]).toMatch(/no admitido/);
    const auto = climate('set_hvac_mode', base, { hvac_mode: 'auto' })?.state ?? base;
    const offState = climate('turn_off', auto)?.state ?? base;
    expect(offState).toMatchObject({ state: 'off', attributes: { hvac_action: 'off', last_hvac_mode: 'auto' } });
    expect(climate('turn_on', offState)?.state.state).toBe('auto');
    expect(climate('set_preset_mode', base, { preset_mode: 'eco' })?.state.attributes?.preset_mode).toBe('eco');
    expect(climate('set_preset_mode', base, { preset_mode: 'boost' })?.warnings[0]).toMatch(/Preset no admitido/);
  });

  it('updateClimateCurrentTemperature recalcula hvac_action', () => {
    expect(updateClimateCurrentTemperature(base, 19.8).attributes?.hvac_action).toBe('heating');
    expect(updateClimateCurrentTemperature({ ...base, state: 'off' }, 15).attributes?.hvac_action).toBe('off');
  });
});

describe('media_player', () => {
  const caps: EntityCapabilities = { sources: ['TV', 'HDMI 1'] };
  const tv: EntityState = { state: 'off', attributes: { volume_level: 0.3, is_volume_muted: false } };
  const media = (service: string, current: EntityState, data = {}) => applyService('media_player', service, current, data, { now: 0, capabilities: caps });

  it('encendido, reproducción y pausa', () => {
    const on = media('turn_on', tv)?.state ?? tv;
    expect(on.state).toBe('on');
    expect(media('media_play_pause', on)?.state.state).toBe('playing');
    expect(media('media_play', on)?.state.state).toBe('playing');
    expect(media('media_pause', on)?.state.state).toBe('paused');
    expect(media('turn_off', on)?.state.state).toBe('off');
  });

  it('volumen, silencio y fuente', () => {
    expect(media('volume_set', tv, { volume_level: 0.75 })?.state.attributes?.volume_level).toBe(0.75);
    expect(media('volume_up', tv)?.state.attributes?.volume_level).toBe(0.4);
    expect(media('volume_down', tv)?.state.attributes?.volume_level).toBe(0.2);
    expect(media('volume_up', { ...tv, attributes: { volume_level: 0.95 } })?.state.attributes?.volume_level).toBe(1);
    expect(media('volume_mute', tv, { is_volume_muted: true })?.state.attributes?.is_volume_muted).toBe(true);
    expect(media('select_source', tv, { source: 'HDMI 1' })?.state.attributes?.source).toBe('HDMI 1');
    expect(media('select_source', tv, { source: 'VGA' })?.warnings[0]).toMatch(/Fuente no disponible/);
  });
});

describe('vacuum, fan, lock, switch y button', () => {
  const run = (domain: string, service: string, current: EntityState, data = {}) => applyService(domain, service, current, data, { now: Date.UTC(2026, 0, 1) });

  it('vacuum: cleaning → paused → returning → docked (diferido)', () => {
    const cleaning = run('vacuum', 'start', { state: 'docked' })?.state ?? { state: '' };
    expect(cleaning.state).toBe('cleaning');
    expect(run('vacuum', 'pause', cleaning)?.state.state).toBe('paused');
    const back = run('vacuum', 'return_to_base', cleaning);
    expect(back?.state.state).toBe('returning');
    // La llegada a la base la hace el paso del robot (vacuum_step) a los VACUUM_RETURN_SECONDS.
    expect(back?.vacuumNext).toBe(VACUUM_RETURN_SECONDS);
    expect(back?.state.attributes?.return_left).toBe(VACUUM_RETURN_SECONDS);
  });

  it('fan: set_percentage y 0 apaga', () => {
    expect(run('fan', 'set_percentage', { state: 'off' }, { percentage: 40 })?.state).toMatchObject({ state: 'on', attributes: { percentage: 40 } });
    expect(run('fan', 'set_percentage', { state: 'on' }, { percentage: 0 })?.state.state).toBe('off');
  });

  it('lock, switch y button', () => {
    expect(run('lock', 'unlock', { state: 'jammed' })?.state.state).toBe('unlocked');
    expect(run('lock', 'open', { state: 'locked' })?.state.state).toBe('open');
    expect(run('switch', 'toggle', { state: 'off' })?.state.state).toBe('on');
    expect(run('button', 'press', { state: 'unknown' })?.state.state).toBe('2026-01-01T00:00:00.000Z');
    expect(run('cover', 'turn_on', { state: 'closed' }, {})?.state.state).toBe('opening');
    expect(run('switch', 'blink', { state: 'off' })).toBeUndefined();
  });
});

describe('describeServiceData y sceneServiceCalls', () => {
  it('describe los datos en español', () => {
    expect(describeServiceData({ brightness_pct: 60 })).toBe('brillo 60 %');
    expect(describeServiceData({ brightness: 255, color_temp_kelvin: 2700 })).toBe('brillo 100 %, 2700 K');
    expect(describeServiceData({ rgb_color: [255, 0, 0] })).toBe('color rgb(255, 0, 0)');
    expect(describeServiceData({ temperature: 21.5, volume_level: 0.3 })).toBe('consigna 21,5 °C, volumen 30 %');
    expect(describeServiceData(undefined)).toBe('');
  });

  it('traduce estados de escena a servicios', () => {
    expect(sceneServiceCalls('light.a', { state: 'on', attributes: { brightness: 40, rgb_color: '[255, 0, 0]', friendly_name: 'x' } })).toEqual([
      { service: 'light.turn_on', data: { brightness: 40, rgb_color: '[255, 0, 0]' } },
    ]);
    expect(sceneServiceCalls('cover.a', { state: 'open', attributes: { current_position: 30 } })).toEqual([
      { service: 'cover.set_cover_position', data: { position: 30 } },
    ]);
    expect(sceneServiceCalls('climate.a', { state: 'heat', attributes: { temperature: 20 } })).toEqual([
      { service: 'climate.set_hvac_mode', data: { hvac_mode: 'heat' } },
      { service: 'climate.set_temperature', data: { temperature: 20 } },
    ]);
    expect(sceneServiceCalls('sensor.a', { state: 1 })).toBeUndefined();
  });
});
