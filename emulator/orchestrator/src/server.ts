// Servidor HTTP + WebSocket del orquestador: /health, /project y el WebSocket de la app
// (en / y en /orchestrator, que es la ruta que publica Caddy).
//
// Seguridad:
// - Token del laboratorio (LAB_TOKEN, lo genera setup.sh en emulator/.env). El WebSocket exige
//   como primer mensaje un `hello` con el token (si no llega en AUTH_TIMEOUT_MS, o no es válido,
//   se cierra con 4401). GET /project exige `Authorization: Bearer <token>`.
// - Origin: un navegador siempre lo manda; se aceptan el mismo origen de Caddy, localhost y
//   ALLOWED_ORIGINS. Los clientes que no son navegadores (e2e, scripts) no mandan Origin y
//   necesitan igualmente el token.
// - maxPayload de 4 MB: un proyecto sin imágenes del plano cabe de sobra.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '../../../src/bridge/protocol';
import type { AppConnection, Lab } from './lab';

export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
export const AUTH_TIMEOUT_MS = 5000;
/** Código de cierre del WebSocket por token ausente o no válido. */
export const CLOSE_UNAUTHORIZED = 4401;

export interface OrchestratorServer {
  server: Server;
  port: () => number;
  close: () => Promise<void>;
}

export interface ServerOptions {
  port: number;
  host?: string;
  /** Orígenes extra permitidos en el WebSocket (ALLOWED_ORIGINS). */
  origins?: readonly string[];
  /** Token del laboratorio. Obligatorio. */
  token: string;
  authTimeoutMs?: number;
}

/** Origen de la app permitido en el WebSocket (mismo origen con Caddy, o localhost en desarrollo). */
export function allowedOrigin(origin: string | undefined, host: string | undefined, extra: readonly string[] = []): boolean {
  // Sin Origin: no es un navegador (scripts, e2e). Se acepta, pero tendrá que dar el token.
  if (origin === undefined || origin === '') return true;
  try {
    const u = new URL(origin);
    if (extra.includes(u.origin)) return true;
    // Mismo origen que el Host (Caddy en la LAN): solo con IP literal, no con nombres DNS, para
    // no abrir la puerta al DNS rebinding. Con un nombre (p. ej. mipc.local) usa ALLOWED_ORIGINS.
    if (host !== undefined && u.host === host && (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.startsWith('['))) return true;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

/** Comparación en tiempo constante del token. */
export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || expected === '') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  const m = typeof h === 'string' ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  return m?.[1];
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function route(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] ?? '/';
  return path.replace(/^\/orchestrator(?=\/|$)/, '') || '/';
}

export function startServer(lab: Lab, opts: ServerOptions): Promise<OrchestratorServer> {
  const { port, host = '127.0.0.1', origins = [], token } = opts;
  if (!token) throw new Error('Falta el token del laboratorio (LAB_TOKEN): ejecuta emulator/scripts/setup.sh');
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = route(req.url);
    if (req.method === 'GET' && path === '/health') {
      const health = lab.health();
      return json(res, health.ok === true ? 200 : 503, health);
    }
    if (req.method === 'GET' && path === '/project') {
      if (!tokenMatches(bearer(req), token)) return json(res, 401, { error: 'Falta el token del laboratorio (Authorization: Bearer <LAB_TOKEN>)' });
      const project = lab.currentProject();
      return project ? json(res, 200, { project, definitions: lab.currentDefinitions() }) : json(res, 404, { error: 'Todavía no hay proyecto: abre la app y conecta el laboratorio' });
    }
    json(res, 404, { error: 'No encontrado' });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const path = route(req.url);
    if (path !== '/' || !allowedOrigin(req.headers.origin, req.headers.host, origins)) {
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
    let authed = false;
    const reject = (message: string): void => {
      conn.send({ v: 1, type: 'error', code: 'auth', message });
      ws.close(CLOSE_UNAUTHORIZED, 'token');
    };
    const timer = setTimeout(() => reject('Falta el token del laboratorio: el primer mensaje debe ser hello con el token'), opts.authTimeoutMs ?? AUTH_TIMEOUT_MS);
    ws.on('message', (data) => {
      let msg;
      try {
        msg = parseClientMessage(String(data));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!authed) return reject(`Conexión rechazada: ${message}`);
        conn.send({ v: 1, type: 'error', code: 'invalid', message });
        return;
      }
      if (!authed) {
        clearTimeout(timer);
        if (msg.type !== 'hello' || !tokenMatches(msg.token, token)) return reject('Token del laboratorio no válido');
        authed = true;
        lab.attach(conn);
        return;
      }
      lab.handle(conn, msg).catch((err: unknown) => conn.send({ v: 1, type: 'error', message: err instanceof Error ? err.message : String(err) }));
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (authed) lab.detach(conn);
    });
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
