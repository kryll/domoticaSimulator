// Cliente mínimo del servidor Z-Wave JS (el WebSocket de Z-Wave JS UI en el puerto 3000, el mismo
// al que se conecta HA). El orquestador lo usa para saber si Z-Wave JS UI está conectado, el estado
// de cada nodo (vivo, dormido, dead) y para hacer ping a un nodo parado (así Z-Wave JS lo marca dead
// enseguida, como pasaría con un dispositivo real al que se le intenta hablar).
import WebSocket from 'ws';

export type ZjsNodeStatus = 'unknown' | 'asleep' | 'awake' | 'dead' | 'alive';

const STATUS: Record<number, ZjsNodeStatus> = { 0: 'unknown', 1: 'asleep', 2: 'awake', 3: 'dead', 4: 'alive' };
const EVENT_STATUS: Record<string, ZjsNodeStatus> = { dead: 'dead', alive: 'alive', sleep: 'asleep', 'wake up': 'awake' };

export interface ZjsNode {
  status: ZjsNodeStatus;
  ready: boolean;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export class ZjsClient {
  private ws: WebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;
  private readonly pending = new Map<string, (msg: Json) => void>();
  private closed = false;
  state: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  homeId: number | undefined;
  readonly nodes = new Map<number, ZjsNode>();

  constructor(
    private readonly url: string,
    private readonly opts: { onChange: () => void; log?: (msg: string) => void; retryMs?: number },
  ) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  private set(state: ZjsClient['state']): void {
    if (this.state === state) return;
    this.state = state;
    this.opts.onChange();
  }

  private connect(): void {
    if (this.closed) return;
    this.set('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('message', (raw) => this.onMessage(String(raw)));
    ws.on('error', () => undefined);
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.nodes.clear();
      for (const resolve of this.pending.values()) resolve({ success: false });
      this.pending.clear();
      this.set('disconnected');
      if (!this.closed) {
        this.timer = setTimeout(() => this.connect(), this.opts.retryMs ?? 5000);
        this.timer.unref?.();
      }
    });
  }

  private call(command: string, args: Json = {}, timeoutMs = 30_000): Promise<Json> {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) return Promise.resolve({ success: false });
    const messageId = `hasim-${++this.seq}`;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.pending.delete(messageId);
        resolve({ success: false });
      }, timeoutMs);
      t.unref?.();
      this.pending.set(messageId, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      ws.send(JSON.stringify({ messageId, command, ...args }));
    });
  }

  private onMessage(text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!isObj(msg)) return;
    if (msg.type === 'version') {
      this.homeId = typeof msg.homeId === 'number' ? msg.homeId : undefined;
      const schema = typeof msg.maxSchemaVersion === 'number' ? msg.maxSchemaVersion : 0;
      void (async () => {
        await this.call('set_api_schema', { schemaVersion: schema });
        const res = await this.call('start_listening');
        const result = isObj(res.result) ? res.result : {};
        const state = isObj(result.state) ? result.state : {};
        this.nodes.clear();
        for (const n of Array.isArray(state.nodes) ? state.nodes : []) {
          if (!isObj(n) || typeof n.nodeId !== 'number') continue;
          this.nodes.set(n.nodeId, { status: STATUS[typeof n.status === 'number' ? n.status : 0] ?? 'unknown', ready: n.ready === true });
        }
        this.set('connected');
        this.opts.onChange();
      })();
      return;
    }
    if (msg.type === 'result' && typeof msg.messageId === 'string') {
      const resolve = this.pending.get(msg.messageId);
      this.pending.delete(msg.messageId);
      resolve?.(msg);
      return;
    }
    if (msg.type === 'event' && isObj(msg.event)) {
      const ev = msg.event;
      if (ev.source !== 'node' || typeof ev.nodeId !== 'number') {
        if (ev.source === 'controller' && (ev.event === 'node added' || ev.event === 'node removed')) this.opts.onChange();
        return;
      }
      const node = this.nodes.get(ev.nodeId) ?? { status: 'unknown', ready: false };
      const name = String(ev.event);
      if (EVENT_STATUS[name]) node.status = EVENT_STATUS[name] ?? node.status;
      if (name === 'ready' || name === 'interview completed') node.ready = true;
      this.nodes.set(ev.nodeId, node);
      if (EVENT_STATUS[name] || name === 'ready' || name === 'interview completed') this.opts.onChange();
    }
  }

  /** Ping a un nodo: si no responde, Z-Wave JS lo marca dead (y HA, no disponible). */
  async ping(nodeId: number): Promise<boolean | undefined> {
    const res = await this.call('node.ping', { nodeId });
    if (res.success !== true) return undefined;
    const result = isObj(res.result) ? res.result : {};
    return result.responded === true;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = undefined;
    ws?.terminate();
    this.state = 'disconnected';
  }
}
