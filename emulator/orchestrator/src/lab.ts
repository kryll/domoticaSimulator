// Núcleo del orquestador («servidor» del laboratorio): replica el proyecto y el estado que manda
// la app, los publica en Mosquitto con los perfiles Z2M y genérico, reenvía a la app los
// comandos de HA, gestiona el ciclo de vida de los nodos, las operaciones del lab y el
// inspector de tráfico.
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import {
  PENDING_TRANSPORTS,
  defaultHaBridgeSettings,
  type DeviceDefinition,
  type DeviceTransport,
  type EntityState,
  type HaBridgeSettings,
  type Id,
  type Project,
} from '../../../src/types';
import { buildBridgeModel, type BridgeModel, type MqttMessage } from '../../../src/bridge/mqtt/model';
import { desiredRetained, deviceDiscovery, deviceStateMessages } from '../../../src/bridge/mqtt/publish';
import { availabilityMessages, type BridgeAvailability } from '../../../src/bridge/mqtt/availability';
import { parseProject } from '../../../src/store/projectSchema';
import { parseHaBridge } from '../../../src/bridge/schema';
import { parseDefinition } from '../../../src/devices/catalog';
import { createCommandParser, type CommandIndex } from '../../../src/bridge/mqtt/commands';
import {
  trafficPayload,
  type ClientMessage,
  type LabAction,
  type NodeState,
  type ServerMessage,
  type ServiceStatus,
  type SnapshotInfo,
  type StatusMessage,
  type TrafficEntry,
  type TransportStatus,
} from '../../../src/bridge/protocol';
import type { SnapshotStore } from './snapshots';
import type { ContainerControl } from './docker';

export const ORCHESTRATOR_VERSION = '0.2.0';

export interface LabOptions {
  mqttUrl: string;
  username?: string;
  password?: string;
  clientIdPrefix?: string;
  /** Retardo máximo aleatorio antes de republicar al recibir homeassistant/status online. */
  haStatusJitterMs?: number;
  /** Espera tras suscribirse para recoger los retenidos de ejecuciones anteriores. */
  settleMs?: number;
  /** Los nodos nuevos arrancan solos (por defecto sí). */
  autostart?: boolean;
  /** Tamaño del búfer circular del inspector de tráfico. */
  trafficLimit?: number;
  trafficFlushMs?: number;
  snapshots?: SnapshotStore;
  containers?: ContainerControl;
  haContainer?: string;
  /** Exporta los packages y recarga HA (automatizaciones en HA). Devuelve un texto para el registro. */
  sync?: (project: Project, defs: DeviceDefinition[]) => Promise<string>;
  /** Borra los packages del lab (packages/hasim) y recarga HA: automatizaciones de vuelta al simulador. */
  unsync?: () => Promise<string | undefined>;
  syncDebounceMs?: number;
  haTokenAvailable?: () => Promise<boolean>;
  log?: (msg: string) => void;
}

export interface AppConnection {
  send: (msg: ServerMessage) => void;
  /** Suscrita al inspector de tráfico. */
  traffic: boolean;
}

/** Mensajes que solo puede mandar la app que controla el lab (el resto queda en solo lectura). */
const CONTROL_TYPES = new Set<ClientMessage['type']>(['project', 'state', 'node', 'lab', 'command_result', 'goodbye']);

type Outgoing = { [K in ServerMessage['type']]: Omit<Extract<ServerMessage, { type: K }>, 'v'> }[ServerMessage['type']];

const SET_TOPIC = /\/set(\/[^/]+)?$/;

/** Cliente MQTT con LWT propio. Nunca publica en topics /set. */
class Link {
  client: MqttClient | undefined;
  constructor(
    private readonly url: string,
    private readonly opts: IClientOptions,
    private readonly onError: (err: Error) => void = () => undefined,
  ) {}

  async connect(): Promise<MqttClient> {
    // Espera a que el broker acepte la conexión (al arrancar el compose, Mosquitto puede tardar).
    const client = mqtt.connect(this.url, { reconnectPeriod: 2000, connectTimeout: 10_000, ...this.opts });
    client.on('error', (err) => this.onError(err));
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));
    this.client = client;
    return client;
  }

  async publish(topic: string, payload: string, retain: boolean): Promise<void> {
    if (SET_TOPIC.test(topic)) throw new Error(`El orquestador nunca publica en topics de comando: ${topic}`);
    if (!this.client) throw new Error('MQTT sin conectar');
    await this.client.publishAsync(topic, payload, { qos: 1, retain });
  }

  async end(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    if (c) await c.endAsync();
  }
}

export class Lab {
  private settings: HaBridgeSettings = defaultHaBridgeSettings();
  private project: Project | undefined;
  private defs: DeviceDefinition[] = [];
  private model: BridgeModel | undefined;
  private parser: CommandIndex | undefined;
  private entities: Record<string, EntityState> = {};
  private availability: BridgeAvailability = { live: false, unavailable: [] };
  private readonly nodes = new Map<Id, NodeState>();
  private readonly apps = new Set<AppConnection>();
  /** La única app que controla el lab; las demás quedan en solo lectura. */
  private controller: AppConnection | undefined;
  private main: Link | undefined;
  private z2m: Link | undefined;
  private mqttStatus: ServiceStatus = 'disconnected';
  private haStatus: 'online' | 'offline' | 'unknown' = 'unknown';
  /** Último payload publicado por topic (deduplicación). */
  private readonly lastPayload = new Map<string, string>();
  /** Topics retenidos que son nuestros (publicados o encontrados al arrancar). */
  private readonly retained = new Set<string>();
  private collecting = false;
  private traffic: TrafficEntry[] = [];
  private trafficPending: TrafficEntry[] = [];
  private seq = 0;
  private trafficTimer: ReturnType<typeof setInterval> | undefined;
  private haTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private syncKey = '';
  private commandSeq = 0;
  private lastError: string | undefined;
  private snapshotList: SnapshotInfo[] = [];
  private capabilities = { snapshots: false, docker: false, haToken: false };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: LabOptions) {}

  private log(msg: string): void {
    this.opts.log?.(msg);
  }

  // ---------- Arranque y MQTT ----------

  async start(): Promise<void> {
    this.capabilities = {
      snapshots: this.opts.snapshots !== undefined,
      docker: (await this.opts.containers?.available()) ?? false,
      haToken: (await this.opts.haTokenAvailable?.()) ?? false,
    };
    if (this.opts.snapshots) this.snapshotList = await this.opts.snapshots.list().catch(() => []);
    await this.connectMqtt();
    this.trafficTimer = setInterval(() => this.flushTraffic(), this.opts.trafficFlushMs ?? 250);
    this.trafficTimer.unref?.();
  }

  private clientOptions(suffix: string, will: { topic: string; payload: string }): IClientOptions {
    return {
      clientId: `${this.opts.clientIdPrefix ?? 'hasim-orchestrator'}-${suffix}`,
      ...(this.opts.username ? { username: this.opts.username } : {}),
      ...(this.opts.password ? { password: this.opts.password } : {}),
      will: { topic: will.topic, payload: Buffer.from(will.payload), qos: 1, retain: true },
    };
  }

  private async connectMqtt(): Promise<void> {
    const s = this.settings;
    this.mqttStatus = 'connecting';
    const onError = (err: Error): void => {
      this.lastError = `MQTT: ${err.message}`;
      this.log(this.lastError);
    };
    this.main = new Link(this.opts.mqttUrl, this.clientOptions('main', { topic: `${s.baseTopic}/bridge/state`, payload: 'offline' }), onError);
    // LWT propio del Z2M emulado, como Zigbee2MQTT: bridge/state → offline.
    this.z2m = new Link(this.opts.mqttUrl, this.clientOptions('z2m', { topic: `${s.z2mBaseTopic}/bridge/state`, payload: JSON.stringify({ state: 'offline' }) }), onError);
    const client = await this.main.connect();
    await this.z2m.connect();
    this.mqttStatus = 'connected';
    client.on('message', (topic, payload, packet) => this.onMessage(topic, payload.toString(), packet.retain));
    client.on('close', () => this.setMqttStatus('disconnected'));
    client.on('offline', () => this.setMqttStatus('disconnected'));
    client.on('reconnect', () => this.setMqttStatus('connecting'));
    const z2mClient = this.z2m.client;
    z2mClient?.on('close', () => this.broadcastStatus());
    z2mClient?.on('connect', () => this.broadcastStatus());
    client.on('connect', () => {
      this.setMqttStatus('connected');
      // Tras una reconexión se republica todo (el broker pudo reiniciarse sin persistencia).
      void this.enqueue(() => this.publishAll(true));
    });
    // Retenidos de ejecuciones anteriores: se recogen para limpiar los obsoletos.
    const collect = [`${s.discoveryPrefix}/+/+/config`, `${s.discoveryPrefix}/+/+/+/config`, `${s.baseTopic}/#`, `${s.z2mBaseTopic}/#`];
    this.collecting = true;
    await client.subscribeAsync(collect, { qos: 1 });
    await new Promise((r) => setTimeout(r, this.opts.settleMs ?? 300));
    this.collecting = false;
    await client.unsubscribeAsync(collect);
    await client.subscribeAsync(
      [`${s.discoveryPrefix}/status`, `${s.baseTopic}/+/+/set`, `${s.baseTopic}/+/+/+/set`, `${s.z2mBaseTopic}/+/set`, `${s.z2mBaseTopic}/+/set/+`],
      { qos: 1 },
    );
    this.broadcastStatus();
  }

  /** Estado real de MQTT: las dos conexiones (genérica y Z2M) conectadas ahora mismo. */
  private mqttConnected(): boolean {
    return this.main?.client?.connected === true && this.z2m?.client?.connected === true;
  }

  private setMqttStatus(status: ServiceStatus): void {
    if (this.mqttStatus === status) return;
    this.mqttStatus = status;
    this.broadcastStatus();
  }

  private async reconnectMqtt(): Promise<void> {
    await this.main?.end();
    await this.z2m?.end();
    this.lastPayload.clear();
    this.retained.clear();
    await this.connectMqtt();
  }

  async close(): Promise<void> {
    if (this.trafficTimer) clearInterval(this.trafficTimer);
    if (this.haTimer) clearTimeout(this.haTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    await this.queue.catch(() => undefined);
    await this.main?.end();
    await this.z2m?.end();
    this.mqttStatus = 'disconnected';
  }

  /** Serializa las operaciones de publicación. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch((err: unknown) => {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log(`Error: ${this.lastError}`);
    });
    return next;
  }

  private onMessage(topic: string, payload: string, retain: boolean): void {
    const s = this.settings;
    if (this.collecting) {
      if (!retain || SET_TOPIC.test(topic)) return;
      const ours = topic.startsWith(`${s.discoveryPrefix}/`) ? payload.includes('"HA Simulator"') : true;
      if (ours && payload !== '') this.retained.add(topic);
      return;
    }
    if (topic === `${s.discoveryPrefix}/status`) {
      this.record('in', topic, payload, retain);
      this.onHaStatus(payload.trim());
      return;
    }
    if (!SET_TOPIC.test(topic)) return;
    this.record('in', topic, payload, retain);
    this.onCommand(topic, payload);
  }

  private onHaStatus(status: string): void {
    const online = status === 'online';
    this.haStatus = online ? 'online' : 'offline';
    this.broadcastStatus();
    if (!online) return;
    // HA ha (re)arrancado: vuelve a publicar discovery, disponibilidad y estados, con jitter.
    if (this.haTimer) clearTimeout(this.haTimer);
    const delay = Math.floor(Math.random() * (this.opts.haStatusJitterMs ?? 2000));
    this.haTimer = setTimeout(() => void this.enqueue(() => this.publishAll(true)), delay);
  }

  private onCommand(topic: string, payload: string): void {
    const commands = this.parser?.parse(topic, payload);
    if (!commands || commands.length === 0) return;
    const deviceId = this.parser?.deviceOf(topic);
    if (deviceId !== undefined && this.nodes.get(deviceId) !== 'running') {
      this.log(`Comando ignorado: el nodo ${deviceId} está parado`);
      return;
    }
    const app = this.controller;
    if (!app) {
      this.lastError = 'Comando de HA sin app conectada';
      return;
    }
    for (const c of commands) {
      app.send(this.wrap({ type: 'command', id: `c${++this.commandSeq}`, entityId: c.entityId, service: c.service, data: c.data, topic }));
    }
  }

  // ---------- Publicación ----------

  private async publish(msg: MqttMessage, force = false): Promise<void> {
    const link = msg.topic.startsWith(`${this.settings.z2mBaseTopic}/`) ? this.z2m : this.main;
    if (!link) return;
    if (!force && this.lastPayload.get(msg.topic) === msg.payload) return;
    await link.publish(msg.topic, msg.payload, msg.retain);
    this.lastPayload.set(msg.topic, msg.payload);
    if (msg.retain) {
      if (msg.payload === '') this.retained.delete(msg.topic);
      else this.retained.add(msg.topic);
    }
    this.record('out', msg.topic, msg.payload, msg.retain);
  }

  private running(deviceId: Id): boolean {
    return this.nodes.get(deviceId) === 'running';
  }

  private stoppedSet(): Set<Id> {
    return new Set([...this.nodes].filter(([, s]) => s !== 'running').map(([id]) => id));
  }

  /** Retenidos que deben existir (mismo camino que prueban los tests de src/bridge/mqtt). */
  private desired(model: BridgeModel): MqttMessage[] {
    return desiredRetained(model, this.effectiveAvailability(), this.stoppedSet());
  }

  private effectiveAvailability(): BridgeAvailability {
    return { ...this.availability, live: this.availability.live && this.controller !== undefined };
  }

  /** Limpia los retenidos obsoletos (dispositivos borrados) con un payload vacío. */
  private async clearStale(desired: MqttMessage[]): Promise<void> {
    const keep = new Set(desired.map((m) => m.topic));
    for (const topic of [...this.retained]) {
      if (keep.has(topic)) continue;
      await this.publish({ topic, payload: '', retain: true }, true);
      this.lastPayload.delete(topic);
    }
  }

  /** Reconciliación completa: obsoletos, discovery, disponibilidad y estados. */
  private async publishAll(force = false): Promise<void> {
    const model = this.model;
    if (!model || !this.main?.client) return;
    const desired = this.desired(model);
    await this.clearStale(desired);
    for (const m of desired) await this.publish(m, force);
    await this.publishStates(force);
  }

  private async publishAvailability(): Promise<void> {
    if (!this.model) return;
    for (const m of availabilityMessages(this.model, this.effectiveAvailability(), this.stoppedSet())) await this.publish(m);
  }

  private async publishStates(force = false): Promise<void> {
    const model = this.model;
    if (!model) return;
    for (const bdev of model.devices) {
      if (!this.running(bdev.device.id)) continue;
      for (const m of deviceStateMessages(model, bdev, this.entities)) await this.publish(m, force);
    }
  }

  // ---------- Conexiones de la app ----------

  private wrap(msg: Outgoing): ServerMessage {
    return { v: 1, ...msg } as ServerMessage;
  }

  private hello(conn: AppConnection): void {
    conn.send(this.wrap({ type: 'hello', server: 'hasim-orchestrator', version: ORCHESTRATOR_VERSION, protocol: 1, readOnly: conn !== this.controller }));
  }

  /**
   * Conecta una app ya autenticada (el servidor comprobó el token). La primera controla el lab;
   * las siguientes quedan en solo lectura (estado y tráfico) hasta que la que controla se vaya.
   */
  attach(conn: AppConnection): void {
    this.apps.add(conn);
    if (!this.controller) this.controller = conn;
    this.hello(conn);
    conn.send(this.statusMessage());
  }

  detach(conn: AppConnection): void {
    this.apps.delete(conn);
    if (this.controller !== conn) return;
    this.controller = undefined;
    // La siguiente app pasa a controlar; hasta que mande su proyecto, todo queda no disponible.
    const next = this.apps.values().next();
    if (!next.done) {
      this.controller = next.value;
      this.hello(next.value);
    }
    // Sin app al mando no hay mundo físico: todo pasa a no disponible.
    void this.enqueue(() => this.publishAvailability());
  }

  /** ¿Controla esta conexión el lab? (tests y /health). */
  isController(conn: AppConnection): boolean {
    return this.controller === conn;
  }

  statusMessage(): StatusMessage {
    const transports: Partial<Record<DeviceTransport, TransportStatus>> = {};
    for (const d of this.model?.devices ?? []) {
      const t = transports[d.transport] ?? { devices: 0, status: PENDING_TRANSPORTS[d.transport] ? 'pending' : 'active' };
      t.devices += 1;
      transports[d.transport] = t;
    }
    return {
      v: 1,
      type: 'status',
      mqtt: this.mqttStatus,
      ha: this.haStatus,
      transports,
      nodes: Object.fromEntries(this.nodes),
      snapshots: this.snapshotList,
      capabilities: this.capabilities,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private broadcastStatus(): void {
    const status = this.statusMessage();
    for (const a of this.apps) a.send(status);
  }

  /** Atiende un mensaje de la app. */
  async handle(conn: AppConnection, msg: ClientMessage): Promise<void> {
    if (CONTROL_TYPES.has(msg.type) && conn !== this.controller && !(msg.type === 'lab' && msg.action === 'list_snapshots')) {
      conn.send(this.wrap({ type: 'error', code: 'readonly', message: 'Solo lectura: otra app controla el laboratorio' }));
      return;
    }
    switch (msg.type) {
      case 'hello':
        return;
      case 'project':
        try {
          await this.onProject(msg);
        } catch (err) {
          // Proyecto o ajustes no válidos: no se aplica nada.
          const message = err instanceof Error ? err.message : String(err);
          conn.send(this.wrap({ type: 'error', code: 'invalid', message: `Proyecto rechazado: ${message}` }));
        }
        return;
      case 'goodbye':
        await this.retireAutomations('la app ha desactivado el laboratorio');
        return;
      case 'state':
        await this.onState(msg);
        return;
      case 'node':
        await this.onNode(msg.action, msg.deviceIds);
        return;
      case 'lab':
        await this.onLab(conn, msg.action, msg.requestId, msg.name, msg.id, msg.excludeCredentials === true);
        return;
      case 'traffic':
        conn.traffic = msg.subscribe;
        if (msg.subscribe) conn.send(this.wrap({ type: 'traffic', entries: [...this.traffic] }));
        return;
      case 'command_result':
        if (!msg.ok) this.log(`La app no pudo aplicar ${msg.id}: ${msg.error ?? ''}`);
        return;
      default:
        return;
    }
  }

  /**
   * Proyecto completo o parche. Todo se valida antes de aplicar nada: el proyecto (resultado de
   * aplicar el parche) con parseProject, los ajustes con parseHaBridge (un topic con # o + no es
   * válido) y las definiciones con parseDefinition. Si algo falla se lanza y no cambia nada.
   */
  private async onProject(msg: Extract<ClientMessage, { type: 'project' }>): Promise<void> {
    let candidate: unknown;
    let incomingDefs: unknown[] | undefined;
    if (msg.mode === 'full') {
      candidate = msg.project;
      incomingDefs = msg.definitions;
    } else {
      if (!this.project) throw new Error('Parche de proyecto antes del proyecto completo');
      candidate = { ...this.project, ...msg.changes };
      incomingDefs = msg.definitions;
    }
    const project = parseProject(JSON.parse(JSON.stringify(candidate)) as unknown);
    const rawSettings = msg.mode === 'full' ? msg.settings : msg.settings;
    const nextSettings = rawSettings === undefined ? this.settings : parseHaBridge(rawSettings, 'settings');
    let defs = this.defs;
    if (incomingDefs) {
      const parsed = incomingDefs.map((d, i) => parseDefinition(d, i));
      if (msg.mode === 'full') defs = parsed;
      else {
        const byId = new Map(this.defs.map((d) => [d.id, d]));
        for (const d of parsed) byId.set(d.id, d);
        defs = [...byId.values()];
      }
    }
    // Validado: se aplica.
    this.project = project;
    this.defs = defs;
    const prevSettings = this.settings;
    const topicsChanged =
      nextSettings.baseTopic !== prevSettings.baseTopic ||
      nextSettings.z2mBaseTopic !== prevSettings.z2mBaseTopic ||
      nextSettings.discoveryPrefix !== prevSettings.discoveryPrefix;
    this.settings = { ...nextSettings };
    if (topicsChanged && this.main) await this.enqueue(() => this.reconnectMqtt());
    this.model = buildBridgeModel(project, this.defs, this.settings);
    this.parser = createCommandParser(this.model);
    // Nodos: los nuevos arrancan (autostart) o quedan parados; se olvidan los borrados.
    const ids = new Set(this.model.devices.map((d) => d.device.id));
    for (const id of [...this.nodes.keys()]) if (!ids.has(id)) this.nodes.delete(id);
    for (const id of ids) if (!this.nodes.has(id)) this.nodes.set(id, this.opts.autostart === false ? 'stopped' : 'running');
    await this.enqueue(() => this.publishAll());
    this.broadcastStatus();
    if (this.settings.automationsRunIn === 'home_assistant') this.scheduleSync();
    else await this.retireAutomations('las automatizaciones vuelven al simulador');
  }

  private async onState(msg: Extract<ClientMessage, { type: 'state' }>): Promise<void> {
    this.entities = msg.full ? { ...msg.entities } : { ...this.entities, ...msg.entities };
    for (const id of msg.removed ?? []) delete this.entities[id];
    if (msg.availability) this.availability = msg.availability;
    await this.enqueue(async () => {
      await this.publishAvailability();
      await this.publishStates();
    });
  }

  /** Arranca o para nodos: parar = availability offline y dejar de publicar; arrancar = discovery y estado. */
  async onNode(action: 'start' | 'stop', which: Id[] | 'all'): Promise<void> {
    const model = this.model;
    if (!model) return;
    const ids = which === 'all' ? model.devices.map((d) => d.device.id) : which.filter((id) => this.nodes.has(id));
    if (action === 'stop') {
      for (const id of ids) this.nodes.set(id, 'stopped');
      await this.enqueue(() => this.publishAvailability());
      this.broadcastStatus();
      return;
    }
    for (const id of ids) this.nodes.set(id, 'starting');
    this.broadcastStatus();
    await this.enqueue(async () => {
      for (const id of ids) {
        const bdev = model.devices.find((d) => d.device.id === id);
        if (!bdev) continue;
        try {
          for (const m of deviceDiscovery(model, bdev)) await this.publish(m, true);
          this.nodes.set(id, 'running');
          for (const m of deviceStateMessages(model, bdev, this.entities)) await this.publish(m, true);
        } catch (err) {
          this.nodes.set(id, 'error');
          this.lastError = err instanceof Error ? err.message : String(err);
        }
      }
      await this.publishAvailability();
    });
    this.broadcastStatus();
  }

  private async onLab(conn: AppConnection, action: LabAction, requestId: string, name?: string, id?: string, excludeCredentials = false): Promise<void> {
    const reply = (ok: boolean, message: string, extra: { project?: Project } = {}): void => {
      conn.send(this.wrap({ type: 'lab_result', requestId, action, ok, message, snapshots: this.snapshotList, ...extra }));
    };
    try {
      switch (action) {
        case 'reset': {
          await this.enqueue(async () => {
            for (const topic of [...this.retained]) await this.publish({ topic, payload: '', retain: true }, true);
            this.retained.clear();
            this.lastPayload.clear();
            for (const key of this.nodes.keys()) this.nodes.set(key, this.opts.autostart === false ? 'stopped' : 'running');
            await this.publishAll(true);
          });
          this.broadcastStatus();
          reply(true, 'Laboratorio reiniciado: retenidos borrados y discovery publicado de nuevo. La app vuelve a los estados iniciales.');
          return;
        }
        case 'snapshot': {
          const store = this.requireSnapshots();
          const info = await store.create(name ?? 'Snapshot', this.project, { excludeCredentials });
          this.snapshotList = await store.list();
          this.broadcastStatus();
          reply(true, `Snapshot «${info.name}» guardado (${Math.round(info.bytes / 1024)} KB de ha-config)`);
          return;
        }
        case 'restore': {
          const store = this.requireSnapshots();
          if (!id) throw new Error('Falta el id del snapshot');
          await store.check(id);
          // Restaurar exige parar HA antes de copiar (si no, al apagarse reescribe .storage encima
          // de lo restaurado). Sin control de Docker (perfil opcional) no se restaura.
          const docker = this.capabilities.docker ? this.opts.containers : undefined;
          if (!docker) throw new Error('Restaurar necesita el perfil con Docker (emulator/scripts/setup.sh --docker): el orquestador debe parar Home Assistant antes de copiar la configuración.');
          const container = this.opts.haContainer ?? 'hasim-homeassistant';
          let project: Project | undefined;
          await docker.stop(container);
          try {
            project = await store.restore(id);
          } finally {
            // HA vuelve a arrancar aunque la copia falle.
            await docker.start(container);
          }
          reply(true, 'Snapshot restaurado. Home Assistant se ha reiniciado con la configuración del snapshot.', project ? { project } : {});
          return;
        }
        case 'list_snapshots': {
          const store = this.requireSnapshots();
          this.snapshotList = await store.list();
          reply(true, `${this.snapshotList.length} snapshots`);
          return;
        }
        case 'delete_snapshot': {
          const store = this.requireSnapshots();
          if (!id) throw new Error('Falta el id del snapshot');
          await store.remove(id);
          this.snapshotList = await store.list();
          this.broadcastStatus();
          reply(true, 'Snapshot borrado');
          return;
        }
        default:
          reply(false, `Acción desconocida: ${String(action)}`);
      }
    } catch (err) {
      reply(false, err instanceof Error ? err.message : String(err));
    }
  }

  private requireSnapshots(): SnapshotStore {
    if (!this.opts.snapshots) throw new Error('Este orquestador no tiene acceso a ha-config (snapshots no disponibles)');
    return this.opts.snapshots;
  }

  // ---------- Automatizaciones en HA ----------

  private scheduleSync(): void {
    const project = this.project;
    if (!project || !this.opts.sync || this.settings.automationsRunIn !== 'home_assistant') return;
    const extra = project as unknown as Record<string, unknown>;
    const key = JSON.stringify([
      project.automations,
      project.scenes,
      project.scripts,
      project.groups,
      project.people,
      project.zones,
      project.rooms.map((r) => [r.id, r.name]),
      project.devices.map((d) => [d.id, d.name, d.roomId, d.definitionId, d.showAs]),
      extra.helpers,
    ]);
    if (key === this.syncKey) return;
    this.syncKey = key;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const sync = this.opts.sync;
    this.syncTimer = setTimeout(() => {
      sync(project, this.defs)
        .then((m) => this.log(m))
        .catch((err: unknown) => {
          this.lastError = `Sincronización con HA: ${err instanceof Error ? err.message : String(err)}`;
          this.broadcastStatus();
        });
    }, this.opts.syncDebounceMs ?? 1500);
  }

  /**
   * Automatizaciones de vuelta al simulador (automationsRunIn: simulator o lab desactivado):
   * borra packages/hasim y recarga HA. `unsync` no hace nada (undefined) si no hay packages.
   */
  private async retireAutomations(reason: string): Promise<void> {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    this.syncKey = '';
    if (!this.opts.unsync) return;
    try {
      const done = await this.opts.unsync();
      if (done !== undefined) this.log(`${done} (${reason})`);
    } catch (err) {
      this.lastError = `Retirar las automatizaciones de HA: ${err instanceof Error ? err.message : String(err)}`;
      this.broadcastStatus();
    }
  }

  // ---------- Inspector de tráfico ----------

  private record(dir: 'in' | 'out', topic: string, payload: string, retain: boolean): void {
    const deviceId = this.parser?.deviceOf(topic);
    const entry: TrafficEntry = { seq: ++this.seq, t: Date.now(), dir, topic, payload: trafficPayload(payload), retain, ...(deviceId ? { deviceId } : {}) };
    const limit = this.opts.trafficLimit ?? 2000;
    this.traffic.push(entry);
    if (this.traffic.length > limit) this.traffic.splice(0, this.traffic.length - limit);
    if ([...this.apps].some((a) => a.traffic)) this.trafficPending.push(entry);
  }

  private flushTraffic(): void {
    if (this.trafficPending.length === 0) return;
    const entries = this.trafficPending;
    this.trafficPending = [];
    for (const a of this.apps) if (a.traffic) a.send(this.wrap({ type: 'traffic', entries }));
  }

  /** Para el endpoint /health y los tests. */
  health(): Record<string, unknown> {
    const mqttOk = this.mqttConnected();
    return {
      ok: mqttOk,
      version: ORCHESTRATOR_VERSION,
      mqtt: mqttOk ? 'connected' : this.mqttStatus === 'connected' ? 'disconnected' : this.mqttStatus,
      ha: this.haStatus,
      apps: this.apps.size,
      controller: this.controller !== undefined,
      devices: this.model?.devices.length ?? 0,
      nodes: Object.fromEntries(this.nodes),
    };
  }

  currentProject(): Project | undefined {
    return this.project;
  }

  currentDefinitions(): DeviceDefinition[] {
    return this.defs;
  }

  /** Espera a que terminen las publicaciones en curso (tests). */
  async idle(): Promise<void> {
    await this.queue.catch(() => undefined);
  }
}
