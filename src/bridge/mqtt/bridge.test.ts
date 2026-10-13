import { describe, expect, it } from 'vitest';
import { catalog } from '../../devices/catalog';
import { createDemoProject } from '../../store/demoProject';
import { callService, createSimulationState } from '../../simulation/engine';
import { setDeviceOffline } from '../../simulation/events';
import { defaultHaBridgeSettings, transportFor, type Device, type Project } from '../../types';
import { buildBridgeModel, ieeeAddress, type BridgeModel } from './model';
import { ORIGIN_NAME, SIMULATED_VERSION } from './discovery';
import { entityStateToPayload, z2mDevicePayload } from './state';
import { createCommandParser } from './commands';
import { desiredRetained, stateMessages } from './publish';
import { availabilityFromSim, availabilityMessages } from './availability';
import { kelvinToMired, rgbToXy, xyToRgb } from './color';

const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);

function demo(): Project {
  return createDemoProject();
}

/** Proyecto demo con un coordinador Z2M y la luz del pasillo y el sensor de puerta por Z2M. */
function z2mProject(): Project {
  const p = demo();
  const devices = p.devices.map((d): Device => {
    if (d.id === 'demo-coordinador' || d.id === 'demo-luz-pasillo' || d.id === 'demo-puerta' || d.id === 'demo-clima-dormitorio') return { ...d, integration: 'zigbee2mqtt' };
    return d;
  });
  return { ...p, devices };
}

/** Lo mismo que publica el orquestador (desiredRetained), solo los discovery (…/config) y bridge/*. */
function discoveryOf(model: BridgeModel): Array<{ topic: string; payload: string; retain: boolean }> {
  return desiredRetained(model, { live: true, unavailable: [] }).filter((m) => m.topic.endsWith('/config') || /\/bridge\/(info|devices)$/.test(m.topic));
}

function payloadOf(model: BridgeModel, topic: string): Record<string, unknown> {
  const msg = discoveryOf(model).find((m) => m.topic === topic);
  if (!msg) throw new Error(`sin mensaje ${topic}`);
  return JSON.parse(msg.payload) as Record<string, unknown>;
}

describe('transportFor', () => {
  const def = { integrations: [] };
  it('elige la vía por protocolo e integración', () => {
    expect(transportFor({ protocol: 'zigbee', integration: 'zigbee2mqtt' }, def)).toBe('z2m_mqtt');
    expect(transportFor({ protocol: 'zigbee', integration: 'zha' }, def)).toBe('mqtt_discovery');
    expect(transportFor({ protocol: 'zwave', integration: 'zwave_js' }, def)).toBe('zwave_js');
    expect(transportFor({ protocol: 'thread', integration: 'matter' }, def)).toBe('matter');
    expect(transportFor({ protocol: 'wifi', integration: 'shelly' }, def)).toBe('shelly');
    expect(transportFor({ protocol: 'wifi', integration: 'tuya' }, def)).toBe('mqtt_discovery');
  });
});

describe('modelo del puente', () => {
  it('ids estables y deterministas', () => {
    expect(ieeeAddress('a')).toMatch(/^0x[0-9a-f]{16}$/);
    expect(ieeeAddress('a')).toBe(ieeeAddress('a'));
    expect(ieeeAddress('a')).not.toBe(ieeeAddress('b'));
    const project = demo();
    const m1 = buildBridgeModel(project, catalog);
    const m2 = buildBridgeModel(structuredClone(project), catalog);
    expect(m1.devices.map((d) => d.ieee)).toEqual(m2.devices.map((d) => d.ieee));
  });

  it('no publica el servidor HA y publica la infraestructura con conectividad', () => {
    const model = buildBridgeModel(demo(), catalog);
    expect(model.devices.find((d) => d.device.id === 'demo-servidor')).toBeUndefined();
    const hue = model.devices.find((d) => d.device.id === 'demo-puente-hue');
    expect(hue?.infra).toBe(true);
  });

  it('el coordinador Z2M es el bridge y no un dispositivo', () => {
    const model = buildBridgeModel(z2mProject(), catalog);
    expect(model.coordinator.deviceId).toBe('demo-coordinador');
    expect(model.devices.find((d) => d.device.id === 'demo-coordinador')).toBeUndefined();
    expect(model.devices.find((d) => d.device.id === 'demo-luz-pasillo')?.profile).toBe('z2m');
  });
});

describe('discovery genérico', () => {
  const p = demo();
  const model = buildBridgeModel(p, catalog);
  const node = (id: string) => model.devices.find((d) => d.device.id === id)!;

  it('un mensaje retenido por dispositivo con dev, o y cmps', () => {
    const luz = node('demo-luz-salon');
    const cfg = payloadOf(model, `homeassistant/device/${luz.nodeId}/config`);
    expect(cfg.o).toEqual({ name: ORIGIN_NAME, sw_version: SIMULATED_VERSION });
    const dev = cfg.dev as Record<string, unknown>;
    expect(dev.suggested_area).toBe('Salón');
    expect(dev.sw_version).toBe('simulado');
    // La luz Hue llega por el puente Hue simulado.
    expect(dev.via_device).toBe(node('demo-puente-hue').nodeId);
    const cmps = cfg.cmps as Record<string, Record<string, unknown>>;
    const light = cmps.light!;
    expect(light.p).toBe('light');
    expect(light.default_entity_id).toBe('light.luz_salon');
    expect(light.unique_id).toBe(`hasim_${p.id}_demo-luz-salon_light`.replace(/[^A-Za-z0-9_-]+/g, '_'));
    expect(light.schema).toBe('json');
    expect(light.brightness_scale).toBe(255);
    expect(light.supported_color_modes).toEqual(expect.arrayContaining(['rgb']));
    expect(discoveryOf(buildBridgeModel(p, catalog)).every((m) => m.retain)).toBe(true);
  });

  it('cubre los dominios del motor', () => {
    const all = discoveryOf(buildBridgeModel(p, catalog)).map((m) => JSON.parse(m.payload) as Record<string, unknown>);
    const platforms = new Set(all.flatMap((c) => Object.values((c.cmps ?? {}) as Record<string, { p: string }>).map((x) => x.p)));
    for (const pl of ['light', 'switch', 'sensor', 'binary_sensor', 'cover', 'climate', 'lock', 'vacuum', 'number', 'select']) expect(platforms).toContain(pl);
  });

  it('climate con modos, consigna y temperatura actual', () => {
    const t = node('demo-termostato');
    const cfg = payloadOf(model, `homeassistant/device/${t.nodeId}/config`);
    const climate = Object.values(cfg.cmps as Record<string, Record<string, unknown>>).find((c) => c.p === 'climate')!;
    expect(climate.modes).toEqual(expect.arrayContaining(['off', 'heat']));
    expect(climate.temperature_command_topic).toMatch(/\/temperature\/set$/);
    expect(climate.current_temperature_template).toBe('{{ value_json.current_temperature }}');
  });

  it('el reproductor se publica como sensor, switch, number y select', () => {
    const tv = node('demo-tv');
    const cfg = payloadOf(model, `homeassistant/device/${tv.nodeId}/config`);
    const kinds = Object.values(cfg.cmps as Record<string, { p: string }>).map((c) => c.p).sort();
    expect(kinds).toEqual(expect.arrayContaining(['number', 'sensor', 'switch']));
  });

  it('respeta los topics configurados', () => {
    const settings = { ...defaultHaBridgeSettings(), discoveryPrefix: 'ha', baseTopic: 'lab' };
    const msgs = discoveryOf(buildBridgeModel(p, catalog, settings));
    expect(msgs.every((m) => m.topic.startsWith('ha/'))).toBe(true);
    expect(msgs.some((m) => m.payload.includes('"lab/'))).toBe(true);
  });
});

describe('discovery Z2M', () => {
  const p = z2mProject();
  const model = buildBridgeModel(p, catalog);
  const luz = model.devices.find((d) => d.device.id === 'demo-luz-pasillo')!;
  const coordIeee = model.coordinator.ieee;

  it('formato de Zigbee2MQTT: identifiers, via_device y topics por entidad', () => {
    const cfg = payloadOf(model, `homeassistant/light/${luz.ieee}/light/config`);
    const dev = cfg.device as Record<string, unknown>;
    expect(dev.identifiers).toEqual([`zigbee2mqtt_${luz.ieee}`]);
    expect(dev.via_device).toBe(`zigbee2mqtt_bridge_${coordIeee}`);
    expect(cfg.unique_id).toBe(`${luz.ieee}_light_zigbee2mqtt`);
    expect(cfg.state_topic).toBe(`hasim-z2m/${luz.friendlyName}`);
    expect(cfg.command_topic).toBe(`hasim-z2m/${luz.friendlyName}/set`);
    expect(cfg.brightness_scale).toBe(254);
    expect(cfg.default_entity_id).toBe('light.luz_pasillo');
    expect((cfg.origin as Record<string, unknown>).name).toBe('HA Simulator');
  });

  it('bridge/devices con ieee, tipo, power_source y exposes', () => {
    const msgs = discoveryOf(model);
    const devices = JSON.parse(msgs.find((m) => m.topic === 'hasim-z2m/bridge/devices')!.payload) as Array<Record<string, unknown>>;
    expect(devices[0]).toMatchObject({ type: 'Coordinator', ieee_address: coordIeee });
    const entry = devices.find((d) => d.ieee_address === luz.ieee)!;
    expect(entry.type).toBe('Router');
    expect(entry.power_source).toBe('Mains (single phase)');
    const exposes = (entry.definition as { exposes: Array<{ type: string }> }).exposes;
    expect(exposes.map((e) => e.type)).toContain('light');
    const sensor = devices.find((d) => (d.friendly_name as string) === 'Clima dormitorio')!;
    expect(sensor.type).toBe('EndDevice');
    expect(sensor.power_source).toBe('Battery');
    expect(msgs.some((m) => m.topic === 'hasim-z2m/bridge/info')).toBe(true);
  });

  it('sensor de puerta con contact invertido', () => {
    const door = model.devices.find((d) => d.device.id === 'demo-puerta')!;
    const cfg = payloadOf(model, `homeassistant/binary_sensor/${door.ieee}/contact/config`);
    expect(cfg.value_template).toBe('{{ value_json.contact }}');
    expect(cfg.payload_on).toBe(false);
  });
});

describe('estado', () => {
  const p = z2mProject();
  const model = buildBridgeModel(p, catalog);
  const sim = createSimulationState(p, catalog, NOW);

  it('genera mensajes de estado para todas las entidades publicables', () => {
    const msgs = stateMessages(model, sim.entities);
    expect(msgs.length).toBeGreaterThan(10);
    expect(msgs.every((m) => !m.topic.endsWith('/set'))).toBe(true);
  });

  it('light: brillo, color_temp en mireds y rgb', () => {
    const e = model.devices.find((d) => d.device.id === 'demo-luz-salon')!.entities[0]!;
    const on = callService(sim, p, 'light.luz_salon', 'light.turn_on', { brightness: 128, rgb_color: [255, 0, 0] });
    expect(JSON.parse(entityStateToPayload(e, on.entities['light.luz_salon'])!)).toMatchObject({ state: 'ON', brightness: 128, color: { r: 255, g: 0, b: 0 }, color_mode: 'rgb' });
    const warm = callService(sim, p, 'light.luz_salon', 'light.turn_on', { color_temp_kelvin: 2500 });
    expect(JSON.parse(entityStateToPayload(e, warm.entities['light.luz_salon'])!)).toMatchObject({ color_temp: 400, color_mode: 'color_temp' });
    expect(entityStateToPayload(e, { state: 'unavailable' })).toBeUndefined();
  });

  it('Z2M: un JSON por dispositivo con linkquality', () => {
    const door = model.devices.find((d) => d.device.id === 'demo-puerta')!;
    const doc = JSON.parse(z2mDevicePayload(door, sim.entities)!) as Record<string, unknown>;
    expect(doc.contact).toBe(true);
    expect(doc.battery).toBe(100);
    expect(typeof doc.linkquality).toBe('number');
  });
});

describe('comandos', () => {
  const p = z2mProject();
  const model = buildBridgeModel(p, catalog);
  const parser = createCommandParser(model);
  const luzSalon = model.devices.find((d) => d.device.id === 'demo-luz-salon')!.entities[0]!;
  const t = model.devices.find((d) => d.device.id === 'demo-termostato')!.entities.find((e) => e.domain === 'climate')!;
  const cover = model.devices.find((d) => d.device.id === 'demo-persiana')!.entities.find((e) => e.domain === 'cover')!;
  const lock = model.devices.find((d) => d.device.id === 'demo-cerradura')!.entities.find((e) => e.domain === 'lock')!;
  const pasillo = model.devices.find((d) => d.device.id === 'demo-luz-pasillo')!;

  it('genéricos', () => {
    expect(parser.parse(`${luzSalon.commandTopic}/set`, '{"state":"ON","brightness":10,"color":{"r":0,"g":0,"b":255}}')).toEqual([
      { entityId: 'light.luz_salon', service: 'light.turn_on', data: { brightness: 10, rgb_color: [0, 0, 255] } },
    ]);
    expect(parser.parse(`${luzSalon.commandTopic}/set`, '{"state":"OFF"}')).toEqual([{ entityId: 'light.luz_salon', service: 'light.turn_off', data: {} }]);
    expect(parser.parse(`${t.commandTopic}/temperature/set`, '22.5')?.[0]).toMatchObject({ service: 'climate.set_temperature', data: { temperature: 22.5 } });
    expect(parser.parse(`${t.commandTopic}/mode/set`, 'off')?.[0]).toMatchObject({ service: 'climate.set_hvac_mode', data: { hvac_mode: 'off' } });
    expect(parser.parse(`${cover.commandTopic}/position/set`, '40')?.[0]).toMatchObject({ service: 'cover.set_cover_position', data: { position: 40 } });
    expect(parser.parse(`${cover.commandTopic}/set`, 'STOP')?.[0]?.service).toBe('cover.stop_cover');
    expect(parser.parse(`${lock.commandTopic}/set`, 'UNLOCK')?.[0]?.service).toBe('lock.unlock');
    expect(parser.parse(`${luzSalon.commandTopic}/set`, 'basura')).toEqual([]);
    expect(parser.parse('otro/topic/set', 'ON')).toBeNull();
  });

  it('Z2M: JSON, texto y /set/<propiedad>', () => {
    const base = `hasim-z2m/${pasillo.friendlyName}/set`;
    expect(parser.parse(base, '{"state":"ON","brightness":254,"color_temp":250}')).toEqual([
      { entityId: 'light.luz_pasillo', service: 'light.turn_on', data: { brightness: 255, color_temp_kelvin: 4000 } },
    ]);
    expect(parser.parse(base, 'OFF')).toEqual([{ entityId: 'light.luz_pasillo', service: 'light.turn_off', data: {} }]);
    expect(parser.parse(`${base}/brightness`, '127')?.[0]).toMatchObject({ service: 'light.turn_on', data: { brightness: 128 } });
    expect(parser.parse('hasim-z2m/desconocido/set', 'ON')).toBeNull();
  });

  it('localiza el dispositivo de un topic', () => {
    expect(parser.deviceOf(`hasim-z2m/${pasillo.friendlyName}/set`)).toBe('demo-luz-pasillo');
    expect(parser.deviceOf(`${luzSalon.stateTopic}`)).toBe('demo-luz-salon');
  });

  it('ida y vuelta: comando → callService → estado → payload', () => {
    let sim = createSimulationState(p, catalog, NOW);
    const [command] = parser.parse(`${luzSalon.commandTopic}/set`, '{"state":"ON","brightness":200,"color_temp":370}')!;
    sim = callService(sim, p, command!.entityId, command!.service, command!.data);
    const doc = JSON.parse(entityStateToPayload(luzSalon, sim.entities['light.luz_salon'])!) as Record<string, unknown>;
    expect(doc).toMatchObject({ state: 'ON', brightness: 200, color_temp: kelvinToMired(2703), color_mode: 'color_temp' });

    const [z] = parser.parse(`hasim-z2m/${pasillo.friendlyName}/set`, '{"state":"ON","brightness":127}')!;
    sim = callService(sim, p, z!.entityId, z!.service, z!.data);
    const zdoc = JSON.parse(z2mDevicePayload(pasillo, sim.entities)!) as Record<string, unknown>;
    expect(zdoc).toMatchObject({ state: 'ON', brightness: 127 });
  });
});

describe('disponibilidad', () => {
  const p = z2mProject();
  const model = buildBridgeModel(p, catalog);

  it('online con todo bien; offline sin modo en vivo', () => {
    const sim = createSimulationState(p, catalog, NOW);
    const live = availabilityMessages(model, availabilityFromSim(p, sim));
    expect(live.find((m) => m.topic === 'hasim/bridge/state')?.payload).toBe('online');
    expect(live.find((m) => m.topic === 'hasim-z2m/bridge/state')?.payload).toBe('{"state":"online"}');
    const paused = availabilityMessages(model, availabilityFromSim(p, sim, false));
    expect(paused.every((m) => m.payload.includes('offline'))).toBe(true);
    expect(live.every((m) => m.retain)).toBe(true);
  });

  it('coordinador caído → bridge/state offline; dispositivo offline → su availability', () => {
    let sim = createSimulationState(p, catalog, NOW);
    sim = setDeviceOffline(sim, p, 'demo-coordinador', true);
    sim = setDeviceOffline(sim, p, 'demo-termostato', true);
    const msgs = availabilityMessages(model, availabilityFromSim(p, sim));
    expect(msgs.find((m) => m.topic === 'hasim-z2m/bridge/state')?.payload).toBe('{"state":"offline"}');
    const t = model.devices.find((d) => d.device.id === 'demo-termostato')!;
    expect(msgs.find((m) => m.topic === t.availabilityTopic)?.payload).toBe('offline');
  });

  it('batería agotada y nodos parados → offline', () => {
    const sim = { ...createSimulationState(p, catalog, NOW), batteries: { 'demo-puerta': 0 } };
    const door = model.devices.find((d) => d.device.id === 'demo-puerta')!;
    const msgs = availabilityMessages(model, availabilityFromSim(p, sim), new Set(['demo-termostato']));
    expect(msgs.find((m) => m.topic === door.availabilityTopic)?.payload).toBe('{"state":"offline"}');
    const t = model.devices.find((d) => d.device.id === 'demo-termostato')!;
    expect(msgs.find((m) => m.topic === t.availabilityTopic)?.payload).toBe('offline');
  });
});

describe('color', () => {
  it('rgb ↔ xy aproximado', () => {
    const xy = rgbToXy([255, 0, 0]);
    expect(xy.x).toBeGreaterThan(0.6);
    const back = xyToRgb(xy.x, xy.y);
    expect(back[0]).toBe(255);
    expect(back[1]).toBeLessThan(30);
  });
});

describe('dominios de la tanda 3 (alarma, válvula, sirena)', () => {
  const base = demo();
  const alarmDef = catalog.find((d) => d.entities.some((e) => e.domain === 'alarm_control_panel'));
  const valveDef = catalog.find((d) => d.entities.some((e) => e.domain === 'valve'));
  it.runIf(alarmDef !== undefined && valveDef !== undefined)('discovery y comandos', () => {
    const extra: Device[] = [alarmDef!, valveDef!].map((def, i) => ({
      id: `extra-${i}`,
      definitionId: def.id,
      name: i === 0 ? 'Alarma' : 'Válvula',
      floorId: base.floors[0]!.id,
      position: { x: 0, y: 0 },
      protocol: 'wifi',
      integration: 'tuya',
    }));
    const p = { ...base, devices: [...base.devices, ...extra] };
    const model = buildBridgeModel(p, catalog);
    const alarm = model.devices.find((d) => d.device.id === 'extra-0')!.entities.find((e) => e.domain === 'alarm_control_panel')!;
    const valve = model.devices.find((d) => d.device.id === 'extra-1')!.entities.find((e) => e.domain === 'valve')!;
    const parser = createCommandParser(model);
    expect(parser.parse(`${alarm.commandTopic}/set`, '{"action":"ARM_AWAY","code":"1234"}')).toEqual([
      { entityId: alarm.entityId, service: 'alarm_control_panel.alarm_arm_away', data: { code: '1234' } },
    ]);
    expect(parser.parse(`${valve.commandTopic}/set`, 'CLOSE')?.[0]?.service).toBe('valve.close_valve');
    const platforms = discoveryOf(model).flatMap((m) => Object.values((JSON.parse(m.payload).cmps ?? {}) as Record<string, { p: string }>).map((c) => c.p));
    expect(platforms).toEqual(expect.arrayContaining(['alarm_control_panel', 'valve']));
    expect(entityStateToPayload(alarm, { state: 'armed_away' })).toBe('{"state":"armed_away"}');
  });
});

describe('personalizados y perfil de radio', () => {
  it('los dispositivos personalizados del proyecto llegan al modelo aunque no estén en las definiciones dadas', () => {
    const p = demo();
    const base = catalog.find((d) => d.id === p.devices.find((x) => x.id === 'demo-cafetera')!.definitionId)!;
    const custom = { ...base, id: 'custom:cafetera-rara', name: 'Cafetera rara' };
    const project: Project = { ...p, customDefinitions: [custom], devices: p.devices.map((d) => (d.id === 'demo-cafetera' ? { ...d, definitionId: custom.id } : d)) };
    const model = buildBridgeModel(project, catalog);
    expect(model.devices.find((d) => d.device.id === 'demo-cafetera')?.def.id).toBe('custom:cafetera-rara');
  });

  it('el Z2M emulado publica el canal del perfil de radio del proyecto', () => {
    const channelOf = (p: Project): number => {
      const info = discoveryOf(buildBridgeModel(p, catalog)).find((m) => m.topic === 'hasim-z2m/bridge/info')!;
      return (JSON.parse(info.payload) as { network: { channel: number } }).network.channel;
    };
    expect(channelOf(z2mProject())).toBe(11);
    expect(channelOf({ ...z2mProject(), radioProfiles: { zigbee: { channel: 25 } } })).toBe(25);
  });

  it('los nodos parados no publican estado', () => {
    const p = z2mProject();
    const model = buildBridgeModel(p, catalog);
    const sim = createSimulationState(p, catalog, NOW);
    const luz = model.devices.find((d) => d.device.id === 'demo-luz-salon')!;
    expect(stateMessages(model, sim.entities).some((m) => m.topic === luz.entities[0]!.stateTopic)).toBe(true);
    expect(stateMessages(model, sim.entities, new Set(['demo-luz-salon'])).some((m) => m.topic === luz.entities[0]!.stateTopic)).toBe(false);
  });
});

describe('robots aspiradores y asistentes de voz por MQTT', () => {
  const p = demo();
  const model = buildBridgeModel(p, catalog);
  const node = (id: string) => {
    const n = model.devices.find((d) => d.device.id === id);
    if (!n) throw new Error(`sin nodo ${id}`);
    return n;
  };
  const cmpsOf = (id: string) => Object.values(payloadOf(model, `homeassistant/device/${node(id).nodeId}/config`).cmps as Record<string, Record<string, unknown>>);
  const parser = createCommandParser(model);

  it('vacuum: esquema state con fan_speed_list, send_command y la batería como sensor aparte', () => {
    const cmps = cmpsOf('demo-robot');
    const vac = cmps.find((c) => c.p === 'vacuum');
    expect(vac).toMatchObject({ fan_speed_list: expect.arrayContaining(['quiet', 'turbo']), supported_features: expect.arrayContaining(['send_command', 'fan_speed', 'status']) });
    expect(vac?.battery_level_topic).toBeUndefined();
    expect(cmps.some((c) => c.p === 'sensor' && c.device_class === 'battery')).toBe(true);
    expect(cmps.filter((c) => c.p === 'select').length).toBe(2);
  });

  it('estado y comandos del robot', () => {
    let sim = createSimulationState(p, catalog, NOW);
    sim = callService(sim, p, 'vacuum.robot_aspirador_vacuum', 'vacuum.set_fan_speed', { fan_speed: 'turbo' });
    const e = node('demo-robot').entities.find((x) => x.domain === 'vacuum');
    if (!e) throw new Error('sin vacuum');
    expect(JSON.parse(entityStateToPayload(e, sim.entities[e.entityId]) ?? '{}')).toMatchObject({ state: 'docked', fan_speed: 'turbo' });
    expect(parser.parse(`${e.commandTopic}/set`, 'start')).toEqual([{ entityId: e.entityId, service: 'vacuum.start', data: {} }]);
    expect(parser.parse(`${e.commandTopic}/fan_speed/set`, 'max')).toEqual([{ entityId: e.entityId, service: 'vacuum.set_fan_speed', data: { fan_speed: 'max' } }]);
    expect(parser.parse(`${e.commandTopic}/command/set`, '{"command": "app_segment_clean", "params": [16, 17]}')).toEqual([
      { entityId: e.entityId, service: 'vacuum.send_command', data: { command: 'app_segment_clean', params: [16, 17] } },
    ]);
  });

  it('assist_satellite: sensor de estado y notify de anuncios; el Echo, notify de Alexa Media Player', () => {
    const voz = cmpsOf('demo-voz-cocina');
    expect(voz.map((c) => c.p)).toEqual(expect.arrayContaining(['sensor', 'notify', 'select', 'switch']));
    const sat = node('demo-voz-cocina').entities.find((x) => x.domain === 'assist_satellite');
    if (!sat) throw new Error('sin satélite');
    expect(parser.parse(`${sat.commandTopic}/announce/set`, 'Hola')).toEqual([{ entityId: sat.entityId, service: 'assist_satellite.announce', data: { message: 'Hola' } }]);
    const echo = node('demo-echo').entities.find((x) => x.domain === 'media_player');
    if (!echo) throw new Error('sin Echo');
    expect(cmpsOf('demo-echo').some((c) => c.p === 'notify')).toBe(true);
    expect(parser.parse(`${echo.commandTopic}/announce/set`, 'Fuga')).toEqual([{ entityId: '', service: 'notify.alexa_media_echo_dormitorio', data: { message: 'Fuga' } }]);
    const nest = node('demo-nest-audio').entities[0];
    if (!nest) throw new Error('sin Nest');
    expect(parser.parse(`${nest.commandTopic}/announce/set`, 'Fuga')?.[0]).toMatchObject({ service: 'tts.speak', data: { media_player_entity_id: nest.entityId } });
  });
});
