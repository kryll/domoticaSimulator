// Viaje completo con un broker aedes en memoria: conexión, discovery, comando en /set reenviado
// a una app falsa por WebSocket, estado publicado, ciclo de vida de nodos, operaciones del lab
// e inspector de tráfico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';
import WebSocket from 'ws';
import { Lab, type AppConnection } from '../src/lab';
import { CLOSE_UNAUTHORIZED, allowedOrigin, startServer, type OrchestratorServer } from '../src/server';
import { SnapshotStore, excludedFromSnapshot, validSnapshotId } from '../src/snapshots';
import type { ContainerControl } from '../src/docker';
import { createDemoProject } from '../../../src/store/demoProject';
import { catalog } from '../../../src/devices/catalog';
import { callService, createSimulationState } from '../../../src/simulation/engine';
import { buildBridgeModel } from '../../../src/bridge/mqtt/model';
import { defaultHaBridgeSettings, type Device, type DeviceDefinition, type Project, type SimulationState } from '../../../src/types';
import type { ServerMessage, TrafficEntry } from '../../../src/bridge/protocol';

interface Seen {
  topic: string;
  payload: string;
  retain: boolean;
}

let broker: Aedes;
let tcp: Server;
let mqttPort = 0;
let spy: MqttClient;
const seen: Seen[] = [];
let lab: Lab;
let server: OrchestratorServer;
let haConfig: string;
let snapshotsDir: string;
let project: Project;
let sim: SimulationState;
const TOKEN = 'token-del-lab-de-pruebas-0123456789';
const docker = { stops: 0, starts: 0, failStart: false };
const fakeDocker: ContainerControl = {
  available: async () => true,
  stop: async () => {
    docker.stops += 1;
  },
  start: async () => {
    docker.starts += 1;
  },
};
const unsyncCalls: string[] = [];

async function waitFor<T>(fn: () => T | undefined | false, timeout = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 20));
  }
}

class FakeApp {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  closeCode: number | undefined;
  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (d) => this.messages.push(JSON.parse(String(d)) as ServerMessage));
    this.ws.on('close', (code) => (this.closeCode = code));
  }
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }
  /** Abre y se presenta con el token. */
  async login(token = TOKEN): Promise<void> {
    await this.open();
    this.send({ type: 'hello', role: 'app', client: 'test', token });
  }
  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: 1, ...msg }));
  }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

let app: FakeApp;

function z2mProject(): Project {
  const p = createDemoProject();
  const devices = p.devices.map((d): Device => (d.id === 'demo-luz-pasillo' || d.id === 'demo-coordinador' ? { ...d, integration: 'zigbee2mqtt' } : d));
  return { ...p, id: 'proyecto-test', devices };
}

const lastOn = (topic: string): Seen | undefined => [...seen].reverse().find((s) => s.topic === topic);

beforeAll(async () => {
  broker = await Aedes.createBroker();
  tcp = createServer(broker.handle);
  await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', () => r()));
  const addr = tcp.address();
  mqttPort = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `mqtt://127.0.0.1:${mqttPort}`;

  // Retenido de una ejecución anterior (dispositivo que ya no existe).
  const old = await mqtt.connectAsync(url, { clientId: 'old-run' });
  await old.publishAsync('homeassistant/device/hasim_viejo_dev/config', JSON.stringify({ o: { name: 'HA Simulator' } }), { retain: true, qos: 1 });
  await old.publishAsync('homeassistant/device/ajeno/config', JSON.stringify({ o: { name: 'Otro' } }), { retain: true, qos: 1 });
  await old.endAsync();

  spy = await mqtt.connectAsync(url, { clientId: 'spy' });
  spy.on('message', (topic, payload, packet) => seen.push({ topic, payload: payload.toString(), retain: packet.retain }));
  await spy.subscribeAsync(['homeassistant/#', 'hasim/#', 'hasim-z2m/#'], { qos: 1 });

  haConfig = await mkdtemp(join(tmpdir(), 'hasim-ha-'));
  snapshotsDir = await mkdtemp(join(tmpdir(), 'hasim-snap-'));
  await writeFile(join(haConfig, 'configuration.yaml'), 'default_config:\n');
  await mkdir(join(haConfig, '.storage'));
  await writeFile(join(haConfig, '.storage', 'core.area_registry'), '{"areas":[]}');
  await writeFile(join(haConfig, 'home-assistant_v2.db'), 'BASE DE DATOS');
  await writeFile(join(haConfig, 'home-assistant.log'), 'log');

  lab = new Lab({
    mqttUrl: url,
    settleMs: 150,
    haStatusJitterMs: 1,
    trafficFlushMs: 20,
    snapshots: new SnapshotStore(haConfig, snapshotsDir),
    containers: fakeDocker,
    unsync: async () => {
      unsyncCalls.push('unsync');
      return 'Packages del lab borrados';
    },
  });
  server = await startServer(lab, { port: 0, token: TOKEN, authTimeoutMs: 300 });
  await lab.start();
  app = new FakeApp(`ws://127.0.0.1:${server.port()}/orchestrator`);
  await app.login();
  project = z2mProject();
  sim = createSimulationState(project, catalog, Date.UTC(2026, 9, 12, 10));
});

afterAll(async () => {
  app.ws.close();
  await server.close();
  await lab.close();
  await spy.endAsync();
  await new Promise<void>((r) => tcp.close(() => r()));
  await broker.close();
});

const settings = defaultHaBridgeSettings();
const defs = (): DeviceDefinition[] => [...catalog, ...(project.customDefinitions ?? [])].filter((d) => project.devices.some((x) => x.definitionId === d.id));
const model = () => buildBridgeModel(project, catalog, settings);

describe('orquestador con aedes', () => {
  it('saluda con el protocolo versionado y el estado tras aceptar el token', async () => {
    await waitFor(() => app.of('hello').length > 0);
    expect(app.of('hello')[0]).toMatchObject({ v: 1, server: 'hasim-orchestrator', protocol: 1, readOnly: false });
    expect(app.of('status')[0]?.mqtt).toBe('connected');
  });

  it('rechaza conexiones sin token, con token incorrecto o sin hello a tiempo', async () => {
    const url = `ws://127.0.0.1:${server.port()}/orchestrator`;
    const wrong = new FakeApp(url);
    await wrong.login('token-incorrecto-0000000000');
    await waitFor(() => wrong.closeCode !== undefined);
    expect(wrong.closeCode).toBe(CLOSE_UNAUTHORIZED);
    expect(wrong.of('error')[0]).toMatchObject({ code: 'auth' });
    expect(wrong.of('hello')).toHaveLength(0);

    const other = new FakeApp(url);
    await other.open();
    other.send({ type: 'project', mode: 'full', project, definitions: [], settings });
    await waitFor(() => other.closeCode !== undefined);
    expect(other.closeCode).toBe(CLOSE_UNAUTHORIZED);

    const silent = new FakeApp(url);
    await silent.open();
    await waitFor(() => silent.closeCode !== undefined);
    expect(silent.closeCode).toBe(CLOSE_UNAUTHORIZED);
    expect(silent.of('status')).toHaveLength(0);

    // Un navegador de otro sitio (Origin ajeno) ni siquiera llega a abrir.
    const foreign = new FakeApp(url, { origin: 'https://evil.example' });
    await expect(foreign.open()).rejects.toThrow(/403/);
  });

  it('Origin: mismo host con IP literal sí; nombres DNS ajenos no (DNS rebinding)', () => {
    expect(allowedOrigin('http://localhost:8080', 'localhost:8080')).toBe(true);
    expect(allowedOrigin('http://192.168.1.20:8080', '192.168.1.20:8080')).toBe(true);
    expect(allowedOrigin('http://evil.example:8080', 'evil.example:8080')).toBe(false);
    expect(allowedOrigin('http://mipc.local:8080', 'mipc.local:8080', ['http://mipc.local:8080'])).toBe(true);
    expect(allowedOrigin(undefined, undefined)).toBe(true);
  });

  it('GET /project exige el token', async () => {
    const base = `http://127.0.0.1:${server.port()}/orchestrator/project`;
    expect((await fetch(base)).status).toBe(401);
    expect((await fetch(base, { headers: { authorization: 'Bearer otro-token-000000000' } })).status).toBe(401);
    expect((await fetch(base, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
  });

  it('rechaza sin aplicar nada un proyecto o unos ajustes no válidos', async () => {
    const before = seen.length;
    app.send({ type: 'project', mode: 'full', project, definitions: defs(), settings: { ...settings, baseTopic: 'hasim/#' } });
    const err = await waitFor(() => app.of('error').find((e) => e.code === 'invalid'));
    expect(err.message).toMatch(/baseTopic/);
    app.send({ type: 'project', mode: 'full', project: { ...project, devices: 'muchos' }, definitions: defs(), settings });
    await waitFor(() => app.of('error').filter((e) => e.code === 'invalid').length >= 2);
    app.send({ type: 'project', mode: 'full', project, definitions: [{ id: 'x' }], settings });
    await waitFor(() => app.of('error').filter((e) => e.code === 'invalid').length >= 3);
    await lab.idle();
    expect(lab.currentProject()).toBeUndefined();
    expect(seen.slice(before).some((s) => s.topic.startsWith('homeassistant/device/'))).toBe(false);
  });

  it('publica discovery retenido, disponibilidad y estados; limpia los retenidos obsoletos', async () => {
    // Un dispositivo personalizado del proyecto también llega a HA.
    const base = catalog.find((d) => d.id === project.devices.find((x) => x.id === 'demo-cafetera')!.definitionId)!;
    const custom: DeviceDefinition = { ...base, id: 'custom:cafetera-lab', name: 'Cafetera del lab' };
    project = { ...project, customDefinitions: [custom], devices: project.devices.map((d) => (d.id === 'demo-cafetera' ? { ...d, definitionId: custom.id } : d)) };
    app.send({ type: 'project', mode: 'full', project, definitions: defs(), settings });
    app.send({ type: 'state', full: true, entities: sim.entities, availability: { live: true, unavailable: [] } });
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    const cfg = await waitFor(() => lastOn(`homeassistant/device/${luz.nodeId}/config`));
    expect(cfg.retain).toBe(false); // en vivo llega sin el flag; se comprueba retenido abajo
    expect(JSON.parse(cfg.payload).o.name).toBe('HA Simulator');
    await waitFor(() => lastOn('homeassistant/device/hasim_viejo_dev/config')?.payload === '');
    // El retenido ajeno no se toca.
    expect(seen.some((s) => s.topic === 'homeassistant/device/ajeno/config' && s.payload === '')).toBe(false);
    await waitFor(() => lastOn('hasim/bridge/state')?.payload === 'online');
    await waitFor(() => lastOn('hasim-z2m/bridge/state')?.payload === '{"state":"online"}');
    await waitFor(() => lastOn('hasim-z2m/bridge/devices'));
    const state = await waitFor(() => lastOn(luz.entities[0]!.stateTopic));
    expect(JSON.parse(state.payload).state).toBe('OFF');
    const cafetera = model().devices.find((d) => d.device.id === 'demo-cafetera')!;
    expect(cafetera.def.id).toBe('custom:cafetera-lab');
    await waitFor(() => lastOn(`homeassistant/device/${cafetera.nodeId}/config`));

    // Un cliente nuevo recibe el discovery como retenido.
    const late = await mqtt.connectAsync(`mqtt://127.0.0.1:${mqttPort}`, { clientId: 'late' });
    const got: Seen[] = [];
    late.on('message', (topic, payload, packet) => got.push({ topic, payload: payload.toString(), retain: packet.retain }));
    await late.subscribeAsync(`homeassistant/device/${luz.nodeId}/config`);
    await waitFor(() => got.length > 0);
    expect(got[0]?.retain).toBe(true);
    await late.endAsync();
  });

  it('deduplica estados por contenido', async () => {
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    const before = seen.filter((s) => s.topic === luz.entities[0]!.stateTopic).length;
    app.send({ type: 'state', entities: { 'light.luz_salon': sim.entities['light.luz_salon'] } });
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.filter((s) => s.topic === luz.entities[0]!.stateTopic).length).toBe(before);
  });

  it('comando en /set → app → callService → estado publicado', async () => {
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    const topic = luz.entities[0]!.stateTopic;
    await spy.publishAsync(`${luz.entities[0]!.commandTopic}/set`, '{"state":"ON","brightness":180}');
    const command = await waitFor(() => app.of('command').find((c) => c.entityId === 'light.luz_salon'));
    expect(command.service).toBe('light.turn_on');
    expect(command.data).toEqual({ brightness: 180 });
    sim = callService(sim, project, command.entityId, command.service, command.data);
    app.send({ type: 'command_result', id: command.id, ok: true });
    app.send({ type: 'state', entities: { 'light.luz_salon': sim.entities['light.luz_salon'] } });
    const st = await waitFor(() => {
      const s = lastOn(topic);
      return s && JSON.parse(s.payload).state === 'ON' ? s : undefined;
    });
    expect(JSON.parse(st.payload).brightness).toBe(180);
  });

  it('Z2M: /set con JSON llega como comando', async () => {
    const pasillo = model().devices.find((d) => d.device.id === 'demo-luz-pasillo')!;
    await spy.publishAsync(`hasim-z2m/${pasillo.friendlyName}/set`, '{"state":"ON"}');
    const c = await waitFor(() => app.of('command').find((x) => x.entityId === 'light.luz_pasillo'));
    expect(c.service).toBe('light.turn_on');
  });

  it('nunca publica en topics /set', () => {
    // Solo el espía publica en /set; lo demás que se ha visto lo publicó el orquestador.
    const own = seen.filter((s) => /\/set(\/[^/]+)?$/.test(s.topic));
    expect(own.every((s) => s.payload.includes('state'))).toBe(true);
  });

  it('coordinador caído → bridge/state de Z2M offline', async () => {
    app.send({ type: 'state', entities: {}, availability: { live: true, unavailable: ['demo-coordinador'] } });
    await waitFor(() => lastOn('hasim-z2m/bridge/state')?.payload === '{"state":"offline"}');
    app.send({ type: 'state', entities: {}, availability: { live: true, unavailable: [] } });
    await waitFor(() => lastOn('hasim-z2m/bridge/state')?.payload === '{"state":"online"}');
  });

  it('parar y arrancar nodos', async () => {
    const t = model().devices.find((d) => d.device.id === 'demo-termostato')!;
    app.send({ type: 'node', action: 'stop', deviceIds: ['demo-termostato'] });
    await waitFor(() => lastOn(t.availabilityTopic)?.payload === 'offline');
    await waitFor(() => app.of('status').some((s) => s.nodes['demo-termostato'] === 'stopped'));
    // Un comando a un nodo parado no llega a la app.
    const climate = t.entities.find((e) => e.domain === 'climate')!;
    const before = app.of('command').length;
    await spy.publishAsync(`${climate.commandTopic}/temperature/set`, '23');
    await new Promise((r) => setTimeout(r, 200));
    expect(app.of('command').length).toBe(before);

    const discoveries = seen.filter((s) => s.topic === `homeassistant/device/${t.nodeId}/config`).length;
    app.send({ type: 'node', action: 'start', deviceIds: ['demo-termostato'] });
    await waitFor(() => lastOn(t.availabilityTopic)?.payload === 'online');
    expect(seen.filter((s) => s.topic === `homeassistant/device/${t.nodeId}/config`).length).toBeGreaterThan(discoveries);
    await waitFor(() => app.of('status').some((s) => s.nodes['demo-termostato'] === 'running'));

    app.send({ type: 'node', action: 'stop', deviceIds: 'all' });
    await waitFor(() => lastOn('hasim-z2m/bridge/state')?.payload === '{"state":"online"}' && lastOn(t.availabilityTopic)?.payload === 'offline');
    app.send({ type: 'node', action: 'start', deviceIds: 'all' });
    await waitFor(() => lastOn(t.availabilityTopic)?.payload === 'online');
  });

  it('vuelve a publicar el discovery al recibir homeassistant/status online', async () => {
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    const count = () => seen.filter((s) => s.topic === `homeassistant/device/${luz.nodeId}/config`).length;
    const before = count();
    await spy.publishAsync('homeassistant/status', 'online');
    await waitFor(() => count() > before);
    await waitFor(() => app.of('status').some((s) => s.ha === 'online'));
  });

  it('borra el discovery de un dispositivo eliminado (parche del proyecto)', async () => {
    const cafetera = model().devices.find((d) => d.device.id === 'demo-cafetera')!;
    project = {
      ...project,
      devices: project.devices.filter((d) => d.id !== 'demo-cafetera'),
      connections: project.connections.filter((c) => c.sourceId !== 'demo-cafetera' && c.targetId !== 'demo-cafetera'),
    };
    app.send({ type: 'project', mode: 'patch', changes: { devices: project.devices, connections: project.connections } });
    await waitFor(() => lastOn(`homeassistant/device/${cafetera.nodeId}/config`)?.payload === '');
    await waitFor(() => lastOn(cafetera.availabilityTopic)?.payload === '');
  });

  it('inspector de tráfico: backlog y envío en vivo con dispositivo y sentido', async () => {
    app.send({ type: 'traffic', subscribe: true });
    const backlog = await waitFor(() => app.of('traffic')[0]);
    expect(backlog.entries.length).toBeGreaterThan(5);
    expect(backlog.entries.some((e: TrafficEntry) => e.dir === 'in')).toBe(true);
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    await spy.publishAsync(`${luz.entities[0]!.commandTopic}/set`, '{"state":"OFF"}');
    const live = await waitFor(() => app.of('traffic').slice(1).flatMap((t) => t.entries).find((e) => e.dir === 'in' && e.topic.endsWith('/set')));
    expect(live.deviceId).toBe('demo-luz-salon');
    app.send({ type: 'traffic', subscribe: false });
  });

  it('resetear el lab borra retenidos y vuelve a publicar', async () => {
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    const topic = `homeassistant/device/${luz.nodeId}/config`;
    const mark = seen.length;
    app.send({ type: 'lab', action: 'reset', requestId: 'r1' });
    const res = await waitFor(() => app.of('lab_result').find((r) => r.requestId === 'r1'));
    expect(res.ok).toBe(true);
    const after = seen.slice(mark).filter((s) => s.topic === topic);
    expect(after[0]?.payload).toBe('');
    expect(after.at(-1)?.payload).not.toBe('');
  });

  it('snapshot y restauración de ha-config sin base de datos ni logs', async () => {
    app.send({ type: 'lab', action: 'snapshot', requestId: 's1', name: 'Antes de probar' });
    const res = await waitFor(() => app.of('lab_result').find((r) => r.requestId === 's1'));
    expect(res.ok).toBe(true);
    const snap = res.snapshots?.[0];
    expect(snap?.name).toBe('Antes de probar');
    const files = await readdir(join(snapshotsDir, snap!.id, 'ha-config'));
    expect(files).toContain('configuration.yaml');
    expect(files).not.toContain('home-assistant_v2.db');
    expect(files).not.toContain('home-assistant.log');
    expect(JSON.parse(await readFile(join(snapshotsDir, snap!.id, 'project.json'), 'utf8')).id).toBe(project.id);

    // Permisos: carpeta 0700 y archivos 0600 (los snapshots llevan secretos).
    expect((await stat(snapshotsDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(snapshotsDir, snap!.id))).mode & 0o777).toBe(0o700);
    expect((await stat(join(snapshotsDir, snap!.id, 'meta.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(snapshotsDir, snap!.id, 'ha-config', 'configuration.yaml'))).mode & 0o777).toBe(0o600);
    expect(snap?.credentials).toBe(true);

    await writeFile(join(haConfig, 'configuration.yaml'), 'roto: true\n');
    await writeFile(join(haConfig, 'nuevo.yaml'), 'x: 1\n');
    const stops = docker.stops;
    app.send({ type: 'lab', action: 'restore', requestId: 's2', id: snap!.id });
    const restored = await waitFor(() => app.of('lab_result').find((r) => r.requestId === 's2'));
    expect(restored.ok).toBe(true);
    expect(docker.stops).toBe(stops + 1);
    expect(docker.starts).toBe(docker.stops);
    expect(restored.project?.id).toBe(project.id);
    expect(await readFile(join(haConfig, 'configuration.yaml'), 'utf8')).toBe('default_config:\n');
    expect(await readdir(haConfig)).not.toContain('nuevo.yaml');
    expect(await readFile(join(haConfig, 'home-assistant_v2.db'), 'utf8')).toBe('BASE DE DATOS');

    app.send({ type: 'lab', action: 'delete_snapshot', requestId: 's3', id: snap!.id });
    const del = await waitFor(() => app.of('lab_result').find((r) => r.requestId === 's3'));
    expect(del.snapshots).toEqual([]);
  });

  it('path traversal: «.», «..», rutas e ids desconocidos no borran ni restauran nada', async () => {
    app.send({ type: 'lab', action: 'snapshot', requestId: 'pt0', name: 'Superviviente' });
    const made = await waitFor(() => app.of('lab_result').find((r) => r.requestId === 'pt0'));
    const id = made.snapshots![0]!.id;
    const bad = ['.', '..', '../ha-config', 'a/b', '', 'no-existe'];
    for (const [i, badId] of bad.entries()) {
      app.send({ type: 'lab', action: 'delete_snapshot', requestId: `pd${i}`, id: badId });
      app.send({ type: 'lab', action: 'restore', requestId: `pr${i}`, id: badId });
    }
    for (let i = 0; i < bad.length; i++) {
      const d = await waitFor(() => app.of('lab_result').find((r) => r.requestId === `pd${i}`));
      const r = await waitFor(() => app.of('lab_result').find((x) => x.requestId === `pr${i}`));
      expect(d.ok).toBe(false);
      expect(r.ok).toBe(false);
    }
    expect(await readdir(snapshotsDir)).toContain(id);
    expect(await readFile(join(haConfig, 'configuration.yaml'), 'utf8')).toBe('default_config:\n');
    expect(validSnapshotId('.')).toBe(false);
    expect(validSnapshotId('..')).toBe(false);
    expect(validSnapshotId('2026-10-12T10-00-00-000Z-hola')).toBe(true);
  });

  it('«Excluir credenciales»: el snapshot no lleva .storage/auth* y al restaurar se conservan las actuales', async () => {
    await writeFile(join(haConfig, '.storage', 'auth'), '{"usuarios":"de antes"}');
    await writeFile(join(haConfig, '.storage', 'auth_provider.homeassistant'), '{"hash":"x"}');
    app.send({ type: 'lab', action: 'snapshot', requestId: 'c1', name: 'Sin credenciales', excludeCredentials: true });
    const res = await waitFor(() => app.of('lab_result').find((r) => r.requestId === 'c1'));
    const snap = res.snapshots!.find((x) => x.name === 'Sin credenciales')!;
    expect(snap.credentials).toBe(false);
    const files = await readdir(join(snapshotsDir, snap.id, 'ha-config', '.storage'));
    expect(files).toContain('core.area_registry');
    expect(files.some((f) => f.startsWith('auth'))).toBe(false);
    await writeFile(join(haConfig, '.storage', 'auth'), '{"usuarios":"actuales"}');
    app.send({ type: 'lab', action: 'restore', requestId: 'c2', id: snap.id });
    expect((await waitFor(() => app.of('lab_result').find((r) => r.requestId === 'c2'))).ok).toBe(true);
    expect(await readFile(join(haConfig, '.storage', 'auth'), 'utf8')).toBe('{"usuarios":"actuales"}');
    expect(await readdir(join(haConfig, '.storage'))).toContain('auth_provider.homeassistant');
  });

  it('una segunda app queda en solo lectura y no puede cambiar nada', async () => {
    const second = new FakeApp(`ws://127.0.0.1:${server.port()}/orchestrator`);
    await second.login();
    const hello = await waitFor(() => second.of('hello')[0]);
    expect(hello.readOnly).toBe(true);
    second.send({ type: 'node', action: 'stop', deviceIds: 'all' });
    const err = await waitFor(() => second.of('error').find((e) => e.code === 'readonly'));
    expect(err.message).toMatch(/Solo lectura/);
    second.send({ type: 'lab', action: 'list_snapshots', requestId: 'ro1' });
    expect((await waitFor(() => second.of('lab_result').find((r) => r.requestId === 'ro1'))).ok).toBe(true);
    // Los comandos de HA solo van a la app que controla.
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    await spy.publishAsync(`${luz.entities[0]!.commandTopic}/set`, '{"state":"ON"}');
    await waitFor(() => app.of('command').some((c) => c.topic?.startsWith(luz.entities[0]!.commandTopic)));
    expect(second.of('command')).toHaveLength(0);
    second.ws.close();
    await waitFor(() => second.closeCode !== undefined);
  });

  it('automatizaciones al simulador o lab desactivado: retira los packages de HA', async () => {
    const before = unsyncCalls.length;
    app.send({ type: 'project', mode: 'patch', changes: { haBridge: { ...settings, automationsRunIn: 'simulator' } }, settings: { ...settings, automationsRunIn: 'simulator' } });
    await waitFor(() => unsyncCalls.length > before);
    app.send({ type: 'project', mode: 'patch', changes: { haBridge: settings }, settings });
    await lab.idle();
    const mid = unsyncCalls.length;
    app.send({ type: 'goodbye' });
    await waitFor(() => unsyncCalls.length > mid);
  });

  it('rechaza mensajes de otra versión del protocolo', async () => {
    app.ws.send(JSON.stringify({ v: 99, type: 'hello' }));
    const err = await waitFor(() => app.of('error').find((e) => /Versión de protocolo/.test(e.message)));
    expect(err.code).toBe('invalid');
  });

  it('/health responde', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port()}/orchestrator/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.apps).toBe(1);
    expect(body.controller).toBe(true);
    expect(body).not.toHaveProperty('project');
  });

  it('sin app conectada todo pasa a offline', async () => {
    const luz = model().devices.find((d) => d.device.id === 'demo-luz-salon')!;
    app.ws.close();
    await waitFor(() => lastOn('hasim/bridge/state')?.payload === 'offline');
    await waitFor(() => lastOn(luz.availabilityTopic)?.payload === 'offline');
  });

  it('si se va la app que controla, la siguiente pasa a controlar', async () => {
    const url = `ws://127.0.0.1:${server.port()}/orchestrator`;
    const a = new FakeApp(url);
    await a.login();
    await waitFor(() => a.of('hello')[0]);
    const b = new FakeApp(url);
    await b.login();
    await waitFor(() => b.of('hello')[0]?.readOnly === true);
    a.ws.close();
    await waitFor(() => b.of('hello').some((h) => h.readOnly === false));
    b.ws.close();
  });
});

describe('restaurar sin Docker y con fallos', () => {
  function fakeConn(): AppConnection & { got: ServerMessage[] } {
    const got: ServerMessage[] = [];
    return { traffic: false, got, send: (m) => got.push(m) };
  }

  it('sin control de Docker la restauración está desactivada y no toca ha-config', async () => {
    const cfg = await mkdtemp(join(tmpdir(), 'hasim-ha-'));
    const snaps = await mkdtemp(join(tmpdir(), 'hasim-snap-'));
    await writeFile(join(cfg, 'configuration.yaml'), 'original\n');
    const store = new SnapshotStore(cfg, snaps);
    const info = await store.create('uno', undefined);
    await writeFile(join(cfg, 'configuration.yaml'), 'cambiado\n');
    const l = new Lab({ mqttUrl: `mqtt://127.0.0.1:${mqttPort}`, settleMs: 20, clientIdPrefix: 'nodocker', snapshots: store, containers: { available: async () => false, stop: async () => undefined, start: async () => undefined } });
    await l.start();
    const c = fakeConn();
    l.attach(c);
    await l.handle(c, { v: 1, type: 'lab', action: 'restore', requestId: 'x', id: info.id });
    const res = c.got.find((m): m is Extract<ServerMessage, { type: 'lab_result' }> => m.type === 'lab_result');
    expect(res?.ok).toBe(false);
    expect(res?.message).toMatch(/Docker/);
    expect(await readFile(join(cfg, 'configuration.yaml'), 'utf8')).toBe('cambiado\n');
    await l.close();
  });

  it('si la copia falla, Home Assistant vuelve a arrancar (finally)', async () => {
    const cfg = await mkdtemp(join(tmpdir(), 'hasim-ha-'));
    const snaps = await mkdtemp(join(tmpdir(), 'hasim-snap-'));
    await writeFile(join(cfg, 'configuration.yaml'), 'x\n');
    const store = new SnapshotStore(cfg, snaps);
    const info = await store.create('uno', undefined);
    let started = 0;
    store.restore = async () => {
      throw new Error('disco lleno');
    };
    const l = new Lab({ mqttUrl: `mqtt://127.0.0.1:${mqttPort}`, settleMs: 20, clientIdPrefix: 'fallo', snapshots: store, containers: { available: async () => true, stop: async () => undefined, start: async () => void (started += 1) } });
    await l.start();
    const c = fakeConn();
    l.attach(c);
    await l.handle(c, { v: 1, type: 'lab', action: 'restore', requestId: 'x', id: info.id });
    const res = c.got.find((m): m is Extract<ServerMessage, { type: 'lab_result' }> => m.type === 'lab_result');
    expect(res?.ok).toBe(false);
    expect(res?.message).toMatch(/disco lleno/);
    expect(started).toBe(1);
    await l.close();
  });
});

describe('/health con MQTT caído', () => {
  it('refleja el estado real de la conexión MQTT', async () => {
    const b = await Aedes.createBroker();
    const srv = createServer(b.handle);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const addr = srv.address();
    const url = `mqtt://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const l = new Lab({ mqttUrl: url, settleMs: 20, clientIdPrefix: 'health' });
    await l.start();
    const s = await startServer(l, { port: 0, token: TOKEN });
    const health = async () => fetch(`http://127.0.0.1:${s.port()}/health`);
    expect((await health()).status).toBe(200);
    const links = l as unknown as { main: { client: MqttClient } };
    links.main.client.options.reconnectPeriod = 0;
    links.main.client.stream.destroy();
    await waitFor(() => l.health().ok === false);
    const res = await health();
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).mqtt).toBe('disconnected');
    await s.close();
    await l.close();
    await new Promise<void>((r) => srv.close(() => r()));
    await b.close();
  });
});

describe('snapshots', () => {
  it('excluye base de datos, logs y cachés', () => {
    expect(excludedFromSnapshot('home-assistant_v2.db')).toBe(true);
    expect(excludedFromSnapshot('home-assistant_v2.db-wal')).toBe(true);
    expect(excludedFromSnapshot('home-assistant.log.1')).toBe(true);
    expect(excludedFromSnapshot('deps/x')).toBe(true);
    expect(excludedFromSnapshot('.storage/core.entity_registry')).toBe(false);
    expect(excludedFromSnapshot('configuration.yaml')).toBe(false);
  });
});

describe('LWT', () => {
  it('si el orquestador cae, el broker publica bridge/state offline', async () => {
    const b = await Aedes.createBroker();
    const srv = createServer(b.handle);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const addr = srv.address();
    const url = `mqtt://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const watcher = await mqtt.connectAsync(url, { clientId: 'watcher' });
    const got: Seen[] = [];
    watcher.on('message', (topic, payload, packet) => got.push({ topic, payload: payload.toString(), retain: packet.retain }));
    await watcher.subscribeAsync(['hasim/bridge/state', 'hasim-z2m/bridge/state']);
    const l = new Lab({ mqttUrl: url, settleMs: 20, clientIdPrefix: 'lwt' });
    await l.start();
    const links = l as unknown as { main: { client: MqttClient }; z2m: { client: MqttClient } };
    links.main.client.stream.destroy();
    links.z2m.client.stream.destroy();
    await waitFor(() => got.some((g) => g.topic === 'hasim/bridge/state' && g.payload === 'offline'));
    await waitFor(() => got.some((g) => g.topic === 'hasim-z2m/bridge/state' && g.payload === '{"state":"offline"}'));
    await l.close();
    await watcher.endAsync();
    await new Promise<void>((r) => srv.close(() => r()));
    await b.close();
  });
});
