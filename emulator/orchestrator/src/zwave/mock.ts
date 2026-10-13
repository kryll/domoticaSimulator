// Controlador Z-Wave mock (paquete zwave-js/@zwave-js/testing, software libre): un puerto serie
// emulado expuesto por TCP al que se conecta Z-Wave JS UI (tcp://zwave-mock:5555) como si fuera una
// antena USB. Cada dispositivo Z-Wave del proyecto es un MockNode con sus command classes reales.
//
// - Los valores que manda el orquestador (estado del simulador) se guardan y, si cambian, el nodo
//   manda un informe no solicitado (unsolicited report) al controlador → Z-Wave JS → HA.
// - Los Set que llegan del controlador (HA → Z-Wave JS) se avisan con onCommand; el orquestador los
//   reenvía a la app como `command`.
// - Nodo parado: deja de confirmar (sin ACK) y de responder; Z-Wave JS lo marca dead.
// - Controlador parado: se cierra el puerto TCP; Z-Wave JS UI pierde la antena.
import { createServer, type Server, type Socket } from 'node:net';
import {
  BatteryCCGet,
  BatteryCCReport,
  BinarySensorCCReport,
  BinarySwitchCCGet,
  BinarySwitchCCReport,
  BinarySwitchCCSet,
  DoorLockCCOperationGet,
  DoorLockCCOperationReport,
  DoorLockCCOperationSet,
  DoorLockMode,
  DoorLockOperationType,
  MeterCCReport,
  MultilevelSensorCCReport,
  MultilevelSwitchCCGet,
  MultilevelSwitchCCReport,
  MultilevelSwitchCCSet,
  MultilevelSwitchCCStartLevelChange,
  MultilevelSwitchCCStopLevelChange,
  NotificationCCGet,
  NotificationCCReport,
  RateType,
  SwitchType,
  WakeUpCCIntervalCapabilitiesGet,
  WakeUpCCIntervalCapabilitiesReport,
  WakeUpCCIntervalGet,
  WakeUpCCIntervalReport,
  WakeUpCCIntervalSet,
  WakeUpCCNoMoreInformation,
  WakeUpCCWakeUpNotification,
  type CommandClass,
} from '@zwave-js/cc';
import { CommandClasses } from '@zwave-js/core';
import { Faucet, ZWaveSerialFrameType, type ZWaveSerialFrame } from '@zwave-js/serial';
import { createAndOpenMockedZWaveSerialPort } from '@zwave-js/serial/mock';
import { MockController, MockNode, createMockZWaveRequestFrame, type MockNodeBehavior, type PartialCCCapabilities } from '@zwave-js/testing';
import { createDefaultMockControllerBehaviors, createDefaultMockNodeBehaviors } from 'zwave-js/Testing';
import type { ZwaveCommand, ZwaveNodeValues, ZwaveValueKey } from '../../../../src/bridge/zwave/plan';
import type { MockConfig, MockNodeConfig, MockState } from './protocol';

export interface ZwaveMockOptions {
  port: number;
  host?: string;
  onCommand: (nodeId: number, command: ZwaveCommand) => void;
  /** Resumen de cada trama para el inspector de tráfico. */
  onFrame?: (dir: 'in' | 'out', nodeId: number, summary: string) => void;
  onStatus?: (status: { client: boolean; listening: boolean; nodes: number }) => void;
  log?: (msg: string) => void;
  /**
   * Al cambiar la red con un driver conectado, el puerto queda cerrado este tiempo (ms): zwave-js
   * agota sus reintentos de reabrirlo (unos 11 s), falla, y Z-Wave JS UI lo reinicia desde cero y
   * lee la lista de nodos nueva. Si se reabriera enseguida, el driver seguiría con la red vieja.
   */
  reinitDelayMs?: number;
}

/** Tipos de notificación y eventos (especificación Z-Wave). */
const NOTIFICATIONS: Partial<Record<ZwaveValueKey, { type: number; on: number; off: number }>> = {
  smoke: { type: 0x01, on: 0x02, off: 0x00 },
  water: { type: 0x05, on: 0x02, off: 0x00 },
  door: { type: 0x06, on: 0x16, off: 0x17 },
  motion: { type: 0x07, on: 0x08, off: 0x00 },
};

/** Multilevel Sensor: tipo y escala (temperatura °C, luminancia lux, humedad %). */
const SENSORS: Partial<Record<ZwaveValueKey, { type: number; scale: number }>> = {
  temperature: { type: 0x01, scale: 0 },
  illuminance: { type: 0x03, scale: 1 },
  humidity: { type: 0x05, scale: 0 },
};

const METER_ELECTRIC = 0x01;
const METER_SCALE = { meterKwh: 0, meterW: 2 } as const;
const BINARY_SENSOR_GENERAL = 0x01;
const HANDLES: [boolean, boolean, boolean, boolean] = [true, true, true, true];

const CC_IDS: Record<string, CommandClasses> = {
  'Binary Switch': CommandClasses['Binary Switch'],
  'Multilevel Switch': CommandClasses['Multilevel Switch'],
  Meter: CommandClasses.Meter,
  'Multilevel Sensor': CommandClasses['Multilevel Sensor'],
  Notification: CommandClasses.Notification,
  'Binary Sensor': CommandClasses['Binary Sensor'],
  'Door Lock': CommandClasses['Door Lock'],
  Battery: CommandClasses.Battery,
  'Wake Up': CommandClasses['Wake Up'],
};

const CC_VERSIONS: Partial<Record<CommandClasses, number>> = {
  [CommandClasses['Binary Switch']]: 2,
  [CommandClasses['Multilevel Switch']]: 4,
  [CommandClasses.Meter]: 4,
  [CommandClasses['Multilevel Sensor']]: 11,
  [CommandClasses.Notification]: 8,
  [CommandClasses['Binary Sensor']]: 2,
  [CommandClasses['Door Lock']]: 4,
  [CommandClasses.Battery]: 1,
  [CommandClasses['Wake Up']]: 2,
};

function ccName(cc: CommandClass): string {
  return CommandClasses[cc.ccId] ?? `CC ${cc.ccId}`;
}

/** Resumen corto de un CC: «Binary Switch · Set · targetValue=true». */
export function summarizeCC(cc: CommandClass): string {
  const command = cc.constructor.name.replace(/^.*CC/, '') || cc.constructor.name;
  const fields: string[] = [];
  const bag = cc as unknown as Record<string, unknown>;
  for (const k of ['targetValue', 'currentValue', 'value', 'level', 'mode', 'currentMode', 'notificationType', 'notificationEvent', 'type', 'scale', 'wakeUpInterval']) {
    const v = bag[k];
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') fields.push(`${k}=${String(v)}`);
  }
  return `${ccName(cc)} · ${command}${fields.length ? ` · ${fields.join(' ')}` : ''}`;
}

const SOF = 0x01;
const CONTROL_BYTES = new Set([0x06, 0x15, 0x18]); // ACK, NAK, CAN

/** Separa el flujo de bytes del driver en tramas de la API serie (ACK/NAK/CAN o SOF+longitud). */
export function splitSerialFrames(buf: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const b = buf[pos] ?? 0;
    if (CONTROL_BYTES.has(b)) {
      frames.push(buf.subarray(pos, pos + 1));
      pos += 1;
    } else if (b === SOF) {
      if (pos + 1 >= buf.length) break;
      const total = (buf[pos + 1] ?? 0) + 2;
      if (pos + total > buf.length) break;
      frames.push(buf.subarray(pos, pos + total));
      pos += total;
    } else pos += 1; // Basura: se descarta (como hace el driver).
  }
  return { frames, rest: Buffer.from(buf.subarray(pos)) };
}

interface NodeRuntime {
  config: MockNodeConfig;
  node: MockNode;
  values: ZwaveNodeValues;
  down: boolean;
  wakeTimer?: ReturnType<typeof setInterval>;
}

export class ZwaveMockHost {
  private server: Server | undefined;
  private socket: Socket | undefined;
  private faucet: Faucet<ZWaveSerialFrame> | undefined;
  private serialClose: (() => Promise<void>) | undefined;
  private serial: { writeAsync: (data: Uint8Array) => Promise<void> } | undefined;
  private controller: MockController | undefined;
  private readonly nodes = new Map<number, NodeRuntime>();
  private configKey = '';
  private config: MockConfig | undefined;
  private controllerUp = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ZwaveMockOptions) {}

  private log(msg: string): void {
    this.opts.log?.(`[zwave-mock] ${msg}`);
  }

  get clientConnected(): boolean {
    return this.socket !== undefined && !this.socket.destroyed;
  }

  get listening(): boolean {
    return this.server?.listening === true;
  }

  private status(): void {
    this.opts.onStatus?.({ client: this.clientConnected, listening: this.listening, nodes: this.nodes.size });
  }

  /** Aplica el estado deseado (serializado: nunca dos a la vez). */
  apply(state: MockState): Promise<void> {
    const next = this.queue.then(() => this.applyNow(state));
    this.queue = next.catch((err: unknown) => this.log(`error al aplicar el estado: ${err instanceof Error ? err.message : String(err)}`));
    return next;
  }

  private async applyNow(state: MockState): Promise<void> {
    // El nombre y la ubicación no cambian la red: no obligan a reiniciar el driver (se ven en HA
    // en la próxima entrevista).
    const key = JSON.stringify({ ...state.config, nodes: state.config.nodes.map(({ name: _n, location: _l, ...rest }) => rest) });
    if (key !== this.configKey || !this.controller) {
      await this.rebuild(state.config);
      this.configKey = key;
    }
    const down = new Set(state.down);
    for (const rt of this.nodes.values()) {
      const values = state.values[rt.config.nodeId] ?? {};
      const wasDown = rt.down;
      rt.down = down.has(rt.config.nodeId);
      rt.node.autoAckControllerFrames = !rt.down;
      const changed = (Object.keys(values) as ZwaveValueKey[]).filter((k) => values[k] !== rt.values[k]);
      rt.values = { ...values };
      if (rt.down) continue;
      if (wasDown) {
        // Vuelve: informa de todo para que Z-Wave JS lo marque vivo (y despierta si es a pilas).
        await this.report(rt, Object.keys(rt.values) as ZwaveValueKey[]);
        if (!rt.config.listening) await this.wakeUp(rt);
      } else if (changed.length > 0) await this.report(rt, changed);
    }
    if (state.controllerUp !== this.controllerUp) {
      this.controllerUp = state.controllerUp;
      if (state.controllerUp) await this.listen();
      else await this.closeTcp();
    }
    this.status();
  }

  private async rebuild(config: MockConfig): Promise<void> {
    const wasUp = this.listening;
    const hadDriver = this.clientConnected;
    await this.teardown();
    this.config = config;
    const { serial, port } = await createAndOpenMockedZWaveSerialPort();
    this.serial = serial;
    this.serialClose = async () => {
      await serial.close();
      port.destroy();
    };
    const controller = await MockController.create({ homeId: config.homeId, ownNodeId: 1, mockPort: port, serial });
    controller.defineBehavior(...createDefaultMockControllerBehaviors());
    this.controller = controller;
    this.faucet = new Faucet(serial.readable);
    for (const nc of config.nodes) {
      const node = await MockNode.create({ id: nc.nodeId, controller, capabilities: this.capabilities(nc) });
      // Sin Basic: con él, HA crearía una entidad «Basic» de más en los sensores.
      node.removeCC(CommandClasses.Basic);
      controller.addNode(node);
      node.defineBehavior(...createDefaultMockNodeBehaviors());
      const rt: NodeRuntime = { config: nc, node, values: {}, down: false };
      node.defineBehavior(...this.behaviors(rt));
      this.nodes.set(nc.nodeId, rt);
      if (!nc.listening) {
        rt.wakeTimer = setInterval(() => void this.wakeUp(rt), Math.max(10, config.wakeUpSeconds) * 1000);
        rt.wakeTimer.unref?.();
      }
    }
    this.log(`red Z-Wave mock: homeId 0x${config.homeId.toString(16)} con ${config.nodes.length} nodos`);
    if (!wasUp) return;
    const delay = this.opts.reinitDelayMs ?? 20_000;
    if (hadDriver && delay > 0) {
      this.log(`red cambiada: antena desconectada ${Math.round(delay / 1000)} s para que Z-Wave JS UI reinicie el driver con los nodos nuevos`);
      await new Promise((r) => setTimeout(r, delay));
    }
    await this.listen();
  }

  private capabilities(nc: MockNodeConfig): NonNullable<Parameters<typeof MockNode.create>[0]['capabilities']> {
    const ccs: PartialCCCapabilities[] = [
      { ccId: CommandClasses.Version, isSupported: true, version: 3 },
      { ccId: CommandClasses['Manufacturer Specific'], isSupported: true, version: 2 },
      { ccId: CommandClasses['Z-Wave Plus Info'], isSupported: true, version: 2 },
      { ccId: CommandClasses['Node Naming and Location'], isSupported: true, version: 1, name: nc.name.slice(0, 16), ...(nc.location ? { location: nc.location.slice(0, 16) } : {}) },
    ];
    const lookup = (key: ZwaveValueKey): number | boolean | undefined => this.nodes.get(nc.nodeId)?.values[key];
    for (const name of nc.ccs) {
      const ccId = CC_IDS[name];
      if (ccId === undefined) continue;
      const base = { ccId, isSupported: true, version: CC_VERSIONS[ccId] ?? 1 };
      switch (ccId) {
        case CommandClasses['Multilevel Switch']:
          ccs.push({ ...base, primarySwitchType: SwitchType['Down/Up'] });
          break;
        case CommandClasses.Meter: {
          const scales = (['meterKwh', 'meterW'] as const).filter((k) => nc.values.includes(k)).map((k) => METER_SCALE[k]);
          ccs.push({
            ...base,
            meterType: METER_ELECTRIC,
            supportedScales: scales,
            supportedRateTypes: [RateType.Consumed],
            supportsReset: false,
            getValue: (scale: number) => {
              const v = lookup(scale === METER_SCALE.meterW ? 'meterW' : 'meterKwh');
              return typeof v === 'number' ? v : 0;
            },
          });
          break;
        }
        case CommandClasses['Multilevel Sensor']: {
          const sensors: Record<number, { supportedScales: number[] }> = {};
          for (const [k, s] of Object.entries(SENSORS)) if (s && nc.values.includes(k as ZwaveValueKey)) sensors[s.type] = { supportedScales: [s.scale] };
          ccs.push({
            ...base,
            sensors,
            getValue: (type: number | undefined) => {
              const entry = (Object.entries(SENSORS) as Array<[ZwaveValueKey, { type: number; scale: number }]>).find(([, s]) => s.type === type);
              const v = entry ? lookup(entry[0]) : undefined;
              return typeof v === 'number' ? v : 0;
            },
          });
          break;
        }
        case CommandClasses.Notification: {
          const events: Record<number, number[]> = {};
          for (const [k, n] of Object.entries(NOTIFICATIONS)) if (n && nc.values.includes(k as ZwaveValueKey)) events[n.type] = n.off === 0 ? [n.on] : [n.on, n.off];
          ccs.push({ ...base, supportsV1Alarm: false, notificationTypesAndEvents: events });
          break;
        }
        case CommandClasses['Binary Sensor']:
          ccs.push({ ...base, supportedSensorTypes: [BINARY_SENSOR_GENERAL], getValue: () => lookup('binarySensor') === true });
          break;
        case CommandClasses['Door Lock']:
          ccs.push({
            ...base,
            supportedOperationTypes: [DoorLockOperationType.Constant],
            supportedDoorLockModes: [DoorLockMode.Unsecured, DoorLockMode.Secured],
            doorSupported: false,
            boltSupported: true,
            latchSupported: false,
          });
          break;
        default:
          ccs.push(base);
      }
    }
    return {
      isListening: nc.listening,
      isFrequentListening: false,
      isRouting: nc.listening,
      genericDeviceClass: nc.genericDeviceClass,
      specificDeviceClass: nc.specificDeviceClass,
      // Fabricante y producto genéricos: así Z-Wave JS no aplica el fichero de configuración del
      // dispositivo real (que podría esperar parámetros o endpoints que el mock no tiene).
      manufacturerId: 0xffff,
      productType: 0x4853,
      productId: nc.nodeId,
      firmwareVersion: '1.0',
      commandClasses: ccs,
    };
  }

  /** Comportamientos propios del nodo (tienen prioridad sobre los de zwave-js). */
  private behaviors(rt: NodeRuntime): MockNodeBehavior[] {
    const value = (k: ZwaveValueKey): number | boolean | undefined => rt.values[k];
    const command = (c: ZwaveCommand): void => this.opts.onCommand(rt.config.nodeId, c);
    const reply = (cc: CommandClass): { action: 'sendCC'; cc: CommandClass } => ({ action: 'sendCC', cc });
    const handlers: MockNodeBehavior = {
      handleCC: (controller, _self, cc) => {
        const to = controller.ownNodeId;
        if (cc instanceof BinarySwitchCCSet) {
          command({ kind: 'binarySwitch', value: cc.targetValue });
          return { action: 'ok' };
        }
        if (cc instanceof BinarySwitchCCGet) return reply(new BinarySwitchCCReport({ nodeId: to, currentValue: value('binarySwitch') === true }));
        if (cc instanceof MultilevelSwitchCCSet) {
          command({ kind: 'multilevelSwitch', value: cc.targetValue });
          return { action: 'ok' };
        }
        if (cc instanceof MultilevelSwitchCCStartLevelChange) {
          command({ kind: 'multilevelSwitch', value: cc.direction === 'up' ? 99 : 0 });
          return { action: 'ok' };
        }
        if (cc instanceof MultilevelSwitchCCStopLevelChange) return { action: 'ok' };
        if (cc instanceof MultilevelSwitchCCGet) {
          const level = typeof value('multilevelSwitch') === 'number' ? (value('multilevelSwitch') as number) : 0;
          return reply(new MultilevelSwitchCCReport({ nodeId: to, currentValue: level, targetValue: level }));
        }
        if (cc instanceof DoorLockCCOperationSet) {
          command({ kind: 'doorLock', locked: cc.mode !== DoorLockMode.Unsecured });
          return { action: 'ok' };
        }
        if (cc instanceof DoorLockCCOperationGet) return reply(this.doorLockReport(rt, to));
        if (cc instanceof NotificationCCGet) {
          const entry = (Object.entries(NOTIFICATIONS) as Array<[ZwaveValueKey, { type: number; on: number; off: number }]>).find(([, n]) => n.type === cc.notificationType);
          if (!entry) return undefined;
          const [key, n] = entry;
          return reply(new NotificationCCReport({ nodeId: to, notificationType: n.type, notificationEvent: value(key) === true ? n.on : n.off, notificationStatus: 0xff }));
        }
        if (cc instanceof BatteryCCGet) return reply(this.batteryReport(rt, to));
        if (cc instanceof WakeUpCCIntervalGet) return reply(new WakeUpCCIntervalReport({ nodeId: to, wakeUpInterval: this.wakeSeconds(), controllerNodeId: to }));
        if (cc instanceof WakeUpCCIntervalCapabilitiesGet) {
          return reply(
            new WakeUpCCIntervalCapabilitiesReport({ nodeId: to, minWakeUpInterval: 10, maxWakeUpInterval: 86_400, defaultWakeUpInterval: this.wakeSeconds(), wakeUpIntervalSteps: 1, wakeUpOnDemandSupported: false }),
          );
        }
        if (cc instanceof WakeUpCCIntervalSet || cc instanceof WakeUpCCNoMoreInformation) return { action: 'ok' };
        return undefined;
      },
    };
    const gate: MockNodeBehavior = {
      // Nodo parado: ni ACK (autoAckControllerFrames = false) ni respuesta.
      transformIncomingCC: (_controller, _self, cc) => {
        if (!rt.down) this.opts.onFrame?.('in', rt.config.nodeId, summarizeCC(cc));
        return cc;
      },
      handleCC: () => (rt.down ? { action: 'stop' } : undefined),
    };
    return [handlers, gate];
  }

  private wakeSeconds(): number {
    return Math.max(10, this.config?.wakeUpSeconds ?? 300);
  }

  private doorLockReport(rt: NodeRuntime, to: number): DoorLockCCOperationReport {
    const locked = rt.values.locked !== false;
    return new DoorLockCCOperationReport({
      nodeId: to,
      currentMode: locked ? DoorLockMode.Secured : DoorLockMode.Unsecured,
      outsideHandlesCanOpenDoor: HANDLES,
      insideHandlesCanOpenDoor: HANDLES,
      boltStatus: locked ? 'locked' : 'unlocked',
    });
  }

  private batteryReport(rt: NodeRuntime, to: number): BatteryCCReport {
    const level = typeof rt.values.battery === 'number' ? Math.max(0, Math.min(100, Math.round(rt.values.battery))) : 100;
    return new BatteryCCReport({ nodeId: to, level });
  }

  /** Informes no solicitados de los valores indicados. */
  private async report(rt: NodeRuntime, keys: readonly ZwaveValueKey[]): Promise<void> {
    if (!this.clientConnected || !this.controller) return;
    const to = this.controller.ownNodeId;
    for (const key of keys) {
      const v = rt.values[key];
      if (v === undefined) continue;
      let cc: CommandClass | undefined;
      const n = NOTIFICATIONS[key];
      const s = SENSORS[key];
      if (key === 'binarySwitch') cc = new BinarySwitchCCReport({ nodeId: to, currentValue: v === true });
      else if (key === 'multilevelSwitch' && typeof v === 'number') cc = new MultilevelSwitchCCReport({ nodeId: to, currentValue: v, targetValue: v });
      else if ((key === 'meterW' || key === 'meterKwh') && typeof v === 'number') {
        cc = new MeterCCReport({ nodeId: to, type: METER_ELECTRIC, scale: METER_SCALE[key], rateType: RateType.Consumed, value: v });
      } else if (s && typeof v === 'number') cc = new MultilevelSensorCCReport({ nodeId: to, type: s.type, scale: s.scale, value: v });
      else if (n) cc = new NotificationCCReport({ nodeId: to, notificationType: n.type, notificationEvent: v === true ? n.on : n.off, notificationStatus: 0xff });
      else if (key === 'binarySensor') cc = new BinarySensorCCReport({ nodeId: to, type: BINARY_SENSOR_GENERAL, value: v === true });
      else if (key === 'locked') cc = this.doorLockReport(rt, to);
      else if (key === 'battery') cc = this.batteryReport(rt, to);
      if (!cc) continue;
      this.opts.onFrame?.('out', rt.config.nodeId, summarizeCC(cc));
      await rt.node.sendToController(createMockZWaveRequestFrame(cc, { ackRequested: false })).catch(() => undefined);
    }
  }

  private async wakeUp(rt: NodeRuntime): Promise<void> {
    if (rt.down || !this.clientConnected || !this.controller) return;
    const cc = new WakeUpCCWakeUpNotification({ nodeId: this.controller.ownNodeId });
    this.opts.onFrame?.('out', rt.config.nodeId, summarizeCC(cc));
    await rt.node.sendToController(createMockZWaveRequestFrame(cc, { ackRequested: false })).catch(() => undefined);
  }

  private listen(): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = createServer((socket) => this.onClient(socket));
    // Como una antena USB: un solo cliente a la vez.
    server.maxConnections = 1;
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        this.log(`puerto serie emulado en tcp://${this.opts.host ?? '0.0.0.0'}:${this.opts.port}`);
        this.status();
        resolve();
      });
    });
  }

  private onClient(socket: Socket): void {
    const faucet = this.faucet;
    if (!faucet) {
      socket.destroy();
      return;
    }
    this.socket = socket;
    this.log('Z-Wave JS conectado al puerto serie emulado');
    const writable = new WritableStream<ZWaveSerialFrame>({
      write: (chunk) => {
        if (chunk.type !== ZWaveSerialFrameType.SerialAPI) return;
        socket.write(typeof chunk.data === 'number' ? Uint8Array.from([chunk.data]) : chunk.data);
      },
    });
    faucet.connect(writable);
    // El controlador mock espera cada trama por separado (ACK/NAK/CAN o SOF…): TCP puede juntarlas.
    let pending: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = splitSerialFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const frame of frames) {
        void this.serial?.writeAsync(frame).catch((e: unknown) => this.log(`error al escribir en el puerto serie: ${String(e)}`));
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      faucet.disconnect();
      void writable.close().catch(() => undefined);
      if (this.socket === socket) this.socket = undefined;
      this.log('Z-Wave JS desconectado');
      this.status();
    });
    this.status();
    // Los nodos a pilas despiertan varias veces al poco de conectar: así Z-Wave JS puede
    // entrevistarlos en cuanto el driver está listo, sin esperar al intervalo de Wake Up.
    for (const delay of [3000, 15_000, 40_000]) {
      const timer = setTimeout(() => {
        if (this.socket !== socket) return;
        for (const rt of this.nodes.values()) if (!rt.config.listening) void this.wakeUp(rt);
      }, delay);
      timer.unref?.();
    }
  }

  private async closeTcp(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.socket?.destroy();
    this.socket = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.status();
  }

  private async teardown(): Promise<void> {
    await this.closeTcp();
    for (const rt of this.nodes.values()) if (rt.wakeTimer) clearInterval(rt.wakeTimer);
    this.nodes.clear();
    this.controller?.destroy();
    this.controller = undefined;
    this.faucet = undefined;
    await this.serialClose?.().catch(() => undefined);
    this.serialClose = undefined;
    this.serial = undefined;
  }

  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    await this.teardown();
    this.configKey = '';
  }
}
