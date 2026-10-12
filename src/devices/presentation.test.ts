import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { def, dev, project } from './testUtils';
import type { Project, SimulationState } from '../types';
import { callService, createSimulationState, tick } from '../simulation/engine';
import { motionPulse, setDeviceOffline, setTemperature } from '../simulation/events';
import { applyQuickAction, deviceIcon, deviceView, primaryAction, setLevelAction, stepAction } from './presentation';

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);

const DEVICES = [
  dev('luz', 'hue-white-color-e27', undefined, { name: 'Luz salón' }),
  dev('blanca', 'hue-white-e27', undefined, { name: 'Blanca' }),
  dev('mov', 'aqara-motion-p1', undefined, { name: 'Mov' }),
  dev('puerta', 'aqara-door-window', undefined, { name: 'Puerta' }),
  dev('clima', 'aqara-temp-hum', undefined, { name: 'Clima' }),
  dev('termo', 'netatmo-thermostat', undefined, { name: 'Termo' }),
  dev('pers', 'shelly-2pm-gen3-cover', undefined, { name: 'Persiana' }),
  dev('cerr', 'aqara-u200', undefined, { name: 'Cerradura' }),
  dev('tv', 'samsung-qled-q80', undefined, { name: 'Tele' }),
  dev('robot', 'xiaomi-robot-vacuum-s10', undefined, { name: 'Robot' }),
  dev('mando', 'aqara-wireless-mini-switch', undefined, { name: 'Mando' }),
  dev('fuga', 'aqara-water-leak', undefined, { name: 'Fuga' }),
  dev('enchufe', 'shelly-plug-s-gen3', undefined, { name: 'Enchufe' }),
  dev('coord', 'sonoff-zbdongle-p', undefined, { name: 'Coord' }),
  dev('cam', 'reolink-rlc-810a', undefined, { name: 'Cam' }),
];

const p: Project = project(DEVICES);
const start = (): SimulationState => createSimulationState(p, catalog, T0);

function view(id: string, sim = start()) {
  const device = p.devices.find((d) => d.id === id);
  if (!device) throw new Error(id);
  return deviceView(device, def(device.definitionId), sim);
}

function device(id: string) {
  const d = p.devices.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return { d, def: def(d.definitionId) };
}

describe('deviceView', () => {
  it('luz: brillo, color y entidades', () => {
    expect(view('luz')).toMatchObject({ kind: 'light', active: false, summary: 'off', unavailable: false });
    const sim = callService(start(), p, 'light.luz_salon', 'light.turn_on', { brightness_pct: 60, rgb_color: [255, 0, 0] });
    const v = view('luz', sim);
    expect(v).toMatchObject({ kind: 'light', active: true, summary: 'on · 60 %', brightnessPct: 60, colorCss: 'rgb(255, 0, 0)' });
    expect(v.entities).toEqual([{ entityId: 'light.luz_salon', name: 'Luz salón', domain: 'light', state: 'on' }]);
    const warm = view('luz', callService(sim, p, 'light.luz_salon', 'light.turn_on', { color_temp_kelvin: 2700 }));
    expect(warm.colorCss).toMatch(/^rgb\(255, /);
    expect(warm.secondary).toBe('2700 K');
  });

  it('sensores: movimiento con cuenta atrás, puerta, clima y fuga', () => {
    const pulse = motionPulse(start(), p, 'binary_sensor.mov_motion');
    expect(view('mov', pulse)).toMatchObject({ kind: 'motion', active: true, countdownSeconds: 60 });
    expect(view('mov', tick(pulse, p, 15_000)).countdownSeconds).toBe(45);
    expect(view('puerta')).toMatchObject({ kind: 'contact', summary: 'cerrada' });
    expect(view('clima')).toMatchObject({ kind: 'climate_sensor', summary: '21,5° · 50 %' });
    expect(view('fuga')).toMatchObject({ kind: 'leak', summary: 'seco' });
    expect(view('mando')).toMatchObject({ kind: 'remote' });
  });

  it('termostato «actual → consigna» y llama solo si calienta', () => {
    expect(view('termo')).toMatchObject({ kind: 'thermostat', summary: '21,5° → 21°', heating: false, active: false });
    const cold = setTemperature(start(), p, 'sensor.termo_temperature', 19.8);
    expect(view('termo', cold)).toMatchObject({ summary: '19,8° → 21°', heating: true, active: true });
  });

  it('persiana con posición y movimiento; media con volumen', () => {
    expect(view('pers')).toMatchObject({ kind: 'cover', summary: 'cerrada', positionPct: 0 });
    const moving = tick(callService(start(), p, 'cover.persiana_cover', 'cover.open_cover'), p, 9_000);
    expect(view('pers', moving)).toMatchObject({ moving: 'up', positionPct: 40, summary: 'subiendo · 40 %' });
    expect(view('pers', tick(moving, p, 20_000)).summary).toBe('abierta');
    const tv = callService(start(), p, 'media_player.tele', 'media_player.turn_on');
    expect(view('tv', tv)).toMatchObject({ kind: 'media', volumePct: 30, active: true, secondary: 'TV' });
  });

  it('infraestructura, cerradura, aspiradora y no disponible', () => {
    expect(view('coord')).toMatchObject({ kind: 'infrastructure', active: true });
    expect(view('cerr')).toMatchObject({ kind: 'lock', summary: 'cerrada con llave', active: false });
    expect(view('robot')).toMatchObject({ kind: 'vacuum', summary: 'en la base' });
    expect(view('cam')).toMatchObject({ kind: 'camera' });
    expect(view('luz', setDeviceOffline(start(), p, 'luz', true))).toMatchObject({ unavailable: true, summary: 'no disponible' });
  });
});

describe('acciones rápidas', () => {
  it('primaryAction por tipo', () => {
    const sim = start();
    const { d: luz, def: luzDef } = device('luz');
    expect(primaryAction(luz, luzDef, sim)).toMatchObject({ entityId: 'light.luz_salon', service: 'light.toggle', label: 'Encender' });
    const { d: mov, def: movDef } = device('mov');
    expect(primaryAction(mov, movDef, sim)).toMatchObject({ event: 'motion', entityId: 'binary_sensor.mov_motion' });
    const { d: cerr, def: cerrDef } = device('cerr');
    expect(primaryAction(cerr, cerrDef, sim)).toMatchObject({ service: 'lock.unlock' });
    const { d: clima, def: climaDef } = device('clima');
    expect(primaryAction(clima, climaDef, sim)).toBeNull();
    const { d: mando, def: mandoDef } = device('mando');
    expect(primaryAction(mando, mandoDef, sim)).toMatchObject({ event: 'button' });
  });

  it('stepAction y setLevelAction', () => {
    const sim = start();
    const { d: luz, def: luzDef } = device('luz');
    expect(stepAction(luz, luzDef, sim, 1)).toMatchObject({ service: 'light.turn_on', data: { brightness_step_pct: 10 } });
    expect(setLevelAction(luz, luzDef, sim, 70)).toMatchObject({ service: 'light.turn_on', data: { brightness_pct: 70 } });
    expect(setLevelAction(luz, luzDef, sim, 0)).toMatchObject({ service: 'light.turn_off' });
    const { d: termo, def: termoDef } = device('termo');
    expect(stepAction(termo, termoDef, sim, -1)).toMatchObject({ service: 'climate.set_temperature', data: { temperature: 20.5 } });
    const { d: pers, def: persDef } = device('pers');
    expect(stepAction(pers, persDef, sim, 1)).toMatchObject({ data: { position: 10 } });
    const { d: tv, def: tvDef } = device('tv');
    expect(stepAction(tv, tvDef, sim, 1)).toMatchObject({ service: 'media_player.volume_set', data: { volume_level: 0.4 } });
    const { d: puerta, def: puertaDef } = device('puerta');
    expect(stepAction(puerta, puertaDef, sim, 1)).toBeNull();
  });

  it('applyQuickAction ejecuta servicios y eventos', () => {
    const { d: luz, def: luzDef } = device('luz');
    const action = primaryAction(luz, luzDef, start());
    if (!action) throw new Error('sin acción');
    const sim = applyQuickAction(start(), p, action);
    expect(sim.entities['light.luz_salon']?.state).toBe('on');
    const opened = applyQuickAction(sim, p, { event: 'contact', entityId: 'binary_sensor.puerta_door', label: 'Abrir' });
    expect(opened.entities['binary_sensor.puerta_door']?.state).toBe('on');
    const pressed = applyQuickAction(sim, p, { event: 'button', entityId: 'sensor.mando_action', label: 'Pulsar' });
    expect(pressed.log.some((l) => l.message.includes('single'))).toBe(true);
  });
});

describe('deviceIcon', () => {
  it('distingue movimiento, puerta, temperatura, fuga, mando y relé', () => {
    const icons = ['aqara-motion-p1', 'aqara-door-window', 'aqara-temp-hum', 'aqara-water-leak', 'aqara-wireless-mini-switch', 'shelly-1pm-gen3'].map((id) =>
      deviceIcon(def(id)),
    );
    expect(new Set(icons).size).toBe(icons.length);
    expect(deviceIcon(def('aqara-motion-p1'), 'smoke')).not.toBe(deviceIcon(def('aqara-motion-p1')));
  });
});
