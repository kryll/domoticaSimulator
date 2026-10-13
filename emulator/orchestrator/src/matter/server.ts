// Cliente mínimo de la API WebSocket de matterjs-server (ws://127.0.0.1:5580/ws, la misma que usa
// la integración matter de HA). El orquestador lo usa para comisionar el bridge
// (commission_with_code), saber si el servidor ya lo conoce (get_nodes) y si lo ve disponible.
// Formato: al conectar el servidor manda server_info; cada comando es
// { message_id, command, args } y la respuesta { message_id, result } o { message_id, error_code, details }.
import WebSocket from 'ws';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface MatterServerInfo {
  fabricId?: number;
  compressedFabricId?: number;
  sdkVersion?: string;
}

export interface MatterServerNode {
  nodeId: number;
  available: boolean;
  /** BasicInformation.UniqueID (atributo 0/40/18). */
  uniqueId?: string;
}

export class MatterServerError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MatterServerClient {
  private ws: WebSocket | undefined;
  private seq = 0;
  private readonly pending = new Map<string, Pending>();
  private retry: ReturnType<typeof setTimeout> | undefined;
  private closed = true;
  private waiters: Array<() => void> = [];
  state: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  info: MatterServerInfo | undefined;

  constructor(
    readonly url: string,
    private readonly opts: { onChange?: () => void; retryMs?: number } = {},
  ) {}

  start(): void {
    if (!this.closed) return;
    this.closed = false;
    this.connect();
  }

  private set(state: MatterServerClient['state']): void {
    if (this.state === state) return;
    this.state = state;
    this.opts.onChange?.();
  }

  private connect(): void {
    if (this.closed) return;
    this.set('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('message', (raw) => this.onMessage(ws, String(raw)));
    ws.on('error', () => undefined);
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.info = undefined;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new MatterServerError('Se ha cerrado la conexión con matterjs-server'));
      }
      this.pending.clear();
      this.set('disconnected');
      if (!this.closed) {
        this.retry = setTimeout(() => this.connect(), this.opts.retryMs ?? 5000);
        this.retry.unref?.();
      }
    });
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isObj(msg)) return;
    if (typeof msg.message_id === 'string') {
      const p = this.pending.get(msg.message_id);
      if (!p) return;
      this.pending.delete(msg.message_id);
      clearTimeout(p.timer);
      if ('error_code' in msg) p.reject(new MatterServerError(String(msg.details ?? `error ${String(msg.error_code)}`), typeof msg.error_code === 'number' ? msg.error_code : undefined));
      else p.resolve(msg.result);
      return;
    }
    // Primer mensaje: server_info (sin message_id).
    if ('fabric_id' in msg || 'sdk_version' in msg) {
      this.info = {
        ...(typeof msg.fabric_id === 'number' ? { fabricId: msg.fabric_id } : {}),
        ...(typeof msg.compressed_fabric_id === 'number' ? { compressedFabricId: msg.compressed_fabric_id } : {}),
        ...(typeof msg.sdk_version === 'string' ? { sdkVersion: msg.sdk_version } : {}),
      };
      if (this.ws === ws) {
        this.set('connected');
        const waiters = this.waiters;
        this.waiters = [];
        for (const w of waiters) w();
      }
    }
  }

  /** Espera a estar conectado (con server_info) como mucho `timeoutMs`. */
  async ready(timeoutMs = 10_000): Promise<boolean> {
    if (this.state === 'connected') return true;
    this.start();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(false);
      }, timeoutMs);
      t.unref?.();
      const done = (): void => {
        clearTimeout(t);
        resolve(true);
      };
      this.waiters.push(done);
    });
  }

  async call(command: string, args?: Json, timeoutMs = 30_000): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.state !== 'connected') throw new MatterServerError(`matterjs-server no está conectado (${this.url})`);
    const messageId = `hasim-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new MatterServerError(`matterjs-server no respondió a ${command} en ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(messageId, { resolve, reject, timer });
      ws.send(JSON.stringify({ message_id: messageId, command, ...(args ? { args } : {}) }));
    });
  }

  /** Nodos comisionados en el servidor. */
  async nodes(): Promise<MatterServerNode[]> {
    const res = await this.call('get_nodes', { only_available: false });
    const list = Array.isArray(res) ? res : [];
    return list.filter(isObj).map((n) => {
      const attrs = isObj(n.attributes) ? n.attributes : {};
      const uid = attrs['0/40/18'];
      return { nodeId: Number(n.node_id), available: n.available === true, ...(typeof uid === 'string' ? { uniqueId: uid } : {}) };
    });
  }

  /** Comisiona un dispositivo que ya está en la red (por mDNS) con su código manual. Devuelve el nodo. */
  async commissionWithCode(code: string, timeoutMs = 180_000): Promise<number> {
    const res = await this.call('commission_with_code', { code, network_only: true }, timeoutMs);
    const nodeId = isObj(res) ? Number(res.node_id) : NaN;
    if (!Number.isSafeInteger(nodeId) || nodeId <= 0) throw new MatterServerError(`Respuesta inesperada de commission_with_code: ${JSON.stringify(res)}`);
    return nodeId;
  }

  async removeNode(nodeId: number): Promise<void> {
    await this.call('remove_node', { node_id: nodeId }, 60_000);
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    const ws = this.ws;
    this.ws = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new MatterServerError('Cliente cerrado'));
    }
    this.pending.clear();
    this.info = undefined;
    this.state = 'disconnected';
    ws?.close();
  }
}
