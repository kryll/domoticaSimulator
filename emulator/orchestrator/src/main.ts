// Punto de entrada de hasim-orchestrator (Node 22 + tsx). Configuración por variables de entorno.
import { Lab } from './lab';
import { startServer } from './server';
import { SnapshotStore } from './snapshots';
import { dockerSocketControl } from './docker';
import { readToken, restartHa, syncAutomations } from './haSync';

const env = process.env;
const haConfigDir = env.HA_CONFIG_DIR;
const secretsDir = env.SECRETS_DIR ?? '/secrets';
const haUrl = env.HA_URL ?? 'http://127.0.0.1:8123';
const log = (msg: string): void => console.log(`[orquestador] ${msg}`);

const lab = new Lab({
  mqttUrl: env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  ...(env.MQTT_USERNAME ? { username: env.MQTT_USERNAME } : {}),
  ...(env.MQTT_PASSWORD ? { password: env.MQTT_PASSWORD } : {}),
  autostart: env.HASIM_AUTOSTART !== '0',
  ...(haConfigDir && env.SNAPSHOTS_DIR ? { snapshots: new SnapshotStore(haConfigDir, env.SNAPSHOTS_DIR) } : {}),
  containers: dockerSocketControl(env.DOCKER_SOCKET ?? '/var/run/docker.sock'),
  haContainer: env.HA_CONTAINER ?? 'hasim-homeassistant',
  ...(haConfigDir
    ? {
        sync: async (project, defs) => {
          const r = await syncAutomations(project, defs, { haConfigDir, haUrl, secretsDir });
          return `Packages escritos (${r.files.length})${r.reloaded ? ' y HA recargado' : '; sin token de HA, no se ha recargado'}`;
        },
      }
    : {}),
  restartHa: async () => {
    const token = await readToken(secretsDir);
    if (token) await restartHa(haUrl, token);
  },
  haTokenAvailable: async () => (await readToken(secretsDir)) !== undefined,
  log,
});

const port = Number(env.PORT ?? 8081);
const host = env.HOST ?? '127.0.0.1';
const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function main(): Promise<void> {
  const server = await startServer(lab, port, host, origins);
  log(`escuchando en http://${host}:${server.port()} (WebSocket en / y /orchestrator)`);
  await lab.start();
  log('conectado a MQTT');
  const stop = async (): Promise<void> => {
    await lab.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err: unknown) => {
  console.error('[orquestador] no se pudo arrancar:', err);
  process.exit(1);
});
