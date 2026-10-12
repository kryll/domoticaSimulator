// Servidor HTTP + WebSocket del orquestador: /health, /project y el WebSocket de la app
// (en / y en /orchestrator, que es la ruta que publica Caddy).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '../../../src/bridge/protocol';
import type { AppConnection, Lab } from './lab';

export interface OrchestratorServer {
  server: Server;
  port: () => number;
  close: () => Promise<void>;
}

/** Origen de la app permitido en el WebSocket (mismo origen con Caddy, o localhost en desarrollo). */
export function allowedOrigin(origin: string | undefined, extra: readonly string[] = []): boolean {
  if (origin === undefined || origin === '') return true;
  try {
    const u = new URL(origin);
    if (extra.includes(u.origin)) return true;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function route(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] ?? '/';
  return path.replace(/^\/orchestrator(?=\/|$)/, '') || '/';
}

export function startServer(lab: Lab, port: number, host = '127.0.0.1', origins: readonly string[] = []): Promise<OrchestratorServer> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = route(req.url);
    if (req.method === 'GET' && path === '/health') return json(res, 200, lab.health());
    if (req.method === 'GET' && path === '/project') {
      const project = lab.currentProject();
      return project ? json(res, 200, { project, definitions: lab.currentDefinitions() }) : json(res, 404, { error: 'Todavía no hay proyecto: abre la app y conecta el laboratorio' });
    }
    json(res, 404, { error: 'No encontrado' });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = route(req.url);
    if (path !== '/' || !allowedOrigin(req.headers.origin, origins)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws: WebSocket) => {
    const conn: AppConnection = {
      traffic: false,
      send: (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    lab.attach(conn);
    ws.on('message', (data) => {
      let msg;
      try {
        msg = parseClientMessage(String(data));
      } catch (err) {
        conn.send({ v: 1, type: 'error', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      lab.handle(conn, msg).catch((err: unknown) => conn.send({ v: 1, type: 'error', message: err instanceof Error ? err.message : String(err) }));
    });
    ws.on('close', () => lab.detach(conn));
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        server,
        port: () => {
          const addr = server.address();
          return typeof addr === 'object' && addr ? addr.port : port;
        },
        close: () =>
          new Promise<void>((done) => {
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => done());
          }),
      });
    });
  });
}
