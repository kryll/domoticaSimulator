// Vía Matter real: el bridge de matter.js del orquestador probado con un controlador Matter de
// matter.js en el mismo proceso (comisionado PASE/CASE, lecturas, suscripciones y comandos de
// verdad). La red es la simulada de matter.js (NetworkSimulator): así funciona igual en cualquier
// máquina, también sin IPv6 ni multicast (este contenedor de desarrollo no tiene IPv6 y matter.js lo
// exige en la red real). También se prueba el comisionado automático contra un matterjs-server falso
// (su API WebSocket: get_nodes, commission_with_code) y que al reiniciar no se vuelve a comisionar.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { ControllerBehavior, Crypto, Entropy, Environment, MockStorageService, Network, NetworkSimulator, Seconds, ServerNode, type ClientNode } from '@matter/main';
import { FabricId } from '@matter/main/types';
import { OnOffClient } from '@matter/main/behaviors/on-off';
import { LevelControlClient } from '@matter/main/behaviors/level-control';
import { ColorControlClient } from '@matter/main/behaviors/color-control';
import { DoorLockClient } from '@matter/main/behaviors/door-lock';
import { BridgedDeviceBasicInformationClient } from '@matter/main/behaviors/bridged-device-basic-information';
import { BasicInformationClient } from '@matter/main/behaviors/basic-information';
import { DescriptorClient } from '@matter/main/behaviors/descriptor';
import { ElectricalPowerMeasurementClient } from '@matter/main/behaviors/electrical-power-measurement';
import { MatterBackend } from '../src/matter/backend';
import { MatterSecretsStore, isValidPasscode, newSecrets } from '../src/matter/store';
import { matterUniqueIdMatcher } from '../src/haNative';
import type { NativeContext, NativeEvents } from '../src/native';
import { catalog } from '../../../src/devices/catalog';
import { createDemoProject } from '../../../src/store/demoProject';
import { createSimulationState } from '../../../src/simulation/engine';
import type { BridgeCommand } from '../../../src/bridge/mqtt/commands';
import type { EntityState, Id, Project } from '../../../src/types';

/** Espera activa: los runners de CI son lentos (un límite de 300 ms ya falló una vez). */
async function waitFor<T>(what: string, fn: () => T | undefined | false | Promise<T | undefined | false>, timeout = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`Tiempo de espera agotado: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** Entorno de matter.js con un host de la red simulada y almacenamiento en memoria. */
function mockEnv(sim: NetworkSimulator, name: string, index: number): Environment {
  const env = new Environment(name);
  env.set(Crypto, Environment.default.get(Crypto));
  env.set(Entropy, Environment.default.get(Entropy));
  env.set(Network, sim.addHost(index));
  new MockStorageService(env);
  return env;
}

async function controllerOn(sim: NetworkSimulator, index: number) {
  const ctl = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), {
    id: `ctl${index}`,
    environment: mockEnv(sim, `ctl${index}`, index),
    commissioning: { enabled: false },
    controller: { adminFabricId: FabricId(1) },
  });
  await ctl.start();
  cleanups.push(() => ctl.close());
  return ctl;
}

interface Recorder {
  events: NativeEvents;
  commands: Array<{ deviceId: Id; command: BridgeCommand }>;
  traffic: string[];
}

function recorder(): Recorder {
  const r: Recorder = { commands: [], traffic: [], events: { command: () => undefined, traffic: () => undefined, changed: () => undefined, log: () => undefined } };
  r.events = {
    command: (deviceId, command) => r.commands.push({ deviceId, command }),
    traffic: (e) => r.traffic.push(`${e.dir} ${e.topic} ${e.payload}`),
    changed: () => undefined,
    log: () => undefined,
  };
  return r;
}

const MATTER_IDS = ['demo-luz-matter', 'demo-enchufe-matter', 'demo-cerradura'];

function context(project: Project, entities: Record<string, EntityState>, extra: Partial<NativeContext> = {}): NativeContext {
  return { project, defs: catalog, entities, devices: new Set(MATTER_IDS), down: new Set(), live: true, ...extra };
}

describe('Matter: secretos del bridge', () => {
  it('passcode válido, discriminador de 12 bits y fichero 0600 que conserva el nodo', async () => {
    for (let i = 0; i < 50; i++) {
      const s = newSecrets();
      expect(isValidPasscode(s.passcode)).toBe(true);
      expect(s.discriminator).toBeGreaterThanOrEqual(0);
      expect(s.discriminator).toBeLessThan(4096);
      expect(s.uniqueId.length).toBeLessThanOrEqual(32);
    }
    expect(isValidPasscode(12345678)).toBe(false);
    expect(isValidPasscode(11111111)).toBe(false);
    expect(isValidPasscode(100000000)).toBe(false);
    const file = join(await mkdtemp(join(tmpdir(), 'hasim-matter-')), 'matter.json');
    const store = new MatterSecretsStore(file);
    const a = await store.load();
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await store.update({ nodeId: 7 });
    const again = await new MatterSecretsStore(file).load();
    expect(again).toEqual({ ...a, nodeId: 7 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ passcode: a.passcode, nodeId: 7 });
    expect(await store.update({ clearNode: true })).not.toHaveProperty('nodeId');
  });

  it('unique_id de la integración matter de HA (bridge: endpoint bridged = endpoint)', () => {
    const match = matterUniqueIdMatcher(1, 3, 6, 0);
    expect(match('C55D0B92F0A14946-0000000000000001-3-3-MatterLight-6-0')).toBe(true);
    expect(match('C55D0B92F0A14946-0000000000000001-3-3-MatterPlug-6-0')).toBe(true);
    expect(match('C55D0B92F0A14946-0000000000000002-3-3-MatterLight-6-0')).toBe(false);
    expect(match('C55D0B92F0A14946-0000000000000001-13-13-MatterLight-6-0')).toBe(false);
    expect(match('C55D0B92F0A14946-0000000000000001-3-3-MatterLight-8-0')).toBe(false);
    expect(matterUniqueIdMatcher(26, 2, 1026, 0)('00000000000000AB-000000000000001A-2-2-TemperatureSensor-1026-0')).toBe(true);
  });
});

describe('Matter: bridge de matter.js con un controlador real (red simulada)', () => {
  it('comisiona, lee, recibe comandos, informa cambios y marca no alcanzable al parar', { timeout: 120_000 }, async () => {
    const sim = new NetworkSimulator();
    const dir = await mkdtemp(join(tmpdir(), 'hasim-matter-'));
    const project = { ...createDemoProject(), id: 'test' };
    let sim0 = createSimulationState(project, catalog, Date.now());
    const rec = recorder();
    const backend = new MatterBackend({ environment: mockEnv(sim, 'bridge', 1), secretsFile: join(dir, 'matter.json'), matterLogLevel: 'error' });
    cleanups.push(() => backend.close());
    await backend.start(rec.events);
    await backend.sync(context(project, sim0.entities));
    const pairing = await waitFor('datos de emparejamiento', () => backend.pairing());
    expect(pairing.manualCode).toMatch(/^\d{11}$/);
    expect(backend.status().state).toBe('connected');
    expect(backend.alignTargets()).toEqual([]);

    // Un controlador Matter (como matterjs-server) comisiona el bridge con el passcode.
    const ctl = await controllerOn(sim, 2);
    const peer: ClientNode = await ctl.peers.commission({ passcode: pairing.passcode, discriminator: pairing.discriminator, timeout: Seconds(90) });
    const luzEp = backend.endpointOf('demo-luz-matter');
    const plugEp = backend.endpointOf('demo-enchufe-matter');
    const lockEp = backend.endpointOf('demo-cerradura');
    if (luzEp === undefined || plugEp === undefined || lockEp === undefined) throw new Error('sin endpoints');
    const luz = peer.endpoints.for(luzEp);
    const plug = peer.endpoints.for(plugEp);
    const lock = peer.endpoints.for(lockEp);
    expect(luz.stateOf(BridgedDeviceBasicInformationClient)).toMatchObject({ nodeLabel: 'Luz Matter', reachable: true, vendorName: 'IKEA' });
    expect(luz.stateOf(OnOffClient).onOff).toBe(false);
    expect(lock.stateOf(DoorLockClient).lockState).toBe(1);
    expect(peer.endpoints.for(0).stateOf(BasicInformationClient).uniqueId).toMatch(/^hasim-bridge-/);

    // HA → simulador: OnOff, LevelControl y ColorControl llegan como servicios; el estado no cambia solo.
    await luz.commandsOf(OnOffClient).on();
    await waitFor('light.turn_on', () => rec.commands.find((c) => c.command.service === 'light.turn_on' && c.deviceId === 'demo-luz-matter'));
    await luz.commandsOf(LevelControlClient).moveToLevelWithOnOff({ level: 128, transitionTime: null, optionsMask: {}, optionsOverride: {} });
    const level = await waitFor('brillo', () => rec.commands.find((c) => c.command.data.brightness !== undefined));
    expect(level.command).toEqual({ entityId: 'light.luz_matter', service: 'light.turn_on', data: { brightness: 128 } });
    await luz.commandsOf(ColorControlClient).moveToColorTemperature({ colorTemperatureMireds: 370, transitionTime: 0, optionsMask: {}, optionsOverride: {} });
    await waitFor('temperatura de color', () => rec.commands.find((c) => c.command.data.color_temp_kelvin === 2703));
    await plug.commandsOf(OnOffClient).on();
    await waitFor('switch.turn_on', () => rec.commands.find((c) => c.command.entityId === 'switch.enchufe_matter_switch' && c.command.service === 'switch.turn_on'));
    await lock.commandsOf(DoorLockClient).unlockDoor({});
    await waitFor('lock.unlock', () => rec.commands.find((c) => c.command.service === 'lock.unlock'));
    expect(luz.stateOf(OnOffClient).onOff).toBe(false);
    expect(rec.traffic.some((t) => t.startsWith('in matter/Luz Matter OnOff · On'))).toBe(true);

    // Simulador → HA: el estado de la app llega por la suscripción del controlador.
    const entities = { ...sim0.entities };
    entities['light.luz_matter'] = { state: 'on', attributes: { brightness: 128, color_temp_kelvin: 2700, color_mode: 'color_temp' } };
    entities['switch.enchufe_matter_switch'] = { state: 'on', attributes: {} };
    entities['sensor.enchufe_matter_power'] = { state: 40, attributes: {} };
    entities['lock.cerradura_entrada_lock'] = { state: 'unlocked', attributes: {} };
    sim0 = { ...sim0, entities };
    await backend.sync(context(project, entities));
    await waitFor('OnOff=true en el controlador', () => luz.stateOf(OnOffClient).onOff === true);
    await waitFor('CurrentLevel=128', () => luz.stateOf(LevelControlClient).currentLevel === 128);
    await waitFor('370 mireds', () => luz.stateOf(ColorControlClient).colorTemperatureMireds === 370);
    await waitFor('enchufe encendido', () => plug.stateOf(OnOffClient).onOff === true);
    await waitFor('40 W = 40000 mW', () => Number(plug.stateOf(ElectricalPowerMeasurementClient).activePower) === 40_000);
    await waitFor('cerradura abierta', () => lock.stateOf(DoorLockClient).lockState === 2);

    // Parar el dispositivo: Reachable=false (HA lo pone no disponible); arrancarlo: true.
    await backend.sync(context(project, entities, { down: new Set(['demo-luz-matter']) }));
    await waitFor('Reachable=false', () => luz.stateOf(BridgedDeviceBasicInformationClient).reachable === false);
    expect(backend.status().nodes['demo-luz-matter']).toMatchObject({ state: 'stopped' });
    expect(plug.stateOf(BridgedDeviceBasicInformationClient).reachable).toBe(true);
    await backend.sync(context(project, entities));
    await waitFor('Reachable=true', () => luz.stateOf(BridgedDeviceBasicInformationClient).reachable === true);
    // Sin app en vivo, todos no alcanzables.
    await backend.sync(context(project, entities, { live: false }));
    await waitFor('todos Reachable=false', () => plug.stateOf(BridgedDeviceBasicInformationClient).reachable === false && lock.stateOf(BridgedDeviceBasicInformationClient).reachable === false);

    // Quitar un dispositivo del proyecto quita su endpoint del bridge.
    await backend.sync(context(project, entities, { devices: new Set(['demo-luz-matter', 'demo-cerradura']) }));
    expect(backend.endpointOf('demo-enchufe-matter')).toBeUndefined();
    const aggregatorParts = (): readonly number[] => peer.endpoints.for(1).stateOf(DescriptorClient).partsList.map(Number);
    await waitFor('el enchufe desaparece del aggregator en el controlador', () => !aggregatorParts().includes(plugEp) && aggregatorParts().includes(luzEp));
  });
});

describe('Matter: cambiar de proyecto', () => {
  it('los endpoints del proyecto anterior se quitan del bridge aunque los dispositivos compartan id', { timeout: 60_000 }, async () => {
    const sim = new NetworkSimulator();
    const dir = await mkdtemp(join(tmpdir(), 'hasim-matter-'));
    const backend = new MatterBackend({ environment: mockEnv(sim, 'bridge', 1), secretsFile: join(dir, 'matter.json'), matterLogLevel: 'error' });
    cleanups.push(() => backend.close());
    await backend.start(recorder().events);
    const viejo = { ...createDemoProject(), id: 'viejo' };
    const nuevo = { ...viejo, id: 'nuevo' };
    const entities = createSimulationState(viejo, catalog, Date.now()).entities;
    await backend.sync(context(viejo, entities));
    const antes = backend.bridgeEndpointIds();
    expect(antes).toHaveLength(MATTER_IDS.length);
    await backend.sync(context(nuevo, entities));
    const despues = backend.bridgeEndpointIds();
    expect(despues).toHaveLength(MATTER_IDS.length);
    expect(despues.filter((id) => antes.includes(id))).toEqual([]);
    expect(backend.endpointOf('demo-luz-matter')).toBeDefined();
  });
});

/**
 * matterjs-server falso: su API WebSocket (server_info, get_nodes, commission_with_code) y, por
 * debajo, un controlador de matter.js de verdad que comisiona el bridge.
 */
async function fakeMatterServer(sim: NetworkSimulator, pairing: () => { passcode: number; discriminator: number } | undefined) {
  const ctl = await controllerOn(sim, 9);
  const calls: string[] = [];
  const nodes = new Map<number, ClientNode>();
  let next = 1;
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  cleanups.push(() => new Promise<void>((r) => wss.close(() => r())));
  const port = (wss.address() as { port: number }).port;
  const reply = (ws: WebSocket, id: unknown, result: unknown): void => ws.send(JSON.stringify({ message_id: id, result }));
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ fabric_id: 1, compressed_fabric_id: 1234, schema_version: 14, sdk_version: 'falso' }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { message_id: string; command: string; args?: Record<string, unknown> };
      calls.push(msg.command);
      if (msg.command === 'get_nodes') {
        reply(
          ws,
          msg.message_id,
          [...nodes].map(([id, peer]) => ({ node_id: id, available: true, attributes: { '0/40/18': peer.endpoints.for(0).stateOf(BasicInformationClient).uniqueId } })),
        );
      } else if (msg.command === 'commission_with_code') {
        const p = pairing();
        if (!p || !/^\d{11}$/.test(String(msg.args?.code)) || msg.args?.network_only !== true) {
          ws.send(JSON.stringify({ message_id: msg.message_id, error_code: 8, details: 'argumentos' }));
          return;
        }
        ctl.peers
          .commission({ passcode: p.passcode, discriminator: p.discriminator, timeout: Seconds(90) })
          .then((peer) => {
            const id = next++;
            nodes.set(id, peer);
            reply(ws, msg.message_id, { node_id: id, available: true });
          })
          .catch((err: unknown) => ws.send(JSON.stringify({ message_id: msg.message_id, error_code: 1, details: String(err) })));
      } else ws.send(JSON.stringify({ message_id: msg.message_id, error_code: 2, details: 'desconocido' }));
    });
  });
  return { url: `ws://127.0.0.1:${port}/ws`, calls, nodes };
}

describe('Matter: comisionado automático en matterjs-server', () => {
  it('comisiona con commission_with_code, guarda el nodo y al reiniciar lo reutiliza sin volver a comisionar', { timeout: 180_000 }, async () => {
    const sim = new NetworkSimulator();
    const dir = await mkdtemp(join(tmpdir(), 'hasim-matter-'));
    const secretsFile = join(dir, 'matter.json');
    const project = { ...createDemoProject(), id: 'test' };
    const entities = createSimulationState(project, catalog, Date.now()).entities;
    // El mismo entorno (y su almacenamiento) para el primer y el segundo arranque del bridge.
    const env = mockEnv(sim, 'bridge', 1);
    let backend = new MatterBackend({ environment: env, secretsFile, matterLogLevel: 'error', commissionRetryMs: [500] });
    const server = await fakeMatterServer(sim, () => backend.pairing());
    backend = new MatterBackend({ environment: env, secretsFile, matterLogLevel: 'error', commissionRetryMs: [500], serverUrl: server.url });
    await backend.start(recorder().events);
    await backend.sync(context(project, entities));
    await waitFor('bridge comisionado', () => backend.status().detail.includes('comisionado en matterjs-server'), 90_000);
    expect(server.calls.filter((c) => c === 'commission_with_code')).toHaveLength(1);
    const secrets = JSON.parse(await readFile(secretsFile, 'utf8')) as { nodeId?: number };
    expect(secrets.nodeId).toBe(1);
    expect(backend.status()).toMatchObject({ state: 'connected', nodes: { 'demo-luz-matter': { state: 'running' } } });
    // Alineación de entity_id: el unique_id de HA para la luz (cluster OnOff 6, atributo 0).
    const ep = backend.endpointOf('demo-luz-matter');
    const target = backend.alignTargets().find((t) => t.entityId === 'light.luz_matter');
    expect(target?.platform).toBe('matter');
    expect(target?.match(`00000000000004D2-0000000000000001-${ep}-${ep}-MatterLight-6-0`)).toBe(true);
    expect(backend.alignTargets().map((t) => t.entityId)).toEqual(expect.arrayContaining(['switch.enchufe_matter_switch', 'sensor.enchufe_matter_power', 'lock.cerradura_entrada_lock']));

    // Reinicio del orquestador: mismo almacenamiento → mismo bridge comisionado, sin commission_with_code.
    await backend.close();
    const again = new MatterBackend({ environment: env, secretsFile, matterLogLevel: 'error', serverUrl: server.url });
    cleanups.push(() => again.close());
    await again.start(recorder().events);
    await again.sync(context(project, entities));
    await waitFor('bridge reutilizado', () => again.status().detail.includes('comisionado en matterjs-server'), 60_000);
    expect(server.calls.filter((c) => c === 'commission_with_code')).toHaveLength(1);
    expect(server.nodes.size).toBe(1);
    expect(again.endpointOf('demo-luz-matter')).toBe(ep);
  });

  it('sin matterjs-server: espera y lo dice en el estado', { timeout: 30_000 }, async () => {
    const sim = new NetworkSimulator();
    const dir = await mkdtemp(join(tmpdir(), 'hasim-matter-'));
    const project = { ...createDemoProject(), id: 'test' };
    const backend = new MatterBackend({ environment: mockEnv(sim, 'bridge', 1), secretsFile: join(dir, 'matter.json'), matterLogLevel: 'error', serverUrl: 'ws://127.0.0.1:1/ws' });
    cleanups.push(() => backend.close());
    await backend.start(recorder().events);
    await backend.sync(context(project, createSimulationState(project, catalog, Date.now()).entities));
    const st = await waitFor('esperando al servidor', () => (backend.status().state === 'connecting' && backend.status().detail.includes('matterjs-server') ? backend.status() : undefined), 20_000);
    expect(st.nodes['demo-luz-matter']).toMatchObject({ state: 'starting' });
  });
});
