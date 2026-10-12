// Cliente WebSocket de la app hacia hasim-orchestrator, con reconexión exponencial.
import { encode, parseServerMessage, type ClientMessage, type ServerMessage } from './protocol';

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export type ClientStatus = 'connecting' | 'connected' | 'disconnected';

/** Mensaje de la app sin la versión (la añade el cliente). */
export type Outgoing = ClientMessage extends infer M ? (M extends { v: number } ? Omit<M, 'v'> : never) : never;

export interface BridgeClientOptions {
  url: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ClientStatus) => void;
  factory?: SocketFactory;
  minDelayMs?: number;
  maxDelayMs?: number;
}

const OPEN = 1;

export class BridgeClient {
  private socket: SocketLike | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private delay: number;
  private stopped = true;

  constructor(private readonly opts: BridgeClientOptions) {
    this.delay = opts.minDelayMs ?? 1000;
  }

  get url(): string {
    return this.opts.url;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const s = this.socket;
    this.socket = undefined;
    if (s) {
      s.onclose = null;
      s.close();
    }
    this.opts.onStatus('disconnected');
  }

  connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  send(msg: Outgoing): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(encode(msg as { type: string }));
    return true;
  }

  private open(): void {
    const factory = this.opts.factory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    this.opts.onStatus('connecting');
    let socket: SocketLike;
    try {
      socket = factory(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.delay = this.opts.minDelayMs ?? 1000;
      this.opts.onStatus('connected');
    };
    socket.onmessage = (ev) => {
      const msg = typeof ev.data === 'string' ? parseServerMessage(ev.data) : null;
      if (msg) this.opts.onMessage(msg);
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.opts.onStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, this.opts.maxDelayMs ?? 15_000);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.stopped) this.open();
    }, wait);
  }
}

/** Prueba de conexión: abre, espera el hello del orquestador y cierra. */
export function testConnection(url: string, timeoutMs = 4000, factory?: SocketFactory): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let socket: SocketLike;
    try {
      socket = (factory ?? ((u: string) => new WebSocket(u) as unknown as SocketLike))(url);
    } catch (err) {
      resolve({ ok: false, message: `URL no válida: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    const finish = (ok: boolean, message: string): void => {
      clearTimeout(timer);
      socket.onclose = null;
      socket.onmessage = null;
      socket.close();
      resolve({ ok, message });
    };
    const timer = setTimeout(() => finish(false, 'El orquestador no responde. ¿Está arrancado el laboratorio?'), timeoutMs);
    socket.onmessage = (ev) => {
      const msg = typeof ev.data === 'string' ? parseServerMessage(ev.data) : null;
      if (msg?.type === 'hello') finish(true, `Conectado con hasim-orchestrator ${msg.version} (protocolo ${msg.protocol})`);
    };
    socket.onclose = () => finish(false, 'No se pudo conectar con el orquestador');
  });
}
