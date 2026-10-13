// Vía ESPHome real: protobuf mínimo, cifrado Noise, un nodo de la API nativa probado con un cliente
// independiente (@2colors/esphome-native-api, con su propio Noise en WebAssembly) y el backend que
// reconcilia los nodos con el proyecto y los da de alta en HA.
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ProtoWriter, readProto } from '../src/esphome/proto';
import { decodePsk, initiateHandshake, respondHandshake } from '../src/esphome/noise';
import { EspNodeServer } from '../src/esphome/node';
import { EsphomeBackend } from '../src/esphome/backend';
import { ESPHOME_PORT_BASE, EspNodeStore } from '../src/esphome/store';
import { esphomeUniqueIdMatcher, fillForm, runConfigFlow, alignEntities, zwaveUniqueIdMatcher, type HaApi } from '../src/haNative';
import { esphomeNodePlan, espNodeStates, type EspCommand } from '../../../src/bridge/esphome/plan';
import { catalog } from '../../../src/devices/catalog';
import { createDemoProject } from '../../../src/store/demoProject';
import type { Device, EntityState, Project } from '../../../src/types';
import type { BridgeCommand } from '../../../src/bridge/mqtt/commands';

interface EspEntity {
  name: string;
  type: string;
  config: { objectId: string; key: number };
  on(event: 'state', cb: (state: { state?: unknown }) => void): void;
  setState(state: boolean): void;
}
interface EspClient {
  connect(): void;
  disconnect(): void;
  on(event: 'deviceInfo', cb: (info: { name: string; macAddress: string; friendlyName: string }) => void): void;
  on(event: 'newEntity', cb: (entity: EspEntity) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'disconnected' | 'initialized', cb: () => void): void;
}
const require = createRequire(import.meta.url);
const { Client } = require('@2colors/esphome-native-api') as { Client: new (opts: Record<string, unknown>) => EspClient };

async function waitFor<T>(fn: () => T | undefined | false, timeout = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const addr = srv.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

const def = catalog.find((d) => d.id === 'esphome-esp32');
const voiceDef = catalog.find((d) => d.id === 'ha-voice-pe');
if (!def || !voiceDef) throw new Error('catálogo sin ESPHome');
const device: Device = { id: 'esp', definitionId: def.id, name: 'Sensor despacho', floorId: 'f', position: { x: 0, y: 0 }, protocol: 'wifi', integration: 'esphome' };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('protobuf y Noise', () => {
  it('codifica y lee varint, fixed32, float, string y bool', () => {
    const buf = new ProtoWriter().uint(1, 300).fixed32(2, 0xdeadbeef).float(3, 21.5).string(4, 'hola').bool(5, true).uint(6, -1).finish();
    const f = readProto(buf);
    expect(f.uint(1)).toBe(300);
    expect(f.fixed32(2)).toBe(0xdeadbeef);
    expect(f.float(3)).toBeCloseTo(21.5);
    expect(f.string(4)).toBe('hola');
    expect(f.bool(5)).toBe(true);
    expect(f.has(7)).toBe(false);
  });

  it('handshake NNpsk0 y cifrado en los dos sentidos; clave equivocada → MAC failure', () => {
    const psk = randomBytes(32);
    const client = initiateHandshake(psk);
    const server = respondHandshake(psk, client.message1);
    const c = client.finish(server.reply);
    expect(server.decrypt.decrypt(c.encrypt.encrypt(Buffer.from('ping')))).toEqual(Buffer.from('ping'));
    expect(c.decrypt.decrypt(server.encrypt.encrypt(Buffer.from('pong')))).toEqual(Buffer.from('pong'));
    expect(() => respondHandshake(randomBytes(32), initiateHandshake(psk).message1)).toThrow('Handshake MAC failure');
    expect(() => decodePsk('corta')).toThrow();
  });
});

describe('nodo de la API nativa con un cliente independiente', () => {
  it('cifrado: device info, entidades, estados, comandos y parada', async () => {
    const plan = esphomeNodePlan('p', device, def, 'Despacho');
    const entities: Record<string, EntityState> = { 'sensor.sensor_despacho_temperature': { state: '21.5' }, 'binary_sensor.sensor_despacho_motion': { state: 'off' } };
    const key = randomBytes(32).toString('base64');
    const port = await freePort();
    const commands: EspCommand[] = [];
    const node = new EspNodeServer({ plan, port, psk: decodePsk(key), states: () => espNodeStates(plan, entities), onCommand: (c) => commands.push(c) });
    await node.start();
    cleanups.push(() => node.stop());
    const client = new Client({ host: '127.0.0.1', port, encryptionKey: key, reconnect: false, clientInfo: 'test' });
    const errors: Error[] = [];
    let info: { name: string; macAddress: string; friendlyName: string } | undefined;
    const seen = new Map<string, EspEntity>();
    const states: Array<[string, unknown]> = [];
    let disconnected = false;
    client.on('error', (e) => errors.push(e));
    client.on('deviceInfo', (i) => (info = i));
    client.on('disconnected', () => (disconnected = true));
    client.on('newEntity', (e) => {
      seen.set(e.config.objectId, e);
      e.on('state', (s) => states.push([e.config.objectId, s.state]));
    });
    client.connect();
    cleanups.push(() => client.disconnect());
    await waitFor(() => info && seen.size === 4 && states.length >= 2);
    expect(info).toMatchObject({ name: plan.name, macAddress: plan.mac, friendlyName: 'Sensor despacho' });
    expect([...seen.keys()].sort()).toEqual(['humidity', 'motion', 'pressure', 'temperature']);
    expect(states).toContainEqual(['temperature', 21.5]);
    // El simulador cambia la temperatura: llega a HA.
    entities['sensor.sensor_despacho_temperature'] = { state: '24.25' };
    node.pushStates(espNodeStates(plan, entities));
    await waitFor(() => states.some(([k, v]) => k === 'temperature' && v === 24.25));
    expect(node.clients).toBe(1);
    // Parar el nodo: el cliente se desconecta.
    await node.stop();
    await waitFor(() => disconnected);
    expect(errors.filter((e) => !/closed|ECONNRESET|disconnect/i.test(e.message))).toEqual([]);
  });

  it('comandos de HA: switch del HA Voice → callService', async () => {
    const voice: Device = { ...device, id: 'voz', definitionId: voiceDef.id, name: 'Voz cocina' };
    const plan = esphomeNodePlan('p', voice, voiceDef);
    const port = await freePort();
    const commands: EspCommand[] = [];
    const node = new EspNodeServer({ plan, port, states: () => espNodeStates(plan, {}), onCommand: (c) => commands.push(c) });
    await node.start();
    cleanups.push(() => node.stop());
    const client = new Client({ host: '127.0.0.1', port, reconnect: false, clientInfo: 'test' });
    const seen = new Map<string, EspEntity>();
    client.on('error', () => undefined);
    client.on('newEntity', (e) => seen.set(e.config.objectId, e));
    client.connect();
    cleanups.push(() => client.disconnect());
    const mute = await waitFor(() => seen.get('mute'));
    mute.setState(true);
    const cmd = await waitFor(() => commands[0]);
    expect(cmd).toMatchObject({ type: 'switch', state: true, key: mute.config.key });
  });
});

/** HA falso: flujos de configuración y registros. */
function fakeHa(): HaApi & { flows: Array<Record<string, unknown>>; deleted: string[]; updates: Array<Record<string, unknown>>; registry: Array<Record<string, unknown>> } {
  const flows: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const registry: Array<Record<string, unknown>> = [];
  return {
    flows,
    deleted,
    updates,
    registry,
    rest: async (method, path, json) => {
      if (method === 'POST' && path === '/api/config/config_entries/flow') return { status: 200, data: { type: 'form', flow_id: 'f1', step_id: 'user', data_schema: [{ name: 'host', required: true }, { name: 'port', default: 6053 }] } };
      if (method === 'POST' && path === '/api/config/config_entries/flow/f1') {
        flows.push(json as Record<string, unknown>);
        if (flows.length === 1) return { status: 200, data: { type: 'form', flow_id: 'f1', step_id: 'encryption_key', data_schema: [{ name: 'noise_psk', required: true }] } };
        return { status: 200, data: { type: 'create_entry', title: 'Sensor despacho', result: { entry_id: 'e1' } } };
      }
      if (method === 'GET' && path.startsWith('/api/config/config_entries/entry')) return { status: 200, data: [{ entry_id: 'e1', domain: 'esphome' }] };
      if (method === 'DELETE') {
        deleted.push(path);
        return { status: 200, data: {} };
      }
      return { status: 404, data: {} };
    },
    ws: async (command) => {
      if (command.type === 'config/entity_registry/list') return registry;
      if (command.type === 'config/device_registry/list') return [];
      if (command.type === 'config/entity_registry/update') {
        updates.push(command);
        const e = registry.find((x) => x.entity_id === command.entity_id);
        if (e) e.entity_id = command.new_entity_id;
        return {};
      }
      return {};
    },
  };
}

describe('Home Assistant: formularios, alta de nodos y alineación', () => {
  it('fillForm: campos conocidos, secciones plegables, valores por defecto y obligatorios', () => {
    const schema = [
      { name: 'broker', required: true },
      { name: 'port', default: 1883 },
      { name: 'advanced', type: 'expandable', schema: [{ name: 'set_ca_cert', required: true, selector: { select: { options: [{ value: 'off' }, { value: 'auto' }] } } }, { name: 'tls', type: 'boolean', required: true }] },
    ];
    expect(fillForm(schema, { broker: '127.0.0.1' })).toEqual({ broker: '127.0.0.1', port: 1883, advanced: { set_ca_cert: 'off', tls: false } });
    expect(fillForm([], { url: 'ws://127.0.0.1:3000' })).toEqual({ url: 'ws://127.0.0.1:3000' });
  });

  it('flujo de esphome: host y puerto, luego la clave → entrada creada', async () => {
    const ha = fakeHa();
    const out = await runConfigFlow(ha, 'esphome', { host: '127.0.0.1', port: 6054, noise_psk: 'clave' });
    expect(out).toEqual({ result: 'created', entryId: 'e1', title: 'Sensor despacho' });
    expect(ha.flows).toEqual([{ host: '127.0.0.1', port: 6054 }, { noise_psk: 'clave' }]);
  });

  it('alinea los entity_id de ESPHome (unique_id v1 y v3) y de Z-Wave JS', async () => {
    const ha = fakeHa();
    ha.registry.push(
      { entity_id: 'sensor.sensor_despacho_temperatura', unique_id: '62:6e:0c:3a:ad:54-sensor-temperature', platform: 'esphome' },
      { entity_id: 'binary_sensor.sensor_despacho_movimiento', unique_id: '626e0c3aad54/0/binary_sensor/Movimiento', platform: 'esphome' },
      { entity_id: 'switch.enchufe', unique_id: `${0xe2c0de01}.5-37-0-currentValue`, platform: 'zwave_js' },
      { entity_id: 'sensor.enchufe_w', unique_id: `${0xe2c0de01}.5-50-0-value-66049`, platform: 'zwave_js' },
    );
    const mac = '62:6E:0C:3A:AD:54';
    const r = await alignEntities(ha, [
      { platform: 'esphome', entityId: 'sensor.sensor_despacho_temperature', match: esphomeUniqueIdMatcher(mac, 'sensor', 'temperature', 'Temperatura') },
      { platform: 'esphome', entityId: 'binary_sensor.sensor_despacho_motion', match: esphomeUniqueIdMatcher(mac, 'binary_sensor', 'motion', 'Movimiento') },
      { platform: 'zwave_js', entityId: 'switch.enchufe_despacho_switch', match: zwaveUniqueIdMatcher(0xe2c0de01, 5, 37, 'currentValue') },
      { platform: 'zwave_js', entityId: 'sensor.enchufe_despacho_power', match: zwaveUniqueIdMatcher(0xe2c0de01, 5, 50, 'value', 66049) },
      { platform: 'zwave_js', entityId: 'sensor.no_existe', match: zwaveUniqueIdMatcher(0xe2c0de01, 9, 49, 'Air temperature') },
    ]);
    expect(r.renamed).toHaveLength(4);
    expect(r.missing).toBe(1);
    expect(ha.registry.map((e) => e.entity_id)).toEqual(['sensor.sensor_despacho_temperature', 'binary_sensor.sensor_despacho_motion', 'switch.enchufe_despacho_switch', 'sensor.enchufe_despacho_power']);
    // Segunda pasada: nada que hacer.
    expect((await alignEntities(ha, [{ platform: 'esphome', entityId: 'sensor.sensor_despacho_temperature', match: esphomeUniqueIdMatcher(mac, 'sensor', 'temperature', 'Temperatura') }])).renamed).toEqual([]);
  });
});

describe('backend ESPHome', () => {
  it('reconcilia: arranca los nodos en vivo, publica estados, para los caídos y da de alta en HA', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hasim-esp-'));
    const storeFile = join(dir, 'esphome-nodes.json');
    const portBase = (await freePort()) - 1;
    const ha = fakeHa();
    const backend = new EsphomeBackend({ storeFile, portBase, ha, registerRetryMs: [50] });
    const commands: Array<[string, BridgeCommand]> = [];
    let changes = 0;
    await backend.start({ command: (id, c) => commands.push([id, c]), traffic: () => undefined, changed: () => (changes += 1), log: () => undefined });
    cleanups.push(() => backend.close());
    const project: Project = { ...createDemoProject(), id: 'p', devices: [device], connections: [], automations: [] };
    const entities: Record<string, EntityState> = { 'sensor.sensor_despacho_temperature': { state: 20 } };
    await backend.sync({ project, defs: catalog, entities, devices: new Set(['esp']), down: new Set(), live: true });
    const st = backend.status();
    expect(st.nodes.esp?.state).toBe('starting');
    expect(st.detail).toMatch(/1 de 1 nodos en marcha/);
    const saved = JSON.parse(await readFile(storeFile, 'utf8')) as { nodes: Record<string, { port: number; key: string }> };
    const rec = saved.nodes['p/esp'];
    expect(rec?.port).toBe(portBase + 1);
    expect(Buffer.from(rec?.key ?? '', 'base64')).toHaveLength(32);
    expect((await stat(storeFile)).mode & 0o777).toBe(0o600);
    // Alta en HA con la clave del nodo.
    await waitFor(() => ha.flows.length === 2);
    expect(ha.flows[0]).toEqual({ host: '127.0.0.1', port: portBase + 1 });
    expect(ha.flows[1]).toEqual({ noise_psk: rec?.key });
    await waitFor(() => backend.alignTargets().length === 4);
    // Un cliente cifrado ve el estado y lo cambia el simulador.
    const client = new Client({ host: '127.0.0.1', port: portBase + 1, encryptionKey: rec?.key, reconnect: false, clientInfo: 'test' });
    const temps: unknown[] = [];
    client.on('error', () => undefined);
    client.on('newEntity', (e) => e.config.objectId === 'temperature' && e.on('state', (s) => temps.push(s.state)));
    client.connect();
    cleanups.push(() => client.disconnect());
    await waitFor(() => temps.includes(20));
    await backend.sync({ project, defs: catalog, entities: { 'sensor.sensor_despacho_temperature': { state: 22.5 } }, devices: new Set(['esp']), down: new Set(), live: true });
    await waitFor(() => temps.includes(22.5));
    await waitFor(() => backend.status().nodes.esp?.state === 'running');
    // Nodo caído: se cierra su servidor.
    await backend.sync({ project, defs: catalog, entities, devices: new Set(['esp']), down: new Set(['esp']), live: true });
    expect(backend.status().nodes.esp?.state).toBe('stopped');
    // Sin app en vivo, también parado; y si el dispositivo sale del proyecto, se borra de HA.
    await backend.sync({ project: { ...project, devices: [] }, defs: catalog, entities, devices: new Set(), down: new Set(), live: true });
    expect(backend.status().nodes).toEqual({});
    expect(changes).toBeGreaterThan(0);
    expect(commands).toEqual([]);
  });
});

describe('motivos de los flujos', () => {
  it('ya configurado (con sus variantes) cuenta como éxito', async () => {
    const { flowOk } = await import('../src/haNative');
    expect(flowOk({ result: 'aborted', reason: 'already_configured_updates' })).toBe(true);
    expect(flowOk({ result: 'aborted', reason: 'single_instance_allowed' })).toBe(true);
    expect(flowOk({ result: 'aborted', reason: 'cannot_connect' })).toBe(false);
  });
});

describe('puertos de los nodos ESPHome', () => {
  it('no usan 6054 (HA escucha ahí) y los guardados con un puerto antiguo cambian de puerto sin perder la clave', async () => {
    expect(ESPHOME_PORT_BASE).toBeGreaterThan(6054);
    const file = join(await mkdtemp(join(tmpdir(), 'hasim-espstore-')), 'esphome-nodes.json');
    const key = randomBytes(32).toString('base64');
    await writeFile(file, JSON.stringify({ version: 1, nodes: { 'p/viejo': { port: 6054, key }, 'p/nuevo': { port: ESPHOME_PORT_BASE + 1, key } } }));
    const store = new EspNodeStore(file);
    const nuevo = await store.ensure('p/nuevo', true);
    expect(nuevo.port).toBe(ESPHOME_PORT_BASE + 1);
    const viejo = await store.ensure('p/viejo', true);
    expect(viejo.port).toBe(ESPHOME_PORT_BASE + 2);
    expect(viejo.key).toBe(key);
    const saved = JSON.parse(await readFile(file, 'utf8')) as { nodes: Record<string, { port: number; key?: string }> };
    expect(saved.nodes['p/viejo']).toEqual({ port: ESPHOME_PORT_BASE + 2, key });
    // Sin cifrado, el nodo pierde la clave pero conserva el puerto.
    expect(await store.ensure('p/nuevo', false)).toEqual({ port: ESPHOME_PORT_BASE + 1 });
  });
});

describe('cambiar de proyecto', () => {
  it('los nodos del proyecto anterior se quitan y los del nuevo nacen con su MAC, clave y puerto aunque compartan id', async () => {
    const storeFile = join(await mkdtemp(join(tmpdir(), 'hasim-espswitch-')), 'esphome-nodes.json');
    const portBase = (await freePort()) - 1;
    const backend = new EsphomeBackend({ storeFile, portBase });
    await backend.start({ command: () => undefined, traffic: () => undefined, changed: () => undefined, log: () => undefined });
    try {
      const demo = createDemoProject();
      const voz = new Set(['demo-voz-cocina']);
      await backend.sync({ project: { ...demo, id: 'viejo' }, defs: catalog, entities: {}, devices: voz, down: new Set(), live: true });
      await backend.sync({ project: { ...demo, id: 'nuevo' }, defs: catalog, entities: {}, devices: voz, down: new Set(), live: true });
      const saved = JSON.parse(await readFile(storeFile, 'utf8')) as { nodes: Record<string, { port: number; key: string }> };
      expect(Object.keys(saved.nodes)).toEqual(['nuevo/demo-voz-cocina']);
      expect(backend.status().nodes['demo-voz-cocina']?.state).toBe('starting');
      expect(backend.status().detail).toMatch(/1 de 1 nodos en marcha/);
    } finally {
      await backend.close();
    }
  });
});
