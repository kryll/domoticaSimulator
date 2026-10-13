// Vía ESPHome real (perfil «esphome»): un servidor de la API nativa por cada dispositivo ESPHome
// del proyecto, en 127.0.0.1:6053+n (HA va en red host y lo alcanza; nada queda abierto a la LAN).
// Arrancar o parar el nodo es abrir o cerrar su servidor. Cada nodo se añade a HA con el flujo de
// la integración esphome (host 127.0.0.1, su puerto y su clave de cifrado).
import type { Id } from '../../../../src/types';
import { buildEsphomePlan, espCommandToService, espNodeStates, type EspNodePlan, type EspState } from '../../../../src/bridge/esphome/plan';
import type { NativeStatus } from '../../../../src/bridge/protocol';
import type { NativeBackend, NativeContext, NativeEvents } from '../native';
import { EspNodeServer } from './node';
import { EspNodeStore } from './store';
import { decodePsk } from './noise';
import { ensureEsphomeEntry, esphomeUniqueIdMatcher, flowOk, removeEsphomeEntry, type AlignTarget, type HaApi } from '../haNative';

export interface EsphomeBackendOptions {
  /** Interfaz de los servidores de la API (127.0.0.1: solo este PC). */
  host?: string;
  portBase?: number;
  /** Cifrado Noise con una clave por nodo (por defecto sí). */
  encryption?: boolean;
  /** Fichero con los puertos y las claves (emulator/.secrets/esphome-nodes.json). */
  storeFile?: string;
  /** HA del laboratorio: añade y borra las entradas esphome. Sin él, se añaden a mano. */
  ha?: HaApi;
  /** Reintentos del alta en HA (ms). */
  registerRetryMs?: number[];
}

interface NodeRuntime {
  plan: EspNodePlan;
  storeId: string;
  server: EspNodeServer;
  port: number;
  psk?: string;
  lastSent: Map<number, string>;
  registered: 'no' | 'pending' | 'yes' | 'error';
  registerTimer?: ReturnType<typeof setTimeout>;
  attempts: number;
  error?: string;
}

export class EsphomeBackend implements NativeBackend {
  readonly transport = 'esphome' as const;
  private events: NativeEvents | undefined;
  private readonly nodes = new Map<Id, NodeRuntime>();
  private readonly store: EspNodeStore;
  private entities: NativeContext['entities'] = {};
  private projectId = '';

  constructor(private readonly opts: EsphomeBackendOptions = {}) {
    this.store = new EspNodeStore(opts.storeFile, opts.portBase ?? 6053);
  }

  async start(events: NativeEvents): Promise<void> {
    this.events = events;
    await this.store.load();
  }

  private log(msg: string): void {
    this.events?.log(`[esphome] ${msg}`);
  }

  private changed(): void {
    this.events?.changed();
  }

  async sync(ctx: NativeContext): Promise<void> {
    this.entities = ctx.entities;
    this.projectId = ctx.project.id;
    const plans = buildEsphomePlan(ctx.project, ctx.defs).filter((p) => ctx.devices.has(p.deviceId));
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
      if (run && !rt.server.running) {
        try {
          await rt.server.start();
          rt.error = undefined;
          rt.lastSent.clear();
          this.log(`${plan.name} en marcha en ${this.opts.host ?? '127.0.0.1'}:${rt.port}`);
        } catch (err) {
          rt.error = `No se pudo abrir el puerto ${rt.port}: ${err instanceof Error ? err.message : String(err)}`;
          this.log(rt.error);
        }
        this.changed();
      } else if (!run && rt.server.running) {
        await rt.server.stop();
        this.log(`${plan.name} parado`);
        this.changed();
      }
      if (rt.server.running) {
        this.push(rt);
        if (rt.registered === 'no' || rt.registered === 'error') this.scheduleRegister(rt, 1500);
      }
    }
  }

  private async create(plan: EspNodePlan): Promise<NodeRuntime> {
    const storeId = `${this.projectId}/${plan.deviceId}`;
    const rec = await this.store.ensure(storeId, this.opts.encryption !== false);
    const rt: NodeRuntime = {
      plan,
      storeId,
      port: rec.port,
      ...(rec.key ? { psk: rec.key } : {}),
      lastSent: new Map(),
      registered: 'no',
      attempts: 0,
      server: new EspNodeServer({
        plan,
        port: rec.port,
        host: this.opts.host ?? '127.0.0.1',
        ...(rec.key ? { psk: decodePsk(rec.key) } : {}),
        states: () => espNodeStates(rt.plan, this.entities),
        onCommand: (command) => {
          const svc = espCommandToService(rt.plan, command);
          if (svc) this.events?.command(rt.plan.deviceId, svc, `esphome/${rt.plan.name}`);
        },
        onTraffic: (dir, summary) => this.events?.traffic({ dir, topic: `esphome/${rt.plan.name}`, payload: summary, deviceId: rt.plan.deviceId, via: 'esphome' }),
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
      removeEsphomeEntry(ha, rt.plan.mac)
        .then((done) => done && this.log(`${rt.plan.name} borrado de HA`))
        .catch((err: unknown) => this.log(`no se pudo borrar ${rt.plan.name} de HA: ${err instanceof Error ? err.message : String(err)}`));
    }
    this.changed();
  }

  /** Publica en HA los estados que han cambiado desde el último envío. */
  private push(rt: NodeRuntime): void {
    const states = espNodeStates(rt.plan, this.entities);
    const changed = new Map<number, EspState>();
    for (const [key, s] of states) {
      const text = JSON.stringify(s);
      if (rt.lastSent.get(key) === text) continue;
      rt.lastSent.set(key, text);
      changed.set(key, s);
    }
    rt.server.pushStates(changed);
  }

  private scheduleRegister(rt: NodeRuntime, delay: number): void {
    const ha = this.opts.ha;
    if (!ha || rt.registerTimer || rt.registered === 'yes' || rt.registered === 'pending') return;
    rt.registered = 'pending';
    rt.registerTimer = setTimeout(() => {
      rt.registerTimer = undefined;
      ensureEsphomeEntry(ha, { mac: rt.plan.mac, name: rt.plan.name, host: '127.0.0.1', port: rt.port, ...(rt.psk ? { psk: rt.psk } : {}) })
        .then((outcome) => {
          if (flowOk(outcome)) {
            rt.registered = 'yes';
            rt.error = undefined;
            if (outcome.result === 'created') this.log(`${rt.plan.name} añadido a HA (integración esphome)`);
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
      for (const e of rt.plan.entities) out.push({ platform: 'esphome', entityId: e.haEntityId, match: esphomeUniqueIdMatcher(rt.plan.mac, e.kind, e.objectId, e.name) });
    }
    return out;
  }

  status(): NativeStatus {
    const nodes: NativeStatus['nodes'] = {};
    let running = 0;
    let connected = 0;
    let errors = 0;
    for (const [id, rt] of this.nodes) {
      const where = `${this.opts.host ?? '127.0.0.1'}:${rt.port}`;
      if (rt.error && !rt.server.running) {
        errors += 1;
        nodes[id] = { state: 'error', detail: rt.error };
        continue;
      }
      if (!rt.server.running) {
        nodes[id] = { state: 'stopped', detail: `${where} · parado` };
        continue;
      }
      running += 1;
      const ha = rt.server.clients > 0;
      if (ha) connected += 1;
      const reg = rt.registered === 'yes' ? '' : rt.error ? ` · ${rt.error}` : ' · añadiéndolo a HA…';
      nodes[id] = { state: ha ? 'running' : 'starting', detail: `${where} · ${ha ? 'HA conectado' : 'esperando a HA'}${reg}` };
    }
    const total = this.nodes.size;
    return {
      state: errors > 0 ? 'error' : total > 0 && connected < running ? 'connecting' : 'connected',
      detail: total === 0 ? 'Sin nodos ESPHome en el proyecto' : `${running} de ${total} nodos en marcha · ${connected} conectados a HA${this.opts.encryption === false ? ' · sin cifrado' : ' · cifrado Noise'}`,
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
