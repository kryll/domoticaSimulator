// El Lab con las vías reales activas: los dispositivos Z-Wave y ESPHome salen de MQTT y van por su
// backend; los comandos de HA llegan a la app; parar un nodo lo para en su vía; `status` anuncia las
// capacidades y el estado de cada vía (lo que usa la app para «Vía hacia HA»).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:net';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';
import { Lab, type AppConnection } from '../src/lab';
import { EsphomeBackend } from '../src/esphome/backend';
import { ZwaveBackend, type MockLink } from '../src/zwave/backend';
import type { ClientMessage, ServerMessage, StatusMessage } from '../../../src/bridge/protocol';
import { catalog } from '../../../src/devices/catalog';
import { createDemoProject } from '../../../src/store/demoProject';
import { createSimulationState } from '../../../src/simulation/engine';
import { defaultHaBridgeSettings, type Project } from '../../../src/types';
import type { ToMock } from '../src/zwave/protocol';

interface EspEntity {
  config: { objectId: string };
  setState(state: boolean): void;
}
interface EspClient {
  connect(): void;
  disconnect(): void;
  on(event: 'newEntity', cb: (e: EspEntity) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
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

let broker: Aedes;
let tcp: Server;
let spy: MqttClient;
const topics = new Set<string>();
let lab: Lab;
const sent: ServerMessage[] = [];
const conn: AppConnection = { traffic: true, send: (m) => sent.push(m) };
const toMock: ToMock[] = [];
let storeFile = '';
let project: Project;

const fakeLink: MockLink = {
  connected: true,
  connect: (h) => h.open(),
  send: (msg) => toMock.push(msg),
  close: () => undefined,
};

const send = (msg: Record<string, unknown>): Promise<void> => lab.handle(conn, { v: 1, ...msg } as unknown as ClientMessage);
const lastStatus = (): StatusMessage | undefined => [...sent].reverse().find((m): m is StatusMessage => m.type === 'status');

beforeAll(async () => {
  broker = await Aedes.createBroker();
  tcp = createServer(broker.handle);
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', () => r()));
  const addr = tcp.address();
  const url = `mqtt://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  spy = await mqtt.connectAsync(url, { clientId: 'spy-native' });
  spy.on('message', (topic, payload) => {
    if (payload.length > 0) topics.add(topic);
  });
  await spy.subscribeAsync(['homeassistant/#'], { qos: 1 });
  storeFile = join(await mkdtemp(join(tmpdir(), 'hasim-labn-')), 'esphome-nodes.json');
  const portSrv = createServer();
  await new Promise<void>((r) => portSrv.listen(0, '127.0.0.1', () => r()));
  const a = portSrv.address();
  const portBase = (typeof a === 'object' && a ? a.port : 40000) + 1;
  await new Promise<void>((r) => portSrv.close(() => r()));
  lab = new Lab({
    mqttUrl: url,
    clientIdPrefix: 'native',
    settleMs: 50,
    haStatusJitterMs: 0,
    trafficFlushMs: 20,
    native: [new ZwaveBackend({ link: fakeLink }), new EsphomeBackend({ storeFile, portBase })],
  });
  await lab.start();
  lab.attach(conn);
  // La demo ya trae una antena y un enchufe Z-Wave, un ESP32 y el HA Voice (ESPHome).
  project = { ...createDemoProject(), id: 'labn' };
  const settings = { ...defaultHaBridgeSettings(), automationsRunIn: 'simulator' as const };
  const defs = catalog.filter((d) => project.devices.some((x) => x.definitionId === d.id));
  await send({ type: 'project', mode: 'full', project, definitions: defs, settings });
  const sim = createSimulationState(project, catalog, Date.now());
  await send({ type: 'state', full: true, entities: sim.entities, availability: { live: true, unavailable: [] } });
  await lab.idle();
}, 30_000);

afterAll(async () => {
  await lab?.close();
  await spy?.endAsync();
  await new Promise<void>((r) => tcp.close(() => r()));
  await new Promise<void>((r) => broker.close(() => r()));
});

describe('Lab con Z-Wave JS y ESPHome reales', () => {
  it('capacidades y estado de las vías en status', async () => {
    const st = await waitFor(() => {
      const s = lastStatus();
      return s?.native?.esphome?.nodes['demo-esp32']?.state !== 'stopped' && s?.native?.esphome?.nodes['demo-esp32'] ? s : undefined;
    });
    expect(st.capabilities).toMatchObject({ zwave: true, esphome: true });
    expect(st.transports.zwave_js).toEqual({ devices: 2, status: 'active' });
    expect(st.transports.esphome).toMatchObject({ status: 'active' });
    expect(st.native?.esphome?.nodes['demo-esp32']?.state).toMatch(/starting|running/);
    expect(st.native?.zwave_js?.nodes['demo-enchufe-zwave']).toBeDefined();
    expect(st.nodes['demo-esp32']).toBe('running');
  });

  it('los dispositivos de las vías reales no se publican por MQTT', async () => {
    await waitFor(() => topics.size > 5);
    const all = [...topics].join('\n');
    expect(all).not.toMatch(/demo-enchufe-zwave|demo-esp32|demo-antena-zwave|demo-voz-cocina/);
    expect(all).toMatch(/hasim_labn_demo-cafetera/);
  });

  it('el mock Z-Wave recibe la red y los valores; el HA Voice de la demo va por ESPHome', () => {
    const last = [...toMock].reverse().find((m): m is Extract<ToMock, { type: 'state' }> => m.type === 'state');
    expect(last?.state.config.nodes.map((n) => n.name)).toEqual(['Enchufe despacho']);
    expect(last?.state.controllerUp).toBe(true);
    expect(lastStatus()?.native?.esphome?.nodes['demo-voz-cocina']).toBeDefined();
  });

  it('un comando de HA por la API nativa llega a la app; parar el nodo cierra su API', async () => {
    const saved = JSON.parse(await readFile(storeFile, 'utf8')) as { nodes: Record<string, { port: number; key: string }> };
    const rec = saved.nodes['labn/demo-voz-cocina'];
    if (!rec) throw new Error('sin nodo del HA Voice');
    const client = new Client({ host: '127.0.0.1', port: rec.port, encryptionKey: rec.key, reconnect: false, clientInfo: 'test' });
    const ents = new Map<string, EspEntity>();
    client.on('error', () => undefined);
    client.on('newEntity', (e) => ents.set(e.config.objectId, e));
    client.connect();
    const mute = await waitFor(() => ents.get('mute'));
    mute.setState(true);
    const cmd = await waitFor(() => sent.find((m): m is Extract<ServerMessage, { type: 'command' }> => m.type === 'command' && m.entityId === 'switch.voz_cocina_mute'));
    expect(cmd).toMatchObject({ service: 'switch.turn_on', topic: 'esphome/hasim-demo-voz-cocina' });
    client.disconnect();
    await send({ type: 'node', action: 'stop', deviceIds: ['demo-voz-cocina', 'demo-enchufe-zwave'] });
    await waitFor(() => lastStatus()?.native?.esphome?.nodes['demo-voz-cocina']?.state === 'stopped');
    const last = [...toMock].reverse().find((m): m is Extract<ToMock, { type: 'state' }> => m.type === 'state');
    expect(last?.state.down).toHaveLength(1);
    await send({ type: 'node', action: 'start', deviceIds: ['demo-voz-cocina'] });
    await waitFor(() => lastStatus()?.native?.esphome?.nodes['demo-voz-cocina']?.state !== 'stopped');
  });

  it('el inspector de tráfico muestra la API nativa', async () => {
    const traffic = sent.filter((m): m is Extract<ServerMessage, { type: 'traffic' }> => m.type === 'traffic').flatMap((m) => m.entries);
    expect(traffic.some((e) => e.via === 'esphome' && e.dir === 'in' && /SwitchCommandRequest/.test(e.payload))).toBe(true);
  });
});

describe('snapshots con los datos de las vías reales', () => {
  it('copian y restauran la carpeta de Z-Wave y el fichero de ESPHome (0600)', async () => {
    const { SnapshotStore } = await import('../src/snapshots');
    const { mkdir, writeFile, stat } = await import('node:fs/promises');
    const root = await mkdtemp(join(tmpdir(), 'hasim-extras-'));
    const ha = join(root, 'ha-config');
    const zw = join(root, 'zwave');
    const esp = join(root, 'secrets', 'esphome-nodes.json');
    await mkdir(join(zw, 'ui'), { recursive: true });
    await mkdir(ha, { recursive: true });
    await mkdir(join(root, 'secrets'), { recursive: true });
    await writeFile(join(ha, 'configuration.yaml'), 'default_config:\n');
    await writeFile(join(zw, 'ui', 'settings.json'), '{"v":1}');
    await writeFile(esp, '{"nodes":{"a":{"port":6054}}}');
    const store = new SnapshotStore(ha, join(root, 'snaps'), [
      { name: 'zwave', path: zw, kind: 'dir' },
      { name: 'esphome-nodes.json', path: esp, kind: 'file' },
    ]);
    const info = await store.create('Con Z-Wave', undefined);
    await writeFile(join(zw, 'ui', 'settings.json'), '{"v":2}');
    await writeFile(join(zw, 'ui', 'nuevo.json'), '{}');
    await writeFile(esp, '{"nodes":{}}');
    await store.restore(info.id);
    expect(await readFile(join(zw, 'ui', 'settings.json'), 'utf8')).toBe('{"v":1}');
    await expect(stat(join(zw, 'ui', 'nuevo.json'))).rejects.toThrow();
    expect(await readFile(esp, 'utf8')).toContain('6054');
    expect((await stat(esp)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'snaps', info.id, 'extras', 'esphome-nodes.json'))).mode & 0o777).toBe(0o600);
  });
});
