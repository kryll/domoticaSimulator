// Un Shelly Gen2+ emulado: servidor HTTP con GET /shelly y la API RPC (WebSocket /rpc con tramas
// JSON-RPC 2.0, y también GET/POST /rpc para probar con curl), como el firmware real. HA lo añade
// con la integración `shelly` (host 127.0.0.1 y su puerto) y aioshelly mantiene abierto el
// WebSocket: por él llegan las llamadas (Shelly.GetStatus, Switch.Set...) y salen las
// notificaciones (NotifyStatus, NotifyEvent). Arrancar o parar el nodo es abrir o cerrar el
// servidor: al pararlo, HA lo ve no disponible.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { BridgeCommand } from '../../../../src/bridge/mqtt/commands';
import type { EntityState } from '../../../../src/types';
import { describeShellyStatus, handleShellyRpc, shellyDeviceInfo, type Json, type JsonObject, type ShellyNodePlan } from '../../../../src/bridge/shelly/plan';

export interface ShellyNodeOptions {
  plan: ShellyNodePlan;
  port: number;
  host?: string;
  /** Estados actuales del simulador. */
  entities: () => Readonly<Record<string, EntityState>>;
  /** Comandos de HA (Switch.Set, Cover.Open...) ya traducidos a servicios del simulador. */
  onCommand: (commands: BridgeCommand[], method: string) => void;
  /** Resumen de lo que pasa por la API para el inspector de tráfico. */
  onTraffic?: (dir: 'in' | 'out', summary: string) => void;
  onClients?: (count: number) => void;
  log?: (msg: string) => void;
}

const MAX_FRAME = 64 * 1024;
const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Peer {
  ws: WebSocket;
  /** `src` del cliente (aioshelly: «aios-…»): va como `dst` en las notificaciones. */
  src?: string;
}

/**
 * Peticiones hechas por una web abierta en el navegador: llevan Origin (también al abrir un
 * WebSocket, que no tiene CORS) o Sec-Fetch-Site distinto de «none» (un <img> a /rpc/Switch.Set no
 * lleva Origin). Sin este filtro, cualquier web podría mandar comandos al Shelly emulado. HA
 * (aioshelly con aiohttp) y curl no mandan ninguna de las dos; escribir la URL a mano en el
 * navegador manda «none» y sigue funcionando.
 */
function fromBrowser(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  return req.headers.origin !== undefined || (site !== undefined && site !== 'none');
}

/** Métodos de solo lectura que HA pide a menudo (no se anotan uno a uno en el inspector). */
const QUIET = new Set(['Shelly.GetStatus', 'Shelly.GetComponents', 'Cover.GetStatus']);

export class ShellyNodeServer {
  private server: Server | undefined;
  private wss: WebSocketServer | undefined;
  private readonly peers = new Set<Peer>();
  private startedAt = 0;
  plan: ShellyNodePlan;

  constructor(readonly options: ShellyNodeOptions) {
    this.plan = options.plan;
  }

  get running(): boolean {
    return this.server?.listening === true;
  }

  get clients(): number {
    return this.peers.size;
  }

  log(msg: string): void {
    this.options.log?.(`[shelly ${this.plan.hostname}] ${msg}`);
  }

  private traffic(dir: 'in' | 'out', summary: string): void {
    this.options.onTraffic?.(dir, summary);
  }

  private runtime(): { uptime: number; unixtime: number; ip: string } {
    return { uptime: (Date.now() - this.startedAt) / 1000, unixtime: Date.now() / 1000, ip: this.options.host ?? '127.0.0.1' };
  }

  /** Atiende una llamada RPC (WebSocket o HTTP) y avisa de los comandos. */
  call(method: string, params: JsonObject | undefined): { result?: Json; error?: { code: number; message: string } } {
    const out = handleShellyRpc(this.plan, method, params, this.options.entities(), this.runtime());
    if (!QUIET.has(method) || out.error) {
      const args = params && Object.keys(params).length > 0 ? ` ${JSON.stringify(params)}` : '';
      this.traffic('in', `${method}${args}${out.error ? ` → error ${out.error.code}: ${out.error.message}` : ''}`);
    }
    if (out.commands.length > 0) this.options.onCommand(out.commands, method);
    return out.error ? { error: out.error } : { result: out.result ?? null };
  }

  private onFrame(peer: Peer, raw: RawData): void {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      this.log('trama que no es JSON: se ignora');
      return;
    }
    if (!isObj(frame)) return;
    if (typeof frame.src === 'string') peer.src = frame.src;
    const method = frame.method;
    if (typeof method !== 'string') return; // Respuestas a nuestras peticiones: no hacemos ninguna.
    const params = isObj(frame.params) ? frame.params : undefined;
    const reply = this.call(method, params);
    if (frame.id === undefined || frame.id === null) return; // Notificación del cliente.
    const out: JsonObject = { id: frame.id as Json, src: this.plan.hostname, ...(peer.src ? { dst: peer.src } : {}), ...reply };
    peer.ws.send(JSON.stringify(out));
  }

  private async onHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://shelly');
    const json = (status: number, body: Json): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (fromBrowser(req)) {
      json(403, { code: 403, message: 'Forbidden' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/shelly') {
      json(200, shellyDeviceInfo(this.plan));
      return;
    }
    if (url.pathname === '/rpc' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const b = chunk as Buffer;
        size += b.length;
        if (size > MAX_FRAME) {
          json(413, { code: 413, message: 'Too large' });
          return;
        }
        chunks.push(b);
      }
      let frame: unknown;
      try {
        frame = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        json(400, { code: -103, message: 'Invalid JSON' });
        return;
      }
      if (!isObj(frame) || typeof frame.method !== 'string') {
        json(400, { code: -103, message: 'Missing method' });
        return;
      }
      const reply = this.call(frame.method, isObj(frame.params) ? frame.params : undefined);
      json(200, { id: (frame.id as Json | undefined) ?? 1, src: this.plan.hostname, ...reply });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/rpc/')) {
      // GET /rpc/Switch.Set?id=0&on=true (como el firmware: los valores se leen como JSON si se puede).
      const params: JsonObject = {};
      for (const [k, v] of url.searchParams) {
        try {
          params[k] = JSON.parse(v) as Json;
        } catch {
          params[k] = v;
        }
      }
      const reply = this.call(decodeURIComponent(url.pathname.slice('/rpc/'.length)), params);
      if (reply.error) json(reply.error.code === 404 ? 404 : 400, reply.error as unknown as Json);
      else json(200, reply.result ?? null);
      return;
    }
    json(404, { code: 404, message: 'Not found' });
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
    const server = createServer((req, res) => {
      this.onHttp(req, res).catch((err: unknown) => {
        this.log(`error HTTP: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://shelly').pathname;
      if (path !== '/rpc' || fromBrowser(req)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const peer: Peer = { ws };
        this.peers.add(peer);
        this.options.onClients?.(this.peers.size);
        this.traffic('in', 'WebSocket /rpc abierto');
        ws.on('message', (data) => this.onFrame(peer, data));
        const drop = (): void => {
          if (this.peers.delete(peer)) this.options.onClients?.(this.peers.size);
        };
        ws.on('close', drop);
        ws.on('error', drop);
      });
    });
    this.server = server;
    this.wss = wss;
    this.startedAt = Date.now();
    return new Promise((resolve, reject) => {
      server.once('error', (err) => {
        this.server = undefined;
        this.wss = undefined;
        reject(err);
      });
      server.listen(this.options.port, this.options.host ?? '127.0.0.1', () => resolve());
    });
  }

  /** Para el nodo: cierra los WebSocket (HA lo marca no disponible) y deja de escuchar. */
  async stop(): Promise<void> {
    const server = this.server;
    const wss = this.wss;
    this.server = undefined;
    this.wss = undefined;
    for (const p of this.peers) p.ws.terminate();
    this.peers.clear();
    this.options.onClients?.(0);
    wss?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /** Notificación a todos los clientes (NotifyStatus, NotifyEvent...). */
  private notify(method: string, params: JsonObject): boolean {
    let sent = false;
    for (const p of this.peers) {
      if (p.ws.readyState !== p.ws.OPEN) continue;
      p.ws.send(JSON.stringify({ src: this.plan.hostname, ...(p.src ? { dst: p.src } : {}), method, params }));
      sent = true;
    }
    return sent;
  }

  /** Manda a HA los componentes cuyo estado ha cambiado (NotifyStatus, como el firmware). */
  pushStatus(changed: Record<string, JsonObject>): void {
    if (Object.keys(changed).length === 0) return;
    if (!this.notify('NotifyStatus', { ts: Math.round(Date.now() / 10) / 100, ...changed })) return;
    for (const [key, s] of Object.entries(changed)) this.traffic('out', `NotifyStatus · ${describeShellyStatus(key, s)}`);
  }

  /**
   * Cambia los componentes (como un cambio de configuración): avisa con NotifyEvent
   * «config_changed» y HA vuelve a cargar la entrada (crea o quita entidades).
   */
  updatePlan(plan: ShellyNodePlan): void {
    const before = JSON.stringify(this.plan);
    this.plan = plan;
    if (before === JSON.stringify(plan)) return;
    const ts = Math.round(Date.now() / 10) / 100;
    if (this.notify('NotifyEvent', { ts, events: [{ component: 'sys', event: 'config_changed', restart_required: false, ts, cfg_rev: 2 }] })) {
      this.traffic('out', 'NotifyEvent · config_changed (componentes nuevos)');
    }
  }
}
