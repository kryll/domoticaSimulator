// Servicio zwave-mock (perfil «zwave» del docker-compose): controlador Z-Wave emulado.
//   - Puerto serie emulado por TCP (ZWAVE_MOCK_PORT, 5555): solo en la red interna de Docker; lo
//     usa Z-Wave JS UI como antena (tcp://zwave-mock:5555).
//   - WebSocket de control (ZWAVE_MOCK_CONTROL_PORT, 5556), publicado solo en 127.0.0.1: el
//     orquestador manda el estado deseado y recibe los comandos y las tramas. Exige LAB_TOKEN.
//   - Recuerda el último estado en ZWAVE_MOCK_DATA (volumen): al volver a arrancar, la red está
//     igual desde el primer momento (sin reiniciar el driver de Z-Wave JS UI).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { LAB_HOME_ID } from '../../../../src/bridge/zwave/plan';
import { tokenMatches } from '../server';
import { ZwaveMockHost } from './mock';
import { parseToMock, type FromMock, type MockState } from './protocol';

const env = process.env;
const token = (env.LAB_TOKEN ?? '').trim();
const host = env.ZWAVE_MOCK_HOST ?? '0.0.0.0';
const serialPort = Number(env.ZWAVE_MOCK_PORT ?? 5555);
const controlPort = Number(env.ZWAVE_MOCK_CONTROL_PORT ?? 5556);
const dataDir = env.ZWAVE_MOCK_DATA ?? '/data';
const stateFile = join(dataDir, 'mock-state.json');
const log = (msg: string): void => console.log(`[zwave-mock] ${msg.replace(/^\[zwave-mock\] /, '')}`);

const clients = new Set<WebSocket>();
const send = (msg: FromMock): void => {
  const text = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(text);
};

const mock = new ZwaveMockHost({
  port: serialPort,
  host,
  onCommand: (nodeId, command) => send({ type: 'command', nodeId, command }),
  onFrame: (dir, nodeId, summary) => send({ type: 'frame', dir, nodeId, summary }),
  onStatus: (status) => send({ type: 'status', ...status }),
  log,
  reinitDelayMs: Number(env.ZWAVE_MOCK_REINIT_MS ?? 20_000),
});

const EMPTY: MockState = { config: { homeId: LAB_HOME_ID, nodes: [], wakeUpSeconds: 120 }, values: {}, down: [], controllerUp: true };

async function loadState(): Promise<MockState> {
  try {
    const raw = JSON.parse(await readFile(stateFile, 'utf8')) as { state?: unknown };
    const parsed = parseToMock(JSON.stringify({ type: 'state', state: raw.state }));
    if (parsed.type === 'state') return { ...parsed.state, controllerUp: true };
  } catch {
    // Primera vez: red vacía (solo el controlador).
  }
  return EMPTY;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveState(state: MockState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void (async () => {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${stateFile}.tmp`;
      await writeFile(tmp, JSON.stringify({ state }), { mode: 0o600 });
      await rename(tmp, stateFile);
    })().catch((err: unknown) => log(`no se pudo guardar el estado: ${String(err)}`));
  }, 1000);
}

async function main(): Promise<void> {
  if (token.length < 16) throw new Error('Falta LAB_TOKEN (al menos 16 caracteres)');
  await mock.apply(await loadState());
  const wss = new WebSocketServer({ host, port: controlPort, maxPayload: 4 * 1024 * 1024 });
  wss.on('connection', (ws) => {
    let authed = false;
    const timer = setTimeout(() => ws.close(4401, 'token'), 5000);
    ws.on('message', (data) => {
      let msg;
      try {
        msg = parseToMock(String(data));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies FromMock));
        return;
      }
      if (!authed) {
        clearTimeout(timer);
        if (msg.type !== 'hello' || !tokenMatches(msg.token, token)) {
          ws.close(4401, 'token');
          return;
        }
        authed = true;
        clients.add(ws);
        ws.send(JSON.stringify({ type: 'ready', version: '1' } satisfies FromMock));
        ws.send(JSON.stringify({ type: 'status', client: mock.clientConnected, listening: mock.listening, nodes: 0 } satisfies FromMock));
        return;
      }
      if (msg.type === 'state') {
        mock.apply(msg.state).then(
          () => saveState(msg.state),
          (err: unknown) => send({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
        );
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      clients.delete(ws);
    });
  });
  log(`control en ws://${host}:${controlPort} (con el token del laboratorio)`);
  const stop = async (): Promise<void> => {
    await mock.close();
    wss.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err: unknown) => {
  console.error('[zwave-mock] no se pudo arrancar:', err);
  process.exit(1);
});
