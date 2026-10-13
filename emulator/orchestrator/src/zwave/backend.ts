// Vía Z-Wave real (perfil «zwave»): el orquestador manda al servicio zwave-mock la red que sale del
// proyecto (un nodo mock por dispositivo Z-Wave, con sus command classes) y los valores del
// simulador; recibe los Set de HA (por Z-Wave JS UI) y se los pasa a la app como `command`. Con el
// servidor de Z-Wave JS (puerto 3000) sabe si Z-Wave JS UI está conectado y el estado de los nodos.
import WebSocket from 'ws';
import type { Id } from '../../../../src/types';
import { LAB_HOME_ID, buildZwavePlan, zwaveCommandToService, zwaveNodeValues, type ZwaveNetworkPlan, type ZwaveNodePlan, type ZwaveValueKey } from '../../../../src/bridge/zwave/plan';
import type { NativeStatus } from '../../../../src/bridge/protocol';
import type { NativeBackend, NativeContext, NativeEvents } from '../native';
import { zwaveUniqueIdMatcher, type AlignTarget } from '../haNative';
import type { ContainerControl } from '../docker';
import { parseFromMock, type FromMock, type MockState, type ToMock } from './protocol';
import { ZjsClient } from './zjs';

/** Canal con el servicio zwave-mock (WebSocket en producción, en memoria en los tests). */
export interface MockLink {
  connect(handlers: { message: (msg: FromMock) => void; open: () => void; close: () => void }): void;
  send(msg: ToMock): void;
  readonly connected: boolean;
  close(): void;
}

/** WebSocket de control del servicio zwave-mock, con reconexión y el token del laboratorio. */
export function wsMockLink(url: string, token: string, retryMs = 3000): MockLink {
  let ws: WebSocket | undefined;
  let ready = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    get connected() {
      return ready;
    },
    connect(handlers) {
      const open = (): void => {
        if (closed) return;
        const socket = new WebSocket(url);
        ws = socket;
        socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', token } satisfies ToMock)));
        socket.on('message', (raw) => {
          const msg = parseFromMock(String(raw));
          if (!msg) return;
          if (msg.type === 'ready') {
            ready = true;
            handlers.open();
          }
          handlers.message(msg);
        });
        socket.on('error', () => undefined);
        socket.on('close', () => {
          if (ws !== socket) return;
          const was = ready;
          ready = false;
          ws = undefined;
          if (was) handlers.close();
          if (!closed) {
            timer = setTimeout(open, retryMs);
            timer.unref?.();
          }
        });
      };
      open();
    },
    send(msg) {
      if (ready && ws?.readyState === ws?.OPEN) ws?.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.terminate();
      ws = undefined;
      ready = false;
    },
  };
}

/** CC, propiedad y clave de cada valor (para el unique_id de las entidades de zwave_js en HA). */
const VALUE_IDS: Record<ZwaveValueKey, { cc: number; property: string; propertyKey?: string | number }> = {
  binarySwitch: { cc: 37, property: 'currentValue' },
  multilevelSwitch: { cc: 38, property: 'currentValue' },
  meterKwh: { cc: 50, property: 'value', propertyKey: 65537 },
  meterW: { cc: 50, property: 'value', propertyKey: 66049 },
  temperature: { cc: 49, property: 'Air temperature' },
  humidity: { cc: 49, property: 'Humidity' },
  illuminance: { cc: 49, property: 'Illuminance' },
  motion: { cc: 113, property: 'Home Security', propertyKey: 'Motion sensor status' },
  door: { cc: 113, property: 'Access Control', propertyKey: 'Door state' },
  water: { cc: 113, property: 'Water Alarm', propertyKey: 'Sensor status' },
  smoke: { cc: 113, property: 'Smoke Alarm', propertyKey: 'Sensor status' },
  binarySensor: { cc: 48, property: 'General Purpose' },
  locked: { cc: 98, property: 'currentMode' },
  battery: { cc: 128, property: 'level' },
};

export interface ZwaveBackendOptions {
  link: MockLink;
  /** Servidor de Z-Wave JS (Z-Wave JS UI): ws://127.0.0.1:3000. Sin él, no hay estado de los nodos. */
  zjsUrl?: string;
  /** Interfaz web de Z-Wave JS UI para el panel de la app. */
  uiUrl?: string;
  homeId?: number;
  wakeUpSeconds?: number;
  /** Con Docker: si Z-Wave JS UI no vuelve a conectarse a la antena tras un cambio de red, se reinicia. */
  containers?: ContainerControl;
  uiContainer?: string;
  watchdogMs?: number;
  /** Ping a un nodo recién parado (para que Z-Wave JS lo marque dead enseguida). */
  pingDelayMs?: number;
}

export class ZwaveBackend implements NativeBackend {
  readonly transport = 'zwave_js' as const;
  private events: NativeEvents | undefined;
  private plan: ZwaveNetworkPlan = { nodes: [] };
  private readonly byNode = new Map<number, ZwaveNodePlan>();
  private lastState = '';
  private desired: MockState | undefined;
  private down = new Set<number>();
  private mock: { client: boolean; listening: boolean } = { client: false, listening: false };
  private readonly zjs: ZjsClient | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private noClientSince: number | undefined;
  private lastRestart = 0;
  private controllerDown = false;

  constructor(private readonly opts: ZwaveBackendOptions) {
    this.zjs = opts.zjsUrl ? new ZjsClient(opts.zjsUrl, { onChange: () => this.events?.changed() }) : undefined;
  }

  private get homeId(): number {
    return this.opts.homeId ?? LAB_HOME_ID;
  }

  private log(msg: string): void {
    this.events?.log(`[zwave] ${msg}`);
  }

  async start(events: NativeEvents): Promise<void> {
    this.events = events;
    this.opts.link.connect({
      open: () => {
        this.lastState = '';
        this.flush();
        events.changed();
      },
      close: () => events.changed(),
      message: (msg) => this.onMock(msg),
    });
    this.zjs?.start();
    this.watchdog = setInterval(() => void this.checkUi(), 10_000);
    this.watchdog.unref?.();
  }

  private onMock(msg: FromMock): void {
    const events = this.events;
    if (!events) return;
    switch (msg.type) {
      case 'status':
        this.mock = { client: msg.client, listening: msg.listening };
        events.changed();
        return;
      case 'command': {
        const node = this.byNode.get(msg.nodeId);
        if (!node) return;
        const svc = zwaveCommandToService(node, msg.command);
        if (svc) events.command(node.deviceId, svc, `zwave/nodo ${msg.nodeId}`);
        return;
      }
      case 'frame': {
        const node = this.byNode.get(msg.nodeId);
        events.traffic({ dir: msg.dir, topic: `zwave/nodo ${msg.nodeId}`, payload: msg.summary, ...(node ? { deviceId: node.deviceId } : {}), via: 'zwave' });
        return;
      }
      case 'error':
        this.log(`zwave-mock: ${msg.message}`);
        return;
      default:
        return;
    }
  }

  async sync(ctx: NativeContext): Promise<void> {
    const full = buildZwavePlan(ctx.project, ctx.defs);
    const nodes = full.nodes.filter((n) => ctx.devices.has(n.deviceId));
    this.plan = { ...(full.controllerDeviceId && ctx.devices.has(full.controllerDeviceId) ? { controllerDeviceId: full.controllerDeviceId } : {}), nodes };
    this.byNode.clear();
    for (const n of nodes) this.byNode.set(n.nodeId, n);
    const down = nodes.filter((n) => !ctx.live || ctx.down.has(n.deviceId)).map((n) => n.nodeId);
    const controllerDown = this.plan.controllerDeviceId !== undefined && ctx.down.has(this.plan.controllerDeviceId);
    const values: MockState['values'] = {};
    for (const n of nodes) values[n.nodeId] = zwaveNodeValues(n, ctx.entities);
    this.desired = {
      config: {
        homeId: this.homeId,
        wakeUpSeconds: this.opts.wakeUpSeconds ?? 120,
        nodes: nodes.map((n) => ({
          nodeId: n.nodeId,
          name: n.name,
          ...(n.location !== undefined ? { location: n.location } : {}),
          listening: n.listening,
          genericDeviceClass: n.genericDeviceClass,
          specificDeviceClass: n.specificDeviceClass,
          ...(n.multilevelAs ? { multilevelAs: n.multilevelAs } : {}),
          ccs: n.ccs,
          values: n.bindings.map((b) => b.value),
        })),
      },
      values,
      down,
      controllerUp: !controllerDown,
    };
    const newlyDown = down.filter((id) => !this.down.has(id));
    this.down = new Set(down);
    if (controllerDown !== this.controllerDown) {
      this.controllerDown = controllerDown;
      this.log(controllerDown ? 'controlador parado: Z-Wave JS UI pierde la antena' : 'controlador en marcha');
    }
    this.flush();
    // Un nodo parado no se da por muerto hasta que alguien le habla: un ping lo hace enseguida.
    if (newlyDown.length > 0 && this.zjs) {
      const t = setTimeout(() => {
        for (const id of newlyDown) {
          if (!this.down.has(id)) continue;
          const node = this.byNode.get(id);
          if (node?.listening) void this.zjs?.ping(id);
        }
      }, this.opts.pingDelayMs ?? 500);
      t.unref?.();
    }
    this.events?.changed();
  }

  private flush(): void {
    if (!this.desired || !this.opts.link.connected) return;
    const text = JSON.stringify(this.desired);
    if (text === this.lastState) return;
    this.lastState = text;
    this.opts.link.send({ type: 'state', state: this.desired });
  }

  /** Vigilancia: Z-Wave JS UI debe volver a conectarse a la antena tras un cambio de red. */
  private async checkUi(): Promise<void> {
    if (!this.opts.link.connected || !this.mock.listening || this.mock.client) {
      this.noClientSince = undefined;
      return;
    }
    const now = Date.now();
    this.noClientSince ??= now;
    const limit = this.opts.watchdogMs ?? 60_000;
    const containers = this.opts.containers;
    if (now - this.noClientSince < limit || !containers || now - this.lastRestart < 5 * limit) return;
    if (!(await containers.available())) return;
    this.lastRestart = now;
    const name = this.opts.uiContainer ?? 'hasim-zwave-js-ui';
    this.log(`Z-Wave JS UI lleva ${Math.round(limit / 1000)} s sin conectarse a la antena: se reinicia ${name}`);
    await containers.stop(name).catch(() => undefined);
    await containers.start(name).catch((err: unknown) => this.log(`no se pudo arrancar ${name}: ${String(err)}`));
  }

  alignTargets(): AlignTarget[] {
    const homeId = this.zjs?.homeId ?? this.homeId;
    const out: AlignTarget[] = [];
    for (const n of this.plan.nodes) {
      for (const b of n.bindings) {
        const v = VALUE_IDS[b.value];
        out.push({ platform: 'zwave_js', entityId: b.entityId, match: zwaveUniqueIdMatcher(homeId, n.nodeId, v.cc, v.property, v.propertyKey) });
      }
    }
    return out;
  }

  status(): NativeStatus {
    const nodes: NativeStatus['nodes'] = {};
    const zjsUp = this.zjs?.state === 'connected';
    for (const n of this.plan.nodes) {
      const zn = this.zjs?.nodes.get(n.nodeId);
      if (this.down.has(n.nodeId) || this.controllerDown) nodes[n.deviceId] = { state: 'stopped', detail: `nodo ${n.nodeId} · ${zn?.status === 'dead' ? 'dead en Z-Wave JS' : 'no responde'}` };
      else if (zn?.status === 'dead') nodes[n.deviceId] = { state: 'error', detail: `nodo ${n.nodeId} · dead en Z-Wave JS` };
      else if (zn?.ready) nodes[n.deviceId] = { state: 'running', detail: `nodo ${n.nodeId} · ${zn.status === 'asleep' ? 'dormido (a pilas)' : 'listo'}` };
      else nodes[n.deviceId] = { state: 'starting', detail: `nodo ${n.nodeId} · ${zjsUp ? 'entrevista en curso' : 'esperando a Z-Wave JS UI'}` };
    }
    if (this.plan.controllerDeviceId) nodes[this.plan.controllerDeviceId] = this.controllerDown ? { state: 'stopped', detail: 'antena parada' } : { state: 'running', detail: `controlador mock · homeId 0x${this.homeId.toString(16)}` };
    const url = this.opts.uiUrl ? { url: this.opts.uiUrl } : {};
    if (!this.opts.link.connected) return { state: 'connecting', detail: 'Esperando al servicio zwave-mock (127.0.0.1:5556)', nodes, ...url };
    if (this.controllerDown) return { state: 'error', detail: 'Controlador Z-Wave parado (fallo de la antena): todos los nodos no disponibles', nodes, ...url };
    if (!this.mock.client) return { state: 'connecting', detail: 'Mock en marcha; Z-Wave JS UI todavía no se ha conectado a la antena', nodes, ...url };
    if (this.zjs && !zjsUp) return { state: 'connecting', detail: 'Z-Wave JS UI conectado a la antena; esperando a su servidor (puerto 3000)', nodes, ...url };
    return { state: 'connected', detail: `Z-Wave JS UI conectado · ${this.plan.nodes.length} nodos`, nodes, ...url };
  }

  /** Nodos de la red (tests). */
  network(): ZwaveNetworkPlan {
    return this.plan;
  }

  isNative(id: Id): boolean {
    return this.plan.nodes.some((n) => n.deviceId === id) || this.plan.controllerDeviceId === id;
  }

  async close(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    this.zjs?.close();
    this.opts.link.close();
  }
}
