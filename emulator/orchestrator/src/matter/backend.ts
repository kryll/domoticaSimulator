// Vía Matter real (perfil «matter»): un bridge Matter hecho con matter.js dentro del orquestador
// (red host, UDP 5541 + mDNS) con un endpoint por dispositivo Matter/Thread del proyecto. El
// orquestador lo comisiona solo en matterjs-server (el servidor Matter que usa HA, API WebSocket en
// ws://127.0.0.1:5580/ws) y HA lo ve por su integración `matter`. Parar un dispositivo pone su
// endpoint Reachable=false (HA lo muestra no disponible); al reiniciar el orquestador se reutiliza
// el comisionado (las claves de la fabric las guarda matter.js en su carpeta de datos).
import type { Environment } from '@matter/main';
import type { Id } from '../../../../src/types';
import { buildMatterPlan, describeMatterCommand, describeMatterState, matterCommandToService, matterStateOf, MATTER_CLUSTER_IDS, type MatterCommand, type MatterDevicePlan, type MatterDeviceKind } from '../../../../src/bridge/matter/plan';
import type { NativeStatus } from '../../../../src/bridge/protocol';
import type { NativeBackend, NativeContext, NativeEvents } from '../native';
import { matterUniqueIdMatcher, type AlignTarget } from '../haNative';
import { MatterBridge, quietMatterLogs } from './bridge';
import { MatterSecretsStore, type MatterSecrets } from './store';
import { MatterServerClient } from './server';

/** Puerto UDP del bridge: el 5540 lo usa matterjs-server en la misma máquina (red host). */
export const MATTER_BRIDGE_PORT = 5541;

export interface MatterBackendOptions {
  /** API WebSocket de matterjs-server. Sin ella no se comisiona solo (tests). */
  serverUrl?: string;
  port?: number;
  /** Carpeta de datos de matter.js (fabrics y números de endpoint): emulator/matter/bridge. */
  storagePath?: string;
  /** emulator/.secrets/matter.json: passcode, discriminador, UniqueID y nodo. */
  secretsFile?: string;
  /** Entorno de matter.js (tests: red simulada). */
  environment?: Environment;
  /** Reintentos del comisionado (ms). */
  commissionRetryMs?: number[];
  /** Cada cuánto se mira en matterjs-server si ve el bridge disponible (ms). */
  checkIntervalMs?: number;
  /** Panel web de matterjs-server (enlace en la app). */
  dashboardUrl?: string;
  /** Nivel de log de matter.js (por defecto, avisos). */
  matterLogLevel?: 'notice' | 'warn' | 'error';
}

const KIND_LABEL: Record<MatterDeviceKind, string> = {
  on_off_light: 'On/Off Light',
  dimmable_light: 'Dimmable Light',
  color_temperature_light: 'Color Temperature Light',
  extended_color_light: 'Extended Color Light',
  on_off_plug: 'On/Off Plug-in Unit',
  contact_sensor: 'Contact Sensor',
  occupancy_sensor: 'Occupancy Sensor',
  water_leak_detector: 'Water Leak Detector',
  temperature_sensor: 'Temperature Sensor',
  humidity_sensor: 'Humidity Sensor',
  light_sensor: 'Light Sensor',
  pressure_sensor: 'Pressure Sensor',
  door_lock: 'Door Lock',
  window_covering: 'Window Covering',
};

type Commission = 'idle' | 'waiting_server' | 'commissioning' | 'done' | 'error';

export class MatterBackend implements NativeBackend {
  readonly transport = 'matter' as const;
  private events: NativeEvents | undefined;
  private readonly store: MatterSecretsStore;
  private secrets: MatterSecrets | undefined;
  private bridge: MatterBridge | undefined;
  private server: MatterServerClient | undefined;
  private plans = new Map<Id, MatterDevicePlan>();
  private reachable = new Map<Id, boolean>();
  private lastSent = new Map<Id, string>();
  private commission: Commission = 'idle';
  private commissionError: string | undefined;
  private commissionTimer: ReturnType<typeof setTimeout> | undefined;
  private checkTimer: ReturnType<typeof setInterval> | undefined;
  private attempts = 0;
  private serverSeesBridge: boolean | undefined;
  private startError: string | undefined;
  private syncing: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly opts: MatterBackendOptions = {}) {
    this.store = new MatterSecretsStore(opts.secretsFile);
  }

  async start(events: NativeEvents): Promise<void> {
    this.events = events;
    this.closed = false;
    quietMatterLogs(this.opts.matterLogLevel ?? 'warn');
    this.secrets = await this.store.load();
    if (this.opts.serverUrl) {
      this.server = new MatterServerClient(this.opts.serverUrl, { onChange: () => this.onServerChange() });
      this.server.start();
    }
  }

  private log(msg: string): void {
    this.events?.log(`[matter] ${msg}`);
  }

  private changed(): void {
    this.events?.changed();
  }

  /** Datos de emparejamiento (para los tests y el diagnóstico; el passcode es secreto). */
  pairing(): { passcode: number; discriminator: number; manualCode: string; nodeId?: number } | undefined {
    if (!this.secrets || !this.bridge) return undefined;
    return { passcode: this.secrets.passcode, discriminator: this.secrets.discriminator, manualCode: this.bridge.manualPairingCode, ...(this.secrets.nodeId !== undefined ? { nodeId: this.secrets.nodeId } : {}) };
  }

  /** Número de endpoint del dispositivo en el bridge. */
  endpointOf(deviceId: Id): number | undefined {
    const plan = this.plans.get(deviceId);
    return plan ? this.bridge?.endpointNumber(plan.endpointId) : undefined;
  }

  /** Ids de los endpoints que tiene ahora el bridge (diagnóstico y tests). */
  bridgeEndpointIds(): string[] {
    return this.bridge?.ids() ?? [];
  }

  async sync(ctx: NativeContext): Promise<void> {
    // Las sincronizaciones van en fila: matter.js no admite añadir el mismo endpoint dos veces.
    const run = this.syncing.then(() => this.doSync(ctx));
    this.syncing = run.catch(() => undefined);
    return run;
  }

  private async doSync(ctx: NativeContext): Promise<void> {
    if (this.closed) return;
    const secrets = this.secrets ?? (this.secrets = await this.store.load());
    const plans = buildMatterPlan(ctx.project, ctx.defs).filter((p) => ctx.devices.has(p.deviceId));
    const wanted = new Map(plans.map((p) => [p.deviceId, p.endpointId]));
    let bridge = this.bridge;
    if (!bridge) {
      bridge = new MatterBridge({
        port: this.opts.port ?? MATTER_BRIDGE_PORT,
        passcode: secrets.passcode,
        discriminator: secrets.discriminator,
        uniqueId: secrets.uniqueId,
        ...(this.opts.environment ? { environment: this.opts.environment } : {}),
        ...(this.opts.storagePath ? { storagePath: this.opts.storagePath } : {}),
      });
      this.bridge = bridge;
      await bridge.create();
    }
    for (const [id, plan] of [...this.plans]) {
      // Otro proyecto con los mismos ids de dispositivo (dos copias de la demo): el endpoint es otro
      // (otro id y UniqueID), así que el del proyecto anterior se quita (HA borra su dispositivo).
      if (wanted.get(id) === plan.endpointId) continue;
      await bridge.remove(plan.endpointId);
      this.plans.delete(id);
      this.reachable.delete(id);
      this.lastSent.delete(id);
      this.log(`${plan.name} quitado del bridge`);
    }
    let changed = false;
    for (const plan of plans) {
      const reachable = ctx.live && !ctx.down.has(plan.deviceId);
      const state = matterStateOf(plan, ctx.entities, reachable);
      const text = JSON.stringify(state);
      const prev = this.plans.get(plan.deviceId);
      const same = prev !== undefined && JSON.stringify(prev) === JSON.stringify(plan);
      if (same && this.lastSent.get(plan.deviceId) === text) continue;
      await bridge.upsert(plan, state, (command) => this.onCommand(plan.deviceId, command));
      if (!prev) this.log(`${plan.name}: endpoint ${bridge.endpointNumber(plan.endpointId) ?? '?'} (${KIND_LABEL[plan.kind]})`);
      this.plans.set(plan.deviceId, plan);
      this.lastSent.set(plan.deviceId, text);
      if (this.reachable.get(plan.deviceId) !== reachable) {
        changed = true;
        if (prev) this.log(`${plan.name} ${reachable ? 'en marcha (Reachable=true)' : 'parado (Reachable=false)'}`);
      }
      this.reachable.set(plan.deviceId, reachable);
      this.events?.traffic({ dir: 'out', topic: `matter/${plan.name}`, payload: describeMatterState(state), deviceId: plan.deviceId, via: 'matter' });
    }
    if (!bridge.running) {
      try {
        await bridge.start();
        this.startError = undefined;
        this.log(`bridge en marcha (UDP ${this.opts.port ?? MATTER_BRIDGE_PORT}, ${plans.length} dispositivos)${bridge.commissioned ? ' · ya comisionado' : ''}`);
      } catch (err) {
        this.startError = `No se pudo arrancar el bridge Matter: ${err instanceof Error ? err.message : String(err)}`;
        this.log(this.startError);
      }
      changed = true;
    }
    if (bridge.running && this.commission === 'idle') this.scheduleCommission(500);
    if (changed) this.changed();
  }

  private onCommand(deviceId: Id, command: MatterCommand): void {
    const plan = this.plans.get(deviceId);
    if (!plan) return;
    this.events?.traffic({ dir: 'in', topic: `matter/${plan.name}`, payload: describeMatterCommand(command), deviceId, via: 'matter' });
    const svc = matterCommandToService(plan, command);
    if (svc) this.events?.command(deviceId, svc, `matter/${plan.name}`);
    // Si el simulador no cambia nada (p. ej. ya estaba encendida), HA debe ver el estado real: se
    // vuelve a mandar en el siguiente sync aunque no haya cambiado.
    this.lastSent.delete(deviceId);
  }

  private onServerChange(): void {
    if (this.server?.state === 'connected' && (this.commission === 'waiting_server' || this.commission === 'error')) {
      this.clearCommissionTimer();
      this.commission = 'idle';
      if (this.bridge?.running) this.scheduleCommission(500);
    }
    this.changed();
  }

  private clearCommissionTimer(): void {
    if (this.commissionTimer) clearTimeout(this.commissionTimer);
    this.commissionTimer = undefined;
  }

  private scheduleCommission(delay: number): void {
    if (!this.server || this.commissionTimer || this.closed) return;
    if (this.commission === 'done' || this.commission === 'commissioning') return;
    this.commissionTimer = setTimeout(() => {
      this.commissionTimer = undefined;
      void this.ensureCommissioned();
    }, delay);
    this.commissionTimer.unref?.();
  }

  /**
   * Comisiona el bridge en matterjs-server si hace falta. Si el servidor ya lo conoce (su UniqueID
   * está entre sus nodos) no hace nada: así, al reiniciar el orquestador, ni se vuelve a comisionar
   * ni aparecen dispositivos duplicados en HA.
   */
  private async ensureCommissioned(): Promise<void> {
    const server = this.server;
    const bridge = this.bridge;
    const secrets = this.secrets;
    if (!server || !bridge || !secrets || this.closed) return;
    if (!(await server.ready(10_000))) {
      this.commission = 'waiting_server';
      this.commissionError = `matterjs-server no responde en ${server.url}`;
      this.changed();
      return;
    }
    this.commission = 'commissioning';
    this.commissionError = undefined;
    this.changed();
    try {
      const nodes = await server.nodes();
      const known = nodes.find((n) => n.uniqueId === secrets.uniqueId);
      if (known && bridge.commissioned) {
        if (secrets.nodeId !== known.nodeId) this.secrets = await this.store.update({ nodeId: known.nodeId });
        this.serverSeesBridge = known.available;
        this.commission = 'done';
        this.log(`bridge ya comisionado en matterjs-server (nodo ${known.nodeId}): se reutiliza`);
      } else {
        if (known) {
          // El servidor lo conoce pero el bridge perdió sus datos: se quita el nodo viejo para no
          // duplicar dispositivos en HA.
          this.log(`matterjs-server tiene un nodo viejo del bridge (${known.nodeId}): se quita`);
          await server.removeNode(known.nodeId).catch((err: unknown) => this.log(`no se pudo quitar el nodo ${known.nodeId}: ${err instanceof Error ? err.message : String(err)}`));
        }
        if (bridge.commissioned) {
          this.log('matterjs-server no conoce el bridge: se restablece de fábrica para volver a comisionarlo');
          await bridge.factoryReset();
        }
        this.log('comisionando el bridge en matterjs-server (commission_with_code, solo red)…');
        this.events?.traffic({ dir: 'out', topic: 'matter/bridge', payload: 'commission_with_code (network_only)', via: 'matter' });
        const nodeId = await server.commissionWithCode(bridge.manualPairingCode);
        this.secrets = await this.store.update({ nodeId });
        this.serverSeesBridge = true;
        this.commission = 'done';
        this.attempts = 0;
        this.log(`bridge comisionado en matterjs-server (nodo ${nodeId}); HA lo verá por la integración matter`);
      }
    } catch (err) {
      this.commission = 'error';
      this.commissionError = `Comisionado: ${err instanceof Error ? err.message : String(err)}`;
      this.log(this.commissionError);
      const retries = this.opts.commissionRetryMs ?? [10_000, 30_000, 60_000];
      const wait = retries[Math.min(this.attempts, retries.length - 1)] ?? 60_000;
      this.attempts += 1;
      this.clearCommissionTimer();
      this.scheduleCommission(wait);
    }
    this.startChecks();
    this.changed();
  }

  /** Mira de vez en cuando si matterjs-server ve el bridge disponible (para el panel). */
  private startChecks(): void {
    if (this.checkTimer || !this.server) return;
    this.checkTimer = setInterval(() => {
      const server = this.server;
      const uid = this.secrets?.uniqueId;
      if (!server || server.state !== 'connected' || this.commission !== 'done') return;
      server
        .nodes()
        .then((nodes) => {
          const seen = nodes.find((n) => n.uniqueId === uid)?.available;
          if (seen !== this.serverSeesBridge) {
            this.serverSeesBridge = seen;
            this.changed();
          }
        })
        .catch(() => undefined);
    }, this.opts.checkIntervalMs ?? 30_000);
    this.checkTimer.unref?.();
  }

  alignTargets(): AlignTarget[] {
    const nodeId = this.secrets?.nodeId;
    const bridge = this.bridge;
    if (nodeId === undefined || !bridge || this.commission !== 'done') return [];
    const out: AlignTarget[] = [];
    for (const plan of this.plans.values()) {
      const ep = bridge.endpointNumber(plan.endpointId);
      if (ep === undefined) continue;
      for (const e of plan.entities) out.push({ platform: 'matter', entityId: e.entityId, match: matterUniqueIdMatcher(nodeId, ep, MATTER_CLUSTER_IDS[e.cluster], e.attributeId) });
    }
    return out;
  }

  status(): NativeStatus {
    const nodes: NativeStatus['nodes'] = {};
    const bridge = this.bridge;
    const port = this.opts.port ?? MATTER_BRIDGE_PORT;
    let reachable = 0;
    for (const [id, plan] of this.plans) {
      const ep = bridge?.endpointNumber(plan.endpointId);
      const where = `endpoint ${ep ?? '?'} · ${KIND_LABEL[plan.kind]}`;
      if (this.startError) nodes[id] = { state: 'error', detail: this.startError };
      else if (this.reachable.get(id) !== true) nodes[id] = { state: 'stopped', detail: `${where} · Reachable=false` };
      else if (this.commission !== 'done') nodes[id] = { state: 'starting', detail: `${where} · ${this.commissionError ?? 'comisionando el bridge…'}` };
      else {
        reachable += 1;
        nodes[id] = { state: 'running', detail: `${where} · en marcha` };
      }
    }
    const total = this.plans.size;
    const nodeId = this.secrets?.nodeId;
    let state: NativeStatus['state'] = 'connected';
    let detail: string;
    if (this.startError) {
      state = 'error';
      detail = this.startError;
    } else if (!this.server) {
      detail = `Bridge en UDP ${port} · ${total} dispositivos · sin servidor Matter configurado (comisionado manual)`;
    } else if (this.commission === 'done') {
      state = this.serverSeesBridge === false ? 'connecting' : 'connected';
      detail = `Bridge comisionado en matterjs-server (nodo ${nodeId ?? '?'}) · ${reachable} de ${total} dispositivos alcanzables${this.serverSeesBridge === false ? ' · el servidor aún no lo ve disponible' : ''}`;
    } else if (this.commission === 'error' || this.commission === 'waiting_server') {
      state = this.commission === 'error' ? 'error' : 'connecting';
      detail = this.commissionError ?? 'Esperando a matterjs-server';
    } else {
      state = 'connecting';
      detail = total === 0 ? 'Sin dispositivos Matter en el proyecto' : 'Comisionando el bridge en matterjs-server…';
    }
    return { state, detail, nodes, ...(this.opts.dashboardUrl ? { url: this.opts.dashboardUrl } : {}) };
  }

  /** Antes de restaurar un snapshot: cierra el bridge (no debe escribir en su carpeta mientras se copia). */
  async suspend(): Promise<void> {
    await this.syncing;
    await this.closeBridge();
  }

  async reset(): Promise<void> {
    await this.suspend();
    this.secrets = await this.store.reload();
  }

  private async closeBridge(): Promise<void> {
    this.clearCommissionTimer();
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = undefined;
    const bridge = this.bridge;
    this.bridge = undefined;
    this.plans.clear();
    this.reachable.clear();
    this.lastSent.clear();
    this.commission = 'idle';
    this.commissionError = undefined;
    this.serverSeesBridge = undefined;
    if (bridge) await bridge.close();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.syncing;
    await this.closeBridge();
    this.server?.close();
    this.server = undefined;
  }
}
