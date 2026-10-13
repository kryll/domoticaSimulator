import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import type { Device, DeviceDefinition, EntityState, Project } from '../types';
import { createDemoProject } from '../store/demoProject';
import { activeNativeTransports, nativeDecision, nativeDevices } from './native';
import {
  allocateNodeIds,
  brightnessToLevel,
  buildZwavePlan,
  levelToBrightness,
  zwaveCommandToService,
  zwaveNodePlan,
  zwaveNodeValues,
  zwaveSupport,
} from './zwave/plan';
import { buildEsphomePlan, espCommandToService, espNodeStates, esphomeNodePlan, esphomeSupport, macFor, nodeNameFor, ESP_COLOR_MODE } from './esphome/plan';
import { buildBridgeModel } from './mqtt/model';

const defOf = (id: string): DeviceDefinition => {
  const def = catalog.find((d) => d.id === id);
  if (!def) throw new Error(`no existe ${id}`);
  return def;
};

const dev = (id: string, definitionId: string, name: string, extra: Partial<Device> = {}): Device => {
  const def = defOf(definitionId);
  return { id, definitionId, name, floorId: 'f', position: { x: 0, y: 0 }, protocol: def.protocols[0] ?? 'wifi', integration: def.integrations[0] ?? 'esphome', ...extra };
};

const st = (state: EntityState['state'], attributes: EntityState['attributes'] = {}): EntityState => ({ state, attributes });

describe('Z-Wave: plan del mock', () => {
  it('enchufe Fibaro: Binary Switch y Meter (W y kWh), nodo que escucha', () => {
    const plug = dev('enchufe', 'fibaro-wall-plug', 'Enchufe despacho');
    expect(zwaveSupport(plug, defOf('fibaro-wall-plug'))).toEqual({ ok: true });
    const node = zwaveNodePlan(plug, defOf('fibaro-wall-plug'), 5, 'Despacho');
    expect(node.ccs).toEqual(['Binary Switch', 'Meter']);
    expect(node.listening).toBe(true);
    expect([node.genericDeviceClass, node.specificDeviceClass]).toEqual([0x10, 0x01]);
    expect(node.bindings.map((b) => b.value)).toEqual(['binarySwitch', 'meterW', 'meterKwh']);
    const values = zwaveNodeValues(node, { 'switch.enchufe_despacho_switch': st('on'), 'sensor.enchufe_despacho_power': st('12.5'), 'sensor.enchufe_despacho_energy': st(3.2) });
    expect(values).toEqual({ binarySwitch: true, meterW: 12.5, meterKwh: 3.2 });
    expect(zwaveCommandToService(node, { kind: 'binarySwitch', value: true })).toEqual({ entityId: 'switch.enchufe_despacho_switch', service: 'switch.turn_on', data: {} });
  });

  it('Aeotec MultiSensor 7 a pilas: Notification, Multilevel Sensor, Battery y Wake Up', () => {
    const ms = dev('ms', 'aeotec-multisensor-7', 'Sensor pasillo');
    const node = zwaveNodePlan(ms, defOf('aeotec-multisensor-7'), 9);
    expect(node.listening).toBe(false);
    expect(node.ccs).toEqual(['Multilevel Sensor', 'Notification', 'Battery', 'Wake Up']);
    expect(zwaveNodeValues(node, { 'binary_sensor.sensor_pasillo_motion': st('on'), 'sensor.sensor_pasillo_temperature': st('21.5'), 'sensor.sensor_pasillo_battery': st(80) })).toEqual({
      motion: true,
      temperature: 21.5,
      battery: 80,
    });
  });

  it('persiana: Multilevel Switch como cubierta (Motor Control) y posición ↔ nivel', () => {
    const cover = dev('p', 'shelly-wave-shutter', 'Persiana');
    const node = zwaveNodePlan(cover, defOf('shelly-wave-shutter'), 3);
    expect(node.multilevelAs).toBe('cover');
    expect(node.genericDeviceClass).toBe(0x11);
    expect(node.specificDeviceClass).toBe(0x06);
    expect(zwaveNodeValues(node, { 'cover.persiana_cover': st('open', { current_position: 100 }) }).multilevelSwitch).toBe(99);
    expect(zwaveCommandToService(node, { kind: 'multilevelSwitch', value: 0 })).toMatchObject({ service: 'cover.set_cover_position', data: { position: 0 } });
  });

  it('luz regulable y cerradura de un dispositivo personalizado', () => {
    const light: DeviceDefinition = { ...defOf('zooz-zen71'), id: 'regulador', entities: [{ key: 'light', domain: 'light', name: 'Luz', initialState: 'off', capabilities: { colorModes: ['brightness'] } }] };
    const node = zwaveNodePlan(dev('l', 'zooz-zen71', 'Regulador'), light, 4);
    expect(node.multilevelAs).toBe('light');
    expect(zwaveNodeValues(node, { 'light.regulador': st('on', { brightness: 255 }) }).multilevelSwitch).toBe(99);
    expect(zwaveCommandToService(node, { kind: 'multilevelSwitch', value: 50 })).toEqual({ entityId: 'light.regulador', service: 'light.turn_on', data: { brightness: levelToBrightness(50) } });
    expect(zwaveCommandToService(node, { kind: 'multilevelSwitch', value: 0 })?.service).toBe('light.turn_off');
    expect(brightnessToLevel(1)).toBe(1);
    const lockDef: DeviceDefinition = { ...defOf('zooz-zen71'), id: 'cerrojo', entities: [{ key: 'lock', domain: 'lock', name: 'Cerradura', initialState: 'locked' }] };
    const lock = zwaveNodePlan(dev('c', 'zooz-zen71', 'Cerrojo'), lockDef, 6);
    expect(lock.ccs).toEqual(['Door Lock']);
    expect([lock.genericDeviceClass, lock.specificDeviceClass]).toEqual([0x40, 0x03]);
    expect(zwaveNodeValues(lock, { 'lock.cerrojo': st('unlocked') }).locked).toBe(false);
    expect(zwaveCommandToService(lock, { kind: 'doorLock', locked: true })?.service).toBe('lock.lock');
  });

  it('lo no emulable sigue por MQTT con el motivo', () => {
    const climate: DeviceDefinition = { ...defOf('zooz-zen71'), id: 'termo', entities: [{ key: 'climate', domain: 'climate', name: 'Termostato', initialState: 'heat' }] };
    expect(zwaveSupport(dev('t', 'zooz-zen71', 'T'), climate)).toMatchObject({ ok: false, reason: expect.stringMatching(/climate/) });
    const two: DeviceDefinition = { ...defOf('zooz-zen71'), id: 'doble', entities: [{ key: 'l1', domain: 'switch', name: 'L1', initialState: 'off' }, { key: 'l2', domain: 'switch', name: 'L2', initialState: 'off' }] };
    expect(zwaveSupport(dev('d', 'zooz-zen71', 'D'), two)).toMatchObject({ ok: false, reason: expect.stringMatching(/endpoints/) });
  });

  it('ids de nodo estables', () => {
    const a = allocateNodeIds(['x', 'y', 'z']);
    const b = allocateNodeIds(['z', 'x', 'y', 'nuevo']);
    for (const id of ['x', 'y', 'z']) expect(b.get(id)).toBe(a.get(id));
    expect(new Set(a.values()).size).toBe(3);
    for (const n of a.values()) expect(n >= 2 && n <= 232).toBe(true);
  });

  it('red del proyecto: controlador y nodos', () => {
    const project: Project = {
      ...createDemoProject(),
      id: 'zw',
      devices: [dev('antena', 'ha-connect-zwa-2', 'Antena'), dev('enchufe', 'fibaro-wall-plug', 'Enchufe'), dev('ms', 'aeotec-multisensor-7', 'Multisensor')],
      connections: [],
    };
    const plan = buildZwavePlan(project, catalog);
    expect(plan.controllerDeviceId).toBe('antena');
    expect(plan.nodes.map((n) => n.deviceId).sort()).toEqual(['enchufe', 'ms']);
  });
});

describe('ESPHome: plan de los nodos de la API nativa', () => {
  it('ESP32 con sensores: sensor, binary_sensor y estados', () => {
    const esp = dev('esp', 'esphome-esp32', 'Sensor despacho');
    expect(esphomeSupport(esp, defOf('esphome-esp32'))).toEqual({ ok: true });
    const node = esphomeNodePlan('proyecto', esp, defOf('esphome-esp32'), 'Despacho');
    expect(node.name).toBe('hasim-esp');
    expect(node.mac).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    expect(node.entities.map((e) => [e.kind, e.objectId, e.haEntityId])).toEqual([
      ['sensor', 'temperature', 'sensor.sensor_despacho_temperature'],
      ['sensor', 'humidity', 'sensor.sensor_despacho_humidity'],
      ['sensor', 'pressure', 'sensor.sensor_despacho_pressure'],
      ['binary_sensor', 'motion', 'binary_sensor.sensor_despacho_motion'],
    ]);
    expect(new Set(node.entities.map((e) => e.key)).size).toBe(4);
    const temp = node.entities[0];
    expect(temp).toMatchObject({ unit: '°C', deviceClass: 'temperature', stateClass: 1 });
    const states = espNodeStates(node, { 'sensor.sensor_despacho_temperature': st('23.4'), 'binary_sensor.sensor_despacho_motion': st('on') });
    expect(states.get(temp?.key ?? 0)).toEqual({ type: 'float', state: 23.4 });
    expect(states.get(node.entities[1]?.key ?? 0)).toMatchObject({ missing: true });
    expect(states.get(node.entities[3]?.key ?? 0)).toEqual({ type: 'binary', state: true });
  });

  it('HA Voice PE: satélite como estado + texto de anuncio; reproductor dividido', () => {
    const voice = dev('voz', 'ha-voice-pe', 'Voz cocina');
    const node = esphomeNodePlan('p', voice, defOf('ha-voice-pe'));
    const announce = node.entities.find((e) => e.role === 'announce');
    expect(announce).toMatchObject({ kind: 'text', haEntityId: 'text.voz_cocina_satellite_announce' });
    expect(espCommandToService(node, { type: 'text', key: announce?.key ?? 0, state: 'Hola' })).toEqual({ entityId: 'assist_satellite.voz_cocina_satellite', service: 'assist_satellite.announce', data: { message: 'Hola' } });
    const volume = node.entities.find((e) => e.role === 'volume');
    expect(espCommandToService(node, { type: 'number', key: volume?.key ?? 0, state: 40 })).toMatchObject({ service: 'media_player.volume_set', data: { volume_level: 0.4 } });
    const mute = node.entities.find((e) => e.kind === 'switch' && e.role === 'main');
    expect(espCommandToService(node, { type: 'switch', key: mute?.key ?? 0, state: true })).toEqual({ entityId: 'switch.voz_cocina_mute', service: 'switch.turn_on', data: {} });
  });

  it('luces: modos de color y comandos', () => {
    const def: DeviceDefinition = { ...defOf('esphome-esp32'), id: 'tira', entities: [{ key: 'light', domain: 'light', name: 'Tira', initialState: 'off', capabilities: { colorModes: ['brightness', 'rgb'] } }] };
    const node = esphomeNodePlan('p', dev('tira', 'esphome-esp32', 'Tira LED'), def);
    const light = node.entities[0];
    expect(light?.colorModes).toEqual([ESP_COLOR_MODE.rgb]);
    expect(espCommandToService(node, { type: 'light', key: light?.key ?? 0, state: true, brightness: 0.5, rgb: [1, 0, 0] })).toEqual({ entityId: 'light.tira_led', service: 'light.turn_on', data: { brightness: 128, rgb_color: [255, 0, 0] } });
    expect(espCommandToService(node, { type: 'light', key: light?.key ?? 0, state: false })?.service).toBe('light.turn_off');
    expect(espNodeStates(node, { 'light.tira_led': st('on', { brightness: 255, rgb_color: '[0, 255, 0]' }) }).get(light?.key ?? 0)).toMatchObject({ type: 'light', on: true, brightness: 1, colorMode: ESP_COLOR_MODE.rgb });
  });

  it('nombres y MAC estables; dominios no emulables', () => {
    expect(nodeNameFor('demo-esp32')).toBe('hasim-demo-esp32');
    expect(nodeNameFor('un-identificador-muy-largo-de-dispositivo-0001').length).toBeLessThanOrEqual(31);
    expect(macFor('p', 'd')).toBe(macFor('p', 'd'));
    expect(macFor('p', 'd')).not.toBe(macFor('p', 'e'));
    const cover: DeviceDefinition = { ...defOf('esphome-esp32'), id: 'garaje', entities: [{ key: 'cover', domain: 'cover', name: 'Puerta', initialState: 'closed' }] };
    expect(esphomeSupport(dev('g', 'esphome-esp32', 'Garaje'), cover)).toMatchObject({ ok: false });
  });
});

describe('vías reales activas', () => {
  const project: Project = {
    ...createDemoProject(),
    id: 'mix',
    devices: [dev('enchufe', 'fibaro-wall-plug', 'Enchufe'), dev('esp', 'esphome-esp32', 'ESP'), dev('cafe', 'sonoff-s26r2', 'Cafetera')],
    connections: [],
  };
  it('capabilities → vías activas → dispositivos que salen de MQTT', () => {
    expect([...activeNativeTransports({ zwave: true })]).toEqual(['zwave_js']);
    const active = activeNativeTransports({ zwave: true, esphome: true });
    const native = nativeDevices(project, catalog, active);
    expect([...native]).toEqual([
      ['enchufe', 'zwave_js'],
      ['esp', 'esphome'],
    ]);
    const model = buildBridgeModel(project, catalog, undefined, new Set(native.keys()));
    expect(model.devices.map((d) => d.device.id)).toEqual(['cafe']);
    expect(nativeDecision(project.devices[0] as Device, defOf('fibaro-wall-plug'), new Set())).toMatchObject({ native: false, profile: 'zwave' });
    expect(buildEsphomePlan(project, catalog).map((n) => n.deviceId)).toEqual(['esp']);
  });
});
