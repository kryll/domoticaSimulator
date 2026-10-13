import { describe, expect, it } from 'vitest';
import { catalog } from '../../devices/catalog';
import { createDemoProject } from '../../store/demoProject';
import type { Device, DeviceDefinition, EntityState, Project } from '../../types';
import { activeNativeTransports, nativeDecision, nativeDevices } from '../native';
import { viaInfo } from '../via';
import { buildBridgeModel } from '../mqtt/model';
import {
  SHELLY_FW_ID,
  buildShellyPlan,
  changedComponents,
  describeShellyStatus,
  handleShellyRpc,
  shellyComponentsStatus,
  shellyConfig,
  shellyCoverState,
  shellyDeviceInfo,
  shellyGenOf,
  shellyMacFor,
  shellyMethods,
  shellyModelOf,
  shellyNodePlan,
  shellyStatus,
  shellySupport,
  type JsonObject,
} from './plan';

const defOf = (id: string): DeviceDefinition => {
  const def = catalog.find((d) => d.id === id);
  if (!def) throw new Error(`no existe ${id}`);
  return def;
};

const dev = (id: string, definitionId: string, name: string, extra: Partial<Device> = {}): Device => {
  const def = defOf(definitionId);
  return { id, definitionId, name, floorId: 'f', position: { x: 0, y: 0 }, protocol: def.protocols[0] ?? 'wifi', integration: def.integrations[0] ?? 'shelly', ...extra };
};

const st = (state: EntityState['state'], attributes: EntityState['attributes'] = {}): EntityState => ({ state, attributes });
const RT = { uptime: 12, unixtime: 1_800_000_000 };

describe('Shelly: modelos y compatibilidad', () => {
  it('modelo y generación desde la definición del catálogo', () => {
    expect(shellyModelOf(defOf('shelly-2pm-gen3-cover'))).toBe('S3SW-002P16EU');
    expect(shellyGenOf('S3SW-001P16EU')).toBe(3);
    expect(shellyGenOf('SPEM-003CEBEU')).toBe(2);
    expect(shellyGenOf('SNSW-001X8EU')).toBe(2);
    expect(shellyGenOf('S4SW-001P16EU')).toBe(4);
    expect(shellyGenOf('SHEM')).toBe(1);
  });

  it('Gen2+ con salidas, persiana, medidores y sensores; Gen1 y la puerta de garaje no', () => {
    for (const id of ['shelly-plug-s-gen3', 'shelly-1pm-gen3', 'shelly-2pm-gen3', 'shelly-2pm-gen3-cover', 'shelly-ht-gen3', 'shelly-pro-3em']) {
      expect(shellySupport(dev('d', id, 'D'), defOf(id))).toEqual({ ok: true });
    }
    expect(shellySupport(dev('em', 'shelly-em', 'EM'), defOf('shelly-em'))).toMatchObject({ ok: false, reason: expect.stringContaining('Gen1') });
    expect(shellySupport(dev('g', 'shelly-1-garage', 'Garaje'), defOf('shelly-1-garage'))).toMatchObject({ ok: false });
    const odd: DeviceDefinition = { ...defOf('shelly-1pm-gen3'), id: 'raro', entities: [{ key: 'motion', domain: 'binary_sensor', name: 'Movimiento', initialState: 'off' }] };
    expect(shellySupport(dev('r', 'shelly-1pm-gen3', 'Raro'), odd)).toMatchObject({ ok: false, reason: expect.stringContaining('binary_sensor') });
  });

  it('MAC estable, única por dispositivo y localmente administrada (12 cifras hex)', () => {
    const a = shellyMacFor('p', 'd');
    expect(a).toMatch(/^[0-9A-F]{12}$/);
    expect(shellyMacFor('p', 'd')).toBe(a);
    expect(shellyMacFor('p', 'e')).not.toBe(a);
    expect(shellyMacFor('q', 'd')).not.toBe(a);
    expect(parseInt(a.slice(0, 2), 16) & 0x03).toBe(0x02);
  });
});

describe('Shelly: plan de componentes', () => {
  it('1PM Gen3: switch:0 con potencia y energía; unique_id de HA para alinear', () => {
    const plan = shellyNodePlan('proyecto', dev('luz', 'shelly-1pm-gen3', 'Luz cocina'), defOf('shelly-1pm-gen3'), 'Cocina');
    expect(plan.hostname).toBe(`shelly1pmg3-${plan.mac.toLowerCase()}`);
    expect(plan).toMatchObject({ model: 'S3SW-001P16EU', gen: 3, app: 'S1PMG3', area: 'Cocina', friendlyName: 'Luz cocina' });
    expect(plan.components).toEqual([{ key: 'switch:0', type: 'switch', id: 0, name: null, entityId: 'switch.luz_cocina_switch' }]);
    expect(plan.entities).toEqual([
      { entityId: 'switch.luz_cocina_switch', haDomain: 'switch', uniqueSuffix: 'switch:0' },
      { entityId: 'sensor.luz_cocina_power', haDomain: 'sensor', uniqueSuffix: 'switch:0-power' },
      { entityId: 'sensor.luz_cocina_energy', haDomain: 'sensor', uniqueSuffix: 'switch:0-energy' },
    ]);
  });

  it('2PM en modo persiana: cover:0 y perfil cover', () => {
    const plan = shellyNodePlan('p', dev('per', 'shelly-2pm-gen3-cover', 'Persiana'), defOf('shelly-2pm-gen3-cover'));
    expect(plan.profile).toBe('cover');
    expect(plan.components.map((c) => c.key)).toEqual(['cover:0']);
    expect(plan.entities.map((e) => e.uniqueSuffix)).toEqual(['cover:0', 'cover:0-power']);
    expect(shellyDeviceInfo(plan)).toMatchObject({ profile: 'cover', gen: 3, model: 'S3SW-002P16EU', auth_en: false, fw_id: SHELLY_FW_ID });
  });

  it('2PM con dos canales: switch:0 y switch:1 con nombre; la medida no se alinea (es del dispositivo)', () => {
    const plan = shellyNodePlan('p', dev('dos', 'shelly-2pm-gen3', 'Dos canales'), defOf('shelly-2pm-gen3'));
    expect(plan.profile).toBe('switch');
    expect(plan.components.map((c) => [c.key, c.name])).toEqual([
      ['switch:0', 'Canal 1'],
      ['switch:1', 'Canal 2'],
    ]);
    expect(plan.entities.map((e) => e.uniqueSuffix)).toEqual(['switch:0', 'switch:1']);
    // La potencia se reparte entre los canales encendidos y la energía entre todos.
    const status = shellyComponentsStatus(plan, {
      'switch.dos_canales_switch_0': st('on'),
      'switch.dos_canales_switch_1': st('off'),
      'sensor.dos_canales_power': st(100),
      'sensor.dos_canales_energy': st(2),
    });
    expect(status['switch:0']).toMatchObject({ output: true, apower: 100 });
    expect(status['switch:1']).toMatchObject({ output: false, apower: 0 });
    expect((status['switch:0']?.aenergy as JsonObject).total).toBe(1000);
  });

  it('Pro 3EM: em:0 (fases) y emdata:0', () => {
    const plan = shellyNodePlan('p', dev('em', 'shelly-pro-3em', 'Contador'), defOf('shelly-pro-3em'));
    expect(plan.components.map((c) => c.key)).toEqual(['em:0', 'emdata:0']);
    expect(plan.entities.map((e) => e.uniqueSuffix)).toEqual(['em:0-total_act_power', 'em:0-a_act_power', 'em:0-b_act_power', 'em:0-c_act_power', 'em:0-a_voltage', 'emdata:0-total_act']);
    const s = shellyComponentsStatus(plan, {
      'sensor.contador_power': st(900),
      'sensor.contador_power_a': st(300),
      'sensor.contador_power_b': st(500),
      'sensor.contador_power_c': st(100),
      'sensor.contador_voltage': st(231),
      'sensor.contador_energy': st(12.5),
    });
    expect(s['em:0']).toMatchObject({ total_act_power: 900, a_act_power: 300, b_act_power: 500, c_act_power: 100, a_voltage: 231 });
    expect(s['emdata:0']).toMatchObject({ total_act: 12500 });
  });

  it('H&T Gen3: temperature:0, humidity:0 y devicepower:0 (siempre despierto)', () => {
    const plan = shellyNodePlan('p', dev('ht', 'shelly-ht-gen3', 'Clima'), defOf('shelly-ht-gen3'));
    expect(plan.components.map((c) => c.key)).toEqual(['temperature:0', 'humidity:0', 'devicepower:0']);
    expect(plan.entities.map((e) => e.uniqueSuffix)).toEqual(['temperature:0-temperature_tc', 'humidity:0-humidity_rh', 'devicepower:0-battery']);
    const s = shellyComponentsStatus(plan, { 'sensor.clima_temperature': st('21.46'), 'sensor.clima_humidity': st(48), 'sensor.clima_battery': st(80) });
    expect(s['temperature:0']).toEqual({ id: 0, tC: 21.5, tF: 70.6 });
    expect(s['humidity:0']).toEqual({ id: 0, rh: 48 });
    expect(s['devicepower:0']).toMatchObject({ battery: { percent: 80 }, external: { present: false } });
    expect(shellyStatus(plan, {}, RT).sys).not.toHaveProperty('wakeup_period');
  });

  it('dimmer (definición propia): light:0 con brillo en %', () => {
    const def: DeviceDefinition = { ...defOf('shelly-1pm-gen3'), id: 'dim', model: 'S3DM-0A101WWL', entities: [{ key: 'light', domain: 'light', name: 'Luz', initialState: 'off', capabilities: { colorModes: ['brightness'] } }] };
    const plan = shellyNodePlan('p', dev('dim', 'shelly-1pm-gen3', 'Regulador'), def);
    expect(plan.components.map((c) => c.key)).toEqual(['light:0']);
    expect(shellyComponentsStatus(plan, { 'light.regulador': st('on', { brightness: 128 }) })['light:0']).toMatchObject({ output: true, brightness: 50 });
    expect(handleShellyRpc(plan, 'Light.Set', { id: 0, on: true, brightness: 100 }, {}, RT).commands).toEqual([{ entityId: 'light.regulador', service: 'light.turn_on', data: { brightness: 255 } }]);
    expect(handleShellyRpc(plan, 'Light.Set', { id: 0, on: false }, {}, RT).commands).toEqual([{ entityId: 'light.regulador', service: 'light.turn_off', data: {} }]);
    expect(handleShellyRpc(plan, 'Light.Toggle', { id: 0 }, {}, RT).commands[0]?.service).toBe('light.toggle');
  });
});

describe('Shelly: estado RPC', () => {
  const plan = shellyNodePlan('p', dev('luz', 'shelly-1pm-gen3', 'Luz cocina'), defOf('shelly-1pm-gen3'));

  it('switch:0 con apower, voltage (nominal), current derivada y aenergy en Wh', () => {
    const s = shellyComponentsStatus(plan, { 'switch.luz_cocina_switch': st('on'), 'sensor.luz_cocina_power': st('36'), 'sensor.luz_cocina_energy': st(1.234) });
    expect(s['switch:0']).toEqual({ id: 0, source: 'init', output: true, apower: 36, voltage: 230, current: 0.157, aenergy: { total: 1234, by_minute: [0, 0, 0], minute_ts: 0 } });
  });

  it('Shelly.GetStatus lleva sys (mac, uptime, available_updates), wifi y cloud', () => {
    const s = shellyStatus(plan, {}, RT);
    expect(s.sys).toMatchObject({ mac: plan.mac, uptime: 12, unixtime: 1_800_000_000, restart_required: false, available_updates: {} });
    expect(s.wifi).toMatchObject({ sta_ip: '127.0.0.1' });
    expect(s.cloud).toEqual({ connected: false });
    expect(s['switch:0']).toMatchObject({ output: false });
  });

  it('Shelly.GetConfig: nombre del dispositivo, wifi (sta/sta1/ap) y ws como espera la integración', () => {
    const c = shellyConfig(plan);
    expect(c.sys).toMatchObject({ device: { name: 'Luz cocina', mac: plan.mac } });
    expect(c.wifi).toMatchObject({ sta: { enable: true }, sta1: { enable: false }, ap: { enable: false, is_open: false } });
    expect(c.ws).toMatchObject({ enable: false, server: null });
    expect(c['switch:0']).toMatchObject({ id: 0, name: null });
  });

  it('persiana: estados open/closed/stopped/opening y posición', () => {
    expect(shellyCoverState(st('closed', { current_position: 0 }))).toBe('closed');
    expect(shellyCoverState(st('open', { current_position: 100 }))).toBe('open');
    expect(shellyCoverState(st('open', { current_position: 40 }))).toBe('stopped');
    expect(shellyCoverState(st('opening', { current_position: 40 }))).toBe('opening');
    const cover = shellyNodePlan('p', dev('per', 'shelly-2pm-gen3-cover', 'Persiana'), defOf('shelly-2pm-gen3-cover'));
    expect(shellyComponentsStatus(cover, { 'cover.persiana_cover': st('closing', { current_position: 60 }) })['cover:0']).toMatchObject({ state: 'closing', current_pos: 60, pos_control: true, last_direction: 'close' });
  });

  it('solo cambian los componentes distintos (NotifyStatus) y el resumen para el inspector', () => {
    const a = shellyComponentsStatus(plan, { 'switch.luz_cocina_switch': st('off') });
    const b = shellyComponentsStatus(plan, { 'switch.luz_cocina_switch': st('on') });
    expect(changedComponents(a, a)).toEqual({});
    expect(Object.keys(changedComponents(a, b))).toEqual(['switch:0']);
    expect(describeShellyStatus('switch:0', b['switch:0'] ?? {})).toBe('switch:0: on');
  });
});

describe('Shelly: llamadas RPC de HA', () => {
  const plan = shellyNodePlan('p', dev('luz', 'shelly-1pm-gen3', 'Luz cocina'), defOf('shelly-1pm-gen3'));
  const cover = shellyNodePlan('p', dev('per', 'shelly-2pm-gen3-cover', 'Persiana'), defOf('shelly-2pm-gen3-cover'));

  it('lecturas: GetDeviceInfo, GetStatus, GetConfig, GetComponents y ListMethods', () => {
    expect(handleShellyRpc(plan, 'Shelly.GetDeviceInfo', undefined, {}, RT).result).toEqual(shellyDeviceInfo(plan));
    expect(handleShellyRpc(plan, 'Shelly.GetComponents', { dynamic_only: true }, {}, RT).result).toEqual({ components: [], cfg_rev: 1, offset: 0, total: 0 });
    const methods = handleShellyRpc(plan, 'Shelly.ListMethods', undefined, {}, RT).result as JsonObject;
    expect(methods.methods).toEqual(shellyMethods(plan));
    expect(shellyMethods(plan)).toContain('Switch.Set');
    expect(shellyMethods(plan)).not.toContain('Script.List');
    expect(handleShellyRpc(plan, 'Switch.GetStatus', { id: 0 }, { 'switch.luz_cocina_switch': st('on') }, RT).result).toMatchObject({ output: true });
    expect(handleShellyRpc(plan, 'Sys.GetStatus', undefined, {}, RT).result).toMatchObject({ uptime: 12 });
  });

  it('Switch.Set y Switch.Toggle → servicios del simulador (con was_on)', () => {
    const entities = { 'switch.luz_cocina_switch': st('off') };
    expect(handleShellyRpc(plan, 'Switch.Set', { id: 0, on: true }, entities, RT)).toEqual({ result: { was_on: false }, commands: [{ entityId: 'switch.luz_cocina_switch', service: 'switch.turn_on', data: {} }] });
    expect(handleShellyRpc(plan, 'Switch.Set', { id: 0, on: false }, entities, RT).commands[0]?.service).toBe('switch.turn_off');
    expect(handleShellyRpc(plan, 'Switch.Toggle', { id: 0 }, entities, RT).commands[0]?.service).toBe('switch.toggle');
  });

  it('persiana: Open, Close, Stop y GoToPosition', () => {
    const svc = (method: string, params: JsonObject = { id: 0 }) => handleShellyRpc(cover, method, params, {}, RT);
    expect(svc('Cover.Open')).toEqual({ result: null, commands: [{ entityId: 'cover.persiana_cover', service: 'cover.open_cover', data: {} }] });
    expect(svc('Cover.Close').commands[0]?.service).toBe('cover.close_cover');
    expect(svc('Cover.Stop').commands[0]?.service).toBe('cover.stop_cover');
    expect(svc('Cover.GoToPosition', { id: 0, pos: 42 }).commands[0]).toEqual({ entityId: 'cover.persiana_cover', service: 'cover.set_cover_position', data: { position: 42 } });
  });

  it('errores como el firmware: método desconocido, id inexistente o falta un argumento', () => {
    expect(handleShellyRpc(plan, 'Script.List', undefined, {}, RT).error).toEqual({ code: 404, message: 'No handler for Script.List' });
    expect(handleShellyRpc(plan, 'Switch.Set', { id: 3, on: true }, {}, RT).error?.code).toBe(-105);
    expect(handleShellyRpc(plan, 'Switch.Set', { id: 0 }, {}, RT).error?.code).toBe(-103);
    expect(handleShellyRpc(cover, 'Cover.GoToPosition', { id: 0 }, {}, RT).error?.code).toBe(-103);
    expect(handleShellyRpc(plan, 'Cover.Open', { id: 0 }, {}, RT).commands).toEqual([]);
  });
});

describe('Shelly: vía hacia HA', () => {
  it('con el perfil shelly los Shelly Gen2+ salen de MQTT; Gen1 y el de garaje siguen por MQTT', () => {
    const project: Project = {
      ...createDemoProject(),
      id: 'mix',
      devices: [dev('luz', 'shelly-1pm-gen3', 'Luz'), dev('em', 'shelly-em', 'EM'), dev('g', 'shelly-1-garage', 'Garaje'), dev('cafe', 'sonoff-s26r2', 'Cafetera')],
      connections: [],
    };
    expect([...activeNativeTransports({ shelly: true })]).toEqual(['shelly']);
    const native = nativeDevices(project, catalog, activeNativeTransports({ shelly: true }));
    expect([...native]).toEqual([['luz', 'shelly']]);
    const model = buildBridgeModel(project, catalog, undefined, new Set(native.keys()));
    expect(model.devices.map((d) => d.device.id)).toEqual(['em', 'g', 'cafe']);
    expect(buildShellyPlan(project, catalog).map((p) => p.deviceId)).toEqual(['luz']);
    expect(nativeDecision(project.devices[0] as Device, defOf('shelly-1pm-gen3'), new Set())).toMatchObject({ native: false, profile: 'shelly' });
    expect(viaInfo(project.devices[0] as Device, defOf('shelly-1pm-gen3'), new Set(['shelly'])).label).toBe('Shelly (API RPC emulada)');
    expect(viaInfo(project.devices[0] as Device, defOf('shelly-1pm-gen3')).label).toMatch(/no disponible: ahora MQTT/);
    expect(viaInfo(project.devices[1] as Device, defOf('shelly-em'), new Set(['shelly'])).note).toMatch(/Gen1/);
  });

  it('el proyecto demo tiene tres Shelly Gen2+ (luz, persiana y enchufe)', () => {
    const demo = createDemoProject();
    expect(buildShellyPlan(demo, catalog).map((p) => [p.deviceId, p.model])).toEqual([
      ['demo-luz-cocina', 'S3SW-001P16EU'],
      ['demo-persiana', 'S3SW-002P16EU'],
      ['demo-enchufe-bano', 'S3PL-00112EU'],
    ]);
  });
});
