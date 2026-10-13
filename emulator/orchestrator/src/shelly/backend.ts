// Vía Shelly real (perfil «shelly», E3): un Shelly Gen2+ emulado por cada dispositivo Shelly del
// proyecto, en 127.0.0.1:18181+n (HA va en red host y lo alcanza; nada queda abierto a la LAN).
// Arrancar o parar el nodo es abrir o cerrar su servidor. Cada Shelly se añade a HA con el flujo de
// la integración shelly (host 127.0.0.1 y su puerto); su unique_id es la MAC del Shelly.
import type { Id } from '../../../../src/types';
import { buildShellyPlan, changedComponents, shellyComponentsStatus, type JsonObject, type ShellyNodePlan } from '../../../../src/bridge/shelly/plan';
import type { NativeStatus } from '../../../../src/bridge/protocol';
import type { NativeBackend, NativeContext, NativeEvents } from '../native';
import { ShellyNodeServer } from './node';
import { SHELLY_PORT_BASE, ShellyNodeStore } from './store';
import { ensureShellyEntry, flowOk, removeShellyEntry, shellyUniqueIdMatcher, type AlignTarget, type HaApi } from '../haNative';

export interface ShellyBackendOptions {
  /** Interfaz de los servidores (127.0.0.1: solo este PC). */
  host?: string;
  portBase?: number;
  /** Fichero con los puertos (emulator/.secrets/shelly-nodes.json). */
  storeFile?: string;
  /** HA del laboratorio: añade y borra las entradas shelly. Sin él, se añaden a mano. */
  ha?: HaApi;
  /** Reintentos del alta en HA (ms). */
  registerRetryMs?: number[];
}

interface NodeRuntime {
  plan: ShellyNodePlan;
  storeId: string;
  server: ShellyNodeServer;
  port: number;
  lastSent: Record<string, JsonObject>;
  registered: 'no' | 'pending' | 'yes' | 'error';
  registerTimer?: ReturnType<typeof setTimeout>;
  attempts: number;
  /** Último error del alta en HA. */
  error?: string;
  /** El Shelly no pudo arrancar (puerto ocupado). */
  startError?: string;
}

export class ShellyBackend implements NativeBackend {
  readonly transport = 'shelly' as const;
  private events: NativeEvents | undefined;
  private readonly nodes = new Map<Id, NodeRuntime>();
  private readonly store: ShellyNodeStore;
  private entities: NativeContext['entities'] = {};
  private projectId = '';

  constructor(private readonly opts: ShellyBackendOptions = {}) {
    this.store = new ShellyNodeStore(opts.storeFile, opts.portBase ?? SHELLY_PORT_BASE);
  }

  private get host(): string {
    return this.opts.host ?? '127.0.0.1';
  }

  async start(events: NativeEvents): Promise<void> {
    this.events = events;
    await this.store.load();
  }

  private log(msg: string): void {
    this.events?.log(`[shelly] ${msg}`);
  }

  private changed(): void {
    this.events?.changed();
  }

  async sync(ctx: NativeContext): Promise<void> {
    this.entities = ctx.entities;
    // Otro proyecto: sus Shellys son otros dispositivos (otra MAC, hostname y puerto) aunque
    // compartan id (dos copias de la demo). Los del proyecto anterior se quitan, también de HA.
    if (this.projectId !== '' && this.projectId !== ctx.project.id) {
      for (const [id, rt] of [...this.nodes]) await this.remove(id, rt);
    }
    this.projectId = ctx.project.id;
    const plans = buildShellyPlan(ctx.project, ctx.defs).filter((p) => ctx.devices.has(p.deviceId));
    const wanted = new Set(plans.map((p) => p.deviceId));
    for (const [id, rt] of [...this.nodes]) {
      if (wanted.has(id)) continue;
      await this.remove(id, rt);
    }
    for (const plan of plans) {
      let rt = this.nodes.get(plan.deviceId);
      if (!rt) rt = await this.create(plan);
      else {
        rt.server.updatePlan(plan);
        rt.plan = plan;
      }
      const run = ctx.live && !ctx.down.has(plan.deviceId);
      // Un Shelly que no debe estar en marcha no está en error aunque antes no pudiera abrir su puerto.
      if (!run) rt.startError = undefined;
      if (run && !rt.server.running) {
        try {
          await rt.server.start();
          rt.startError = undefined;
          rt.lastSent = shellyComponentsStatus(rt.plan, this.entities);
          this.log(`${plan.friendlyName} (${plan.hostname}) en marcha en ${this.host}:${rt.port}`);
        } catch (err) {
          rt.startError = `No se pudo abrir el puerto ${rt.port}: ${err instanceof Error ? err.message : String(err)}`;
          this.log(`${plan.friendlyName}: ${rt.startError}`);
        }
        this.changed();
      } else if (!run && rt.server.running) {
        await rt.server.stop();
        this.log(`${plan.friendlyName} parado`);
        this.changed();
      }
      if (rt.server.running) {
        this.push(rt);
        if (rt.registered === 'no' || rt.registered === 'error') this.scheduleRegister(rt, 1500);
      }
    }
  }

  private async create(plan: ShellyNodePlan): Promise<NodeRuntime> {
    const storeId = `${this.projectId}/${plan.deviceId}`;
    const rec = await this.store.ensure(storeId);
    const rt: NodeRuntime = {
      plan,
      storeId,
      port: rec.port,
      lastSent: {},
      registered: 'no',
      attempts: 0,
      server: new ShellyNodeServer({
        plan,
        port: rec.port,
        host: this.host,
        entities: () => this.entities,
        onCommand: (commands) => {
          for (const c of commands) this.events?.command(rt.plan.deviceId, c, `shelly/${rt.plan.hostname}`);
        },
        onTraffic: (dir, summary) => this.events?.traffic({ dir, topic: `shelly/${rt.plan.hostname}`, payload: summary, deviceId: rt.plan.deviceId, via: 'shelly' }),
        onClients: () => this.changed(),
        log: (msg) => this.events?.log(msg),
      }),
    };
    this.nodes.set(plan.deviceId, rt);
    return rt;
  }

  private async remove(id: Id, rt: NodeRuntime): Promise<void> {
    if (rt.registerTimer) clearTimeout(rt.registerTimer);
    await rt.server.stop();
    this.nodes.delete(id);
    await this.store.remove(rt.storeId);
    const ha = this.opts.ha;
    if (ha) {
      removeShellyEntry(ha, rt.plan.mac)
        .then((done) => done && this.log(`${rt.plan.friendlyName} borrado de HA`))
        .catch((err: unknown) => this.log(`no se pudo borrar ${rt.plan.friendlyName} de HA: ${err instanceof Error ? err.message : String(err)}`));
    }
    this.changed();
  }

  /** Publica en HA (NotifyStatus) los componentes que han cambiado desde el último envío. */
  private push(rt: NodeRuntime): void {
    const now = shellyComponentsStatus(rt.plan, this.entities);
    const changed = changedComponents(rt.lastSent, now);
    rt.lastSent = now;
    rt.server.pushStatus(changed);
  }

  private scheduleRegister(rt: NodeRuntime, delay: number): void {
    const ha = this.opts.ha;
    if (!ha || rt.registerTimer || rt.registered === 'yes' || rt.registered === 'pending') return;
    rt.registered = 'pending';
    rt.registerTimer = setTimeout(() => {
      rt.registerTimer = undefined;
      ensureShellyEntry(ha, { host: this.host, port: rt.port })
        .then((outcome) => {
          if (flowOk(outcome)) {
            rt.registered = 'yes';
            rt.error = undefined;
            if (outcome.result === 'created') this.log(`${rt.plan.friendlyName} añadido a HA (integración shelly)`);
          } else {
            rt.registered = 'error';
            rt.error = outcome.result === 'error' ? outcome.message : outcome.result === 'aborted' ? `Alta en HA cancelada: ${outcome.reason}` : 'Alta en HA sin terminar';
          }
        })
        .catch((err: unknown) => {
          rt.registered = 'error';
          rt.error = `Alta en HA: ${err instanceof Error ? err.message : String(err)}`;
        })
        .finally(() => {
          this.changed();
          if (rt.registered === 'error' && this.nodes.get(rt.plan.deviceId) === rt) {
            this.log(`${rt.plan.friendlyName}: ${rt.error ?? 'error en el alta'}`);
            const retries = this.opts.registerRetryMs ?? [10_000, 30_000, 60_000];
            const wait = retries[Math.min(rt.attempts, retries.length - 1)] ?? 60_000;
            rt.attempts += 1;
            rt.registered = 'no';
            if (rt.server.running) this.scheduleRegister(rt, wait);
          }
        });
    }, delay);
    rt.registerTimer.unref?.();
  }

  /** Entidades que el Lab alinea en HA con el entity_id del simulador. */
  alignTargets(): AlignTarget[] {
    const out: AlignTarget[] = [];
    for (const rt of this.nodes.values()) {
      if (rt.registered !== 'yes') continue;
      for (const e of rt.plan.entities) out.push({ platform: 'shelly', entityId: e.entityId, match: shellyUniqueIdMatcher(rt.plan.mac, e.uniqueSuffix) });
    }
    return out;
  }

  status(): NativeStatus {
    const nodes: NativeStatus['nodes'] = {};
    let running = 0;
    let connected = 0;
    let errors = 0;
    for (const [id, rt] of this.nodes) {
      const where = `${this.host}:${rt.port}`;
      if (rt.startError && !rt.server.running) {
        errors += 1;
        nodes[id] = { state: 'error', detail: rt.startError };
        continue;
      }
      if (!rt.server.running) {
        nodes[id] = { state: 'stopped', detail: `${rt.plan.hostname} · ${where} · parado` };
        continue;
      }
      running += 1;
      const ha = rt.server.clients > 0;
      if (ha) connected += 1;
      const reg = rt.registered === 'yes' ? '' : rt.error ? ` · ${rt.error}` : ' · añadiéndolo a HA…';
      nodes[id] = { state: ha ? 'running' : 'starting', detail: `${rt.plan.hostname} · ${where} · ${ha ? 'HA conectado' : 'esperando a HA'}${reg}` };
    }
    const total = this.nodes.size;
    return {
      state: errors > 0 ? 'error' : total > 0 && connected < running ? 'connecting' : 'connected',
      detail: total === 0 ? 'Sin Shellys Gen2+ en el proyecto' : `${running} de ${total} Shellys en marcha · ${connected} conectados a HA`,
      nodes,
    };
  }

  async reset(): Promise<void> {
    await this.close();
    await this.store.reload();
  }

  async close(): Promise<void> {
    for (const rt of this.nodes.values()) {
      if (rt.registerTimer) clearTimeout(rt.registerTimer);
      await rt.server.stop();
    }
    this.nodes.clear();
  }
}
