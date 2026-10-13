// Vía Shelly real (E3): un Shelly Gen2+ emulado probado con un cliente WebSocket JSON-RPC como el
// de aioshelly (el de la integración shelly de HA) y el backend que reconcilia los Shelly con el
// proyecto, los da de alta en HA y alinea sus entity_id.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { ShellyNodeServer } from '../src/shelly/node';
import { ShellyBackend } from '../src/shelly/backend';
import { SHELLY_PORT_BASE, ShellyNodeStore } from '../src/shelly/store';
import { ESPHOME_PORT_BASE } from '../src/esphome/store';
import { alignEntities, shellyUniqueIdMatcher, type HaApi } from '../src/haNative';
import { changedComponents, shellyComponentsStatus, shellyNodePlan } from '../../../src/bridge/shelly/plan';
import { catalog } from '../../../src/devices/catalog';
import { createDemoProject } from '../../../src/store/demoProject';
import type { Device, EntityState, Project } from '../../../src/types';
import type { BridgeCommand } from '../../../src/bridge/mqtt/commands';

type Frame = Record<string, unknown>;

/** Espera con sondeo y margen amplio (los runners de CI son lentos). */
async function waitFor<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, timeout = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 25));
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

/** Cliente RPC como el de aioshelly: src propio, ids crecientes, notificaciones aparte. */
class RpcClient {
  readonly frames: Frame[] = [];
  closed = false;
  private seq = 0;
  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => this.frames.push(JSON.parse(String(raw)) as Frame));
    ws.on('close', () => (this.closed = true));
    ws.on('error', () => undefined);
  }

  static async open(port: number): Promise<RpcClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new RpcClient(ws);
  }

  async call(method: string, params?: Record<string, unknown>): Promise<Frame> {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, src: 'aios-test', method, ...(params ? { params } : {}) }));
    return waitFor(() => this.frames.find((f) => f.id === id));
  }

  notifications(method: string): Frame[] {
    return this.frames.filter((f) => f.method === method);
  }

  close(): void {
    this.ws.close();
  }
}

const def = catalog.find((d) => d.id === 'shelly-1pm-gen3');
const coverDef = catalog.find((d) => d.id === 'shelly-2pm-gen3-cover');
if (!def || !coverDef) throw new Error('catálogo sin Shelly');
const device: Device = { id: 'luz', definitionId: def.id, name: 'Luz cocina', floorId: 'f', position: { x: 0, y: 0 }, protocol: 'wifi', integration: 'shelly' };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('Shelly emulado con un cliente RPC', () => {
  it('/shelly, GetDeviceInfo, GetConfig, GetStatus, Switch.Set → comando, NotifyStatus y parada', async () => {
    const plan = shellyNodePlan('p', device, def);
    const port = await freePort();
    let entities: Record<string, EntityState> = { 'switch.luz_cocina_switch': { state: 'off' }, 'sensor.luz_cocina_power': { state: 0 } };
    const commands: BridgeCommand[] = [];
    const traffic: string[] = [];
    const node = new ShellyNodeServer({ plan, port, entities: () => entities, onCommand: (c) => commands.push(...c), onTraffic: (dir, s) => traffic.push(`${dir} ${s}`) });
    await node.start();
    cleanups.push(() => node.stop());
    // GET /shelly (lo que pide primero el flujo de configuración de HA).
    const info = (await (await fetch(`http://127.0.0.1:${port}/shelly`)).json()) as Frame;
    expect(info).toMatchObject({ id: plan.hostname, mac: plan.mac, model: 'S3SW-001P16EU', gen: 3, auth_en: false, name: 'Luz cocina' });
    const client = await RpcClient.open(port);
    cleanups.push(() => client.close());
    await waitFor(() => node.clients === 1);
    const di = await client.call('Shelly.GetDeviceInfo');
    expect(di).toMatchObject({ src: plan.hostname, dst: 'aios-test', result: { mac: plan.mac } });
    expect(((await client.call('Shelly.GetConfig')).result as Frame).sys).toMatchObject({ device: { name: 'Luz cocina' } });
    const status = (await client.call('Shelly.GetStatus')).result as Frame;
    expect(status['switch:0']).toMatchObject({ output: false, apower: 0 });
    expect((await client.call('Shelly.ListMethods')).result).toMatchObject({ methods: expect.arrayContaining(['Switch.Set']) });
    // HA enciende el relé: el comando llega al simulador y el firmware responde was_on.
    const set = await client.call('Switch.Set', { id: 0, on: true });
    expect(set.result).toEqual({ was_on: false });
    expect(commands).toEqual([{ entityId: 'switch.luz_cocina_switch', service: 'switch.turn_on', data: {} }]);
    expect(traffic).toContain('in Switch.Set {"id":0,"on":true}');
    // El simulador cambia el estado: NotifyStatus solo con lo que cambia.
    const before = shellyComponentsStatus(plan, entities);
    entities = { 'switch.luz_cocina_switch': { state: 'on' }, 'sensor.luz_cocina_power': { state: 36 } };
    node.pushStatus(changedComponents(before, shellyComponentsStatus(plan, entities)));
    const n = await waitFor(() => client.notifications('NotifyStatus')[0]);
    expect(n).toMatchObject({ src: plan.hostname, dst: 'aios-test', params: { 'switch:0': { output: true, apower: 36 } } });
    expect(n.id).toBeUndefined();
    // Errores como el firmware.
    expect((await client.call('Script.List')).error).toEqual({ code: 404, message: 'No handler for Script.List' });
    // También por HTTP (útil con curl).
    const http = (await (await fetch(`http://127.0.0.1:${port}/rpc/Switch.GetStatus?id=0`)).json()) as Frame;
    expect(http).toMatchObject({ id: 0, output: true });
    // Parar el nodo: se cierra el WebSocket (HA lo ve no disponible) y deja de escuchar.
    await node.stop();
    await waitFor(() => client.closed);
    expect(node.running).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/shelly`)).rejects.toThrow();
  });

  it('persiana: Cover.GoToPosition → set_cover_position y un cambio de componentes avisa con config_changed', async () => {
    const per: Device = { ...device, id: 'per', definitionId: coverDef.id, name: 'Persiana' };
    const plan = shellyNodePlan('p', per, coverDef);
    const port = await freePort();
    const commands: BridgeCommand[] = [];
    const node = new ShellyNodeServer({ plan, port, entities: () => ({}), onCommand: (c) => commands.push(...c) });
    await node.start();
    cleanups.push(() => node.stop());
    const client = await RpcClient.open(port);
    cleanups.push(() => client.close());
    const r = await client.call('Cover.GoToPosition', { id: 0, pos: 30 });
    expect(r).toHaveProperty('result', null);
    expect(commands).toEqual([{ entityId: 'cover.persiana_cover', service: 'cover.set_cover_position', data: { position: 30 } }]);
    node.updatePlan({ ...plan, friendlyName: 'Persiana nueva' });
    const ev = await waitFor(() => client.notifications('NotifyEvent')[0]);
    expect(ev.params).toMatchObject({ events: [{ component: 'sys', event: 'config_changed' }] });
  });
});

describe('puertos de los Shelly', () => {
  it('desde la base + 1, estables, únicos, en un fichero 0600 y sin chocar con ESPHome ni HA', async () => {
    expect(SHELLY_PORT_BASE).toBeGreaterThan(8123);
    expect(SHELLY_PORT_BASE).not.toBe(ESPHOME_PORT_BASE);
    for (const used of [8080, 8081, 8091, 8123, 3000, 5540, 5580, 6053, 6054, 18081]) expect(used === SHELLY_PORT_BASE + 1).toBe(false);
    const dir = await mkdtemp(join(tmpdir(), 'hasim-shelly-'));
    const file = join(dir, 'shelly-nodes.json');
    const store = new ShellyNodeStore(file, 18180);
    expect((await store.ensure('p/a')).port).toBe(18181);
    expect((await store.ensure('p/b')).port).toBe(18182);
    expect((await store.ensure('p/a')).port).toBe(18181);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const again = new ShellyNodeStore(file, 18180);
    expect((await again.ensure('p/b')).port).toBe(18182);
    await again.remove('p/a');
    expect((await again.ensure('p/c')).port).toBe(18181);
  });
});

/** HA falso: flujo de la integración shelly, registros y borrado de entradas. */
function fakeHa(): HaApi & { flows: Array<Record<string, unknown>>; deleted: string[]; registry: Array<Record<string, unknown>>; devices: Array<Record<string, unknown>> } {
  const flows: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const registry: Array<Record<string, unknown>> = [];
  const devices: Array<Record<string, unknown>> = [];
  return {
    flows,
    deleted,
    registry,
    devices,
    rest: async (method, path, json) => {
      if (method === 'POST' && path === '/api/config/config_entries/flow') {
        return { status: 200, data: { type: 'form', flow_id: 'f1', step_id: 'user_manual', data_schema: [{ name: 'host', required: true }, { name: 'port', required: true, default: 80 }, { name: 'verify_ssl', default: false }] } };
      }
      if (method === 'POST' && path === '/api/config/config_entries/flow/f1') {
        flows.push(json as Record<string, unknown>);
        return { status: 200, data: { type: 'create_entry', title: 'Luz cocina', result: { entry_id: 's1' } } };
      }
      if (method === 'GET' && path.startsWith('/api/config/config_entries/entry')) return { status: 200, data: [{ entry_id: 's1', domain: 'shelly' }] };
      if (method === 'DELETE') {
        deleted.push(path);
        return { status: 200, data: {} };
      }
      return { status: 404, data: {} };
    },
    ws: async (command) => {
      if (command.type === 'config/entity_registry/list') return registry;
      if (command.type === 'config/device_registry/list') return devices;
      if (command.type === 'config/entity_registry/update') {
        const e = registry.find((x) => x.entity_id === command.entity_id);
        if (e) e.entity_id = command.new_entity_id;
        return {};
      }
      return {};
    },
  };
}

describe('Home Assistant: alineación de las entidades shelly', () => {
  it('unique_id «<MAC>-switch:0» y «<MAC>-switch:0-power» → entity_id del simulador', async () => {
    const ha = fakeHa();
    ha.registry.push(
      { entity_id: 'switch.luz_cocina', unique_id: 'AABBCCDDEEFF-switch:0', platform: 'shelly' },
      { entity_id: 'sensor.luz_cocina_power', unique_id: 'AABBCCDDEEFF-switch:0-power', platform: 'shelly' },
      { entity_id: 'sensor.otro_power', unique_id: '112233445566-switch:0-power', platform: 'shelly' },
    );
    const r = await alignEntities(ha, [
      { platform: 'shelly', entityId: 'switch.luz_cocina_switch', match: shellyUniqueIdMatcher('AABBCCDDEEFF', 'switch:0') },
      { platform: 'shelly', entityId: 'sensor.luz_cocina_potencia', match: shellyUniqueIdMatcher('aa:bb:cc:dd:ee:ff', 'switch:0-power') },
    ]);
    expect(r.renamed).toHaveLength(2);
    expect(ha.registry.map((e) => e.entity_id)).toEqual(['switch.luz_cocina_switch', 'sensor.luz_cocina_potencia', 'sensor.otro_power']);
    expect(shellyUniqueIdMatcher('AABBCCDDEEFF', 'switch:0')('AABBCCDDEEFF-switch:0-power')).toBe(false);
  });
});

describe('backend Shelly', () => {
  it('reconcilia: arranca los Shelly en vivo, alta en HA con host y puerto, NotifyStatus, comandos, parada y baja', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hasim-shelly-'));
    const storeFile = join(dir, 'shelly-nodes.json');
    const portBase = (await freePort()) - 1;
    const ha = fakeHa();
    const backend = new ShellyBackend({ storeFile, portBase, ha, registerRetryMs: [50] });
    const commands: Array<[string, BridgeCommand, string]> = [];
    const traffic: Array<{ via: string; topic: string }> = [];
    let changes = 0;
    await backend.start({ command: (id, c, label) => commands.push([id, c, label]), traffic: (t) => traffic.push(t), changed: () => (changes += 1), log: () => undefined });
    cleanups.push(() => backend.close());
    const project: Project = { ...createDemoProject(), id: 'p', devices: [device], connections: [], automations: [] };
    const entities: Record<string, EntityState> = { 'switch.luz_cocina_switch': { state: 'off' } };
    await backend.sync({ project, defs: catalog, entities, devices: new Set(['luz']), down: new Set(), live: true });
    expect(backend.status().nodes.luz?.state).toBe('starting');
    const saved = JSON.parse(await readFile(storeFile, 'utf8')) as { nodes: Record<string, { port: number }> };
    expect(saved.nodes['p/luz']?.port).toBe(portBase + 1);
    // Alta en HA: el paso manual con 127.0.0.1 y el puerto del Shelly.
    await waitFor(() => ha.flows.length === 1);
    expect(ha.flows[0]).toEqual({ host: '127.0.0.1', port: portBase + 1, verify_ssl: false });
    const targets = await waitFor(() => backend.alignTargets().length === 3 && backend.alignTargets());
    expect(targets.map((t) => t.entityId)).toEqual(['switch.luz_cocina_switch', 'sensor.luz_cocina_power', 'sensor.luz_cocina_energy']);
    // HA se conecta (como aioshelly) y manda un comando.
    const client = await RpcClient.open(portBase + 1);
    cleanups.push(() => client.close());
    await waitFor(() => backend.status().nodes.luz?.state === 'running');
    await client.call('Switch.Set', { id: 0, on: true });
    await waitFor(() => commands.length === 1);
    expect(commands[0]?.[1]).toEqual({ entityId: 'switch.luz_cocina_switch', service: 'switch.turn_on', data: {} });
    expect(traffic.some((t) => t.via === 'shelly' && t.topic.startsWith('shelly/shelly1pmg3-'))).toBe(true);
    // El simulador lo enciende: NotifyStatus.
    await backend.sync({ project, defs: catalog, entities: { 'switch.luz_cocina_switch': { state: 'on' } }, devices: new Set(['luz']), down: new Set(), live: true });
    const n = await waitFor(() => client.notifications('NotifyStatus')[0]);
    expect(n.params).toMatchObject({ 'switch:0': { output: true } });
    // Nodo caído: se cierra el servidor y el WebSocket.
    await backend.sync({ project, defs: catalog, entities, devices: new Set(['luz']), down: new Set(['luz']), live: true });
    expect(backend.status().nodes.luz?.state).toBe('stopped');
    await waitFor(() => client.closed);
    // Arranca otra vez en el mismo puerto.
    await backend.sync({ project, defs: catalog, entities, devices: new Set(['luz']), down: new Set(), live: true });
    const info = (await (await fetch(`http://127.0.0.1:${portBase + 1}/shelly`)).json()) as Frame;
    expect(info.name).toBe('Luz cocina');
    // Sale del proyecto: se borra de HA la entrada de su MAC.
    const mac = String(info.mac);
    ha.devices.push({ id: 'd1', config_entries: ['s1'], connections: [['mac', mac.match(/../g)?.join(':').toLowerCase() ?? '']], identifiers: [] });
    await backend.sync({ project: { ...project, devices: [] }, defs: catalog, entities, devices: new Set(), down: new Set(), live: true });
    expect(backend.status().nodes).toEqual({});
    await waitFor(() => ha.deleted.length === 1);
    expect(ha.deleted).toEqual(['/api/config/config_entries/entry/s1']);
    expect(changes).toBeGreaterThan(0);
  });
});

describe('Shelly: cambiar de proyecto y errores', () => {
  it('los Shelly del proyecto anterior se quitan (también de HA) y los del nuevo nacen con su MAC aunque compartan id', async () => {
    const storeFile = join(await mkdtemp(join(tmpdir(), 'hasim-shellyswitch-')), 'shelly-nodes.json');
    const portBase = (await freePort()) - 1;
    const ha = fakeHa();
    const backend = new ShellyBackend({ storeFile, portBase, ha, registerRetryMs: [50] });
    await backend.start({ command: () => undefined, traffic: () => undefined, changed: () => undefined, log: () => undefined });
    cleanups.push(() => backend.close());
    const base: Project = { ...createDemoProject(), devices: [device], connections: [], automations: [] };
    const ctx = (id: string) => ({ project: { ...base, id }, defs: catalog, entities: {}, devices: new Set(['luz']), down: new Set<string>(), live: true });
    await backend.sync(ctx('viejo'));
    const oldInfo = (await (await fetch(`http://127.0.0.1:${portBase + 1}/shelly`)).json()) as Frame;
    const oldMac = String(oldInfo.mac);
    ha.devices.push({ id: 'd1', config_entries: ['s1'], connections: [['mac', oldMac]], identifiers: [] });
    await backend.sync(ctx('nuevo'));
    const saved = JSON.parse(await readFile(storeFile, 'utf8')) as { nodes: Record<string, { port: number }> };
    expect(Object.keys(saved.nodes)).toEqual(['nuevo/luz']);
    const info = (await (await fetch(`http://127.0.0.1:${portBase + 1}/shelly`)).json()) as Frame;
    expect(info.mac).toBe(shellyNodePlan('nuevo', device, def).mac);
    expect(info.mac).not.toBe(oldMac);
    await waitFor(() => ha.deleted.length === 1);
    // El nuevo se da de alta en HA y sus entidades se alinean por su MAC.
    const targets = await waitFor(() => backend.alignTargets().length > 0 && backend.alignTargets());
    const newMac = String(info.mac).toUpperCase();
    expect(targets[0]?.match(`${newMac}-switch:0`)).toBe(true);
    expect(targets[0]?.match(`${oldMac.toUpperCase()}-switch:0`)).toBe(false);
  });

  it('un fallo antiguo del alta en HA no pone en «Error» un Shelly parado', async () => {
    const storeFile = join(await mkdtemp(join(tmpdir(), 'hasim-shellyerr-')), 'shelly-nodes.json');
    const portBase = (await freePort()) - 1;
    const ha = fakeHa();
    const failing: HaApi = { ...ha, rest: async (method, path, json) => (method === 'POST' && path === '/api/config/config_entries/flow' ? { status: 500, data: { message: 'caído' } } : ha.rest(method, path, json)) };
    const backend = new ShellyBackend({ storeFile, portBase, ha: failing, registerRetryMs: [60_000] });
    await backend.start({ command: () => undefined, traffic: () => undefined, changed: () => undefined, log: () => undefined });
    cleanups.push(() => backend.close());
    const project: Project = { ...createDemoProject(), id: 'p', devices: [device], connections: [], automations: [] };
    await backend.sync({ project, defs: catalog, entities: {}, devices: new Set(['luz']), down: new Set(), live: true });
    // Falla el alta: el Shelly sigue en marcha, con el error en el detalle.
    await waitFor(() => /caído|500|Alta/.test(backend.status().nodes.luz?.detail ?? ''));
    expect(backend.status().nodes.luz?.state).toBe('starting');
    await backend.sync({ project, defs: catalog, entities: {}, devices: new Set(['luz']), down: new Set(['luz']), live: true });
    expect(backend.status().nodes.luz?.state).toBe('stopped');
    expect(backend.status().state).not.toBe('error');
  });
});
