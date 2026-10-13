import { describe, expect, it } from 'vitest';
import { catalog } from '../../devices/catalog';
import { createDemoProject } from '../../store/demoProject';
import type { Device, DeviceDefinition, EntityState, Project } from '../../types';
import { nativeDecision, nativeDevices } from '../native';
import {
  brightnessToLevel,
  buildMatterPlan,
  describeMatterCommand,
  describeMatterState,
  levelToBrightness,
  matterCommandToService,
  matterDevicePlan,
  matterEndpointId,
  matterHsToRgb,
  matterMeasured,
  matterStateOf,
  matterSupport,
  matterUniqueId,
  rgbToMatterHs,
  type MatterDevicePlan,
} from './plan';

const defOf = (id: string): DeviceDefinition => {
  const def = catalog.find((d) => d.id === id);
  if (!def) throw new Error(`no existe ${id}`);
  return def;
};

const dev = (id: string, definitionId: string, name: string, extra: Partial<Device> = {}): Device => {
  const def = defOf(definitionId);
  return { id, definitionId, name, floorId: 'f', position: { x: 0, y: 0 }, protocol: def.protocols[0] ?? 'thread', integration: 'matter', ...extra };
};

const st = (state: EntityState['state'], attributes: EntityState['attributes'] = {}): EntityState => ({ state, attributes });

const planOf = (device: Device, def: DeviceDefinition = defOf(device.definitionId)): MatterDevicePlan => {
  const plan = matterDevicePlan('proyecto', device, def, 'Despacho');
  if (!plan) throw new Error('sin plan');
  return plan;
};

describe('Matter: tipos de dispositivo y clusters', () => {
  it('bombilla de color (KAJPLATS): Extended Color Light con OnOff, LevelControl y ColorControl', () => {
    const plan = planOf(dev('luz', 'ikea-kajplats-e27', 'Luz Matter'));
    expect(plan.kind).toBe('extended_color_light');
    expect(plan.clusters).toEqual(['onOff', 'levelControl', 'colorControl']);
    expect(plan.light).toEqual({ brightness: true, colorTemp: true, color: true, minMireds: 154, maxMireds: 556 });
    expect(plan.entities).toEqual([{ entityId: 'light.luz_matter', cluster: 'onOff', attributeId: 0, haDomain: 'light' }]);
    expect(plan.area).toBe('Despacho');
    expect(plan.vendorName).toBe('IKEA');
  });

  it('luces: solo brillo → Dimmable Light; temperatura → Color Temperature Light; onoff → On/Off Light', () => {
    const base = defOf('ikea-kajplats-e27');
    const withModes = (modes: string[]): DeviceDefinition => ({ ...base, id: 'x', entities: [{ key: 'light', domain: 'light', name: 'Luz', initialState: 'off', capabilities: { colorModes: modes as never } }] });
    const d = dev('l', 'ikea-kajplats-e27', 'L');
    expect(matterDevicePlan('p', d, withModes(['brightness']))?.kind).toBe('dimmable_light');
    expect(matterDevicePlan('p', d, withModes(['brightness', 'color_temp']))?.kind).toBe('color_temperature_light');
    expect(matterDevicePlan('p', d, withModes(['onoff']))?.clusters).toEqual(['onOff']);
    expect(matterDevicePlan('p', d, withModes(['onoff']))?.kind).toBe('on_off_light');
  });

  it('enchufe con medidor (Tapo P110M): On/Off Plug-in Unit con potencia y energía', () => {
    const plan = planOf(dev('e', 'tapo-p110m', 'Enchufe Matter', { protocol: 'matter' }));
    expect(plan.kind).toBe('on_off_plug');
    expect(plan.clusters).toEqual(['onOff', 'electricalPowerMeasurement', 'electricalEnergyMeasurement']);
    expect(plan.entities.map((e) => [e.entityId, e.haDomain, e.attributeId])).toEqual([
      ['switch.enchufe_matter_switch', 'switch', 0],
      ['sensor.enchufe_matter_power', 'sensor', 8],
      ['sensor.enchufe_matter_energy', 'sensor', 1],
    ]);
  });

  it('sensores: contacto + batería, movimiento + luz + batería, cerradura, persiana', () => {
    expect(planOf(dev('p', 'eve-door-window', 'Puerta'))).toMatchObject({ kind: 'contact_sensor', clusters: ['booleanState', 'powerSource'] });
    expect(planOf(dev('m', 'aqara-motion-p2', 'Movimiento'))).toMatchObject({ kind: 'occupancy_sensor', clusters: ['occupancySensing', 'illuminanceMeasurement', 'powerSource'] });
    expect(planOf(dev('c', 'aqara-u200', 'Cerradura'))).toMatchObject({ kind: 'door_lock', clusters: ['doorLock', 'powerSource'] });
    const cover = planOf(dev('w', 'ikea-fyrtur', 'Estor', { integration: 'matter' }));
    expect(cover).toMatchObject({ kind: 'window_covering', clusters: ['windowCovering', 'powerSource'] });
    expect(cover.entities[0]).toMatchObject({ haDomain: 'cover', attributeId: 10 });
  });

  it('solo sensores: temperatura y humedad en un Temperature Sensor', () => {
    const def: DeviceDefinition = {
      ...defOf('eve-door-window'),
      id: 'clima',
      entities: [
        { key: 'humidity', domain: 'sensor', name: 'Humedad', deviceClass: 'humidity', unit: '%', initialState: 50 },
        { key: 'temperature', domain: 'sensor', name: 'Temperatura', deviceClass: 'temperature', unit: '°C', initialState: 21 },
      ],
    };
    const plan = planOf(dev('t', 'eve-door-window', 'Clima'), def);
    expect(plan.kind).toBe('temperature_sensor');
    expect(plan.clusters).toEqual(['relativeHumidityMeasurement', 'temperatureMeasurement']);
  });

  it('no emulables: sensor de acción, dos entidades principales, solo batería, media_player', () => {
    expect(matterSupport(dev('s', 'ikea-styrbar', 'Mando', { integration: 'matter' }), defOf('ikea-styrbar'))).toMatchObject({ ok: false, reason: expect.stringMatching(/no tiene cluster Matter/) });
    const two: DeviceDefinition = {
      ...defOf('tapo-p110m'),
      id: 'doble',
      entities: [
        { key: 'l1', domain: 'switch', name: 'Relé 1', initialState: 'off' },
        { key: 'l2', domain: 'switch', name: 'Relé 2', initialState: 'off' },
      ],
    };
    expect(matterSupport(dev('d', 'tapo-p110m', 'Doble'), two)).toMatchObject({ ok: false, reason: expect.stringMatching(/más de una entidad principal/) });
    const battery: DeviceDefinition = { ...defOf('tapo-p110m'), id: 'bat', entities: [{ key: 'battery', domain: 'sensor', name: 'Batería', deviceClass: 'battery', unit: '%', initialState: 100 }] };
    expect(matterSupport(dev('b', 'tapo-p110m', 'B'), battery)).toMatchObject({ ok: false });
    expect(matterSupport(dev('h', 'google-nest-hub-2', 'Hub', { protocol: 'thread', integration: 'matter' }), defOf('google-nest-hub-2'))).toMatchObject({ ok: false, reason: expect.stringMatching(/media_player/) });
    expect(matterDevicePlan('p', dev('b', 'tapo-p110m', 'B'), battery)).toBeUndefined();
  });

  it('ids estables: endpoint, UniqueID (≤ 32) y nombre recortado a 32 caracteres', () => {
    expect(matterEndpointId('p', 'd')).toBe(matterEndpointId('p', 'd'));
    expect(matterEndpointId('p', 'd')).not.toBe(matterEndpointId('p', 'e'));
    expect(matterEndpointId('p', 'd')).toMatch(/^hasim-[0-9a-f]{8}$/);
    expect(matterUniqueId('p', 'd').length).toBeLessThanOrEqual(32);
    expect(matterUniqueId('p', 'd')).not.toBe(matterUniqueId('q', 'd'));
    const plan = planOf(dev('l', 'ikea-kajplats-e27', 'Una luz con un nombre larguísimo que no cabe'));
    expect(plan.name.length).toBeLessThanOrEqual(32);
  });
});

describe('Matter: proyecto y vías', () => {
  it('la demo tiene una luz y un enchufe Matter, y la cerradura Thread también va por Matter', () => {
    const project = createDemoProject();
    const plans = buildMatterPlan(project, catalog);
    const kinds = Object.fromEntries(plans.map((p) => [p.deviceId, p.kind]));
    expect(kinds['demo-luz-matter']).toBe('extended_color_light');
    expect(kinds['demo-enchufe-matter']).toBe('on_off_plug');
    expect(kinds['demo-cerradura']).toBe('door_lock');
    // Los dispositivos Zigbee con integración ZHA no van por Matter.
    expect(kinds['demo-luz-pasillo']).toBeUndefined();
  });

  it('con el perfil matter, los dispositivos Matter/Thread compatibles salen de MQTT', () => {
    const project = createDemoProject();
    const ids = nativeDevices(project, catalog, new Set(['matter']));
    expect(ids.get('demo-luz-matter')).toBe('matter');
    expect(ids.get('demo-enchufe-matter')).toBe('matter');
    expect(nativeDevices(project, catalog, new Set(['esphome'])).has('demo-luz-matter')).toBe(false);
    const hub = project.devices.find((d) => d.id === 'demo-nest-hub');
    if (hub) expect(nativeDecision(hub, defOf(hub.definitionId), new Set(['matter'])).native).toBe(false);
  });

  it('un dispositivo Matter no emulable sigue por MQTT con el motivo', () => {
    const remote = dev('r', 'ikea-styrbar', 'Mando', { integration: 'matter' });
    expect(nativeDecision(remote, defOf('ikea-styrbar'), new Set(['matter']))).toMatchObject({ transport: 'matter', native: false, profile: 'matter', reason: expect.stringMatching(/no tiene cluster/) });
  });

  it('un proyecto sin dispositivos Matter no tiene endpoints', () => {
    const project: Project = { ...createDemoProject(), devices: [] };
    expect(buildMatterPlan(project, catalog)).toEqual([]);
  });
});

describe('Matter: estados del simulador → atributos', () => {
  it('nivel ↔ brillo como lo calcula HA (1-254 ↔ 0-255)', () => {
    expect(brightnessToLevel(255)).toBe(254);
    expect(brightnessToLevel(0)).toBe(1);
    expect(brightnessToLevel(128)).toBe(128);
    expect(levelToBrightness(254)).toBe(255);
    expect(levelToBrightness(1)).toBe(1);
    for (const b of [1, 50, 128, 200, 255]) expect(Math.abs(levelToBrightness(brightnessToLevel(b)) - b)).toBeLessThanOrEqual(1);
  });

  it('tono y saturación ↔ RGB', () => {
    expect(rgbToMatterHs([255, 0, 0])).toEqual({ hue: 0, saturation: 254 });
    expect(rgbToMatterHs([0, 0, 255])).toEqual({ hue: 169, saturation: 254 });
    expect(rgbToMatterHs([255, 255, 255])).toEqual({ hue: 0, saturation: 0 });
    expect(matterHsToRgb(0, 254)).toEqual([255, 0, 0]);
    expect(matterHsToRgb(0, 0)).toEqual([255, 255, 255]);
    const [r, g, b] = matterHsToRgb(85, 254);
    expect(g).toBe(255);
    expect(r).toBeLessThan(10);
    expect(b).toBeLessThan(10);
  });

  it('luz: encendida con brillo y RGB (modo tono/saturación) o temperatura de color', () => {
    const plan = planOf(dev('luz', 'ikea-kajplats-e27', 'Luz Matter'));
    const rgb = matterStateOf(plan, { 'light.luz_matter': st('on', { brightness: 255, rgb_color: '[255, 0, 0]', color_mode: 'rgb' }) }, true);
    expect(rgb).toMatchObject({ reachable: true, onOff: true, level: 254, color: { mode: 0, hue: 0, saturation: 254 } });
    const ct = matterStateOf(plan, { 'light.luz_matter': st('on', { brightness: 128, color_temp_kelvin: 2700, color_mode: 'color_temp', rgb_color: '[255, 166, 87]' }) }, true);
    expect(ct.color).toEqual({ mode: 2, mireds: 370 });
    // Fuera de rango: se recorta al rango físico de la bombilla.
    expect(matterStateOf(plan, { 'light.luz_matter': st('on', { color_temp_kelvin: 1000 }) }, true).color).toEqual({ mode: 2, mireds: 556 });
    const off = matterStateOf(plan, { 'light.luz_matter': st('off') }, false);
    expect(off).toEqual({ reachable: false, onOff: false });
  });

  it('enchufe: OnOff, potencia en mW y energía en mWh; sin dato = null', () => {
    const plan = planOf(dev('e', 'tapo-p110m', 'Enchufe Matter', { protocol: 'matter' }));
    expect(matterStateOf(plan, { 'switch.enchufe_matter_switch': st('on'), 'sensor.enchufe_matter_power': st('12.5'), 'sensor.enchufe_matter_energy': st(3.2) }, true)).toEqual({
      reachable: true,
      onOff: true,
      activePowerMw: 12500,
      energyMwh: 3_200_000,
    });
    expect(matterStateOf(plan, { 'sensor.enchufe_matter_power': st('unavailable') }, true).activePowerMw).toBeNull();
  });

  it('sensores: contacto (cerrado = true), movimiento, luz, batería, temperatura, humedad y presión', () => {
    const door = planOf(dev('p', 'eve-door-window', 'Puerta'));
    expect(matterStateOf(door, { 'binary_sensor.puerta_door': st('on'), 'sensor.puerta_battery': st(87) }, true)).toEqual({ reachable: true, stateValue: false, battery: 174 });
    expect(matterStateOf(door, { 'binary_sensor.puerta_door': st('off') }, true).stateValue).toBe(true);
    const motion = planOf(dev('m', 'aqara-motion-p2', 'Mov'));
    expect(matterStateOf(motion, { 'binary_sensor.mov_motion': st('on'), 'sensor.mov_illuminance': st(1000) }, true)).toMatchObject({ occupied: true, illuminance: 30001 });
    expect(matterMeasured('illuminanceMeasurement', st(0))).toBe(0);
    expect(matterMeasured('temperatureMeasurement', st('21.37'))).toBe(2137);
    expect(matterMeasured('temperatureMeasurement', st(-300))).toBe(-27315);
    expect(matterMeasured('relativeHumidityMeasurement', st(55.5))).toBe(5550);
    expect(matterMeasured('relativeHumidityMeasurement', st(150))).toBe(10000);
    expect(matterMeasured('pressureMeasurement', st(1013.2))).toBe(1013);
    expect(matterMeasured('powerSource', st(120))).toBe(200);
    expect(matterMeasured('temperatureMeasurement', st('unknown'))).toBeNull();
    expect(matterMeasured('temperatureMeasurement', undefined)).toBeNull();
    expect(matterMeasured('onOff', st(1))).toBeNull();
  });

  it('cerradura: cerrada, abierta, atascada; persiana: posición invertida y movimiento', () => {
    const lock = planOf(dev('c', 'aqara-u200', 'Cerradura'));
    const ls = (s: string) => matterStateOf(lock, { 'lock.cerradura_lock': st(s) }, true).lockState;
    expect([ls('locked'), ls('locking'), ls('unlocked'), ls('open'), ls('jammed'), ls('unknown')]).toEqual([1, 1, 2, 2, 0, null]);
    const cover = planOf(dev('w', 'ikea-fyrtur', 'Estor', { integration: 'matter' }));
    const cs = (s: EntityState) => matterStateOf(cover, { 'cover.estor_cover': s }, true).cover;
    expect(cs(st('open', { current_position: 100 }))).toEqual({ closed100ths: 0, moving: 'stopped' });
    expect(cs(st('opening', { current_position: 40 }))).toEqual({ closed100ths: 6000, moving: 'opening' });
    expect(cs(st('closed'))).toEqual({ closed100ths: 10000, moving: 'stopped' });
    expect(cs(st('unknown'))).toEqual({ closed100ths: null, moving: 'stopped' });
  });

  it('fuga de agua: BooleanState true = hay agua', () => {
    const def: DeviceDefinition = { ...defOf('eve-door-window'), id: 'fuga', entities: [{ key: 'leak', domain: 'binary_sensor', name: 'Fuga', deviceClass: 'moisture', initialState: 'off' }] };
    const plan = planOf(dev('f', 'eve-door-window', 'Fuga'), def);
    expect(plan.kind).toBe('water_leak_detector');
    expect(matterStateOf(plan, { 'binary_sensor.fuga': st('on') }, true).stateValue).toBe(true);
  });
});

describe('Matter: comandos de HA → servicios del simulador', () => {
  const light = planOf(dev('luz', 'ikea-kajplats-e27', 'Luz Matter'));
  const plug = planOf(dev('e', 'tapo-p110m', 'Enchufe Matter', { protocol: 'matter' }));
  it('OnOff en una luz y en un enchufe', () => {
    expect(matterCommandToService(light, { type: 'onOff', action: 'on' })).toEqual({ entityId: 'light.luz_matter', service: 'light.turn_on', data: {} });
    expect(matterCommandToService(light, { type: 'onOff', action: 'toggle' })?.service).toBe('light.toggle');
    expect(matterCommandToService(plug, { type: 'onOff', action: 'off' })).toEqual({ entityId: 'switch.enchufe_matter_switch', service: 'switch.turn_off', data: {} });
  });

  it('LevelControl, temperatura de color, tono/saturación y xy', () => {
    expect(matterCommandToService(light, { type: 'level', level: 254, withOnOff: true })).toEqual({ entityId: 'light.luz_matter', service: 'light.turn_on', data: { brightness: 255 } });
    expect(matterCommandToService(light, { type: 'level', level: 0, withOnOff: true })?.service).toBe('light.turn_off');
    expect(matterCommandToService(light, { type: 'level', level: 0, withOnOff: false })).toBeNull();
    expect(matterCommandToService(light, { type: 'colorTemperature', mireds: 370 })?.data).toEqual({ color_temp_kelvin: 2703 });
    expect(matterCommandToService(light, { type: 'colorTemperature', mireds: 10 })?.data).toEqual({ color_temp_kelvin: 6494 });
    expect(matterCommandToService(light, { type: 'hueSaturation', hue: 0, saturation: 254 })?.data).toEqual({ rgb_color: [255, 0, 0] });
    const xy = matterCommandToService(light, { type: 'xy', x: Math.round(0.7006 * 65536), y: Math.round(0.2993 * 65536) });
    expect(xy?.service).toBe('light.turn_on');
    expect((xy?.data.rgb_color as number[])[0]).toBe(255);
    // Un enchufe no tiene brillo ni color.
    expect(matterCommandToService(plug, { type: 'level', level: 100, withOnOff: true })).toBeNull();
    expect(matterCommandToService(plug, { type: 'hueSaturation', hue: 0, saturation: 0 })).toBeNull();
  });

  it('cerradura y persiana', () => {
    const lock = planOf(dev('c', 'aqara-u200', 'Cerradura'));
    expect(matterCommandToService(lock, { type: 'lock', action: 'unlock' })).toEqual({ entityId: 'lock.cerradura_lock', service: 'lock.unlock', data: {} });
    expect(matterCommandToService(lock, { type: 'onOff', action: 'on' })).toBeNull();
    const cover = planOf(dev('w', 'ikea-fyrtur', 'Estor', { integration: 'matter' }));
    expect(matterCommandToService(cover, { type: 'cover', action: 'open' })?.service).toBe('cover.open_cover');
    expect(matterCommandToService(cover, { type: 'cover', action: 'stop' })?.service).toBe('cover.stop_cover');
    expect(matterCommandToService(cover, { type: 'coverPosition', closed100ths: 2500 })).toEqual({ entityId: 'cover.estor_cover', service: 'cover.set_cover_position', data: { position: 75 } });
  });

  it('resúmenes para el inspector de tráfico', () => {
    expect(describeMatterCommand({ type: 'level', level: 200, withOnOff: true })).toBe('LevelControl · MoveToLevelWithOnOff · level=200');
    expect(describeMatterCommand({ type: 'lock', action: 'lock' })).toBe('DoorLock · LockDoor');
    expect(describeMatterState({ reachable: false, onOff: true, level: 100, temperature: null })).toBe('reachable=false OnOff=on Level=100 Temperature=null');
    expect(describeMatterState({ reachable: true, color: { mode: 2, mireds: 300 } })).toBe('ColorTemp=300 mireds');
  });
});
