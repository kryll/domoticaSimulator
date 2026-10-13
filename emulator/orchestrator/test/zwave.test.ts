// Vía Z-Wave real con el driver de verdad: el backend del orquestador manda la red al controlador
// mock (en memoria, sin Docker) y un Driver de zwave-js (el mismo que lleva Z-Wave JS UI) se conecta
// por TCP como si fuera una antena USB. Se comprueba la entrevista de los nodos, que un Set de HA
// llega como comando del simulador, que los cambios del simulador llegan como informes, y que un
// nodo parado queda dead y un controlador parado corta la conexión.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { Driver, type ZWaveNode } from 'zwave-js';
import { ZwaveMockHost, splitSerialFrames } from '../src/zwave/mock';
import { ZwaveBackend, type MockLink } from '../src/zwave/backend';
import type { FromMock } from '../src/zwave/protocol';
import type { NativeContext } from '../src/native';
import { catalog } from '../../../src/devices/catalog';
import { createDemoProject } from '../../../src/store/demoProject';
import type { Device, EntityState, Project } from '../../../src/types';
import type { BridgeCommand } from '../../../src/bridge/mqtt/commands';

async function waitFor<T>(fn: () => T | undefined | false, timeout = 20_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 50));
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

/** Canal en memoria entre el backend y el mock (en producción es un WebSocket con token). */
function localLink(port: number): { link: MockLink; host: ZwaveMockHost; frames: string[] } {
  let handlers: Parameters<MockLink['connect']>[0] | undefined;
  const frames: string[] = [];
  const emit = (msg: FromMock): void => handlers?.message(msg);
  const host = new ZwaveMockHost({
    port,
    host: '127.0.0.1',
    onCommand: (nodeId, command) => emit({ type: 'command', nodeId, command }),
    onFrame: (dir, nodeId, summary) => {
      frames.push(`${dir} ${nodeId} ${summary}`);
      emit({ type: 'frame', dir, nodeId, summary });
    },
    onStatus: (s) => emit({ type: 'status', ...s }),
  });
  const link: MockLink = {
    connected: true,
    connect: (h) => {
      handlers = h;
      h.open();
    },
    send: (msg) => {
      if (msg.type === 'state') void host.apply(msg.state);
    },
    close: () => undefined,
  };
  return { link, host, frames };
}

const dev = (id: string, definitionId: string, name: string, roomId?: string): Device => {
  const def = catalog.find((d) => d.id === definitionId);
  if (!def) throw new Error(definitionId);
  return { id, definitionId, name, floorId: 'f', ...(roomId ? { roomId } : {}), position: { x: 0, y: 0 }, protocol: 'zwave', integration: 'zwave_js' };
};

const base = createDemoProject();
const project: Project = {
  ...base,
  id: 'zw',
  devices: [dev('antena', 'ha-connect-zwa-2', 'Antena Z-Wave'), dev('enchufe', 'fibaro-wall-plug', 'Enchufe despacho', 'demo-despacho'), dev('ms', 'aeotec-multisensor-7', 'Multisensor')],
  connections: [],
  automations: [],
};
const ALL = new Set(['antena', 'enchufe', 'ms']);

let port = 0;
let backend: ZwaveBackend;
let local: ReturnType<typeof localLink>;
let driver: Driver;
const commands: Array<[string, BridgeCommand]> = [];
let entities: Record<string, EntityState> = {
  'switch.enchufe_despacho_switch': { state: 'off' },
  'sensor.enchufe_despacho_power': { state: 0 },
  'sensor.enchufe_despacho_energy': { state: 1.5 },
  'binary_sensor.multisensor_motion': { state: 'off' },
  'sensor.multisensor_temperature': { state: 21 },
  'sensor.multisensor_battery': { state: 90 },
};
const ctx = (over: Partial<NativeContext> = {}): NativeContext => ({ project, defs: catalog, entities, devices: ALL, down: new Set(), live: true, ...over });

beforeAll(async () => {
  port = await freePort();
  local = localLink(port);
  backend = new ZwaveBackend({ link: local.link, wakeUpSeconds: 10, uiUrl: 'http://localhost:8091' });
  await backend.start({ command: (id, c) => commands.push([id, c]), traffic: () => undefined, changed: () => undefined, log: () => undefined });
  await backend.sync(ctx());
  await waitFor(() => local.host.listening);
  driver = new Driver(`tcp://127.0.0.1:${port}`, {
    logConfig: { enabled: false },
    storage: { cacheDir: await mkdtemp(join(tmpdir(), 'hasim-zw-')) },
  });
  driver.on('error', () => undefined);
  const ready = new Promise<void>((resolve) => driver.once('driver ready', () => resolve()));
  await driver.start();
  await ready;
}, 60_000);

afterAll(async () => {
  await driver?.destroy();
  await backend?.close();
  await local?.host.close();
});

const plugNode = (): ZWaveNode => {
  const nodeId = backend.network().nodes.find((n) => n.deviceId === 'enchufe')?.nodeId ?? 0;
  const node = driver.controller.nodes.get(nodeId);
  if (!node) throw new Error('sin nodo');
  return node;
};

describe('Z-Wave real con el driver de zwave-js', () => {
  it('separa las tramas de la API serie aunque TCP las junte', () => {
    const { frames, rest } = splitSerialFrames(Buffer.from('1501030007fb060103', 'hex'));
    expect(frames.map((f) => f.toString('hex'))).toEqual(['15', '01030007fb', '06']);
    expect(rest.toString('hex')).toBe('0103');
  });

  it('la red del proyecto: controlador + un nodo por dispositivo, entrevistados', async () => {
    const ids = backend.network().nodes.map((n) => n.nodeId);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(driver.controller.nodes.has(id)).toBe(true);
    const plug = plugNode();
    await waitFor(() => plug.ready);
    expect(plug.name).toBe('Enchufe despacho');
    expect(plug.location).toBe('Despacho');
    expect(plug.getValue({ commandClass: 0x25, property: 'currentValue' })).toBe(false);
    expect(plug.getValue({ commandClass: 0x32, property: 'value', propertyKey: 65537 })).toBe(1.5);
    expect(backend.status().nodes.antena).toMatchObject({ state: 'running' });
  }, 30_000);

  it('HA enciende el enchufe (Set) → comando switch.turn_on en la app; la app responde → informe', async () => {
    const plug = plugNode();
    await waitFor(() => plug.ready);
    await plug.setValue({ commandClass: 0x25, property: 'targetValue' }, true);
    const [deviceId, cmd] = await waitFor(() => commands.find(([, c]) => c.service === 'switch.turn_on'));
    expect(deviceId).toBe('enchufe');
    expect(cmd.entityId).toBe('switch.enchufe_despacho_switch');
    // El simulador aplica el comando: el enchufe consume 1200 W.
    entities = { ...entities, 'switch.enchufe_despacho_switch': { state: 'on' }, 'sensor.enchufe_despacho_power': { state: 1200 } };
    await backend.sync(ctx());
    await waitFor(() => plug.getValue({ commandClass: 0x32, property: 'value', propertyKey: 66049 }) === 1200);
    expect(plug.getValue({ commandClass: 0x25, property: 'currentValue' })).toBe(true);
    expect(local.frames.some((f) => f.includes('Binary Switch · Set'))).toBe(true);
  }, 30_000);

  it('sensor a pilas: despierta, se entrevista y su movimiento llega por Notification', async () => {
    const nodeId = backend.network().nodes.find((n) => n.deviceId === 'ms')?.nodeId ?? 0;
    const ms = driver.controller.nodes.get(nodeId);
    if (!ms) throw new Error('sin multisensor');
    await waitFor(() => ms.ready, 45_000);
    expect(ms.getValue({ commandClass: 0x31, property: 'Air temperature' })).toBe(21);
    expect(ms.getValue({ commandClass: 0x80, property: 'level' })).toBe(90);
    entities = { ...entities, 'binary_sensor.multisensor_motion': { state: 'on' }, 'sensor.multisensor_temperature': { state: 23.5 } };
    await backend.sync(ctx());
    await waitFor(() => ms.getValue({ commandClass: 0x71, property: 'Home Security', propertyKey: 'Motion sensor status' }) === 8);
    await waitFor(() => ms.getValue({ commandClass: 0x31, property: 'Air temperature' }) === 23.5);
  }, 60_000);

  it('nodo parado: no responde y Z-Wave JS lo marca dead; al arrancarlo vuelve', async () => {
    const plug = plugNode();
    await backend.sync(ctx({ down: new Set(['enchufe']) }));
    expect(await plug.ping()).toBe(false);
    await waitFor(() => plug.status === 3); // NodeStatus.Dead
    expect(backend.status().nodes.enchufe?.state).toBe('stopped');
    await backend.sync(ctx());
    await waitFor(() => plug.status === 4); // Alive
  }, 30_000);

  it('controlador parado: se cierra la antena (todo no disponible) y vuelve a escuchar', async () => {
    await backend.sync(ctx({ down: new Set(['antena']) }));
    await waitFor(() => !local.host.listening);
    expect(backend.status().state).toBe('error');
    await backend.sync(ctx());
    await waitFor(() => local.host.listening);
  }, 30_000);
});
